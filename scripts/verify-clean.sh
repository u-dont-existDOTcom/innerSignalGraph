#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."

h001_snapshot="$(mktemp)"
bundle_snapshot="$(mktemp)"
cp -p H001-MOCK-RESULT.json "$h001_snapshot"
cp -p guide-graphs/compiled/bundle.json "$bundle_snapshot"

restore_generated() {
  status=$?
  trap - EXIT
  cp -p "$h001_snapshot" H001-MOCK-RESULT.json
  cp -p "$bundle_snapshot" guide-graphs/compiled/bundle.json
  rm -f "$h001_snapshot" "$bundle_snapshot"
  exit "$status"
}
trap restore_generated EXIT

./scripts/verify-package.sh
