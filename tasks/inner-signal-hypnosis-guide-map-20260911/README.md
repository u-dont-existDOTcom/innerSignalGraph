# Inner Signal hypnosis guide map/graph task

## Outcome
Add a guide-specific source map, executable candidate graph, and generated audit surface for the current Inner Signal r02 self-hypnosis guide, following the established inner-child guide surface pattern without changing the production graph bundle.

## Authority
- Article authority: `u-dont-existDOTcom/joel-articles`, branch `research/hypnosis-bottom-up-six-books-20260910`, `articles/inner-signal/master.html`, SHA-256 `06987f70e7264a5ac72d132e4b8420cf75cda60f33bbb430c83a0146e612adf9`.
- The source map is bound to a deterministic reader-text projection of that exact master; the full article remains canonical in `joel-articles` and is not duplicated here as competing authority.
- InnerSignalGraph production authority remains `data/graph-v1.0.0.json`; this task does not replace it.
- Existing compiled guide graph bundle remains the inner-child/somatic pilot.

## Artifacts
- `guide-graphs/source-maps/inner-signal-hypnosis-guide.json` — hash-bound external source map with 41 source sections.
- `guide-graphs/candidates/inner-signal-hypnosis.graph.json` — 26-node / 35-edge candidate.
- `docs/INNER-SIGNAL-HYPNOSIS-MAP.md` — generated audit surface.
- `scripts/generate-guide-surface-map.mjs` — reusable standalone guide-surface renderer over existing `guide-graph-v1` validation.
- `tests/inner-signal-hypnosis-surface.test.mjs` — validates source refs and proves the committed surface is byte-current with the generator.

## Deliberate boundary
Do not add this candidate to the canonical compiled graph bundle or stable runtime merely because the documentation surface exists. Runtime promotion requires its own semantic/regression/owner-decision path.
