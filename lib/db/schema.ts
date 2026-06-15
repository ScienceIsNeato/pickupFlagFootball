import {
  pgTable, pgEnum, uuid, text, doublePrecision, bigint, jsonb, boolean,
  timestamp, integer, primaryKey, index, uniqueIndex,
} from "drizzle-orm/pg-core";

// ── enums ──────────────────────────────────────────────────────────────────
export const areaStatusEnum = pgEnum("area_status", [
  "DORMANT", "PRIMED", "IN_FORMATION", "SCHEDULED", "STALLED",
]);

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
  baseH3Res:   integer("base_h3_res").notNull().default(7),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ActivityType = typeof activityTypes.$inferSelect;

// ── users ──────────────────────────────────────────────────────────────────
export const users = pgTable("users", {
  id:               uuid("id").primaryKey().defaultRandom(),
  email:            text("email").notNull().unique(),
  displayName:      text("display_name"),
  city:             text("city"),
  zip:              text("zip"),
  homeLat:          doublePrecision("home_lat"),
  homeLng:          doublePrecision("home_lng"),
  h3R5:             bigint("h3_r5", { mode: "bigint" }),
  h3R6:             bigint("h3_r6", { mode: "bigint" }),
  h3R7:             bigint("h3_r7", { mode: "bigint" }),
  h3R8:             bigint("h3_r8", { mode: "bigint" }),
  h3R9:             bigint("h3_r9", { mode: "bigint" }),
  timezone:         text("timezone"),
  pushSubscription: jsonb("push_subscription"),
  emailOptIn:       boolean("email_opt_in").notNull().default(true),
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
  status:         areaStatusEnum("status").notNull().default("DORMANT"),
  stallCount:     integer("stall_count").notNull().default(0),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
