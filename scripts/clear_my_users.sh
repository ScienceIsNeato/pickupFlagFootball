#!/usr/bin/env bash
#
# clear_my_users.sh — wipe the recurring test accounts (quarkswithforks /
# unique.will.martin / martin.family) so you can re-run the registration and
# email-verification flow from a clean slate. FK-safe and idempotent.
#
#   ./scripts/clear_my_users.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."   # repo root

# match by local-part prefix so the gmail domain (or +tags) doesn't matter
WHERE="email ilike 'quarkswithforks%' or email ilike 'unique.will.martin%' or email ilike 'martin.family%'"

SQL="$(mktemp)"
trap 'rm -f "$SQL"' EXIT
cat > "$SQL" <<EOF
-- delete non-cascade references first, then the users themselves (which cascades
-- interest_signals / game_attendance / area_captains / notifications_sent)
delete from soft_promises where user_id in (select id from users where $WHERE);
delete from game_roster  where user_id in (select id from users where $WHERE);
delete from suggestions  where user_id in (select id from users where $WHERE);
delete from users where $WHERE;
EOF

node --env-file=.env.local scripts/apply-sql.mjs "$SQL" >/dev/null
echo "✓ cleared test users: quarkswithforks / unique.will.martin / martin.family"
