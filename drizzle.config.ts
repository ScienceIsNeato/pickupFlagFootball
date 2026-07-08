import { defineConfig } from "drizzle-kit";

/**
 * Single source of truth: lib/db/schema.ts. Migrations under db/migrations are
 * GENERATED from it (`npm run db:generate`), never hand-written — hand-editing
 * SQL alongside the ORM is exactly how the schema de-synced twice. drizzle-kit
 * keeps its diffing journal in db/migrations/meta; commit it with the SQL.
 *
 * The runner stays scripts/migrate.mjs (advisory lock, schema_migrations
 * tracking, Neon TLS) — drizzle-kit only generates files here.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./db/migrations",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
