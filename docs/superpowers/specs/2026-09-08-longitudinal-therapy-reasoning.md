# Longitudinal therapy reasoning and audit invariants — 2026-09-08

Status: owner-authorized candidate reasoning/audit refinement on draft PR #46. No clinical validation, provider call, merge, deployment, installation, or stable promotion.

## Problem

A complex multi-turn therapy response can fail even when individual map nodes are locally reasonable. The recent synthetic calibration exposed failures of longitudinal reasoning: accepting a client's appraisal as dispositive about importance, allowing a vivid new detail to replace the established therapeutic target, abandoning a target when one probe fails, re-asking known information, and forcing ambiguous divided-self phenomenology into either healing or pathology.

These failures are not best represented as a large set of new Mermaid branches. The minimal architecture is a shared longitudinal reasoning invariant used by extraction/audit/realization, plus explicit audit-harness failure classes and multi-turn synthetic regressions. Existing graph nodes, Path Performance Controller, mixed benefit/adverse logic, representation switching, relational readiness, and method-versus-delivery trust remain authoritative for their existing jobs.

## Invariants

### Client authority is scoped

The client's first-person report is privileged evidence for phenomenology, preferences, remembered events, and current appraisal. It is not automatically decisive evidence about cause, mechanism, therapeutic importance, risk, or whether a supported signal can be ignored. A statement such as “that event is only one thing among many” updates the appraisal evidence; it does not independently establish either irrelevance or danger.

### Salience, importance, and centrality are distinct

A phenomenon can be vivid but low-value for the next turn, or important enough to retain while remaining non-central. The next focus should be selected by the established trajectory and expected information gain, not recency or emotional vividness alone.

### Longitudinal target preservation

The current issue and established longer therapeutic target survive ordinary turn-to-turn updates. New information may refine, challenge, or supersede them when evidence warrants; it must not silently replace them. The auditor should flag latest-turn hijack when a new symptom or practice event displaces a still-live target without evidence that the goal changed.

### Probe failure changes method before target

If a verbal inquiry into a critic, part, shame state, or presence yields no verbal content, no dialogue or belief is invented. The system should switch to other observable channels: triggers, body experience, action tendencies, avoidance, what the state makes the person do or not do, predictions, and consequences. A failed verbal probe is evidence about that probe, not proof the underlying target is absent.

### Differentiation versus alienation

A divided, real/fake-self, or alien experience is not automatically healing, pathological, internal, or external. Keep at least two live hypotheses when the evidence supports them: increased differentiation/awareness of previously fused or implicit material that may become more integrated, versus increasing alienation/expulsion in which some experience becomes more “not me,” bad, fake, or targeted for eradication. A useful discriminator is the direction of the person's relationship to the material: greater curiosity/inclusion/workability versus greater rejection/eradication/alienation. Ontology remains uncertain unless ordinary evidence resolves it.

### Claim/example mismatch

A mundane example supplied after a high-stakes label does not automatically falsify the label, and the label does not automatically make the example dangerous. Clarify why the example counts, whether it is representative, and what else the earlier phrase referred to when that ambiguity changes the next action.

### History-aware question selection

Before asking a high-information question, check the supplied chronology and settled task state. A known answer is evidence, not an invitation to ask it again. Re-questioning is justified only when the new comparison is materially different and necessary.

### Client-generated hypotheses

A client-generated functional hypothesis receives priority over a therapist-imposed story because it is grounded in the client's own phenomenology, but it remains a hypothesis. Test concrete function, predicted outcome, and possible disconfirming evidence. Do not ignore it for lack of proof and do not confirm it for psychological plausibility alone.

### Self-support as a target when explicitly established

When reduced self-rejection, self-love, self-respect, or self-support is an explicit long-term target, preserve it without making it a universal causal theory. When useful, ask what would feel dangerous if shame/self-attack no longer performed its apparent function and whether adult protection, boundaries, or another capacity could provide any useful function without self-attack. Do not supply the answer.

## Runtime composition

`src/prompts/common.mjs` owns the shared general invariant. Realization receives it through `sharedClinicalRules`; the case auditor imports it explicitly. Extraction remains governed by its existing incremental/history rules and current issue/task state; future extraction wiring should reuse the same invariant rather than create a parallel target system.

This refinement deliberately does not add graph nodes or new persistent case-schema fields for salience/importance/centrality. The distinctions are enforced semantically and evaluated through synthetic multi-turn regressions first. A schema addition would require evidence that prompt/audit/controller enforcement is insufficient.

## Audit-harness composition

The existing A-E/N topology remains unchanged. `LONGITUDINAL-AUDIT-SUPPLEMENT.json` adds the new generic audit rules and maps them to the existing specialist roles. `rubric.json`, `cases.json`, `drafts.json`, and `reference-target.json` extend the seeded corpus. The audit remains penalized for false-positive alarm, safety inflation, verbosity, unnecessary rewriting, and repair-induced errors.

Current execution and grading decisions are in `OWNER-DECISIONS-20260908.json`. They supersede the earlier unresolved provider-budget/model questions for the present development experiment: no paid/provider API calls are authorized; development comparison is to be orchestrated through ChatGPT sessions using Codex/Mission Control; GPT-5.6 Sol Extra High is the main candidate/audit and primary grading model; Pro is optional dissenting specialist only; and a separate four-case Extra High-versus-visible-`Latest` smoke is allowed without inferring the `Latest` backend identity.

## Acceptance

- client appraisal is neither ignored nor granted global causal/risk authority;
- salience does not automatically determine centrality;
- a live longitudinal target survives unrelated salient updates;
- a failed verbal probe can switch modality without invented content or target abandonment;
- divided-self material preserves integration versus alienation alternatives and ontology uncertainty;
- weak examples do not erase ambiguous high-stakes claims;
- known information is not re-asked as new;
- client-generated functional hypotheses are tested rather than ignored or confirmed;
- synthetic good controls remain concise and avoid unnecessary audit rewriting;
- no real client identifier, verbatim private transcript, exact personal amount/location, or private-derived hash enters the public repository.

Human usefulness and harm remain unestablished until blinded model evaluation and owner/human review are completed.
