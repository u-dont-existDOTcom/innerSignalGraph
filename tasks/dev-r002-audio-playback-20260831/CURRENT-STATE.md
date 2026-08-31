# DEV-R002 accessible audio playback task state

Task ID: `DEV-R002`

Status: `REVIEW_HANDOFF_BOUNDARY`

Assurance lane: `iteration` with targeted hypnosis-content preservation and privacy hard gates.

## Authority and execution boundary

- Owner outcome: continue the currently authorized InnerSignal engineering queue without release, stable promotion, public pilot, plugin creation, or community-derived therapy activation.
- Owner-outcome identity: `OO-INNERSIGNAL-ROADMAP-RESUME-20260831-E1`, epoch `1`, SHA-256 `1482b1f9ee9f5462d1b80f3e98be778b3463ea27b804d6a338ba29b0dca980c3`.
- Chat-authored directive: `ctc-innersignal-dev-r002-audio-interruption-20260831-001`, Extra High session `rr-innersignal-dev-r001-latency-repair-20260831-002`, chat epoch `innersignal-roadmap-resume-20260831-e1`.
- Strategy: `dev-r002-explicit-speech-lifecycle-controller-r1`.
- Reviewed evidence boundary: PR #17 exact head `1c4487c212a511822dd3836f5015b98ab7987af9`, open, draft, unmerged; remote `stable` `110ee5342e27d8f1bd3d11cc2be4d85926c255b1`.
- Task branch: `codex/dev-r002-audio-playback-20260831`, created from exact accepted DEV-R001 head.
- Maximum execution horizon: one implementation, verification, and stacked-draft-PR cycle followed by Extra High review.
- Pro classification: `NO_PRO`; any need to change hypnosis meaning, consent, route semantics, or waking-return behavior is a stop condition.

## Objective-reconciliation matrix

| Owner requirement | Chat interpretation | Task criterion | Acceptance evidence | Status | Authorized change |
|---|---|---|---|---|---|
| Continue safe engineering work now | Execute the next eligible bounded roadmap slice | Complete DEV-R002 only | Exact branch, tests, PR, and review receipt | In progress | Speech lifecycle/UI only |
| Preserve correction-learning request | Do not lose the later potential-lesson requirement | Keep it queued and unimplemented in this slice | No correction-learning paths changed | Preserved outside scope | None |
| Do not alter stable or release | Keep all work stacked, draft, and unmerged | Stable SHA unchanged; no deployment/install | Git/GitHub readback | Enforced | None |
| Preserve therapy/hypnosis semantics | Treat playback as an exact-text transport only | Byte-exact route text; waking return remains last | Unit and renderer regressions | Pending tests | Mechanical playback wiring only |
| Continue through reasoning review | Stop execution at the directive boundary, not the owner-facing loop | Route one self-contained receipt to Extra High and apply its response exactly once | Persisted packet/request/result | Pending | Review handoff only |

## Active lesson contract

1. Exact content boundary — pass only the existing `selectedRouteText` byte-for-byte to one utterance; never transform, persist for recovery, or change `renderHypnosisRoute`.
2. Explicit ownership — generation/identity checks prevent stale utterance callbacks from mutating newer playback.
3. Abandonment cancellation — stop before route replacement, new-plan installation, app-tab departure, and `pagehide`.
4. Deliberate recovery — hidden visibility pauses active speech; becoming visible never resumes automatically.
5. Accessible deterministic UI — status is announced; unsupported, idle-ready, speaking, and paused states expose only valid controls.
6. Verification budget — focused controller/client/server tests and web smoke first; repository audit and exactly one final `npm run verify` only after the diff is frozen.

## Implemented

- Added a dependency-injected Web Speech controller with explicit `idle`, `speaking`, and `paused` states.
- Replacement and Stop invalidate utterance ownership before calling browser cancellation, so synchronous or delayed stale callbacks cannot affect a newer utterance.
- Speech uses one `SpeechSynthesisUtterance` containing the exact selected route text and preserves rate `0.88`.
- Added deterministic Read, Pause, Resume, Stop, unsupported-browser, and announced-status states.
- Hidden-page visibility pauses active speech without automatic visible-page resume.
- Route replacement, new-plan installation, app-tab departure, and `pagehide` cancel current speech.
- The new self-hosted controller is served by the loopback runtime and checked by web smoke.
- `renderHypnosisRoute`, its app-owned waking return, hypnosis compiler behavior, therapy semantics, and persisted application schema are unchanged.

## Verification and recovery

- Focused red phase: expected failure because the new controller module did not yet exist.
- Focused implementation phase: PASS.
- Final focused phase after deterministic UI-state derivation: PASS, 26/26.
- The execution receipt and exact-head draft PR carry the final diff check, repository audit, web smoke, one final package-gate result, telemetry, commit identity, hosted checks, and stable readback; do not infer those facts solely from this tracked checkpoint.
- The three newer therapy-governance ledgers named in the owner-supplied working agreement are absent from this execution branch and current `main`; therefore this task makes no therapy-policy or hypnosis-content decision. Exact-text preservation and the directive's no-semantic-change boundary remain hard gates.
- On recovery, inspect the branch and exact-head PR first. If no verified commit exists, resume the first missing deterministic gate. If the verified commit is pushed and the draft PR exists, do not repeat a green full package gate; route or recover the single bounded Extra High review request.

## Supervision adoption receipt

The current shared supervision bootstrap was re-read from `u-dont-existDOTcom/universal-dev-architecture` branch `architecture/codex-pro-supervision-mission-control-20260830` before DEV-R002 implementation. The task uses independent owner-outcome identity, an objective-reconciliation matrix, separate worker-to-contract and contract-to-owner states assigned only by the reasoning chat, typed completion, recurring reconciliation, and automatic reasoning-handoff continuation. No Codex-authored strategic, therapeutic, product, release, alignment, progress, or completion judgment is authorized.
