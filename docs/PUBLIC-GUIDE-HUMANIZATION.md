# Public guide humanization and semantic sync

## Purpose

Inner Signal may maintain a public, humanized guide whose prose is optimized for readers without turning that article into a second therapy authority.

The public guide is a **derivative publication surface**. It may change voice, compression, examples, section order, pacing, jokes, memoir, transitions, citations, and layout. It may not silently create, remove, reverse, broaden, narrow, or weaken therapy semantics.

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