#!/usr/bin/env bash
set -euo pipefail
node --env-file=.env src/cli/hypnosis-replay.mjs H001 \
  > >(tee H001-cli-result.json) \
  2> >(tee H001-cli-progress.log >&2)
