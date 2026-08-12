# Inner Signal v0.14.4 — Timezone-Stable ZIP Validation

## Incident

The v0.14.3 installer rolled back safely after 191 of 192 tests passed. The remaining test rebuilt the r01 Guide Packet to SHA-256 `d93fda96d9a2fcc7fd81d371055fe00aa64efa7afd223704c959dbdbd4388738`, then compared it with the preserved r01 archive at `9395cf2382ce14647d7f14c97268c53094ba822486be72a104e0e24fb0295263`.

The two ZIPs had the same length, the same 25 member names, and byte-identical member contents. Only local and central ZIP-header timestamp fields differed.

## Root cause

`createStoredZip` accepted an absolute JavaScript `Date` but encoded DOS date/time fields with local-time getters. The original fixture was built under Lisbon summer time; the affected Zorin run used UTC. One validation test also used the real r01 fixture directory as its build output, so running tests could rewrite an immutable candidate archive.

## Corrected contract

- ZIP timestamps are encoded with UTC date/time fields.
- Packet rebuilds are compared by member name and member bytes when the question is contract equivalence.
- The preserved r01 and r02 archives retain exact hash checks when the question is archive immutability.
- Test builds use isolated temporary output directories.
- Full package verification rechecks both archived hashes after all tests.

## Policy boundary

This is an orchestration and reproducibility repair only. It does not change guide prose, therapy graphs, routing, owner decisions, hypnosis contracts, the staged r01/r02 candidates, or installed production bundle `inner-child-somatic-pilot-2026-08-09-r5`.
