import {
  pgTable, pgEnum, uuid, text, doublePrecision, bigint, jsonb, boolean,
  timestamp, integer, time, date, interval, primaryKey, index, uniqueIndex, check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

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
  // Engine tunables — read by loadTunables (lib/mime/engine). Modeled here so the
  // ORM schema is complete and drizzle-kit push (the e2e DB) builds them; without
  // these the formation engine's loadTunables query fails against a pushed DB.
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
});

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
  pushSubscription: jsonb("push_subscription"),
  emailOptIn:       boolean("email_opt_in").notNull().default(true),
  donationStatus:   donationStatusEnum("donation_status").notNull().default("unset"),
  // Stripe donation subscription — set by the checkout/webhook flow; the webhook
  // maps a Stripe customer back to the user to keep donationStatus in sync.
  stripeCustomerId:     text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

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
  index("idx_interest_area_active").on(t.areaId),
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
  index("idx_attempt_open_close").on(t.status, t.interestClosesAt),
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
  color:           text("color"),  // assigned at insert time; consumers fall back to gameColor(id) for legacy rows
  isStanding:      boolean("is_standing").notNull().default(false),
  recurDow:        integer("recur_dow"),
  recurTime:       time("recur_time"),
  // Seasonal-pause metadata — both set when status='paused', cleared otherwise.
  pausedUntil:     date("paused_until"),
  pauseNote:       text("pause_note"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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
  check("notif_one_parent", sql`(${t.attemptId} is not null) <> (${t.occurrenceId} is not null)`),
  uniqueIndex("uq_notif_attempt").on(t.userId, t.attemptId, t.kind, t.channel).where(sql`${t.attemptId} is not null`),
  uniqueIndex("uq_notif_occurrence").on(t.userId, t.occurrenceId, t.kind, t.channel).where(sql`${t.occurrenceId} is not null`),
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
