#!/usr/bin/env node
/**
 * Idempotent database migration runner.
 *
 * Applies every db/migrations/NNN_*.sql that hasn't run yet, in filename order,
 * tracked in a `schema_migrations` table so each runs exactly once. Called from
 * the deploy (scripts/deploy_app.sh) and Vercel's build, so merged schema
 * changes reach the database automatically — the gap that left prod stuck at a
 * pre-015 schema.
 *
 * Usage:
 *   node scripts/migrate.mjs            apply pending migrations (default)
 *   node scripts/migrate.mjs status     list applied / pending, change nothing
 *   node scripts/migrate.mjs baseline   mark all present files applied WITHOUT
 *                                       running them — for adopting tracking on a
 *                                       database already at the latest schema
 *
 * Connection: DATABASE_URL_UNPOOLED (preferred for DDL) else DATABASE_URL.
 * No URL → no-op exit 0 (local dev without a DB shouldn't break the deploy).
 *
 * Note: db/schema.sql is the baseline snapshot; these numbered migrations are
 * increments on top of it. A brand-new database needs schema.sql applied first,
 * then `baseline` up to the snapshot point — this runner handles the ongoing
 * incremental case (the actual deploy gap).
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import pg from "pg";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS_DIR = join(root, "db", "migrations");
const mode = process.argv[2] ?? "apply";

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.log("[migrate] no DATABASE_URL — skipping (nothing to migrate)");
  process.exit(0);
}

const isLocal = /(?:localhost|127\.0\.0\.1)/.test(url);
const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();

const client = new pg.Client({
  connectionString: url,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});
await client.connect();
try {
  await client.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       filename   text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );
  const { rows } = await client.query("SELECT filename FROM schema_migrations");
  const applied = new Set(rows.map((r) => r.filename));
  const pending = files.filter((f) => !applied.has(f));

  if (mode === "status") {
    console.log(`[migrate] ${applied.size} applied, ${pending.length} pending`);
    for (const f of pending) console.log(`  pending: ${f}`);
    process.exit(0);
  }

  if (mode === "baseline") {
    for (const f of pending) {
      await client.query("INSERT INTO schema_migrations(filename) VALUES($1) ON CONFLICT DO NOTHING", [f]);
    }
    console.log(`[migrate] baselined ${pending.length} migration(s) as applied (not run)`);
    process.exit(0);
  }

  // apply (default)
  if (pending.length === 0) {
    console.log("[migrate] database is up to date");
    process.exit(0);
  }
  for (const f of pending) {
    const sql = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
    process.stdout.write(`[migrate] applying ${f} … `);
    try {
      await client.query("BEGIN");
      await client.query(sql); // simple-query protocol runs multi-statement files
      await client.query("INSERT INTO schema_migrations(filename) VALUES($1)", [f]);
      await client.query("COMMIT");
      console.log("ok");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      console.error(`FAILED\n[migrate] ${f}:`, e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  }
  console.log(`[migrate] applied ${pending.length} migration(s)`);
} finally {
  await client.end();
}
