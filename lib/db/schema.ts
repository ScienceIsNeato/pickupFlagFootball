import {
  pgTable, uuid, text, doublePrecision, bigint, jsonb, boolean, timestamp,
} from "drizzle-orm/pg-core";

/**
 * Drizzle mirror of db/schema.sql (the canonical DDL). Hand-maintained for typed
 * queries; the raw SQL stays authoritative. Add tables here as phases need them.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  displayName: text("display_name"),
  city: text("city"),
  zip: text("zip"),
  homeLat: doublePrecision("home_lat"),
  homeLng: doublePrecision("home_lng"),
  h3R5: bigint("h3_r5", { mode: "bigint" }),
  h3R6: bigint("h3_r6", { mode: "bigint" }),
  h3R7: bigint("h3_r7", { mode: "bigint" }),
  h3R8: bigint("h3_r8", { mode: "bigint" }),
  h3R9: bigint("h3_r9", { mode: "bigint" }),
  timezone: text("timezone"),
  pushSubscription: jsonb("push_subscription"),
  emailOptIn: boolean("email_opt_in").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
