import {
  pgTable, pgEnum, uuid, text, doublePrecision, bigint, jsonb, boolean,
  timestamp, integer, time, primaryKey, index, uniqueIndex,
} from "drizzle-orm/pg-core";

// ── enums ──────────────────────────────────────────────────────────────────
export const areaStatusEnum = pgEnum("area_status", [
  "DORMANT", "PRIMED", "IN_FORMATION", "SCHEDULED", "STALLED",
]);
export const attemptStatusEnum = pgEnum("attempt_status", [
  "SUGGESTING", "COMPILING", "AVAILABILITY", "ADJUDICATING",
  "CONFIRMED", "FAILED", "CANCELLED",
]);
export const gameStatusEnum = pgEnum("game_status", [
  "STAGED", "STANDING", "CANCELLED", "COMPLETED",
]);
export const notificationKindEnum = pgEnum("notification_kind", [
  "SPARK_ASK", "SUGGEST_NUDGE", "SUGGEST_LASTCALL",
  "OPTIONS_AVAILABLE", "AVAIL_NUDGE", "AVAIL_LASTCALL",
  "GAME_ON", "STALLED_NOTICE",
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
  zip:              text("zip"),
  // home point — the geocoded address when given, else that ZIP's centroid.
  // Server-only: the map never exposes it, it only emits H3-cell centroids.
  // Used to measure distance to games.
  homeLat:          doublePrecision("home_lat"),
  homeLng:          doublePrecision("home_lng"),
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
  pushSubscription: jsonb("push_subscription"),
  emailOptIn:       boolean("email_opt_in").notNull().default(true),
  donationStatus:   donationStatusEnum("donation_status").notNull().default("unset"),
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
export const formationAttempts = pgTable("formation_attempts", {
  id:                   uuid("id").primaryKey().defaultRandom(),
  activityTypeId:       uuid("activity_type_id").notNull().references(() => activityTypes.id),
  areaId:               uuid("area_id").notNull().references(() => areas.id),
  attemptNumber:        integer("attempt_number").notNull(),
  status:               attemptStatusEnum("status").notNull().default("SUGGESTING"),
  catchmentCells:       bigint("catchment_cells", { mode: "bigint" }).array().notNull().default([]),
  cohortUserIds:        uuid("cohort_user_ids").array().notNull().default([]),
  suggestionOpenedAt:   timestamp("suggestion_opened_at", { withTimezone: true }),
  suggestionClosesAt:   timestamp("suggestion_closes_at", { withTimezone: true }),
  availabilityOpenedAt: timestamp("availability_opened_at", { withTimezone: true }),
  availabilityClosesAt: timestamp("availability_closes_at", { withTimezone: true }),
  scheduledGameId:      uuid("scheduled_game_id"),
  failureReason:        text("failure_reason"),
  createdAt:            timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FormationAttempt = typeof formationAttempts.$inferSelect;

// ── suggestions ────────────────────────────────────────────────────────────
export const suggestions = pgTable("suggestions", {
  id:            uuid("id").primaryKey().defaultRandom(),
  attemptId:     uuid("attempt_id").notNull().references(() => formationAttempts.id, { onDelete: "cascade" }),
  userId:        uuid("user_id").notNull().references(() => users.id),
  placeText:     text("place_text").notNull(),
  placeLat:      doublePrecision("place_lat"),
  placeLng:      doublePrecision("place_lng"),
  proposedStart: timestamp("proposed_start", { withTimezone: true }).notNull(),
  optionId:      uuid("option_id"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── formation_options ──────────────────────────────────────────────────────
export const formationOptions = pgTable("formation_options", {
  id:               uuid("id").primaryKey().defaultRandom(),
  attemptId:        uuid("attempt_id").notNull().references(() => formationAttempts.id, { onDelete: "cascade" }),
  placeText:        text("place_text").notNull(),
  placeLat:         doublePrecision("place_lat"),
  placeLng:         doublePrecision("place_lng"),
  proposedStart:    timestamp("proposed_start", { withTimezone: true }).notNull(),
  firstSuggestedAt: timestamp("first_suggested_at", { withTimezone: true }).notNull(),
  promiseCount:     integer("promise_count").notNull().default(0),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── soft_promises ──────────────────────────────────────────────────────────
export const softPromises = pgTable("soft_promises", {
  id:        uuid("id").primaryKey().defaultRandom(),
  attemptId: uuid("attempt_id").notNull().references(() => formationAttempts.id, { onDelete: "cascade" }),
  optionId:  uuid("option_id").notNull(),
  userId:    uuid("user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── games ──────────────────────────────────────────────────────────────────
export const games = pgTable("games", {
  id:              uuid("id").primaryKey().defaultRandom(),
  activityTypeId:  uuid("activity_type_id").notNull().references(() => activityTypes.id),
  areaId:          uuid("area_id").notNull().references(() => areas.id),
  originAttemptId: uuid("origin_attempt_id"),
  winningOptionId: uuid("winning_option_id"),
  placeText:       text("place_text").notNull(),
  placeLat:        doublePrecision("place_lat"),
  placeLng:        doublePrecision("place_lng"),
  scheduledStart:  timestamp("scheduled_start", { withTimezone: true }).notNull(),
  status:          gameStatusEnum("status").notNull().default("STAGED"),
  confirmedCount:  integer("confirmed_count").notNull().default(0),
  isStanding:      boolean("is_standing").notNull().default(false),
  recurDow:        integer("recur_dow"),
  recurTime:       time("recur_time"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Game = typeof games.$inferSelect;

// ── game_roster ────────────────────────────────────────────────────────────
export const gameRoster = pgTable("game_roster", {
  gameId:    uuid("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  userId:    uuid("user_id").notNull().references(() => users.id),
  source:    text("source").notNull().default("soft_promise"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.gameId, t.userId] }),
]);

// ── notifications_sent ─────────────────────────────────────────────────────
export const notificationsSent = pgTable("notifications_sent", {
  id:        uuid("id").primaryKey().defaultRandom(),
  userId:    uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  attemptId: uuid("attempt_id").notNull().references(() => formationAttempts.id, { onDelete: "cascade" }),
  gameId:    uuid("game_id").references(() => games.id, { onDelete: "cascade" }),
  kind:      notificationKindEnum("kind").notNull(),
  channel:   notificationChannelEnum("channel").notNull(),
  sentAt:    timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_notif_once").on(t.userId, t.attemptId, t.kind, t.channel),
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
