import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { notificationsSent, users, formationAttempts, gameOccurrences, games, gameRoster } from "@/lib/db/schema";
import { sendEmail, isEmailConfigured } from "./send";
import { buildNotificationEmail, type NotifKind } from "./templates";
import { donationFooterFor } from "./donationFooter";
import { rsvpLink } from "@/lib/rsvpLink";
import { interestLink } from "@/lib/interestLink";

// Weekly poll emails carry one-click RSVP links. WEEK_OFF is settled (no links).
const RSVP_LINK_KINDS = new Set<NotifKind>(["POLL_ASK", "WEEK_ON"]);
// Weekly emails that show the game's spot + time (a "game's off" email doesn't —
// there's no game to detail).
const OCCURRENCE_KINDS = new Set<NotifKind>(["POLL_ASK", "WEEK_ON"]);
// The donation block lives ONLY on the weekly "game on" email — an ask for
// never-decided players, a thank-you for supporters. Every other email (the
// proposal ask, the formation "you're in", the poll request, and the bad-news
// emails) stays clean.
const DONATION_BLOCK_KIND: NotifKind = "WEEK_ON";

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

/** Human "when" for a weekly occurrence: its date + kickoff time. */
function whenOccurrence(date: string, kickoff: Date): string {
  const d = new Date(`${date}T00:00:00`);
  const k = new Date(kickoff);
  const time = `${((k.getHours() + 11) % 12) + 1}:${String(k.getMinutes()).padStart(2, "0")} ${k.getHours() < 12 ? "am" : "pm"}`;
  return `${d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })} at ${time}`;
}

/** The players who are effectively "in" for an occurrence, by display name —
 *  same rule as the tally (override ?? site default), for the "game on" roster. */
async function occurrenceRoster(gameId: string, date: string): Promise<{ count: number; names: string[] }> {
  const res = await db.execute(sql`
    select coalesce(u.display_name, 'someone') as name from (
      select r.user_id from game_roster r
        left join game_attendance a on a.game_id = r.game_id and a.user_id = r.user_id and a.occurrence_date = ${date}::date
        where r.game_id = ${gameId} and coalesce(a.status, r.default_status) = 'in'
      union
      select a.user_id from game_attendance a
        where a.game_id = ${gameId} and a.occurrence_date = ${date}::date and a.status = 'in'
          and not exists (select 1 from game_roster r where r.game_id = a.game_id and r.user_id = a.user_id)
    ) eff join users u on u.id = eff.user_id order by u.display_name`);
  const names = ((res as unknown as { rows?: { name: string }[] }).rows ?? []).map((r) => r.name);
  return { count: names.length, names };
}

/** The founding roster of a game, by display name — for the "you're in" email
 *  sent the moment a game forms, when no occurrence exists yet to tally. */
async function gameRosterNames(gameId: string): Promise<{ count: number; names: string[] }> {
  const rows = await db.select({ name: users.displayName })
    .from(gameRoster).innerJoin(users, eq(users.id, gameRoster.userId))
    .where(eq(gameRoster.gameId, gameId)).orderBy(users.displayName);
  const names = rows.map((r) => r.name ?? "someone");
  return { count: names.length, names };
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
    gameId: notificationsSent.gameId,
    placeText: formationAttempts.placeText,
    proposedStart: formationAttempts.proposedStart,
    recurDow: formationAttempts.recurDow,
    recurTime: formationAttempts.recurTime,
    occDate: gameOccurrences.occurrenceDate,
    kickoffAt: gameOccurrences.kickoffAt,
    gamePlace: games.placeText,
    email: users.email,
    displayName: users.displayName,
    emailOptIn: users.emailOptIn,
    donationStatus: users.donationStatus,
  }).from(notificationsSent)
    .innerJoin(users, eq(users.id, notificationsSent.userId))
    // GAME_PROPOSED carries an attempt → its proposal details + interest links.
    .leftJoin(formationAttempts, eq(formationAttempts.id, notificationsSent.attemptId))
    // Weekly emails carry an occurrence + game → the date/time/location + roster.
    .leftJoin(gameOccurrences, eq(gameOccurrences.id, notificationsSent.occurrenceId))
    .leftJoin(games, eq(games.id, notificationsSent.gameId))
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
      const kind = r.kind as NotifKind;
      // Donation block only on the weekly "game on" email (ask vs thank-you by status).
      const footer = kind === DONATION_BLOCK_KIND ? donationFooterFor({ donationStatus: r.donationStatus, emailOptIn: r.emailOptIn }) : null;
      // Weekly poll emails → RSVP links; proposal emails → Interested/Not-Interested.
      const buttons = RSVP_LINK_KINDS.has(kind) && r.occurrenceId
        ? { inUrl: rsvpLink(APP_BASE_URL, r.userId, r.occurrenceId, "in"), outUrl: rsvpLink(APP_BASE_URL, r.userId, r.occurrenceId, "out") }
        : kind === "GAME_PROPOSED" && r.attemptId
        ? { inUrl: interestLink(APP_BASE_URL, r.userId, r.attemptId, "in"), outUrl: interestLink(APP_BASE_URL, r.userId, r.attemptId, "out") }
        : undefined;
      // Spot + time: GAME_PROPOSED / GAME_ON from the attempt (the formed game
      // inherits its venue + slot); weekly emails from the occurrence.
      const details = (kind === "GAME_PROPOSED" || kind === "GAME_ON") && r.placeText && r.proposedStart
        ? { place: r.placeText, when: whenText(r.proposedStart, r.recurDow, r.recurTime) }
        : OCCURRENCE_KINDS.has(kind) && r.gamePlace && r.occDate && r.kickoffAt
        ? { place: r.gamePlace, when: whenOccurrence(r.occDate, r.kickoffAt) }
        : undefined;
      // Who's in: GAME_ON lists the founding roster; WEEK_ON lists this week's ins.
      const roster = kind === "GAME_ON" && r.gameId
        ? await gameRosterNames(r.gameId)
        : kind === "WEEK_ON" && r.gameId && r.occDate
        ? await occurrenceRoster(r.gameId, r.occDate)
        : undefined;
      const mail = buildNotificationEmail(kind, { displayName: r.displayName, appBaseUrl: APP_BASE_URL, footer, buttons, details, roster });
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
