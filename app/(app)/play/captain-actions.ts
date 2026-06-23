"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { games, areaCaptains, gameOccurrences } from "@/lib/db/schema";
import { nextOccurrenceYMD } from "@/lib/datetime";

export type CaptainResult = { ok: true } | { ok: false; error: string };

/** A user may run captain controls on a game only if they're a captain of its
 *  area. Returns the game's recur info (for cancel-week) or an error. */
type Game = { areaId: string; recurDow: number | null; recurTime: string | null; scheduledStart: Date };

async function asCaptain(gameId: string): Promise<{ ok: false; error: string } | { ok: true; game: Game }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "sign in first" };
  const uid = session.user.id;
  const [g] = await db.select({
    areaId: games.areaId, recurDow: games.recurDow, recurTime: games.recurTime,
    scheduledStart: games.scheduledStart,
  }).from(games).where(eq(games.id, gameId)).limit(1);
  if (!g) return { ok: false, error: "game not found" };
  const [cap] = await db.select({ u: areaCaptains.userId }).from(areaCaptains)
    .where(and(eq(areaCaptains.areaId, g.areaId), eq(areaCaptains.userId, uid))).limit(1);
  if (!cap) return { ok: false, error: "only a captain can do that" };
  return { ok: true, game: g };
}

async function setSeriesStatus(gameId: string, status: "active" | "paused" | "retired"): Promise<CaptainResult> {
  const c = await asCaptain(gameId);
  if (!c.ok) return c;
  await db.update(games).set({ status }).where(eq(games.id, gameId));
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
  const date = nextOccurrenceYMD(
    { isStanding: true, recurDow: g.recurDow, scheduledStart: String(g.scheduledStart) }, new Date(),
  );
  const kickoff = new Date(`${date}T${g.recurTime}`);
  await db.insert(gameOccurrences)
    .values({
      gameId, occurrenceDate: date, status: "cancelled",
      kickoffAt: kickoff, pollOpensAt: kickoff, pollClosesAt: kickoff,
    })
    .onConflictDoUpdate({
      target: [gameOccurrences.gameId, gameOccurrences.occurrenceDate],
      set: { status: "cancelled" },
    });
  revalidatePath("/play");
  revalidatePath("/my-games");
  return { ok: true };
}
