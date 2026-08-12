# Inner Signal v0.14.1 — Guide Packet Runtime Recovery

## Release boundary

This release repairs runtime orchestration around the existing candidate `inner-signal-guides-2026.08.11-r01-candidate`. It does not change guide prose, therapy policy, graph policy, provenance, certainty, owner decisions, or the active production graph bundle `inner-child-somatic-pilot-2026-08-09-r5`.

The r01 packet remains a candidate. Recovery, compilation, audit, diagnostics, and installation are separate operations. Recovery never approves or installs it.

## Durable lifecycle

`processing-status.json` uses the `inner-signal-guide-packet-processing-v2` contract. `stage-attempts.json` retains a bounded attempt ledger. A model stage records:

- packet, stage, exact model, attempt, and worker identifiers;
- queued/start/heartbeat/completion timestamps;
- expected next stage and last successful transition;
- terminal lifecycle and normalized error;
- one of the explicit recovery failure classes; and
- automatic recovery action versus genuine human action.

Stage output is written to candidate state before the attempt is marked complete. Opus compilation, Codex audit, and conditional Fable adjudication are separately durable. If Fable fails after Codex succeeds, the next run reuses the persisted Codex audit and retries only Fable.

At startup, a running state is live only when its attempt exists, its heartbeat is fresh, and its worker PID exists. Otherwise it becomes `RECOVERING / STALE_STAGE`, preserving the candidate ZIP, compilation/review work, and every owner decision before resuming the first missing stage.

## Failure classes

Infrastructure and policy are kept separate:

- `MODEL_TIMEOUT`
- `AUTH_REQUIRED`
- `MODEL_UNAVAILABLE`
- `MALFORMED_MODEL_RESULT`
- `DETERMINISTIC_VERIFICATION_FAILURE`
- `PACKET_INTEGRITY_FAILURE`
- `REVIEW_REJECTION`
- `STALE_STAGE`
- `OWNER_DECISION_REQUIRED`

An unavailable model, expired login, malformed output, timeout, or dead process is not a therapy-policy verdict.

## Exact subscription-CLI models

The Guide Packet roles accept only:

- compilation: `claude-opus-5`;
- independent audit: `gpt-5.6-sol`; and
- unresolved-disagreement adjudication: `claude-fable-5`.

Blank environment values normalize to these exact defaults. CLI defaults, `gpt-5.6`, other Codex variants, Sonnet, and other Anthropic selectors cannot satisfy a Guide Packet role. Before a live stage, the runtime stores a successful entitlement probe with requested model, response ID, and timestamp. The low-level compiler/reviewer also refuses a wrong model before `generate()`.

## Supervisor behavior

The Overall Development fingerprint now includes stable packet lifecycle, exact model, attempt, blocker/failure/recovery facts, stage outputs, and owner-decision statuses. Heartbeats and display-only timestamps are excluded.

When canonical state is unchanged, no attempt is live, and no retry is due, the supervisor reuses the previous analysis without calling Codex, appending history, or rewriting its state file. Stage and owner-decision changes create a new fingerprint and one new visible analysis.

## Recovery diagnostic v2

The recovery ZIP includes:

- processing status and stage-attempt ledger;
- normalized failure and recovery action;
- candidate state, exact manifest, and original ZIP SHA-256 (without the ZIP body);
- compilation, Codex, Fable, quality, regression, provenance-summary, and owner-decision state already present in candidate state;
- current installed manifest;
- latest exact-model resolution evidence;
- deterministic run/gate summaries; and
- development supervisor and roadmap state.

It excludes browser state, chat transcripts, therapy reasoning ledgers, development-case payloads, worker logs, Guide Packet ZIP bodies, `.env`, credentials, API keys, tokens, cookies, and authorization material.

## Installation and rollback

The French Zorin installer preserves `.env`, `.inner-signal-autopilot`, ledgers, data, candidate bytes/state, stage attempts, owner decisions, installed packet, and rollback history. It is idempotent. The source tree is replaced only after the prior state is copied aside; failed deterministic install validation restores the previous runtime.

The approved-packet installation contract is unchanged: every substantive decision must be approved, the independently reviewed derivative must verify, affected regressions must pass, and installation remains atomic with rollback retained.
