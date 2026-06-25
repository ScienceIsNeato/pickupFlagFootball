import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { notificationsSent, users, formationAttempts } from "@/lib/db/schema";
import { sendEmail, isEmailConfigured } from "./send";
import { buildNotificationEmail, type NotifKind } from "./templates";
import { donationFooterFor } from "./donationFooter";
import { rsvpLink } from "@/lib/rsvpLink";
import { declineLink } from "@/lib/declineLink";

// Only emails whose occurrence is still RSVP-able get the one-click links.
// WEEK_OFF is a skipped week (settled) — its links would be dead, so it gets none.
const RSVP_LINK_KINDS = new Set<NotifKind>(["POLL_ASK", "WEEK_ON"]);

// Formation courting asks carry a one-click "not interested in this site" link
// so a recipient can stop the emails for that area. GAME_ON / STALLED_NOTICE are
// one-off notices, not repeated courting, so they don't.
const DECLINE_LINK_KINDS = new Set<NotifKind>([
  "SPARK_ASK", "SUGGEST_NUDGE", "SUGGEST_LASTCALL",
  "OPTIONS_AVAILABLE", "AVAIL_NUDGE", "AVAIL_LASTCALL",
]);

const APP_BASE_URL = process.env.APP_BASE_URL ?? "https://pickupflagfootball.com";

/**
 * Send the backlog of claimed-but-unsent email notifications via Brevo. Runs
 * from the tick cron, OUTSIDE any DB transaction.
 *
 * Safety:
 *  - no API key → no-op (don't mark anything sent, so the backlog survives until
 *    email is configured).
 *  - each row is claimed atomically (set emailed_at WHERE emailed_at IS NULL,
 *    RETURNING) *before* sending — so overlapping ticks can't both grab it and a
 *    successful send can't be re-sent later. On send failure we clear the claim
 *    so it retries next tick.
 */
export async function flushNotificationEmails(now: Date, limit = 50): Promise<{ sent: number; skipped: number; failed: number }> {
  let sent = 0, skipped = 0, failed = 0;
  if (!isEmailConfigured()) return { sent, skipped, failed }; // no transport — leave the backlog intact

  const rows = await db.select({
    id: notificationsSent.id,
    kind: notificationsSent.kind,
    userId: notificationsSent.userId,
    occurrenceId: notificationsSent.occurrenceId,
    areaId: formationAttempts.areaId,
    email: users.email,
    displayName: users.displayName,
    emailOptIn: users.emailOptIn,
    donationStatus: users.donationStatus,
  }).from(notificationsSent)
    .innerJoin(users, eq(users.id, notificationsSent.userId))
    // Formation emails carry an attempt → its area, for the "not interested" link.
    .leftJoin(formationAttempts, eq(formationAttempts.id, notificationsSent.attemptId))
    .where(and(eq(notificationsSent.channel, "email"), isNull(notificationsSent.emailedAt)))
    .orderBy(notificationsSent.sentAt)
    .limit(limit);

  for (const r of rows) {
    // Claim atomically: only the worker whose UPDATE returns the row sends it.
    const claimed = await db.update(notificationsSent).set({ emailedAt: now })
      .where(and(eq(notificationsSent.id, r.id), isNull(notificationsSent.emailedAt)))
      .returning({ id: notificationsSent.id });
    if (!claimed.length) continue; // another worker already took it

    // Opted out / no address: stays claimed so it leaves the backlog, no send.
    if (!r.emailOptIn || !r.email) { skipped++; continue; }

    try {
      const footer = donationFooterFor({ donationStatus: r.donationStatus, emailOptIn: r.emailOptIn });
      // Weekly poll emails carry one-click RSVP links (signed, no login).
      const rsvp = RSVP_LINK_KINDS.has(r.kind as NotifKind) && r.occurrenceId
        ? {
            inUrl: rsvpLink(APP_BASE_URL, r.userId, r.occurrenceId, "in"),
            outUrl: rsvpLink(APP_BASE_URL, r.userId, r.occurrenceId, "out"),
          }
        : undefined;
      // Courting asks get a one-click "stop emails about this site" link.
      const declineUrl = DECLINE_LINK_KINDS.has(r.kind as NotifKind) && r.areaId
        ? declineLink(APP_BASE_URL, r.userId, r.areaId)
        : undefined;
      const mail = buildNotificationEmail(r.kind as NotifKind, { displayName: r.displayName, appBaseUrl: APP_BASE_URL, footer, rsvp, declineUrl });
      const delivered = await sendEmail({ to: r.email, toName: r.displayName, ...mail });
      if (delivered) {
        sent++;
      } else {
        // Transport declined without throwing (e.g. not actually configured) —
        // nothing was sent, so release the claim rather than lose the row.
        await db.update(notificationsSent).set({ emailedAt: null }).where(eq(notificationsSent.id, r.id));
        failed++;
      }
    } catch (e) {
      // Release the claim so it retries next tick (no duplicate, no permanent loss).
      await db.update(notificationsSent).set({ emailedAt: null }).where(eq(notificationsSent.id, r.id));
      console.error("[email] flush failed for notification", r.id, e);
      failed++;
    }
  }
  return { sent, skipped, failed };
}
