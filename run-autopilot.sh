#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

DRY_RUN=false
NO_LAUNCH=false
FORCE_VALIDATION=false
for arg in "$@"; do
  [[ "$arg" == "--dry-run" ]] && DRY_RUN=true
  [[ "$arg" == "--no-launch" ]] && NO_LAUNCH=true
  [[ "$arg" == "--force-validation" ]] && FORCE_VALIDATION=true
done

if [[ "$DRY_RUN" == true ]]; then
  if [[ -f .env ]]; then
    exec node --env-file=.env src/cli/autopilot.mjs "$@"
  else
    exec node src/cli/autopilot.mjs "$@"
  fi
fi

run_git_helper() {
  if [[ -f .env ]]; then
    node --env-file=.env "$@"
  else
    node "$@"
  fi
}

# Remote outages never block the already-installed local runtime.
run_git_helper src/cli/sync-diagnostics.mjs --flush-only >/dev/null || true
set +e
run_git_helper src/cli/git-update.mjs >/dev/null
UPDATE_STATUS=$?
set -e
if [[ $UPDATE_STATUS -eq 10 && "${INNER_SIGNAL_UPDATE_APPLIED:-0}" != "1" ]]; then
  exec env INNER_SIGNAL_UPDATE_APPLIED=1 "$ROOT/run-autopilot.sh" "$@"
fi
run_git_helper src/cli/sync-diagnostics.mjs --flush-only >/dev/null || true

# Normalize stale persisted settings before any strict config loader starts.
node src/cli/prepare-environment.mjs --quiet

if [[ "$NO_LAUNCH" == true ]]; then
  exec node --env-file=.env src/cli/autopilot.mjs "$@"
fi

mkdir -p .inner-signal-autopilot
BOOT_LOG=".inner-signal-autopilot/bootstrap-server.log"
URL_FILE=".inner-signal-autopilot/current-url.txt"
VALIDATED_FINGERPRINT_FILE=".inner-signal-autopilot/validated-runtime-fingerprint.txt"
: > "$BOOT_LOG"

PORT_VALUE="$(grep -E '^PORT=' .env | tail -1 | cut -d= -f2- || true)"
PORT_VALUE="${PORT_VALUE:-8787}"
LOCAL_URL="http://localhost:${PORT_VALUE}"
IPV4_URL="http://127.0.0.1:${PORT_VALUE}"

runtime_fingerprint() {
  node src/cli/runtime-fingerprint.mjs
}

# Hash only model/runtime settings whose resolution can require a server restart.
model_env_hash() {
  grep -E '^(INNER_SIGNAL_MODE|PORT|OPENAI_MODEL|ANTHROPIC_MODEL|ANTHROPIC_ESCALATION_MODEL|RESPONSE_RENDERER_MODEL|ADJUDICATOR_PROVIDER|THERAPY_PROCESSING_MODE|GUIDE_PACKET_ROOT)=' .env 2>/dev/null \
    | sort | sha256sum | awk '{print $1}'
}
ENV_HASH_BEFORE="$(model_env_hash)"

SERVER_PID=""
DEV_PID=""
DEV_TAIL_PID=""
PROGRESS_PID=""
FAILED_PROMOTION_SIGNATURE=""
cleanup() {
  if [[ -n "${DEV_TAIL_PID:-}" ]] && kill -0 "$DEV_TAIL_PID" 2>/dev/null; then
    kill "$DEV_TAIL_PID" 2>/dev/null || true
    wait "$DEV_TAIL_PID" 2>/dev/null || true
  fi
  if [[ -n "${DEV_PID:-}" ]] && kill -0 "$DEV_PID" 2>/dev/null; then
    kill "$DEV_PID" 2>/dev/null || true
    wait "$DEV_PID" 2>/dev/null || true
  fi
  if [[ -n "${PROGRESS_PID:-}" ]] && kill -0 "$PROGRESS_PID" 2>/dev/null; then
    kill "$PROGRESS_PID" 2>/dev/null || true
    wait "$PROGRESS_PID" 2>/dev/null || true
  fi
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  DEV_TAIL_PID=""
  DEV_PID=""
  PROGRESS_PID=""
  SERVER_PID=""
}
trap cleanup INT TERM EXIT


DEV_ENABLED="$(grep -E '^DEV_AUTOMATION_ENABLED=' .env | tail -1 | cut -d= -f2- || true)"
DEV_ENABLED="${DEV_ENABLED:-true}"
PROMOTION_MARKER_VALUE="$(grep -E '^DEV_PROMOTION_MARKER=' .env | tail -1 | cut -d= -f2- || true)"
PROMOTION_MARKER_VALUE="${PROMOTION_MARKER_VALUE:-./.inner-signal-autopilot/promotion-ready.json}"
if [[ "$PROMOTION_MARKER_VALUE" = /* ]]; then PROMOTION_MARKER="$PROMOTION_MARKER_VALUE"; else PROMOTION_MARKER="$ROOT/${PROMOTION_MARKER_VALUE#./}"; fi
DEV_LOG="$ROOT/.inner-signal-autopilot/development-worker.log"
PROGRESS_LOG="$ROOT/.inner-signal-autopilot/progress-sync.log"

start_progress_watcher() {
  if [[ "${INNER_SIGNAL_VALIDATION_SANDBOX:-0}" == "1" ]]; then
    return 0
  fi
  if [[ -n "${PROGRESS_PID:-}" ]] && kill -0 "$PROGRESS_PID" 2>/dev/null; then
    return 0
  fi
  mkdir -p .inner-signal-autopilot
  touch "$PROGRESS_LOG"
  node --env-file=.env src/cli/sync-progress.mjs --watch >>"$PROGRESS_LOG" 2>&1 &
  PROGRESS_PID=$!
}

start_dev_worker() {
  if [[ "$DEV_ENABLED" != "true" && "$DEV_ENABLED" != "1" && "$DEV_ENABLED" != "yes" && "$DEV_ENABLED" != "on" ]]; then
    return 0
  fi
  mkdir -p .inner-signal-autopilot
  touch "$DEV_LOG"
  node --env-file=.env src/cli/dev-worker.mjs --watch >>"$DEV_LOG" 2>&1 &
  DEV_PID=$!
  tail -n 0 -F "$DEV_LOG" &
  DEV_TAIL_PID=$!
  echo "Autonomous development worker is running locally (PID $DEV_PID)."
  echo "It will drain unresolved development incidents first, then advance safe engineering roadmap tasks without waiting for a new chat message."
}

wait_with_dev_supervisor() {
  while kill -0 "$SERVER_PID" 2>/dev/null; do
    if [[ -f "$PROMOTION_MARKER" ]]; then
      local promotion_signature
      promotion_signature="$(sha256sum "$PROMOTION_MARKER" | awk '{print $1}')"
      if [[ "$promotion_signature" != "$FAILED_PROMOTION_SIGNATURE" ]]; then
        echo
        echo "A restorative repair passed autonomous review and exact-case replay. Promoting it and restarting Inner Signal automatically..."
        cleanup
        SERVER_PID=""
        DEV_PID=""
        DEV_TAIL_PID=""
        if node --env-file=.env src/cli/promote-candidate.mjs "$PROMOTION_MARKER"; then
          trap - INT TERM EXIT
          exec ./run-autopilot.sh --force-validation
        fi

        FAILED_PROMOTION_SIGNATURE="$promotion_signature"
        echo "Promotion failed and was rolled back. Restarting the recovery/status service with the preserved runtime." >&2
        start_server
        start_progress_watcher
        open_browser "$LOCAL_URL" || true
        start_dev_worker
      fi
    fi
    sleep 2
  done
  wait "$SERVER_PID" 2>/dev/null || true
}


latest_action_code() {
  local file="$ROOT/.inner-signal-autopilot/latest.json"
  [[ -f "$file" ]] || return 0
  node -e 'const fs=require("fs");try{const x=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(x.actionCode||x.details?.actionCode||"")}catch{}' "$file" 2>/dev/null || true
}

claude_command_value() {
  local value
  value="$(grep -E '^CLAUDE_COMMAND=' .env 2>/dev/null | tail -1 | cut -d= -f2- || true)"
  value="${value%\"}"; value="${value#\"}"
  value="${value%\'}"; value="${value#\'}"
  printf '%s\n' "${value:-claude}"
}

codex_command_value() {
  local value
  value="$(grep -E '^CODEX_COMMAND=' .env 2>/dev/null | tail -1 | cut -d= -f2- || true)"
  value="${value%\"}"; value="${value#\"}"
  value="${value%\'}"; value="${value#\'}"
  printf '%s\n' "${value:-codex}"
}

recover_claude_auth_and_resume() {
  local claude_cmd
  claude_cmd="$(claude_command_value)"
  if [[ "${INNER_SIGNAL_CLAUDE_REAUTH_ATTEMPTED:-0}" == "1" ]]; then
    echo "Claude authentication still failed after the automatic re-login attempt." >&2
    echo "Run '$claude_cmd auth status' to inspect the account state. The runtime has preserved the interrupted stage." >&2
    return 1
  fi

  echo
  echo "Claude login expired. Opening the official interactive Claude login now."
  echo "Complete the browser sign-in once; Inner Signal will resume automatically afterward."
  echo "No API key, rerun command, or log upload is needed."
  echo

  cleanup
  SERVER_PID=""
  DEV_PID=""
  DEV_TAIL_PID=""
  trap - INT TERM EXIT

  if ! env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN "$claude_cmd" auth login; then
    echo "Claude interactive login did not complete successfully." >&2
    return 1
  fi
  if ! env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN "$claude_cmd" auth status >/dev/null 2>&1; then
    echo "Claude login returned, but 'claude auth status' still reports unauthenticated." >&2
    return 1
  fi

  echo
  echo "Claude authentication restored. Resuming the interrupted Inner Signal validation automatically..."
  export INNER_SIGNAL_CLAUDE_REAUTH_ATTEMPTED=1
  exec ./run-autopilot.sh --force-validation "$@"
}

health_ok() {
  node -e "Promise.any([fetch('${LOCAL_URL}/health'),fetch('${IPV4_URL}/health')]).then(async r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1
}

start_server() {
  : > "$BOOT_LOG"
  node --env-file=.env src/cli/serve.mjs >"$BOOT_LOG" 2>&1 &
  SERVER_PID=$!
  for _ in {1..80}; do
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
      echo "Inner Signal local server could not start."
      cat "$BOOT_LOG"
      return 1
    fi
    if health_ok; then
      printf '%s\n' "$LOCAL_URL" > "$URL_FILE"
      return 0
    fi
    sleep 0.1
  done
  echo "Inner Signal process started but did not become reachable on loopback."
  cat "$BOOT_LOG"
  return 1
}

open_browser() {
  local url="$1"
  if command -v xdg-open >/dev/null 2>&1; then
    (xdg-open "$url" >/dev/null 2>&1 || true) &
    return 0
  fi
  if command -v gio >/dev/null 2>&1; then
    (gio open "$url" >/dev/null 2>&1 || true) &
    return 0
  fi
  return 1
}

start_progress_watcher
start_server

echo
echo "Inner Signal is reachable locally at ${LOCAL_URL}"
echo "IPv4 fallback: ${IPV4_URL}"
open_browser "$LOCAL_URL" || true

CURRENT_FINGERPRINT="$(runtime_fingerprint)"
PRIOR_FINGERPRINT="$(cat "$VALIDATED_FINGERPRINT_FILE" 2>/dev/null || true)"
if [[ "$FORCE_VALIDATION" != true && -n "$PRIOR_FINGERPRINT" && "$CURRENT_FINGERPRINT" == "$PRIOR_FINGERPRINT" ]]; then
  echo "Validated runtime fingerprint is unchanged. Expensive H001/A001/model-validation stages are skipped on this launch."
  echo "Use ./run-autopilot.sh --force-validation only when you intentionally want to rerun the full validation campaign."
  echo "Inner Signal is ready: ${LOCAL_URL}"
  echo "Press Ctrl+C in this terminal to stop Inner Signal."
  start_dev_worker
  wait_with_dev_supervisor
  exit 0
fi

echo "Runtime or validated configuration changed. Background validation is continuing; you can use the app now."
echo

set +e
node --env-file=.env src/cli/autopilot.mjs --no-launch --external-launch "$@"
STATUS=$?
set -e
if [[ $STATUS -ne 0 ]]; then
  run_git_helper src/cli/sync-diagnostics.mjs --latest >/dev/null || true
  ACTION_CODE="$(latest_action_code)"
  if [[ "$ACTION_CODE" == "CLAUDE_REAUTH" ]]; then
    recover_claude_auth_and_resume "$@"
    exit $?
  fi
  if [[ "$ACTION_CODE" == "CODEX_REAUTH" ]]; then
    CODEX_CMD="$(codex_command_value)"
    cleanup
    SERVER_PID=""
    DEV_PID=""
    DEV_TAIL_PID=""
    trap - INT TERM EXIT
    exec env CODEX_COMMAND="$CODEX_CMD" INNER_SIGNAL_RESUME_COMMAND="./run-autopilot.sh" bash ./scripts/reauth-codex.sh "$@"
  fi
  echo
  echo "Validation stopped at a deterministic blocker. Inner Signal remains available for status and recovery export at ${LOCAL_URL}." >&2
  echo "The local development worker may continue bounded restorative repair; production therapy policy remains unchanged." >&2
  start_dev_worker
  wait_with_dev_supervisor
  exit "$STATUS"
fi

ENV_HASH_AFTER="$(model_env_hash)"
if [[ "$ENV_HASH_AFTER" != "$ENV_HASH_BEFORE" ]]; then
  cleanup
  SERVER_PID=""
  echo
  echo "Validation resolved updated model/runtime settings. Restarting the local server once..."
  start_progress_watcher
  start_server
  open_browser "$LOCAL_URL" || true
else
  echo
  echo "Validation complete. The already-running server uses the verified configuration; no restart was needed."
fi

# The fingerprint is written only after the complete validation campaign passed.
runtime_fingerprint > "$VALIDATED_FINGERPRINT_FILE"

echo
echo "Inner Signal is ready: ${LOCAL_URL}"
echo "Future launches of this unchanged build will skip the expensive validation campaign automatically."
echo "Press Ctrl+C in this terminal to stop Inner Signal."
echo

start_dev_worker
wait_with_dev_supervisor
