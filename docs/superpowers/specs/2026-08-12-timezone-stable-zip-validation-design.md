# Timezone-stable ZIP validation design

Date: 2026-08-12

Target release: Inner Signal v0.14.4

## Goal

Make deterministic package validation independent of the host timezone while retaining the exact historical r01/r02 candidate archives and preventing tests from mutating them.

## Invariants

1. A supplied absolute timestamp is encoded as UTC in every ZIP local and central header.
2. Same ordered entries plus the same absolute timestamp produce the same archive bytes in every timezone.
3. Historical candidate archives are immutable artifacts. Their exact hashes remain:
   - r01: `9395cf2382ce14647d7f14c97268c53094ba822486be72a104e0e24fb0295263`
   - r02: `1c2970fbbe6aa3e132e0bfdcb226b3dab5ee5dccda1fde2b554613f8dff7b023`
4. Rebuild equivalence is semantic: identical member names and member bytes.
5. Archive preservation is physical: the archived ZIP hash must remain exact before and after the full suite.
6. Tests and verification builds write only to temporary directories.

## Regression structure

- A focused ZIP test changes `process.env.TZ` between Lisbon and UTC and requires identical bytes plus a hand-derived UTC DOS time of 19:30.
- The r01 contract test compares rebuilt and preserved ZIP members, then separately checks the preserved archive hash.
- The full package verifier rebuilds r01/r02 in temporary directories, compares member content, and checks archived hashes after `npm test`.
- Release gates run with `TZ=UTC`, reproducing the affected environment directly.

## Non-goals

No guide, graph, therapy, hypnosis, model-routing, owner-decision, candidate-state, or production-policy changes are authorized by this repair.
