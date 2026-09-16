# Somatic and altered-states guide integration

Status: TESTED_ITERATION_CANDIDATE; draft PR only; not semantically owner-approved through the Guide Packet lifecycle, merged, installed, deployed, or promoted to `stable`.

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

## Validation completed locally

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
- `tests/guide-fidelity.test.mjs` — PASS 13/13 in isolation after a later full-suite attempt was interrupted by the execution harness.

Local complete-suite attempts were externally cut off by this chat/container execution limit before Node's test runner emitted a terminal full-suite result. Exact-head hosted CI is therefore the remaining complete package checkpoint after persistence to the draft PR; do not represent the interrupted local full-suite attempts as PASS.

## Authority and safety boundaries

- Raw uploaded editor HTML and personal anecdotes are not committed as canonical guide source.
- The new altered-state text source is a safe operational extraction with explicit provenance boundaries, not a claim that the whole public guide is executable therapy authority.
- Generated source maps, compiled graphs and authoring projections are regenerated outputs, not hand-edited authorities.
- This branch is a proposal. Project architecture still requires semantic owner approval through the Guide Packet decision/reconciliation lifecycle before these graph changes can merge as canonical development authority.
- `stable`, installation, deployment and clinical-efficacy claims remain outside this task.
