# InnerSignal Universal Handoff Binding v1.0

Status: owner-adopted on 2026-09-09.

## 1. Production independence from GitHub

GitHub is canonical for InnerSignal code, schemas, constitution, guide/runtime definitions, audit harness, and synthetic/de-identified fixtures. GitHub must not be the production persistence backend for real therapy cases. Real longitudinal state lives in InnerSignal's private authenticated encrypted store.

## 2. InnerSignal packet mapping

### `canonical_state`

Contains durable case facts; provenance; client reports; supervisor observations; hypotheses and alternatives; contradictions; trajectory observability; prior harms; interventions attempted; helpful, failed, and adverse patterns; settled answers; do-not-reask state; trust/provider state; current therapeutic episode; current target/path; path success/failure/stop signals; and unresolved high-information questions.

The global InnerSignal constitution is referenced by version, not copied into each case.

### `recent_verbatim`

Contains the exact active therapy episode from its declared semantic start through the latest turn. Completeness is determined by the episode boundary and transcript continuity, not an arbitrary exchange count. These turns must never be recreated from case state.

### `pending_artifacts`

Contains exact unsent client-facing responses awaiting audit, supervisor approval, or delivery. Each receives a stable `candidate_id`.

### State and retrieval

`state_diff` backs **What Changed This Turn**. `canonical_state` backs **Current Saved State**. `retrieval_index` indexes older transcript turns, journal entries, tracker records, prior interventions, significant adverse events, and historical decisions.

## 3. InnerSignal Create Handoff

Provide a first-class `Create Handoff` operation that:

1. snapshots structured case state;
2. freezes state diff;
3. captures the exact active verbatim episode;
4. captures exact pending response candidates;
5. commits current tracker/journal references;
6. records constitution/runtime/audit versions;
7. generates a manifest;
8. deterministically chunks oversized components;
9. encrypts and stores the private payload;
10. verifies round-trip;
11. returns `handoff_id`, `case_id`, relevant `candidate_id` values, and handoff status; and
12. runs clean-session acceptance where available.

The UI must not display “handoff complete” before `FRESH_SESSION_GREEN`.

## 4. Required retrieval surface

Authorized sessions require tools equivalent to:

```text
load_handoff(handoff_id)
load_case_context(case_id)
get_state_diff(case_id | handoff_id)
get_recent_verbatim(case_id | handoff_id)
get_pending_candidate(candidate_id | handoff_id)
retrieve_case_evidence(case_id, query | provenance_ids | time_range)
get_tracker_window(case_id, variables, time_range)
get_journal_entries(case_id, query | time_range)
```

A new supervisor or therapy session should normally need only a `handoff_id`.

## 5. Therapy-specific continuity invariant

A fresh InnerSignal session must preserve factual memory and therapeutic steering. Fresh-session verification checks that:

- constitutional telos remains intact;
- active therapeutic target remains intact;
- current intervention/path is understood;
- failed probes are not retried blindly;
- already-answered questions are not re-asked;
- hypotheses remain hypotheses;
- contradictory trajectories remain contradictory;
- the latest client appraisal does not overwrite longitudinal evidence;
- consent and method-contract state survive; and
- a pending candidate can be audited byte/text-exactly.

## 6. Noisy longitudinal cases

Cases with unreliable global self-assessment require explicit structured state for trajectory observability, conflicting reports, intensity versus function, short-term state versus durable capacity, timing, delayed effects, and external observations. A new session must not infer a clean trend merely because the newest turn says “better” or “worse.”

## 7. Tracker and journal integration

The handoff packet references InnerSignal's longitudinal tracking system. Relevant variables may include sleep, pain, anxiety, depressed mood, stability/unreality, social connection, rejection events, somatic practices, substances/medications/supplements, diet, function, meaningful activities, and major events.

Journal and dream entries remain searchable historical evidence, not automatically promoted into settled case facts. Correlations must not be converted into causal findings without appropriate evidence.

## 8. Privacy

Real client transcript, journal, tracker data, candidate responses, and case state remain in the private case/handoff store. Public Git may contain only implementation, protocol documents, synthetic tests, and de-identified fixtures. Encryption must include an actually usable authorized decryption path.

## 9. InnerSignal acceptance regression

Create a synthetic test case containing more than 100,000 characters of therapy history, contradictory longitudinal reports, important facts far outside recent context, exact Unicode client turns, multiple candidate responses, corrected/superseded state, settled questions, failed intervention paths, and vivid latest-turn distractions.

Simulate a maximum 20,000-character source-read limit, compile the handoff, destroy all runtime/context memory, and create Session B with only `handoff_id`.

Session B must correctly recover the constitution version, canonical case state, contradictions, trajectory observability, exact recent episode, exact pending candidate, current therapeutic target/path, settled answers, and one older targeted evidence item. It must make a decision-equivalent therapeutic continuation without relying on Session A memory. Failure means the handoff is not continuation-safe.

## 10. User-facing state controls

InnerSignal exposes:

- **Current Saved State** — readable structured state and epistemic classifications;
- **What Changed This Turn** — additions, changes, contradictions, supersessions, and confidence/provenance changes;
- **Create Handoff** — compiles and validates continuity; and
- **Export Private Handoff** — provides a portable encrypted fallback.

Supervisor/development mode may additionally expose the recent exact episode, pending candidates, and provenance/evidence retrieval. Hidden reasoning or chain-of-thought is never exposed.

## 11. Standalone requirement

InnerSignal continuity must remain functional if GitHub is entirely absent from runtime. GitHub may define the software. It must not be required to remember the client.
