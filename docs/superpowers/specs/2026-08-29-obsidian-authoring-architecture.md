# InnerSignal Obsidian authoring and mapping architecture

Status: accepted implementation design

Date: 2026-08-29

Baseline: `82b12b20c4a401b5e60999f981292c36fbaa8a53`

Evidence: `docs/OBSIDIAN-AUTHORING-ARCHITECTURE-EVIDENCE-2026-08-29.md`

## Objective

Add an optional Obsidian workbench that improves graph browsing and structured proposal authoring while preserving the current typed JSON graph, compiler/planner, canonical guide sources, Guide Packet provenance and owner-decision lifecycle, regression corpus, release policy, privacy boundary, and installed runtime behavior.

The architecture migration has zero intentional therapy or runtime semantic change.

## Decisive architecture

The system has five layers:

1. Canonical development authority remains the candidate graph JSON, canonical guide/source families, owner amendments/provenance, and regression corpus.
2. Obsidian current-state notes, Bases, Canvas, and the living Mermaid map are deterministic generated projections.
3. Editable Obsidian proposal directories contain explicit add, replace, or remove operations bound to exact base hashes.
4. Proposal materialization reconstructs a complete candidate graph bundle in `authoring/.build/`, then reuses graph validation, compilation, regressions, behavioral diff, provenance checks, and Guide Packet owner decisions.
5. Generated diagrams remain audit/navigation views and never become runtime or approval authority.

## Authority matrix

| Concern | Authority | Non-authoritative view/input |
| --- | --- | --- |
| Canonical guide prose | Existing HTML/current source family; legacy text only where runtime already uses it | Bounded source-section excerpts |
| Candidate graph | `guide-graphs/candidates/*.graph.json` | Current notes and proposals |
| Compiled graph | Existing compiler output | Mermaid and Canvas |
| Installed runtime | Existing installed Guide Packet/fallback | Authoring build output |
| Graph semantics | `guide-graph-v1`, validators, planner | Authoring-note schemas |
| Behavioral acceptance | Existing regression and realization contracts | Regression index notes |
| Provenance/certainty | Existing Guide Packet policy and owner amendments | Projection manifest and receipts |
| Semantic approval | Existing behavioral diff and owner-decision artifacts | Proposal decision previews |
| Uncompiled conceptual material | Schema-validated overlay registry | Mermaid/Canvas overlay layer |
| Release/install | Protected `stable` and release evidence | Authoring CLI |

Wiki links, backlinks, Base queries, Canvas geometry, Mermaid layout, filenames, and Obsidian UI state have no semantic authority.

## Canonical prose

Use the hybrid strategy: existing canonical HTML/current-source bytes remain authoritative. Obsidian contains generated read-only source-section notes with stable IDs, locators, hashes, and bounded excerpts. Graph proposals reference stable source IDs. The CLI may not convert Markdown to canonical HTML, derive source IDs from headings, update source hashes from prose, or edit canonical source bytes.

## Contracts and identities

Use explicit versions:

- `inner-signal-authoring-projection-v1`
- `inner-signal-authoring-node-current-v1`
- `inner-signal-authoring-node-proposal-v1`
- `inner-signal-authoring-edge-current-v1`
- `inner-signal-authoring-edge-proposal-v1`
- `inner-signal-authoring-proposal-v1`
- `inner-signal-authoring-receipt-v1`
- `inner-signal-map-overlay-v1`

Node identity is the exact existing node ID and unsafe filename IDs are rejected. A node rename is remove plus add.

Authoring-only edge identity is SHA-256 of `graph_id + NUL + from_node_id + NUL + relation + NUL + to_node_id`. Filenames use the first 16 lowercase hex characters and full digests are collision-checked. Edge changes are remove plus add.

Proposal IDs match `^[a-z0-9][a-z0-9._-]{2,127}$` and are immutable.

## Note representation

Frontmatter holds shallow, atomic metadata only. Complex graph semantics live in exactly one delimited JSON payload block. Current notes are fully generator-owned and immutable. Proposal notes reconstruct complete records; they are not field patches.

The restricted YAML subset allows one leading UTF-8/LF document containing mappings, sequences, strings, integers, booleans, and null. Reject duplicate keys, anchors, aliases, custom tags, merge keys, multiple documents, unknown keys, implicit schema coercion, and input mutation.

Validate note/view/proposal shapes using Draft 2020-12 JSON Schema through exact-pinned Ajv strict mode. Then use existing domain validators. Schema validation never replaces graph, source, planner, regression, Guide Packet, or approval validation.

## Determinism and drift

Canonical JSON uses stable key ordering, two-space indentation, and one final newline. Hash exact UTF-8 bytes.

`projection_input_sha256` hashes a canonical ordered list of authoritative input paths and exact hashes. It is embedded in current notes and proposal base metadata. The projection manifest lists input and generated-output hashes without hashing itself into itself. No timestamps or self-referential commit IDs occur in generated artifacts.

`authoring:check`, `authoring:maps:check`, and proposal check commands build in temporary directories and byte-compare without rewriting. Generated-note edits fail as `GENERATED_PROJECTION_DRIFT`. Stale proposal inputs fail as `STALE_AUTHORING_BASE` with bounded old/new path hashes. V1 has no automatic three-way semantic merge.

## Overlay registry and map migration

The current manual map is classified once as `compiled-node`, `compiled-edge`, `owner-approved-uncompiled-overlay`, `explanatory-layout`, or `retired-with-reason`. Unproven statements stop migration.

Overlays must have non-colliding stable IDs, explicit authority, source references, anchors, relations, and status. They cannot contain activation or planner effects and never enter compilation. Reconciled items name exact executable nodes and cannot remain presented as owner-approved/uncompiled.

The living Mermaid map is generated from the compiled bundle and overlay registry. It begins with generation/authority warnings and an input-set hash, separates compiled behavior from owner-approved uncompiled material, labels status in text, uses digest-derived parser-safe identifiers, escapes labels, parses with an exact-pinned official parser, and is checked for completeness and determinism. V1 does not render or commit SVG.

JSON Canvas is generated only. Layout is fixed: graph ID, tier ascending, priority descending, node ID ascending, fixed integer dimensions/gaps, digest-derived IDs, deterministically sorted arrays. Active overlays are visibly separated. No Canvas importer exists. Manual exploration is allowed only in ignored `authoring/obsidian/scratch/` and must display a non-authoritative warning.

## Proposal workflow

`proposal-new` requires a valid current projection, copies selected complete records, writes exact base hashes, refuses overwrite, and does not edit canonical graphs.

`proposal-build` performs, in order:

1. strict parsing and schema validation;
2. private-data and path/symlink checks;
3. projection/input and per-record stale-base checks;
4. in-memory complete-record operations;
5. duplicate ID/edge detection and existing graph validation;
6. candidate compilation in temporary/in-memory state;
7. existing graph regressions plus proposal tests using the existing JSON case contract;
8. complete semantic diff, regression coverage, and provenance impact;
9. reuse of existing behavioral decision-card machinery;
10. deterministic output only below `authoring/.build/<proposal-id>/`.

No canonical graph is modified. `proposal-check` rebuilds independently and byte-compares all outputs.

## Semantic diff and regression policy

Every editable graph field has an explicit classification. Add/remove, graph membership, title, kind, tier, priority, activation, source refs, authority, recommendations, avoid, success signals, defer/block, required nuance, forbidden overclaims, default question, and edge topology are reviewed or substantive as specified by the task contract. Tags and graph description are reviewed metadata. Contract/revision/generated fields are immutable or generated.

Any canonical difference not in the table fails `UNCLASSIFIED_SEMANTIC_CHANGE`.

Existing JSON regressions remain authoritative. Proposal tests use the existing case contract. Coverage fails closed for changed records without an affected/proposed case, activation/gating without matching and non-matching boundaries, exact-question changes without exact assertions, response-contract changes without realization assertions, and safety changes without a negative case. The tool identifies gaps but does not invent expected therapy behavior.

## Guide Packet integration

Add the narrowest adapter that lets the existing builder/verifier accept a fully validated candidate graph bundle without overwriting canonical graph files. Preserve canonical source HTML, source maps, owner amendments, provenance/certainty, checksums, private-data exclusion, behavioral diff, owner decisions, affected regressions, and monotonic revisions. Do not duplicate verifier logic.

Reconciliation is allowed only from an exact approved packet ID/hash and validated decision artifact, against an unchanged proposal base, on a task branch. Writes are atomic; graphs, compiled bundle, projection, maps, and all gates regenerate. Reconciliation never installs, promotes, or touches `stable`.

## Security and dependency policy

Treat the repository/vault as public. Reject therapy transcripts, user facts, prompts, model output/reasoning, credentials, environment files, host/user identity, absolute home paths, path traversal, symlinks, malformed input, and executable Markdown. Authoring commands make no network/model/install/release calls.

Retain runtime dependencies. Add exact lockfile-pinned development dependencies for Ajv and, only after a Node 24 spike, the official Mermaid parser. No browser, SVG renderer, Obsidian community plugin, RDF stack, LinkML, graph database, or general synchronizer is introduced.

Runtime code must never import `authoring/`, `.base`, `.canvas`, or Obsidian-specific modules.

## Acceptance and rollback

The migration is accepted only when candidate graphs, compiled graphs, canonical source files, owner amendments, source maps, graph regression results, and response realization remain baseline-equivalent; generated artifacts are deterministic and complete; no runtime import reaches authoring; and no stable/install action occurred.

Architecture rollback is a normal revert of authoring code, schemas, views, generated map/canvas, tests, and docs. Canonical graph/source/runtime remains untouched. Failed proposal builds are discarded by removing ignored build output. Approved semantic changes continue to use the existing Guide Packet/runtime rollback path.
