# Inner Signal constitution, longitudinal context, and private state architecture

Status: owner-authorized candidate on draft PR #46. This candidate is not clinical validation, an audit-architecture selection, runtime release, installation, deployment, merge, or stable promotion.

## Outcome

Inner Signal now has three deliberately separate forms of memory:

1. a versioned, always-loaded global therapy constitution;
2. provenance-aware longitudinal case evidence and current episode state;
3. exact private transcript, tracker, and journal records stored only through an encrypted vault adapter.

This separation prevents a recent topic or lossy summary from redefining the therapeutic purpose. It also prevents the public repository from becoming a client record.

## Global constitution

`src/therapy/constitution.mjs` is immutable, versioned, and injected through the common therapy prompt rules. It fixes seven therapeutic ends: care; leadership; protection; integration and vitality; connection and participation; transcendence and mortality; and growth, learning, and achievement.

The operating posture is strong strategic persistence with high tactical flexibility. A failed or declined technique changes route before it changes the therapeutic end. Rejection of the method or its ends is a treatment-contract mismatch or decline, not permission for covert continuation. The method remains developmental integration expressed through adult care, guidance, and protection; it does not silently become generic optimization, symptom control, spiritual doctrine, or social advice.

Client reports have scoped authority. They are privileged for phenomenology, preference, consent, and remembered events, but do not automatically settle causality, risk, importance, or method purpose. Spiritual and nonordinary experiences remain metaphysically open. Claimed identity does not confer authority; experienced authority is assessed by whether it is loving, wise, helpful, and freedom-preserving. Immediate safety or external reality may temporarily preempt the developmental route without replacing the fixed ends.

## Longitudinal case state

`src/case-state/longitudinal-state.mjs` stores direct reports, supervisor reports, observations, hypotheses, inferences, unresolved conflicts, confidence, provenance, time references, supersession, decision relevance, answered questions, intervention history, and the current therapeutic episode. The case record references the constitution version but cannot redefine it.

Contradictions are first-class data. A later statement such as “we already agreed” is recorded as a new direct report and an open conflict; it cannot overwrite the earlier unresolved target. The user-visible diff reports additions, updates, supersessions, contradictions, confidence and provenance changes, answered-question changes, episode changes, and observability changes. It contains no hidden reasoning or raw transcript.

Trajectory observability is explicit per domain across intensity, function, duration, timing, delayed effects, and external observation. Poor observability blocks confident causal inference. A clean-looking current point or recent similarity to a variable baseline does not prove that a chronic vulnerability disappeared.

## Context and compaction

`src/case-state/context-window.mjs` builds each therapy context from:

- the immutable constitution reference;
- the durable structured case state;
- the current episode contract;
- at least the last three complete exchanges verbatim;
- current-episode turns when it began earlier, capped at the latest 120 exact turns with visible truncation metadata;
- up to 24 contradiction-first, stable-ID retrieval requests for older high-relevance evidence;
- a descriptive tracker summary capped at the latest 180 eligible entries with visible omission counts.

Lossy summaries are never marked authoritative. Exact recent text preserves corrections, hedges, emotional shifts, and answers that structured extraction may miss. Stable older references prevent full-history replay while retaining decision-relevant facts outside the visible window. Explicit limits prevent an unusually long episode, tracker, or retrieval set from silently turning bounded context back into full-history replay; omission is surfaced instead of hidden.

## Encrypted private storage

`src/storage/private-case-store.mjs` composes the repository's existing AES-GCM dual-wrap vault and OS-backed routine-authorization boundary. It stores append-only raw transcript, structured case state, tracker entries, journal/dream entries, and the last state diff in one encrypted envelope per safe case ID. The write is atomic, files are mode `0600`, directories are mode `0700`, plaintext buffers are cleared after use, and access keys are cleared when the adapter closes.

There is no plaintext fallback. If an authenticated OS credential-store adapter is not supplied, the browser keeps sensitive state in memory for the current page session. The implementation accepts injected key material and evidence that OS reauthentication occurred; it does not invent a platform keychain integration or read secrets from environment variables. Selecting and packaging a concrete operating-system credential adapter remains release work, not an owner decision hidden inside this candidate.

New browser storage persists only safe settings and a random case ID. Earlier browser-local records are detected, left untouched, and shown to the owner; they are neither silently migrated nor deleted. Explicit browser backup remains readable and is labeled as sensitive portable data. The erase control removes browser settings and legacy browser records, but does not claim to delete an encrypted server vault.

The loopback service exposes encrypted state, tracker, and journal endpoints only when the private store is injected. The state endpoint returns structured inspection data and counts, never transcript text, journal text, or chain-of-thought. Therapy responses return a structured state projection and exact diff for the UI.

## Tracker and user inspection

`src/case-state/tracker.mjs` supports sleep duration/quality, pain intensity and functional interference, anxiety, depressed mood, stability, unreality, division, social contact, rejection impact, shaking timing/intensity, THC timing/use, other substances or interventions, food exposure, stressors, activities, function, and optional journal/dream notes. Summaries show count, first/last, range, exposure counts, and missingness. They explicitly describe temporal association without causal inference.

The web UI adds “Current saved state” and “What changed this turn,” plus small tracker and journal forms. These surfaces make the app's working evidence inspectable without exposing hidden model reasoning. Journal text is not echoed into the structured state view.

## Audit harness correction

The public synthetic audit case now represents poor trajectory observability, variable sleep, THC as a possible confound, simple-versus-elaborate practice uncertainty, severe fluctuating pain, mixed mood descriptions, unsafe or untrusted support, helper burden, changing romance appraisal, constrained relocation, hypothesis provenance, and impressionability without copying a real transcript or exact private details. Its gold state contains 42 provenance-bearing items and 13 unresolved contradiction clusters, including every contradiction family required by the owner directive.

Steering fidelity is a first-class evaluation axis: telos persistence, route flexibility, client-evidence responsiveness, consent integrity, and method-identity fidelity. The added adversarial fixtures test topic takeover, rigid repetition, technique and method rejection, metaphysical agenda capture, acute preemption, client-evidence overdeference, and compaction poisoning. More audit passes receive no automatic credit; false-positive critique, safety inflation, repetition, length inflation, unnecessary rewriting, and repair-induced errors remain penalized.

The semantic instrument changed. Historical calibration remains preserved as a stopped historical run and cannot certify the new fixture. A new artifact freeze and complete calibration are required before any ChatGPT architecture or visible-`Latest` comparison. Provider/API/OpenRouter calls remain prohibited for this experiment. No winner or runtime adoption follows automatically from later scores.

## Verification and limits

Deterministic tests cover constitution injection, state validation and diffs, the complete contradiction registry, contradiction poisoning, compacted-state decision equivalence, exact recent-window and current-episode retention, explicit context limits, targeted older retrieval, tracker missingness and noncausal summaries, ciphertext-only private storage, append-only transcript preservation, end-to-end encrypted therapy-turn persistence, key clearing, endpoint fail-closed behavior, browser persistence boundaries, public synthetic privacy, steering coverage, and the existing audit scorer.

The reference response is a behavioral rubric, not objective ground truth. Human review remains necessary before choosing an audit architecture or adopting prompts. Clinical usefulness, harm, concrete OS credential-store packaging, migration UX, retention policy, deletion of server-side encrypted cases, and behavior under authorized live models remain unresolved.

## Research-before-reinvention disposition

Disposition: **COMPOSE / ADAPT**. This candidate composes the existing vault envelope and routine authorization, incremental formulation, path-performance episode state, browser UI, and blinded audit harness. New code is limited to the missing immutable constitution, longitudinal evidence schema, compaction/retrieval adapter, private encrypted record service, tracker, inspection views, and adversarial fixtures. No parallel therapy engine or second audit runner was introduced.
