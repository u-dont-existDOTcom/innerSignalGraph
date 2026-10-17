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
  rank,                               // order among active siblings (same parent), kept 1 to n; null unless active
  priority_source: client | authorized_plan | provisional,
  client_agreement: agreed | declined | not_asked | unknown,
  evidence_refs: [case item, turn or artifact ids],
  blockers: [text], counterevidence: [text],
  review_condition, expected_progress, next_step_tests, uncertainty,   // text, may be empty
  serves_episode_id,                  // the operational current_episode a step serves, if any
  created_at, updated_at,
  history: [{ at, decision_id, source, field, from, to, refs? }]      // creation first; bounded: working notes are dropped
                                      // first; a client decision's entries keep its first five references
}
```

## Who can change what (deterministic, in `src/case-formulation/case-roadmap.mjs`)

A change arrives as a decision: `{ decision_id, source, at, turn_id?, evidence_refs, note?, changes: [...] }`, where a
change adds a goal, updates one goal (at most once per decision), sets the order of one sibling group, or sets or clears
the safety override. Every change is checked before any is kept; a decision applies whole or not at all. Decisions come in
time order with exact UTC times (`2026-10-18T10:00:00.000Z`): one dated before the plan's last change is refused, and the
store refuses one dated more than a day ahead of its clock.

- **A priority keeps its source.** A goal's `priority_source` is set when it is added, from the decision's source. A change
  of its title, status, agreement or rank by another source makes its current priority that source's, and the history
  says so.
- **The client** (a decision whose source is `client`, with evidence references that the store checks name user turns or
  source artifacts of the case) can add goals and change any goal. A goal the client agreed to or declined is the
  client's: no other source changes its title, status, agreement, rank, review condition or linked episode. A goal the
  client declines can't be active: declining an active goal parks it with the reason, and it is active again only with
  the client's agreement. No other source offers it again under another id with the same title.
- **An authorized plan** (`authorized_plan`: the owner or a supervisor through the operator operation) can add goals and
  change provisional and authorized goals the client hasn't answered. On a goal the client chose or answered it can only
  add working notes (expected progress, counterevidence, what the next step tests, uncertainty, blockers) and add
  evidence references, never remove them.
- **A model's proposal** (`provisional`) can add provisional goals and change provisional goals the client hasn't
  answered, and nothing else.
- **Ranks are kept 1 to n** within each group after every change, so a goal that keeps its number keeps its place: no
  source can slip a goal ahead of one it may not move through a gap left by a goal that finished.
- Kind and parent never change (replace a goal by superseding it and adding another). Tracks never sit under an aim, so
  medical navigation or crisis help can't be recorded as an exercise within reparenting; everyday protective care is a
  goal within the aim when that frame is welcome.
- A safety need or withdrawn consent overrides the ordinary order: `safety_override` (set or cleared by a client or
  authorized decision, which it records) marks the ordinary order as suspended while it lasts, without rewriting anyone's
  ranks; a withdrawn consent is the client declining a goal. The view also suspends the order when the record's threat
  pathway shows imminent operational danger.
- A replayed decision with the same id and content changes nothing; the same id with other content is refused. The latest
  100 decisions are kept for this check; an older one is refused by its date, and the store also refuses a decision whose
  diff (`roadmap:<decision id>`) it already holds.

## One writer, and a plan that can't be read

`recordRoadmapDecision` is the plan's only writer. Every other write of the whole case state (a runtime turn's commit,
`commitTurn`, `saveCaseState`) keeps the plan the record holds, so a state computed from an earlier read can't drop a
decision and no other scope can rewrite the plan. A decision's diff joins the state diff history under its own id and
never stands in for the last turn's diff that continuity checks, handoffs and audits read.

A case record's own check looks only at the plan's shape. The plan is read in full where it is used: a plan of this
version is brought within the current limits (the replay list and histories trimmed, ranks renumbered in order) and
checked; one this version can't read shows as `unavailable` with a content-free problem code, and no decision is
recorded on it until it is repaired. The rest of the case always stays readable.

## What a session reads

`load_handoff`, `load_case_context` and `load_case_context_by_alias` results carry `case_plan` right after the therapy
rules (a handoff's from its `canonical_state`; a field of that name in the case's own data never stands in for it):

- With a recorded roadmap: what is primary, what is being worked on now (a confirmed goal linked to the operational
  episode, else the first confirmed step under the first confirmed aim; a model's proposal only when nothing confirmed is
  there), how the episode relates to the plan (linked, linked to a proposal, stale, held by a waiting parent, unlinked),
  the other active goals, the tracks (each kind said: separately available, not an exercise), what is parked or blocked
  and why, active goals held by a waiting parent, what finished, when priorities would change (each review condition),
  each goal's source, and whether the ordinary order is suspended for safety. A plan holding only a model's proposals
  says so (`proposals_only`).
- The app's own prompts show a stored plan the same way, as its view, never its histories or replay list.
- Without one: `case_plan.status` is `proposed_reconstruction`, rebuilt on every read from the record (the operational
  episode, the routes tried in the intervention history, parked focus questions, high-relevance items), every part
  labeled provisional, never stored and never presented as a decision. It names no primary aim: that is the client's or an
  authorized person's to set.

## Known versus new, mechanically

`check_case_known_vs_new` (connector, read-only, the same scopes as `retrieve_case_evidence`): for up to 12 proposed
points, ranks the record's facts and hypotheses, settled answers, intervention history and roadmap goals by shared terms
(the journal search's reading of word forms, accents folded, English and French stems; BM25 weights), and returns the
best matches with their ids, kinds, sources and statements, and whether any match is close: a current entry (not marked no
longer current, not superseded, not declined by the client) sharing at least two of the point's content words and 60% of
them. A one-word point is never close. The model still decides what a point is; the tool shows where the record already
holds it. It covers the case record; journal material has its own search tools.

## Writes

`record_roadmap_decision`, a new operation of `npm run private-case:operations` (audit scope, the writer lock, a mode-0600
request outside the repository, a receipt with ids and the revision only). The import's operator grant (`case:write`) is
refused, so recording a plan needs a supervisor identity whose token and operator ACL entry carry `case:audit`. Goal ids
appear in error messages, so use neutral ones (`goal:aim-1`). The app runtime's extraction does not write the roadmap in
this change; a later change can let it propose provisional goals, and client goals only from the client's own words in
that turn.

## Tests (all synthetic)

Two independent cases with different client priorities; a long-term primary aim kept while a recent acute event takes the
operational episode; a later turn with a different episode; a client declining a goal and revising another; an authorized
plan refused when it would reorder or park a client's goal; a provisional proposal refused on a confirmed goal; protective
care within the reparenting aim and a medical track that cannot be placed under it; a safety override and imminent danger
suspending the order; a record without a roadmap (its reconstruction, labeled a proposal, and no stored change); the plan
read back by a new service over the same vault; replay and conflicting replay; refusal across cases; known-versus-new
ranking of a repeated theme against a new lever. From the independent review: a goal slipped ahead through a gap in the
ranks; a goal the client agreed to rewritten, or one the client declined reopened or offered again; a history flushed by
notes; references removed; the current step taken by a model's linked step; a plan of proposals only; time order and
exact times; a plan over this version's limits and one it can't read; a whole-state write from an earlier read or with a
forged plan; the last turn's diff kept; client references that don't resolve; the plan view in the app's prompts.
