# Constitution, longitudinal context, and audit-harness integration

Status: implementation complete; verification and exact-head publication in progress on draft PR #46. The private source directive is not stored or hashed in this public repository.

## Baseline

- Current fetched PR head: `32d714855bb327b0d49fbb73662f9ee9d212dd38`.
- Preserved local audit-contract commits: `9ef62883ec40c1e13b0216277e4847dbb2c47fca` and `734a23b750181d554346ba52708a27af14ff2760`.
- Branch: `codex/audit-architecture-eval-20260908-v2`.
- Target PR branch: `companion/foundations-2026-09-05`.

## Execution boundary

Implement the public-safe constitution/context/storage/tracker/UI/harness/handoff changes defined by `OWNER-OUTCOME.json` and `EXECUTION-DIRECTIVE.json`. Preserve the existing stopped audit calibration as historical evidence. Any semantic harness change requires a new instrument freeze and full calibration before architecture or `Latest` model calls.

No provider/API/OpenRouter call, audit winner, runtime adoption, merge, deployment, installation, stable promotion, or clinical-validation claim is authorized.

## Privacy boundary

Public Git contains only schemas, code, tests, and synthetic/de-identified fixtures. Real-person identifiers, verbatim private transcript, exact identifying details, and private-derived hashes are forbidden. Durable private case payloads may be written only through the encrypted vault service.

## Implemented composition

- `src/therapy/constitution.mjs`: immutable fixed ends, method identity, steering/consent, metaphysical openness, authority test, anti-bypass, and scale-appropriate political agency.
- `src/case-state/`: provenance-aware evidence, 42-item/13-cluster synthetic gold state, answer/currentness tracking, current episode, exact recent verbatim windows, bounded contradiction-first older retrieval, decision projection, bounded descriptive trajectory tracking, and structured diffs.
- `src/storage/private-case-store.mjs`: append-only transcript/case/tracker/journal records serialized only as an AES-GCM dual-wrap encrypted envelope, atomic `0600` writes under `0700` directories, injected OS-reauthenticated key boundary, no plaintext fallback, and key clearing on close.
- Ordinary therapy context and all major reasoning prompts now receive the constitution plus durable state, current episode, tracker, and retrieval context.
- Loopback state/tracker/journal endpoints fail closed without an encrypted store and never return raw transcript, journal text, or hidden reasoning.
- The browser persists only safe settings and case ID, detects but does not silently migrate or delete legacy private state, keeps sensitive fallback data session-only, and exposes Current saved state, What changed this turn, tracker, and journal controls.
- The audit fixture now represents poor observability, sleep/THC/pain/practice confounding, mixed trajectories, support and readiness conflicts, hypothesis provenance, and steering fidelity. The stopped calibration remains historical and a new freeze/calibration is mandatory.
- The next-conversation handoff requires auditing the private last proposed response before new therapy direction without embedding it in public Git.

## Requirement trace

| Outcome | Primary artifact | Direct evidence |
|---|---|---|
| RO-01 | `src/therapy/constitution.mjs`, `src/prompts/common.mjs` | prompt/constitution deterministic tests |
| RO-02 | `src/storage/private-case-store.mjs` | ciphertext-only, mode, append-only, and close tests |
| RO-03 | `src/case-state/longitudinal-state.mjs`, `context-window.mjs` | gold-state, poisoning, episode-window, retrieval, and diff tests |
| RO-04 | `src/case-state/tracker.mjs`, web tracker/journal | validation, missingness, noncausal summary, and endpoint tests |
| RO-05 | `apps/web/index.html`, `apps/web/app.js` | browser persistence and inspection-control tests |
| RO-06 | audit case/drafts/reference/rubric/supplements | audit harness validation and focused tests |
| RO-07 | `tests/constitution-context-state.test.mjs` plus audit tests | focused/affected/full gates recorded below |
| RO-08 | `tasks/NEXT-CONVERSATION-HANDOFF-2026-09-07.md` | audit-first private-load instructions, no private payload |
| RO-09 | PR #46 | final head and hosted check evidence recorded after push |

## Research-before-reinvention

Disposition: COMPOSE / ADAPT. The implementation reuses the existing vault crypto and routine authorization, incremental case formulation, path-performance controller, loopback server, browser UI, and blinded audit scorer. It adds only the missing constitution, longitudinal evidence/compaction adapter, encrypted record service, tracker, inspection seam, and synthetic adversarial fixtures. See the design spec for the simple baselines and remaining limits.

## Verification ledger

- Focused audit harness: 36/36 passing after semantic fixture correction.
- Constitution/context/storage/UI/endpoint suite: 13/13 passing at the loopback-capable host boundary, including compacted-state decision equivalence, explicit context limits, complete contradiction coverage, and encrypted therapy-turn persistence.
- Affected prompt/runtime/browser/vault/audit suite: 177/177 passing before the final gold-state expansion; the final full gate supersedes this checkpoint.
- Graph regressions: 29/29 passing. Therapy lesson gate: 5/5 passing. Repository audit: green with one known hosted-enforcement warning. Local Git publication audit: green across 278,717 historical records before the final containing commit.
- Endpoint tests require the host boundary because the workspace sandbox blocks loopback sockets; this is an execution-boundary condition, not a product failure.
- Complete package verification under repository-required Node `24.18.0`: PASS, including 1007/1007 automated tests, 29/29 graph regressions, 5/5 therapy lessons, guide/archive integrity, mock therapy and hypnosis replays, web smoke, autopilot smoke, runtime fingerprint, package hygiene, and the development-loop checks.
- The first full attempt was correctly rejected: the host's Node 26 wrapper outranked the initially requested runtime and exposed one stale historical test that treated a completed Obsidian task as the permanent active lock. The historical test now validates the immutable closeout receipt independently; all 12 affected release/autopilot tests passed under Node 24 before the complete green run.
- Remaining: acceptance/publication audit on the containing commit, refreshed-PR-head reconciliation, exact-head push, and hosted required-check readback.

## Unresolved owner/release decisions

No decision blocks this candidate push. Before runtime release, the owner must still review the concrete OS credential-store adapter and packaging, encrypted-case retention and deletion UX, legacy migration UX, human privacy usability, and later frozen semantic experiment results. The experiment cannot select or adopt an architecture without explicit owner review.
