"use server";

import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { games, gameOccurrences, gameAttendance, gameRoster } from "@/lib/db/schema";
import { verifyRsvpToken } from "@/lib/rsvpLink";

/**
 * Apply a one-click RSVP. Runs on POST only (the email link lands on a GET
 * confirmation page first) so link scanners / prefetchers can't flip attendance.
 */
export async function applyRsvp(formData: FormData) {
  const t = String(formData.get("t") ?? "");
  const parsed = verifyRsvpToken(t);
  if (!parsed) redirect("/rsvp?done=invalid");

  const [occ] = await db.select({
    gameId: gameOccurrences.gameId, date: gameOccurrences.occurrenceDate, kickoffAt: gameOccurrences.kickoffAt,
    occStatus: gameOccurrences.status, seriesStatus: games.status,
  }).from(gameOccurrences)
    .innerJoin(games, eq(games.id, gameOccurrences.gameId))
    .where(eq(gameOccurrences.id, parsed.occurrenceId)).limit(1);
  if (!occ) redirect("/rsvp?done=invalid");
  // No RSVP to a week that's been called off (cancelled), already settled
  // (played/skipped), whose series is paused/retired, or once kickoff has passed.
  if (occ.occStatus === "cancelled") redirect("/rsvp?done=cancelled");
  if (occ.occStatus === "played" || occ.occStatus === "skipped" || occ.seriesStatus !== "active"
      || occ.kickoffAt <= new Date()) {
    redirect("/rsvp?done=closed");
  }

  // A token outlives roster membership — a member who left (setRosterMembership
  // false) shouldn't be able to confirm an old email link and re-count as "in".
  const [onRoster] = await db.select({ g: gameRoster.gameId }).from(gameRoster)
    .where(and(eq(gameRoster.gameId, occ.gameId), eq(gameRoster.userId, parsed.userId))).limit(1);
  if (!onRoster) redirect("/rsvp?done=closed");

  await db.insert(gameAttendance)
    .values({ gameId: occ.gameId, userId: parsed.userId, occurrenceDate: occ.date, status: parsed.action })
    .onConflictDoUpdate({
      target: [gameAttendance.gameId, gameAttendance.userId, gameAttendance.occurrenceDate],
      set: { status: parsed.action },
    });
  redirect(`/rsvp?done=${parsed.action}`);
}
