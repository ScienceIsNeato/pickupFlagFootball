import {
  pgTable, pgEnum, uuid, text, doublePrecision, bigint, jsonb, boolean,
  timestamp, integer, time, date, interval, primaryKey, index, uniqueIndex, check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// THE single source of truth for the database schema. To change it: edit this
// file, then `npm run db:generate -- --name <change>` and commit the generated
// migration (db/migrations, including meta/). Never hand-write migration SQL —
// `npm run db:check` (run by the e2e suite too) fails if migrations and this
// file disagree.

// ── enums ──────────────────────────────────────────────────────────────────
export const areaStatusEnum = pgEnum("area_status", [
  "DORMANT", "PRIMED", "IN_FORMATION", "SCHEDULED", "STALLED",
]);
// A formation attempt is one isolated game proposal: OPEN while it gathers
// interest, then CONFIRMED (enough said they're in → game scheduled) or FAILED
// (fell short by the deadline). CANCELLED = proposer pulled it.
export const attemptStatusEnum = pgEnum("attempt_status", [
  "OPEN", "CONFIRMED", "FAILED", "CANCELLED",
]);
// The standing game (series) lifecycle. The per-week lifecycle is occurrenceStatusEnum.
export const seriesStatusEnum = pgEnum("series_status", ["active", "paused", "retired"]);
// Per-week occurrence lifecycle (see docs/state-machines.md). "tallying" and
// "notifying" are transient cron steps.
export const occurrenceStatusEnum = pgEnum("occurrence_status", [
  "pending", "polling", "tallying", "scheduled", "skipped",
  "notifying", "awaiting_game", "played", "cancelled",
]);
export const notificationKindEnum = pgEnum("notification_kind", [
  // formation: a game is proposed → it forms or it stalls
  "GAME_PROPOSED", "GAME_ON", "STALLED_NOTICE",
  // weekly occurrence poll
  "POLL_ASK", "WEEK_ON", "WEEK_OFF",
  // series lifecycle: a captain pauses or retires the standing game (game-parented)
  "SERIES_PAUSED", "SERIES_RETIRED",
]);
export const notificationChannelEnum = pgEnum("notification_channel", ["push", "email"]);
// Self-declared donation preference. Drives the (Phase 6) email donation footer:
// only "unset" gets the reminder; "subscribed" and "declined" both suppress it.
export const donationStatusEnum = pgEnum("donation_status", ["unset", "subscribed", "declined"]);

// ── zip_centroids ──────────────────────────────────────────────────────────
export const zipCentroids = pgTable("zip_centroids", {
  zip:   text("zip").primaryKey(),
  city:  text("city").notNull().default(""),
  state: text("state").notNull().default(""),
  lat:   doublePrecision("lat").notNull(),
  lng:   doublePrecision("lng").notNull(),
});

// ── activity_types ─────────────────────────────────────────────────────────
export const activityTypes = pgTable("activity_types", {
  id:          uuid("id").primaryKey().defaultRandom(),
  slug:        text("slug").notNull().unique(),
  displayName: text("display_name").notNull(),
  nSpark:      integer("n_spark").notNull().default(8),
  nWarm:       integer("n_warm").notNull().default(5),
  pMin:        integer("p_min").notNull().default(6),
  sMin:        integer("s_min").notNull().default(1),
  // Engine tunables — read by loadTunables (lib/mime/engine). This file is the
  // schema's single source of truth (migrations are generated from it), so every
  // column the engine queries must be modeled here.
  optionsCap:         integer("options_cap").notNull().default(6),
  suggestWindow:      interval("suggest_window").notNull().default("48 hours"),
  availWindow:        interval("avail_window").notNull().default("48 hours"),
  restallInterest:    integer("restall_interest").notNull().default(3),
  restallDays:        integer("restall_days").notNull().default(14),
  maxTimeRetries:     integer("max_time_retries").notNull().default(2),
  perUserWeeklyCap:   integer("per_user_weekly_cap").notNull().default(2),
  ignoreDecayWindows: integer("ignore_decay_windows").notNull().default(3),
  baseH3Res:   integer("base_h3_res").notNull().default(7),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("chk_activity_s_min", sql`${t.sMin} > 0`),
  // sane tunables: a zero/negative threshold would wedge the formation engine
  check("activity_types_check", sql`${t.nSpark} > 0 and ${t.nWarm} >= 0 and ${t.pMin} > 0 and ${t.optionsCap} > 0 and ${t.restallInterest} >= 0 and ${t.restallDays} >= 0 and ${t.maxTimeRetries} >= 0 and ${t.baseH3Res} between 0 and 15 and ${t.perUserWeeklyCap} >= 0 and ${t.ignoreDecayWindows} >= 0`),
]);

export type ActivityType = typeof activityTypes.$inferSelect;

// ── users ──────────────────────────────────────────────────────────────────
export const users = pgTable("users", {
  id:               uuid("id").primaryKey().defaultRandom(),
  email:            text("email").notNull().unique(),
  displayName:      text("display_name"),
  // structured home address. Optional beyond ZIP; server-only (used to geocode
  // a precise home point for distance, never shown to anyone).
  addressLine1:     text("address_line1"),
  addressLine2:     text("address_line2"),
  city:             text("city"),
  state:            text("state"),
  // Required: a registered user always has a home (zip + geocoded point), and that
  // home is their interest signal. Account creation goes through createMember(),
  // which sets these atomically with the interest row.
  zip:              text("zip").notNull(),
  // home point — the geocoded address when given, else that ZIP's centroid.
  // Server-only: the map never exposes it, it only emits H3-cell centroids.
  // Used to measure distance to games.
  homeLat:          doublePrecision("home_lat").notNull(),
  homeLng:          doublePrecision("home_lng").notNull(),
  // how far the user will travel for a game (km). Gates the map's cursor pull.
  maxTravelKm:      doublePrecision("max_travel_km").notNull().default(24.14), // ~15 mi
  h3R5:             bigint("h3_r5", { mode: "bigint" }),
  h3R6:             bigint("h3_r6", { mode: "bigint" }),
  h3R7:             bigint("h3_r7", { mode: "bigint" }),
  h3R8:             bigint("h3_r8", { mode: "bigint" }),
  h3R9:             bigint("h3_r9", { mode: "bigint" }),
  timezone:         text("timezone"),
  passwordHash:     text("password_hash"),
  emailVerified:    timestamp("email_verified", { withTimezone: true }),
  verificationToken: text("verification_token"), // single-use confirm-email secret
  // single-use password-reset secret (hashed) + its expiry. Both cleared once
  // the reset completes; the token page rejects an expired or missing pair.
  passwordResetToken:   text("password_reset_token"),
  passwordResetExpires: timestamp("password_reset_expires", { withTimezone: true }),
  pushSubscription: jsonb("push_subscription"),
  emailOptIn:       boolean("email_opt_in").notNull().default(true),
  donationStatus:   donationStatusEnum("donation_status").notNull().default("unset"),
  // Stripe donation subscription — set by the checkout/webhook flow; the webhook
  // maps a Stripe customer back to the user to keep donationStatus in sync.
  stripeCustomerId:     text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // one user per Stripe customer — the webhook's customer→user mapping relies on it
  uniqueIndex("uq_users_stripe_customer").on(t.stripeCustomerId),
  check("chk_users_max_travel_km", sql`${t.maxTravelKm} > 0`),
  check("users_home_lat_check", sql`${t.homeLat} between -90 and 90`),
  check("users_home_lng_check", sql`${t.homeLng} between -180 and 180`),
  // catchment fan-out probes by H3 cell; ZIP groups nearby users
  index("idx_users_h3_r7").on(t.h3R7),
  index("idx_users_h3_r8").on(t.h3R8),
  index("idx_users_zip").on(t.zip),
  index("idx_users_verification_token").on(t.verificationToken).where(sql`${t.verificationToken} is not null`),
  index("idx_users_password_reset_token").on(t.passwordResetToken).where(sql`${t.passwordResetToken} is not null`),
]);

export type User = typeof users.$inferSelect;

// ── areas ──────────────────────────────────────────────────────────────────
export const areas = pgTable("areas", {
  id:             uuid("id").primaryKey().defaultRandom(),
  activityTypeId: uuid("activity_type_id").notNull().references(() => activityTypes.id),
  h3Cell:         bigint("h3_cell", { mode: "bigint" }).notNull(),
  displayCity:    text("display_city"),
  displayZip:     text("display_zip"),
  centerLat:      doublePrecision("center_lat").notNull(),
  centerLng:      doublePrecision("center_lng").notNull(),
  // IANA zone (migration 025), from the centroid via tz-lookup in ensureArea.
  // The occurrence engine composes each week's kickoff/poll windows in this zone
  // so a "6pm" game fires at 6pm local, not 6pm UTC. Defaults to the launch
  // market (US Central) for pre-025 rows; backfill script recomputes them.
  timezone:       text("timezone").notNull().default("America/Chicago"),
  status:              areaStatusEnum("status").notNull().default("DORMANT"),
  stallCount:          integer("stall_count").notNull().default(0),
  lastRoundAt:         timestamp("last_round_at", { withTimezone: true }),
  nextTriggerAt:       timestamp("next_trigger_at", { withTimezone: true }),
  nextTriggerInterest: integer("next_trigger_interest"),
  nSparkOverride:      integer("n_spark_override"),
  pMinOverride:        integer("p_min_override"),
  // Per-site config for the weekly RSVP poll (drives the occurrence FSM).
  minPlayersToSchedule: integer("min_players_to_schedule").notNull().default(6),
  pollingWindowLength:  interval("polling_window_length").notNull().default("24 hours"),
  pollingStartOffset:   interval("polling_start_offset").notNull().default("48 hours"),
  createdAt:           timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_areas_activity_cell").on(t.activityTypeId, t.h3Cell),
  check("areas_check", sql`${t.centerLat} between -90 and 90 and ${t.centerLng} between -180 and 180`),
  index("idx_areas_status").on(t.activityTypeId, t.status),
]);

export type Area = typeof areas.$inferSelect;

// ── interest_signals ───────────────────────────────────────────────────────
export const interestSignals = pgTable("interest_signals", {
  id:                 uuid("id").primaryKey().defaultRandom(),
  activityTypeId:     uuid("activity_type_id").notNull().references(() => activityTypes.id),
  userId:             uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  areaId:             uuid("area_id").notNull().references(() => areas.id),
  h3Base:             bigint("h3_base", { mode: "bigint" }).notNull(),
  active:             boolean("active").notNull().default(true),
  consecutiveIgnored: integer("consecutive_ignored").notNull().default(0),
  createdAt:          timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_interest_user_area").on(t.activityTypeId, t.userId, t.areaId),
  // partial: only active signals feed counts/matching, and hot paths filter on it
  index("idx_interest_area_active").on(t.areaId).where(sql`${t.active}`),
  index("idx_interest_ring").on(t.activityTypeId, t.h3Base).where(sql`${t.active}`),
]);

export type InterestSignal = typeof interestSignals.$inferSelect;

// ── formation_attempts ─────────────────────────────────────────────────────
// One row = one isolated game proposal. The proposal's details (place, day, time)
// live right here — there's no separate suggestions/options layer. People respond
// Interested / Not-Interested in attempt_interest; at interestClosesAt the engine
// forms the game (enough interested) or fails the attempt.
export const formationAttempts = pgTable("formation_attempts", {
  id:               uuid("id").primaryKey().defaultRandom(),
  activityTypeId:   uuid("activity_type_id").notNull().references(() => activityTypes.id),
  areaId:           uuid("area_id").notNull().references(() => areas.id),
  attemptNumber:    integer("attempt_number").notNull(),
  status:           attemptStatusEnum("status").notNull().default("OPEN"),
  // Who proposed it, and the proposal itself.
  proposerId:       uuid("proposer_id").notNull().references(() => users.id),
  placeText:        text("place_text").notNull(),
  placeLat:         doublePrecision("place_lat"),
  placeLng:         doublePrecision("place_lng"),
  proposedStart:    timestamp("proposed_start", { withTimezone: true }).notNull(),
  // Recurring weekly slot the proposer picked (local wall-clock). NULL = one-off.
  // proposedStart is the first game; these promote the formed game to standing.
  recurDow:         integer("recur_dow"),   // 0=Sun…6=Sat
  recurTime:        time("recur_time"),     // HH:MM:SS, local
  // Who we emailed about this proposal (frozen snapshot at propose time).
  catchmentCells:   bigint("catchment_cells", { mode: "bigint" }).array().notNull().default([]),
  cohortUserIds:    uuid("cohort_user_ids").array().notNull().default([]),
  // The single interest window.
  interestClosesAt: timestamp("interest_closes_at", { withTimezone: true }).notNull(),
  scheduledGameId:  uuid("scheduled_game_id"),
  failureReason:    text("failure_reason"),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // proposeGame allocates attempt_number under an area-row lock; this unique index
  // is the backstop that makes a duplicate (area, number) impossible even if that
  // lock path is ever bypassed.
  uniqueIndex("uq_attempt_area_number").on(t.areaId, t.attemptNumber),
  index("idx_attempt_open_close").on(t.status, t.interestClosesAt),
  // catchment membership is probed with array-contains during fan-out
  index("idx_attempt_catchment").using("gin", t.catchmentCells),
  // same bound as games.recur_dow — the value is copied there when the game forms
  check("formation_attempts_recur_dow_check", sql`${t.recurDow} is null or ${t.recurDow} between 0 and 6`),
  // NO check that CONFIRMED implies scheduled_game_id: the engine claims the
  // attempt (OPEN→CONFIRMED) BEFORE inserting the game, inside one transaction
  // — and Postgres CHECKs are per-statement, not deferrable to commit, so such
  // a check rejects the claim itself. (The original schema.sql had it; it would
  // have 500'd the first engine-confirmed proposal in prod. The transaction in
  // trigger/tick guarantees the invariant at every commit boundary instead.)
]);

export type FormationAttempt = typeof formationAttempts.$inferSelect;

// ── attempt_interest ───────────────────────────────────────────────────────
// One row = one person's response to a proposal. interested=true ("I'm in") feeds
// the form threshold + the roster; interested=false ("not interested") declines
// just this proposal (a different nearby proposal can still reach them).
export const attemptInterest = pgTable("attempt_interest", {
  id:         uuid("id").primaryKey().defaultRandom(),
  attemptId:  uuid("attempt_id").notNull().references(() => formationAttempts.id, { onDelete: "cascade" }),
  userId:     uuid("user_id").notNull().references(() => users.id),
  interested: boolean("interested").notNull(),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_attempt_interest").on(t.attemptId, t.userId),
]);

// ── games ──────────────────────────────────────────────────────────────────
export const games = pgTable("games", {
  id:              uuid("id").primaryKey().defaultRandom(),
  activityTypeId:  uuid("activity_type_id").notNull().references(() => activityTypes.id),
  areaId:          uuid("area_id").notNull().references(() => areas.id),
  originAttemptId: uuid("origin_attempt_id"),
  placeText:       text("place_text").notNull(),
  placeLat:        doublePrecision("place_lat"),
  placeLng:        doublePrecision("place_lng"),
  scheduledStart:  timestamp("scheduled_start", { withTimezone: true }).notNull(),
  status:          seriesStatusEnum("status").notNull().default("active"),
  confirmedCount:  integer("confirmed_count").notNull().default(0),
  // Per-site captain-set "minimum expected players" (migration 024). Null →
  // fall back to the area default; drives the weekly poll's run/skip threshold.
  minPlayers:      integer("min_players"),
  color:           text("color"),  // assigned at insert time; consumers fall back to gameColor(id) for legacy rows
  isStanding:      boolean("is_standing").notNull().default(false),
  recurDow:        integer("recur_dow"),
  recurTime:       time("recur_time"),
  // Seasonal-pause metadata — both set when status='paused', cleared otherwise.
  pausedUntil:     date("paused_until"),
  pauseNote:       text("pause_note"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // matches setMinPlayers' 2..60 API bound, so a direct DB write can't set a
  // bar that makes a game impossible to hold or trivially always-on
  check("games_min_players_range", sql`${t.minPlayers} is null or ${t.minPlayers} between 2 and 60`),
  check("games_recur_dow_check", sql`${t.recurDow} is null or ${t.recurDow} between 0 and 6`),
  index("idx_games_area").on(t.activityTypeId, t.areaId),
]);

export type Game = typeof games.$inferSelect;

// ── game_roster ────────────────────────────────────────────────────────────
export const gameRoster = pgTable("game_roster", {
  gameId:    uuid("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  userId:    uuid("user_id").notNull().references(() => users.id),
  source:    text("source").notNull().default("soft_promise"),
  // Per-site default RSVP ("usually come" = in, "usually won't" = out). Occurrences
  // inherit this unless explicitly overridden in game_attendance.
  defaultStatus: text("default_status").notNull().default("in"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.gameId, t.userId] }),
  check("game_roster_default_status_check", sql`${t.defaultStatus} in ('in','out')`),
]);

// ── game_attendance ────────────────────────────────────────────────────────
// Per-occurrence RSVP for a game: a roster member says "in"/"out" for a specific
// date. game_roster is the standing membership; this is the weekly layer on top.
export const gameAttendance = pgTable("game_attendance", {
  gameId:         uuid("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  userId:         uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  occurrenceDate: date("occurrence_date").notNull(),
  status:         text("status").notNull(), // 'in' | 'out'
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.gameId, t.userId, t.occurrenceDate] }),
  check("game_attendance_status_check", sql`${t.status} in ('in','out')`),
  // the tally counts who's in for a given occurrence
  index("idx_game_attendance_occurrence").on(t.gameId, t.occurrenceDate).where(sql`${t.status} = 'in'`),
]);

// ── game_occurrences ───────────────────────────────────────────────────────
// One row per weekly occurrence of a standing game. Carries the per-week
// poll → play lifecycle (occurrence_status); individual RSVPs live in
// game_attendance. See docs/state-machines.md.
export const gameOccurrences = pgTable("game_occurrences", {
  id:             uuid("id").primaryKey().defaultRandom(),
  gameId:         uuid("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  occurrenceDate: date("occurrence_date").notNull(),
  status:         occurrenceStatusEnum("status").notNull().default("pending"),
  kickoffAt:      timestamp("kickoff_at", { withTimezone: true }).notNull(),
  pollOpensAt:    timestamp("poll_opens_at", { withTimezone: true }).notNull(),
  pollClosesAt:   timestamp("poll_closes_at", { withTimezone: true }).notNull(),
  inCount:        integer("in_count").notNull().default(0),
  // Captain's reason when they call off ("cancelled") a week — shown to players.
  cancelNote:     text("cancel_note"),
  notifiedAt:     timestamp("notified_at", { withTimezone: true }),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_occurrence_game_date").on(t.gameId, t.occurrenceDate),
  index("idx_occurrences_poll_open").on(t.status, t.pollOpensAt),
  index("idx_occurrences_poll_close").on(t.status, t.pollClosesAt),
  index("idx_occurrences_kickoff").on(t.status, t.kickoffAt),
]);

// ── notifications_sent ─────────────────────────────────────────────────────
export const notificationsSent = pgTable("notifications_sent", {
  id:        uuid("id").primaryKey().defaultRandom(),
  userId:    uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  // Exactly one parent: a formation attempt (formation emails) OR an occurrence
  // (weekly poll emails). Enforced by the check below.
  attemptId: uuid("attempt_id").references(() => formationAttempts.id, { onDelete: "cascade" }),
  occurrenceId: uuid("occurrence_id").references(() => gameOccurrences.id, { onDelete: "cascade" }),
  gameId:    uuid("game_id").references(() => games.id, { onDelete: "cascade" }),
  kind:      notificationKindEnum("kind").notNull(),
  channel:   notificationChannelEnum("channel").notNull(),
  sentAt:    timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  // When the email was actually delivered via Brevo. NULL = claimed (row exists,
  // exactly-once) but not yet sent — the cron flush sends these and stamps it.
  emailedAt: timestamp("emailed_at", { withTimezone: true }),
}, (t) => [
  // At most one of attempt/occurrence (they're mutually exclusive parents), and
  // at least one parent overall — attempt (formation), occurrence (weekly poll),
  // or game (series-level pause/retire notices, which have neither).
  check("notif_one_parent", sql`num_nonnulls(${t.attemptId}, ${t.occurrenceId}) <= 1 and num_nonnulls(${t.attemptId}, ${t.occurrenceId}, ${t.gameId}) >= 1`),
  uniqueIndex("uq_notif_attempt").on(t.userId, t.attemptId, t.kind, t.channel).where(sql`${t.attemptId} is not null`),
  uniqueIndex("uq_notif_occurrence").on(t.userId, t.occurrenceId, t.kind, t.channel).where(sql`${t.occurrenceId} is not null`),
  // the cron flush scans claimed-but-unsent email rows
  index("idx_notif_unsent").on(t.sentAt).where(sql`${t.emailedAt} is null and ${t.channel} = 'email'`),
  index("idx_notif_user_week").on(t.userId, t.sentAt),
]);

// ── area_captains ──────────────────────────────────────────────────────────
export const areaCaptains = pgTable("area_captains", {
  areaId:           uuid("area_id").notNull().references(() => areas.id, { onDelete: "cascade" }),
  userId:           uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  becameCaptainAt:  timestamp("became_captain_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.areaId, t.userId] }),
]);

// ── area_optouts ───────────────────────────────────────────────────────────
// A user said "not interested" in a forming site. They keep their interest
// signals (still free interest elsewhere); this area's formation just stops
// counting/asking them. One row per (area, user); deleting it re-expresses
// interest.
export const areaOptouts = pgTable("area_optouts", {
  areaId:    uuid("area_id").notNull().references(() => areas.id, { onDelete: "cascade" }),
  userId:    uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.areaId, t.userId] }),
  index("idx_area_optouts_user").on(t.userId),
]);

// ── map_aggregates ─────────────────────────────────────────────────────────
export const mapAggregates = pgTable("map_aggregates", {
  activityTypeId: uuid("activity_type_id").notNull().references(() => activityTypes.id),
  resolution:     integer("resolution").notNull(),
  h3Cell:         bigint("h3_cell", { mode: "bigint" }).notNull(),
  interestCount:  integer("interest_count").notNull().default(0),
  hasGame:        boolean("has_game").notNull().default(false),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.activityTypeId, t.resolution, t.h3Cell] }),
]);
