#!/usr/bin/env bash
# Record the splash-gallery demo clips end to end: bring up the local stack,
# seed, build + start the app (with the e2e map seam so clips can centre the
# map), drive the four flows in Playwright, and convert the raw webm to
# optimised webm + mp4 loops under public/gallery/.
set -euo pipefail
cd "$(dirname "$0")/.."

DB_URL="postgres://mimeff:mimeff@127.0.0.1:55433/mimeff_test"  # pragma: allowlist secret
export DATABASE_URL="$DB_URL" DATABASE_URL_UNPOOLED="$DB_URL" DATABASE_DRIVER="node-postgres"
export EMAIL_TRANSPORT="smtp" SMTP_URL="smtp://127.0.0.1:11025"
unset BREVO_API_KEY 2>/dev/null || true

echo "▸ docker stack up (Postgres + Mailpit)"
docker compose -f tests/e2e/docker-compose.yml up -d --wait

echo "▸ schema + reference seed"
PGPASSWORD=mimeff psql "$DB_URL" -q -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
node scripts/migrate.mjs apply
PGPASSWORD=mimeff psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f tests/e2e/seed.sql

echo "▸ build app (NEXT_PUBLIC_E2E=1 for the map-centring seam)"
NEXT_PUBLIC_E2E=1 npm run build

echo "▸ start app on :3100"
lsof -ti tcp:3100 | xargs kill -9 2>/dev/null || true
APP_BASE_URL="http://127.0.0.1:3100" AUTH_URL="http://127.0.0.1:3100" NEXTAUTH_URL="http://127.0.0.1:3100" \
  AUTH_SECRET="e2e-test-secret-not-for-prod" NEXTAUTH_SECRET="e2e-test-secret-not-for-prod" AUTH_TRUST_HOST="true" \
  GOOGLE_CLIENT_ID="demo" GOOGLE_CLIENT_SECRET="demo" CRON_SECRET="demo" \
  STRIPE_SECRET_KEY="sk_test_demo" STRIPE_WEBHOOK_SECRET="whsec_demo" \
  npx next start -p 3100 > /tmp/demo-app.log 2>&1 &
APP_PID=$!
trap 'kill $APP_PID 2>/dev/null || true' EXIT
until curl -sf http://127.0.0.1:3100/terms -o /dev/null 2>/dev/null; do sleep 1; done
echo "  app up"

echo "▸ record clips"
node --import tsx tests/demos/record.mts

echo "▸ convert → public/gallery (webm + mp4, 960px wide)"
mkdir -p public/gallery
for name in show-interest join-game attend-week captain-pause; do
  raw="tests/demos/raw/${name}.webm"
  [ -f "$raw" ] || { echo "  ✗ missing $raw"; continue; }
  ffmpeg -y -i "$raw" -vf "scale=960:-2" -c:v libvpx-vp9 -b:v 0 -crf 34 -an -pix_fmt yuv420p "public/gallery/${name}.webm" -loglevel error
  ffmpeg -y -i "$raw" -vf "scale=960:-2" -c:v libx264 -crf 28 -an -movflags +faststart -pix_fmt yuv420p "public/gallery/${name}.mp4" -loglevel error
  # Poster (first-frame-ish), shown while the clip loads.
  ffmpeg -y -ss 1 -i "$raw" -frames:v 1 -vf "scale=960:-2" "public/gallery/${name}.jpg" -loglevel error
  echo "  ✓ ${name} (webm + mp4 + poster)"
done

echo "done → public/gallery/"
