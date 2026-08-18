# Implementation plan — Inner-child protocol runtime merge

Date: 2026-08-18  
Design: `docs/superpowers/specs/2026-08-18-inner-child-protocol-merge-design.md`  
Branch: `agent/merge-inner-child-protocol-20260818`

## Phase 1 — Pin authority and write failing tests

1. Record target base `a22f2e611fab778bf26b8e7215afbf85aba4ba5e` and Creative Tail source `af36a51e44a65067a3d7703a78a004fdb8ad7693`.
2. Add unit tests for:
   - one parent / three qualities;
   - actor and problem-class routing;
   - operation-scoped consent;
   - external current reality outranking inner work;
   - awareness not implying control;
   - instruction/scaffold distinctions;
   - depth/integration separation;
   - provenance/action-authority separation;
   - treatment-goal/capacity/authority separation;
   - resource unavailable and false-handoff prevention;
   - no-arrears and broken-promise repair;
   - compatibility with historical snapshots.
3. Add fixture-integrity tests proving query/grader separation.
4. Preserve current graph and A001/H001 tests unchanged as regression gates.

## Phase 2 — Deterministic protocol contract

1. Add `src/therapy-protocol/contract.mjs`:
   - operation classes O0–O10;
   - route dispositions;
   - protocol-profile enums/defaults;
   - one-parent ontology metadata;
   - resource and handoff states.
2. Add `src/therapy-protocol/validate.mjs`:
   - strict field validation;
   - conservative defaults;
   - compatibility derivation from existing variables;
   - no fabricated capacity/authority/access.
3. Add `src/therapy-protocol/router.mjs`:
   - precedence rules;
   - route disposition;
   - allowed/blocked operations;
   - material unknowns;
   - synthetic protocol primary jobs;
   - resource-access fallback;
   - protocol nuances and forbidden overclaims.
4. Add simplified comparator functions for maps 15 and 16.

## Phase 3 — Formulation and planner integration

1. Extend `caseSnapshotSchema` with optional `protocol_profile`.
2. Validate and normalize it in `validateCaseSnapshot`.
3. Extend case-audit schema with optional protocol-profile corrections.
4. Apply corrections without allowing free-form fields or values.
5. Update extraction/audit prompts:
   - user-language first;
   - explicit unknowns;
   - no legal capacity verdict;
   - no surrogate authority inference;
   - no service-availability fabrication;
   - one parent / three qualities;
   - immutable provenance.
6. Pass `protocolProfile` into `planFromGraphs`.
7. Run protocol routing before graph selection.
8. Return route/permission/resource state in the intervention contract.
9. Update therapy-tier classification so safety/condition-specific outer routes cannot fall through to ordinary fast inner work.

## Phase 4 — Corpus and benchmark harness

1. Import the 49 Creative Tail cases into `corpus/real-therapy-queries/`.
2. Store model-facing query separately from grader-only expected data.
3. Add a hermetic deterministic benchmark runner using grader-side structured profiles.
4. Add an opt-in live runner that sends only query text through the real provider pipeline.
5. Add package scripts for corpus verification and optional live execution.
6. Prove all 49 expected operation-level routes.
7. Compare maps 15 and 16 against simpler competitors and record the result.

## Phase 5 — Provenance, architecture, state

1. Add `docs/therapy-protocol/SOURCE-PROVENANCE.md`.
2. Add `docs/therapy-protocol/RUNTIME-CROSSWALK.md`.
3. Add `docs/therapy-protocol/REAL-QUERY-CORPUS.md`.
4. Update `docs/ARCHITECTURE.md`.
5. Update `THERAPY-LESSONS` with the new distinctions and saturation rule.
6. Update `state/CODEX-CURRENT-STATE.md`; explicitly record that the owner request supersedes the earlier no-therapy-policy-change instruction.
7. Update repository audit hashes for any bound canonical documents changed.
8. Do not change article prose, `stable`, or runtime-diagnostics authority.

## Phase 6 — Verification and protected merge

On the exact branch head run through GitHub CI:

```bash
npm ci --ignore-scripts
npm test
npm run graph:test
npm run therapy-lessons:verify
npm run audit:repository
npm run audit:publication
npm run verify
```

Required protected contexts:

- `deterministic-package`;
- `workflow-policy`;
- `codeql-javascript`.

Open a PR to `main` containing:

- target base SHA;
- Creative Tail source SHA;
- protocol-to-runtime crosswalk;
- compatibility decisions;
- corpus isolation evidence;
- exact check results;
- explicit limits on live model testing;
- confirmation that article prose and `stable` were unchanged.

Merge only after all required checks pass and review conversations are resolved. Record the final `main` SHA and immutable receipt.
