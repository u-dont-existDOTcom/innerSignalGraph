# Inner Signal Autopilot v0.15.1

## Git-native launch contract

Every ordinary launch first retries the private diagnostic outbox, then checks the remote `stable` branch. The Git source checkout and installed runtime are deliberately separate:

- source checkout: `~/Téléchargements/innerSignalGraph`;
- installed runtime: `~/Téléchargements/inner-signal-runtime`;
- update source: `stable`;
- automatic failure destination: `runtime-diagnostics`.

A new stable commit is checked out as a detached temporary worktree, copied without Git or runtime state, and tested inside disposable `HOME`, XDG, GitHub CLI, autopilot, Guide Packet, ledger, and development roots. GitHub/OpenAI/Anthropic credentials are removed and external update/diagnostic automation is disabled for candidate children. Only after package and graph tests pass are `.env`, `.inner-signal-autopilot`, `.inner-signal-dev`, `ledgers`, and `data` overlaid and hash-verified. The staging runtime then replaces the installed runtime atomically and the launcher restarts once with a loop guard. Ordinary launch failure keeps the prior runtime in service; bootstrap failure is nonzero and never claims the requested runtime was installed.

## Automatic diagnostic handoff

Failures are reconstructed field-by-field as `inner-signal-remote-diagnostic-v1`; arbitrary status objects are never sanitized and forwarded. A random local UUID identifies the installation without using a username, hostname, IP address, email, home path, or hardware identifier. The incident ID hashes stable safe fields and excludes timestamps, so retries are idempotent.

Pending records are written mode `0600` under `.inner-signal-autopilot/diagnostic-outbox`. The authenticated GitHub CLI creates `diagnostics/<machineId>/<incidentId>.json` on `runtime-diagnostics`, writes a local receipt, and only then removes the outbox record. Remote outages are non-blocking. Browser chat, therapy/hypnosis content, model prompts/output/reasoning, raw test output, credentials, `.env`, and absolute paths cannot enter the contract.

## Bounded current-progress heartbeat

The launcher owns a companion that reads strict local runtime/development state and maintains `progress/<machineId>/current.json` on `runtime-diagnostics`. It replaces that one path only with the exact existing blob SHA. Meaningful changes are coalesced for 30 seconds; unchanged state refreshes every five minutes, so steady remote status is at most five minutes stale. A failed delivery keeps only `.inner-signal-autopilot/progress-outbox/current.json` for retry and never stops the local runtime.

Remote assessment is deterministic: `ADVANCING` means a live worker has recent allowlisted movement; `LONG_RUNNING_STAGE` means a live legitimate stage has had no allowlisted transition for at least 15 minutes, not that it is conclusively stuck; `WORKER_NOT_RUNNING`, `WAITING_FOR_HUMAN`, `BLOCKED`, `COMPLETE`, and `IDLE` describe their literal states. The document contains generated codes, bounded counts, booleans, timestamps, release versions, and Git commits only. It excludes task names/IDs, blocker or supervisor prose, chat, therapy/hypnosis state, guide content, prompts, model output/reasoning, raw logs, credentials, host/user/network identity, absolute paths, PIDs, and hashes derived from excluded content.

## Timezone-stable validation

Stored ZIP timestamps use UTC fields, so the same packet input and absolute timestamp produce identical bytes on every host timezone. Test builds write only to temporary directories. Package verification compares rebuilt packet member content separately from the exact archived candidate hashes and rechecks those immutable hashes after all tests.

## A001 stage recovery

A001 case formulation persists a validated extraction before `case_audit`. Retryable `gpt-5.6-sol` audit failures receive one audit-only retry using that extraction. If the process restarts, a matching guide/case/pipeline/exact-model fingerprint reuses the checkpoint; changed fingerprints or extractor models rerun extraction safely.

An OpenAI audit failure is terminal for the auditor role and never causes Claude Fable escalation. Fable remains reserved for completed reasoning or realization that fails the substantive acceptance contract. Every A001 case-stage exception is normalized as `A001-case-extraction` or `A001-case-audit`, not `uncaught-error`.

Codex authentication failures trigger one `codex login` browser flow and automatic resume after `codex login status` succeeds. A loop guard prevents repeated login attempts. No API key is requested or read.

## Guide Packet processing

A changed runtime automatically validates the corrected bundled r02 Guide Packet candidate after exact subscription-CLI model resolution. Deterministic verification runs first, Opus receives the complete verified canonical guide prose plus attached Vagal Blitz page-5 evidence, Codex audits source support/provenance/certainty/behavioral decisions/regression implications, and Fable is requested only if Codex reports an unresolved material disagreement.

`gpt-5.6-sol`, `claude-opus-5`, and conditional `claude-fable-5` are exact role identifiers. Blank values, CLI defaults, aliases, and model fallbacks cannot satisfy these Guide Packet stages. Successful live entitlement probes are persisted before the stage begins.

The candidate is staged without changing the active guides or graphs. The original r01 candidate remains byte-preserved. On r02 supersession, a prior decision carries forward only when its complete decision contract is identical; every new or changed decision remains pending. Substantive decisions move the supervisor to `WAITING_FOR_HUMAN`; the web UI shows concise Approve / Keep current / Edit cards. No candidate can install until independent review is complete and every substantive decision is approved.

Packet stages are visible through the always-on Overall Development panel:

```text
VERIFYING
REVIEWING
WAITING_FOR_HUMAN
INSTALLING
ROLLING_BACK
COMPLETE
BLOCKED_AUTO_RECOVERY
```

Each stage persists a bounded attempt record with packet/stage/model/attempt IDs, worker PID, heartbeat, timestamps, expected next gate, terminal result, normalized error, and recovery action. Startup detects a missing worker, missing attempt, or stale heartbeat, records `STALE_STAGE`, and resumes from the existing candidate. Completed Codex work survives a failed Fable call, so only Fable is retried.

## Deterministic ownership

The controller, not a model, owns:

- ZIP path safety and zip-slip rejection;
- member checksums and canonical packet identity;
- schema and required-member validation;
- source/editor-body/source-map freshness;
- source-supported graph nodes and exact provenance;
- graph reachability, cycles, dependencies, and cross-guide conflicts;
- graph-declared advanced-release blocking and its mutation-sensitive regression;
- decision-case execution;
- private-data exclusion;
- atomic install/export/rollback;
- package tests and promotion.

Model inference never becomes owner policy. Product-only operational rules require explicit owner-amendment provenance.

## Autonomous development

The executive development supervisor and anti-livelock recovery remain unchanged. Feedback and deterministic failures create isolated repair candidates. Opus implements, the parent controller verifies, Codex independently reviews, affected cases replay, and only restorative/non-policy repairs promote automatically. Fable is bounded escalation.

Guide, graph, therapy, safety, or framework-policy changes always stop at an owner decision card stating the behavioral effect and worst plausible failure. Infrastructure failure is never converted into a therapy-policy verdict. A deterministic validation or promotion failure keeps the local health, status, Guides, and recovery-export service online while the development worker continues or retries a changed candidate.

## Validation reuse

A successful campaign writes a runtime fingerprint. Unchanged launches reuse prior validation rather than repeating expensive H001/A001/model checks. Guide Packet startup recovery still runs independently, so an orphaned stage resumes even when the full validation campaign is reused. The supervisor fingerprints stable packet facts and does not rewrite history for unchanged quiescent state. Foreground Guide Packet messages are composed from Guide Packet state, not an unrelated historical development repair directive.

## Recovery diagnostic

The one-click recovery ZIP contains deterministic packet status/attempts, the safe A001 audit-attempt ledger, normalized failure, candidate manifest/hash/state, compilation/review outputs, owner decisions, production manifest, exact-model evidence, gate summaries, and supervisor history. It excludes the A001 clinical extraction checkpoint, raw provider output, browser chat, therapy reasoning ledgers, development-case payloads, Guide Packet ZIP bodies, `.env`, credentials, and tokens.
