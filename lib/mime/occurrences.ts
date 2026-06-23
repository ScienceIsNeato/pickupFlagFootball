import { and, eq, lte, isNull, inArray, sql } from "drizzle-orm";
import { games, gameOccurrences, gameRoster, notificationsSent } from "@/lib/db/schema";
import { nextOccurrenceYMD } from "@/lib/datetime";
import type { EngineDb } from "./engine";

type OccNotifKind = "POLL_ASK" | "WEEK_ON" | "WEEK_OFF";

/**
 * Drive the weekly occurrence poll cycle (see docs/state-machines.md). Called
 * from the mime tick after the formation sweeps. Each step is idempotent and
 * claim-gated, so overlapping ticks can't double-act:
 *   open polls → tally closed polls → notify decided → mark played.
 */
// Only advance occurrences whose series is still active — a paused/retired series
// must not keep tallying, notifying, or completing weeks.
const activeSeries = sql`exists (select 1 from games g where g.id = ${gameOccurrences.gameId} and g.status = 'active')`;

export async function runOccurrences(db: EngineDb, now: Date): Promise<void> {
  let firstErr: unknown;
  const guard = async (fn: () => Promise<void>) => {
    try { await fn(); } catch (e) { firstErr ??= e; }
  };
  await guard(() => openDuePolls(db, now));
  await guard(() => tallyClosedPolls(db, now));
  await guard(() => notifyDecided(db, now));
  await guard(() => markPlayed(db, now));
  if (firstErr) throw firstErr;
}

/** kickoff datetime = the occurrence date at the recurring time of day. */
function kickoffAt(date: string, recurTime: string): Date {
  return new Date(`${date}T${recurTime}`);
}

/** The next recurrence the poll opener should target: skip weeks already settled
 *  off (cancelled/skipped/played) or kicked off, so a called-off imminent week
 *  doesn't block opening the poll for the next playable one. Uses the engine db
 *  (not gameMembership's module db) so it works against the test world too. */
async function nextOpenableDate(
  db: EngineDb, game: { game_id: string; recur_dow: number; recur_time: string; scheduled_start: string }, now: Date,
): Promise<string | null> {
  const occ = { isStanding: true, recurDow: game.recur_dow, scheduledStart: game.scheduled_start };
  let date = nextOccurrenceYMD(occ, now);
  for (let guard = 0; guard < 26; guard++) {
    const settledOff = (await db.select({ s: gameOccurrences.status }).from(gameOccurrences)
      .where(and(eq(gameOccurrences.gameId, game.game_id), eq(gameOccurrences.occurrenceDate, date)))
      .limit(1))[0];
    const off = settledOff && ["cancelled", "skipped", "played"].includes(settledOff.s);
    if (!off && now < kickoffAt(date, game.recur_time)) return date; // playable + not started
    const after = new Date(`${date}T12:00:00`);
    after.setDate(after.getDate() + 1);
    const nextDate = nextOccurrenceYMD(occ, after);
    if (nextDate === date) return null; // one-off / no further recurrence
    date = nextDate;
  }
  return null;
}

// ── 1. open polls ────────────────────────────────────────────────────────────
/** For each active standing game whose next occurrence's poll window has opened,
 *  lazily create the occurrence row (status=polling) and email the roster the
 *  RSVP request. "pending" is implicit — a row only exists once polling starts. */
async function openDuePolls(db: EngineDb, now: Date): Promise<void> {
  const res = await db.execute(sql`
    select g.id as game_id, g.recur_dow, g.recur_time, g.scheduled_start,
           extract(epoch from a.polling_start_offset) as offset_s,
           extract(epoch from a.polling_window_length) as window_s
    from games g join areas a on a.id = g.area_id
    where g.is_standing = true and g.status = 'active'
  `);
  const rows = (((res as { rows?: unknown[] }).rows ?? []) as Array<{
    game_id: string; recur_dow: number | null; recur_time: string | null;
    scheduled_start: string; offset_s: string; window_s: string;
  }>);

  for (const g of rows) {
    if (g.recur_dow == null || !g.recur_time) continue;
    // Target the next week that's actually openable — past any called-off /
    // skipped / already-started weeks — so a cancelled imminent week doesn't pin
    // the opener to a dead date and starve a later week whose window is due.
    const date = await nextOpenableDate(
      db, { game_id: g.game_id, recur_dow: g.recur_dow, recur_time: g.recur_time, scheduled_start: g.scheduled_start }, now,
    );
    if (!date) continue;
    const kickoff = kickoffAt(date, g.recur_time);
    const pollOpens = new Date(kickoff.getTime() - Number(g.offset_s) * 1000);
    const pollCloses = new Date(pollOpens.getTime() + Number(g.window_s) * 1000);
    if (now < pollOpens || now >= kickoff) continue; // not time yet / already kicked off
    // Still inside the window? If a tick was missed (cron outage) we still create
    // the row so tally can decide it — but only email the RSVP request while the
    // poll is genuinely open.
    const pollOpen = now < pollCloses;

    await db.transaction(async (txx) => {
      const tx = txx as unknown as EngineDb;
      const inserted = await tx.insert(gameOccurrences).values({
        gameId: g.game_id, occurrenceDate: date, status: "polling",
        kickoffAt: kickoff, pollOpensAt: pollOpens, pollClosesAt: pollCloses,
      }).onConflictDoNothing().returning({ id: gameOccurrences.id });
      if (!inserted.length) return; // a prior tick already opened this poll
      if (pollOpen) await enqueueOccurrence(tx, g.game_id, inserted[0].id, "POLL_ASK", now);
    });
  }
}

// ── 2. tally closed polls ────────────────────────────────────────────────────
/** Poll window closed: count the "in" RSVPs and decide scheduled vs skipped. */
async function tallyClosedPolls(db: EngineDb, now: Date): Promise<void> {
  const due = await db.select().from(gameOccurrences)
    .where(and(eq(gameOccurrences.status, "polling"), lte(gameOccurrences.pollClosesAt, now), activeSeries));
  for (const occ of due) {
    await db.transaction(async (txx) => {
      const tx = txx as unknown as EngineDb;
      // Claim: only the tick that flips polling→tallying proceeds to decide.
      const claimed = await tx.update(gameOccurrences)
        .set({ status: "tallying", updatedAt: now })
        .where(and(eq(gameOccurrences.id, occ.id), eq(gameOccurrences.status, "polling")))
        .returning({ id: gameOccurrences.id });
      if (!claimed.length) return;
      const inCount = await countIn(tx, occ.gameId, occ.occurrenceDate);
      const min = await minPlayers(tx, occ.gameId);
      await tx.update(gameOccurrences)
        .set({ status: inCount >= min ? "scheduled" : "skipped", inCount, updatedAt: now })
        .where(eq(gameOccurrences.id, occ.id));
    });
  }
}

// ── 3. notify decided ────────────────────────────────────────────────────────
/** Both scheduled and skipped send the status email. Scheduled then awaits
 *  kickoff; skipped is done for the week (next week is a fresh occurrence). */
async function notifyDecided(db: EngineDb, now: Date): Promise<void> {
  const due = await db.select().from(gameOccurrences)
    .where(and(inArray(gameOccurrences.status, ["scheduled", "skipped"]), isNull(gameOccurrences.notifiedAt), activeSeries));
  for (const occ of due) {
    await db.transaction(async (txx) => {
      const tx = txx as unknown as EngineDb;
      const next = occ.status === "scheduled" ? "awaiting_game" : "skipped";
      // Claim on (status, notified_at) so a concurrent captain cancel (which flips
      // status) isn't clobbered, and the email is enqueued exactly once.
      const claimed = await tx.update(gameOccurrences)
        .set({ status: next, notifiedAt: now, updatedAt: now })
        .where(and(
          eq(gameOccurrences.id, occ.id),
          eq(gameOccurrences.status, occ.status),
          isNull(gameOccurrences.notifiedAt),
        ))
        .returning({ id: gameOccurrences.id });
      if (!claimed.length) return;
      await enqueueOccurrence(tx, occ.gameId, occ.id, occ.status === "scheduled" ? "WEEK_ON" : "WEEK_OFF", now);
    });
  }
}

// ── 4. mark played ───────────────────────────────────────────────────────────
/** A scheduled occurrence becomes played once kickoff passes. */
async function markPlayed(db: EngineDb, now: Date): Promise<void> {
  await db.update(gameOccurrences).set({ status: "played", updatedAt: now })
    .where(and(eq(gameOccurrences.status, "awaiting_game"), lte(gameOccurrences.kickoffAt, now), activeSeries));
}

// ── helpers ──────────────────────────────────────────────────────────────────
/** Effective "in" headcount for an occurrence: roster members whose explicit
 *  RSVP (or site default) is "in", plus drop-ins who said "in" without a roster
 *  row. Mirrors lib/db/gameMembership. */
async function countIn(db: EngineDb, gameId: string, date: string): Promise<number> {
  const res = await db.execute(sql`
    select count(*)::int as c from (
      select r.user_id from game_roster r
        left join game_attendance a
          on a.game_id = r.game_id and a.user_id = r.user_id and a.occurrence_date = ${date}::date
        where r.game_id = ${gameId} and coalesce(a.status, r.default_status) = 'in'
      union
      select a.user_id from game_attendance a
        where a.game_id = ${gameId} and a.occurrence_date = ${date}::date and a.status = 'in'
          and not exists (select 1 from game_roster r where r.game_id = a.game_id and r.user_id = a.user_id)
    ) eff`);
  return Number(((res as { rows?: { c: number }[] }).rows ?? [])[0]?.c ?? 0);
}

async function minPlayers(db: EngineDb, gameId: string): Promise<number> {
  const res = await db.execute(sql`
    select a.min_players_to_schedule as m
    from games g join areas a on a.id = g.area_id where g.id = ${gameId} limit 1`);
  return Number(((res as { rows?: { m: number }[] }).rows ?? [])[0]?.m ?? 6);
}

/** Claim-before-send ledger write for every roster member, keyed to the
 *  occurrence (attempt_id null). Exactly-once via the partial unique index. */
async function enqueueOccurrence(
  db: EngineDb, gameId: string, occurrenceId: string, kind: OccNotifKind, now: Date,
): Promise<void> {
  const roster = await db.select({ userId: gameRoster.userId })
    .from(gameRoster).where(eq(gameRoster.gameId, gameId));
  if (!roster.length) return;
  await db.insert(notificationsSent).values(roster.map((r) => ({
    userId: r.userId, occurrenceId, gameId, attemptId: null,
    kind, channel: "email" as const, sentAt: now,
  }))).onConflictDoNothing();
}
