# Current hypnosis synchronization checkpoint

Task branch: `task/hypnosis-ic-sync-r03-20260911`.

Start with `IMPLEMENTATION.md`, then `reference/hypnosis/source-binding.json`, the v2 candidate graph, and `docs/INNER-SIGNAL-HYPNOSIS-MAP.md`. The map distinguishes executed transitions/guards from conceptual relationships. All guide/companion/research text is in the read-only `reference/hypnosis/knowledge.json` with separate provenance.

Run:

```sh
node --test tests/hypnosis-guide-session.test.mjs tests/inner-signal-hypnosis-surface.test.mjs
npm run audit:repository
npm run verify
```

The repository-supported runtime is Node 24.18.0. The graph/library/controller are candidate development, not deployed or clinically validated. Existing inner-child/somatic and production/stable policies remain unchanged. Article source authority is still joel-articles, not this index.

To reproduce the source index, run `scripts/build-hypnosis-knowledge.py --help` and supply the exact article, companion, reference files and canonical parser named by source-binding.json. It fails on input hash drift. To regenerate the inspection map:

```sh
node scripts/generate-guide-surface-map.mjs \
 --graph guide-graphs/candidates/inner-signal-hypnosis.graph.json \
 --source-map guide-graphs/source-maps/inner-signal-hypnosis-guide.json \
 --library reference/hypnosis/knowledge.json \
 --out docs/INNER-SIGNAL-HYPNOSIS-MAP.md
```

Independent semantic review remains pending. Do not treat schema success, synthetic tests, data availability or a PR merge as runtime promotion or proof that an app can monitor a body.
