# Inner Signal runtime v0.14.4 implementation report

Date: 2026-08-12

Repository: `u-dont-existDOTcom/innerSignalGraph`

## Result

v0.14.4 repairs the timezone-dependent install validation failure from v0.14.3. The affected run failed safely at 191/192 tests and restored the prior runtime. No installed policy or candidate decision was changed.

## Evidence and root cause

The UTC rebuild had SHA-256 `d93fda96d9a2fcc7fd81d371055fe00aa64efa7afd223704c959dbdbd4388738`; the preserved r01 archive had SHA-256 `9395cf2382ce14647d7f14c97268c53094ba822486be72a104e0e24fb0295263`. Both archives had the same length, the same 25 members, and no changed member content.

The low-level ZIP writer used local-time getters for an absolute timestamp. The preserved fixture had been built under Lisbon summer time, while the affected Zorin validation used UTC. A separate test-isolation defect built directly into the immutable r01 fixture directory.

## Changes

- ZIP DOS timestamps now use UTC date/time getters.
- A focused regression requires identical ZIP bytes under Lisbon and UTC and checks the hand-derived UTC time fields.
- The r01 rebuild regression compares packet members rather than legacy container metadata.
- Candidate build tests use temporary output directories.
- Package verification compares rebuilt member content, retains exact r01/r02 archive hashes, and rechecks both hashes after all tests.
- Versioned installer and release architecture are stored in the repository.

## Verification

- UTC source suite: 193/193 passed, 0 failed.
- Production graph regressions: 12/12 passed.
- Preserved r01 packet regressions: 4/4 passed.
- Corrected r02 packet regressions: 5/5 passed.
- Full package verifier: passed under `TZ=UTC`.
- Focused r02 preservation suite: passed under UTC, Africa/Dakar, Europe/Lisbon, America/New_York, and Asia/Kolkata.
- Clean installer: passed under `TZ=UTC`.
- Two consecutive dirty upgrades: passed under `TZ=UTC`.
- Nineteen seeded state files remained byte-for-byte identical across both upgrades.
- Exact staged candidate hashes after both upgrades:
  - r01: `9395cf2382ce14647d7f14c97268c53094ba822486be72a104e0e24fb0295263`
  - r02: `1c2970fbbe6aa3e132e0bfdcb226b3dab5ee5dccda1fde2b554613f8dff7b023`

## Non-regression boundary

No guide prose, graph routing, therapy behavior, hypnosis contract, model role, owner decision, or candidate status changed. Production remains `inner-child-somatic-pilot-2026-08-09-r5`; r02 remains staged and uninstalled.

The build environment did not make subscription-backed Claude or Codex calls. Existing exact-model entitlement probes still run locally before live model work.
