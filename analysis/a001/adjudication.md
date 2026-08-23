# A001 candidate adjudication

Status: **engineering filtering complete; anonymous owner review required**

Recorded: 2026-08-23

This document does not record a therapy-policy decision, clinical outcome, owner approval, or production implementation decision. No entry belongs in `THERAPY-DECISIONS` or `APPROVED-THERAPY-LESSONS` until Joel explicitly judges the anonymous finalists and approves a concrete production lesson.

## Evidence boundary

- The exact original A001 message is identified by SHA-256 `13b6503e2557665add98fd4f96b3f841ec40c06a9bfda3c2a7442efc2baf19b6`; it is not duplicated here.
- Candidate, trajectory, and evaluator prose remains in the owner-only non-Git packet at `~/Téléchargements/innerSignalGraph-a001-private`.
- Tracked evidence contains hashes, exact model and response IDs, score and hard-failure metadata, pass sets, and repository identities only.
- The rubric is an engineering filter, not a validated clinical measure. No evaluator score is a therapeutic outcome.
- No candidate is approved or encoded into production, and no candidate has been shown to produce change.
- Local and hosted `stable` remain unchanged; no A001 push targeted either stable ref.

## Actual production baseline

The provider permission boundary was resolved. Content-free calls to exact `gpt-5.6-sol`, `claude-opus-5`, and `claude-sonnet-4-6` succeeded before A001 transmission. The exact original message then traversed the real reviewed production path: Sonnet extraction, Codex audit, and Sonnet realization, with no fallback or degradation. The privacy-safe receipt is `analysis/a001/baseline-live.json`.

In the new one-candidate blind comparison, Codex scored actual production 27/44, found hard failure `ignores_external_reality`, and filtered it out. Opus scored it 30/44 and advanced it without a hard failure. Exact `claude-fable-5` was invoked only for this disagreement, but produced no judgment; a separate content-free exact-ID probe returned HTTP 429 because usage credits were exhausted. No model was substituted.

The production answer is conservatively filtered out. A hard-failure finding cannot be averaged away, and the required adjudicator was unavailable. This is an engineering disposition, not a clinical conclusion.

## First-response finalists

Codex and Opus each received one randomized opaque candidate at a time, plus only the exact original message and the task-specific engineering rubric. They did not receive arm identity, author/model identity, implementation details, preferred wording, another candidate, archived keyword expectations, or the other evaluator's result.

- B: Codex 43/44, Opus 39/44, no hard failure from either, both verdicts advance.
- D: Codex 43/44, Opus 39/44, no hard failure from either, both verdicts advance.
- Actual production: filtered as described above.
- C: already rejected for non-robust longitudinal behavior.
- Static mock: already filtered on `ignores_external_reality`; it was never treated as actual production.

The full prose-free comparison is `analysis/a001/blind-evaluation.json`.

## Longitudinal filter

Each owner-specified follow-up was generated as a separate branch from the same original exchange. Branches did not inherit one another. Candidate-local continuity state remained experimental, private, and owner-unreviewed; it was not added to a guide, graph, production prompt, or policy.

- B v3 passed T01–T10 under mapping-blind Codex and then independently under exact Opus. Opus response ID: `aaa9b555-6543-4351-a90e-659708da4750`.
- D v5 passed T01–T10 under mapping-blind Codex and then independently under exact Opus. Opus response ID: `21b23c3c-2c4e-43cc-ac82-c02f67a9a3fb`.
- C remained rejected after successive coherent runs moved its remaining failure from T04 to T05.

All pass sets, hashes, response IDs, and execution identities are in `analysis/a001/trajectory-evaluation.json`.

## Owner gate

B and D are the two engineering-qualified finalists. They must be freshly randomized and presented without arm, model, or architecture identity. Joel's experiential judgment—not the model scores—determines whether either response demonstrates immediate usefulness for A001 and which elements may proceed to minimal implementation.

No answer leaves production therapy policy unchanged. After an explicit owner judgment, provenance may be revealed and only the owner-validated elements may be proposed through the repository's direct therapy-decision protocol.

## Rejected or parked ideas

- Actual production and static mock: not finalists because unresolved or confirmed hard-failure evidence cannot be hidden by an average.
- C chairwork/differentiation route: retained as research but rejected because longitudinal behavior was not robust.
- Grand vows, generic regulation-first responses, categorical role labels, action as proof, care arrears, and internal-only treatment of current danger: excluded by the owner requirements and observed comparison failures.
- Production prompt, graph, guide, or therapy-policy edits: not started; the owner outcome gate has not occurred.
