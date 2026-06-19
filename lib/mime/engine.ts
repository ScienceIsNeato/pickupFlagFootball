import { and, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import * as schema from "@/lib/db/schema";
import {
  areas, interestSignals, formationAttempts, suggestions,
  formationOptions, softPromises, games, gameRoster, notificationsSent,
} from "@/lib/db/schema";
import { diskCells } from "@/lib/geo/h3";
import { resolveTunables } from "./tunables";
import { onInterest, onSuggestionClose, onAvailabilityClose } from "./fsm";
import type { Decision, SuggestionInput, OptionTally } from "./types";

/** The engine takes its db client by injection so the identical code runs on
 *  neon-http in prod and pglite in the sim. */
export type EngineDb = PgDatabase<never, typeof schema>;

type NotifKind =
  | "SPARK_ASK" | "OPTIONS_AVAILABLE" | "GAME_ON"
  | "SUGGEST_NUDGE" | "SUGGEST_LASTCALL" | "AVAIL_NUDGE" | "AVAIL_LASTCALL" | "STALLED_NOTICE";

type AreaOverrides = { nSparkOverride: number | null; pMinOverride: number | null };

/** Effective tunables = activity_types row values (windows extracted to hours)
 *  layered with per-area overrides — never just code defaults. */
export async function loadTunables(db: EngineDb, activityTypeId: string, area?: AreaOverrides) {
  const res = await db.execute(sql`
    select n_spark, n_warm, p_min, s_min, options_cap,
      extract(epoch from suggest_window) / 3600 as suggest_h,
      extract(epoch from avail_window) / 3600 as avail_h,
      restall_interest, restall_days, max_time_retries,
      per_user_weekly_cap, ignore_decay_windows
    from activity_types where id = ${activityTypeId} limit 1`);
  const r = ((res as { rows?: Record<string, unknown>[] }).rows ?? [])[0];
  const num = (v: unknown) => (v == null ? undefined : Number(v));
  const base = r ? {
    nSpark: num(r.n_spark), nWarm: num(r.n_warm), pMin: num(r.p_min), sMin: num(r.s_min),
    optionsCap: num(r.options_cap),
    suggestWindowH: num(r.suggest_h), availWindowH: num(r.avail_h),
    restallInterest: num(r.restall_interest), restallDays: num(r.restall_days),
    maxTimeRetries: num(r.max_time_retries), perUserWeeklyCap: num(r.per_user_weekly_cap),
    ignoreDecayWindows: num(r.ignore_decay_windows),
  } : {};
  const overrides = {
    ...(area?.nSparkOverride != null ? { nSpark: area.nSparkOverride } : {}),
    ...(area?.pMinOverride != null ? { pMin: area.pMinOverride } : {}),
  };
  return resolveTunables(base, overrides);
}

// ── evaluate: user-event entry point ─────────────────────────────────────────
/** Called on interest change (registration / toggle / location move). Sparks a
 *  formation if the area crossed n_spark. Idempotent under the one-live-attempt
 *  index — a lost spark race becomes a NOOP. */
export async function evaluate(
  db: EngineDb, activityTypeId: string, areaId: string, now: Date
): Promise<Decision> {
  const [area] = await db.select().from(areas).where(eq(areas.id, areaId)).limit(1);
  if (!area) return { kind: "NOOP", reason: "no area" };
  const t = await loadTunables(db, activityTypeId, area);

  const disk = diskCells(area.h3Cell, 1);
  const interestCount = await catchmentCount(db, activityTypeId, disk);

  const decision = onInterest({
    status: area.status,
    interestCount,
    nextTriggerAt: area.nextTriggerAt ?? null,
    nextTriggerInterest: area.nextTriggerInterest ?? null,
    now, t,
  });
  if (decision.kind !== "SPARK") return decision;

  const cohort = await catchmentUsers(db, activityTypeId, disk);
  const attemptNumber = await nextAttemptNumber(db, areaId);

  // Spark atomically: the attempt insert, the area → IN_FORMATION flip and the
  // SPARK_ASK notifications commit together. Otherwise a failure after the
  // insert could leave a live attempt occupying the one-live-attempt slot while
  // the area still reads DORMANT/STALLED.
  try {
    await db.transaction(async (tx) => {
      const [att] = await tx.insert(formationAttempts).values({
        activityTypeId, areaId, attemptNumber, status: "SUGGESTING",
        catchmentCells: disk, cohortUserIds: cohort,
        suggestionOpenedAt: now, suggestionClosesAt: decision.suggestionClosesAt,
      }).returning({ id: formationAttempts.id });
      await tx.update(areas).set({ status: "IN_FORMATION", lastRoundAt: now }).where(eq(areas.id, areaId));
      await enqueue(tx as unknown as EngineDb,
        cohort.map((userId) => ({ userId, attemptId: att.id, kind: "SPARK_ASK" as NotifKind })), now);
    });
  } catch (e) {
    // Only the one-live-attempt unique conflict is an expected NOOP (a spark
    // race) — the whole transaction rolls back. Any other DB error must surface,
    // not be hidden as success.
    const pgCode = (e as { cause?: { code?: string } }).cause?.code;
    const msg = e instanceof Error ? e.message : String(e);
    if (pgCode !== "23505" && !/uq_one_live_attempt|unique|duplicate|23505/i.test(msg)) throw e;
    return { kind: "NOOP", reason: "already sparked (lost the one-live-attempt race)" };
  }
  return decision;
}

// ── tick: time-based entry point (Vercel Cron) ───────────────────────────────
/** Closes due windows: suggestion → compile/stall, availability → schedule/stall.
 *  Idempotent — only acts on rows whose close time has passed. */
export async function tick(db: EngineDb, now: Date): Promise<void> {
  // Each window closer runs in its own transaction: the multi-step writes commit
  // all-or-nothing, so a failure can't leave a half-scheduled game or an orphan
  // area status. One bad attempt rolls back cleanly and is retried next tick
  // without blocking the others — we surface the first error after the sweep.
  let firstErr: unknown;
  const sweep = async (
    rows: (typeof formationAttempts.$inferSelect)[],
    close: (tx: EngineDb, att: typeof formationAttempts.$inferSelect, now: Date) => Promise<void>,
  ) => {
    for (const att of rows) {
      try {
        await db.transaction((tx) => close(tx as unknown as EngineDb, att, now));
      } catch (e) {
        firstErr ??= e;
      }
    }
  };

  const dueSuggest = await db.select().from(formationAttempts)
    .where(and(eq(formationAttempts.status, "SUGGESTING"), lte(formationAttempts.suggestionClosesAt, now)));
  await sweep(dueSuggest, closeSuggestion);

  const dueAvail = await db.select().from(formationAttempts)
    .where(and(eq(formationAttempts.status, "AVAILABILITY"), lte(formationAttempts.availabilityClosesAt, now)));
  await sweep(dueAvail, closeAvailability);

  if (firstErr) throw firstErr;
}

// ── window closers ───────────────────────────────────────────────────────────
/** Atomically claim a due attempt for processing: move it out of its open state
 *  `from` into the processing state `to`, only if it's still in `from`. Returns
 *  false when a concurrent tick already claimed it, so the loser bails before
 *  inserting any options/games/roster rows (prevents double-scheduling). The
 *  conditional UPDATE…WHERE status RETURNING is a single statement, so it's
 *  atomic even on the one-shot neon-http client. */
async function claimAttempt(
  db: EngineDb,
  attemptId: string,
  from: "SUGGESTING" | "AVAILABILITY",
  to: "COMPILING" | "ADJUDICATING",
): Promise<boolean> {
  const claimed = await db.update(formationAttempts)
    .set({ status: to })
    .where(and(eq(formationAttempts.id, attemptId), eq(formationAttempts.status, from)))
    .returning({ id: formationAttempts.id });
  return claimed.length > 0;
}

async function closeSuggestion(db: EngineDb, att: typeof formationAttempts.$inferSelect, now: Date) {
  // Runs inside a tick() transaction, so every write below is atomic: a failure
  // rolls the whole thing back (claim included) and the attempt is retried next
  // tick from a clean SUGGESTING state — no partial options, no wedge. The claim
  // is the concurrency gate: a second tick that already grabbed this row loses
  // the row-lock race and returns without double-processing.
  if (!(await claimAttempt(db, att.id, "SUGGESTING", "COMPILING"))) return;
  const [area] = await db.select().from(areas).where(eq(areas.id, att.areaId)).limit(1);
  const t = await loadTunables(db, att.activityTypeId, area);
  const rows = await db.select().from(suggestions)
    .where(eq(suggestions.attemptId, att.id)).orderBy(suggestions.createdAt);
  const inputs: SuggestionInput[] = rows.map((s) => ({
    id: s.id, placeText: s.placeText, placeLat: s.placeLat, placeLng: s.placeLng,
    proposedStart: s.proposedStart, createdAt: s.createdAt,
  }));
  const interestCount = await catchmentCount(db, att.activityTypeId, att.catchmentCells);

  const d = onSuggestionClose({ suggestions: inputs, stallCount: area.stallCount, interestCount, now, t });

  if (d.kind === "STALL") {
    await stall(db, att, area.stallCount, d.reason, d.nextTriggerAt, d.nextTriggerInterest);
    return;
  }

  for (const opt of d.options) {
    const [o] = await db.insert(formationOptions).values({
      attemptId: att.id, placeText: opt.placeText, placeLat: opt.placeLat, placeLng: opt.placeLng,
      proposedStart: opt.proposedStart, firstSuggestedAt: opt.firstSuggestedAt,
    }).returning({ id: formationOptions.id });
    if (opt.sourceIds.length)
      await db.update(suggestions).set({ optionId: o.id })
        .where(inArray(suggestions.id, opt.sourceIds));
  }
  await db.update(formationAttempts).set({
    status: "AVAILABILITY", availabilityOpenedAt: now, availabilityClosesAt: d.availabilityClosesAt,
  }).where(eq(formationAttempts.id, att.id));
  await enqueue(db, att.cohortUserIds.map((userId) => ({ userId, attemptId: att.id, kind: "OPTIONS_AVAILABLE" as NotifKind })), now);
}

async function closeAvailability(db: EngineDb, att: typeof formationAttempts.$inferSelect, now: Date) {
  // Runs inside a tick() transaction: the game insert, roster, attempt CONFIRMED,
  // area SCHEDULED and notifications all commit together or not at all — so the
  // area can't end up IN_FORMATION next to a committed game (which would let
  // proposeGame open a fresh formation on the same spot). The claim is the
  // concurrency gate against a second tick double-scheduling.
  if (!(await claimAttempt(db, att.id, "AVAILABILITY", "ADJUDICATING"))) return;
  const [area] = await db.select().from(areas).where(eq(areas.id, att.areaId)).limit(1);
  const t = await loadTunables(db, att.activityTypeId, area);

  const optRows = await db.select({
    id: formationOptions.id,
    placeText: formationOptions.placeText,
    placeLat: formationOptions.placeLat,
    placeLng: formationOptions.placeLng,
    proposedStart: formationOptions.proposedStart,
    firstSuggestedAt: formationOptions.firstSuggestedAt,
    promiseCount: sql<number>`count(${softPromises.id})::int`,
  }).from(formationOptions)
    .leftJoin(softPromises, eq(softPromises.optionId, formationOptions.id))
    .where(eq(formationOptions.attemptId, att.id))
    .groupBy(formationOptions.id)
    .orderBy(formationOptions.firstSuggestedAt, formationOptions.id); // deterministic input order

  const tallies = optRows.map((o) => ({
    optionId: o.id, placeText: o.placeText, placeLat: o.placeLat, placeLng: o.placeLng,
    proposedStart: o.proposedStart, firstSuggestedAt: o.firstSuggestedAt, promiseCount: o.promiseCount,
  }));
  const interestCount = await catchmentCount(db, att.activityTypeId, att.catchmentCells);

  const d = onAvailabilityClose({ options: tallies as OptionTally[], stallCount: area.stallCount, interestCount, now, t });

  if (d.kind === "STALL") {
    await stall(db, att, area.stallCount, d.reason, d.nextTriggerAt, d.nextTriggerInterest);
    return;
  }

  const winner = d.winner as OptionTally & { optionId: string };
  const promisers = await db.select({ userId: softPromises.userId }).from(softPromises)
    .where(eq(softPromises.optionId, winner.optionId));
  const roster = promisers.map((p) => p.userId);

  // Promote to a standing weekly slot if the winning suggestion carried a
  // recurring day/time (proposals from the map do). All suggestions grouped into
  // one option share the same place + time, so any source row's recurrence holds.
  const [recur] = await db.select({ dow: suggestions.recurDow, time: suggestions.recurTime })
    .from(suggestions)
    .where(and(eq(suggestions.optionId, winner.optionId), isNotNull(suggestions.recurDow)))
    .limit(1);

  const [game] = await db.insert(games).values({
    activityTypeId: att.activityTypeId, areaId: att.areaId,
    originAttemptId: att.id, winningOptionId: winner.optionId,
    placeText: winner.placeText, placeLat: winner.placeLat, placeLng: winner.placeLng,
    scheduledStart: winner.proposedStart,
    status: "STAGED", confirmedCount: roster.length,
    ...(recur ? { isStanding: true, recurDow: recur.dow, recurTime: recur.time } : {}),
  }).returning({ id: games.id });

  if (roster.length)
    await db.insert(gameRoster).values(roster.map((userId) => ({ gameId: game.id, userId })));

  await db.update(formationAttempts).set({ status: "CONFIRMED", scheduledGameId: game.id })
    .where(eq(formationAttempts.id, att.id));
  await db.update(areas).set({ status: "SCHEDULED" }).where(eq(areas.id, att.areaId));
  await enqueue(db, roster.map((userId) => ({ userId, attemptId: att.id, gameId: game.id, kind: "GAME_ON" as NotifKind })), now);
}

async function stall(
  db: EngineDb, att: typeof formationAttempts.$inferSelect, stallCount: number,
  reason: string, nextTriggerAt: Date | null, nextTriggerInterest: number
) {
  await db.update(formationAttempts).set({ status: "FAILED", failureReason: reason })
    .where(eq(formationAttempts.id, att.id));
  await db.update(areas).set({
    status: "STALLED", stallCount: stallCount + 1, nextTriggerAt, nextTriggerInterest,
  }).where(eq(areas.id, att.areaId));
}

// ── helpers ──────────────────────────────────────────────────────────────────
async function catchmentCount(db: EngineDb, activityTypeId: string, disk: bigint[]): Promise<number> {
  const [{ c }] = await db.select({ c: sql<number>`count(distinct ${interestSignals.userId})::int` })
    .from(interestSignals)
    .where(and(
      eq(interestSignals.activityTypeId, activityTypeId),
      eq(interestSignals.active, true),
      inArray(interestSignals.h3Base, disk),
    ));
  return c;
}

async function catchmentUsers(db: EngineDb, activityTypeId: string, disk: bigint[]): Promise<string[]> {
  const rows = await db.selectDistinct({ userId: interestSignals.userId })
    .from(interestSignals)
    .where(and(
      eq(interestSignals.activityTypeId, activityTypeId),
      eq(interestSignals.active, true),
      inArray(interestSignals.h3Base, disk),
    ));
  return rows.map((r) => r.userId);
}

async function nextAttemptNumber(db: EngineDb, areaId: string): Promise<number> {
  const [{ n }] = await db.select({ n: sql<number>`coalesce(max(${formationAttempts.attemptNumber}), 0)::int` })
    .from(formationAttempts).where(eq(formationAttempts.areaId, areaId));
  return n + 1;
}

/** Claim-before-send ledger write. The unique index (user, attempt, kind,
 *  channel) makes this exactly-once; Phase 6 swaps the insert for a real
 *  Resend/web-push send gated on the claim. Single-channel (email) for now. */
async function enqueue(
  db: EngineDb,
  items: Array<{ userId: string; attemptId: string; gameId?: string; kind: NotifKind }>,
  now: Date
) {
  if (!items.length) return;
  await db.insert(notificationsSent).values(items.map((i) => ({
    userId: i.userId, attemptId: i.attemptId, gameId: i.gameId ?? null,
    kind: i.kind, channel: "email" as const, sentAt: now,
  }))).onConflictDoNothing();
}
