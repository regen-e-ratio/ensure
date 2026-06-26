#!/usr/bin/env bash
#
# Deploy the Ensure services (server + client) as background processes.
#
# Re-running this script performs a *substituting* redeploy: any previously
# deployed instances are stopped (by recorded PID, with a port-based fallback)
# before the freshly built ones are started, so there is never more than one
# copy of a service running.
#
# Usage:
#   scripts/deploy.sh            # (re)deploy both services in the background
#   scripts/deploy.sh up         # same as the default
#   scripts/deploy.sh stop       # stop the running services and exit
#   scripts/deploy.sh restart    # alias for `up`
#   scripts/deploy.sh status     # report whether each service is running
#   scripts/deploy.sh logs       # tail -f both service logs
#
# Runtime state (PID + log files) lives under .deploy/ (git-ignored).
# The server still requires a valid server/.env — see README "Manual setup".

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT/.deploy"
mkdir -p "$RUN_DIR"

# service name | listening port | start command (run from $ROOT)
SERVICES=(
  "server|3000|npm run start --workspace server"
  "client|5173|npm run dev --workspace client"
)

log() { printf '\033[1;34m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[deploy]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m[deploy]\033[0m %s\n' "$*" >&2; exit 1; }

# --- stop helpers -----------------------------------------------------------

# Kill anything still bound to a TCP port (fallback when a PID file is stale).
kill_port() {
  local port="$1" pids=""
  if command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null || true)"
  elif command -v fuser >/dev/null 2>&1; then
    pids="$(fuser -n tcp "$port" 2>/dev/null || true)"
  fi
  if [[ -n "$pids" ]]; then
    # shellcheck disable=SC2086
    kill -TERM $pids 2>/dev/null || true
    sleep 1
    # shellcheck disable=SC2086
    kill -KILL $pids 2>/dev/null || true
  fi
}

stop_service() {
  local name="$1" port="$2" pidfile="$RUN_DIR/$name.pid"

  if [[ -f "$pidfile" ]]; then
    local pid; pid="$(cat "$pidfile" 2>/dev/null || true)"
    if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
      log "stopping $name (pid $pid)"
      # Negative pid targets the whole process group (started with setsid),
      # so tsx/vite child processes are torn down too.
      kill -TERM -"$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
      for _ in $(seq 1 25); do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.2
      done
      if kill -0 "$pid" 2>/dev/null; then
        kill -KILL -"$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
      fi
    fi
    rm -f "$pidfile"
  fi

  # Belt and braces: free the port even if the PID file was lost.
  kill_port "$port"
}

stop_all() {
  for entry in "${SERVICES[@]}"; do
    IFS='|' read -r name port _cmd <<<"$entry"
    stop_service "$name" "$port"
  done
}

# --- start helpers ----------------------------------------------------------

start_service() {
  local name="$1" cmd="$2" pidfile="$RUN_DIR/$name.pid" logfile="$RUN_DIR/$name.log"

  log "starting $name -> $logfile"
  # setsid puts the service in its own session/process group so we can later
  # signal the entire group; exec makes the recorded PID the group leader.
  setsid bash -c "cd '$ROOT' && exec $cmd" >"$logfile" 2>&1 &
  local pid=$!
  echo "$pid" >"$pidfile"

  # Quick liveness check so an immediate crash (e.g. missing .env) is visible.
  sleep 1
  if ! kill -0 "$pid" 2>/dev/null; then
    warn "$name exited immediately — last log lines:"
    tail -n 20 "$logfile" >&2 || true
    rm -f "$pidfile"
    die "failed to start $name"
  fi
  log "$name running (pid $pid)"
}

build() {
  log "generating API types (gen:api)"
  (cd "$ROOT" && npm run gen:api)
}

up() {
  command -v npm >/dev/null 2>&1 || die "npm not found on PATH"
  [[ -f "$ROOT/server/.env" ]] || warn "server/.env not found — the server will refuse to boot (see README)"

  log "redeploying: stopping any existing services first"
  stop_all
  build
  for entry in "${SERVICES[@]}"; do
    IFS='|' read -r name _port cmd <<<"$entry"
    start_service "$name" "$cmd"
  done
  log "done. server: http://localhost:3000  client: http://localhost:5173"
  log "logs: scripts/deploy.sh logs   |   stop: scripts/deploy.sh stop"
}

status() {
  for entry in "${SERVICES[@]}"; do
    IFS='|' read -r name port _cmd <<<"$entry"
    local pidfile="$RUN_DIR/$name.pid" pid=""
    [[ -f "$pidfile" ]] && pid="$(cat "$pidfile" 2>/dev/null || true)"
    if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
      printf '  %-7s running   pid %-7s port %s\n' "$name" "$pid" "$port"
    else
      printf '  %-7s stopped             port %s\n' "$name" "$port"
    fi
  done
}

logs() {
  local files=()
  for entry in "${SERVICES[@]}"; do
    IFS='|' read -r name _port _cmd <<<"$entry"
    files+=("$RUN_DIR/$name.log")
  done
  log "tailing ${files[*]} (Ctrl-C to stop)"
  tail -n 40 -f "${files[@]}"
}

case "${1:-up}" in
  up|restart|deploy) up ;;
  stop|down) stop_all; log "all services stopped" ;;
  status) status ;;
  logs) logs ;;
  *) die "unknown command '$1' (use: up | stop | restart | status | logs)" ;;
esac
