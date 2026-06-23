"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { games, areaCaptains, gameOccurrences } from "@/lib/db/schema";
import { nextPlayableOccurrence } from "@/lib/db/gameMembership";

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

async function setSeriesStatus(gameId: string, status: SeriesStatus): Promise<CaptainResult> {
  const c = await asCaptain(gameId);
  if (!c.ok) return c;
  if (c.game.status === status) return { ok: true }; // idempotent no-op
  if (!ALLOWED[c.game.status].includes(status)) {
    return { ok: false, error: `can't move a ${c.game.status} series to ${status}` };
  }
  const done = await db.update(games).set({ status })
    .where(and(eq(games.id, gameId), eq(games.status, c.game.status)))
    .returning({ id: games.id });
  // Lost a race (status changed between read and write) → report it, don't fake success.
  if (!done.length) return { ok: false, error: "the series state just changed — try again" };
  // Pausing/retiring calls off any in-flight week so the occurrence engine (which
  // only advances active series) never leaves it stuck mid-cycle.
  if (status === "paused" || status === "retired") {
    await db.update(gameOccurrences).set({ status: "cancelled", updatedAt: new Date() })
      .where(and(
        eq(gameOccurrences.gameId, gameId),
        inArray(gameOccurrences.status, ["pending", "polling", "tallying", "scheduled", "notifying", "awaiting_game"]),
      ));
  }
  revalidatePath("/play");
  revalidatePath("/my-games");
  return { ok: true };
}

/** Captain pauses the standing game (no occurrences will be polled while paused). */
export async function pauseSeries(gameId: string) { return setSeriesStatus(gameId, "paused"); }
/** Captain resumes a paused series. */
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
