# The plan in the record: a ranked, revisable roadmap for each case (issue #172, change B) — design, 17 Oct 2026

Status: design for review with its implementation. Synthetic material only; no case content is read or quoted. Change A
(`docs/superpowers/plans/2026-10-17-case-plan-and-known-vs-new.md`) carries the rules; this change gives them something
to read: a plan stored in the case's own encrypted state, a view of it that a fresh session reads first, a reconstruction
offered as a proposal where no plan is recorded, and a mechanical check of what the record already holds.

## Where it lives

`case_state.roadmap`, optional, in the existing encrypted case record. `CASE_STATE_VERSION` stays 1: a record without
the field is valid and unchanged, and the field carries its own `version` (`case-roadmap-v1`) for later migrations. It is
read and written only through the existing case-scoped authorization: reads with the case tools, writes through an
authorized operator operation. No second file, no copy in Git, no write tool on the connector (the connector stays
read-only).

## The record

```
roadmap: {
  version: "case-roadmap-v1",
  goals: [goal, ...],                 // at most 60
  safety_override: null | { reason, since_at, decision_id },
  applied_decisions: [{ decision_id, at, source, digest }],   // the latest 100, for replay checks
  updated_at, updated_by_decision
}
goal: {
  id: "goal:<slug>", title,
  kind: primary_aim | goal_within | actionable_step | independent_track | safety_track | medical_track,
  parent_id,                          // goal_within and actionable_step sit under a primary aim or a goal within it;
                                      // the three tracks and primary aims have none
  status: active | parked | blocked | completed | superseded,
  status_reason,                      // required unless active or completed
  rank,                               // order among active siblings (same parent); null unless active
  priority_source: client | authorized_plan | provisional,
  client_agreement: agreed | declined | not_asked | unknown,
  evidence_refs: [case item, turn or artifact ids],
  blockers: [text], counterevidence: [text],
  review_condition, expected_progress, next_step_tests, uncertainty,   // text, may be empty
  serves_episode_id,                  // the operational current_episode a step serves, if any
  created_at, updated_at,
  history: [{ at, decision_id, source, field, from, to }]             // creation first; bounded, oldest middle entries dropped
}
```

## Who can change what (deterministic, in `src/case-formulation/case-roadmap.mjs`)

A change arrives as a decision: `{ decision_id, source, at, turn_id?, evidence_refs, note?, changes: [...] }`, where a
change adds a goal, updates fields of one goal, or sets the order of one sibling group. Every change is checked before
any is applied; a decision applies whole or not at all.

- **A priority keeps its source.** A goal's `priority_source` is set when it is added, from the decision's source, and
  changes only when a decision of another source changes its rank, status or agreement, which the history records.
- **The client** (a decision whose source is `client`, with evidence references to where the client said it) can add
  goals and change any goal's rank, status or agreement, including an authorized one. A goal the client declines cannot
  be active: declining an active goal parks it with the reason.
- **An authorized plan** (`authorized_plan`: the owner or a supervisor through the operator operation) can add goals and
  change provisional and authorized goals. It cannot change the rank, status, agreement or title of a goal the client
  chose; it can add working notes to it (review condition, expected progress, counterevidence, what the next step tests,
  uncertainty, blockers, evidence references).
- **A model's proposal** (`provisional`) can add provisional goals and change provisional goals only.
- Kind and parent never change (replace a goal by superseding it). Tracks never sit under the primary aim, so medical
  navigation or crisis help can't be recorded as an exercise within reparenting; everyday protective care is a goal
  within the aim when that frame is welcome.
- A safety need or withdrawn consent overrides the ordinary order: `safety_override` (set or cleared by a client or
  authorized decision) marks the ordinary order as suspended while it lasts, without rewriting anyone's ranks; a
  withdrawn consent is the client declining a goal. The view also suspends the order when the record's threat pathway
  shows imminent operational danger.
- A replayed decision with the same id and content changes nothing; the same id with different content is refused.
  Once 100 decisions are kept, one dated before the oldest kept is refused, since it can't be told from a replay.

## What a session reads

`load_case_context` and `load_case_context_by_alias` results (and the app's own durable context, which already carries
the whole case state) include `case_plan`:

- With a recorded roadmap: what is primary, what is being worked on now (the goal linked to the operational episode, else
  the first active step under the first aim; a model's proposal only when nothing confirmed is there), how the episode
  relates to the plan (linked, stale, held by a waiting parent, unlinked), the other active goals, the independent tracks
  (labeled separately available, not exercises), what is parked or blocked and why, active goals held by a waiting parent,
  when priorities would change (each review condition), each goal's source, and whether the ordinary order is suspended
  for safety.
- Without one: `case_plan.status` is `proposed_reconstruction`, rebuilt on every read from the record (the operational
  episode, the routes tried in the intervention history, parked focus questions, high-relevance items), every part
  labeled provisional, never stored and never presented as a decision. It names no primary aim: that is the client's or an
  authorized person's to set.

## Known versus new, mechanically

`check_case_known_vs_new` (connector, read-only, the same scopes as `retrieve_case_evidence`): for up to 12 proposed
points, ranks the record's facts and hypotheses, settled answers, intervention history and roadmap goals by shared terms
(the journal search's reading of word forms, accents folded, English and French stems; BM25 weights), and returns the
best matches with their ids, kinds, sources and statements, and whether any match is close. The model still decides what a
point is; the tool shows where the record already holds it.

## Writes

`record_roadmap_decision`, a new operation of `npm run private-case:operations` (audit scope, the writer lock, a mode-0600
request outside the repository, a receipt). The app runtime's extraction does not write the roadmap in this change; a
later change can let it propose provisional goals, and client goals only from the client's own words in that turn.

## Tests (all synthetic)

Two independent cases with different client priorities; a long-term primary aim kept while a recent acute event takes the
operational episode; a later turn with a different episode; a client declining a goal and revising another; an authorized
plan refused when it would reorder or park a client's goal; a provisional proposal refused on a confirmed goal; protective
care within the reparenting aim and a medical track that cannot be placed under it; a safety override and imminent danger
suspending the order; a record without a roadmap (its reconstruction, labeled a proposal, and no stored change); the plan
after the store is reopened by a new process; replay and conflicting replay; refusal across cases; known-versus-new
ranking of a repeated theme against a new lever.
