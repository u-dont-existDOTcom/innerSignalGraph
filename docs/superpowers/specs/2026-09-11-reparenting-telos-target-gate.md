# Reparenting Telos, Target-Utility, and Developmental-Prerequisite Gates

Date: 2026-09-11
Status: owner-authorized development candidate; not installed or released
Branch: `codex/reparenting-telos-target-gate-20260911`

## Problem

Inner Signal can preserve a relevant presenting emotion or episode so aggressively that salience becomes agenda. In reparenting work, a client may name shame, rejection, inhibition, a false-self feeling, or another painful event; the formulation can then promote that presentation into the active therapeutic bottleneck and spend turns asking what the emotion does, why it exists, or exactly how the episode hurt. Those questions can be coherent and still be therapeutically downstream.

The failure is not solved by simply following the client's current topic less or by asking fewer questions. The therapy has a defined telos: develop self-directed Nurturer, Protector, and Guide/Leader functions plus observable follow-through. Presenting symptoms and episodes are evidence about that developmental process; they are not automatically treatment targets. Role language is not proof that a coherent inner Adult or any particular capacity already exists.

The existing response realizer cannot reliably repair this mistake downstream because it is intentionally told that formulation is complete and must follow the deterministic intervention contract. The correction therefore belongs upstream in extraction, audit, target selection, and question eligibility.

## Governing developmental-prerequisite amendment

Every developmental question must independently pass both of these gates:

1. **Treatment utility:** plausible answers can materially change target, route, or intervention.
2. **Developmental prerequisite validity:** the question does not presuppose a caregiving/leadership function or internal relationship that current evidence has not established.

Gate 2 fails as `DEVELOPMENTAL_PREREQUISITE_VIOLATION`. Invalidating the question or strategy must preserve true source observations.

Adult, inner parent, Nurturer, Protector, Leader, Guide, child, and similar labels remain functional shorthand. The evidence-bearing units are observable capacities: noticing, staying present, caring, soothing without abandoning reality, protecting, orienting, deciding, guiding, tolerating affect, following through, and repairing after a miss. Client-supplied parts language may be used when helpful, but it does not establish a literal entity or adequate capacity.

The developmental route distinguishes `UNKNOWN`, `ABSENT_OR_INACCESSIBLE`, `PARTIAL_INTERMITTENT_STATE_DEPENDENT`, `AVAILABLE`, `AVAILABLE_LOW_CREDIBILITY`, and `INCREASINGLY_RELIABLE_CREDIBLE`. Unknown remains valid. Absence routes to bounded borrowed scaffolding and capacity construction; partial or state-dependent access routes to strengthening/generalization; available but distrusted capacity routes to credibility through observable follow-through; sufficiently reliable capacity permits role-specific reparenting and later ordinary-life transfer. “Adult acts first” is a credibility rule after enough function exists, not an existence assumption.

### Context-sensitive developmental inquiry

Successful-exception and breakdown-state questions are separate question classes. The planner selects from the current information gap:

- A successful-exception inquiry discovers what the client actually does differently when reparenting or self-love helps and which functions may already be emerging.
- A breakdown-state inquiry discovers what happens internally under shame, rejection, confusion, overwhelm, or loss of control and which functions disappear under load.
- Both may appear in the same reply only when each resolves a distinct unresolved action-changing uncertainty, neither repeats recent evidence, the client can likely tolerate two questions without losing focus, and no safety, stabilization, or external-action priority overrides them.

When both are justified, they are one discriminating comparison and may outrank a generic one-question heuristic. Their order is selected from context: successful-exception first is often useful for locating nascent capacity, while breakdown first may better attune to an acutely described distress state. When one side is already established or load argues for less, ask only the other. The planner must not manufacture a pair or ordering from a global template.

The selected inquiry must remain focused. Do not automatically bundle rejection meaning, shame-function theory, false-self ontology, substances, shaking, or generic consent/boundary teaching. These may remain background evidence unless they change the developmental route.

## Independent conception snapshot

This snapshot was fixed before the existing-work scan so external frameworks supplement rather than overwrite the project conception.

### Causal hierarchy

`presenting signal / episode -> younger-state expectation or unmet need -> inner-adult capacity or trust gap -> Nurturer / Protector / Guide corrective action -> repeated evidence -> increased trust / internalization`

### Failure pattern

`presenting signal -> theory about signal function -> more investigation of theory`

The second path may increase explanation without changing what the adult needs to become or do.

### Target-utility test

Before promoting an unresolved question or formulation into the active target, ask:

> If this were answered, could it materially change the selected younger-state need/expectation, Adult capacity, safety/external route, or corrective action?

If no, it remains background context rather than the active therapeutic target.

### Specificity / control requirement

This is **not** a ban on asking about shame, rejection, function, phenomenology, or present episodes. A symptom-level question remains eligible when different answers lead to materially different next actions. Example: if one answer would call for a Protector boundary response and another would call for a Nurturer repair response, the discriminator is treatment-relevant. If every plausible answer leaves the same Adult response unchanged, the inquiry is tangential for this therapy even if psychologically interesting.

## Existing-work scan

### Schema Therapy / limited reparenting

The International Society of Schema Therapy describes limited reparenting as organizing therapist responses around core needs and describes therapist regulation/care becoming internalized as a Healthy Adult mode. This is the closest mature analogue to Inner Signal's child/Adult developmental telos. Source: https://www.schematherapysociety.org/Limited-Reparenting

Use: adapt the **need -> adult capacity/internalization** orientation. Do not import Schema Therapy diagnoses, mode labels, or treatment claims wholesale.

### Mechanism-based case formulation / PACT

Hagmayer, Witteman, and Claes argue that case formulation is useful for treatment planning when knowledge of underlying mechanisms makes a difference to treatment selection, and that progress/failure should update the formulation. DOI: 10.1111/jep.13540; full text: https://pmc.ncbi.nlm.nih.gov/articles/PMC8247980/

Use: adapt the **decision utility** criterion. Mechanism curiosity is not sufficient; the mechanism inquiry should be capable of changing treatment selection or sequencing.

### Decision

**Adaptation/composition.** Existing work supports the direction but does not supply Inner Signal's exact Nurturer/Protector/Guide ontology, deterministic planner contract, audit architecture, or question-eligibility rule. Preserve the independent Inner Signal conception and add a bounded target-utility gate rather than replacing the framework.

## Required behavior

### 1. Extraction / formulation

For active reparenting work:

- Distinguish the presenting signal from the developmental repair target.
- Do not promote an emotion, episode, symptom, or client's causal guess into the active target merely because it is salient.
- Prefer the narrowest supported upstream target that changes the Adult response: a younger-state expectation/need, a credibility/trust gap, or a missing/weak Nurturer, Protector, or Guide function.
- Preserve uncertainty. Do not fabricate a childhood origin, child need, or Adult deficit simply to satisfy the hierarchy.
- A functional hypothesis such as “shame is protecting against rejection” remains provisional and should be pursued only when resolving it can change the repair action.
- When an existing active strategy is downstream and further clarification would not change corrective action, emit/retain `TARGET_MISMATCH` rather than polishing the same path.
- Unknowns should be treatment-changing discriminators, not merely interesting missing facts.

### 2. Independent audit

The auditor must check target level independently from factual support.

A strategy can cite true observations and still have the wrong target. The auditor should invalidate the active/proposed causal strategy when:

- it makes a presenting emotion/episode the treatment target;
- the proposed inquiry only refines an interpretation of that signal; and
- the plausible answers do not materially change safety/external routing, younger-state need/expectation, Adult function, or corrective action.

Do **not** invalidate when a symptom-level discriminator genuinely separates materially different interventions. This negative/control case is mandatory.

Invalidating a strategy must not delete true source observations. Target mismatch is distinct from evidence invalidity.

### 3. Question eligibility

A substantive question is eligible when at least one applies:

- safety/external action depends on it;
- it changes the developmental repair target;
- it selects among materially different Nurturer/Protector/Guide actions;
- it measures a prospective strategy prediction or determines whether to switch/stop;
- it resolves a current agreed task in a way that changes action.

A question that only adds phenomenological detail, explanatory elegance, or functional theory while the next action stays fixed is ineligible as the main therapeutic question.

### 4. Realization

“Live knot” means the resolved treatment-relevant bottleneck, not the most emotionally vivid or recently mentioned phenomenon. The renderer may acknowledge a presenting emotion without turning it into a new agenda. The renderer remains prohibited from silently redoing formulation; upstream layers must supply the correct target.

## Deterministic enforcement approach

Prefer reuse of existing machinery:

- Existing `TARGET_MISMATCH` is the strategy-switch signal; do not invent a parallel controller.
- Add an audit-owned path-strategy invalidation field so an auditor can withdraw a semantically wrong target without deleting valid observations.
- Mark strategy evidence invalidated/switch-pending through existing path-performance state so the controller performs material reconsideration.
- Make current-generation unknowns explicitly treatment/action-changing and filter explicitly non-action-changing unknowns from planner fallback. Preserve backward compatibility for historical snapshots that predate the marker.
- Keep current graph primitives; do not create a generic “shame” node or symptom-function subgraph.

## Regression matrix

### Positive failure case: downstream symptom theory

Synthetic transcript: client reports shame and a recent rejection while the established work concerns the younger state's distrust of the Adult position. Candidate asks whether shame is trying to protect against rejection or requests finer rejection phenomenology. All plausible answers leave the same Adult repair obligation unchanged.

Expected:
- shame/rejection retained as observations/context;
- no promotion to active root target;
- old symptom-level strategy is `TARGET_MISMATCH` / invalidated;
- next question, if any, discriminates the developmental repair target or Adult action.

### Negative/control case: symptom question changes action

Synthetic transcript: the same named emotion could reflect either fear of the Adult abandoning the younger state after social rejection or fear that the Adult will override another person's boundaries; the two supported alternatives would select materially different Nurturer versus Protector/Guide action.

Expected:
- a narrow shame/rejection discriminator remains eligible because its answer changes treatment selection;
- no global prohibition on emotion/function inquiry.

### Salience control

A vivid new episode is reported during an established developmental target but does not change the target.

Expected:
- episode is preserved;
- target stays stable;
- no route reset purely from vividness.

### Root-unknown control

Evidence does not support a developmental root yet.

Expected:
- preserve `unknown` rather than inventing childhood causation;
- ask the cheapest action-changing discriminator or take no substantive-question turn if none exists.

## Privacy and claims

- Use synthetic/de-identified fixtures only. No private case text, names, hashes, handoff IDs, or private-derived identifiers enter Git.
- This change is a product/framework policy correction, not evidence of clinical efficacy.
- Do not install, deploy, promote `stable`, or claim human usefulness from deterministic tests alone.

## Acceptance

The candidate is ready for owner/reviewer consideration when:

1. extraction and audit prompts encode both independent gates and the exact prerequisite-violation code;
2. auditor can invalidate a path strategy or ineligible question without deleting valid observations;
3. planner does not choose explicitly non-action-changing fallback unknowns or a question that presupposes unestablished capacity;
4. evidence-bound state distinguishes absence, partial/state-dependent access, availability, credibility, and increasingly reliable follow-through;
5. successful-exception and breakdown-state inquiries are independently selectable, a justified pair preserves context-selected order as one unit, and one sufficient question is not expanded into a pair;
6. realization defines the live knot as treatment-relevant rather than salient, preserves safety/external precedence, and rejects tangent bundling;
7. all `R-ADULT-01` through `R-ADULT-12` synthetic regressions and the earlier positive/negative target-utility controls are present;
8. targeted tests, graph compilation/regressions, therapy-lesson verification, authoring projection/checks, repository/publication audits, and the full package gate pass on the exact candidate commit;
9. fresh independent exact-head review and hosted exact-head checks are green before merge;
10. the public task ledger records verification without private case data.
