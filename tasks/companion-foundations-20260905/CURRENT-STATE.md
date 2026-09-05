# Companion foundations checkpoint

Updated 2026-09-05. Task COMPANION-FOUNDATIONS-20260905. Draft PR #46.
Branch: `companion/foundations-2026-09-05`.
Original main base: `64863eefa9678c063ed5c5a48a3280fa507a4c95`.

## Current completed slice

The previously blocked revision-2 fictional interface has now been packaged for publication on the PR branch. It moves fictional-history consent into the progress/example workspace, supports fixed fictional corrections that invalidate obsolete readings, and includes a one-use delayed-reply freshness guard. The interface remains scripted and fictional-only.

A separate task-local multi-stage reflection controller is now implemented for synthetic snapshots. Its stages are:

1. capture an exact current snapshot and confirm current eligibility;
2. draft against that snapshot;
3. recheck freshness/eligibility;
4. require a separate semantic-review result bound to the exact candidate, snapshot version, and review boundary;
5. recheck freshness again before release to a caller-controlled display boundary.

Semantic approval is deliberately denied by default. Freshness, provenance, a valid ticket, or an `approved: true` field by itself cannot authorize display. The controller contains no model call, clinical interpretation, storage, rendering, vault unlock, authentication, network transport, hashing, or production import.

The owner-approved philosophy, secular/non-spiritual terminology, invitation autonomy, natural-development recognition, progress principles, self-guidance, anti-sycophancy requirements, and unconditional app exit remain unchanged. The original 16 synthetic model-behavior cases remain unevaluated.

## Verification actually performed for this continuation

Local command on Node `v22.16.0`:

`node --test reflection-handoff.test.mjs reflection-controller.test.mjs mock/model.test.mjs mock/revision.test.mjs`

Result: **77 passed, 0 failed**. These tests cover the fictional UI state model, revision-2 correction/layout rules, one-use freshness seam, synthetic snapshot adapter, and multi-stage controller. The original 30 policy tests were not present in the extracted continuation workspace and were not rerun by this exact local command; do not fold them into the 77 count.

Revision-2 browser evidence remains the previously completed **64 assertions** in Chromium `144.0.7559.96` at 1400x1100, 390x844 and 320x720 using `set_content(exact_generated_html)`, with zero page network requests, page errors, or CSP console errors. The UI source published in the v2 commit is the same tested source. The controller adds no UI code, so no new browser-behavior claim is made for it.

The repository-required Node 24/full-package result must come from exact-head hosted CI after the branch is advanced. No model evaluation, independent clinical review, or efficacy finding occurred.

## Scope and non-effects

Everything executable in this companion slice remains under `tasks/companion-foundations-20260905/`. Existing production application code imports none of it. No real intake/history, persistence, vault/crypto or OS integration, provider/model call, active prompt, guide graph, Guide Packet, plugin, public pilot, deployment, main merge, stable promotion, or diagnostics change is authorized or claimed.

The snapshot adapter is synthetic test infrastructure. A real integration must use the already approved privacy/vault boundary rather than creating another memory backend. Controller freshness is not semantic truth; semantic review is not treatment efficacy; neither substitutes for user correction/deletion propagation.

PR #42 and DEV-R005 remain separate. Their authority and checkpoints are unchanged.

## Historical repository verification issue

At the earlier PR #46 head `2a638d9089922380fc111898882d6f002c3c9b15`, Verify run `33981730924`, job `101348077366`, produced 591/592 passing tests on Node 24.18.0. The sole failure was the unchanged publication-wrapper test `hosted wrapper preserves invalid-audit exit after transient cleanup failure`, observing exit 1 where 2 was expected. The cause was not established. Repository workflow policy and CodeQL passed on that head.

Do not erase that evidence if a later head is green, and do not edit publication-audit infrastructure merely to make this companion PR pass. A causal repair requires a focused reproduction and diagnosis on a supported checkout.

## Next safe action

Advance the draft PR to the exact companion head and read exact-head Verify, workflow-policy, and CodeQL results. Keep the PR draft until the package gate and substantive review are satisfactory.

Next functional work after deterministic review: define the **semantic reviewer contract and evaluation protocol** using only synthetic/approved fixtures. It must test non-sycophancy, mixed progress, user corrections, founder disagreement, and refusal without treating model agreement as success. Do not run the 16 behavior cases against a live model without explicit authorization and recorded model identity/budget. Real-history integration remains later and separately reviewed.
