#!/usr/bin/env bash
# Schema drift gate: proves that db/migrations applied to an EMPTY database
# produce exactly the schema the app queries (lib/db/schema.ts).
#
# How: on the local e2e Postgres, build two scratch databases —
#   drift_migrated : node scripts/migrate.mjs apply   (the prod bootstrap path)
#   drift_pushed   : drizzle-kit push                 (the ORM, verbatim)
# — then compare a normalized, name-sorted fingerprint of each (columns +
# constraints + indexes from the catalogs). Any difference means someone changed
# lib/db/schema.ts without regenerating migrations (npm run db:generate) or
# hand-edited a migration.
#
# Why catalogs sorted by name, not pg_dump: `ALTER TABLE ADD COLUMN` always
# appends physically, so a column added anywhere but the end of the ORM table
# would differ from the migrated DB in PHYSICAL ORDER only — semantically
# irrelevant in Postgres. Sorting by name makes the gate insensitive to column
# order while still catching real drift (a missing/renamed/retyped column,
# constraint, or index). Runs inside tests/e2e/run.sh and via `npm run db:check`.
set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE="docker compose -f tests/e2e/docker-compose.yml"
# throwaway creds for the local ephemeral e2e container (tests/e2e/docker-compose.yml)
PSQL_ADMIN="postgres://mimeff:mimeff@127.0.0.1:55433/mimeff_test"  # pragma: allowlist secret

echo "  ▸ ensuring e2e Postgres is up"
$COMPOSE up -d --wait postgres >/dev/null

for db in drift_migrated drift_pushed; do
  PGPASSWORD=mimeff psql "$PSQL_ADMIN" -q -c "DROP DATABASE IF EXISTS $db;" -c "CREATE DATABASE $db;"
done

BASE="postgres://mimeff:mimeff@127.0.0.1:55433"  # pragma: allowlist secret

echo "  ▸ building drift_migrated via migrate.mjs (fresh-bootstrap path)"
DATABASE_URL="$BASE/drift_migrated" DATABASE_URL_UNPOOLED="$BASE/drift_migrated" \
  node scripts/migrate.mjs apply >/dev/null

echo "  ▸ building drift_pushed via drizzle-kit push (the ORM)"
DATABASE_URL="$BASE/drift_pushed" \
  npx drizzle-kit push --force >/dev/null

# Structural fingerprint: columns, constraints, and indexes, each sorted by name.
# schema_migrations (the runner's own bookkeeping table) exists only on the
# migrated side, so exclude it everywhere.
COLS="select table_name||'.'||column_name||' '||data_type||' null='||is_nullable||' def='||coalesce(column_default,'-') from information_schema.columns where table_schema='public' and table_name<>'schema_migrations' order by 1;"
CONS="select c.conrelid::regclass::text||' '||c.conname||' '||pg_get_constraintdef(c.oid) from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace where n.nspname='public' and t.relname<>'schema_migrations' order by 1;"
IDX="select indexdef from pg_indexes where schemaname='public' and tablename<>'schema_migrations' order by 1;"

fingerprint() {
  for q in "$COLS" "$CONS" "$IDX"; do
    PGPASSWORD=mimeff psql "$BASE/$1" -tA -c "$q"
  done
}

OUT_DIR="$(mktemp -d)"
fingerprint drift_migrated > "$OUT_DIR/migrated.txt"
fingerprint drift_pushed   > "$OUT_DIR/pushed.txt"

if diff -u "$OUT_DIR/migrated.txt" "$OUT_DIR/pushed.txt"; then
  echo "  ✓ no drift: migrations ≡ lib/db/schema.ts"
else
  echo ""
  echo "  ✗ SCHEMA DRIFT: db/migrations and lib/db/schema.ts disagree (diff above:"
  echo "    < = what migrations build, > = what the app expects)."
  echo "    Fix: edit lib/db/schema.ts only, then run \`npm run db:generate\` and"
  echo "    commit the generated migration. Never hand-edit db/migrations/*.sql."
  exit 1
fi
