# Journal calibration diagnostics (2026-10-02)

## Goal

An unresolved extraction must leave enough content-free evidence to diagnose whether three repair cycles converged, including the hardest attempt when it ran. The failure summary and `status` must expose the same counts without disclosing journal or model prose.

## Implementation

- Snapshot each completed extraction cycle before preparing the next repair request. Count extraction proposals, context requests and coverage dispositions; count omission assessments by schema outcome and finding type, unassessed IDs and proposed repairs. The review schema has no repair type or kind enum, so only the proposed repair count is recorded.
- Count findings as assessments whose outcome is not `preserved` or finding type is not `none`, plus unassessed IDs. Keep cycle numbers and `findings_per_cycle` in the same diagnostic object. Record a separate hardest snapshot when attempted.
- Validate every diagnostic key and string value against fixed keys, role-schema enums and enumerated mechanical binding codes. Refuse an unexpected string before writing a unit record or calibration failure. Keep successful unit records free of diagnostics.
- Attach diagnostics to source-only unresolved unit records, the calibration failure state, and the run/status summary. Preserve epoch-zero work and object identities and the existing recalibration behavior.

## Verification

Use synthetic outputs and a sentinel in model free-text fields. Prove three cycle counts, hardest counts, omission of the sentinel from diagnostics/state/summary/status, absence of diagnostics on success, and unchanged epoch-zero identities. Run `npm run journal:test`, `npm run audit:repository`, and `npm run audit:publication` on Node 24.18.0. Run affected server-free test files locally; CI owns the complete suite and `npm run verify` after the runner pushes.
