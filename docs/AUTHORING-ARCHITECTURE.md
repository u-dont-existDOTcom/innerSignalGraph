# Obsidian authoring architecture

## Outcome

Inner Signal has a development-only Obsidian workbench without making Markdown, Canvas, Mermaid, links, or Obsidian metadata authoritative. Existing candidate graph JSON remains graph authority; current guide files, source maps, and owner amendments remain source/provenance authority; existing regressions and the Guide Packet lifecycle remain the behavioral and approval boundary.

The architecture is:

```text
canonical graph/source authority
→ deterministic read-only Obsidian projection
→ hash-bound full-record proposal
→ in-memory validation, compilation, regressions, semantic diff, and Guide Packet
→ exact owner decisions
→ approved packet reconciliation on a task branch
→ regenerated graph/projection/map artifacts
```

No authoring command installs a Guide Packet or writes to `stable`.

## Authority boundaries

| Concern | Authority | Generated or proposal-only view |
| --- | --- | --- |
| Candidate graph | `guide-graphs/candidates/*.graph.json` | Current notes, candidate maps, Canvas |
| Compiled graph | deterministic graph compiler | Bundle copies in proposal builds and packets |
| Guide/source content | current files under `guides/` | Read-only source-section notes |
| Owner amendments | `guides/owner-amendments.json` | Read-only governance notes |
| Behavioral acceptance | `corpus/graph-cases/*.json` and existing realization tests | Regression index and impact reports |
| Semantic approval | Guide Packet owner-decision artifact | Proposal decision preview |
| Documentation-only concepts | schema-validated overlay registry | Dashed Mermaid/Canvas overlay layer |
| Visual layout | generated Canvas | Obsidian display only |

Canonical guide text is never round-tripped through Markdown. The current source family used by the existing runtime remains byte-authoritative.

## Current projection

`npm run authoring:project` reads the current authoritative files and writes `authoring/obsidian/current/` plus the generated Mermaid audit map. Every generated note records exact base hashes. The projection contains nodes, edges, source sections, regressions, amendments, map-owner decisions, overlays, and a whole-bundle Canvas.

`npm run authoring:check` regenerates in memory and byte-compares the committed projection. It reports missing, unexpected, or changed files and never repairs drift. `npm run authoring:validate` validates schemas, source resolution, graph compilation, regressions, overlays, Bases, Canvas, and generated Mermaid structure.

The projection is deterministic: there are no timestamps, network calls, model calls, Obsidian dependencies, or imports from Canvas/Mermaid into graph code.

## Proposal workflow

Create a proposal from exact current records:

```bash
npm run authoring:proposal:new -- \
  --id credibility-routing-r1 \
  --node IC.CREDIBILITY_REPAIR \
  --regression G001
```

Edit only the new directory under `authoring/obsidian/proposals/<id>/`. `base-authority.json` preserves every exact input path/hash so stale-base reports can name old and new hashes; do not edit it. Node notes are complete records, not field patches. Edge relation or endpoint changes are represented as remove plus add. Proposed cases stay in the existing JSON graph-case language under `tests/`.

Build and verify:

```bash
npm run authoring:proposal:build -- --id credibility-routing-r1
npm run authoring:proposal:check -- --id credibility-routing-r1
```

Build output exists only under ignored `authoring/.build/<id>/` and includes:

- exact candidate graph members and compiled bundle;
- complete field-by-field semantic diff;
- owner-decision cards;
- proposal narrative evidence and its hash;
- regression and provenance impact reports;
- candidate Mermaid and Canvas views;
- a repository-source Guide Packet verified by the existing verifier;
- a deterministic receipt binding every artifact.

A stale projection hash, changed graph hash, changed record hash, unsafe filename/path, symlink, private content, unresolved source, unknown field, invalid graph, failed regression, or missing coverage stops the build before canonical writes.

## Concrete owner decisions

Every graph field is classified. Unknown future fields fail with `UNCLASSIFIED_SEMANTIC_CHANGE`; generated and immutable fields cannot be proposed.

Every substantive decision card contains:

- the exact current value;
- the exact candidate value;
- the field classification and behavioral effect;
- explicit pros of approving the new value;
- explicit cons/risks of approving the new value (never a con of the old value);
- affected regressions and provenance;
- the worst plausible failure.

Titles, descriptions, and tags are diffed rather than silently ignored. Activation, gating, safety, response, provenance, topology, and membership changes require owner review. Approval remains in `guide-owner-decisions-v1`; Obsidian does not create a second approval store and cannot infer approval.

## Regression coverage

Existing regression JSON remains canonical. A proposal may replace or add a case using the same contract. The build fails when a changed node or edge lacks an affected declared case, except for explicitly documentation-only fields.

Additional requirements are enforced:

- activation and defer/block changes need matching and non-matching boundary cases;
- default-question changes need an exact `nextQuestion` assertion;
- required-nuance and forbidden-overclaim changes need realization assertions;
- safety changes need an explicit negative case.

The tool reports gaps; it never invents expected therapy behavior.

## Guide Packet adapter and reconciliation

The proposal builder creates a `repository-current-v1` source-mode packet within the existing Guide Packet v1 envelope. It includes exact current source bytes and source maps, owner amendments, source layout, provenance/certainty policy, standalone compiled graph members, exact candidate graph members, regressions, quality audit, semantic diff, proposal evidence, and pending owner decisions.

The existing verifier remains authoritative. It now also proves:

- every bundle graph equals its standalone graph member;
- every candidate member hash matches the manifest and its raw graph compiles to the corresponding bundle member;
- repository source maps are exactly derivable from included source bytes/layout/amendments and equal the bundle source maps;
- proposal evidence, semantic diff, and decision cards agree;
- approval is consistent across the manifest, every card, `allApproved`, and the approval hash.

A manifest saying `approved` is insufficient.

After all cards are approved through the existing owner-decision lifecycle, reconcile with the exact approved packet and its SHA-256:

```bash
npm run authoring:proposal:reconcile -- \
  --id credibility-routing-r1 \
  --packet-id authoring-credibility-routing-r1 \
  --packet authoring/.build/credibility-routing-r1/packet/approved.zip \
  --sha256 <exact-lowercase-sha256>
```

Reconciliation is forbidden on `main`, `master`, `stable`, release branches, or detached HEAD. It verifies the packet, approval, proposal/base identity, candidate member hashes, compilation, and regressions before writing. It then atomically writes the exact approved candidate members, recompiles, regenerates projection/maps, reruns regressions, runs the complete `npm run verify` package gate, and atomically records a reconciliation receipt. A snapshot restores every touched path if a post-write gate fails. It never installs or changes stable policy.

## Map migration and owner decisions

`authoring/migration/map-classification.json` preserves the complete old living-map inventory: 46 nodes, 57 manual arrows, six layout groups, eleven operating bullets, and eleven overlay rows. The 57 manual arrows are retired as executable topology; generated maps show only exact compiled edges and explicit documentation-overlay relationships.

`authoring/migration/owner-map-resolution-2026-08-29.json` records the owner’s 15 decisions. Active overlay wording includes the qualified activation conclusion rule, dynamic usefulness-based parts modeling, bounded repair promises, critical non-punitive review, non-optional common humanity and mutual peer healing without minimizing individual trauma, and flexible closure. The old “forgiveness only when useful” wording is retired; the existing non-conflation of forgiveness with weakened boundaries/accountability remains reconciled. Review and common-humanity items are marked as required future guide proposals but are not silently compiled by this migration.

## Security and portability

The parser accepts a restricted YAML subset, rejects duplicate keys, aliases, anchors, custom tags, merge keys, multiple documents, CRLF/BOM ambiguity, and non-canonical implicit scalar spellings. Ajv strict schemas reject unknown fields without coercion. Payload JSON has one explicit marker pair and no frontmatter overlap.

All IDs and paths are traversal-checked and symlink-safe. Node filenames are exact IDs and unsafe names are rejected rather than slugged. Edge identity is the full SHA-256 of graph ID, from ID, relation, and to ID; filenames use a checked 16-hex prefix. Public authoring content rejects credential and transcript patterns.

## Deliberate limitations

- Obsidian is optional and never a CI/runtime dependency.
- No `.obsidian/` state or community plugin is required.
- Canvas and Mermaid have no importer.
- The Mermaid checker validates the small generator-owned flowchart subset hermetically; it is not a general Mermaid parser.
- Markdown-canonical guide prose, RDF/SHACL, LinkML, graph databases, and background bidirectional synchronization remain out of scope.
- Overlay editing remains an explicit registry workflow; node/edge proposals cannot silently claim an overlay change.
