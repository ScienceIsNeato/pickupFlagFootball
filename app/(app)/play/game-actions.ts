"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { gameRoster, gameAttendance, games } from "@/lib/db/schema";
import { activeGame, reachableActiveGame } from "@/lib/db/gameMembership";
import { nextOccurrenceYMD } from "@/lib/datetime";

export type JoinResult = { ok: true } | { ok: false; error: string };

async function syncRosterCount(gameId: string) {
  await db.update(games)
    .set({ confirmedCount: sql`(select count(*) from game_roster where game_id = ${gameId})` })
    .where(eq(games.id, gameId));
}

/** "I'll probably be there every week" — standing roster membership. Independent
 *  of the per-game RSVP below. Joining is gated on the radius rule (your travel
 *  radius must reach the game's area); leaving is a self-edit. */
export async function setRosterMembership(gameId: string, on: boolean): Promise<JoinResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "sign in first" };
  const me = session.user.id;

  if (on) {
    if (!(await reachableActiveGame(me, gameId))) return { ok: false, error: "this game is outside your travel area" };
    await db.insert(gameRoster).values({ gameId, userId: me }).onConflictDoNothing();
  } else {
    await db.delete(gameRoster).where(and(eq(gameRoster.gameId, gameId), eq(gameRoster.userId, me)));
  }
  await syncRosterCount(gameId);
  revalidatePath("/my-games");
  return { ok: true };
}

/** "I'll be there for the next game on <date>" — a one-off RSVP for the next
 *  occurrence, independent of weekly membership (so a drop-in can commit to just
 *  one game). On = an "in" row for that date; off = remove it. */
export async function setNextGameRsvp(gameId: string, on: boolean): Promise<JoinResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "sign in first" };
  const me = session.user.id;

  const g = on ? await reachableActiveGame(me, gameId) : await activeGame(gameId);
  if (!g) return { ok: false, error: on ? "this game is outside your travel area" : "game unavailable" };
  const occ = nextOccurrenceYMD(g, new Date());

  if (on) {
    await db.insert(gameAttendance)
      .values({ gameId, userId: me, occurrenceDate: occ, status: "in" })
      .onConflictDoUpdate({
        target: [gameAttendance.gameId, gameAttendance.userId, gameAttendance.occurrenceDate],
        set: { status: "in" },
      });
  } else {
    await db.delete(gameAttendance).where(and(
      eq(gameAttendance.gameId, gameId),
      eq(gameAttendance.userId, me),
      eq(gameAttendance.occurrenceDate, occ),
    ));
  }
  revalidatePath("/my-games");
  return { ok: true };
}
