# Specific map/source reconciliation and implementation specification

Date: 2026-09-06. Reviewed baseline: `046614b045d4a15ea71b3b61e74b11d6b615a2ed`, draft PR46. Status: source-grounded proposed changes, NOT enacted policy or a clinical sign-off. No runtime/graph/provider/stable/frozen-evaluation changes occurred in this audit. Source registry: `docs/research/THERAPEUTIC-SOURCES.md`. Acceptance contrasts and executable read-only probe: `tasks/map-literature-reconciliation-20260906/`.

## Scope and reuse decision

The owner requested specific reconciliation rather than another generic book review. We examined the relevant candidate graphs, normalized fields, extraction/audit schemas, planner, Fast/Reviewed plan-to-adjudication path, realization prompt, response enforcement and companion checkpoint. The decision is to adapt existing task analysis and functional-assessment ideas within existing code, not create ten modality departments, another memory service or a new clinical scoring system.

Direct book reading is targeted to relevant sections. This is not a contemporary efficacy review or cover-to-cover claim. The previous eight-book suggestions were reconciled with current code; the two new sources add specific action and emotion-task details. Only one new clinical job is proposed below: spiritual struggle. The other changes repair or deepen existing jobs.

## Keep, do not duplicate

- `caseSnapshotSchema` already has `user_goal` and `current_issue`. Do not create another goal system.
- `sharedClinicalRules`, extraction and hypotheses already separate reports, inferred roles, causes and uncertainty. No new generic epistemology department.
- `IC.NEUTRAL_WITNESS` already distinguishes witness from adult capacity.
- `IC.BORROW_LOVE` already distinguishes available affection from safety of receiving it. `IC.DEEP_LOVE_TO_CHILD` already addresses recoil and blocked inclusion without force.
- `IC.BORROW_ONE_FUNCTION` already supports the would-be adult as well as the younger state. `IC.ADULT_APPRENTICE` already returns functions and judgment.
- `IC.CREDIBILITY_REPAIR` already distinguishes an adverse record from no record, hears valid complaints and pairs relational repair with practical follow-through.
- `IC.PROTECTOR_ACTION`, `ROUTE.ACT_OUTWARD` and the apprentice already prescribe small real actions. Behavioral problems already qualify for `actionable_problem`.
- `ROUTE.RELATIONAL_REALITY_CHECK` already contains observation, capacity assessment, takeover detection, realistic outcomes and no automatic cutoff.
- Identity, differentiation and Guide nodes already preserve play, vitality, selective belonging and standards without inherited cruelty.
- The borrowed-spiritual-love node already contains receive -> participate -> generate -> internalize, devotion is not failed transfer, and independent practical safety.
- Correctable history/progress/semantic-review/self-guidance facilities in the companion task remain OFFLINE PROTOTYPES, not proven deployed features. Do not create another backend to implement them twice.

## Actual instruction path: the missing delivery layer

`case-extract.mjs -> case-formulation/run.mjs -> guide-graph/planner.mjs -> run-tiered-pipeline.mjs -> realize.mjs -> response-contract.mjs`.

Extraction receives relevant guide excerpts but is instructed not to advise. In the inspected Fast/Reviewed path, `planAdjudication()` collects selected-node recommendations and required nuance. `realizationPrompt()` includes current message, recent transcript, deterministic contract and adjudication, but does not interpolate `context.guideExcerpts`. A sourceRef ID is not the cited passage. The selected-node projection also omits `successSignals`.

Thus an idea present in the article is not necessarily supplied through this downstream instruction channel. This is not a claim that no other processing path ever receives guide excerpts. It identifies the inspected path precisely.

`IC.DEEP_CHILD_DIALOGUE` is a particularly clear example: its two recommendations concern stopping/recovery and memory provenance. It is predominantly an eligibility gate, not moment-to-moment instructions for the emotional task. The correct fix is bounded app-authored task guidance reaching the responder, not adding the books wholesale to the prompt.

## R1: process-scoped completion and permission

### Current defects

`ROUTE.LEAVE_ALONE` requires `unresolved_inner_material=absent` and vetoes `other_person_central=yes` and `influence_domain=ordinary_social`. `ROUTE.RELATIONAL_REALITY_CHECK` can reactivate merely because another person remains the topic. A settled relationship issue can therefore receive repeat analysis instead of non-engagement. Background grief and checking about whether grieving is correct also cannot be distinguished adequately.

`IC.MEET_GUARD` matches protective-response presence and always defers deep dialogue. The contract does not explicitly distinguish a still-present protector that permits a small step from one that is blocking it. Presence need not be erased to progress.

### Exact proposed changes

Add three narrowly scoped normalized fields in `src/guide-graph/contract.mjs`:

- `relational_check_status`: unknown, not_needed, pending, completed, reopened.
- `loop_target_relation`: unknown, live_work, distinct_repetitive_process, not_applicable.
- `guard_engagement`: unknown, unassessed, blocking, willing_to_allow, not_applicable.

All concern the current issue and its evidence, not a permanent person classification. A completed relational check remains completed across repeated reassurance urges without new facts. New relevant harm, practical decisions, contrary capacity evidence or changed goals reopen it. Changed evidence/corrections invalidate derived completion.

Keep attention_loop, thinking_yield, actual safety and actionable-problem fields. Permit the leave-alone route for a supported distinct repetitive process with no immediate practical action due, even when another person/background unresolved grief exists. Do not erase that background work or call it completed. Pending/unclear real assessment still needs one discriminating check. Remove the blanket relationship/topic veto, not the safeguard against ignoring a live problem.

The graph's flat all/any/none conditions cannot express every scoped conjunction conveniently. Derive a versioned eligibility boolean/enum from these validated fields before evaluating the route rather than silently adding unsupported nested operators. Its provenance and truth table must be tested. Missing new fields remain unknown, not completed or permission.

For `IC.MEET_GUARD`, make the guard-based deferral conditional on an unresolved/blocking stance; an evidenced willing_to_allow stance permits only the agreed small step. Independent deep readiness, stopping, orientation, dissociation and user consent still govern. Unknown is not permission. Apply the same task-completion principle to repeated borrowing: partial adulthood does not require repeating a function already available for this task.

Sources: MCT2009 pp.1-22,71-88,161-162,192-193; EMOTION2025 pp.141-149 and352-358; ATTACH2016 ch.8. Their theories are not declared identical.

Files: candidate cross-guide/inner-child graphs; contract; extraction/audit prompts; schemas/validators; planner; prior-snapshot update/invalidation; owner amendments and regenerated outputs. Cases L01-L06.

## R2: canonical question eligibility, safety and explicit absence

### Source-confirmed issues

The primary node is selected by tier, but the canonical question selects a nonempty question by priority without consistently inheriting safety precedence. G025 tests safety primary, not the question. Safety's question is empty and the supporting love-capacity question can win.

`ROUTE.EXTERNAL_EMBODIMENT` activates because `inward_attention_effect=worsens`, yet its default question asks whether inward attention helps or worsens. The planner checks known fields only for model-generated unknowns, not authored graph questions.

`canonicalQuestion()` in `response-contract.mjs` uses truthy OR between the question contract, plan question and adjudication. An intentional empty/no-question contract can fall through to stale adjudication text.

### Exact repair

Authored questions need declared purpose, answer dependencies and applicable task phase. Choose only a still-useful question for the current task. In actual immediate danger/orientation/stopping support, admit only an immediate-protection question, otherwise none. Do not equate all tier-1 nodes with emergency questions: tier labels alone are insufficient in this graph.

If `questionContract.mode` is none, return an empty string authoritatively. If canonical, use its validated question. Use older fields only when an authoritative contract is absent, not because its intentional value is empty. Continue prohibiting unapproved renderer replacement questions.

For known inward worsening, offer an appropriate outwardly engaged next move; ask only an unresolved choice/feasibility question if needed. For an already chosen action, ask a missing planning detail or review, not which action to choose again.

Files: planner; graph validation/question metadata; relevant candidate nodes; response-contract; question/realization tests. Cases L07-L10. This is software correctness, not a new therapy.

## R3: one current task, explicit supporting obligations and no unknown-only deficit

Realization rule7 calls for one main move, while rule22 and `requiredRealizationNodeIds()` demand the primary plus every displayed secondary. `run-pipeline.mjs` retries to add omitted jobs. Diagram display adjacency therefore becomes an intervention requirement.

Unknown adult/child capacity activates `IC.NEUTRAL_WITNESS`; unknown adult capacity activates `IC.BORROW_ONE_FUNCTION`; unknown body capacity activates `SOM.GENTLE_REGULATION`. Missing evidence can consequently accumulate unrequested preparation jobs around a clear practical request.

Add one optional versioned `turn_task` record to the EXISTING snapshot/plan. Reuse `user_goal` and `current_issue`. Record selected job, target/observation references, phase (assess/offer/practice/review/close), agreement (unknown/accepted/declined), compact last-reported response, and action/emotion detail only when relevant. This is current session state; no new long-term memory service or mandatory questionnaire.

Separate explicit current-turn intervention requirements from context-only/constraint-only nodes. Primary and genuinely necessary supporting interventions remain audited; all relevant safety and evidential constraints remain active. `requiredRealizationNodeIds()` uses the explicit execution list for the new version; older plans retain their previous contract. Do not delete coverage enforcement merely to make tests green.

Remove unknown-alone deficit activation. Unknown may justify a relevant question, not a claim of missing adult/child/body competence. Explicitly requested introductory practices remain available. Do not infer low capacity from secular preference, limited imagery, disagreement or method refusal.

Carry bounded app-authored task guidance and relevant success/change-point signals through selected-node/plan projection into realization. Current task selection must update after a reported helpful, mismatched, declined or completed step. Correct the snapshot and task when the user identifies a real app misunderstanding, before the 'reasoning is complete' realizer runs. Repair does not require factual capitulation on unrelated unsupported claims.

Files: case-formulation schemas/validators/run; extraction/audit; planner; tiered pipeline; realize; response-contract and coverage retry. Ensure serialization, audit correction, normalization and incremental replay retain new state. Include relevant new routing fields in critical-delta handling; never let unknown defaults resurrect a refused or obsolete task. Sources: MI2023 tasks/discord, MENTAL2008 chs.2-6, EMOTION2025 pp.141-149/ch.8. Cases L11-L15.

## R4: complete the existing outward route with planning and review

No new BA modality node. `actionable_problem` already includes behavioral targets; keep `ROUTE.ACT_OUTWARD`, `IC.PROTECTOR_ACTION` and `IC.ADULT_APPRENTICE`.

Inside turn_task, capture an agreed action; feasible cue/time/place; small scope/duration when useful; resources/barriers; personally meaningful consequence being tested; review point. Missing/unneeded details are not a form to fill. Use the existing goal.

At review, distinguish not attempted/partial/completed/appropriately abandoned, what happened at the relevant moment, immediate/later effects when reported, and the next adjustment. Check resources, opportunity, skill, safety, competing consequences and motivation instead of automatically choosing a protective-part explanation. Task completion and immediate mood change are not sufficient outcomes. Rest may be the right action. An unrewarding completed activity should prompt fit/context review, not automatically a larger dose or a childhood explanation.

Function outranks appearance: the same walk may support connection, exhausting overexercise, avoidance or nothing useful. Someone already rigidly overcontrolling life may need a connection/flexibility experiment, not extra chores or monitoring. The BA source itself includes approaching grief as activation; do not equate BA with being busy or suppressing feelings.

Copy-ready original additions:

- `ROUTE.ACT_OUTWARD.recommendations`: 'When an action is agreed, make its cue, feasible size, resource needs and personally useful purpose concrete. When an attempt has already happened, review the actual sequence and consequences instead of assigning the same action again.'
- `ROUTE.ACT_OUTWARD.avoid`: 'Do not treat noncompletion as lack of motivation or a protective part before examining practical barriers; do not treat task completion or immediate mood improvement as the sole evidence of benefit.'
- `IC.PROTECTOR_ACTION.successSignals`: 'The action or its review provides truthful information about what supports protection and follow-through, including when a reasonable plan needs changing.'
- `IC.ADULT_APPRENTICE.recommendations`: 'Name what capacity the person exercised, what help remained useful, and what the real-world attempt taught them; independence does not require refusing appropriate support.'

Add governed amendments and candidate content together after approval, then regenerate. BA2022 chs.2,4-9 (especially25-32,89-108,141-174); SCHEMA2003 ch.5; MI2023 planning. Preserve that the schema manual normally introduces pattern-breaking after earlier preparation; InnerSignal's early safe action is an adaptation. Cases L16-L20. No mandatory homework after every conversation.

## R5: emotional task and change point within existing routes

`IC.DEEP_CHILD_DIALOGUE` is currently mainly an eligibility gate. Keep its safety/memory requirements, but supply the actual current emotional task through turn_task and the plan/realization payload.

Use evidence-based-in-the-conversation markers as provisional process descriptions, not diagnoses or recovered historical facts:

- Unclear felt concern: `ROUTE.GO_INWARD` supports one tentative exploration/check of fit without requiring a child state.
- Self-critical exchange: work with the reported self-treatment. Use `IC.CREDIBILITY_REPAIR` only when credibility is actually at issue; do not make its age/accusation questions the response to all self-criticism. Preserve valid correction without contempt/global condemnation.
- Reported interruption: `IC.MEET_GUARD` when the formulation fits; hear what is prevented and a tolerable next step. Silence or a body symptom alone does not prove a guard.
- Unfinished relational hurt: after current relational assessment, hear unmet needs and the wished-for response through GO_INWARD; no compulsory forgiveness, imagined apology treated as fact or real-world confrontation.
- Anguish with contact and stopping intact: existing care/borrowing can meet it without automatically substituting calming. If contact/stopping is lost, use established stabilization.
- Adaptive anger or grief: use its information and proportionate action/connection; do not assume all anger hides a truer sadness or lower intensity is always progress.

Each task needs a marker, small proposal, response/fit check and change point. Partial change matters: a critic softens, a need becomes nameable, care can partly be received, a practical response becomes clearer. Do not restart from stage1 because the entire life is not resolved. Tears and articulate descriptions are not proof of a change point.

Care refinements: in BORROW_ONE_FUNCTION/BORROW_LOVE, adapt distance, manner or source if care feels intrusive. Non-cruelty remains a legitimate starting point, not a replacement definition of love. Include being known/delighted in and supported exploration in apprentice/identity guidance rather than only duty and emergency management. Keep logical content distinct from how an adult message is experienced as delivered.

Text limitations: do not claim to observe vocal tone, eye contact or facial emotion. No default therapist-provoked enactment, trauma reenactment, memory recovery or coercive chairwork. Use the actual user's reports and consent.

Naming: existing SOM.EFT_PORTABLE is tapping. Use `emotion_focused` for the new book/source/tasks and expand ambiguous EFT in user-facing selections. Do not connect emotion-focused source citations to the tapping node.

Sources: EMOTION2025 pp.55-68,141-149,chs.10-14,especially404-405; CFT2010 pp.6-8,105-107,199-207; ATTACH2016 ch.8. Emotion-focused deepening and Wells's non-engagement are different rationales. Do not demand elaboration and non-elaboration of the same target at once. Cases L21-L26. No full emotion-focused, Schema or RO DBT department.

## R6: one new spiritual-struggle node, not another protection modality

Add proposed `IC.SPIRITUAL_STRUGGLE`: the current map has unavailable love, bypass/integration mismatch and authority risk, but no distinct job for pain or loss within a valued sacred relationship.

Add normalized `spiritual_struggle` (unknown/absent/present), grounded in reported relevant distress. Its use follows the user's current goal; discussing a struggle is not consent to prayer, imagery or theological persuasion. Current danger and practical protection take precedence.

Original proposed recommendation: 'Find out what turning toward this spiritual source currently evokes and what has been lost or violated. Support the user's wish to preserve, mourn, reconsider or change that relationship without requiring either stronger belief or abandonment of the tradition. Do not prescribe more borrowing from a source that is itself distressing without examining the mismatch.'

Connect to the existing care, differentiation, relational-protection and existential-nourishment routes. Do not infer divine judgment or reduce the source to parental projection. A source can help and hurt in different respects.

Specific existing-code edits: in case-extract, religious language without felt love is not by itself evidence of bypass; sacred grief/condemnation/betrayal need their own interpretation. In ROUTE.INFLUENCE_LOVE_CAPACITY retain the complete borrowing/devotion logic and add: 'Capacity includes acting where action is possible and relinquishing control that is not the person's to exercise. Continued devotion or entrusting outcomes is not failed transfer.'

PARG2007 chs.7-8,10-15,especially289-290 and311-312. No claim this source verifies spiritual entities or metaphysical protective efficacy. Cases L27-L30.

## Delivery, governance and validation

R1/R2 and unknown-only activation corrections come first; then the small R3 execution contract; then bounded action/emotion guidance and R6 after semantic approval. This task records exact proposed semantics, not approval on the owner's behalf.

New routing fields must be registered before use: validateCaseVariables drops unregistered keys, and the strict provider JSON schema derives enums from the contract. Update extraction, audit, validators, prior-snapshot application, planning, tier deltas, question selection, response requirements and applicable fixtures together. Do not merely add prose to a node.

SourceRefs must resolve through the existing source registry/amendment mechanism. Do not insert book IDs as unknown graph references or publish full book text. The new bibliography is attribution, not automatic source authority.

Keep old v1/v2 model-evaluation files unchanged. LIT-specific supplement cases are separate. Node/table labels should not be used as a therapy efficacy metric. Existing source-backed constraints remain active when a node is contextual rather than a second exercise.

Run source/candidate validation, graph regressions, authoring validate/check/maps-check, affected lesson tests and full npm run verify on Node24.18.0; inspect generated diffs and freeze the candidate. Then run the already-authorized authenticated target-model evaluation with exact policy/runtime identity. Preserve source hashes, transcripts, failures and independent grades. Do not infer deployed use from compiled files or claim clinical benefit from deterministic checks.

This review ran ten isolated checks of transcribed source mechanisms on Node22.16.0, not the full repository or a patch. The included full-repository probe was syntax checked but not executed here: local GitHub DNS was unavailable and the checked workflow run had no downloadable checkout artifact. Connected GitHub source inspection worked. modelRuns remains0; no merge, release or production activation.
