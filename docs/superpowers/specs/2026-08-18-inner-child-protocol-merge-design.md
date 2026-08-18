# Inner-child therapy-protocol runtime merge design

Date: 2026-08-18  
Status: owner-authorized implementation design  
Target: `u-dont-existDOTcom/innerSignalGraph`  
Creative Tail source main: `af36a51e44a65067a3d7703a78a004fdb8ad7693`

## Objective

Translate the saturated Creative Tail inner-child/reparenting protocol into the existing InnerSignalGraph runtime without creating a parallel therapy engine, rewriting historical guide-packet fixtures, or promoting `stable`.

The runtime must make operation permission, actor/beneficiary, current reality, consent, authority, decision capacity, provenance, and external-resource state authoritative **before** ordinary guide-graph node selection.

## Canonical ontology

There is **one inner parent / integrated adult** with three analytically distinguishable qualities:

- nurturing;
- protecting;
- guiding.

The qualities can be unevenly available by context and may be borrowed one at a time, but they are not three autonomous inner parents or internal agents. The executable representation must not reify them.

## Source authority

The semantic source is Creative Tail `main` at `af36a51e44a65067a3d7703a78a004fdb8ad7693`, including:

- canonical overview and maps 00–16;
- Batch 006–009 InnerSignalGraph merge addenda;
- all 49 real, unprimed query fixtures;
- the Batch 009 saturation rule and resource-unavailable fallback;
- owner clarification that Nurturer, Protector, and Guide are qualities of one parent.

The explanatory article remains unchanged.

## Architecture decision

### Keep `guide-graph-v1`

The existing guide graph remains the deterministic intervention graph for inner-child and somatic work. Historical r01/r02 packet fixtures remain historical.

### Add a deterministic pre-operation protocol router

Add a `src/therapy-protocol/` layer that:

1. validates an optional structured protocol profile;
2. normalizes missing material fields to `unknown`;
3. classifies actor and primary problem class;
4. evaluates operation-specific permissions;
5. produces one explicit route disposition;
6. tracks external-resource/handoff state;
7. constrains or bypasses the ordinary guide graph;
8. preserves the original concern and unresolved external need longitudinally.

This is a permission and routing layer inside the existing pipeline, not a second therapeutic engine.

### Preserve backward compatibility

Existing snapshots and graph fixtures that do not contain a protocol profile receive a conservative compatibility profile derived only from existing validated variables. Missing new fields remain `unknown`; compatibility must not fabricate readiness, authority, access, or historical certainty.

## Runtime objects

### Protocol profile

A structured object distinct from the existing flat graph variables. It contains the fields needed to adjudicate operations without turning every concept into a graph activation enum.

Major groups:

- actor and problem class;
- current danger/basic needs/condition-specific instability;
- operation request and consent scope;
- one-parent quality availability by context;
- current-reality and third-party rights;
- provenance and action authority;
- goal endorsement and decision-capacity concern;
- external support/resource access and handoff state;
- longitudinal unresolved concerns and adverse loops.

### Operation classes

Use the Creative Tail O0–O10 architecture:

- `O0_SUPPORT_ORIENT` — low-demand presence, orientation, clarification;
- `O1_PRACTICAL_SAFETY` — immediate external safety/basic-needs action;
- `O2_REGULATION` — non-depth regulation or de-escalation;
- `O3_CURRENT_REALITY` — practical, relational, medical, legal, capability, grief, or resource work;
- `O4_BORROWED_CAPACITY` — bounded borrowed witnessing or one parental quality;
- `O5_LIGHT_REPARENTING` — present-focused non-depth inner-child contact;
- `O6_TRUST_BEHAVIOR` — prediction tests, promises, repair, ordinary positive contact;
- `O7_IDENTITY_DIFFERENTIATION` — preference experiments and differentiation;
- `O8_DEPTH_ACCESS` — deliberate memory/depth/altered-state access;
- `O9_HIGH_IMPACT_DECISION` — decisions materially affecting bodies, dependents, relationships, finances, legal rights, or public claims;
- `O10_EXTERNAL_HANDOFF` — human/professional/resource connection and access-state management.

The names are stable runtime identifiers; their conditions are not a claim that every case uses every class.

### Route disposition

Exactly one primary disposition is returned:

- `INNER_CHILD_PRIMARY`;
- `INNER_CHILD_ADJUNCTIVE`;
- `INNER_CHILD_DEFERRED`;
- `INNER_CHILD_NOT_RELEVANT_TO_NEXT_ACTION`;
- `INSUFFICIENT_INFORMATION_FOR_OPERATION`.

### External-resource state

Represent:

- required resource;
- access status;
- barrier;
- suggested/reachable/attempted/responded/bridged/unavailable/failed handoff state;
- smallest reachable fallback;
- fallback limitation;
- unresolved external need;
- retry or advocacy trigger.

Improved coping must not silently close an unresolved material need.

## Permission precedence

1. Immediate danger, medical instability, intoxication/withdrawal, severe nutritional risk, dependent danger, or basic-needs failure overrides ordinary inner work.
2. Missing material information produces clarification or a lower-demand operation, not fabricated permission.
3. A clear operation-scoped `not now` blocks that optional operation without creating retry debt.
4. Current external reality, bodily autonomy, another person's rights, and real obligations cannot be resolved by an inner-state vote.
5. High-impact decisions require present-adult reality testing, provenance, rights/consent, consequences, and appropriate expertise.
6. Depth access requires sober baseline, operation-specific capacity, immutable provenance, and acceptable integration load.
7. The guide graph runs only when the protocol route marks inner work primary or adjunctive and the proposed graph operation is permitted.

## Key distinctions that must remain executable

- one parent / three qualities;
- awareness is not control;
- missing instruction is not missing Guide;
- external scaffold loss is not failed internalization;
- depth is not integration;
- internalization is not self-sufficiency;
- felt sense may contain meaningful recovered knowledge but is not historical proof;
- protector alarm is not truth or permanent veto;
- Guide proposes; present adult commits;
- Nurturer care is not payment for obedience;
- consent, safety disclosure, treatment goals, provider conditions, decision capacity, and lawful authority are separate;
- treatment ambivalence is not incapacity;
- diagnosis, family disagreement, or an unwise choice is not incapacity;
- real deception and reassurance/checking accommodation can coexist;
- actual harm and intrusive feared harm require different routes;
- grief and major transition are not automatically pathology;
- supporter concern does not create surrogate authority or unlimited responsibility;
- no reachable resource is a first-class state rather than motivation failure;
- poor outcome enters the complete differential; deterioration overrides identical repetition.

## Case extraction

Extend the case snapshot schema with an optional `protocol_profile` for backward compatibility. The extractor is instructed to populate it, use `unknown`, keep observations separate from hypotheses, and never infer legal capacity, surrogate authority, service availability, historical truth, or diagnoses from tone.

The case auditor may make bounded protocol-profile corrections. All corrections require an enumerated field/value and a reason.

## Planner integration

`planFromGraphs` receives `protocolProfile` in addition to existing graph variables.

The protocol router runs first.

- If inner work is primary/adjunctive, graph planning proceeds within allowed operation classes and receives protocol nuances/forbidden overclaims.
- If inner work is deferred/not relevant/insufficiently specified, the planner returns a deterministic protocol job rather than selecting an inner-child node merely because one matches old flat variables.
- The returned plan exposes route disposition, permissions, blocked operations, material unknowns, handoff state, and unresolved external need.

Existing graph variables remain available for historical compatibility, but `deep_work_readiness`, `basic_reparenting_capacity`, and `inner_adult_access` cease to be the authoritative permission architecture.

## Real-query validation

Import all 49 Creative Tail fixtures into a local corpus with two strictly separated layers:

- model input: `query` only;
- grader data: expected route, required unknowns, prohibited behavior, and assertions.

Hermetic CI cannot prove natural-language model comprehension without provider credentials. Therefore validation has two modes:

1. deterministic route regressions using grader-side structured protocol snapshots;
2. an opt-in live black-box runner that sends only `query` through the real extractor/pipeline.

CI must prove query/grader isolation and deterministic routing. Live provider results are additional evidence, not silently simulated model intelligence.

## Comparative simplification

Maps 15 and 16 must earn their complexity.

The test suite compares the full router against:

- a simpler functional-analysis competitor for capability/insight-action/scaffold cases;
- a simpler supported-choice checklist for refusal/capacity/ambivalence cases.

If the simpler route produces the same safe operation selection across the corpus with fewer required fields, retain the semantic safeguards but simplify runtime branching.

## Longitudinal safety

Persist enough state to detect:

- reassurance accommodation;
- bot authority/dependency concentration;
- memory-source drift;
- parts reification;
- coercive growth logic;
- failure debt;
- intensity chasing;
- model sealing;
- repeated unavailable referrals;
- unresolved external need falsely marked closed.

This is protocol state, not a commitment to indefinite surveillance or storage.

## Documentation and provenance

Create a local `docs/therapy-protocol/` provenance area containing:

- Creative Tail repository and exact source SHA;
- semantic summary and crosswalk;
- imported fixture manifest;
- research-stage and legal/clinical boundary.

Update `docs/ARCHITECTURE.md`, `THERAPY-LESSONS`, and `state/CODEX-CURRENT-STATE.md`. If reviewed canonical docs change, update repository-audit hash bindings in the same PR.

## Release and merge boundary

- Work on `agent/merge-inner-child-protocol-20260818`.
- Use the protected PR path to `main`.
- Require deterministic-package, workflow-policy, and codeql-javascript checks.
- Do not advance `stable`.
- Do not claim clinical validation, jurisdiction-wide legal correctness, live referral functionality, or provider-backed black-box success unless actually obtained.
