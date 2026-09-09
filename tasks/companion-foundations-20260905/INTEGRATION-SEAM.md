# Companion integration seam: freshness, provenance, and substantive review

Status: offline synthetic implementation proposal, 2026-09-05. No real-history or production integration.

## 1. Revision-2 history and request freshness

The fictional-history opt-in is grouped with the progress examples. Corrections and withdrawals invalidate obsolete readings. `reflection-handoff.mjs` owns one opaque request ticket and stores no evidence, source IDs, identity, hashes, or prose. Context/consent/source changes invalidate pending work; an old delayed reply cannot overwrite newer state.

This checks request freshness only. It is not authentication, storage, deletion, evidence extraction, semantic review, or transport cancellation.

## 2. Multi-stage controller

`reflection-controller.mjs` and `synthetic-snapshot.mjs` separate snapshot authority, eligibility/freshness, drafting, semantic review, and display release. Freshness is rechecked after drafting, after semantic review, and before returning `READY_FOR_DISPLAY`. A newer run or explicit invalidation supersedes older asynchronous work.

Freshness/provenance never counts as semantic approval. An old semantic review cannot make a stale candidate current again.

## 3. Semantic-review contract

`semantic-review-contract.mjs` is a deterministic adapter. The reviewer supplies structured criterion verdicts; trusted orchestration supplies which conditional criteria apply and the controller's exact in-process candidate/version/review binding. Only an all-pass review can be bound to those exact objects.

Universal criteria:

- `evidence_fidelity`
- `uncertainty_calibration`
- `consent_correction_worldview`
- `non_sycophancy`
- `accountability_proportionality`
- `founder_independence`
- `autonomy_non_dependency`

Conditional criteria, selected by trusted case logic rather than the reviewer under test:

- `progress_balance`
- `spiritual_epistemic_humility`
- `self_guidance_scrutiny`
- `safety_support_continuity`

Verdicts are `pass`, `revise`, or `block`. Every universal and required conditional criterion must pass. `revise` or `block` denies display until a new candidate is reviewed. Unknown, duplicate, missing, or extra criterion records fail closed.

This fixes an important architecture issue: a future JSON-returning model should not be asked to recreate JavaScript object identity. The model can produce structured judgments; the deterministic adapter performs the binding locally.

## 4. Behavior evaluation plan

`behavior-case-review-plan.json` maps all 16 existing synthetic behavior cases to their primary rubric concerns and required conditional criteria. Every actual review still receives all universal criteria. Cases marked `pairedStance` are intended for a later contrast in which pressure to agree changes while material facts stay constant; evidence-based judgments should not flip simply to follow the user or founder.

The plan explicitly covers unsupported motive attribution, responsibility without humiliation, excessive self-blame, mixed progress, correction/revocation, optional self-guidance, scrutiny of inner guidance, app exit, founder disagreement, secular/spiritual framing, and missed support sessions without automatic diagnosis.

The 16 cases have **not** been run against a model. Static mapping tests are not semantic evaluation.

## 5. Real application responsibilities — not implemented

A real caller must obtain a permission-scoped current snapshot from the approved history/vault architecture. Keep user reports, assistant hypotheses, confirmations, and corrections distinguishable; bind episode/source versions; retrieve relevant complicating evidence; and apply the permission/provenance gate before drafting.

Every material mutation must invalidate pending work and derived interpretations: correction, deletion, consent withdrawal, user/scope change, logout/close, mandatory vault lock, or any other context change that invalidates the snapshot. Cancelling controller work does not recall already-sent provider data or erase persistence; upstream integration owns provider disclosure/retention, transport cancellation, and deletion propagation.

The semantic reviewer must evaluate the exact candidate and current evidence, but its structured pass still does not establish clinical benefit or truth of upstream evidence. A second reviewer may add evidence; it is not automatic certification.

Do not create a parallel storage backend, whole-account history ingestion, or model-owned permission mechanism.

## 6. Verification and historical issue

Current local task suite: **89/89 passed** on Node v22.16.0. No model/network/persistence/hash implementation exists in the controller/reviewer adapter. Revision-2 UI browser evidence remains 64 assertions on unchanged UI source.

Earlier PR #46 hosted Verify at head `2a638d9089922380fc111898882d6f002c3c9b15` had one unrelated publication-wrapper test failure (591/592). Cause remains unproven. Preserve it; do not weaken unrelated controls for this companion work.

No model evaluation, clinical efficacy claim, real data, deployment, merge, or stable promotion is authorized by this document.
