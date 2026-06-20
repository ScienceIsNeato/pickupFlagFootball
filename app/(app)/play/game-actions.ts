"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
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

/** Join a game's standing roster. Gated on the radius rule (your travel radius
 *  must reach the game's area) — the same rule the engine uses for catchment.
 *  Defaults you "in" for the next occurrence, since you joined to play. */
export async function joinGame(gameId: string): Promise<JoinResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "sign in first" };
  const me = session.user.id;

  const g = await reachableActiveGame(me, gameId);
  if (!g) return { ok: false, error: "this game is outside your travel area" };

  await db.insert(gameRoster).values({ gameId, userId: me }).onConflictDoNothing();
  const occ = nextOccurrenceYMD(g, new Date());
  await db.insert(gameAttendance)
    .values({ gameId, userId: me, occurrenceDate: occ, status: "in" })
    .onConflictDoUpdate({
      target: [gameAttendance.gameId, gameAttendance.userId, gameAttendance.occurrenceDate],
      set: { status: "in" },
    });
  await syncRosterCount(gameId);
  revalidatePath("/my-games");
  return { ok: true };
}

/** Leave a game entirely: off the roster and clear your RSVPs for it. */
export async function leaveGame(gameId: string): Promise<JoinResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "sign in first" };
  const me = session.user.id;

  await db.delete(gameAttendance).where(and(eq(gameAttendance.gameId, gameId), eq(gameAttendance.userId, me)));
  await db.delete(gameRoster).where(and(eq(gameRoster.gameId, gameId), eq(gameRoster.userId, me)));
  await syncRosterCount(gameId);
  revalidatePath("/my-games");
  return { ok: true };
}

/** RSVP in/out for the next occurrence. Requires roster membership (you join
 *  first, then choose week to week); does not re-check radius. */
export async function setWeeklyAttendance(gameId: string, status: "in" | "out"): Promise<JoinResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "sign in first" };
  const me = session.user.id;
  if (status !== "in" && status !== "out") return { ok: false, error: "bad status" };

  const [member] = await db.select({ g: gameRoster.gameId }).from(gameRoster)
    .where(and(eq(gameRoster.gameId, gameId), eq(gameRoster.userId, me))).limit(1);
  if (!member) return { ok: false, error: "join the game first" };

  const g = await activeGame(gameId);
  if (!g) return { ok: false, error: "game unavailable" };
  const occ = nextOccurrenceYMD(g, new Date());
  await db.insert(gameAttendance)
    .values({ gameId, userId: me, occurrenceDate: occ, status })
    .onConflictDoUpdate({
      target: [gameAttendance.gameId, gameAttendance.userId, gameAttendance.occurrenceDate],
      set: { status },
    });
  revalidatePath("/my-games");
  return { ok: true };
}
