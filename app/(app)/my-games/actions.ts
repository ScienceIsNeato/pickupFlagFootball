"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { gameRoster, gameAttendance, games, gameOccurrences } from "@/lib/db/schema";
import { reachableActiveGame } from "@/lib/db/gameMembership";
import { isEmailVerified, UNVERIFIED_MSG } from "@/lib/auth/verified";
import { occurrenceDatesInRange } from "@/lib/datetime";

/**
 * Toggle whether I'm "in" for a game.
 *
 * Honest caveat: per-WEEK attendance for a standing game doesn't have its own
 * table yet, so for now this mutates the binary roster: "in" = on the roster
 * (I'm playing), "out" = off it. When we add `weekly_rsvps` we'll keep this
 * action's signature and route it to that table instead.
 */
export async function setAttendance(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) redirect("/?signin=1&next=/my-games");
  const me = session.user.id;

  const gameId = String(formData.get("gameId") ?? "");
  const status = String(formData.get("status") ?? ""); // "in" | "out"
  if (!gameId || (status !== "in" && status !== "out")) throw new Error("bad params");

  if (status === "in") {
    // Joining requires a confirmed email + the radius rule (active game within my
    // travel radius). The gameId param alone isn't trust-bearing.
    if (!(await isEmailVerified(me))) throw new Error(UNVERIFIED_MSG);
    if (!(await reachableActiveGame(me, gameId))) throw new Error("not eligible for this game");
    await db.insert(gameRoster).values({ gameId, userId: me }).onConflictDoNothing();
    await db.update(games).set({ confirmedCount: sql`(select count(*) from game_roster where game_id = ${gameId})` })
      .where(eq(games.id, gameId));
  } else {
    // Drop is a self-edit (scoped to userId: me), no extra authorization needed.
    await db.delete(gameRoster).where(and(eq(gameRoster.gameId, gameId), eq(gameRoster.userId, me)));
    await db.update(games).set({ confirmedCount: sql`(select count(*) from game_roster where game_id = ${gameId})` })
      .where(eq(games.id, gameId));
  }

  revalidatePath("/my-games");
}

/** Override my RSVP for one upcoming occurrence (a specific date), departing from
 *  the site default. Requires roster membership. */
export async function setOccurrenceRsvp(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) redirect("/?signin=1&next=/my-games");
  const me = session.user.id;

  const gameId = String(formData.get("gameId") ?? "");
  const date = String(formData.get("date") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!gameId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || (status !== "in" && status !== "out")) throw new Error("bad params");

  // Must be on the roster AND the date must be a real upcoming occurrence of
  // this game — otherwise a crafted POST could write arbitrary past/off-schedule
  // dates into the attendance/history record.
  const [game] = await db.select({
    isStanding: games.isStanding, recurDow: games.recurDow,
    scheduledStart: games.scheduledStart, status: games.status,
  }).from(games)
    .innerJoin(gameRoster, and(eq(gameRoster.gameId, games.id), eq(gameRoster.userId, me)))
    .where(eq(games.id, gameId)).limit(1);
  if (!game || game.status !== "active") throw new Error("not on this roster");

  const now = new Date();
  const validDates = occurrenceDatesInRange(
    { isStanding: game.isStanding, recurDow: game.recurDow, scheduledStart: String(game.scheduledStart) },
    now, new Date(now.getTime() + 42 * 86_400_000),
  );
  if (!validDates.includes(date)) throw new Error("bad occurrence date");

  // Can't RSVP to a week the captain called off.
  const [occ] = await db.select({ status: gameOccurrences.status }).from(gameOccurrences)
    .where(and(eq(gameOccurrences.gameId, gameId), eq(gameOccurrences.occurrenceDate, date))).limit(1);
  if (occ?.status === "cancelled") throw new Error("this week was called off");

  await db.insert(gameAttendance)
    .values({ gameId, userId: me, occurrenceDate: date, status })
    .onConflictDoUpdate({
      target: [gameAttendance.gameId, gameAttendance.userId, gameAttendance.occurrenceDate],
      set: { status },
    });
  revalidatePath("/my-games");
}

/** Set my per-site default ("usually come" = in / "usually won't" = out). */
export async function setSiteDefault(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) redirect("/?signin=1&next=/my-games");
  const me = session.user.id;

  const gameId = String(formData.get("gameId") ?? "");
  const value = String(formData.get("default") ?? "");
  if (!gameId || (value !== "in" && value !== "out")) throw new Error("bad params");

  await db.update(gameRoster).set({ defaultStatus: value })
    .where(and(eq(gameRoster.gameId, gameId), eq(gameRoster.userId, me)));
  revalidatePath("/my-games");
}
