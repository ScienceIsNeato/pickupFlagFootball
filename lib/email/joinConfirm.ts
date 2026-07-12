import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { gameOccurrences, notificationsSent } from "@/lib/db/schema";
import { flushNotificationEmails } from "./flush";
import type { NotifKind } from "./templates";

/** Decided-week status → the confirmation a fresh joiner gets. scheduled /
 *  awaiting_game reuse the "game on" email; skipped reuses "not this week". A
 *  cancelled or transient (tallying/notifying) / played week sends nothing. */
const DECIDED_KIND: Record<string, NotifKind | undefined> = {
  scheduled: "WEEK_ON",
  awaiting_game: "WEEK_ON",
  skipped: "WEEK_OFF",
};

/** The confirmation kind for a fresh joiner, given the current week's occurrence
 *  status (null = no occurrence yet) and whether they already got the POLL_ASK.
 *  Pure so the decision is unit-testable; sendJoinConfirmation supplies the DB. */
export function joinConfirmKind(status: string | null | undefined, alreadyAsked: boolean): NotifKind | undefined {
  if (!status) return "JOIN_UPCOMING"; // poll hasn't opened
  if (status === "polling") return alreadyAsked ? undefined : "JOIN_POLLING";
  return DECIDED_KIND[status]; // cancelled/tallying/notifying/played → undefined
}

/**
 * Confirm the current week to someone who just joined an established game.
 *
 * The weekly poll already counts mid-cycle joiners (the tally reads the live
 * roster, not a cycle-start snapshot), but a joiner who arrives *after* the
 * week's email already went out gets nothing — this fills that gap by sending
 * them the state that fits:
 *   scheduled/awaiting_game → WEEK_ON · skipped → WEEK_OFF · cancelled → nothing
 *   polling → JOIN_POLLING (unless they already got the POLL_ASK) · none → JOIN_UPCOMING
 *
 * Non-fatal: a failure here must never fail the join — the enqueued row is the
 * source of truth and the cron flush is the backstop if the inline send fails.
 * The caller fires this only on a *new* join, which keeps JOIN_UPCOMING (the one
 * kind with no occurrence to dedupe on) to once per join.
 */
export async function sendJoinConfirmation(
  gameId: string, userId: string, date: string, now: Date,
): Promise<void> {
  try {
    const [occ] = await db.select({ id: gameOccurrences.id, status: gameOccurrences.status })
      .from(gameOccurrences)
      .where(and(eq(gameOccurrences.gameId, gameId), eq(gameOccurrences.occurrenceDate, date)))
      .limit(1);

    // Mid-vote: if they already got the poll request (joined as it opened), that's
    // their invite — only the ones who missed it need the JOIN_POLLING note.
    let alreadyAsked = false;
    if (occ?.status === "polling") {
      const [asked] = await db.select({ id: notificationsSent.id }).from(notificationsSent)
        .where(and(
          eq(notificationsSent.userId, userId),
          eq(notificationsSent.occurrenceId, occ.id),
          eq(notificationsSent.kind, "POLL_ASK"),
        )).limit(1);
      alreadyAsked = !!asked;
    }
    const kind = joinConfirmKind(occ?.status, alreadyAsked);
    if (!kind) return;
    const occurrenceId = occ?.id ?? null;

    // Occurrence-keyed kinds (WEEK_ON/WEEK_OFF/JOIN_POLLING) dedupe against the
    // roster-wide enqueue via uq_notif_occurrence; JOIN_UPCOMING has no such
    // index but the new-join-only caller keeps it to one per join.
    await db.insert(notificationsSent).values({
      userId, occurrenceId, gameId, attemptId: null, kind, channel: "email", sentAt: now,
    }).onConflictDoNothing();

    await flushNotificationEmails(now);
  } catch (e) {
    console.error("[email] join confirmation failed (cron flush is the backstop)", {
      gameId, userId, error: e instanceof Error ? e.message : String(e),
    });
  }
}
