# Inner-speech / phenomenology integration — 2026-09-15

## Owner outcome and authority

The owner authorized implementation, push, and merge of the agreed InnerSignal adaptation after repository housekeeping:

- pre-screen ordinary inner narration without collapsing it into moment-level preverbal experience;
- distinguish spontaneous inner speech from deliberate silent-speech capacity;
- preserve direct phenomenology versus later appraisal/verbalization when useful;
- explicitly avoid treating nonverbal/earlier experience as deeper or truer;
- preserve words, analysis, evidence review, and behavioral testing as legitimate tools;
- let the ChatGPT plugin use host-native images, drawings, audio/songs, and files when the host can inspect them rather than requiring a redundant uploader or prose translation.

Authorized destination: development `main`. Not authorized: `stable`, installation, deployment, publication, diagnosis, or clinical-efficacy claims.

## Active lesson contract

- **Owner goal / no requirement accretion:** implement the agreed distinction rather than adding a separate anendophasia therapy engine, global cognitive type, or duplicate upload system.
- **Iteration-to-release boundary:** focused tests first; because the owner explicitly requested merge, require the repository's exact hosted merge checks on the final head before merging.
- **Historical compatibility:** newer extraction fields are optional in runtime snapshots but explicit in provider generation, matching the repository's established nullable/compatibility pattern.
- **Representation fidelity:** trait-level inner speech is a revisable prior only; episode-level representation remains process-scoped and may switch.
- **Epistemic safety:** direct bodily/imagistic/intuitive material remains phenomenological evidence; external conclusions remain claims to examine when decision-relevant. Neither dismissal nor revelation-certainty is allowed.

## Implementation

- `src/case-formulation/phenomenology.mjs` defines bounded non-diagnostic schemas and validators for the trait profile and observation-level provenance.
- `schemas.mjs` adds optional historical/runtime fields while requiring explicit live-generation null/object output.
- `validators.mjs` applies semantic validation, including the invariant that literal inner words cannot be recorded unless `INNER_WORDS` was directly reported.
- shared longitudinal/audit/realization rules encode the trait-versus-episode distinction, prohibit nonverbal privilege, and preserve language/evidence analysis.
- the ChatGPT skills-only package is composed onto current `main`, binds the current generated therapy map, adds the detailed phenomenology contract, performs one brief inner-speech screen when appropriate, and uses host-native multimodal material when actually inspectable.
- the standalone local browser remains unchanged; this task does not duplicate ChatGPT's upload surface.

## Verification boundary

Focused regression: `node --test tests/phenomenology-profile.test.mjs`.

Merge boundary: exact-head hosted repository workflow policy, deterministic package/Verify, and CodeQL must pass. Review the final PR diff and unresolved review threads before merge. No provider/model calls are required to establish the mechanical/schema/product-policy boundary; human usefulness and clinical effects remain unestablished.
