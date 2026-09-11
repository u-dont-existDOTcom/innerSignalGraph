# Reparenting telos target-gate integration ledger

Date: 2026-09-11
Branch: `codex/reparenting-telos-target-gate-20260911`
Base: `ad441affd378e06d6395e0ba4ec0760eaaea5d52`
Status: implementation complete; exact-head hosted verification pending; not merged, installed, deployed, or promoted

## Owner outcome

The owner identified a therapy-target failure: Inner Signal was pursuing tangential questions about a presenting symptom (including whether shame is protective and detailed rejection phenomenology) rather than using the material to reach the reparenting root. The owner clarified that the therapist must not merely follow the client's named topic; the telos is reparenting and the system should seek the developmental child/Adult repair target that determines Nurturer, Protector, or Guide action.

This task is authorized to implement that semantic correction without weakening consent/boundary safeguards or deleting relevant observations. It must not introduce a blanket ban on discussing shame/rejection; a symptom-level discriminator remains valid when its answer materially changes the corrective action.

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

## Root cause found

The failure was not only local steering. The shared longitudinal rule set itself privileged client-generated functional hypotheses and instructed the system to investigate what a state was doing/protecting against without first checking whether that answer could change treatment. Because the final realizer is intentionally prohibited from redoing completed formulation, an upstream symptom-level target could then propagate intact into the response. The repair therefore belongs in extraction/audit/shared target-selection policy rather than primarily in prose realization.

## Verification history

The first hosted deterministic-package run on development head `dad3b06f82003c2eea141b59eb33740ae2493454` failed 2 of 1,100 tests. Both failures were compatibility regressions rather than evidence against the target-utility architecture:
- the guide-fidelity fake auditor did not yet emit the newly required `invalidate_path_strategy` field, so its simulated pipeline was blocked by validation;
- one pre-existing longitudinal invariant test matched the old exact target phrase and needed to assert the stronger reparenting-aware wording.

Both were repaired without weakening the live generation/audit requirements. Repository workflow policy and CodeQL were already green on the failed deterministic head. A new exact-head hosted run is required after the final documentation/lesson commits; do not report the candidate verified until that run is successful.

## Privacy

No private transcript, person name, private handoff/candidate/audit ID, or private-derived digest is permitted in this public task. Regression fixtures are synthetic.

## Release boundary

No merge, deployment, installation, `stable` promotion, release, or clinical/human-usefulness claim is authorized merely by this development task or deterministic test success. PR #52 remains a draft development candidate pending exact-head verification and owner/reviewer disposition.
