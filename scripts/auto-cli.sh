#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DRY_RUN=false
SKIP_TESTS=false
NO_H001=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --skip-tests) SKIP_TESTS=true ;;
    --no-h001) NO_H001=true ;;
    -h|--help)
      cat <<'HELP'
Usage: ./run-all-cli.sh [--skip-tests] [--no-h001] [--dry-run]

Runs the deterministic local verification workflow:
  1. Preserve/create and migrate .env
  2. Run package tests
  3. Diagnose installed Codex and Claude CLIs
  4. Verify both subscription-backed model calls
  5. Run H001 only when both providers pass
  6. Produce one ZIP evidence bundle

No API keys are used. No source files are edited.
HELP
      exit 0
      ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

if "$DRY_RUN"; then
  cat <<JSON
{
  "ok": true,
  "mode": "dry-run",
  "stages": [
    "prepare-env",
    "tests",
    "cli-diagnostics",
    "cli-entitlement",
    "H001-hypnosis-compiler",
    "evidence-bundle"
  ],
  "skipTests": $SKIP_TESTS,
  "skipH001": $NO_H001
}
JSON
  exit 0
fi

for command in node npm; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required command not found: $command" >&2
    exit 127
  fi
done

if ! node "$ROOT/src/cli/check-runtime-requirements.mjs" --quiet; then
  exit 1
fi

if [[ ! -f .env ]]; then
  cp .env.cli.example .env
  echo "[auto-cli] created .env from .env.cli.example" >&2
fi

if [[ -x scripts/migrate-env-v030.sh ]]; then
  scripts/migrate-env-v030.sh >&2
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_DIR="$ROOT/runs/local-$STAMP"
mkdir -p "$RUN_DIR"
MARKER="$RUN_DIR/.start-marker"
touch "$MARKER"
SUMMARY="$RUN_DIR/summary.json"
FAIL_STEP=""
FINAL_OK=false
H001_RAN=false

write_summary() {
  local ok="$1"
  local completed="$2"
  node - "$SUMMARY" "$ok" "$completed" "$FAIL_STEP" "$H001_RAN" <<'NODE'
const fs = require('fs');
const [file, ok, completed, failStep, h001Ran] = process.argv.slice(2);
const body = {
  ok: ok === 'true',
  completed,
  failedStep: failStep || null,
  h001Ran: h001Ran === 'true',
  generatedAt: new Date().toISOString()
};
fs.writeFileSync(file, JSON.stringify(body, null, 2) + '\n');
NODE
}

json_true() {
  local file="$1"
  local expression="$2"
  node - "$file" "$expression" <<'NODE'
const fs = require('fs');
const [file, expression] = process.argv.slice(2);
try {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  let ok = false;
  if (expression === 'ok') ok = data.ok === true;
  if (expression === 'releaseable') ok = data.releaseable === true && data.status === 'releaseable';
  process.exit(ok ? 0 : 1);
} catch (error) {
  console.error(`Could not validate ${file}: ${error.message}`);
  process.exit(1);
}
NODE
}

bundle_evidence() {
  local bundle="$ROOT/inner-signal-evidence-$STAMP.zip"
  cp .env.cli.example "$RUN_DIR/env-example.txt"
  if [[ -f .env ]]; then
    # Record names only, never values.
    sed -n 's/^\([A-Z][A-Z0-9_]*\)=.*/\1=<configured>/p' .env > "$RUN_DIR/env-keys-only.txt"
  fi
  if [[ -d ledgers ]]; then
    find ledgers -maxdepth 1 -type f -name '*.json' -newer "$MARKER" -print0 2>/dev/null \
      | xargs -0 -r cp -t "$RUN_DIR" 2>/dev/null || true
  fi
  if command -v zip >/dev/null 2>&1; then
    (cd "$RUN_DIR" && zip -q -r "$bundle" .)
  elif command -v python3 >/dev/null 2>&1; then
    python3 - "$RUN_DIR" "$bundle" <<'PY'
import os, sys, zipfile
root, out = sys.argv[1:]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for base, _, files in os.walk(root):
        for name in files:
            p = os.path.join(base, name)
            z.write(p, os.path.relpath(p, root))
PY
  else
    echo "Neither zip nor python3 is available; evidence remains in $RUN_DIR" >&2
    return 0
  fi
  echo "$bundle"
}

run_stage() {
  local name="$1"
  shift
  echo "[auto-cli] $name: started" >&2
  if "$@"; then
    echo "[auto-cli] $name: completed" >&2
    return 0
  fi
  echo "[auto-cli] $name: failed" >&2
  FAIL_STEP="$name"
  return 1
}

if ! "$SKIP_TESTS"; then
  if ! run_stage tests bash -lc 'npm test > >(tee "$1/tests.log") 2> >(tee "$1/tests.stderr.log" >&2)' _ "$RUN_DIR"; then
    write_summary false tests
    BUNDLE="$(bundle_evidence || true)"
    echo "Verification stopped at tests. Evidence: ${BUNDLE:-$RUN_DIR}" >&2
    exit 1
  fi
fi

if ! run_stage cli-diagnostics bash -lc 'node --env-file=.env src/cli/diagnose-cli.mjs > >(tee "$1/cli-diagnostics.json") 2> >(tee "$1/cli-diagnostics.log" >&2)' _ "$RUN_DIR"; then
  write_summary false cli-diagnostics
  BUNDLE="$(bundle_evidence || true)"
  echo "Verification stopped at CLI diagnostics. Evidence: ${BUNDLE:-$RUN_DIR}" >&2
  exit 1
fi
if ! json_true "$RUN_DIR/cli-diagnostics.json" ok; then
  FAIL_STEP="cli-diagnostics-result"
  write_summary false cli-diagnostics
  BUNDLE="$(bundle_evidence || true)"
  echo "CLI diagnostics reported failure. Evidence: ${BUNDLE:-$RUN_DIR}" >&2
  exit 1
fi

if ! run_stage cli-entitlement bash -lc 'node --env-file=.env src/cli/check-cli.mjs > >(tee "$1/cli-entitlement-check.json") 2> >(tee "$1/cli-entitlement-progress.log" >&2)' _ "$RUN_DIR"; then
  write_summary false cli-entitlement
  BUNDLE="$(bundle_evidence || true)"
  echo "Verification stopped at entitlement. Evidence: ${BUNDLE:-$RUN_DIR}" >&2
  exit 1
fi
if ! json_true "$RUN_DIR/cli-entitlement-check.json" ok; then
  FAIL_STEP="cli-entitlement-result"
  write_summary false cli-entitlement
  BUNDLE="$(bundle_evidence || true)"
  echo "Entitlement check reported failure. Evidence: ${BUNDLE:-$RUN_DIR}" >&2
  exit 1
fi

if ! "$NO_H001"; then
  H001_RAN=true
  if ! run_stage H001 bash -lc 'node --env-file=.env src/cli/hypnosis-replay.mjs H001 > >(tee "$1/H001-cli-result.json") 2> >(tee "$1/H001-cli-progress.log" >&2)' _ "$RUN_DIR"; then
    write_summary false H001
    BUNDLE="$(bundle_evidence || true)"
    echo "Verification stopped at H001. Evidence: ${BUNDLE:-$RUN_DIR}" >&2
    exit 1
  fi
  if ! json_true "$RUN_DIR/H001-cli-result.json" releaseable; then
    FAIL_STEP="H001-result"
    write_summary false H001
    BUNDLE="$(bundle_evidence || true)"
    echo "H001 completed but was not releaseable. Evidence: ${BUNDLE:-$RUN_DIR}" >&2
    exit 1
  fi
fi

FINAL_OK=true
write_summary true complete
BUNDLE="$(bundle_evidence)"
cat <<EOF2

Inner Signal local verification completed.
Result: PASS
Evidence directory: $RUN_DIR
Evidence ZIP: $BUNDLE
EOF2
