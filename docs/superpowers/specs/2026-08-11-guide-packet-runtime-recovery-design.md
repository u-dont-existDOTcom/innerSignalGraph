# Guide Packet Runtime Recovery Design

## Goal

Release Inner Signal v0.14.1 with durable, resumable Guide Packet processing. A failed, timed-out, malformed, unauthorized, or orphaned model stage must leave the staged `inner-signal-guides-2026.08.11-r01-candidate` intact, expose truthful recovery state, and resume without installing it or changing the production `inner-child-somatic-pilot-2026-08-09-r5` guide bundle.

## Confirmed root causes

1. `src/guide-packet/autopilot.mjs` writes `WORKING / opus-source-role-compilation` before awaiting Opus, but does not own the error transition. An exception escapes to the outer autopilot catch, leaving packet state active forever.
2. `src/server/create-server.mjs` contains a separate partial lifecycle implementation. The server and CLI paths therefore do not share one durable recovery contract.
3. `src/dev/supervisor-state.mjs` computes its canonical fingerprint before Guide Packet state is applied. Unchanged foreground packet state can consequently cause repeated `AUTO_CONTINUE / applied=false` history writes.
4. `src/autopilot/model-resolver.mjs` retains `""` as a valid first OpenAI candidate. With `OPENAI_MODEL=`, a successful CLI-default probe can be accepted without proving `gpt-5.6-sol` entitlement.
5. Diagnostic candidate lookup strips dots from the packet ID, unlike the packet store contract, so the current diagnostic can omit the candidate state. It also omits stage attempts and run-local model-resolution evidence.

## Chosen architecture

Add one Guide Packet stage-lifecycle module and make both bundled-candidate autopilot and browser import use the same processor. The lifecycle module is deterministic and model-agnostic. It owns:

- atomic current-status writes;
- a bounded durable stage-attempt ledger;
- queued, running, completed, recovering, blocked, and waiting-for-owner lifecycle states;
- attempt IDs, worker PIDs, stage heartbeats, timestamps, exact model identifiers, and expected-next-stage fields;
- normalized failure classification;
- stale/orphan reconciliation; and
- quiescent canonical state for the Overall Development supervisor.

The existing Guide Packet store remains authoritative for candidate content, compilation/review outputs, owner decisions, installation, rollback, and export. Stage completion writes the output to candidate state first and then records the completed transition. If interruption occurs between those atomic writes, startup reconciliation derives the next stage from the candidate output and repairs the status without rebuilding the packet.

## Processing-status contract

`processing-status.json` advances to a v2 shape while retaining the existing compatibility fields (`active`, `overall`, `stage`, `nextAutomaticAction`, and `humanActionRequired`). It also records:

- `lifecycle`;
- `packetId`;
- `stageId`;
- `attemptId`;
- `workerPid`;
- `model`;
- `queuedAt`, `startedAt`, `heartbeatAt`, `lastTransitionAt`, and `updatedAt`;
- `expectedNextStage` / `nextExpectedGate`;
- `lastSuccessfulTransition`;
- `failureClass` and `normalizedError`;
- `blocker`; and
- `recoveryAction`.

Heartbeat-only timestamps are excluded from the supervisor fingerprint. Stage, lifecycle, result, blocker, owner-decision, and recovery changes are included.

## Stage execution and recovery

Before any model call, the controller atomically records the exact packet, stage, model, attempt, process, heartbeat, and expected next stage. A short unref'd timer refreshes the heartbeat while the parent process owns the call.

On success, the processor atomically persists the stage output in candidate state, records the terminal attempt, and transitions to the next stage. On error it records a normalized error and one of:

- `MODEL_TIMEOUT`;
- `AUTH_REQUIRED`;
- `MODEL_UNAVAILABLE`;
- `MALFORMED_MODEL_RESULT`;
- `DETERMINISTIC_VERIFICATION_FAILURE`;
- `PACKET_INTEGRITY_FAILURE`;
- `REVIEW_REJECTION`;
- `STALE_STAGE`; or
- `OWNER_DECISION_REQUIRED`.

No infrastructure failure is converted into a therapy-policy verdict.

At startup or before a resume, a running stage is reconciled. A missing/dead owner PID, missing attempt, or expired heartbeat changes the stage to `RECOVERING / STALE_STAGE`. The processor then reads the existing candidate state and resumes the first missing stage. It does not call `stageGuidePacket` again for an already staged candidate, reset decision cards, write installation state, or change the production manifest.

## Exact model policy

The first and only acceptable OpenAI entitlement target for independent review is `gpt-5.6-sol`. Blank `OPENAI_MODEL`, a CLI default, the `gpt-5.6` alias, or another model cannot satisfy this role. Successful live probe evidence is attached to the resolved provider and recorded in model-resolution output before Guide Packet review may run.

The analogous required targets are `claude-opus-5` for compilation and `claude-fable-5` only for unresolved material disagreement. Low-level compilation/review functions also reject wrong model identifiers before calling a provider, so callers cannot silently bypass the resolver.

## Supervisor behavior

The canonical supervisor fingerprint includes stable Guide Packet facts: packet, stage, lifecycle, exact model, attempt, failure class, normalized blocker, recovery action, candidate output status, and owner-decision status. It excludes heartbeat and display-only timestamps.

When the fingerprint is unchanged, no packet/model attempt is live, no retry is due, and no human decision changed, a supervisor cycle reuses the stored analysis. It does not call Codex, append history, or rewrite the supervisor file. A stage change produces a new fingerprint and one new visible analysis.

The visible packet view reports the actual persisted stage and model, elapsed time, last successful transition, blocker, recovery action, next expected gate, and whether human action is required.

## Diagnostic bundle

The one-click diagnostic includes:

- Guide Packet processing status and stage-attempt ledger;
- normalized stage error and failure class;
- candidate state, exact candidate manifest/hash, compilation output, reviewer output, owner decisions, quality audit, and affected regressions when present;
- current production manifest;
- latest run-local model-resolution evidence;
- supervisor state/history; and
- non-private deterministic development state and gate summaries.

Candidate lookup uses the same `safePacketId` contract as the store. The v2 export removes browser state, chat transcripts, therapy reasoning ledgers, development-case payloads, and other files that can reproduce private therapy content. It also excludes `.env`, credentials, tokens, API keys, and Guide Packet ZIP bodies. Deterministic supervisor, stage, gate, manifest, hash, and status evidence remains available without private content.

## Validation boundaries

- Add every requested regression in RED before production changes.
- Keep all existing 152 baseline tests green.
- Run the complete package verifier, graph regressions, A001/H001 non-regression, web/runtime smoke, clean-extraction verification, and dirty-upgrade simulation.
- Verify the r01 candidate remains uninstalled and its owner decisions survive exception, timeout, stale-stage recovery, and successful resume.
- Do not perform live model review in the Work environment unless the exact subscription-backed CLIs and entitlement evidence are available. The installed runtime must perform those checks automatically on Joel's machine.

## Out of scope

- No therapy, hypnosis, guide, graph, provenance, or owner-decision policy changes.
- No automatic approval or installation of the r01 candidate.
- No API-key or API-credit workflow.
- No replacement of the executive supervisor with a new job system.
