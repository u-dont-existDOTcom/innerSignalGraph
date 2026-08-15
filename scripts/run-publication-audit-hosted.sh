#!/usr/bin/env bash
set -euo pipefail

GITLEAKS_VERSION=8.29.1
GITLEAKS_SHA256=e4eb209d04e20339d77122a3bdf9cd41351255cfb27ebcb75e85325e04f88924
GITLEAKS_URL=https://github.com/gitleaks/gitleaks/releases/download/v8.29.1/gitleaks_8.29.1_linux_x64.tar.gz
EXPECTED_REPOSITORY=u-dont-existDOTcom/innerSignalGraph

if [[ $# -ne 2 || "$1" != "--github" || "$2" != "$EXPECTED_REPOSITORY" ]]; then
  printf '%s\n' 'invalid-hosted-audit-arguments' >&2
  exit 2
fi
repository="$2"

if [[ "$(uname -s)" != "Linux" || "$(uname -m)" != "x86_64" ]]; then
  printf '%s\n' 'unsupported-scanner-platform' >&2
  exit 2
fi

umask 077
tool_root="$(mktemp -d /tmp/inner-signal-gitleaks.XXXXXX)"
cleanup() {
  if [[ -n "$tool_root" && "$tool_root" == /tmp/inner-signal-gitleaks.* && -d "$tool_root" ]]; then
    rm -rf -- "$tool_root"
  fi
}
trap cleanup EXIT

archive="$tool_root/gitleaks.tar.gz"
curl --fail --location --silent --show-error "$GITLEAKS_URL" --output "$archive"
if ! printf '%s  %s\n' "$GITLEAKS_SHA256" "$archive" | sha256sum --check --status; then
  printf '%s\n' 'gitleaks-checksum-mismatch' >&2
  exit 1
fi

tar -xzf "$archive" -C "$tool_root" --no-same-owner --no-same-permissions gitleaks
chmod 700 "$tool_root/gitleaks"

audit_result="$tool_root/publication-audit-result.json"
: > "$audit_result"
chmod 600 "$audit_result"

set +e
node scripts/audit-publication.mjs --root "$PWD" --github "$repository" --gitleaks "$tool_root/gitleaks" > "$audit_result"
audit_status=$?
set -e

if ! node scripts/validate-publication-audit-result.mjs "$audit_result" "$audit_status"; then
  printf '%s\n' 'invalid-hosted-audit-result' >&2
  exit 2
fi
exit "$audit_status"
