# Hypnosis guide fidelity audit — current task checkpoint

Status: audit complete, findings open, semantic repair not implemented. Read `AUDIT.md`, then `REVIEW-LEDGER.md`. This report-only task does not replace the repository's unrelated runtime-development checkpoint.

## Outcome and source identity

The owner requested fidelity and completeness review of the guide-only hypnosis graph before considering outside-guide knowledge. Reviewed all 26 nodes, 35 edges, 41 mapped source spans, and the full 723-block/151-heading guide projection. Exact input identities and ten finding families F01–F10 are in the report. All 41 source-section hashes reproduced successfully; source identity is not the failure. Summary-to-selection/effect fidelity and usable teaching coverage are inadequate for runtime promotion.

This is a source-based self-audit in a non-isolated context. It is not an independent review, clinical validation, or deployed-app behavioral test. The existing full CI pass on PR #51 established structural/package checks, not these semantic conclusions.

## Reproduction

`audit-check.py` is a frozen diagnostic for the pinned historical graph, not a new acceptance gate or a therapy planner. It verifies source identity and mirrors only the relevant initial readiness/matcher/deferral/ranking logic. The fuller planner's extraction, realization, task orchestration and delivery are not simulated. It rejects changed graph/source bytes rather than certifying a repaired candidate.

Use Python 3 with BeautifulSoup installed. Obtain the exact guide master from `joel-articles` commit `defc51d43fa291dcb00c93468e111c967094164a` and an `innerSignalGraph` checkout containing the unchanged graph/source map at `ad441affd378e06d6395e0ba4ec0760eaaea5d52`:

```bash
python tasks/hypnosis-guide-fidelity-audit-20260911/audit-check.py \
  --root /path/to/innerSignalGraph \
  --master /path/to/joel-articles/articles/inner-signal/master.html \
  --out /tmp/hypnosis-audit-diagnostic.json
```

The observed source checks and twelve bounded diagnostic outcomes are recorded in `AUDIT.md`. Their original source-verifier and selector-mirror components were run locally; no complete runtime/model test is claimed.

## Reusable audit method

1. Freeze exact upstream article authority and graph/code revisions, then verify bytes and source projections.
2. Review every node's summary separately from activation, effects, success criteria, questions and citations.
3. Reverse-read the complete source; classify omitted functions, permissible reference-only material, and incomplete teaching without requiring a node per paragraph.
4. Compare each conceptual arrow with actual enforcement; labels alone are not gates.
5. Use paired cases differing in a discriminating fact: availability versus need, wanted emotion versus impaired choice, phase versus ability, known recollection versus unsupported historical claims.
6. Preserve positive/negative controls and useful existing summaries; do not invent another warning layer when the missing object is task/phase information.
7. Keep self-audit, independent review, structural validity, behavioral tests and clinical usefulness as distinct evidence planes.

This reuses the repository's source/provenance, task-aware planning and generated-view distinctions. It does not create a new approval authority. The next candidate should adapt that established architecture, not enable a version flag blindly or tune the same static priorities again.

## Boundaries and recovery

No guide, source map, candidate graph, production graph, compiled inner-child/somatic bundle, installed packet or stable branch was changed. The book/research reference library was not imported. No private cases or copyrighted books were committed. The complete detailed CSV/JSON review package was delivered separately to the owner; this repository keeps the report, every node/source/edge disposition and reproducible diagnostic method as readable task artifacts.

Next substantive decision: source-faithful task/phase and teaching-layer repair, with action-specific guards and explicit owner review of behavioral changes. Preserve optional parts, borrowed adulthood, positive practice, chosen directness, full return, no-trance closure, uncertainty and the possibility of independent self-hypnosis. Do not promote the present candidate merely because its map renders.
