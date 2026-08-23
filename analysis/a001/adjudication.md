# A001 candidate adjudication

Status: **provisional engineering adjudication; owner gate blocked**

Recorded: 2026-08-23

This document does not record a therapy-policy decision, clinical outcome, owner approval, or production implementation decision. It joins the available engineering evidence while the required Claude checkpoints remain externally blocked. No entry belongs in `THERAPY-DECISIONS` or `APPROVED-THERAPY-LESSONS` until Joel explicitly judges the anonymized finalists and approves a concrete production lesson.

## Evidence boundary

- The exact original A001 message is identified by SHA-256 `13b6503e2557665add98fd4f96b3f841ec40c06a9bfda3c2a7442efc2baf19b6`; it is not duplicated here.
- Candidate prose, trajectory prose, and evaluator narrative remain in the owner-only non-Git packet at `~/Téléchargements/innerSignalGraph-a001-private`.
- Tracked evidence contains hashes, exact model and response IDs, score and hard-failure metadata, pass sets, and repository identities only.
- The rubric is an engineering filter, not a validated clinical measure. No evaluator score is a therapeutic outcome.
- No candidate has been presented to the owner, approved, encoded into production, or shown to produce change.

## Baseline finding

The static mock stand-in was filtered out by the independent Codex evaluator because it ignored current external reality; its first-response score was 29/44. It also lacked the required missed-promise/no-arrears handling and a sufficiently collaborative, time-bounded action. This is a regression-fixture finding, not an actual-production comparison.

The actual current production arm does not yet exist. `gpt-5.6-sol` passed its exact live structured probe. Both `claude-opus-5` and `claude-sonnet-4-6` failed before the original A001 message was transmitted. Claude CLI is logged in, but the authenticated organization returns HTTP 403 because Claude subscription access for Claude Code is disabled. No authorized API fallback is configured. The sanitized receipt is `analysis/a001/baseline-live.json`.

## First-response filter

Codex received one randomized opaque candidate at a time, plus only the exact original message and the task-specific engineering rubric. It did not receive arm identity, author/model identity, implementation details, preferred wording, another candidate, archived keyword expectations, or another evaluator's result.

- B, credibility-repair behavioral experiment: 43/44, no hard failure, advance.
- C, differentiation/chairwork: 41/44, no hard failure, advance with delivery concerns.
- D, integrated minimal route: 43/44, no hard failure, advance.
- Static mock stand-in: 29/44, hard failure `ignores_external_reality`, filter out.

The full prose-free receipt is `analysis/a001/blind-evaluation.json`.

## Longitudinal filter

Each of the ten owner-specified follow-ups was generated as a separate branch from the same original exchange. Branches did not inherit one another. A fresh mapping-blind Codex context evaluated all ten branches for one candidate at a time; prior rounds and other candidates were withheld. One failed trajectory could not be averaged away.

The initial prose-only process was inadequate: B passed 3/10, C 5/10, and D 7/10. The failure pattern showed that first-response prose alone did not reliably preserve resentment, action relevance, concrete missed-promise repair, or external-reality awareness across turns.

An experimental candidate-local continuity state materially improved all arms without changing their first-response prose. The state remained local and owner-unreviewed; it was not added to a guide, graph, production prompt, or policy.

- B v3 passed all ten trajectories in one coherent run. Its evaluator response ID is `01a0304c-e734-7fc0-be32-18fa6399be4a`.
- D v5, using D's unchanged concise first response with the already-passing B continuity mechanism, passed all ten trajectories in one coherent run. Its evaluator response ID is `01a0305a-1bb9-7532-9b61-43a8cd57833b`.
- C was rejected for non-robustness. It passed 9/10 in v3, then a coherent repair moved the single failure from T04 to T05 in v4. Further tuning was stopped rather than optimizing prose to the rubric.

All generation response IDs, packet hashes, receipt hashes, pass sets, and exact execution commits/trees are in `analysis/a001/trajectory-evaluation.json`.

## Provisional finalists

Two structures survive the available Codex filter:

1. B: a more explicit credibility-repair and collaborative behavioral-experiment first response, with the continuity mechanism that passed all ten A001 branches.
2. D: a shorter integrated first response, using the same successful continuity mechanism for follow-up.

This is not yet the owner finalist set. Required independent Opus evaluation has not occurred, and neither candidate has been compared with the exact actual Sonnet production response. Model scores cannot substitute for Joel's experiential judgment.

## Rejected or parked ideas

- Static mock/current archived A001 wording: rejected as a winner because a hard failure cannot be averaged away and the fixture is not actual production.
- C chairwork/differentiation route: retained as research but rejected from the provisional finalist set because longitudinal behavior was not robust across coherent regenerations.
- D's original weaker continuation state: superseded experimentally by the B continuity mechanism; no production supersession is implied.
- Grand vows, generic regulation-first responses, categorical role labels, action as proof, care arrears, and internal-only treatment of current danger: excluded by the owner requirements and supported by the failures observed in the comparison.
- Production prompt, graph, guide, or therapy-policy edits: not started; the owner outcome gate has not occurred.

## Exact blocked next sequence

When the external Claude permission changes:

1. Re-run content-free live probes for exact `claude-opus-5` and `claude-sonnet-4-6`; do not infer availability from login state.
2. Run the exact original A001 message through `POST /v1/therapy/respond` using the actual tiered production path and capture sanitized response IDs and output identity.
3. Give the actual production response, B, and D to independent Opus in physically separate blind packets. Do not supply this adjudication, arm identities, implementation details, Codex results, or archived keyword expectations.
4. Join Opus and Codex only after both are frozen. Verify and invoke `claude-fable-5` only if a material disagreement remains and exact access is available.
5. Randomize and anonymize the best two or three surviving responses for Joel's experiential judgment.

No answer from Joel has been requested yet. Current production policy remains unchanged.
