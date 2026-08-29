# Obsidian authoring and mapping implementation report — 2026-08-29

## Result

The graph-authoritative Obsidian authoring architecture is implemented on task branch `codex/obsidian-authoring-architecture-20260829` in the isolated branch-bound worktree `obsidian-authoring-architecture-2026-08-29`.

It adds deterministic read-only projection, full-record hash-bound proposals, complete semantic decisions with explicit approval pros/cons, regression/provenance gates, a repository-source Guide Packet adapter, task-branch-only approved reconciliation, generated Mermaid, generated Canvas, and the owner-approved documentation-overlay registry.

The migration does not change candidate graphs, compiled graphs, canonical guide/source bytes, owner amendments, source maps, regression cases, installed Guide Packets, runtime routing, release policy, or `stable`. Owner-approved map concepts remain explicitly uncompiled until separate graph or guide proposals pass their own gates.

## Baseline and execution boundary

- Starting `main`: `82b12b20c4a401b5e60999f981292c36fbaa8a53`
- Starting tree: `8a25d56d91b84946762418d0aead0c8d7670588e`
- Evidence commit preserved: `060a9e17d7a7094ffad96741e3c37e8ca2866cd7`
- Node/npm: 24.18.0 / 11.16.0
- Baseline graph suite: 12/12
- Baseline complete tests: 387/387
- Baseline package verification: PASS
- Baseline publication audit: 147,838 records, zero findings
- Baseline bundle: 33 nodes, 28 edges, 62 source sections, 9 owner amendments
- Baseline compiled-bundle SHA-256: `c8a88497711596af5fc7157ff0c5028607df0be6ec797d832598980b5cf06400`
- Baseline living-map SHA-256: `4a349e8bea59d4be01282a50750b36a8838643fd24c4068345db300587777369`

The unrelated local `stable` checkout and its pre-existing untracked file were not read as development authority, modified, installed, or advanced.

## Exact implementation inventory

The exact generated projection inventory is machine-bound in `authoring/obsidian/current/manifest.json`: 177 listed generated members plus the manifest itself, for 178 current-projection files. The listed members are 33 nodes, 28 edges, 62 source sections, 12 regressions, 9 amendments, 15 owner decisions, 17 overlay views, and one Canvas.

The implementation adds these exact authored surfaces:

- `src/authoring/`: `bases.mjs`, `canonical-json.mjs`, `canvas-generator.mjs`, `contract.mjs`, `frontmatter.mjs`, `map-files.mjs`, `mermaid-generator.mjs`, `note-parser.mjs`, `note-renderer.mjs`, `overlay.mjs`, `private-data-boundary.mjs`, `projection-check.mjs`, `projection.mjs`, `proposal-builder.mjs`, `proposal-packet.mjs`, `proposal.mjs`, `reconcile.mjs`, and `semantic-diff-policy.mjs`.
- `src/guide-graph/`: complete semantic policy/diff modules; the existing compiler/regression APIs gain read-only candidate-bundle/case overrides.
- `authoring/schemas/`: projection manifest, current/proposal node and edge, node payload, index note, proposal manifest/receipt, overlay, and Canvas-subset schemas.
- `authoring/obsidian/`: HOME/setup guidance, six Bases, committed current projection, proposal/scratch boundaries.
- `authoring/migration/`: complete old-map classification and the 15-decision owner resolution.
- `authoring/overlays/`: inner-child and somatic overlay registries.
- `tests/`: the nine `authoring-*.test.mjs` suites; existing Guide Packet tests are extended.
- `docs/`: accepted design, implementation plan, architecture guide, baseline evidence/JSON, implementation report, generated living map, and index entries.
- Integration: authoring CLI/package scripts, task preflight/acceptance and recovery state, repository audit bindings, package verification, root/agent routing, and ignore rules.

## Dependencies and compatibility adaptation

- Retained runtime dependency: exact `yaml@2.9.0`.
- Added development dependency: exact `ajv@8.20.0`, using Draft 2020-12 strict schemas with no coercion, defaults, unknown-key removal, or input mutation.
- Obsidian remains optional and is not a runtime or CI dependency.
- The official Mermaid-parser Node 24 spike did not yield a retainable hermetic parser within the no-browser dependency boundary. V1 therefore uses a strict generator-owned validator for its small emitted flowchart subset, followed by deterministic byte, node, edge, overlay, identifier, and injection checks. This is not presented as a general Mermaid parser; SVG/browser rendering remains out of scope.

## Proposal and approval behavior

`proposal-new` requires an exact clean current projection and copies complete records with graph, record, and projection-input hashes. `proposal-build` applies full-record operations only in memory, compiles and regresses the candidate, produces exact maps/Canvas/Guide Packet/audits/receipt only below ignored `.build`, and never writes graph authority. `proposal-check` independently rebuilds and byte-compares the entire output.

Every substantive decision card contains the exact current value, exact proposed value, classification, behavioral effect, affected regressions, provenance, worst plausible failure, and:

- `pros`: benefits of approving the proposed new value;
- `cons`: risks or drawbacks of approving the proposed new value.

The cons are never criticisms of the old value. Approval is never inferred from prose, Obsidian status, a manifest flag, or model output.

## Semantic-diff field coverage

| Surface | Explicit treatment |
| --- | --- |
| Bundle contract/version/source manifest/source maps/stats | immutable or generated-prohibited; unknown fields and non-derived stats fail closed |
| Graph contract/ID/version/bundle/source revision | immutable or generated-prohibited |
| Graph guide/description/membership | provenance review, reviewed metadata, or substantive membership decision |
| Node ID/add/remove/membership | direct ID edit prohibited; add/remove and graph movement substantive |
| Title/kind | reviewed-substantive or structural decision |
| Tier/priority/activation | routing decision; activation also safety coverage |
| Source refs/authority | provenance-policy decision; unresolved refs fail |
| Recommendations/avoid/success signals | response, safety, or evaluation decision |
| Tags | reviewed metadata, never silently ignored |
| Defer/block | gating decision; block includes safety coverage |
| Required nuance/forbidden overclaims | response-semantics/safety decision plus realization coverage |
| Default question | routing decision plus exact-question coverage |
| Edge tuple/add/remove | topology decision; relation/endpoint change is remove plus add |
| Any future field | `UNCLASSIFIED_SEMANTIC_CHANGE` |

## Guide Packet and reconciliation evidence

The `repository-current-v1` adapter preserves exact included source bytes, deterministically re-derived source maps, owner amendments, source layout, provenance/certainty, standalone compiled graphs, raw candidate graphs, regressions, quality audit, proposal evidence, semantic diff, and owner decisions in the existing Guide Packet v1 envelope.

Verifier hardening proves:

- compiled bundle members equal standalone members;
- raw candidate members hash correctly and compile to their corresponding bundle members;
- included repository source maps derive exactly from included source bytes/layout/amendments and equal bundle source maps;
- proposal evidence, semantic diff, and decision cards agree exactly;
- malformed/unclassified packets are rejected as errors rather than throwing out of verification;
- approval agrees across manifest, every decision card, `allApproved`, and the approval hash.

Reconciliation requires the exact approved packet bytes and SHA-256, an unchanged base, and a non-protected task branch. It validates/compiles/regresses before writes, atomically writes exact approved candidate members, regenerates compiled/projection/map artifacts, runs the complete package gate, and restores a snapshot on any post-write failure. It does not install or touch `stable`.

## Owner map resolution

All 15 owner decisions are recorded in `authoring/migration/owner-map-resolution-2026-08-29.json`. The exact qualifications include:

- safe tentative conclusions may be made while activated and must be revisited when calm;
- parts models are used only while useful, without model-driven over-separation or over-integration, and may change moment by moment;
- review is critical and non-punitive;
- common humanity and connection with healing peers are central rather than optional, without minimizing individual trauma;
- forgiveness is not conditioned on usefulness and never weakens accountability, boundaries, consequences, distance, or no-contact;
- closure is deliberate when possible, not a universal fixed ritual.

D09 and D10 are required future guide proposals. This architecture migration records that requirement but does not silently rewrite guide prose or compiled behavior. All 57 old manual Mermaid arrows are retired as executable topology and retained in the migration ledger.

## Determinism, round trips, and map evidence

- Projection input SHA-256: `4481c17e9ee7ea48f2127b7e58a33ef8c25abb06dbb1bf2cf17f9f615da0794e`
- Generated living-map SHA-256: `768e2203d2dcb4adbda14c685756080598d78ce10f4210eb608ae6bb526f9640`
- Generated Canvas SHA-256: `83e40ab802c2a4da8984a25c0e26962c8f92e7e2e367a010ddf3264faf16bd57`
- Projection manifest SHA-256: `783ecafe5766d264aa05e9b0f0b585fefe5875f2bdcb339577aa871d844b08f1`

Two independent projections are byte-identical. A no-change proposal returns the exact graph; an approved synthetic changed record is reprojected with the same contract-owned value. Source-only fields and untouched graph members remain exact. Current-note drift, stale inputs, record drift, path traversal, symlinks, ambiguous YAML, private content, and incomplete semantic coverage fail before canonical writes.

The migration ledger accounts for 46 old map nodes, 57 old arrows, six layout groups, eleven operating bullets, and eleven overlay rows. Generated Mermaid/Canvas checks account for all 33 compiled nodes, 28 compiled edges, and all active overlays while visibly separating uncompiled material.

## Final verification

- Complete authoring tests: 52/52
- Complete repository tests: 441/441
- Graph regressions: 12/12, identical to baseline
- `authoring:validate`: PASS, 178 generated files, six Bases, one map
- `authoring:check`: PASS at the exact projection input hash
- `authoring:maps:check`: PASS, including Canvas
- Repository audit: PASS with zero errors and the single pre-existing installed-GitHub-App readback warning
- Task acceptance: `READY_FOR_PROTECTED_MERGE`, zero findings
- Complete `npm run verify`: final `VERDICT PASS`
- Runtime import scan: no runtime source imports `src/authoring`; the only bridge is the dedicated development CLI

Final candidate graph, compiled graph/bundle, source-map, guide/source, owner-amendment, and regression paths have zero diff from the baseline commit. The compiled bundle remains `c8a88497711596af5fc7157ff0c5028607df0be6ec797d832598980b5cf06400`.

## Limitations and next safe action

- Overlay editing remains a separate explicit registry workflow; node/edge proposals cannot claim overlay changes.
- There is no automatic semantic rebase or three-way merge.
- Canonical prose remains in the existing source workflow; Markdown round-tripping is intentionally absent.
- Canvas and Mermaid have no importer; the Mermaid validator is intentionally limited to generator-owned syntax.
- D09/D10 still need owner-gated guide proposals before they enter guide prose or executable behavior.
- Independent review must occur on the exact protected pull-request head before merge; this report does not claim that review in advance.

The exact next safe action is to commit the verified branch, open the protected pull request to `main`, and wait for exact-head required checks and review. Do not merge, install, promote, or change `stable` as part of this task.
