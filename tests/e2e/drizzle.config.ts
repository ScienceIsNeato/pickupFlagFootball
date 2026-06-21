import { defineConfig } from "drizzle-kit";

/**
 * Test-only drizzle config. Builds the e2e Postgres directly from the app's
 * authoritative ORM schema (lib/db/schema.ts) via `drizzle-kit push`, so the
 * test DB can never drift from what the app actually queries. (The repo's
 * hand-maintained db/schema.sql has drifted — missing zip_centroids and
 * area_captains — so we don't use it here.)
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
