# Journal calibration diagnostics (2026-10-02)

## Goal

An unresolved extraction must leave enough content-free evidence to diagnose whether three repair cycles converged, including the hardest attempt when it ran. The failure summary and `status` must expose the same counts without disclosing journal or model prose.

## Implementation

- Snapshot each extraction cycle and each fidelity repair cycle, including the initial fidelity audit. Count extraction proposals, context requests and coverage dispositions; count omission assessments in a schema-derived outcome × finding-type matrix, critical assessments, unassessed IDs and proposed repairs. The review schema has no repair type or kind enum, so only the proposed repair count is recorded. Fidelity snapshots retain status, critical misses, qualifier errors, unassessed references, the reference total and preserved/omitted/distorted/unassessed counts, whether the reference recall target was met (`null` when there is no reference set), and whether the cycle passed calibration overall; a skipped or exhausted audit is `null`. Every fidelity snapshot carries a `blocker_code`, `null` unless a fixed blocker stopped the cycle.
- Count findings as assessments whose outcome is not `preserved` or finding type is not `none`, plus unassessed IDs. `findings_per_cycle` is `null` when omission review did not run or binding failed; a completed review with no findings is `0`. Record a separate hardest snapshot when attempted. Capture fixed blocker and binding codes before a failed cycle continues.
- Validate every diagnostic key and string value against fixed keys, role-schema enums and enumerated mechanical codes. If validation fails, retain only `{ invalid: true }` so the unresolved unit can still be saved. Keep successful unit records free of diagnostics.
- Attach diagnostics to source-only unresolved unit records, the calibration failure state, the prior-epoch recalibration history and the run/status summary. Resume an older immutable unit record that differs only by missing diagnostics without rewriting it; preserve missing diagnostics in legacy recovery. Preserve epoch-zero work and object identities.

## Verification

Use synthetic outputs and a sentinel in model free-text, ID, time and quoted-anchor fields. Prove extraction and fidelity cycle counts, the `null`/zero distinction, hardest and blocker snapshots, validator fallback, legacy resume, omission of the sentinel from diagnostics/state/summary/status, absence of diagnostics on success, and unchanged epoch-zero identities. Run `npm run journal:test`, `npm run audit:repository`, and `npm run audit:publication` on Node 24.18.0. Run affected server-free test files locally; CI owns the complete suite and `npm run verify` after the runner pushes.
