# Inner Child guide reader-facing repair — 2026-10-04

Status: task-branch candidate.

## Owner correction

The public Inner Child guide is a reader-facing article, not an InnerSignal implementation prompt. The r3 article accidentally included operator-facing language (including an explicit “InnerSignal should…” sentence) inside reader prose.

## Repair

r4 changes exactly two visible paragraphs from r3:
- rewrites the orientation/identity caution directly to the reader and removes the explicit InnerSignal/operator instruction;
- replaces “don’t make the therapist…” with the reader-facing “don’t make somebody else…”.

No executable graph/amendment semantics are changed by this repair. Those remain graph-owned.

## Preservation

- r3 remains in source history.
- r4 raw Substack capture SHA-256: `31991658554ec1624f0ba363bf92b5062d72058ddac5b404ade23a58cbb20f77`
- r4 text projection SHA-256: `1ae4140f0c6acb900ff18ef961ca2e7a136c0812678e88e64f02dc4268ca08cb`
- Native-object inventory: 10/10 signatures identical to the exact Oct 3 owner baseline (4 images, 2 native videos, 2 Substack video-post embeds, 2 YouTube embeds).

## Validation

- graph compile/regressions: PASS, 45/45
- authoring project/validate/check/maps-check: PASS
- affected source/graph/projection/protocol/fidelity/benchmark suite: PASS, 59/59
- therapy lessons: PASS 5/5
- git diff --check: PASS
