# Companion foundations checkpoint

Updated 2026-09-05. Task `COMPANION-FOUNDATIONS-20260905`. Draft PR #46 on branch `companion/foundations-2026-09-05`. Original main base: `64863eefa9678c063ed5c5a48a3280fa507a4c95`.

## Completed in the current bounded slice

The revision-2 fictional interface is published in this PR: fictional-history consent now lives with the progress examples; fixed fictional corrections invalidate obsolete readings; and the delayed-reply demo uses a one-use freshness guard so old replies cannot overwrite newer state.

A task-local synthetic reflection pipeline now separates:

1. current snapshot + permission/eligibility;
2. drafting against that snapshot;
3. freshness recheck;
4. substantive semantic review;
5. another freshness recheck before the caller may display the candidate.

`reflection-controller.mjs` denies semantic approval by default. `semantic-review-contract.mjs` now supplies a deterministic adapter between structured reviewer verdicts and the controller's exact in-process candidate/version/review binding. A model/reviewer does not have to recreate JavaScript object identity; only the trusted adapter can bind an all-pass review to the exact current candidate.

The provisional semantic rubric requires every response to pass evidence fidelity, calibrated uncertainty, consent/correction/worldview respect, non-sycophancy, proportional accountability, founder independence, and autonomy/non-dependence. Trusted case logic may additionally require progress balance, spiritual epistemic humility, self-guidance scrutiny, and safety/support continuity. The reviewer under test cannot opt itself out of required conditional criteria.

All 16 existing synthetic behavior cases now have an applicability plan. They remain **UNEVALUATED**: no model run, pass rate, clinical effect, or solved-sycophancy claim exists.

## Verification actually performed

Latest local task command on Node `v22.16.0` covered the revision-2 UI state model, corrections/layout, delayed-reply guard, synthetic snapshot/controller, semantic contract, and behavior-case applicability plan: **89 passed, 0 failed**.

The original 30 `policy.test.mjs` tests are not included in the 89 count because that file was not present in the extracted continuation workspace used for this local run. Exact-head hosted `npm test` remains the authority for the full repository.

Revision-2 UI browser evidence remains **64 assertions passed** in Chromium `144.0.7559.96` at 1400x1100, 390x844 and 320x720, with zero page network requests, page errors, or CSP console errors. The later controller/reviewer work adds no UI behavior, so no new browser claim is made for it.

No model call, semantic model evaluation, independent clinical review, or efficacy finding occurred.

## Product principles preserved

- Use **secular/non-spiritual** appropriately; never use a theological label as shorthand for non-spirituality.
- Founder philosophy may be stated honestly, but disagreement or improvement through another route is not evidence against the user.
- Inner adult/child integration and spiritual connection are founder-defined dimensions of complete healing; therapy, books, InnerSignal, or named techniques are not prerequisites for developing those capacities.
- Refusal is not resistance. Inner-child and spiritual invitations remain independently optional.
- Progress is evidence-linked, tentative, mixed when necessary, and never a percentage-healed score.
- Self-guidance is optional; concrete help cannot be withheld to force independence.
- Leaving InnerSignal does not require completion, agreement, or a spiritual milestone.
- Anti-sycophancy applies toward both user and founder.

## Scope and non-effects

Everything executable in this slice remains under `tasks/companion-foundations-20260905/`. Production code imports none of it. No real intake/history, persistence, vault/crypto or OS integration, provider/model call, active prompt, guide graph, Guide Packet, plugin, public pilot, deployment, main merge, stable promotion, or diagnostics change is claimed or authorized.

The synthetic snapshot adapter must not become a parallel memory backend. A real integration must use the approved privacy/vault boundary and must propagate corrections/deletions/consent changes across snapshots, pending work, derived interpretations, and display.

PR #42 and DEV-R005 remain separate and unchanged by this task.

## Historical Verify issue retained

At earlier PR #46 head `2a638d9089922380fc111898882d6f002c3c9b15`, hosted Verify produced 591/592 passing tests on Node 24.18.0. The sole failure was an unchanged publication-wrapper cleanup test observing exit 1 where 2 was expected. Its cause was not established. A later green run is not proof that this historical intermittent issue was repaired. Do not weaken or edit unrelated audit controls merely to obtain green CI.

## Next safe action

Advance the draft PR to this semantic-review head and read exact-head Verify, repository-workflow-policy, and CodeQL results. Keep the PR draft until deterministic checks and substantive review are satisfactory.

The next functional decision is whether to **run the 16 synthetic behavior cases against an exact model**. That requires explicit authorization, recorded model identity, bounded budget/call count, preserved failures, and an independent grading protocol. Until then, continue treating every behavioral case as unevaluated. Real-history integration remains later and separately reviewed.
