#!/usr/bin/env bash
set -euo pipefail
node --env-file=.env src/cli/replay.mjs A001 \
  > >(tee A001-cli-result.json) \
  2> >(tee A001-cli-progress.log >&2)
