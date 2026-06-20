import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { notificationsSent, users } from "@/lib/db/schema";
import { sendBrevoEmail } from "./brevo";
import { buildNotificationEmail, type NotifKind } from "./templates";
import { donationFooterFor } from "./donationFooter";

const APP_BASE_URL = process.env.APP_BASE_URL ?? "https://pickupflagfootball.com";

/**
 * Send the backlog of claimed-but-unsent email notifications via Brevo, stamping
 * emailed_at on success. The notifications_sent row is the exactly-once claim;
 * this runs OUTSIDE any DB transaction (it makes network calls) and is safe to
 * re-run — a row stays unsent (and retries next tick) until Brevo accepts it.
 * Called from the tick cron. Bounded per run so one tick can't fan out forever.
 */
export async function flushNotificationEmails(now: Date, limit = 50): Promise<{ sent: number; skipped: number; failed: number }> {
  const rows = await db.select({
    id: notificationsSent.id,
    kind: notificationsSent.kind,
    email: users.email,
    displayName: users.displayName,
    emailOptIn: users.emailOptIn,
    donationStatus: users.donationStatus,
  }).from(notificationsSent)
    .innerJoin(users, eq(users.id, notificationsSent.userId))
    .where(and(eq(notificationsSent.channel, "email"), isNull(notificationsSent.emailedAt)))
    .orderBy(notificationsSent.sentAt)
    .limit(limit);

  let sent = 0, skipped = 0, failed = 0;
  for (const r of rows) {
    try {
      // Opted out or no address: mark handled so it leaves the backlog (the
      // donation footer is independently suppressed too).
      if (!r.emailOptIn || !r.email) {
        await db.update(notificationsSent).set({ emailedAt: now }).where(eq(notificationsSent.id, r.id));
        skipped++;
        continue;
      }
      const footer = donationFooterFor({ donationStatus: r.donationStatus, emailOptIn: r.emailOptIn });
      const mail = buildNotificationEmail(r.kind as NotifKind, { displayName: r.displayName, appBaseUrl: APP_BASE_URL, footer });
      await sendBrevoEmail({ to: r.email, toName: r.displayName, ...mail });
      await db.update(notificationsSent).set({ emailedAt: now }).where(eq(notificationsSent.id, r.id));
      sent++;
    } catch (e) {
      // Leave emailed_at NULL → retried next tick. One bad row never blocks the rest.
      console.error("[email] flush failed for notification", r.id, e);
      failed++;
    }
  }
  return { sent, skipped, failed };
}
