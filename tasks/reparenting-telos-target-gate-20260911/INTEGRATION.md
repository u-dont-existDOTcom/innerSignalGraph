# Reparenting telos target-gate integration ledger

Date: 2026-09-11
Branch: `codex/reparenting-telos-target-gate-20260911`
Base: `ad441affd378e06d6395e0ba4ec0760eaaea5d52`
Status: developmental-prerequisite amendment implemented and locally verified; independent exact-head review and hosted checks pending; not merged, installed, deployed, or promoted

## Owner outcome

The owner identified a therapy-target failure: Inner Signal was pursuing tangential questions about a presenting symptom (including whether shame is protective and detailed rejection phenomenology) rather than using the material to reach the reparenting root. The owner clarified that the therapist must not merely follow the client's named topic; the telos is reparenting and the system should seek the developmental child/Adult repair target that determines Nurturer, Protector, or Guide action.

This task is authorized to implement that semantic correction without weakening consent/boundary safeguards or deleting relevant observations. It must not introduce a blanket ban on discussing shame/rejection; a symptom-level discriminator remains valid when its answer materially changes the corrective action.

The owner then supplied a governing developmental-prerequisite amendment. Reparenting relevance does not prove that a coherent Adult, inner parent, Nurturer, Protector, Leader, or Guide exists or can perform the proposed action. The runtime must establish the observable function first and audit unsupported role assignment separately from ordinary treatment utility.

## Independent conception

See `docs/superpowers/specs/2026-09-11-reparenting-telos-target-gate.md`. The conception snapshot preceded the bounded existing-work scan.

## Existing-work decision

Adapt/combine rather than replace:
- Schema Therapy limited reparenting supports organizing repair around core needs and internalization of Healthy Adult capacities.
- PACT mechanism-based case formulation supports investigating mechanisms when doing so can change treatment selection.
- Inner Signal retains its own Nurturer/Protector/Guide ontology, deterministic graph, evidence/audit contracts, and privacy boundary.

## Implemented architecture

1. Extraction now holds the reparenting telos fixed and distinguishes presenting signals from the developmental repair target.
2. Current generated unknowns declare `changes_next_action`; explicitly false entries are normalized out before deterministic planning, while historical snapshots that predate the marker remain readable.
3. The independent audit applies the same treatment-utility test and can set `invalidate_path_strategy=true` when a supported observation has been promoted into the wrong therapeutic target.
4. Strategy invalidation preserves true observations while withdrawing the semantically wrong strategy/representation and reuses the existing path invalidation / `TARGET_MISMATCH` reconsideration controller.
5. Shared longitudinal rules no longer force pursuit of a client-generated functional hypothesis merely because it is coherent. They first test whether confirming versus disconfirming it can change target, route, or intervention.
6. The negative/control case is explicit: symptom-level inquiry remains eligible when plausible answers select materially different Nurturer, Protector, or Guide actions.
7. Synthetic regressions cover schema contracts, question-utility normalization, target invalidation without evidence deletion, shared-rule drift, and positive/control prompt behavior.
8. The reusable candidate lesson is recorded in `THERAPY-LESSONS` without private case content.
9. A first-class evidence-bound developmental-capacity projection distinguishes unknown, absent/inaccessible, partial/state-dependent, available, available-but-low-credibility, and increasingly reliable/credible conditions, with observation references and per-function access.
10. Extraction and audit apply a second independent developmental-prerequisite gate and retain `DEVELOPMENTAL_PREREQUISITE_VIOLATION` findings while withdrawing the offending question or route.
11. The planner selects a successful-exception inquiry, a breakdown-state inquiry, or both. A pair is permitted only when both sides remain distinct and action-changing, neither is redundant, two questions are tolerable, and no higher priority applies. The order is selected from context; no map-wide mandatory pair or fixed ordering remains.
12. The response contract preserves an authorized pair as one exact ordered unit, prevents generic question minimization from splitting it, and rejects unauthorized tangent questions. Single-question routes remain single.
13. Capacity evidence persists longitudinally, participates in reviewed-tier routing, and projects into the existing guide graph. One contrast node coordinates assessment; existing scaffold, access/generalization, credibility, and role-specific nodes remain the intervention primitives.
14. Twelve named synthetic regressions cover prerequisite failure, positive and state-dependent controls, functional language, evidence carry-forward, borrowed scaffolding, credibility sequencing, safety precedence, context-sensitive contrast selection, question-count policy, tangent rejection, and evidence-derived role routing.

## Root cause found

The failure was not only local steering. The shared longitudinal rule set itself privileged client-generated functional hypotheses and instructed the system to investigate what a state was doing/protecting against without first checking whether that answer could change treatment. Because the final realizer is intentionally prohibited from redoing completed formulation, an upstream symptom-level target could then propagate intact into the response. The repair therefore belongs in extraction/audit/shared target-selection policy rather than primarily in prose realization.

## Verification history

The first hosted deterministic-package run on development head `dad3b06f82003c2eea141b59eb33740ae2493454` failed 2 of 1,100 tests. Both failures were compatibility regressions rather than evidence against the target-utility architecture:
- the guide-fidelity fake auditor did not yet emit the newly required `invalidate_path_strategy` field, so its simulated pipeline was blocked by validation;
- one pre-existing longitudinal invariant test matched the old exact target phrase and needed to assert the stronger reparenting-aware wording.

Both were repaired without weakening the live generation/audit requirements. Repository workflow policy and CodeQL were already green on the failed deterministic head. Those results predate the developmental-prerequisite amendment and do not verify it.

After the governing amendment was integrated, focused source acceptance, all twelve `R-ADULT-*` regressions, graph compilation/regressions, authoring projection/checks/maps, and A001 formulated replay passed. The first complete amended package run found four compatibility contracts that still described the pre-amendment system: graph/authoring inventory counts, the therapy-policy fingerprint, developmental-capacity-aware checkpoint replanning, and the package replay's old A001 primary. Those contracts and the checkpoint replay path were corrected without weakening assertions. The final pre-review Node 24.18.0/npm 11.16.0 package gate then passed 1,095/1,095 automated tests, 29/29 graph cases, the 305-file authoring projection at input digest `be76479fe2e7eaa61ebee5c045123130a833c1a288a90fdaa786006e63026932`, A001/H001 replay, web/runtime/autopilot checks, repository audit, publication audit, and package hygiene. No paid provider call was made.

This local pass is implementation evidence, not independent or hosted exact-head evidence. The final candidate commit still requires a fresh independent review, PR-head checks, merge, and post-merge verification before completion can be claimed.

## Privacy

No private transcript, person name, private handoff/candidate/audit ID, or private-derived digest is permitted in this public task. Regression fixtures are synthetic.

## Release boundary

No deployment, installation, `stable` promotion, release, or clinical/human-usefulness claim is authorized merely by this development task or deterministic test success. PR #52 remains a draft development candidate pending independent exact-head review and hosted checks.
