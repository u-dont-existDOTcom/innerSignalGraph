#!/usr/bin/env bash
set -Eeuo pipefail

CODEX_CMD="${CODEX_COMMAND:-codex}"
RESUME_CMD="${INNER_SIGNAL_RESUME_COMMAND:-./run-autopilot.sh}"

if [[ "${INNER_SIGNAL_CODEX_REAUTH_ATTEMPTED:-0}" == "1" ]]; then
  echo "Codex authentication still failed after the one automatic browser-login attempt." >&2
  echo "The interrupted audit checkpoint remains preserved." >&2
  exit 1
fi

echo
echo "Codex login expired. Opening the official ChatGPT browser login now."
echo "Complete the sign-in once; Inner Signal will resume the saved audit automatically."
echo "No API key, log upload, or manual rerun is needed."
echo

if ! env -u OPENAI_API_KEY -u CODEX_API_KEY -u CODEX_ACCESS_TOKEN "$CODEX_CMD" login; then
  echo "Codex browser login did not complete successfully." >&2
  exit 1
fi
if ! env -u OPENAI_API_KEY -u CODEX_API_KEY -u CODEX_ACCESS_TOKEN "$CODEX_CMD" login status >/dev/null 2>&1; then
  echo "Codex login returned, but 'codex login status' still reports unauthenticated." >&2
  exit 1
fi

resume_args=(--force-validation)
for arg in "$@"; do
  [[ "$arg" == "--force-validation" ]] || resume_args+=("$arg")
done

echo
echo "Codex authentication restored. Resuming from the preserved A001 stage automatically..."
export INNER_SIGNAL_CODEX_REAUTH_ATTEMPTED=1
exec "$RESUME_CMD" "${resume_args[@]}"
