import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { notificationsSent, users, formationAttempts } from "@/lib/db/schema";
import { sendEmail, isEmailConfigured } from "./send";
import { buildNotificationEmail, type NotifKind } from "./templates";
import { donationFooterFor } from "./donationFooter";
import { rsvpLink } from "@/lib/rsvpLink";
import { interestLink } from "@/lib/interestLink";

// Weekly poll emails carry one-click RSVP links. WEEK_OFF is settled (no links).
const RSVP_LINK_KINDS = new Set<NotifKind>(["POLL_ASK", "WEEK_ON"]);

const APP_BASE_URL = process.env.APP_BASE_URL ?? "https://pickupflagfootball.com";

const DOW = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
/** Human "when" for a proposal: recurring slot + first-game date, or a one-off. */
function whenText(start: Date, recurDow: number | null, recurTime: string | null): string {
  const d = new Date(start);
  let h: number, m: number;
  if (recurTime) { const [hh, mm] = recurTime.split(":").map(Number); h = hh; m = mm; }
  else { h = d.getHours(); m = d.getMinutes(); }
  const time = `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
  const date = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return recurDow != null && recurDow >= 0 && recurDow < 7
    ? `${DOW[recurDow]} at ${time} · first game ${date}`
    : `${date} at ${time}`;
}

/**
 * Send the backlog of claimed-but-unsent email notifications. Runs from the tick
 * cron, OUTSIDE any DB transaction. Each row is claimed atomically before send,
 * so overlapping ticks can't double-send; a send failure releases the claim.
 */
export async function flushNotificationEmails(now: Date, limit = 50): Promise<{ sent: number; skipped: number; failed: number }> {
  let sent = 0, skipped = 0, failed = 0;
  if (!isEmailConfigured()) return { sent, skipped, failed }; // no transport — leave the backlog intact

  const rows = await db.select({
    id: notificationsSent.id,
    kind: notificationsSent.kind,
    userId: notificationsSent.userId,
    occurrenceId: notificationsSent.occurrenceId,
    attemptId: notificationsSent.attemptId,
    placeText: formationAttempts.placeText,
    proposedStart: formationAttempts.proposedStart,
    recurDow: formationAttempts.recurDow,
    recurTime: formationAttempts.recurTime,
    email: users.email,
    displayName: users.displayName,
    emailOptIn: users.emailOptIn,
    donationStatus: users.donationStatus,
  }).from(notificationsSent)
    .innerJoin(users, eq(users.id, notificationsSent.userId))
    // GAME_PROPOSED carries an attempt → its proposal details + interest links.
    .leftJoin(formationAttempts, eq(formationAttempts.id, notificationsSent.attemptId))
    .where(and(eq(notificationsSent.channel, "email"), isNull(notificationsSent.emailedAt)))
    .orderBy(notificationsSent.sentAt)
    .limit(limit);

  for (const r of rows) {
    const claimed = await db.update(notificationsSent).set({ emailedAt: now })
      .where(and(eq(notificationsSent.id, r.id), isNull(notificationsSent.emailedAt)))
      .returning({ id: notificationsSent.id });
    if (!claimed.length) continue; // another worker already took it

    if (!r.emailOptIn || !r.email) { skipped++; continue; }

    try {
      const footer = donationFooterFor({ donationStatus: r.donationStatus, emailOptIn: r.emailOptIn });
      const kind = r.kind as NotifKind;
      // Weekly poll emails → RSVP links; proposal emails → Interested/Not-Interested.
      const buttons = RSVP_LINK_KINDS.has(kind) && r.occurrenceId
        ? { inUrl: rsvpLink(APP_BASE_URL, r.userId, r.occurrenceId, "in"), outUrl: rsvpLink(APP_BASE_URL, r.userId, r.occurrenceId, "out") }
        : kind === "GAME_PROPOSED" && r.attemptId
        ? { inUrl: interestLink(APP_BASE_URL, r.userId, r.attemptId, "in"), outUrl: interestLink(APP_BASE_URL, r.userId, r.attemptId, "out") }
        : undefined;
      const details = kind === "GAME_PROPOSED" && r.placeText && r.proposedStart
        ? { place: r.placeText, when: whenText(r.proposedStart, r.recurDow, r.recurTime) }
        : undefined;
      const mail = buildNotificationEmail(kind, { displayName: r.displayName, appBaseUrl: APP_BASE_URL, footer, buttons, details });
      const delivered = await sendEmail({ to: r.email, toName: r.displayName, ...mail });
      if (delivered) {
        sent++;
      } else {
        await db.update(notificationsSent).set({ emailedAt: null }).where(eq(notificationsSent.id, r.id));
        failed++;
      }
    } catch (e) {
      await db.update(notificationsSent).set({ emailedAt: null }).where(eq(notificationsSent.id, r.id));
      console.error("[email] flush failed for notification", r.id, e);
      failed++;
    }
  }
  return { sent, skipped, failed };
}
