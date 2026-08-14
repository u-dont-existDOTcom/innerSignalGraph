#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."

verify_tmp="$(mktemp -d)"
snapshot_root="$verify_tmp/present"
absent_root="$verify_tmp/absent"
status_before="$verify_tmp/status-before"
status_after="$verify_tmp/status-after"
generated_paths=(
  "H001-MOCK-RESULT.json"
  "guide-graphs/source-maps/inner-child-guide.json"
  "guide-graphs/source-maps/owner-amendments.json"
  "guide-graphs/source-maps/somatic-sequencing-guide.json"
  "guide-graphs/source-maps/vagal-blitz-source.json"
  "guide-graphs/compiled/inner-child-directed-graph.json"
  "guide-graphs/compiled/somatic-directed-graph.json"
  "guide-graphs/compiled/inner-child-somatic-cross-guide.json"
  "guide-graphs/compiled/bundle.json"
  "guide-graphs/reports/inner-child-somatic-pilot.md"
)
git status --porcelain=v1 -z --untracked-files=all > "$status_before"
for relative in "${generated_paths[@]}"; do
  if [[ -e "$relative" || -L "$relative" ]]; then
    snapshot="$snapshot_root/$relative"
    mkdir -p "$(dirname "$snapshot")"
    cp -p -- "$relative" "$snapshot"
  else
    marker="$absent_root/$relative"
    mkdir -p "$(dirname "$marker")"
    : > "$marker"
  fi
done

restore_generated() {
  package_status=$?
  trap - EXIT
  set +e
  cleanup_status=0
  for relative in "${generated_paths[@]}"; do
    snapshot="$snapshot_root/$relative"
    marker="$absent_root/$relative"
    if [[ -e "$snapshot" || -L "$snapshot" ]]; then
      mkdir -p "$(dirname "$relative")" || cleanup_status=1
      cp -p -- "$snapshot" "$relative" || cleanup_status=1
    elif [[ -e "$marker" ]]; then
      rm -f -- "$relative" || cleanup_status=1
    else
      cleanup_status=1
    fi
  done
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
  rm -rf -- "$verify_tmp" || cleanup_status=1
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
