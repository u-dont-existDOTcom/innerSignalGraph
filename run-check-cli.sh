#!/usr/bin/env bash
set -euo pipefail
node --env-file=.env src/cli/diagnose-cli.mjs \
  | tee cli-diagnostics.json
node --env-file=.env src/cli/check-cli.mjs \
  > >(tee cli-entitlement-check.json) \
  2> >(tee cli-entitlement-progress.log >&2)
