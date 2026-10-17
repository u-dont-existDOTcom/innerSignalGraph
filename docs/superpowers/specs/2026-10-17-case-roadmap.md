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
  safety_override: null | { reason, since_at, decision_id, source },
  applied_decisions: [{ decision_id, at, source, digest, turn_id }],   // the latest 100, for replay checks
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
  priority_source: client | authorized_plan | provisional,   // whose goal it is (see below)
  client_agreement: agreed | declined | not_asked | unknown,
  evidence_refs: [case item, turn or artifact ids],
  blockers: [text], counterevidence: [text],
  review_condition, expected_progress, next_step_tests, uncertainty,   // text, may be empty
  serves_episode_id,                  // the operational current_episode a step serves, if any
  created_at, updated_at,
  history: [{ at, decision_id, source, field, from, to, refs? }]      // creation first, then every change, under the
                                      // deciding source; bounded (see below); a client decision's entries keep its first
                                      // five references
}
```

Times are exact UTC times written as JavaScript writes them (`2026-10-18T10:00:00.000Z`), and real ones: a time must come
back unchanged from `new Date(time).toISOString()`, so `2026-02-30T12:00:00.000Z`, `T24:00` or a time without milliseconds
is refused.

## Whose goal it is

`priority_source` says whose goal it is: the client's (`client`), an authorized plan's (`authorized_plan`: the owner or a
supervisor through the operator operation), or a model's proposal (`provisional`). It is set when the goal is added, from
the decision's source, and it changes in only two ways:

- the client agrees to the goal (a client decision sets `client_agreement` to `agreed`): it becomes the client's;
- an authorized decision adopts a model's proposal the client hasn't answered, with the update field `adopt: true`: it
  becomes the authorized plan's. Adopting moves nothing. `adopt` from any other source, or on any other goal, is refused.

Nothing else changes it: not a move in the order (the goal's own or a shift as other goals move), not a status change, not
the client declining or parking it, not a new title, not notes. Every change still goes in the goal's history under the
deciding source. A goal the client declined keeps whose it was, and the view says she declined it ("a model's proposal; the
client declined it"), never that it is her choice.

## Who can change what (deterministic, in `src/case-formulation/case-roadmap.mjs`)

A change arrives as a decision: `{ decision_id, source, at, turn_id?, evidence_refs, note?, changes: [...] }`, where a
change adds a goal, updates one goal (at most once per decision), sets the order of one sibling group, or sets or clears
the safety override. Every change is checked before any is kept; a decision applies whole or not at all.

- **The client** (a decision whose source is `client`) can add goals and change any goal. Its evidence references, and
  those it gives goals when it adds them or changes their references, must name user turns of the case or the source
  artifacts that complete them (the store checks this): a decision cites where the client said it in a session. An
  assistant turn, a completion of one, another source artifact or a journal entry doesn't count: a journal entry is the
  client's material, not a decision she stated.
- **A goal the client chose or answered** (hers, or one she agreed to or declined) is hers to change: no other source
  changes its title, status, status reason, agreement, rank, review condition or linked episode. Another source keeps her
  notes on it: its evidence references, blockers and counterevidence only grow (every item stays), and expected progress,
  what the next step tests and uncertainty are written only while empty.
- **What the client decided last stays hers, on any goal.** The history records each change of title, status (with its
  reason), rank, agreement, review condition and linked episode under its own field name; no other source changes a field
  whose latest entry is the client's. So the model can't undo the review condition she set on its proposal, or reopen a
  proposal she parked. A place she gave a goal holds in any order another source sets; whether a goal that isn't hers
  stays active is still its source's to decide, unless she decided its status last.
- **A goal holding one of hers** keeps its status and place: no other source parks, supersedes, completes or moves a goal
  with an active goal beneath it that is hers or that she agreed to.
- **An authorized plan** can add goals, change its own goals and the model's proposals within those rules, and adopt a
  proposal.
- **A model's proposal** (`provisional`) can add proposals and change proposals the client hasn't answered, within the
  same rules, and nothing else.
- **No other source slips a goal ahead of one it may not move.** In an order set by another source, every active goal of
  the group that source may not move keeps exactly the goals it had ahead of it, so no swap, gap or reshuffle puts a goal
  ahead of it. Ranks are kept 1 to n within each group after every change. Adds and reactivations go to the end of their
  group. An order records a rank entry for each goal it moves (those outside the longest run it keeps in order); the goals
  it only renumbers record nothing, as when a goal leaves the active goals.
- A goal the client declines can't be active: declining an active goal parks it with the reason, and it is active again
  only with her agreement. No other source offers it again: not under another id, and not as another goal's new title,
  with titles compared with accents, case, punctuation, spacing and a leading article (a, an, the, le, la, les, l', un,
  une, des) ignored.
- Kind and parent never change (replace a goal by superseding it and adding another). Tracks never sit under an aim, so
  medical navigation or crisis help can't be recorded as an exercise within reparenting; everyday protective care is a
  goal within the aim when that frame is welcome.
- A safety need or withdrawn consent overrides the ordinary order: `safety_override` (set or cleared by a client or
  authorized decision, which it records) marks the ordinary order as suspended while it lasts, without rewriting anyone's
  ranks; a withdrawn consent is the client declining a goal. The view also suspends the order when the record's threat
  pathway shows imminent operational danger.
- **Dates.** A decision's `at` is the time it claims. Decisions come in time order: one dated before the plan's last change
  is refused. The store also refuses one dated more than five minutes ahead of its clock: enough for clocks that differ a
  little, so that one mistaken date (local time written as UTC, say) can't hold up every decision after it.
- A replayed decision with the same id and content changes nothing; the same id with other content is refused. The latest
  100 decisions are kept for this check; an older one is refused by its date, and the store also refuses a decision whose
  diff (`roadmap:<decision id>`) it already holds.
- Histories hold at most 40 entries. Working notes go first, then the oldest entries, but never the creation entry or the
  latest entry of a field, which says who decided it last.

## One writer, and a plan that can't be read

`recordRoadmapDecision` is the plan's only writer. Every other write of the whole case state (a runtime turn's commit,
`commitTurn`, `saveCaseState`) keeps the plan the record holds and ignores any plan it carries, so a state computed from an
earlier read can't drop a decision and no other scope can rewrite the plan. A write without a case state is refused as
before. A decision's diff joins the state diff history under its own id: the `roadmap:` prefix is kept for plan decisions
(any other writer that uses it is refused), and a plan decision's diff never stands in for the last turn's diff that
continuity checks, handoffs and audits read, nor for a turn's own diff when one is looked up by turn.

A case record's own check looks only at the plan's shape. The plan is read in full where it is used: a plan of this
version is brought within the current limits (the replay list and histories trimmed, ranks renumbered in order) and
checked; one this version can't read shows as `unavailable` with a content-free problem code, and a decision on it is
refused: another version of InnerSignal wrote it, and that version records decisions on it. The rest of the case always
stays readable.

The case store, with everything it imports, needs no npm package (the local server starts without `node_modules`): the
known-versus-new check reads words through `src/journal-import/lexical.mjs`, which imports nothing.

## What a session reads

`load_handoff`, `load_case_context` and `load_case_context_by_alias` results carry `case_plan` right after the therapy
rules (a handoff's from its `canonical_state`; a field of that name in the case's own data never stands in for it):

- With a recorded roadmap: what is primary, what is being worked on now, how the operational episode relates to it, the
  other active goals, the tracks (each kind said: separately available, not an exercise), what is parked or blocked and
  why, active goals held by a waiting parent, what finished, when priorities would change (each review condition), whose
  each goal is, and whether the ordinary order is suspended for safety.
  - **The view lists goals by whose they are**: the client's first, then an authorized plan's, then a model's proposals,
    each in its recorded order. This holds for the primary aims, the goals within them, the tracks, and the current step.
    It changes no clinical priority: the served rules already put the client's deliberate reprioritization first, an
    authorized plan can't change her order, and a client who wants an authorized goal first agrees to it, which makes it
    hers.
  - **The current step** (`now.step`): of the steps in the highest of those classes that has one, the first linked to the
    operational episode, else the first in order. An authorized step linked to the episode doesn't take the current step
    from one of hers.
  - **How the episode relates** (`now.episode_link`): `linked` (the current step serves it), `linked_elsewhere` (it serves
    other active goals, such as a step later in the order or a track, and not the current step), `held_by_parent` (it serves only goals a waiting parent holds), `stale`
    (goals serve an earlier episode), `unlinked` or `no_episode`. `now.episode_serves` lists the active goals that serve
    it, each with whose it is.
  - A plan in which some goal is active and none of the active goals is the client's or an authorized plan's says so
    (`proposals_only`); with no active goal at all it reads as recorded.
- The app's own prompts show a stored plan the same way, as its view, never its histories or replay list: the roles that
  produce a reply and the private roles that audit and repair it.
- Without one: `case_plan.status` is `proposed_reconstruction`, rebuilt on every read from the record (the operational
  episode, the routes tried in the intervention history, parked focus questions, high-relevance items), every part
  labeled provisional, never stored and never presented as a decision. It names no primary aim: that is the client's or an
  authorized person's to set.

## Known versus new, mechanically

`check_case_known_vs_new` (connector, read-only, the same scopes as `retrieve_case_evidence`): for up to 12 proposed
points, ranks the record's facts and hypotheses, settled answers, intervention history and roadmap goals by shared terms
(the journal search's reading of word forms, accents folded, English and French stems; BM25 weights), and returns the
best matches with their ids, kinds, sources and statements, and whether any match is close: a current entry sharing at
least two of the point's content words and 60% of them. An entry is not current when the record marks it no longer
current, when another item supersedes it, when it is a superseded goal or when the client declined it. A one-word point
is never close. The plan's goals are read as this version reads the plan; when the stored plan can't be read, its goals
are left out and `plan_problem` gives the content-free reason, and the tool still answers. The model still decides what a
point is; the tool shows where the record already holds it. It covers the case record; journal material has its own
search tools.

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
ranking of a repeated theme against a new lever. From the first independent review: a goal slipped ahead through a gap in
the ranks; a goal the client agreed to rewritten, or one the client declined reopened or offered again; a history flushed
by notes; references removed; the current step taken by a model's linked step; a plan of proposals only; time order and
exact times; a plan over this version's limits and one it can't read; a whole-state write from an earlier read or with a
forged plan; the last turn's diff kept; client references that don't resolve; the plan view in the app's prompts. From the
second: a client's order, demotion or decline that left other goals hers; an authorized order that adopted the proposals it
passed; adoption and its limits; swaps around a client's goal and around an aim; a model's own goals swapped around hers;
the view's order and current step, and an authorized step linked to the episode; a parent of hers parked, superseded or
moved; her review condition and episode link undone, and a parked proposal reopened after a flooded history; her notes
erased or overwritten; a mistaken date holding up later decisions; a declined title offered again as a retitle or with an
article; the audit and repair prompts; superseded items and an unreadable plan in the check tool; references to an
assistant turn, its completion, another artifact or a journal entry; a plan decision found by its turn; another version's
plan, and whole-state writes without a state; impossible dates; proposals only beside finished goals. The case store's
imports reach no npm package (`tests/private-case-store-imports.test.mjs`).
