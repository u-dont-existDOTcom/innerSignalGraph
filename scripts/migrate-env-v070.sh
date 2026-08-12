#!/usr/bin/env bash
set -Eeuo pipefail
VERSION="$(node -p "require('./package.json').version")"

if [[ ! -f .env ]]; then
  cp .env.cli.example .env
  echo "Created .env from the standalone Opus/Fable defaults." >&2
  exit 0
fi

changed=0
set_key() {
  local key="$1" value="$2" current=""
  current="$(sed -n "s/^${key}=//p" .env | tail -1)"
  if [[ "$current" == "$value" ]]; then
    return 0
  fi
  if (( changed == 0 )); then
    backup=".env.before-v${VERSION}-$(date -u +%Y%m%dT%H%M%SZ)"
    cp .env "$backup"
  fi
  if grep -q "^${key}=" .env; then
    sed -i "s#^${key}=.*#${key}=${value}#" .env
  else
    printf '\n%s=%s\n' "$key" "$value" >> .env
  fi
  changed=1
}

current_anthropic="$(sed -n 's/^ANTHROPIC_MODEL=//p' .env | tail -1)"
case "$current_anthropic" in
  ""|sonnet|claude-sonnet-4-6|claude-fable-5|fable)
    set_key ANTHROPIC_MODEL claude-opus-5
    ;;
esac
set_key ANTHROPIC_ESCALATION_MODEL claude-fable-5
set_key RESPONSE_RENDERER_MODEL claude-sonnet-4-6
set_key THERAPY_PROCESSING_MODE auto
set_key AUTOPILOT_USE_STRUCTURED_RENDERER true
set_key ALLOW_CLAUDE_FABLE_USAGE true
set_key AUTOPILOT_ESCALATE_TO_FABLE true
set_key AUTOPILOT_PRIMARY_HYPNOSIS_ATTEMPTS 1
set_key ANTHROPIC_MODEL_FALLBACKS claude-opus-5,claude-fable-5
set_key OPENAI_MODEL_FALLBACKS gpt-5.6-sol,gpt-5.6
set_key AUTOPILOT_RUN_A001 true
set_key AUTOPILOT_RUN_RUNTIME_SMOKE true
set_key AUTOPILOT_RUN_WEB_SMOKE true
set_key AUTOPILOT_LAUNCH_APP true
set_key AUTOPILOT_REUSE_CHECKPOINTS true
set_key LEDGER_MODE full

if grep -q '^OPENAI_MODEL=gpt-5\.6-terra$' .env; then
  set_key OPENAI_MODEL gpt-5.6-sol
fi

if (( changed == 1 )); then
  echo "Migrated v${VERSION} runtime settings. Backup: $backup" >&2
else
  echo "Environment already uses current v${VERSION} settings; no migration needed." >&2
fi
