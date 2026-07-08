#!/usr/bin/env node
/**
 * Idempotent database migration runner.
 *
 * Applies every db/migrations/*.sql that hasn't run yet, in filename order,
 * tracked in a `schema_migrations` table so each runs exactly once. Called from
 * the deploy (scripts/deploy_app.sh), so merged schema changes reach the
 * database automatically.
 *
 * The migration files are GENERATED from lib/db/schema.ts (the single source
 * of truth) with `npm run db:generate` — never hand-written. A brand-new
 * database needs nothing else: `apply` from empty builds the whole schema
 * (0000_baseline.sql) plus reference data. The e2e suite bootstraps its DB
 * through this same path, so every e2e run proves a fresh bootstrap works.
 *
 * Usage:
 *   node scripts/migrate.mjs            apply pending migrations (default)
 *   node scripts/migrate.mjs status     list applied / pending, change nothing
 *   node scripts/migrate.mjs baseline   mark all present files applied WITHOUT
 *                                       running them — one-time adoption for a
 *                                       database already at the latest schema
 *
 * Connection: DATABASE_URL_UNPOOLED (preferred for DDL) else DATABASE_URL.
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
  // Fail loud: a silent success here would let the deploy report "migrated" with
  // no DB, recreating the drift gap this exists to close. The deploy script
  // decides whether to even call us (it skips explicitly when no DB is set).
  console.error("[migrate] no DATABASE_URL / DATABASE_URL_UNPOOLED set");
  process.exit(1);
}

const isLocal = /(?:localhost|127\.0\.0\.1)/.test(url);
// Advisory-lock key so concurrent deploys/builds serialize (any stable int).
const LOCK_KEY = 4242424242;
const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();

const client = new pg.Client({
  connectionString: url,
  // Verify the server cert off the system CA bundle (Neon uses a public CA).
  // Local Docker Postgres has no TLS.
  ssl: isLocal ? false : { rejectUnauthorized: true },
});
await client.connect();
try {
  await client.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       filename   text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );
  // Serialize apply runs: a second concurrent deploy blocks here, then sees the
  // first deploy's recorded migrations and applies nothing. (Released on
  // disconnect in the finally.) status/baseline don't mutate, so they skip it.
  if (mode === "apply") await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);

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
