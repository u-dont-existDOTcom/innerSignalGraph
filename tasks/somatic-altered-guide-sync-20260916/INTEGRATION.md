# Somatic and altered-states guide integration

Status: COMPLETE; owner-approved reconciliation merged to development `main`; not installed, deployed, or promoted to `stable`.

## Owner outcome

Update the somatic and altered-states portions of the therapy map from the two latest owner-uploaded guides; integrate their shared safety/representation boundaries; route readers to the owner's thirteen named guide destinations; and track humanized public editions separately from operational source/map versions. The latest uploads supersede Library searches for these two source versions.

## Exact source authority

- Repository baseline: `5bc037327392eef45b3c0f7bf4e3be0a3f341245` (`main`).
- Task branch: `task/somatic-altered-guide-sync-20260916`.
- Somatic upload: `Pasted text(20260915-154401).txt`, 127665 bytes, SHA-256 `ce1a14d3df8552ad444bcf0ee71fba3b3b56058397acf5ebd0e139af332041a0`.
- Altered-states upload: `Pasted text(20260915-160604).txt`, 114722 bytes, SHA-256 `eda2ddf25b22c1bc8d9e2869661db59d893552f248bdfddf1b5c02bedd951d5c`.
- Somatic article is already humanized according to the owner. Separate humanized inner-child, altered-states and hypnosis editions are planned.

## Candidate behavior

### Somatic

- Preserve the five-layer somatic framework as a flexible function-based map rather than a compulsory ladder.
- Add SIBAM-style tracking of sensation, image, behavior/action tendency, affect and meaning while preserving language, analysis and reality testing.
- Explicitly separate directly experienced phenomenology from later appraisal or verbal translation; nonverbal/earlier/body material is not automatically deeper or truer.
- Add optional consensual touch/self-massage and aquatic bodywork routes with explicit stopping authority, no-touch alternatives, pre-session preparation and aftercare.
- Preserve discharge -> settle/reorient, Brainspotting/EMDR targeting, cognitive/narrative integration, and existing advanced-release safeguards.

### Altered states

- Altered-state disclosure alone no longer forces generic grounding, forensic routing, or a categorical `deep_work_readiness=no`.
- Separate planned preparation, acute medical/safety triage, acute stabilization, coherent/stable substantive therapy, action-lock situations and aftermath/integration.
- Coherent/stable altered participation can continue substantive therapy at a tolerable depth; limited/impaired capacity or concrete medical concern routes toward stabilization/outside help.
- When medical danger or acute instability is active, mechanically remove inward/deepening and stable-therapy routes rather than merely ranking safety above them.
- Treat visions, entities, recovered memories and cosmic certainty as experience-content rather than external proof; consequential claims wait for ordinary evidence and sober review.
- Preserve the public guide's distinction between established treatment, limited evidence, mechanism/preclinical evidence and personal field signal, but do not import experimental rescue substances, dosing regimens, or field remedies into executable InnerSignal emergency instructions.

### Reader guides and humanization

- Preserve all thirteen owner-confirmed guide destinations in `guides/public-guide-registry.json` and the unified plugin reference.
- Offer only directly relevant guides, answer the useful current-turn question first, and never use a guide referral as a safety/guardrail bypass.
- Track the somatic public edition as already humanized; inner-child, altered-states and hypnosis as separate planned humanized derivatives.
- Public humanized wording/structure may differ substantially from operational maps; substantive therapy changes still move upstream through the normal approval/reconciliation path.

## Validation before owner approval

Using repository-pinned Node 24.18.0 and the current Universal test-efficiency observer:

- `npm run graph:compile` — PASS; 3 graphs, 71 nodes, 95 edges, 115 source sections, 37 owner amendments.
- Focused somatic/altered integration + therapy routing — PASS.
- `npm run graph:test` — PASS, all canonical graph cases.
- Guide-graph + new integration tests — PASS.
- Realization/tiered-pipeline/representation affected tests — PASS.
- Unified-plugin/phenomenology/therapy-lessons affected tests — PASS.
- Therapy-latency semantic benchmark after intentional policy-fingerprint refresh — PASS; historical provider-stage/call-shape invariants preserved.
- `npm run audit:repository` — PASS, 0 errors; one pre-existing hosted GitHub App-permissions verification warning.
- `npm run authoring:project` — PASS; 382 generated files, 1 map.
- `npm run authoring:validate` — PASS; 382 files, 6 bases, 1 map.
- `npm run authoring:check` — PASS.
- `npm run authoring:maps:check` — PASS.
- Stale authoring inventory/provenance assertions exposed by the new graph/source identity were updated without weakening their checks; the affected authoring/provenance set passes.
- `tests/guide-fidelity.test.mjs` — PASS 13/13 in isolation after a later local full-suite attempt was interrupted by the execution harness.
- Exact-head hosted Verify subsequently passed the complete package gate with 1180/1180 automated tests before owner approval.

## Hosted persistence checkpoint

- The clean generated candidate was persisted by the self-cleaning branch workflow at `76092f95ba80e56f74d978043338118e17a60415` after exact patch-integrity checks, graph compilation, authoring regeneration/validation/checks, and focused graph/integration tests passed.
- Temporary patch transport, the temporary apply workflow, and the earlier baseline-export workflow are absent from the resulting PR diff.
- A stale package-verifier constant still requiring the former 62-node graph inventory was corrected to the deterministic 71-node graph; the repaired exact-head package gate passed.

## Owner approval and reconciliation — 2026-09-16

- At `2026-09-16T19:03:00.000Z`, the owner explicitly approved all five grouped semantic decisions, covering all 31 exact Guide Packet decision cards.
- Owner review was bound to graph candidate head `827e7f771aaf2b3ad9966f92be79e14b4c423772`; the three candidate graph files were verified unchanged before packet construction.
- Formal proposal build/check: PASS, 31/31 exact decision cards and 40/40 proposal regressions.
- Candidate packet SHA-256: `77534066bead4d7f232a8d40064518acdaea118b06169b8065d8143bb803dba8`.
- Approved packet SHA-256: `a548ed5e24c8e8f9f8f11fa3f56626053c9dce94b42eadbd8dfb474d3b09c16d`; deterministic verifier reports `approved=true`.
- Approval decision SHA-256: `77ecc12e44dde637e0fea9752600edd1f9b3977666bc5850db02a33fe3c99b35`.
- Reconciliation consumed that exact approved packet/hash and returned `installed=false`, `stableChanged=false`.
- Reconciled bundle SHA-256: `fcdcf09d660faa95636adf948b90efcc2decb38ec5742cf08ca3b28012c27dfb`; canonical graph regressions: 30/30.
- Formal reconciliation exposed one deterministic reviewed-tier therapy-benchmark fingerprint change. A two-iteration diagnostic confirmed the fast fingerprint stayed `a41487bbb92114b1870ee39826948065f75502e77c82c3373d27a5ee39dbe89f`, while reviewed changed to `f898656cb46a5f9971f25cc6f259169bf09c8c29ceea254b7866e72abeed5941`; processing tier, provider stages/call counts, one planning pass, and required timing invariants all remained unchanged. Only the bound reviewed fingerprint was refreshed, after which the complete reconciliation gate passed.
- Merge into development `main` completed after the final clean exact head passed the protected repository checks. Installation, deployment, and `stable` promotion remain explicitly unauthorized.

## Authority and safety boundaries

- Raw uploaded editor HTML and personal anecdotes are not committed as canonical guide source.
- The new altered-state text source is a safe operational extraction with explicit provenance boundaries, not a claim that the whole public guide is executable therapy authority.
- Generated source maps, compiled graphs and authoring projections are regenerated outputs, not hand-edited authorities.
- Owner semantic approval, Guide Packet reconciliation, exact-head protected CI, and merge into development `main` are complete for this exact 31-card change.
- `stable`, installation, deployment and clinical-efficacy claims remain outside this task.


## Terminal merge closeout — 2026-09-16

- Verified review head: `e48c183a725c9d894a6f401f87ae6bea181068cc`.
- Squash merge to development `main`: `0e132aa8b3826ff5cd57b70e07bd2591543087a2` at `2026-09-16T21:50:57Z`.
- Verified review tree and merged tree are identical: `e3e86a0fbfa136dfed7924a9690713bfa8553630`.
- Required protected checks on the exact review head: deterministic-package PASS, workflow-policy PASS, codeql-javascript PASS.
- The newer protocol-state provenance work already on `main` was preserved during base reconciliation; canonical approved graph files and approval/reconciliation receipts did not drift.
- `stable` remains `d74ae8b02d11b7edc72c70a753f6d93cf61e93b5`; installation, deployment, release, and stable promotion were not performed.
- Closeout recorded at `2026-09-16T21:56:12Z`.
