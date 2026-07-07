#!/usr/bin/env bash
# One command to run the full-stack e2e suite: brings up the local Docker stack
# (Postgres + Mailpit), builds the schema via the real migration path, checks it
# matches the ORM, seeds fixed data, builds the app, generates the BDD specs,
# and runs them. Nothing is mocked and nothing talks to the internet.
set -euo pipefail
cd "$(dirname "$0")/../.."

DB_URL="postgres://mimeff:mimeff@127.0.0.1:55433/mimeff_test"

# Fail closed: pin every seam to local e2e backends so an ambient DATABASE_URL /
# BREVO_API_KEY in the shell can never route these tests at a real service.
# (Playwright's webServer.env re-pins the app process too; this covers the
# migration runner and any tooling run directly from this script.)
export DATABASE_URL="$DB_URL"
export DATABASE_URL_UNPOOLED="$DB_URL"   # migrate.mjs prefers this — pin it too
export DATABASE_DRIVER="node-postgres"
export EMAIL_TRANSPORT="smtp"
export SMTP_URL="smtp://127.0.0.1:11025"
unset BREVO_API_KEY

echo "▸ docker stack up (Postgres + Mailpit)"
docker compose -f tests/e2e/docker-compose.yml up -d --wait

echo "▸ schema (migrate.mjs apply from empty — the same path a fresh prod uses)"
# Rebuild from scratch through the real migration runner, so every e2e run
# proves a brand-new database bootstraps correctly from db/migrations alone.
PGPASSWORD=mimeff psql "$DB_URL" -q -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
node scripts/migrate.mjs apply

echo "▸ drift check (migrations ≡ lib/db/schema.ts)"
bash scripts/check-schema-drift.sh

echo "▸ seed reference data"
PGPASSWORD=mimeff psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f tests/e2e/seed.sql

echo "▸ build app (with the e2e map seam)"
NEXT_PUBLIC_E2E=1 npm run build

echo "▸ generate BDD specs from features"
npx bddgen --config tests/e2e/playwright.config.ts

echo "▸ free port 3100 (so Playwright starts a fresh, e2e-env server)"
lsof -ti tcp:3100 | xargs kill -9 2>/dev/null || true

echo "▸ run e2e"
npx playwright test --config tests/e2e/playwright.config.ts "$@"
