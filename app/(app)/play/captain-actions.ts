"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { txnDb } from "@/lib/db/pool";
import { games, areaCaptains, gameOccurrences, gameRoster } from "@/lib/db/schema";
import { nextPlayableOccurrence } from "@/lib/db/gameMembership";
import { isEmailVerified, UNVERIFIED_MSG } from "@/lib/auth/verified";

export type CaptainResult = { ok: true } | { ok: false; error: string };

/** A user may run captain controls on a game only if they're a captain of its
 *  area. Returns the game's recur info (for cancel-week) or an error. */
type SeriesStatus = "active" | "paused" | "retired";
type Game = { areaId: string; status: SeriesStatus; recurDow: number | null; recurTime: string | null; scheduledStart: Date };

async function asCaptain(gameId: string): Promise<{ ok: false; error: string } | { ok: true; game: Game }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "sign in first" };
  const uid = session.user.id;
  const [g] = await db.select({
    areaId: games.areaId, status: games.status, recurDow: games.recurDow, recurTime: games.recurTime,
    scheduledStart: games.scheduledStart,
  }).from(games).where(eq(games.id, gameId)).limit(1);
  if (!g) return { ok: false, error: "game not found" };
  const [cap] = await db.select({ u: areaCaptains.userId }).from(areaCaptains)
    .where(and(eq(areaCaptains.areaId, g.areaId), eq(areaCaptains.userId, uid))).limit(1);
  if (!cap) return { ok: false, error: "only a captain can do that" };
  return { ok: true, game: g };
}

// Valid series transitions (retired is terminal).
const ALLOWED: Record<SeriesStatus, SeriesStatus[]> = {
  active: ["paused", "retired"],
  paused: ["active", "retired"],
  retired: [],
};

async function setSeriesStatus(
  gameId: string, status: SeriesStatus,
  // Pause carries an expected resume date + note; resume/retire clear them.
  meta: { pausedUntil: string | null; pauseNote: string | null } = { pausedUntil: null, pauseNote: null },
): Promise<CaptainResult> {
  const c = await asCaptain(gameId);
  if (!c.ok) return c;
  if (c.game.status === status) return { ok: true }; // idempotent no-op
  if (!ALLOWED[c.game.status].includes(status)) {
    return { ok: false, error: `can't move a ${c.game.status} series to ${status}` };
  }
  // Status flip + in-flight cancellation are one atomic unit: if the cancellation
  // fails after the status commits, the idempotent no-op above would skip the retry
  // and leave occurrences orphaned. A transaction keeps them consistent. Use the
  // pooled WebSocket client — the default neon-http `db` is one-shot and throws on
  // an interactive transaction (works in e2e's pg driver, fails against Neon).
  const raced = await txnDb.transaction(async (tx) => {
    const done = await tx.update(games).set({ status, pausedUntil: meta.pausedUntil, pauseNote: meta.pauseNote })
      .where(and(eq(games.id, gameId), eq(games.status, c.game.status)))
      .returning({ id: games.id });
    // Lost a race (status changed between read and write) → roll back, report it.
    if (!done.length) return true;
    // Pausing/retiring calls off any in-flight week so the occurrence engine (which
    // only advances active series) never leaves it stuck mid-cycle.
    if (status === "paused" || status === "retired") {
      await tx.update(gameOccurrences).set({ status: "cancelled", updatedAt: new Date() })
        .where(and(
          eq(gameOccurrences.gameId, gameId),
          // includes 'skipped' — a decided-but-unnotified skip would otherwise be
          // stranded once the active-series guard blocks notifyDecided.
          inArray(gameOccurrences.status, ["pending", "polling", "tallying", "scheduled", "skipped", "notifying", "awaiting_game"]),
        ));
    }
    // Retiring is permanent — release the roster back to the free-interest pool.
    // Members keep their interest signals (so they still court games near home);
    // they're just no longer claimed by this dead game. (Pause keeps the roster so
    // resume restores the same members.)
    if (status === "retired") {
      await tx.delete(gameRoster).where(eq(gameRoster.gameId, gameId));
    }
    return false;
  });
  if (raced) return { ok: false, error: "the series state just changed — try again" };
  revalidatePath("/play");
  revalidatePath("/my-games");
  return { ok: true };
}

/** Captain pauses the standing game for a season — requires an expected resume
 *  date (so it's a pause, not a stop) and a note shown to players. If there's no
 *  reasonable resume date, the captain should retire the series instead. */
export async function pauseSeries(gameId: string, resumeDate: string, note: string): Promise<CaptainResult> {
  const trimmed = (note ?? "").trim();
  if (!trimmed) return { ok: false, error: "add a note so players know why the game's paused" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(resumeDate ?? "")) {
    return { ok: false, error: "pick an expected resume date — or retire the series instead" };
  }
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (new Date(`${resumeDate}T00:00:00`) <= today) return { ok: false, error: "the resume date must be in the future" };
  return setSeriesStatus(gameId, "paused", { pausedUntil: resumeDate, pauseNote: trimmed });
}
/** Captain resumes a paused series (clears the pause note/date). */
export async function resumeSeries(gameId: string) { return setSeriesStatus(gameId, "active"); }
/** Captain ends the series for good. */
export async function retireSeries(gameId: string) { return setSeriesStatus(gameId, "retired"); }

/** Captain calls off this week's game. Marks (or pre-empts) the upcoming
 *  occurrence as cancelled, so the poll won't open / a scheduled game is off. */
export async function cancelWeek(gameId: string): Promise<CaptainResult> {
  const c = await asCaptain(gameId);
  if (!c.ok) return c;
  const g = c.game;
  if (g.recurDow == null || !g.recurTime) return { ok: false, error: "not a recurring game" };
  const now = new Date();
  // Target the same week the popup/RSVP flows call "next game" — skipping weeks
  // already off or kicked off — so "cancel this week" hits the game players are
  // actually preparing for, not a settled date.
  const date = await nextPlayableOccurrence(
    { id: gameId, isStanding: true, recurDow: g.recurDow, recurTime: g.recurTime, scheduledStart: String(g.scheduledStart) },
    now,
  );
  const kickoff = new Date(`${date}T${g.recurTime}`);
  // Only an upcoming game can be called off — never rewrite one that's kicked off.
  if (kickoff <= now) return { ok: false, error: "this week's game has already started" };
  const done = await db.insert(gameOccurrences)
    .values({
      gameId, occurrenceDate: date, status: "cancelled",
      kickoffAt: kickoff, pollOpensAt: kickoff, pollClosesAt: kickoff,
    })
    .onConflictDoUpdate({
      target: [gameOccurrences.gameId, gameOccurrences.occurrenceDate],
      set: { status: "cancelled" },
      // Never downgrade a finished occurrence (played/skipped) back to cancelled.
      setWhere: sql`${gameOccurrences.status} not in ('played', 'skipped', 'cancelled')`,
    })
    .returning({ id: gameOccurrences.id });
  // Empty → the conflicting row was already settled (played/skipped/cancelled).
  if (!done.length) return { ok: false, error: "this week is already settled" };
  revalidatePath("/play");
  revalidatePath("/my-games");
  return { ok: true };
}

/** A captain relinquishes the role (moving away, too much, …). Allowed even if
 *  they're the last captain — the site then shows the "volunteer" prompt to all. */
export async function stepDownAsCaptain(gameId: string): Promise<CaptainResult> {
  const c = await asCaptain(gameId);
  if (!c.ok) return c;
  const session = await auth();
  const uid = session!.user!.id!;
  await db.delete(areaCaptains)
    .where(and(eq(areaCaptains.areaId, c.game.areaId), eq(areaCaptains.userId, uid)));
  revalidatePath("/play");
  revalidatePath("/my-games");
  return { ok: true };
}

/** Any confirmed user can volunteer to captain a game's area — whether or not it
 *  already has captains. Idempotent (already a captain → no-op). */
export async function volunteerAsCaptain(gameId: string): Promise<CaptainResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "sign in first" };
  const uid = session.user.id;
  if (!(await isEmailVerified(uid))) return { ok: false, error: UNVERIFIED_MSG };
  const [g] = await db.select({ areaId: games.areaId }).from(games).where(eq(games.id, gameId)).limit(1);
  if (!g) return { ok: false, error: "game not found" };
  await db.insert(areaCaptains).values({ areaId: g.areaId, userId: uid }).onConflictDoNothing();
  revalidatePath("/play");
  revalidatePath("/my-games");
  return { ok: true };
}
