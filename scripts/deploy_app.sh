#!/usr/bin/env bash
#
# deploy_app.sh — standardized way to build + start the MIME-FF Next.js server.
#
# Builds a production bundle and starts `next start` detached, tracking the
# pid/port/log in a /tmp lockfile so it can be inspected and stopped later.
# Mirrors the deploy_app.sh convention used across the other repos.
#
#   scripts/deploy_app.sh            # build + start (allocates a free port)
#   scripts/deploy_app.sh --status   # show running deployment(s)
#   scripts/deploy_app.sh --logs     # tail this repo's server log
#   scripts/deploy_app.sh --stop     # stop this repo's server
#   scripts/deploy_app.sh --help

set -euo pipefail

DEPLOY_DIR="/tmp/pickupflagfootball-deploys"
MAX_AGE_SECONDS=86400
PORT_RANGE_START="${PORT:-3000}"
PORT_RANGE_END=$((PORT_RANGE_START + 20))
READY_TIMEOUT=60

mkdir -p "$DEPLOY_DIR"

usage() {
  cat <<'EOF'
Usage:
  scripts/deploy_app.sh            Build and start the production server (detached)
  scripts/deploy_app.sh serve      Build and run in the FOREGROUND on a fixed
                                   port (used by the editor preview); reclaims
                                   the port if something else is on it
  scripts/deploy_app.sh --status   Show running deployment(s)
  scripts/deploy_app.sh --logs     Tail this repo's server log
  scripts/deploy_app.sh --stop     Stop this repo's server
  scripts/deploy_app.sh --help     Show this help

  Add --seed to a deploy/serve to load demo data after migrating, e.g.
    scripts/deploy_app.sh serve --seed
  The seed refuses any known production host and any production environment
  marker, so it can never touch prod (extra hosts via SEED_BLOCK_HOSTS).

Environment:
  PORT         Detached: preferred starting port (default 3000), a free port at
               or above it is chosen. serve: the exact port to bind (default 3000).
  SKIP_BUILD=1 serve: skip `next build` and serve the existing .next bundle.
               (Also skips --seed, which rides the build/migrate path.)
EOF
}

repo_root() { git rev-parse --show-toplevel 2>/dev/null || pwd; }
dir_hash() { printf '%s' "$1" | shasum -a 256 | awk '{print substr($1, 1, 12)}'; }
lockfile_for() { printf '%s/%s.json\n' "$DEPLOY_DIR" "$(dir_hash "$1")"; }
logfile_for() { printf '%s/%s.log\n' "$DEPLOY_DIR" "$(dir_hash "$1")"; }

is_pid_alive() { [[ "$1" =~ ^[1-9][0-9]*$ ]] && kill -0 "$1" 2>/dev/null; }

jq_field() {
  local json="$1" field="$2"
  echo "$json" | grep -o "\"$field\":[^,}]*" | head -1 \
    | sed "s/\"$field\"://;s/^[[:space:]]*\"//;s/\"[[:space:]]*$//" || true
}

die() { echo "ERROR: $1" >&2; exit 1; }
require_command() { command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"; }
ensure_prerequisites() {
  require_command curl; require_command git; require_command lsof
  require_command node; require_command npm; require_command shasum
}

local_ip() { ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true; }

# Apply any pending DB migrations before serving — keeps the database in sync with
# the deployed code (the gap that once left prod stuck at a pre-015 schema). The
# runner is tracked + idempotent, so this is a fast no-op when up to date. Reads
# .env.local locally; in CI/Vercel it uses the ambient DATABASE_URL.
# True if a database URL is actually available — from the environment, or defined
# inside .env.local (not merely that the file exists; an auth-only .env.local may
# have no DB).
has_db_url() {
  [[ -n "${DATABASE_URL:-}" || -n "${DATABASE_URL_UNPOOLED:-}" ]] && return 0
  [[ -f "$ROOT/.env.local" ]] && grep -qE '^(DATABASE_URL|DATABASE_URL_UNPOOLED)=' "$ROOT/.env.local"
}

# Optional demo-data seed (--seed). The seed script is the authoritative prod
# guard: it refuses any known production host (DATABASE_URL / DATABASE_URL_UNPOOLED
# / SEED_BLOCK_HOSTS) and any production environment marker, so this just invokes
# it — a refusal exits non-zero and (set -e) aborts the deploy before the running
# release is touched. Seeds throwaway Iowa City / Cedar Rapids demo interest so a
# fresh dev map isn't empty.
run_seed() {
  [[ "$SEED" == "1" ]] || return 0
  local script="$ROOT/scripts/seed-demo-interest.ts"
  [[ -f "$script" ]] || die "--seed requested but $script is missing"
  has_db_url || die "--seed requested but no database URL is configured"
  echo "Seeding demo data (--seed)..."
  if [[ -f "$ROOT/.env.local" ]]; then
    node --env-file="$ROOT/.env.local" --import tsx "$script"
  else
    node --import tsx "$script"
  fi
}

run_migrations() {
  local script="$ROOT/scripts/migrate.mjs"
  [[ -f "$script" ]] || { echo "  (no migrate script — skipping)"; return 0; }
  # Explicit local skip: no DB configured → don't migrate (and don't let the
  # runner's fail-loud-on-no-URL abort a local serve). With a DB, a failure here
  # aborts the deploy (set -e) before anything is torn down.
  if ! has_db_url; then
    echo "No database URL configured — skipping migrations."
    return 0
  fi
  echo "Applying database migrations..."
  if [[ -f "$ROOT/.env.local" ]]; then
    node --env-file="$ROOT/.env.local" "$script" apply
  else
    node "$script" apply
  fi
}

cleanup_stale() {
  local now; now=$(date +%s)
  for lockfile in "$DEPLOY_DIR"/*.json; do
    [[ -f "$lockfile" ]] || continue
    local data pid started_at dir
    data=$(cat "$lockfile")
    pid=$(jq_field "$data" "pid"); started_at=$(jq_field "$data" "startedAt"); dir=$(jq_field "$data" "dir")
    if [[ -z "$pid" ]] || ! is_pid_alive "$pid"; then
      echo "  Removing dead deployment: ${dir:-unknown} (pid ${pid:-none})"
      rm -f "$lockfile"; continue
    fi
    if [[ -n "$started_at" ]] && (( now - started_at > MAX_AGE_SECONDS )); then
      echo "  Killing stale deployment: $dir (pid $pid)"
      kill "$pid" 2>/dev/null || true; pkill -P "$pid" 2>/dev/null || true
      rm -f "$lockfile"
    fi
  done
}

stop_deployment() {
  local root="$1" lockfile; lockfile=$(lockfile_for "$root")
  if [[ ! -f "$lockfile" ]]; then echo "No active deployment for $root"; return 0; fi
  local data pid port; data=$(cat "$lockfile")
  pid=$(jq_field "$data" "pid"); port=$(jq_field "$data" "port")
  # Only stop the tracked process (+ its children) — never blanket-kill by port,
  # which could terminate an unrelated service that reused the port.
  local tick_pid; tick_pid=$(jq_field "$data" "tickPid")
  if [[ -n "$tick_pid" ]] && is_pid_alive "$tick_pid"; then
    echo "Stopping tick loop (pid $tick_pid)"
    pkill -P "$tick_pid" 2>/dev/null || true
    kill "$tick_pid" 2>/dev/null || true
  fi
  if [[ -n "$pid" ]] && is_pid_alive "$pid"; then
    echo "Stopping server on :$port (pid $pid)"
    pkill -P "$pid" 2>/dev/null || true
    kill "$pid" 2>/dev/null || true
  else
    echo "No tracked process for :$port"
  fi
  rm -f "$lockfile"; echo "Stopped."
}

find_free_port() {
  local port="$PORT_RANGE_START"
  while (( port < PORT_RANGE_END )); do
    if ! lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then echo "$port"; return 0; fi
    port=$((port + 1))
  done
  die "No free ports in range $PORT_RANGE_START-$PORT_RANGE_END"
}

# `serve` binds a FIXED port, so it must own it: evict whatever is already
# listening there (a stale instance, an orphaned server from a crashed run)
# before we bind, instead of dying on EADDRINUSE. TERM first, then KILL if it
# won't let go. This is deliberate for the fixed-port foreground mode — unlike
# the tracked-only stop_deployment, it reclaims the port no matter who holds it.
reclaim_port() {
  local port="$1" pids
  pids=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)
  [[ -z "$pids" ]] && return 0
  echo "Port $port is in use by pid(s) $(echo $pids | tr '\n' ' ')— taking it over."
  kill $pids 2>/dev/null || true
  for _ in $(seq 1 20); do
    pids=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)
    [[ -z "$pids" ]] && return 0
    sleep 0.25
  done
  echo "  still held — sending SIGKILL."
  kill -9 $pids 2>/dev/null || true
  sleep 0.5
  pids=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)
  [[ -z "$pids" ]] || die "Could not free port $port (pid(s) $(echo $pids | tr '\n' ' '))."
}

# stop_deployment only knows about processes we started. A server launched outside
# the script (a stray `next dev`, an orphan from a crashed run) still holds the
# preferred port, and find_free_port would silently drift to the next one — which is
# how you end up with two builds and no idea which one you're looking at. Reclaim the
# port, but ONLY from a process whose cwd is this repo: killing by port alone could
# take down an unrelated service that happens to be on 3000.
reclaim_own_port() {
  local port="$1" root="$2" pids pid cwd
  pids=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)
  [[ -z "$pids" ]] && return 0
  for pid in $pids; do
    cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)
    if [[ "$cwd" == "$root" ]]; then
      echo "  Reclaiming :$port from an untracked server in this repo (pid $pid)"
      kill "$pid" 2>/dev/null || true
      pkill -P "$pid" 2>/dev/null || true
    else
      echo "  NOTE: :$port is held by pid $pid (${cwd:-unknown dir}) — not ours, leaving it."
    fi
  done
  for _ in $(seq 1 20); do
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 || return 0
    sleep 0.25
  done
}

# The tick is the app's heartbeat: formation deadlines, weekly polls and chat
# digests all fire from it. In dev/prod it self-schedules through Cloud Tasks, which
# doesn't exist locally — so without this, a local deploy is an app whose engine
# never runs, and mail simply never arrives. Runs as a child of the deploy and dies
# with it.
start_tick() {
  local port="$1" root="$2" log="$3" secret interval
  secret=$(grep -E '^CRON_SECRET=' "$root/.env.local" 2>/dev/null | cut -d= -f2- | tr -d "\"'" || true)
  if [[ -z "$secret" ]]; then
    echo "  (no CRON_SECRET in .env.local — tick loop not started)"
    TICK_PID=""
    return 0
  fi
  interval="${TICK_INTERVAL:-60}"
  # Secret goes through the environment, not argv, so it stays out of `ps`.
  CRON_SECRET="$secret" \
  TICK_URL="http://127.0.0.1:$port/api/mime/tick" \
  TICK_INTERVAL="$interval" \
  nohup bash -c 'while true; do
      curl -sS -X POST -H "Authorization: Bearer $CRON_SECRET" "$TICK_URL" >/dev/null 2>&1 || true
      sleep "$TICK_INTERVAL"
    done' >>"$log" 2>&1 </dev/null &
  TICK_PID=$!
  disown "$TICK_PID" 2>/dev/null || true
  echo "  Tick loop running every ${interval}s (pid $TICK_PID)"
}

show_status() {
  local now found=0; now=$(date +%s)
  for lockfile in "$DEPLOY_DIR"/*.json; do
    [[ -f "$lockfile" ]] || continue
    local data pid dir port started_at branch alive="dead" age="?"
    data=$(cat "$lockfile")
    pid=$(jq_field "$data" "pid"); dir=$(jq_field "$data" "dir"); port=$(jq_field "$data" "port")
    started_at=$(jq_field "$data" "startedAt"); branch=$(jq_field "$data" "branch")
    is_pid_alive "$pid" && alive="running"
    [[ -n "$started_at" ]] && age="$(((now - started_at) / 60))m"
    echo "  :$port  $alive  $age  $branch  $dir"
    found=1
  done
  (( found == 0 )) && echo "  No active deployments."
}

show_logs() {
  local root="$1" lockfile; lockfile=$(lockfile_for "$root")
  [[ -f "$lockfile" ]] || die "No active deployment for $root"
  local log_file; log_file=$(jq_field "$(cat "$lockfile")" "log")
  [[ -n "$log_file" && -f "$log_file" ]] || die "No tracked log file for $root"
  tail -f "$log_file"
}

ACTION="deploy"
SEED=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    serve|--foreground) ACTION="serve"; shift ;;
    --stop) ACTION="stop"; shift ;;
    --status) ACTION="status"; shift ;;
    --logs) ACTION="logs"; shift ;;
    --seed) SEED=1; shift ;;  # modifier: seed demo data after migrating (deploy/serve)
    --help|-h) ACTION="help"; shift ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 1 ;;
  esac
done

ROOT=$(repo_root)
BRANCH=$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")

case "$ACTION" in
  help) usage; exit 0 ;;
  stop) ensure_prerequisites; stop_deployment "$ROOT"; exit 0 ;;
  status) ensure_prerequisites; echo "MIME-FF deployments:"; cleanup_stale; show_status; exit 0 ;;
  logs) ensure_prerequisites; show_logs "$ROOT"; exit 0 ;;
  serve)
    # Foreground production server on a fixed port — the editor preview owns the
    # process lifecycle, so no nohup/lockfile. exec replaces this shell so the
    # preview tracks `next start` directly.
    ensure_prerequisites
    cd "$ROOT"
    NEXT_BIN="$ROOT/node_modules/.bin/next"
    [[ -x "$NEXT_BIN" ]] || die "next is not installed. Run npm install first."
    if [[ "${SKIP_BUILD:-}" != "1" ]]; then
      # Migrate only when we're (re)building — SKIP_BUILD serves the existing
      # bundle as-is, so don't move the schema out from under stale code.
      run_migrations
      run_seed  # no-op unless --seed; self-guards against prod
      echo "Building (set SKIP_BUILD=1 to skip)..."
      npm run build
    else
      echo "SKIP_BUILD=1 — serving the existing bundle; skipping migrations."
    fi
    SERVE_PORT="${PORT:-3000}"
    reclaim_port "$SERVE_PORT"
    echo "Serving MIME-FF in the foreground on 0.0.0.0:$SERVE_PORT"
    exec "$NEXT_BIN" start -p "$SERVE_PORT" -H 0.0.0.0
    ;;
esac

ensure_prerequisites
cd "$ROOT"

NEXT_BIN="$ROOT/node_modules/.bin/next"
[[ -x "$NEXT_BIN" ]] || die "next is not installed. Run npm install first."

echo "=== MIME-FF deploy ==="
echo "Dir:    $ROOT"
echo "Branch: $BRANCH"
echo ""

# Migrate BEFORE tearing down the running release — if a migration fails, the
# old (healthy) process keeps serving instead of going down with it. Same for the
# optional --seed: a prod-guard refusal aborts here, before the release is touched.
run_migrations
run_seed

echo "Cleaning stale deployments..."
cleanup_stale
stop_deployment "$ROOT"
# ...and take back the preferred port if an untracked server of ours is squatting it,
# so a re-deploy lands where you expect instead of quietly moving to the next port.
reclaim_own_port "$PORT_RANGE_START" "$ROOT"

echo "Building..."
npm run build

PORT_TO_USE=$(find_free_port)
LOG_FILE=$(logfile_for "$ROOT")
rm -f "$LOG_FILE"

echo ""
echo "Allocated port: $PORT_TO_USE"
echo "Starting server..."
nohup "$NEXT_BIN" start -p "$PORT_TO_USE" -H 0.0.0.0 >"$LOG_FILE" 2>&1 < /dev/null &
SERVER_PID=$!
disown "$SERVER_PID" 2>/dev/null || true

READY=0
for _ in $(seq 1 "$READY_TIMEOUT"); do
  if ! is_pid_alive "$SERVER_PID"; then break; fi
  if curl --silent --show-error --fail --max-time 2 "http://127.0.0.1:$PORT_TO_USE/" >/dev/null 2>&1; then
    READY=1; break
  fi
  sleep 1
done

if [[ "$READY" != "1" ]]; then
  echo "ERROR: server did not become ready. Log:" >&2
  sed -n '1,160p' "$LOG_FILE" 2>/dev/null || true
  is_pid_alive "$SERVER_PID" && { kill "$SERVER_PID" 2>/dev/null || true; }
  exit 1
fi

echo "Starting tick loop..."
start_tick "$PORT_TO_USE" "$ROOT" "$LOG_FILE"

NOW=$(date +%s)
ROOT="$ROOT" BRANCH="$BRANCH" PORT="$PORT_TO_USE" PID="$SERVER_PID" NOW="$NOW" LOG="$LOG_FILE" \
  TICK_PID="${TICK_PID:-}" \
  node -e "process.stdout.write(JSON.stringify({
    dir: process.env.ROOT, branch: process.env.BRANCH,
    port: Number(process.env.PORT), pid: Number(process.env.PID),
    tickPid: process.env.TICK_PID ? Number(process.env.TICK_PID) : null,
    startedAt: Number(process.env.NOW), log: process.env.LOG,
  }) + '\n')" > "$(lockfile_for "$ROOT")"

LAN=$(local_ip)
echo ""
echo "========================================"
echo "  MIME-FF is live:"
echo "  http://127.0.0.1:$PORT_TO_USE/"
[[ -n "$LAN" ]] && echo "  http://$LAN:$PORT_TO_USE/   (LAN / phone)"
echo ""
echo "  Branch: $BRANCH"
echo "  PID:    $SERVER_PID"
echo "  Log:    $LOG_FILE"
[[ -n "${TICK_PID:-}" ]] && echo "  Tick:   every ${TICK_INTERVAL:-60}s (pid $TICK_PID)"
echo "  Stop:   scripts/deploy_app.sh --stop"
echo "  Status: scripts/deploy_app.sh --status"
echo "  Logs:   scripts/deploy_app.sh --logs"
echo "========================================"
