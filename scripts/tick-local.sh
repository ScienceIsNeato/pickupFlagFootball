#!/usr/bin/env bash
# Fire the engine tick against a local dev server.
#
# In dev/prod the tick self-schedules through Cloud Tasks; locally nothing does, so
# chat digests (and the weekly poll) would sit armed forever. This pokes it by hand.
# Reads CRON_SECRET straight out of .env.local so the secret never lands in your
# shell history.
set -euo pipefail
PORT="${PORT:-3000}"
SECRET="$(grep -E '^CRON_SECRET=' .env.local | cut -d= -f2- | tr -d '"'"'"'')"
if [ -z "$SECRET" ]; then echo "no CRON_SECRET in .env.local" >&2; exit 1; fi
curl -sS -X POST "http://localhost:${PORT}/api/mime/tick" \
  -H "Authorization: Bearer ${SECRET}" | python3 -m json.tool 2>/dev/null || true
echo
