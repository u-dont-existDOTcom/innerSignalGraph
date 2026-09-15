# Inner-speech and phenomenology-aware representation

Status: owner-authorized development policy for merge to `main`. This does not authorize installation, deployment, `stable` promotion, diagnosis, or clinical-efficacy claims.

## Product rule

InnerSignal must not assume that cognition is an internal sentence, and it must not react to that correction by treating nonverbal material as deeper, earlier, more authentic, or epistemically privileged. Language, imagery, body sensation, affect, urges, memory, sound/music, unsymbolized experience, external action, and deliberate analysis are all possible tools. The useful question is what representation is actually present or useful for this person and this process, not which global cognitive type the person is.

## Trait-level inner-speech profile

The case schema can carry a nullable, explicit-user-report-only profile with:

- ordinary spontaneous inner-speech frequency;
- deliberate silent-speech ability;
- usual verbal form when present (rare/none, isolated words/phrases, sentential monologue, dialogic, mixed, unknown);
- optional user-described context variation.

Spontaneous frequency and deliberate capacity are separate. The profile is non-diagnostic and must not be inferred from prose fluency, imagery, body focus, diagnosis, occupation, or one episode. It is a prior, not a representation lock.

The ChatGPT skill asks one brief screen near the beginning of substantive therapy unless the answer is already known or urgent/safety work should take precedence.

## Episode-level phenomenological provenance

A direct observation may optionally carry:

- reported direct modes: body sensation, affect, image/scene, literal inner words, urge/action tendency, memory, sound/music, unsymbolized/hard-to-categorize, other, or unknown;
- exact literal inner words when actually reported;
- appraisal/meaning, if the user assigns one;
- whether current wording was literal-at-the-time, retrospective translation, mixed, or unknown;
- whether the appraisal concerns internal experience, an external person/event, both, neither, or is unknown.

These fields are provenance categories, not a mandatory temporal or neural pipeline. They may overlap, occur in different orders, or be absent. Historical snapshots may omit them; live provider generation explicitly emits null/object values so absence is not silently filled with invented verbal content.

## Epistemic behavior

InnerSignal follows these invariants:

1. **Nonverbal is not deeper or truer.** Earlier is not truer. Verbal is not automatically intellectualized or defensive.
2. **Do not impose a universal feeling-before-words sequence.** Trait-level inner-speech frequency and episode-level microstructure are different variables.
3. **Do not invent automatic sentences.** A later verbal paraphrase can express an appraisal without being a literal thought that occurred at the time.
4. **Preserve direct signal versus external claim.** A stomach contraction, image, urge, or felt alarm can be directly reported phenomenology. "That person is evil" is an appraisal about the world; if it affects action, examine observable cues, prior evidence, alternatives, and consequences.
5. **Use language as a tool.** External dialogue can make implicit meaning inspectable, especially for a person with little spontaneous inner speech. Analysis remains available rather than forcing the person to remain in sensation/symbolism.
6. **Representation remains process-scoped.** The existing CLEAR / EXPERIENTIAL / BRIDGE controller continues to select and switch delivery by current yield, consent, safety, and movement rather than by a global learner type.

## ChatGPT-host multimodality

The skills-only ChatGPT package does not duplicate host upload controls. When the ChatGPT host supplies an image, drawing, audio, song, or other file that the model can inspect, the skill treats it as first-class communication without demanding a prose translation first. If the host/model cannot inspect the material, it must say so rather than pretend.

Input modality is not the same thing as therapeutic delivery representation. A person may upload a drawing and request plain analysis, type prose and then work somatically, or move between forms.

User-owned symbolic material is never decoded projectively as hidden truth, historical proof, diagnosis, or revelation.

## Non-goals

- no binary anendophasia diagnosis;
- no claim that literal lifelong zero inner speech has been established;
- no VAK/learning-style taxonomy;
- no automatic inference that low inner speech implies visual thinking;
- no mandatory body-first therapy;
- no new local-browser upload widget in this change;
- no separate therapy engine;
- no `stable` promotion, installation, deployment, or clinical claim.

## Acceptance

The merge candidate must preserve historical schema compatibility, require explicit live-generation provenance, reject fabricated literal inner words mechanically where detectable, keep the representation controller process-scoped, and include a current ChatGPT skill whose multimodal and inner-speech rules match this contract. Focused tests plus the repository's merge-boundary hosted gates must pass on the exact head.
