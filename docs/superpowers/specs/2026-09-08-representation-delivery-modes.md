# One truth system, many delivery languages — candidate architecture

Status: owner-authorized Iteration-lane candidate for draft PR #46. No clinical-efficacy claim, release, merge, deployment, installation, or stable promotion.

## Product rule

InnerSignal keeps one analytic epistemic and safety core while allowing the interface to use multiple experiential languages. Poetry can be the interface without becoming the authority.

Representation is scoped to an active process and path episode. It is not a user personality, learning style, VAK taxonomy, diagnosis, or global preference lock. The same person may use CLEAR prose for one process and an EXPERIENTIAL image for another. CLEAR is a complete first-class option, not a failure to engage.

## Contract

Modes:

- `CLEAR`: ordinary prose/analysis through `PROSE_ANALYSIS`.
- `EXPERIENTIAL`: one non-prose channel—felt sense/body, image/drawing, metaphor/story/poem, enactment/role dialogue, or movement/gesture.
- `BRIDGE`: preserves the experiential material while optionally translating between it and ordinary language.

Each selection binds `process_id`, mode, channel, transition, evidence-bound selection reason, observation IDs, and prospective useful signals. It is stored inside the existing Path Performance episode but excluded from the strategy identity `[process_id, node_id]`; changing language does not create a new causal episode or erase predictions, misses, adverse evidence, or method/provider trust findings.

The controller distinguishes the selected next representation from the representation actually delivered by a response that passed the realization contract. Its trace records:

`process -> delivered representation -> selected representation -> predicted useful signals -> observed response -> performance status -> continue/switch/stabilize`

Deterministic trace/schema success leaves `human_evaluation` unestablished. Human usefulness and harm review remain separate.

## Switch logic and success

Repeated low-information responses, explicit mismatch or decline, rising assistant verbosity/complexity with falling client-generated information, and expressive output without discriminating information raise `REPRESENTATION_MISMATCH`. A cheap consent-based channel probe or `SWITCH_REPRESENTATION` preserves the causal path rather than generating more elaborate prose. A declined channel is withdrawn without withdrawing care or declaring the person/method resistant.

Success requires one or more prospectively selected movement signals: client-generated specificity or new information, agency, access to previously blocked emotion or need, ordinary-life transfer, functional change, or durable movement. Praise, relief, compliance, fluency, vivid imagery, poetic beauty, felt intensity, catharsis, and schema completion are not success by themselves. An expressive but nondiscriminating response is `STALLED` and can prompt another channel or causal reconsideration.

## Epistemic and safety invariants

- The user owns a symbol or metaphor. The model invites the user's meaning and does not decode it as hidden truth.
- Image, poem, story, role, and felt/body material may establish phenomenological meaning, not external facts.
- Metaphor and analogy generate hypotheses, not proof. Drawings are not projective diagnostic tests. AI-generated imagery is not revelation.
- Safety, abuse, medical, legal, external-event, and ontological questions route through ordinary evidence and reality checks.
- “Why did you say that?” always permits a plain-language account of evidence, rationale, alternatives, and uncertainty.
- `STAY_SYMBOLIC` is voluntary and preserves useful contact; `TRANSLATE_TO_PLAIN` is a tentative bridge. Neither makes interpretation compulsory or unfalsifiable.
- Movement/gesture and enactment/role dialogue require an invitation and genuine opt-out. A declined form is not renamed and re-offered.
- With immediate danger, unstable reality testing, mania-like disinhibition, altered state, or significant dissociation/fragmentation/destabilization, safety overrides a proposed symbolic channel. The controller selects concrete CLEAR/prose orientation, gently mirrors reported experience, and forbids archetypal, synchronicity, hidden-message, or unconscious-revelation certainty.

## Enforcement and limits

Extraction and audit prompts name the modes, signals, evidence boundaries, decline behavior, and no-global-type rule. Strict generation schemas require an explicit nullable representation field; new live strategies require a non-null selection, while historical runtime snapshots remain compatible. Experiential/bridge choices require reviewed processing, and significant reality-testing or continuity harm forces forensic safety review.

Realization uses an exact grounded `POLICY.REPRESENTATION.<MODE>.<CHANNEL>` marker. Unexpected or missing representation markers and narrow obvious symbolic-fact overclaims block realization after one bounded repair attempt. This structural/English-language backstop cannot prove subtle semantic fidelity, therapeutic usefulness, or absence of harm; those require separate human evaluation.

