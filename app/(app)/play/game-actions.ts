"use server";

import { revalidatePath } from "next/cache";
import { and, eq, gte, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { gameRoster, gameAttendance, games } from "@/lib/db/schema";
import { activeGame, reachableActiveGame, nextPlayableOccurrence } from "@/lib/db/gameMembership";
import { isEmailVerified, UNVERIFIED_MSG } from "@/lib/auth/verified";
import { runOccurrence } from "@/lib/mime/trigger";

export type JoinResult = { ok: true } | { ok: false; error: string };

async function syncRosterCount(gameId: string) {
  await db.update(games)
    .set({ confirmedCount: sql`(select count(*) from game_roster where game_id = ${gameId})` })
    .where(eq(games.id, gameId));
}

/** Persist an explicit RSVP for one occurrence. We always store "in"/"out" (never
 *  delete on "out"): a default-"in" regular who skips one week needs an explicit
 *  "out" row, else effective-RSVP logic (override ?? default) reads them as in. */
async function upsertAttendance(gameId: string, userId: string, occ: string, status: "in" | "out") {
  await db.insert(gameAttendance)
    .values({ gameId, userId, occurrenceDate: occ, status })
    .onConflictDoUpdate({
      target: [gameAttendance.gameId, gameAttendance.userId, gameAttendance.occurrenceDate],
      set: { status },
    });
}

/** Join (or update) a weekly game in one shot, from the popup's slider form:
 *  roster membership with a per-site default (regular = "usually come" / occasional
 *  = "usually won't") plus the next-occurrence RSVP. Idempotent, so it doubles as
 *  "save changes" for an existing member. Gated on the radius rule. */
export async function joinWeeklyGame(gameId: string, regular: boolean, nextIn: boolean): Promise<JoinResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "sign in first" };
  const me = session.user.id;

  // New joins are gated on the radius rule; existing members can always update
  // their pref/RSVP or save even if they've since moved or narrowed their radius.
  const [member] = await db.select({ g: gameRoster.gameId }).from(gameRoster)
    .where(and(eq(gameRoster.gameId, gameId), eq(gameRoster.userId, me))).limit(1);
  // A non-member tapping "i'm out" is declining, not joining — don't roster them
  // (which would otherwise sign them up for this game's weekly poll emails). An
  // existing member's explicit "out" still persists so a regular can skip a week.
  if (!member && !nextIn) return { ok: true };
  // New joins require a confirmed email; existing members can still tweak prefs.
  if (!member && !(await isEmailVerified(me))) return { ok: false, error: UNVERIFIED_MSG };
  const g = member ? await activeGame(gameId) : await reachableActiveGame(me, gameId);
  if (!g) return { ok: false, error: member ? "game unavailable" : "this game is outside your travel area" };
  const def = regular ? "in" : "out";

  await db.insert(gameRoster).values({ gameId, userId: me, defaultStatus: def })
    .onConflictDoUpdate({ target: [gameRoster.gameId, gameRoster.userId], set: { defaultStatus: def } });

  await upsertAttendance(gameId, me, await nextPlayableOccurrence(g, new Date()), nextIn ? "in" : "out");
  await syncRosterCount(gameId);
  // Reconcile the occurrence now (poll tally, week-on/off) instead of waiting for
  // the cron tick — the map popup joins through here, same as my-games/captain do.
  await runOccurrence(gameId);
  revalidatePath("/my-games");
  return { ok: true };
}

/** "I'll probably be there every week" — standing roster membership. Independent
 *  of the per-game RSVP below. Joining is gated on the radius rule; leaving is a
 *  self-edit that also clears any future RSVPs so a departed member can't keep
 *  inflating upcoming/freeze headcounts. */
export async function setRosterMembership(gameId: string, on: boolean): Promise<JoinResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "sign in first" };
  const me = session.user.id;

  if (on) {
    if (!(await isEmailVerified(me))) return { ok: false, error: UNVERIFIED_MSG };
    if (!(await reachableActiveGame(me, gameId))) return { ok: false, error: "this game is outside your travel area" };
    await db.insert(gameRoster).values({ gameId, userId: me }).onConflictDoNothing();
  } else {
    await db.delete(gameAttendance).where(and(
      eq(gameAttendance.gameId, gameId), eq(gameAttendance.userId, me),
      gte(gameAttendance.occurrenceDate, sql`current_date`),
    ));
    await db.delete(gameRoster).where(and(eq(gameRoster.gameId, gameId), eq(gameRoster.userId, me)));
  }
  await syncRosterCount(gameId);
  await runOccurrence(gameId);
  revalidatePath("/my-games");
  return { ok: true };
}

/** RSVP in/out for the next occurrence, independent of weekly membership (a
 *  drop-in can commit to a single game). Always stores an explicit row. */
export async function setNextGameRsvp(gameId: string, on: boolean): Promise<JoinResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "sign in first" };
  const me = session.user.id;
  if (on && !(await isEmailVerified(me))) return { ok: false, error: UNVERIFIED_MSG };

  const g = on ? await reachableActiveGame(me, gameId) : await activeGame(gameId);
  if (!g) return { ok: false, error: on ? "this game is outside your travel area" : "game unavailable" };
  await upsertAttendance(gameId, me, await nextPlayableOccurrence(g, new Date()), on ? "in" : "out");
  await runOccurrence(gameId);
  revalidatePath("/my-games");
  return { ok: true };
}
