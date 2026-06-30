import { and, eq, lte, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import * as schema from "@/lib/db/schema";
import {
  areas, interestSignals, formationAttempts, attemptInterest,
  games, gameRoster, notificationsSent, users,
} from "@/lib/db/schema";
import { gameColor } from "@/lib/brand";
import { resolveTunables } from "./tunables";

/** The engine takes its db client by injection so the identical code runs on
 *  neon-http in prod and pglite in the sim. */
export type EngineDb = PgDatabase<never, typeof schema>;

type NotifKind = "GAME_PROPOSED" | "GAME_ON" | "STALLED_NOTICE";

/** Effective tunables = activity_types row values layered with per-area overrides.
 *  Only p_min still drives the (now single-window) formation; the rest are loaded
 *  for the occurrence engine / future use. */
export async function loadTunables(db: EngineDb, activityTypeId: string, area?: { pMinOverride: number | null }) {
  const res = await db.execute(sql`
    select p_min, s_min,
      extract(epoch from suggest_window) / 3600 as suggest_h
    from activity_types where id = ${activityTypeId} limit 1`);
  const r = ((res as { rows?: Record<string, unknown>[] }).rows ?? [])[0];
  const num = (v: unknown) => (v == null ? undefined : Number(v));
  const base = r ? { pMin: num(r.p_min), sMin: num(r.s_min), suggestWindowH: num(r.suggest_h) } : {};
  const overrides = area?.pMinOverride != null ? { pMin: area.pMinOverride } : {};
  return resolveTunables(base, overrides);
}

// ── tick: time-based entry point (cron) ──────────────────────────────────────
/** Resolve every proposal whose interest window has closed: enough people in →
 *  schedule the game; short of the threshold → fail the attempt. Idempotent —
 *  only acts on OPEN rows whose close time has passed, and the status flip is the
 *  claim so a concurrent tick can't double-process. */
export async function tick(db: EngineDb, now: Date): Promise<void> {
  let firstErr: unknown;
  const due = await db.select().from(formationAttempts)
    .where(and(eq(formationAttempts.status, "OPEN"), lte(formationAttempts.interestClosesAt, now)));
  for (const att of due) {
    try {
      await db.transaction((tx) => resolveAttempt(tx as unknown as EngineDb, att, now));
    } catch (e) {
      firstErr ??= e;
    }
  }
  if (firstErr) throw firstErr;
}

/** Resolve one proposal now. Safe to call from the cron tick OR event-driven the
 *  moment someone responds (an early "I'm in" can clear the threshold before the
 *  deadline). The OPEN→CONFIRMED/FAILED flip is conditional on still-OPEN, so a
 *  race resolves exactly once. */
export async function resolveAttempt(
  db: EngineDb, att: typeof formationAttempts.$inferSelect, now: Date,
): Promise<void> {
  if (att.status !== "OPEN") return;
  // Lock the attempt row so a cron tick and a concurrent event-driven resolve
  // (an "I'm in" at the deadline) can't each decide on a stale interest count —
  // whoever loses the lock re-reads the now-resolved status and bails. Runs inside
  // a transaction in both paths (tick + resolveProposal), so the lock holds.
  const [locked] = await db.select({ status: formationAttempts.status })
    .from(formationAttempts).where(eq(formationAttempts.id, att.id)).for("update").limit(1);
  if (!locked || locked.status !== "OPEN") return;
  const [area] = await db.select().from(areas).where(eq(areas.id, att.areaId)).limit(1);
  const t = await loadTunables(db, att.activityTypeId, area);

  // The roster is everyone who said they're in, plus the proposer (in by
  // definition — they proposed it). Deduped.
  const inRows = await db.select({ userId: attemptInterest.userId }).from(attemptInterest)
    .where(and(eq(attemptInterest.attemptId, att.id), eq(attemptInterest.interested, true)));
  const roster = [...new Set([att.proposerId, ...inRows.map((r) => r.userId)])];

  if (roster.length < t.pMin) {
    // Don't fail before the window actually closes — an early call could still
    // gather more. Time-driven ticks only get here past interestClosesAt.
    if (now < att.interestClosesAt) return;
    const claimed = await claim(db, att.id, "FAILED", `only ${roster.length}/${t.pMin} interested`);
    if (!claimed) return;
    // Tell everyone we asked — plus the proposer, who isn't in the cohort (they're
    // the one who asked) but most wants to know it didn't come together.
    await enqueue(db, [...new Set([att.proposerId, ...(att.cohortUserIds ?? [])])]
      .map((userId) => ({ userId, attemptId: att.id, kind: "STALLED_NOTICE" as NotifKind })), now);
    return;
  }

  // Enough are in → schedule the game. The status flip is the claim.
  const claimed = await claim(db, att.id, "CONFIRMED", null);
  if (!claimed) return;
  const recur = att.recurDow != null ? { dow: att.recurDow, time: att.recurTime } : null;
  const [game] = await db.insert(games).values({
    activityTypeId: att.activityTypeId, areaId: att.areaId, originAttemptId: att.id,
    placeText: att.placeText, placeLat: att.placeLat, placeLng: att.placeLng,
    scheduledStart: att.proposedStart, status: "active", confirmedCount: roster.length,
    // Color is keyed off the AREA so every recurring instance shares one color.
    color: gameColor(att.areaId),
    ...(recur ? { isStanding: true, recurDow: recur.dow, recurTime: recur.time } : {}),
  }).returning({ id: games.id });
  await db.insert(gameRoster).values(roster.map((userId) => ({ gameId: game.id, userId })));
  await db.update(formationAttempts).set({ scheduledGameId: game.id }).where(eq(formationAttempts.id, att.id));
  await db.update(areas).set({ status: "SCHEDULED" }).where(eq(areas.id, att.areaId));
  // GAME_ON goes to the people who are actually in (the roster) — "you're in".
  await enqueue(db, roster.map((userId) => ({ userId, attemptId: att.id, gameId: game.id, kind: "GAME_ON" as NotifKind })), now);
}

/** Flip an attempt OPEN → `to`, only if it's still OPEN (the concurrency claim).
 *  Returns false when a concurrent resolve already took it. */
async function claim(db: EngineDb, attemptId: string, to: "CONFIRMED" | "FAILED", failureReason: string | null): Promise<boolean> {
  const done = await db.update(formationAttempts)
    .set({ status: to, failureReason })
    .where(and(eq(formationAttempts.id, attemptId), eq(formationAttempts.status, "OPEN")))
    .returning({ id: formationAttempts.id });
  return done.length > 0;
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** SQL predicate: the joined user's home is within their OWN travel radius of a
 *  fixed point (a proposed venue / area centroid). Inline haversine in km. */
function withinTravelRadius(lat: number, lng: number) {
  return sql`${users.homeLat} is not null and ${users.homeLng} is not null
    and 6371 * 2 * asin(least(1, sqrt(
      power(sin(radians(${users.homeLat} - ${lat}) / 2), 2)
      + cos(radians(${lat})) * cos(radians(${users.homeLat}))
      * power(sin(radians(${users.homeLng} - ${lng}) / 2), 2)
    ))) <= ${users.maxTravelKm}`;
}

/** The set of users a proposal should email: active for the activity and within
 *  their travel radius of the proposed venue. Used by proposeGame to freeze the
 *  cohort it courts. */
export async function catchmentUsers(
  db: EngineDb, activityTypeId: string, lat: number, lng: number, areaId?: string,
): Promise<string[]> {
  const rows = await db.selectDistinct({ userId: interestSignals.userId })
    .from(interestSignals)
    .innerJoin(users, eq(users.id, interestSignals.userId))
    .where(and(
      eq(interestSignals.activityTypeId, activityTypeId),
      eq(interestSignals.active, true),
      // Never court a globally-opted-out user, nor anyone who opted out of THIS
      // area's proposals (the in-app / decline-link area opt-out is still live).
      eq(users.emailOptIn, true),
      ...(areaId
        ? [sql`not exists (select 1 from area_optouts ao where ao.area_id = ${areaId}::uuid and ao.user_id = ${interestSignals.userId})`]
        : []),
      withinTravelRadius(lat, lng),
    ));
  return rows.map((r) => r.userId);
}

/** Claim-before-send ledger write. The unique index (user, attempt, kind,
 *  channel) makes it exactly-once; the cron flush turns these into real emails. */
export async function enqueue(
  db: EngineDb,
  items: Array<{ userId: string; attemptId: string; gameId?: string; kind: NotifKind }>,
  now: Date,
) {
  if (!items.length) return;
  await db.insert(notificationsSent).values(items.map((i) => ({
    userId: i.userId, attemptId: i.attemptId, gameId: i.gameId ?? null,
    kind: i.kind, channel: "email" as const, sentAt: now,
  }))).onConflictDoNothing();
}
