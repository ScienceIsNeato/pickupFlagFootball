#!/usr/bin/env bash
# Schema drift gate: proves that db/migrations applied to an EMPTY database
# produce exactly the schema the app queries (lib/db/schema.ts).
#
# How: on the local e2e Postgres, build two scratch databases —
#   drift_migrated : node scripts/migrate.mjs apply   (the prod bootstrap path)
#   drift_pushed   : drizzle-kit push                 (the ORM, verbatim)
# — then diff their normalized pg_dump schemas. Any difference means someone
# changed lib/db/schema.ts without regenerating migrations (npm run db:generate)
# or hand-edited a migration. Runs inside tests/e2e/run.sh and standalone via
# `npm run db:check`. pg_dump runs inside the container so client/server
# versions always match.
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

# Dump inside the container (matching pg_dump version), normalized: schema only,
# no owners/privileges/comments — just the DDL shape. The migration runner's own
# bookkeeping table (schema_migrations) exists only on the migrated side, so
# exclude it at dump time.
dump() {
  $COMPOSE exec -T postgres pg_dump --schema-only --no-owner --no-privileges \
    --exclude-table=schema_migrations -U mimeff -d "$1" \
    | grep -vE "^(--|SET |SELECT pg_catalog|\\\\)" | grep -v "^$"
}

OUT_DIR="$(mktemp -d)"
dump drift_migrated > "$OUT_DIR/migrated.sql"
dump drift_pushed   > "$OUT_DIR/pushed.sql"

if diff -u "$OUT_DIR/migrated.sql" "$OUT_DIR/pushed.sql"; then
  echo "  ✓ no drift: migrations ≡ lib/db/schema.ts"
else
  echo ""
  echo "  ✗ SCHEMA DRIFT: db/migrations and lib/db/schema.ts disagree (diff above:"
  echo "    < = what migrations build, > = what the app expects)."
  echo "    Fix: edit lib/db/schema.ts only, then run \`npm run db:generate\` and"
  echo "    commit the generated migration. Never hand-edit db/migrations/*.sql."
  exit 1
fi
