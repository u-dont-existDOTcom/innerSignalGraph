#!/usr/bin/env bash
set -Eeuo pipefail

BASE="${INNER_SIGNAL_INSTALL_BASE:-$HOME/Téléchargements}"
SRC="$BASE/inner-signal-runtime-v0.14.4"
DEST="$BASE/inner-signal-runtime"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP="$BASE/inner-signal-runtime.rollback-$STAMP-$$"

if [[ ! -f "$SRC/package.json" ]]; then
  echo "BLOCKED: expected release tree at $SRC" >&2
  exit 1
fi
VERSION="$(node -p "require('$SRC/package.json').version")"
if [[ "$VERSION" != "0.14.4" ]]; then
  echo "BLOCKED: package identity mismatch: expected 0.14.4, found $VERSION" >&2
  exit 1
fi

TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

stop_managed_processes() {
  [[ -d "$DEST" ]] || return 0
  local patterns=(
    "$DEST/src/cli/serve.mjs"
    "$DEST/src/cli/dev-worker.mjs"
    "$DEST/.inner-signal-autopilot/development-worker.log"
  )
  local pids=()
  while IFS= read -r line; do
    local pid="${line%% *}"
    local cmd="${line#* }"
    for pattern in "${patterns[@]}"; do
      if [[ "$cmd" == *"$pattern"* ]]; then pids+=("$pid"); break; fi
    done
  done < <(ps -eo pid=,args= | sed -E 's/^ +//')
  if (( ${#pids[@]} )); then
    echo "Stopping ${#pids[@]} managed Inner Signal background process(es) before upgrade..."
    kill "${pids[@]}" 2>/dev/null || true
    for _ in {1..30}; do
      local alive=false
      for pid in "${pids[@]}"; do kill -0 "$pid" 2>/dev/null && alive=true; done
      [[ "$alive" == false ]] && break
      sleep 0.1
    done
  fi
}
stop_managed_processes

if [[ -d "$DEST" ]]; then
  [[ -f "$DEST/.env" ]] && cp -a "$DEST/.env" "$TMP/.env"
  [[ -d "$DEST/.inner-signal-autopilot" ]] && cp -a "$DEST/.inner-signal-autopilot" "$TMP/.inner-signal-autopilot"
  [[ -d "$DEST/.inner-signal-dev" ]] && cp -a "$DEST/.inner-signal-dev" "$TMP/.inner-signal-dev"
  [[ -d "$DEST/ledgers" ]] && cp -a "$DEST/ledgers" "$TMP/ledgers"
  [[ -d "$DEST/data" ]] && cp -a "$DEST/data" "$TMP/data"
  mv "$DEST" "$BACKUP"
fi

cp -a "$SRC" "$DEST"
[[ -f "$TMP/.env" ]] && cp -a "$TMP/.env" "$DEST/.env"
[[ -d "$TMP/.inner-signal-autopilot" ]] && { rm -rf "$DEST/.inner-signal-autopilot"; cp -a "$TMP/.inner-signal-autopilot" "$DEST/.inner-signal-autopilot"; }
[[ -d "$TMP/.inner-signal-dev" ]] && { rm -rf "$DEST/.inner-signal-dev"; cp -a "$TMP/.inner-signal-dev" "$DEST/.inner-signal-dev"; }
[[ -d "$TMP/ledgers" ]] && { rm -rf "$DEST/ledgers"; cp -a "$TMP/ledgers" "$DEST/ledgers"; }
[[ -d "$TMP/data" ]] && { rm -rf "$DEST/data"; cp -a "$TMP/data" "$DEST/data"; }

cd "$DEST"
if ! npm test; then
  echo "Install validation failed. Restoring prior runtime." >&2
  rm -rf "$DEST"
  if [[ -d "$BACKUP" ]]; then mv "$BACKUP" "$DEST"; fi
  exit 1
fi

if ! npm run graph:test; then
  echo "Guide-graph validation failed. Restoring prior runtime." >&2
  rm -rf "$DEST"
  if [[ -d "$BACKUP" ]]; then mv "$BACKUP" "$DEST"; fi
  exit 1
fi

echo "Installed Inner Signal runtime v0.14.4 cleanly."
echo "ZIP validation is now timezone-stable, and tests cannot rewrite the preserved r01/r02 candidate archives."
echo "Production r5 policy, Guide Packet candidates, owner decisions, configuration, and local runtime state remain preserved."
echo "A001 keeps its stage-aware extraction checkpoint and Codex audit-only retry/resume behavior."
if [[ -d "$BACKUP" ]]; then echo "Rollback copy: $BACKUP"; fi
if [[ "${INNER_SIGNAL_INSTALL_ONLY:-false}" == "true" ]]; then
  echo "Install-only verification requested; autopilot launch skipped."
  exit 0
fi
exec ./run-autopilot.sh
