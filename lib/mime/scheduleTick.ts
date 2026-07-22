import { sql } from "drizzle-orm";
import type { EngineDb } from "./engine";
import { nextPollOpensAt } from "./occurrences";

/**
 * Event-driven tick scheduling. Instead of a frequent cron polling "anything to
 * do?" (which wakes the scale-to-zero database around the clock), the engine
 * computes WHEN its next time boundary falls and enqueues a one-shot Cloud Task
 * for exactly that moment. Zero games ⇒ zero wakes; cost tracks actual activity.
 *
 * A once-daily cron remains as the dead-man backstop: if an enqueue is ever
 * missed (deploy race, Tasks outage), the engine catches up within a day — every
 * FSM step is idempotent and processes anything past-due, so late is safe.
 */

/** The engine's next scheduled boundary: the tightest of open proposals'
 *  deadlines, open polls' closes, scheduled kickoffs, and each active standing
 *  game's next poll-open. May be PAST-due (e.g. a stalled attempt deadline) —
 *  callers treat that as "wake now". Null ⇒ nothing on the calendar. */
export async function computeNextTickAt(db: EngineDb, now: Date): Promise<Date | null> {
  // Stored boundaries, one round trip. active-series guard matches occurrences.ts:
  // a paused/retired series must not generate wakes.
  const res = await db.execute(sql`
    select min(t) as next from (
      select min(interest_closes_at) as t from formation_attempts where status = 'OPEN'
      union all
      select min(o.poll_closes_at) from game_occurrences o
        where o.status = 'polling'
          and exists (select 1 from games g where g.id = o.game_id and g.status = 'active')
      union all
      select min(o.kickoff_at) from game_occurrences o
        where o.status = 'awaiting_game'
          and exists (select 1 from games g where g.id = o.game_id and g.status = 'active')
    ) x`);
  const raw = (((res as { rows?: { next: string | Date | null }[] }).rows ?? [])[0]?.next) ?? null;
  let best: Date | null = raw ? new Date(raw) : null;

  // Derived boundary: the next poll-open per active standing game (no row exists
  // yet at that point, so it can't be read off a table). Same source query shape
  // as openDuePolls.
  const gres = await db.execute(sql`
    select g.id as game_id, g.recur_dow, g.recur_time, g.scheduled_start, a.timezone,
           extract(epoch from a.polling_start_offset) as offset_s
    from games g join areas a on a.id = g.area_id
    where g.is_standing = true and g.status = 'active'
      and g.recur_dow is not null and g.recur_time is not null`);
  const games = (((gres as { rows?: unknown[] }).rows ?? []) as Array<{
    game_id: string; recur_dow: number; recur_time: string;
    scheduled_start: string; timezone: string; offset_s: string;
  }>);
  for (const g of games) {
    const t = await nextPollOpensAt(db, { ...g, offset_s: Number(g.offset_s) }, now);
    if (t && (!best || t < best)) best = t;
  }
  return best;
}

/**
 * Arm the next wake: one-shot Cloud Task → POST /api/mime/tick (same Bearer auth
 * as the cron) at the next boundary. Fire-and-forget semantics — NEVER throws
 * into a caller: a user action must not fail because scheduling hiccuped, and
 * the daily backstop cron bounds the damage of any missed arm.
 *
 * No-ops (returns null) outside a configured environment: local dev and e2e set
 * none of the TASKS_* vars, so this is inert there — the same seam pattern as
 * the email transport. Returns the scheduled time when a task was armed.
 */
export async function scheduleNextTick(db: EngineDb): Promise<Date | null> {
  try {
    const project = process.env.TASKS_PROJECT;
    const location = process.env.TASKS_LOCATION;
    const queue = process.env.TASKS_QUEUE;
    const base = process.env.APP_BASE_URL;
    const secret = process.env.CRON_SECRET;
    if (!project || !location || !queue || !base || !secret) return null;

    const next = await computeNextTickAt(db, new Date());
    if (!next) return null; // empty calendar → sleep; the daily backstop still runs

    // Past-due boundary (we're racing the work itself) → wake almost immediately.
    const when = new Date(Math.max(next.getTime(), Date.now() + 5_000));
    const token = await gcpAccessToken();
    if (!token) return null; // off-GCP with TASKS_* set — misconfig, not fatal

    const parent = `projects/${project}/locations/${location}/queues/${queue}`;
    const createTask = (t: Date) =>
      fetch(`https://cloudtasks.googleapis.com/v2/${parent}/tasks`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          task: {
            // Minute-bucketed name: N concurrent callers arming the same boundary
            // create ONE task — duplicates get 409, which is the dedupe working.
            name: `${parent}/tasks/tick-${Math.floor(t.getTime() / 60_000)}`,
            scheduleTime: t.toISOString(),
            httpRequest: {
              httpMethod: "POST",
              url: `${base}/api/mime/tick`,
              headers: { Authorization: `Bearer ${secret}` },
            },
          },
        }),
        signal: AbortSignal.timeout(5_000),
      });

    let res = await createTask(when);
    if (res.status === 409) {
      // 409 is ambiguous: usually a concurrent caller just armed this minute
      // (fine — a task is pending), but a name is also tombstoned for ~1h after
      // its task COMPLETES, in which case nothing is pending and this arm would
      // be silently lost. One retry a minute later covers the tombstone case; a
      // spurious 60s-late duplicate wake is a harmless idempotent no-op.
      const bumped = new Date(when.getTime() + 60_000);
      res = await createTask(bumped);
      if (res.status === 409) return when; // both minutes taken ⇒ genuinely armed
      if (!res.ok) {
        console.error("[mime] scheduleNextTick retry enqueue failed", res.status, (await res.text()).slice(0, 200));
        return null;
      }
      return bumped;
    }
    if (!res.ok) {
      console.error("[mime] scheduleNextTick enqueue failed", res.status, (await res.text()).slice(0, 200));
      return null;
    }
    return when;
  } catch (e) {
    console.error("[mime] scheduleNextTick failed (daily cron is the backstop)",
      e instanceof Error ? e.message : String(e));
    return null;
  }
}

/** ADC access token from the Cloud Run metadata server; null anywhere else. */
async function gcpAccessToken(): Promise<string | null> {
  try {
    const r = await fetch(
      "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
      { headers: { "Metadata-Flavor": "Google" }, signal: AbortSignal.timeout(2_000) },
    );
    if (!r.ok) return null;
    return ((await r.json()) as { access_token?: string }).access_token ?? null;
  } catch {
    return null;
  }
}
