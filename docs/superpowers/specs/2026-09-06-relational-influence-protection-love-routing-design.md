# Relational reality checking and Influence, Protection & Love routing

Date: 2026-09-06
Status: owner-approved development-graph design; not stable or released
Scope: PR #46, branch `companion/foundations-2026-09-05`

## Authority and purpose

The owner's 2026-09-06 instruction explicitly authorizes these therapy/framework map changes. It does not authorize release, merge, stable promotion, deployment, a model/provider run, or a clinical-efficacy claim.

The change composes two missing capabilities into the owner-approved three-way router:

1. an external relational reality check before inward processing when another person is central; and
2. distinct influence/protection/love routes for ordinary social influence, internal influence, experienced other-than-self phenomena, and uncertain ontology.

These additions coexist with the current founder philosophy and its revisability rule. They are current owner-approved architecture, not protected doctrine, diagnosis, or evidence that the routes are clinically effective.

## Routing precedence

The operative order remains:

1. immediate safety, orientation, stopping, and return capacity;
2. a concrete external action branch, enriched by the relational reality check when another person is central;
3. external embodiment when inward attention reliably worsens derealization, panic, or hypermonitoring;
4. inward processing for material that is actually present and useful to contact; and
5. leaving a maintenance loop unanswered only when no safety, practical, relational, or clearly unresolved inner problem remains.

The relational gate is not another therapy department. It prevents a common inversion: another person behaves in a consequential way and the system immediately asks why the user is upset. The reaction may have inner roots while an external problem remains real.

## Relational reality-check gate

When another person is central, route in this order:

1. **Observe behavior.** Describe what happened and in what sequence before assigning motives.
2. **Assess demonstrated relational capacity.** Ask what the person has actually shown about disagreement tolerance, empathy, accountability, respect for no, repair, and reality-based behavior under stress. Capacity may be domain-specific, mixed, limited, reciprocal, or still unknown.
3. **Detect emotional takeover pressure.** Notice whether fear, guilt, anger, disappointment, withdrawal, urgency, or implied obligation displaced the user's position. Record the mechanism without inventing deliberate coercive intent.
4. **Define the realistic outcome before interaction.** Possible outcomes include mutual understanding, conveying information, a boundary or refusal, distance or ending an exchange, or learning how the person responds to a limit.
5. **Act outward as needed.** Preserve inner boundaries and self-possession through the action.
6. **Only then route inward if useful.** Inner-child, somatic, or metacognitive work may still matter, but it must not erase external evidence or substitute for a practical decision.

This incorporates capacity-not-motive reasoning, detached observation, emotional-takeover detection, outcome-before-interaction, inner boundaries/self-possession, and selecting for demonstrated reciprocal maturity. A history of internalizing blame, managing adults, or forced adulthood may explain reflexive self-analysis or caretaking only when that history is supported; it is not inferred automatically.

The gate does not diagnose or automatically label another person emotionally immature, manipulative, narcissistic, or unsafe. Disagreement, emotional intensity, one mistake, or the user's disappointment is not itself incapacity. The system does not recommend cutoff by default; it calibrates trust, access, distance, requests, and investment to evidence and safety.

## Influence, Protection & Love routes

### Ordinary social or interpersonal influence

Love, compassion, or goodwill may remain an authentic ethical orientation. They never substitute for physical or social safety, boundaries, distance, refusal, documentation, outside support, or concrete action. Remaining loving or refusing hatred under unavoidable harm is a spiritual aspiration, not therapy advice to approach, tolerate, or remain exposed to preventable danger.

### Internal influence

Parts, compulsions, urges, somatic activation, and repetitive thought loops use the existing inner-child, somatic, and metacognitive routes. Use the least elaborate sufficient model. Do not manufacture an entity or a coherent part from an ordinary thought, practical problem, symptom, or maintenance loop.

### Experienced other-than-self phenomena

When the person uses language such as presence, jinn, spirit, entity, unattached burden, or astral attack, mirror that language and describe the phenomenon as experienced other-than-self without affirming or denying ontology.

Within the spiritual framework, metta or love itself may be the primary protective response. It is not required to be merely a warm layer added after a psychic boundary visualization. This route does not claim metaphysical truth, clinical efficacy, immunity from harm, or that the person caused the experience.

If love is limited or inaccessible, do not prescribe psychic combat, retaliatory imagery, escalating occult technique, or spiritual fearlessness. Build the smallest believable Nurturer, Protector, or Guide capacity; borrowed adulthood may supply one bounded function while returning authority to the person. Practical safety, sleep, orientation, medical assessment, and human support remain independently available.

When direct metta is inaccessible but the person can access a spiritually meaningful source of loving support or protection, the existing love-capacity route may borrow that support in the person's own tradition and language—for example through God, Jesus, angels, devas, saints, ancestors, or another loving presence. The developmental movement is **receive -> participate -> generate -> internalize**: receive support, join its loving intention, practice generating some love directly, then carry more love, courage, discernment, and agency personally over time. Continuing prayer, devotion, surrender to God, reliance on grace, or ongoing spiritual relationship is not itself dependency or failed transfer. The target is growing capacity and agency, not spiritual independence from the divine. If borrowed spiritual love is also inaccessible, return to the smallest believable Nurturer, Protector, or Guide/reparenting function rather than psychic combat.

### Uncertain ontology

When the person is unsure whether the cause is internal, external, spiritual, psychological, physiological, or mixed, leave the cause unresolved. Work with directly reportable phenomenology—sensations, images, felt agency, triggers, timing, sleep, orientation, urges, effects of attention, and what changes choice. Symptom response to metta, grounding, boundaries, medication, sleep, or inner work does not prove the cause.

## Executable representation

New case variables:

- `other_person_central`
- `relational_capacity_evidence`
- `emotional_takeover_pressure`
- `realistic_interaction_outcome`
- `influence_domain`
- `metta_access`
- `spiritual_support_access`

New cross-guide nodes:

- `ROUTE.RELATIONAL_REALITY_CHECK`
- `ROUTE.INFLUENCE_SOCIAL_PROTECTION`
- `ROUTE.INFLUENCE_INTERNAL`
- `ROUTE.INFLUENCE_NONORDINARY_METTA`
- `ROUTE.INFLUENCE_LOVE_CAPACITY`
- `ROUTE.INFLUENCE_ONTOLOGY_UNCERTAIN`

Graph cases `G013`–`G018` test relational precedence, practical-safety precedence, internal routing, metta as primary nonordinary protection, inaccessible-love capacity-building, and unresolved ontology. Versioned graph case `G025` adds direct-metta-inaccessible plus spiritual-support-accessible coverage: practical safety stays primary, the existing love-capacity route carries borrowed spiritual love, and continuing devotion is not treated as failed transfer. `G019`–`G024` remain reserved by the separate love-horizon proposal. The companion behavioral-evaluation v1/v2 protocols and fixtures remain unchanged; these are separate deterministic graph regressions, not scored model behavior.

## Non-claims and later gates

This change does not establish Lindsay Gibson's framework as a module, create an emotional-immaturity diagnostic screen, validate a spiritual ontology, disprove one, or claim efficacy. It does not promote a personal framework into global policy automatically. Any release, stable promotion, provider-backed behavioral evaluation, or future framework revision remains separately governed.
