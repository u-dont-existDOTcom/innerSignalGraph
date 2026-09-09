# Method value and delivery-system trust

Status: OWNER-AUTHORIZED candidate implementation on PR #46, 2026-09-07. Source: the current direct owner lesson and its seven required adversarial contrasts. This specification records product/safety policy; it does not assert clinical efficacy or establish any real practitioner's motives. No merge, installation, deployment or stable promotion.

## Separate judgments

A method or environment can be useful while its provider, supervision or business model is inadequate. `DeliverySystemAssessment` returns independent `method` and `trustStatus` records, an explainable `practitionerDecision`, findings with evidence references and owner-policy provenance, positive signals, unknown dimensions, financial opportunity cost and actions. Method benefit is UNKNOWN, PLAUSIBLE, OBSERVED_PARTIAL, OBSERVED_USEFUL or NO_BENEFIT, with its own time horizon, source and currentness. User or independent personal-outcome observations support observed value; provider marketing cannot establish it. A reported benefit is not clinical efficacy, mechanism confirmation or a total cure. The Path Performance Controller's prospective MOVING result remains separately bound to actual delivery and predictions.

Trust states are TRUSTED_ENOUGH, UNCLEAR, CAUTION and HIGH_RISK_DELIVERY. Practitioner decisions additionally express SEEK_ALTERNATIVE_PROVIDER or METHOD_OK_PROVIDER_NOT_OK. TRUSTED_ENOUGH is conditional on supplied current evidence, not accreditation, independent provider verification or clinical endorsement. Missing/stale/withdrawn observations remain unknown. No numerical trust score or inferred motives are produced.

## Evidence and required dimensions

The single shared pure module is `src/case-formulation/delivery-system-assessment.mjs`. It has a strict bounded JSON schema and 26 dimensions. Each supplied fact includes YES/NO/UNKNOWN, direct observation references, USER_REPORT/PROVIDER_STATEMENT/DOCUMENTED_OFFER/INDEPENDENT_REPORT provenance and explicit currentness. Provider claims remain provider claims, even when relevant to checking an offer. The method's plausible/observed benefit is represented separately from these dimensions:

- self-practice availability and potential destabilization;
- proactively explained adverse effects, accessible stop criteria and titration guidance;
- accessible low-cost safety questions, ordinary safety support and premium gating;
- package proportionality to deliverables, lower-cost/trial/one-off/sliding-scale/group/donation options;
- package pressure, scarcity/urgency, unique or total-cure claims;
- dismissal of destabilization as release versus concrete titration/reassessment;
- transparent scope, credentials, supervision, cancellation/refund, adverse escalation and boundaries;
- defined support between sessions, independent reviews and complaints/adverse reports;
- acknowledgment of uncertainty and alternative supports.

Basic harm-management information, stop criteria, titration guidance and a reasonable route for safety questions should not require purchasing a premium luxury package when the ordinary offering enables self-practice of a potentially destabilizing intervention. Cheap self-practice plus destabilization risk, an accessible-safety gap, basic support gated behind a premium and disproportionate package value yields BASIC_SAFETY_BEHIND_EXORBITANT_PREMIUM / HIGH_RISK_DELIVERY. Even without the premium facts, documented unsupported destabilizing self-practice can be high risk. This is an assessment of the arrangement: a serious trust red flag and reason not to rely on that provider yet. It is not a finding of greed, fraud or money-only motivation.

Overpriced but optional premium coaching with adequate accessible ordinary safety support produces a price/value finding without forcing provider rejection. Other adverse signals cannot be canceled by helpful method effects or positive testimonials. A concrete response with dose reduction, stop criteria, affordable safety access and appropriate referral/escalation can decrease concern when fresh observations resolve the relevant adverse facts. Mere reassurance or silence cannot do so.

## Resource fit

`assessOpportunityCost` is shared with the existing external-support financial audit. It retains affordability against the user's cap, explicitly consented income/disposable ratios and unknowns. Amounts must share currency and commitment horizon; travel, accommodation and safe exit belong in the external navigator's all-in commitment. No currency conversion is inferred. Withheld income is not treated as zero.

Two or more months of income or disposable resources, exceeding the user's cap, or a nonzero commitment against explicitly consented zero income/disposable resources triggers a strong opportunity-cost warning and a staged, small, reversible trial requirement before considering the large uncertain package. The two-month trigger is an explicit conservative candidate engineering interpretation of the owner's several-month warning, not a validated clinical threshold or a universal affordability rule. A low-cost single consult/sliding scale, group/donation option or small cancellable package can supply the next test. A person's constrained resources alone do not establish provider dishonesty or unsafe delivery. Existing independent-fit, deliverables and staged-purchase checks remain necessary.

## Controller composition

`path_update.delivery_review` binds the assessment to the active process and graph path. The existing audited extraction proposes evidence only; deterministic code owns assessment, decisions and retained history. Explicit delivery assessments require reviewed processing even when Fast was requested. No new inference service, navigator, persistence service or remote diagnostic schema is created.

- MOVING plus high-risk delivery retains method status and chooses alternative supervision/provider; the previous exercise cannot continue through the same response.
- Real personal benefit plus dose/delivery problems allows KEEP_BUT_TITRATE with SEEK_ALTERNATIVE_SUPERVISION where needed. It means agreeing safer limits/support before more practice, not declaring a safe dose or confirming a mechanism.
- Poor method fit/performance and poor delivery support switching both. Missing outcome measurement alone is uncertainty, not proof the method has no value.
- Harm and significant destabilization keep the existing stop/protection priority. Push-through advice in the presence of harm requires de-escalation. Benefit, pressure, a cheaper offer or changing provider cannot override consent, existing safety constraints or failed method predictions.
- Provider review alone is not another method outcome opportunity, and provider-only rejection does not mark an unknown method failed. Predictions, failure counts and original episode identity survive supervision changes. Cosmetic wording/provider labels cannot reset the evidence.

The existing case snapshot holds at most 12 provider/method assessment records and 512 consumed observation IDs per record. A different provider requires its own fresh binding and delivery facts. Facts are revised only using new event references. Audit withdrawal removes only dependent delivery facts; unrelated method predictions survive. Consumed IDs remain tombstones against replay. Returning to a provider, including through a different process episode, retains its earlier adverse evidence. Each episode references a selected assessment key; the provider/method ledger and tombstones are case-level. Withdrawing method-benefit evidence demotes only that method judgment to unknown, preserving separately supported delivery risk. The planner passes separate findings/actions to realization and prohibits declared repetition of the interrupted exercise. Structural response checks do not prove prose-level honesty or semantic compliance.

Legacy graphs without `pathPerformancePolicyVersion: 1` cannot activate this candidate. The shared module participates in the existing authoring semantic fingerprint so old proposals become stale after this policy changes. Source articles, graph nodes and archived candidate packets are preserved.

## External-support composition

The task-local `tasks/external-support-20260907/support-contract.mjs` reuses the same assessment for retreats, residential programs, farms and coaching ecosystems. ProgramAudit accepts an optional assessment whose provider ID must match the program. `assessFit` exposes environment/function fit separately from delivery trust: a good environment cannot make HIGH_RISK_DELIVERY acceptable, and explicitly uncertain/cautionary delivery remains pending. `assembleSupport` excludes those modules while preserving uncovered functions and all hard user constraints. Legacy candidate callers that omit the new field remain compatible and explicitly report UNASSESSED, not trusted.

`assessMethod` preserves existing adverse-now/protective stops and personal benefit while exposing delivery findings and alternative-provider/supervision actions. `assessFinancialFit` reuses the shared opportunity-cost calculation and preserves the existing independent-quality, practical-information and small reversible purchase requirements. Runtime code never imports this task-local navigator prototype; it remains an uninstalled candidate contract, not live discovery or a verified directory.

## Verification and unresolved meaning

`tests/delivery-system-assessment.test.mjs` implements the seven owner contrasts plus safety, schema, reference, replay/withdrawal, scope, legacy and failed-prediction cases. The external task's additive composition tests exercise program fit, modular exclusion, method preservation and finance reuse. Existing authoring stale-proposal coverage includes the new dependency. See `tasks/delivery-trust-20260907/INTEGRATION.md` for the measured gates and final change manifest.

Remaining semantic evidence: actual extractor recognition, source freshness, provider identity resolution, interpretation of proportionality/complaints, honest prose realization, clinically appropriate dosing/referral and real availability of affordable alternatives. Run additive fictional multi-turn behavioral/harm review through the existing fidelity architecture with explicit current model/source/budget authority before claiming such fidelity. Deterministic tests are not that evaluation and establish no clinical efficacy. No unresolved owner policy choice blocks this bounded implementation.
