# Public guide humanization and semantic sync

## Purpose

Inner Signal may maintain a public, humanized guide whose prose is optimized for readers without turning that article into a second therapy authority.

The public guide is a **derivative publication surface**. It may change voice, compression, examples, section order, pacing, jokes, memoir, transitions, citations, and layout. It may not silently create, remove, reverse, broaden, narrow, or weaken therapy semantics.

## Multiple guide families

Humanized editions are tracked independently rather than as one global public-guide state. `authoring/public-guide-sync.json` currently tracks inner-child, somatic, altered-states, and hypnosis as separate derivatives. The somatic edition is already humanized according to the owner; separate humanized inner-child, altered-states, and hypnosis editions may be produced later. A change in one derivative does not imply that another derivative or its operational map is synchronized.

The public URL is a reading destination, not runtime authority. It is expected that a humanized article may no longer match internal map wording or section structure exactly. Semantic equivalence is the requirement; literal correspondence is not.

## Authority model

The directional model is:

```text
canonical guide/source authority
        +
executable graph authority
        ↓
semantic obligations / sync manifest
        ↓
public humanized derivative
```

There is no bidirectional authority loop.

- Current files under `guides/`, their source maps, owner amendments, and the existing Guide Packet lifecycle remain source/provenance authority.
- `guide-graphs/candidates/*.graph.json` remains executable development authority.
- The public humanized guide is never runtime input, graph authority, Guide Packet approval evidence, or a source of automatic therapy-policy changes.
- A public edit has no effect on runtime behavior merely because it is clearer, more persuasive, more recent, or published.

## Core invariant

**Humanization may freely change expression, but it may not silently change therapy semantics.**

Semantic preservation is about meaning, not wording. A public paragraph may satisfy several graph/source obligations at once, and internal implementation mechanics do not need a reader-facing paragraph merely to mirror every graph node.

Examples of valid downstream humanization include:

- compressing repeated qualifications into one natural sentence;
- replacing technical labels with ordinary language while preserving the distinction;
- moving an explanation to the section where a reader will understand it best;
- combining several closely related source passages into one coherent public passage;
- adding memoir, examples, humor, metaphor, transitions, citations, or rhetorical framing that do not change the therapy rule;
- omitting runtime-only mechanics such as task-state bookkeeping, capability gates, persistence contracts, internal routing metadata, or approval machinery.

Examples of invalid silent drift include:

- converting an optional practice into a required stage;
- turning a hypothesis into a fact or an owner-reported practice into a clinically validated claim;
- deleting a safety, consent, accountability, boundary, or uncertainty distinction because it sounds cumbersome;
- replacing a revisable judgment with a categorical one;
- changing who has authority to decide, act, contact, forgive, trust, reconcile, diagnose, or escalate;
- making a public metaphor or anecdote override graph/source behavior;
- treating a smoother public formulation as authority to update the canonical guide or executable graph automatically.

## Semantic sync manifest

`authoring/public-guide-sync.json` is the non-authoritative bookkeeping surface for the public derivative. It records the exact upstream authority identity and, once a public derivative is registered, the mapping between canonical concepts and public passages.

Each material public semantic obligation should be representable by:

- a stable concept/obligation ID;
- canonical source anchor(s), source hash(es), or owner-amendment IDs;
- related graph node(s) or route(s) when applicable;
- a concise statement of the meaning that must survive humanization;
- a stable public heading/anchor or passage identifier;
- the public artifact/version/hash when available;
- status: `SYNCED`, `DRIFTED`, `NOT_PUBLIC`, or `PROPOSED_UPSTREAM`;
- notes explaining any intentional compression, relocation, or omission.

`NOT_PUBLIC` is valid for implementation-only mechanics or material deliberately excluded from the article. It is not a loophole for silently dropping reader-relevant therapeutic meaning.

## Direction of change

### Canonical/map change → public derivative

When source or executable therapy semantics change:

1. complete the normal source/graph/owner-approval workflow first;
2. identify only the semantic obligations affected by the approved change;
3. repair the canonical guide/source as required by the existing workflow;
4. update only the affected public passages rather than re-humanizing the whole article;
5. run a semantic preservation review against the affected obligations;
6. update the sync manifest status and public artifact identity.

Unchanged public prose does not need rewriting merely because an upstream file hash changed for unrelated reasons.

### Public humanization → canonical/map

Public editing is downstream by default.

A change that affects only expression stays downstream. A change that introduces a genuinely new therapeutic distinction, intervention, safety rule, routing rule, authority claim, or conceptual correction must be marked `PROPOSED_UPSTREAM` and enter the normal owner-approved source/graph proposal process before it can affect runtime behavior.

Do not copy a public innovation directly into canonical source or graph authority merely because it reads better.

## Publication gate

Before publishing or replacing a humanized guide version:

1. bind the exact upstream source/graph authority used for the pass;
2. identify every changed public passage carrying therapy semantics;
3. classify each changed passage as style-only, semantic-preserving rewrite, intentional omission/relocation, or proposed upstream semantic change;
4. verify that no changed passage silently alters safety, consent, boundaries, accountability, uncertainty, authority, sequencing, or efficacy claims;
5. resolve every affected manifest item to `SYNCED`, `NOT_PUBLIC`, or `PROPOSED_UPSTREAM`; `DRIFTED` blocks publication of the affected semantic claim;
6. retain the public artifact/version/hash as publication provenance.

This gate does not require one public paragraph per graph node and does not require byte similarity to the canonical source.

## Pending change queue

`authoring/PENDING-PUBLIC-GUIDE-CHANGES.md` is the durable handoff from approved source/map/rule work into later public-guide humanization. It is downstream bookkeeping, never therapy authority.

Whenever an approved canonical source, owner amendment, graph node/edge, activation/gate, realization rule, safety boundary, or other therapy rule changes **reader-facing meaning**, the same reviewed change must add or update the corresponding obligation in that queue. Runtime-only mechanics do not require a public-guide entry.

A humanizer starting or resuming an Inner Child public-guide pass must read this document and the pending queue after freezing upstream authority and before choosing the next section. Reconcile every pending item against the frozen authority. If the public draft already expresses an obligation adequately, consume the item without duplicating prose.

Consumption is transactional:

- when only some items are handled, remove only those consumed items and leave the queue `PENDING`;
- when all items are incorporated or explicitly dispositioned under this document and the affected `authoring/public-guide-sync.json` bookkeeping is updated, reset the queue to its `EMPTY` sentinel in the same reviewed change;
- keep the queue file permanently rather than deleting it, so the humanizer bootstrap has one stable path;
- a later reader-relevant canonical change changes the queue back to `PENDING` in the same reviewed change that creates the new obligation.

This prevents a map/rule fix from being semantically correct at runtime while silently disappearing from the later reader-facing guide.

## Teaching points for map changes

Owner request, 8 and 9 Oct 2026: guide additions must say what map change caused them and why a reader needs them, and the AI guide should follow from the map side.

Every change to the map gets one of two things, in the same reviewed change. The map here means an owner amendment, a graph candidate node or route, a gate, a prompt or realization rule, or canonical guide text.

- **A teaching point.** One or two plain sentences from the person's side: what someone should understand or do differently. It goes on the queue as an entry with five fields:

  ```markdown
  ### PGQ-0NN — <title>
  Caused by: <pull request>, <amendment and node or route IDs>; owner outcome: "<one line>"
  Teaching point: <one or two plain sentences, from the person's side>
  Reader need: <what a reader would miss or get wrong without it>
  Already covered: <where the AI guide, and the humanized guide when known, says something close, and what this adds | nothing close>
  Where: <the guide section it belongs in>
  ```

- **App-only.** This is for a change only to how the app behaves toward a client (routing, state, re-offers, labels) that changes nothing a person should understand or do. The pull request's description says so on a line of its own:

  ```markdown
  Guide impact: app-only — <one line on why nothing changes for a reader>
  ```

The AI guide's text for a teaching point is written from it, in the reader's voice, in the same change. Notes about the app's own behavior belong in the prompts and rules, or in a passage clearly marked as app-only. They don't belong in prose a person reads: a planner's no-re-offer rule addressed to the reader, or the app named inside reader advice, is the kind of line this keeps out. App-only is declared, never inferred from a missing queue entry.

The `workflow-policy` check enforces this on every pull request (`scripts/check-guide-impact.mjs`). A change to a map file needs one of these, and a queue edit that adds no teaching point (consuming an entry, fixing prose) doesn't count:

- a new teaching point on the queue;
- for an existing entry, a change to its heading (with the pull request number, say), which also brings it up to the five fields;
- the app-only line.

Every entry a change adds or re-heads must have all five fields. One whose `Already covered:` says nothing close must come with a change to canonical guide text (`guides/*.txt`), since the AI guide doesn't say it yet. Whether that text says what the teaching point says is for review; the check can't read meaning.

## Humanization workflow

For a large public pass, work section by section rather than rewriting the entire guide and reconciling afterward:

```text
freeze upstream authority
→ select one public section
→ identify its active semantic obligations
→ humanize freely within those obligations
→ semantic preservation check
→ update sync manifest
→ continue
```

This keeps prose quality and semantic fidelity separable. The humanizer should not be forced to preserve machine-oriented wording, and the map/source maintainer should not treat public rhetoric as executable policy.

## Drift triggers

Recheck the affected public obligations when any of these occur:

- a canonical source or owner amendment changes meaning;
- a graph node/edge, activation, gating, priority, required nuance, forbidden overclaim, or realization obligation changes;
- the public guide rewrites or removes a passage mapped to a semantic obligation;
- a public passage introduces a new therapeutic claim;
- a citation or anecdote is rewritten in a way that changes the apparent evidence level;
- a public edit changes a safety, consent, relational, epistemic, or authority boundary.

Do not require a complete article-wide resync for an unrelated upstream edit when the affected obligation set is known and bounded.

## Non-effects

This architecture does not:

- make the public guide runtime authority;
- make Markdown canonical therapy source;
- create background bidirectional synchronization;
- authorize publication by itself;
- infer owner approval from publication;
- install or promote anything to `stable`;
- claim that semantic-sync bookkeeping proves clinical efficacy or model adherence.

The public guide may become substantially more readable than the canonical source. That is expected. Fidelity is defined by preserved therapeutic meaning and explicit upstream handling of genuine semantic innovations, not by textual similarity.