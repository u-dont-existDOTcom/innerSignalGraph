#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."

verify_tmp="$(mktemp -d)"
h001_snapshot="$verify_tmp/H001-MOCK-RESULT.json"
bundle_snapshot="$verify_tmp/bundle.json"
status_before="$verify_tmp/status-before"
status_after="$verify_tmp/status-after"
git status --porcelain=v1 -z --untracked-files=all > "$status_before"
cp -p H001-MOCK-RESULT.json "$h001_snapshot"
cp -p guide-graphs/compiled/bundle.json "$bundle_snapshot"

restore_generated() {
  package_status=$?
  trap - EXIT
  set +e
  cleanup_status=0
  cp -p "$h001_snapshot" H001-MOCK-RESULT.json || cleanup_status=1
  cp -p "$bundle_snapshot" guide-graphs/compiled/bundle.json || cleanup_status=1
  git status --porcelain=v1 -z --untracked-files=all > "$status_after" || cleanup_status=1
  drift_status=0
  if ! cmp -s "$status_before" "$status_after"; then
    drift_status=1
    echo "FAIL package verification changed repository paths:" >&2
    node --input-type=module - "$status_before" "$status_after" <<'NODE'
import fs from "node:fs";

function entries(file) {
  return new Set(fs.readFileSync(file).toString("utf8").split("\0").filter(Boolean));
}

function displayPath(entry) {
  return /^[ MARCUD?!]{2} /.test(entry) ? entry.slice(3) : entry;
}

const before = entries(process.argv[2]);
const after = entries(process.argv[3]);
const changed = [...before].filter((entry) => !after.has(entry));
changed.push(...[...after].filter((entry) => !before.has(entry)));
for (const entry of [...new Set(changed.map(displayPath))].sort()) {
  process.stderr.write(`- ${JSON.stringify(entry)}\n`);
}
NODE
  fi
  rm -f "$h001_snapshot" "$bundle_snapshot" "$status_before" "$status_after"
  rmdir "$verify_tmp" 2>/dev/null || cleanup_status=1
  if (( package_status != 0 )); then
    exit "$package_status"
  fi
  if (( cleanup_status != 0 || drift_status != 0 )); then
    exit 1
  fi
  exit 0
}
trap restore_generated EXIT

./scripts/verify-package.sh
