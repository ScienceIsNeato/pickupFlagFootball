#!/usr/bin/env bash
# Fire the engine tick once against the local deployment.
#
# scripts/deploy_app.sh already runs a tick loop for you, so this is only for
# "don't make me wait for the next one" while testing. The port comes from the
# deploy lockfile rather than a guess, because deploy_app.sh allocates the first
# FREE port from 3000 up and you won't always land on 3000. CRON_SECRET is read
# from .env.local so it never reaches your shell history.
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
HASH="$(printf '%s' "$ROOT" | shasum -a 256 | awk '{print substr($1, 1, 12)}')"
LOCK="/tmp/pickupflagfootball-deploys/${HASH}.json"

if [ -n "${PORT:-}" ]; then
  TARGET="$PORT"
elif [ -f "$LOCK" ]; then
  TARGET="$(node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('$LOCK','utf8')).port||''))")"
else
  TARGET=3000
fi
[ -n "$TARGET" ] || TARGET=3000

SECRET="$(grep -E '^CRON_SECRET=' "$ROOT/.env.local" 2>/dev/null | cut -d= -f2- | tr -d "\"'" || true)"
if [ -z "$SECRET" ]; then echo "no CRON_SECRET in .env.local" >&2; exit 1; fi

echo "ticking :$TARGET"
curl -sS -X POST "http://127.0.0.1:${TARGET}/api/mime/tick" \
  -H "Authorization: Bearer ${SECRET}" | python3 -m json.tool 2>/dev/null || true
echo
