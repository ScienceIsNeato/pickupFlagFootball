#!/usr/bin/env node
/**
 * Backfill areas.timezone from each area's centroid via tz-lookup.
 *
 * Migration 025 adds the column with a launch-market default ('America/Chicago').
 * This recomputes the precise IANA zone for every existing area — run it once
 * after deploying 025 so any pre-existing non-Central areas are corrected. New
 * areas already get the right zone at creation (ensureArea). Idempotent.
 *
 *   node --env-file=.env.local scripts/backfill-area-timezone.mjs
 *   node --env-file=.env.local scripts/backfill-area-timezone.mjs --dry-run
 *
 * Connection: DATABASE_URL_UNPOOLED (preferred) else DATABASE_URL.
 */
import pg from "pg";
import tzLookup from "tz-lookup";

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) { console.error("[backfill-tz] no DATABASE_URL / DATABASE_URL_UNPOOLED set"); process.exit(1); }
const dryRun = process.argv.includes("--dry-run");
const isLocal = /(?:localhost|127\.0\.0\.1)/.test(url);

const client = new pg.Client({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: true } });
await client.connect();
try {
  const { rows } = await client.query("select id, center_lat, center_lng, timezone from areas");
  let changed = 0;
  for (const a of rows) {
    const tz = tzLookup(a.center_lat, a.center_lng);
    if (tz === a.timezone) continue;
    changed++;
    console.log(`${dryRun ? "[dry-run] " : ""}${a.id}: ${a.timezone} -> ${tz}`);
    if (!dryRun) await client.query("update areas set timezone = $1 where id = $2", [tz, a.id]);
  }
  console.log(`[backfill-tz] ${rows.length} areas scanned, ${changed} ${dryRun ? "would change" : "updated"}`);
} finally {
  await client.end();
}
