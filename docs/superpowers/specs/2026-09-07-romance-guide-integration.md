# Romance guide selective integration — candidate v1

## Decision and authority

**COMPOSE / ADAPT.** The owner requested incorporation of the appropriate parts of the uploaded romance guide and an optional reference to `https://romance.u-dont-exist.com`. This is candidate-development authorization, not installation, deployment, a merge, or stable promotion. The source is the 83-page PDF labelled **Updated Aug 27, 2026**, not a reconstructed article or a later website revision.

`tasks/romance-guide-20260907/SOURCE.json` binds the PDF SHA-256, revision, 20 page-anchored excerpts, and quotation/span hashes. Wording is preserved; only whitespace and line-wrapped hyphenated words are normalized. The whole source was reviewed, including the visual summaries on PDF pages 44 and 55. These emphasize chosen roles, equal dignity, freedom, and de-ontologized twin-flame meaning; they do not justify overriding safety or refusal.

`SUPPLEMENT.json` separates twelve source-derived operational adaptations from explicit integration safeguards. It does **not** rewrite the article or silently turn selected interpretations into the author's verbatim position. Original personal, philosophical and medical claims are not globally endorsed by inclusion of the source.

## Independent conception before the bounded scan

Problem: useful relationship distinctions can be lost if the entire article is either ignored or pasted into every therapy prompt. Mechanism: retain exact source excerpts, select only task-relevant behavioral context, and leave wider romance material optional. Constraints: preserve source authority, current task, client autonomy, app-owned safety/consent, source-fidelity baselines, privacy and release gates. Candidate insight: readiness, felt intimacy, compatibility and lasting improvement require different evidence.

## Existing work and integration boundaries

- **Reuse:** current `src/guide-graph/planner.mjs` case-plan-v5 `requiredNuance`, `forbiddenOverclaims`, primary job, question contract and turn-task precedence. No second graph planner or private-client memory backend.
- **Compose:** existing guide-fidelity source references and non-claims; retain the current three-condition baseline and frozen calibration/corpus. A later supplemented response needs a separately versioned evaluation condition.
- **Adapt:** W3C PROV-O's distinction between quotation, derivation and attribution informs the source-versus-adaptation records. This small JSON record is not an RDF implementation or a claim of PROV conformance. Source: https://www.w3.org/TR/prov-o/ (reviewed 2026-09-07).
- **Reuse concept, not infrastructure:** HL7 FHIR R5 PlanDefinition distinguishes a definition and its applicability conditions from actual application/execution. That supports keeping this candidate context separate from activation; adding FHIR infrastructure would be unnecessary. Source: https://fhir.hl7.org/fhir/plandefinition.html (reviewed 2026-09-07).
- **Not solved by these precedents:** clinical readiness thresholds, benefit, individual risk assessment and live conversational fidelity. This slice does not invent a scoring instrument, time-to-healed rule, or a replacement for the separately requested path-performance/readiness controller.

## What is incorporated

| Rules | Source pages | Therapeutic function |
|---|---|---|
| RG01–RG03 | 3, 10, 22, 24–25, 79 | Readiness without perfection; wanting versus caring; demonstrated capacity versus testimony or insight. |
| RG04–RG07 | 31, 37, 42, 50, 60–61, 64, 76 | Pace entanglements; reciprocal support versus default parent/therapist; wider support with privacy; concrete agreements and consent. |
| RG08–RG10 | 10, 34, 68, 76, 79 | Coercion is not a mutual exercise; check present reality before attributing jealousy inwardly; separate children's care from romantic outcomes. |
| RG11–RG12 | 22, 24, 42, 70, 72, 76, 78 | Ordinary-life transfer rather than state intensity; reconsider repair, restructuring, separation and ending when the present path fails. |

The readiness adaptation preserves the owner's strong caution: where substantial current foreseeable harm remains, active romance-seeking can be paused while structured non-romantic support increases. It is not a demand for complete healing, a diagnosis-based permanent exclusion, a prediction of inevitable catastrophe, or software authority to control an adult's relationships. Pausing new romantic escalation is not an automatic breakup order for an existing couple. Parenting responsibility is conditional on relevant children or reproductive consequences, not an assumption that all clients want children.

Goal substitution requires evidence: wanting a relationship alone does not prove that all friendship is instrumental. Conversely, seeking a partner through a nominal support activity is not automatically evidence that non-romantic support is developing. Temporary/accommodated care and healthy reciprocity are controls against falsely classifying every need for help as dependency.

## Optional versus excluded material

Adult questions about polarity, relationship forms, spiritual romance and non-graphic sexual communication can receive bounded, context-sensitive discussion. No forced gender roles, twin-flame ontology, monogamy/non-monogamy, or spiritual explanation is installed. An intense or sacred experience does not establish another person's consent, reciprocity, suitability, or a reason to remain in danger.

Contraceptive/herbal efficacy, anatomical claims, drug-treatment protocols and explicit techniques are **not imported as clinical instructions**. Autobiographical allegations and diagnostic interpretations are not turned into rules about absent people. This is an explicit adoption boundary, not a silent edit or a claim that the article has been independently fact-checked.

A reference is an optional resource, not a promotional exit or a way to bypass a medical/safety answer. Preserve help in the current conversation. Suppress the full adult guide for minors/unknown age, acute safety/stabilization, completed work, declined reading, repeated offers without renewed interest, and unsafe/medical-practice requests. Never auto-fetch/open the article or append private information to its URL.

The owner-specified address is registered, but reachability is **unverified**: the web read returned a cache miss. The candidate resolver returns `LINK_VERIFICATION_REQUIRED` rather than claim a working redirect. Readback of the actual landing page is needed before automatic presentation is enabled; do not silently substitute another URL or source version.

## Executable boundary

`tasks/romance-guide-20260907/context.mjs` exports source validation and `composeRomanceContext(plan, options)`. Explicit opt-in is required. It composes selected source context with case-plan-v5 without changing the primary route, question, consent contract or blocked nodes. Inconsistent safety/stabilization plans and a paused new-romance path return `canRealize:false` and a replan directive. Callers must honor that result before realization.

Readiness is an input from a separately evidenced assessment, not inferred by this adapter from a diagnosis, a warm interaction, or a hospital history. Unknown stays unknown. Returned progress checks are predictions/criteria for the path controller; this module does not collect trajectories or claim to implement the whole switching controller.

**Not wired into ordinary runtime/model responses.** Current installed guides, graph sources, source pins, frozen evaluations, privacy storage and the pending fidelity smoke remain unchanged. Runtime activation requires the existing source/owner/fidelity/Guide Packet and release gates. Do not relabel this source integration as completion of prior worker handoffs.

## Evaluation and next integration step

The baseline is the existing candidate without the romance supplement. Unit tests check source integrity, relevant/irrelevant selection, negative controls, safety precedence, source traceability and no mutation. `SEMANTIC-CASES.json` is a separately versioned fictional behavioral supplement; no real client narrative is included and no target-model responses or semantic pass rates are claimed.

When the current path/readiness implementation is committed, reuse this supplement through one caller, rather than duplicate its policy or create a second controller. Bind assessed readiness and current task to the adapter, honor `canRealize`, retain the source trace, and compare baseline versus supplemented replies using the existing independently calibrated fidelity workflow. Evaluate helpfulness and harms separately from mechanical checks. No paid calls are authorized or spent by this slice.
