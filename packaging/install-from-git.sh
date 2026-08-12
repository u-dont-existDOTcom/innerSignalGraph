#!/usr/bin/env bash
set -Eeuo pipefail

REPOSITORY="${INNER_SIGNAL_GITHUB_REPOSITORY:-u-dont-existDOTcom/innerSignalGraph}"
STABLE_BRANCH="${INNER_SIGNAL_GIT_STABLE_BRANCH:-stable}"
INSTALL_BASE="${INNER_SIGNAL_INSTALL_BASE:-$HOME/Téléchargements}"
SOURCE_ROOT="${INNER_SIGNAL_GIT_SOURCE:-$INSTALL_BASE/innerSignalGraph}"
INSTALLED_ROOT="${INNER_SIGNAL_GIT_INSTALL_ROOT:-$INSTALL_BASE/inner-signal-runtime}"

for command_name in node npm git; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "BLOCKED: $command_name is required for the Inner Signal Git installation." >&2
    exit 1
  fi
done

NODE_VERSION="$(node -p 'process.versions.node')"
NODE_MAJOR="${NODE_VERSION%%.*}"
if [[ ! "$NODE_MAJOR" =~ ^[0-9]+$ ]] || (( NODE_MAJOR < 20 )); then
  echo "BLOCKED: Node.js 20 or newer is required; found ${NODE_VERSION:-unknown}." >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  if ! command -v apt-get >/dev/null 2>&1; then
    echo "BLOCKED: GitHub CLI (gh) is required and apt-get is unavailable." >&2
    exit 1
  fi
  echo "Installing the GitHub CLI required for private-repository access..."
  if [[ "$(id -u)" == "0" ]]; then
    apt-get update
    apt-get install -y gh
  elif command -v sudo >/dev/null 2>&1; then
    sudo apt-get update
    sudo apt-get install -y gh
  else
    echo "BLOCKED: installing gh requires administrator access." >&2
    exit 1
  fi
fi

if ! gh auth status --hostname github.com >/dev/null 2>&1; then
  echo "Opening the official GitHub web login once for private Inner Signal updates..."
  gh auth login --hostname github.com --git-protocol https --web
fi
gh auth setup-git

REMOTE_IDENTITY="$(gh api "repos/$REPOSITORY" --jq '.full_name')"
REMOTE_PUSH="$(gh api "repos/$REPOSITORY" --jq '.permissions.push')"
if [[ "$REMOTE_IDENTITY" != "$REPOSITORY" || "$REMOTE_PUSH" != "true" ]]; then
  echo "BLOCKED: the authenticated GitHub account cannot update $REPOSITORY." >&2
  exit 1
fi

mkdir -p "$(dirname "$SOURCE_ROOT")"
if [[ ! -d "$SOURCE_ROOT/.git" ]]; then
  git clone --branch "$STABLE_BRANCH" "https://github.com/$REPOSITORY.git" "$SOURCE_ROOT"
else
  ORIGIN_URL="$(git -C "$SOURCE_ROOT" remote get-url origin)"
  case "$ORIGIN_URL" in
    "https://github.com/$REPOSITORY"|"https://github.com/$REPOSITORY.git"|"git@github.com:$REPOSITORY"|"git@github.com:$REPOSITORY.git") ;;
    *) echo "BLOCKED: $SOURCE_ROOT points at a different Git repository." >&2; exit 1 ;;
  esac
fi

set +e
env \
  INNER_SIGNAL_GIT_INSTALL_ROOT="$INSTALLED_ROOT" \
  INNER_SIGNAL_GIT_SOURCE="$SOURCE_ROOT" \
  INNER_SIGNAL_GITHUB_REPOSITORY="$REPOSITORY" \
  INNER_SIGNAL_GIT_STABLE_BRANCH="$STABLE_BRANCH" \
  node "$SOURCE_ROOT/src/cli/git-update.mjs" --bootstrap
UPDATE_STATUS=$?
set -e
if [[ $UPDATE_STATUS -ne 0 && $UPDATE_STATUS -ne 10 ]]; then
  echo "BLOCKED: the verified stable runtime could not be installed." >&2
  exit 1
fi
if [[ ! -x "$INSTALLED_ROOT/run-autopilot.sh" ]]; then
  echo "BLOCKED: the installed runtime launcher is unavailable." >&2
  exit 1
fi

echo "Inner Signal is installed from the verified stable branch."
if [[ "${INNER_SIGNAL_INSTALL_ONLY:-false}" == "true" ]]; then
  exit 0
fi
exec "$INSTALLED_ROOT/run-autopilot.sh"
