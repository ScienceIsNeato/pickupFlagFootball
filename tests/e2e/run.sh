#!/usr/bin/env bash
# One command to run the full-stack e2e suite: brings up the local Docker stack
# (Postgres + Mailpit), builds the app's schema from the ORM, seeds fixed data,
# builds the app, generates the BDD specs, and runs them. Nothing is mocked and
# nothing talks to the internet.
set -euo pipefail
cd "$(dirname "$0")/../.."

DB_URL="postgres://mimeff:mimeff@127.0.0.1:55433/mimeff_test"

echo "▸ docker stack up (Postgres + Mailpit)"
docker compose -f tests/e2e/docker-compose.yml up -d --wait

echo "▸ schema (drizzle-kit push from lib/db/schema.ts)"
DATABASE_URL="$DB_URL" npx drizzle-kit push --config tests/e2e/drizzle.config.ts

echo "▸ seed reference data"
PGPASSWORD=mimeff psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f tests/e2e/seed.sql

echo "▸ build app"
npm run build

echo "▸ generate BDD specs from features"
npx bddgen --config tests/e2e/playwright.config.ts

echo "▸ run e2e"
npx playwright test --config tests/e2e/playwright.config.ts "$@"
