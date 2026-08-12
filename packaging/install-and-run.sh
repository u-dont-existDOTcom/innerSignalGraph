#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "Inner Signal v0.15.0 uses verified Git updates. Continuing with the Git bootstrap..."
exec "$ROOT/install-from-git.sh"
