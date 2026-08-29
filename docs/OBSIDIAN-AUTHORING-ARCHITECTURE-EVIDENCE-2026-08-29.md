# InnerSignal Obsidian authoring architecture — evidence baseline

Date: 2026-08-29
Repo baseline: `u-dont-existDOTcom/innerSignalGraph`
Main commit inspected: `82b12b20c4a401b5e60999f981292c36fbaa8a53`
Purpose: preserve the repo facts and independent conception needed for a later architecture-design pass. This file does **not** authorize implementation and does not make Obsidian, Mermaid, or any proposed representation authoritative.

## 1. Independent conception snapshot

Before an external existing-work scan constrains the design, preserve the working conception:

- Obsidian is potentially useful as a human conceptual-authoring/workbench layer for InnerSignal.
- Obsidian should not silently replace executable graph authority.
- Existing typed graph JSON, deterministic compiler/planner, Guide Packet provenance/approval machinery, and regression corpus should be reused rather than rebuilt.
- Mermaid should remain a human audit/control surface and should preferably become generated or mechanically checked against canonical graph state wherever feasible.
- A plausible target is: human authoring/proposals in Obsidian -> deterministic validation/export into the existing candidate/Guide Packet lifecycle -> owner decision gate -> compiled graph/runtime -> generated Mermaid audit view.
- This is a conception to test, not a settled architecture. In particular, the canonical-prose seam is unresolved because current Guide Packets are hash-bound to canonical HTML.

## 2. Current authority boundaries

`docs/INNER-CHILD-THERAPY-MAP.md` explicitly declares itself a human-readable Mermaid control surface, not executable or source authority. Its stated authority order is:

1. current owner instructions;
2. `guides/inner-child-guide.txt` for guide body;
3. `guides/owner-amendments.json` for installed owner-approved amendments;
4. `guide-graphs/source-maps/inner-child-guide.json` and `guide-graphs/source-maps/owner-amendments.json` for source mapping;
5. candidate and compiler-produced graph JSON for executable graph state.

The same file warns that a node appearing in the Mermaid map does not make an uncompiled refinement executable.

`GRAPH-REPORT.md` identifies bundle `inner-child-somatic-pilot-2026-08-09-r5`, with compiled graph counts at the inspected baseline:

- inner-child-directed-graph: 19 nodes, 10 edges
- somatic-directed-graph: 14 nodes, 8 edges
- inner-child-somatic-cross-guide: 0 nodes, 10 edges

It states deliberate runtime constraints including routing by function/dose/target/capacity rather than modality label, safety/orientation/stopping/return precedence, source text remaining unchanged while owner additions live separately, and graph ownership of the substantive next question.

## 3. Mermaid is currently documentation-only

The latest inspected `main` commit, `82b12b20...` (2026-08-25), is titled `Add living Mermaid map for inner-child therapy`.

GitHub reports 142 additions, 0 deletions, affecting only:

- `GRAPH-REPORT.md` (+2)
- `docs/INNER-CHILD-THERAPY-MAP.md` (+140)

No runtime/compiler/planner file changed in that commit. The map is therefore intentionally a parallel documentation/control surface today, not a generated executable artifact.

Maintenance wording in the map says material routing/topology/gate/authority/credibility changes must update the map, and graph changes should update it in the same PR. It explicitly says never use the map as evidence that generated graphs were rebuilt or tested.

## 4. Existing graph toolchain — reuse, do not reinvent

`package.json` exposes:

- `graph:compile` -> `src/cli/compile-guide-graphs.mjs`
- `graph:test` -> `src/cli/run-graph-regressions.mjs`
- `guide-packet:*` build/verify/status commands
- full `verify` gate

The only declared runtime dependency is `yaml@2.9.0`. Obsidian should therefore not become a runtime dependency merely to support authoring.

Primary graph implementation files:

- `src/guide-graph/contract.mjs`
- `src/guide-graph/compiler.mjs`
- `src/guide-graph/validate.mjs`
- `src/guide-graph/planner.mjs`
- `src/guide-graph/regressions.mjs`
- `src/guide-graph/source-map.mjs`

Current graph assets:

- `guide-graphs/candidates/inner-child.graph.json`
- `guide-graphs/candidates/somatic.graph.json`
- `guide-graphs/candidates/cross-guide.graph.json`
- `guide-graphs/compiled/inner-child-directed-graph.json`
- `guide-graphs/compiled/somatic-directed-graph.json`
- `guide-graphs/compiled/inner-child-somatic-cross-guide.json`
- `guide-graphs/compiled/bundle.json`

The graph contract already defines a nontrivial ontology. Case variables include safety/orientation/stopping/return, activation/dissociation, adult/witness capacity, love access, protective/escape responses, credibility conflict/evidence, internal-speaker relation, age/agency ambiguity, identity/belonging, intent, memory risk, body capacity, target type, EMDR/advanced-release interest and risk, bypass/readiness, etc.

Graph nodes carry substantially more semantics than the Mermaid diagram displays, including identity/title/kind/tier/priority, activation predicates, source references/authority, recommendations, avoidances, success signals, tags, deferrals/blocks, required nuance, forbidden overclaims, and a graph-owned default/canonical question. The planner deterministically ranks/gates matches and produces selected/deferred/blocked nodes plus canonical next-question and trace information.

Implication: an Obsidian schema should preferentially expose/mirror this existing contract instead of creating a second therapy ontology.

## 5. Regression and realization contracts

`src/guide-graph/regressions.mjs` runs corpus cases against compiled graphs and can assert:

- expected primary route;
- selected include/exclude;
- matched/deferred/blocked nodes;
- exact next question;
- required nuance patterns;
- forbidden-overclaim patterns.

`corpus/graph-cases/` contains the graph-case corpus. `tests/guide-graph.test.mjs` exercises graph compilation/validation/planning/regressions.

Runtime realization is also contract-bound:

- `src/orchestrator/context-builder.mjs` loads guide text and compiled graph bundle.
- `src/orchestrator/response-contract.mjs` treats the deterministic graph question as canonical, prevents the renderer from substituting another final question, and checks material realization of required nodes using exact evidence quotes.
- `src/prompts/realize.mjs` tells the renderer not to redo formulation and to realize the deterministic intervention contract faithfully.

Therefore an authoring UI must not bypass graph validation or directly rewrite renderer behavior as a substitute for changing the graph/source contracts.

## 6. Guide Packet system — likely promotion/transaction boundary

The repository already has a mature owner-gated Guide Packet mechanism. Relevant code:

- `src/guide-packet/contract.mjs`
- `src/guide-packet/source-html.mjs`
- `src/guide-packet/builder.mjs`
- `src/guide-packet/verifier.mjs`
- `src/guide-packet/diff.mjs`
- `src/guide-packet/model-compiler.mjs`
- `src/guide-packet/store.mjs`
- `src/guide-packet/stage-lifecycle.mjs`
- `src/cli/guide-packet.mjs`

Packet format: `inner-signal-guide-packet-v1`, schema v1.

Required packet families include:

- canonical source HTML;
- editor-body text;
- deterministic sections/source maps;
- graph JSON/bundle;
- owner-amendment policy;
- provenance/certainty policy;
- behavioral diff;
- quality findings;
- owner decisions;
- regression cases;
- checksums/manifest.

Verifier responsibilities include packet identity/checksums, deterministic re-derivation of sections/source maps, graph/source freshness, source/provenance support for graph nodes, graph validation, regression execution, behavioral diffing, monotonic revision checks, owner approval state, and private-data exclusion. Model inference is not allowed to silently become owner policy.

`src/guide-packet/diff.mjs` already classifies behavioral changes such as:

- added/removed nodes;
- added/removed edges;
- changed graph-owned questions;
- changed priorities;
- changed defer/block relationships;
- changed recommendations;
- affected regression cases.

It turns substantive differences into owner-decision cards with current/candidate behavior, affected regressions, provenance, recommended disposition, a worst-plausible-failure statement, and required human decision.

This is a strong existing promotion gate that an Obsidian authoring layer should probably feed rather than replace.

## 7. Canonical-prose seam — central unresolved design constraint

This is the most important migration hazard.

Guide Packet canonical prose is HTML, not Markdown. `src/guide-packet/source-html.mjs` expects a complete contenteditable `<div>...</div>`, derives stable section/source maps, and hashes canonical source/editor-body content.

`src/guide/load-guide.mjs` prefers an active Guide Packet's:

- `guides/inner-child/canonical-source.html`
- `guides/somatic/canonical-source.html`

and converts them to text for runtime consumption. Only if no active Guide Packet is present does it fall back to checked-in legacy `.txt` guide paths.

The r02 packet manifest binds guide source/graph hashes and requires approval. It explicitly distinguishes source identity/provenance from empirical truth.

Therefore: **do not assume Obsidian Markdown can become canonical prose by simple conversion.** Markdown<->HTML round-tripping may normalize formatting, alter byte identity, disturb section anchoring, or silently rewrite source prose. A safe architecture must explicitly choose among:

1. Obsidian as read-only/generated prose projection plus editable graph/proposal metadata;
2. Obsidian Markdown as candidate source only, with a deliberately specified deterministic canonicalization/import format and migration;
3. hybrid ownership: canonical guide prose stays HTML/current source family, while Obsidian owns only graph/proposal/decision metadata and links to source sections.

The design pass should decide this with explicit invariants and tests.

## 8. Existing source IDs and stable linking

`guides/source-layout.json` maps human guide headings to stable source IDs such as:

- `IC.BEFORE_DEEP`
- `IC.BORROW_ADULT`
- `IC.NEUTRAL_WITNESS`
- `IC.THREE_FUNCTIONS`
- `IC.PROTECTOR_VISIBLE`
- `IC.GUARDS`
- `IC.GUIDE_LATER`
- `IC.ALTERED_STATES`
- `SOM.PHASE1`
- `SOM.EFT`
- `SOM.BRAINSPOTTING`
- `SOM.EMDR`
- `SOM.JUDGE_HELP`

and PDF source IDs such as `VAGAL.SAFETY.P5`.

These stable IDs are natural anchors for any Obsidian note/frontmatter relationship. Do not use filenames/display labels as the only identity mechanism.

## 9. Owner amendments and provenance

`guides/owner-amendments.json` stores owner-approved extensions separately from canonical source prose. Current inspected entries include early gentle hypnosis, borrowed external love, the bounded best-friend function, early present-focused inner-child work alongside somatic preparation, prep modalities, conditional EMDR sequencing, optional advanced release/bypass audit, and explicit evidence provenance.

The Guide Packet certainty/provenance machinery preserves distinctions among source prose, author experience, community signal, external evidence, provisional mechanism, and product-only operational rules.

Any Obsidian representation must preserve those distinctions rather than flattening all linked notes into equivalent truth/authority.

## 10. Current r02 candidate packet demonstrates the intended gate

`guide-packets/fixtures/r02-candidate/packet/manifest.json` is candidate-only and approval-required.

Its `audit/owner-decisions.json` contains substantive pending cards for route addition, question change, priority change, defer/block changes, with affected regression IDs and worst-plausible-failure descriptions.

This is useful as a reference implementation for how an authoring edit should become a reviewable candidate rather than silently mutate runtime authority.

## 11. Current docs/status caveat

Several repo documents are older than the 2026-08-25 Mermaid work. In particular, `state/CODEX-CURRENT-STATE.md` and model-role prose in architecture/readme material reflect earlier development phases. The later architecture-design pass must separate durable invariants (deterministic authority, owner gates, graph contracts, Guide Packet checks) from historically specific worker/model assignments. Current owner instructions always outrank these older model-role docs.

## 12. What appears absent today

From the inspected current tree:

- no committed Obsidian vault/.obsidian layer;
- no explicit Obsidian import/export tooling;
- no Mermaid-generation script corresponding to `docs/INNER-CHILD-THERAPY-MAP.md`;
- no mechanical map-vs-compiled-graph synchronization check is evident from the file tree or the Aug-25 Mermaid commit.

Treat the last two as opportunities to verify during implementation, not as permission to assume every desired Mermaid node can be derived one-to-one from executable graph topology. The current map intentionally contains an overlay of not-yet-compiled owner refinements.

## 13. Architecture questions the Pro pass must resolve

The Pro pass should not jump directly to code. It should resolve at least:

1. **Obsidian role:** read/write authoring source, generated projection, or hybrid?
2. **Canonical prose:** keep HTML authoritative, introduce deterministic Markdown candidate import, or isolate prose from graph authoring?
3. **Graph note schema:** which existing graph-contract fields become YAML properties, which remain generated/read-only, and how stable IDs are enforced?
4. **Relationships:** how graph edges, defer/block links, source refs, cross-guide links, provenance, and regression references are represented without relying on untyped backlinks.
5. **Canvas:** manual exploratory artifact only vs deterministically generated JSON Canvas; it must not become executable authority unless a formally validated compiler is deliberately introduced.
6. **Mermaid:** generated from compiled/candidate graphs, generated plus overlay file, or manually maintained but mechanically checked? Must preserve distinction between compiled routes and owner-approved/uncompiled overlay.
7. **Promotion path:** exact deterministic command from Obsidian edits/proposals to candidate graph/Guide Packet, behavioral diff, owner-decision cards, compile/test/install.
8. **Round-trip policy:** whether generated files can be edited, where conflicts are resolved, and how drift is detected.
9. **Git workflow:** which vault files are committed, whether `.obsidian` settings/plugins are excluded, and whether generated artifacts are committed or CI-produced.
10. **Safety/provenance:** prevent authoring convenience from bypassing authority, source hashes, owner approval, regression gates, or evidence-status labels.
11. **Migration:** bootstrap from current graph/source data without changing current runtime semantics.
12. **Acceptance:** prove zero behavioral change for a projection-only migration; prove exact intended behavioral diffs for subsequent authored changes.

## 14. Existing-work scan required before final bespoke design

Before substantial bespoke implementation, the Pro pass should perform a bounded scan of the strongest relevant existing work, preserving Section 1 as the independent conception snapshot. At minimum inspect:

- Obsidian Properties/frontmatter conventions and validation constraints;
- Obsidian Bases for structured views;
- JSON Canvas specification/open format and mature tooling;
- Mermaid CLI/API generation and deterministic rendering/source-generation options;
- mature Markdown/frontmatter schema validation approaches;
- only as needed, established typed property-graph/knowledge-graph representations to determine whether the existing `guide-graph-v1` contract should simply be projected rather than replaced.

Classify each candidate as already solved, partially reusable, incompatible, or unresolved. Explicitly choose reuse/adaptation/composition/invention/experiment for each layer. Do not invent a parallel graph system merely because Obsidian exposes links.

## 15. Likely non-goals

Unless the Pro pass finds a compelling reason otherwise:

- no Obsidian runtime dependency;
- no direct runtime reads from `.canvas` or arbitrary backlinks;
- no replacement of `guide-graph-v1` merely for visual convenience;
- no bypass of Guide Packet approval/provenance/regression gates;
- no silent canonical-prose conversion;
- no making Mermaid authoritative;
- no therapy-policy changes as part of the tooling migration;
- no semantic behavior change in the initial architecture migration.

## 16. Recommended Pro deliverable

The next pass should produce a worker-ready implementation instruction set containing:

- selected architecture and rejected alternatives with reasons;
- source-of-truth matrix by artifact/field;
- directory/file layout;
- Obsidian note/frontmatter schemas with examples;
- conversion/generation pipeline;
- Mermaid/Canvas treatment;
- Guide Packet integration seam;
- migration strategy from current main;
- drift/conflict/error behavior;
- tests/CI and acceptance gates;
- backward compatibility/rollback;
- staged implementation sequence with exact stop conditions;
- explicit instruction not to change therapy semantics during the architecture migration;
- documentation updates needed to remove stale architecture claims.

That worker plan should be benchmarked against the current simplest baseline: keep graph JSON authoritative, keep Guide Packets as the guarded promotion mechanism, and add only the minimal Obsidian projection/import and Mermaid generation/checking needed to improve human editing.