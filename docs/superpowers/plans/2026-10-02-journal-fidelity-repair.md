# Journal fidelity repair

Owner request (2026-10-02): improve calibration recovery on the current branch,
stacked on the Claude lane (PR #117, `76a3e75`). This is an iteration candidate;
leave changes in the working tree for the runner to commit and push.

1. Re-audit the same extraction once when fidelity fails only on unassessed
   references. Use a separate epoch-scoped identity without spending a repair
   cycle, and feed any new findings into the ordinary repairs.
2. After the two ordinary fidelity repairs fail, run one extraction with its
   omission dependency through the existing hardest tier, then audit it fresh.
   Preserve daily-limit pauses, terminal exhaustion and size-refusal accounting.
3. Extend allowlisted, content-free diagnostics with fidelity assessment matrices,
   an in-memory canonical-output comparison boolean, and separate `reaudit` and
   `hardest_fidelity` snapshots. Preserve the existing pass predicate, audit
   scoring and `reference_set_recall_target` of 0.95.
4. Add synthetic mock-port regressions for recovery, failure, disabled hardest
   lane, quotas, refusal/accounting, diagnostic privacy and unchanged epoch-zero
   identities. Update the documentation index/hash and append the final checkpoint.

Validation on Node 24.18.0 with installed lockfile dependencies: the requested
three-file Node test command, `npm run journal:test`, `npm run audit:repository`
and `npm run audit:publication`. Use an owned `TMPDIR` if necessary; record
sandbox failures without changing tests or security controls. Full repository
tests and `npm run verify` belong to push CI under the owner's instruction.

Active guidance: live default-branch Universal `AGENTS.md` and lesson index were
loaded through the GitHub connector. The selected operating-system, lesson
activation, assurance-lane and test-efficiency rules bind this plan to the owner
request: preserve branch/privacy/gate authority, test the actual runtime seam,
measure tests using the canonical observer in `/tmp`, report incomplete evidence,
and finish authorized local work without a commit, push, provider call or release.
The rule graph's activation and outcome dependencies were read. The suggested-fix
lane contains only the already-ledgered claim-integrity owner question; its
existing OPEN disposition remains authoritative.
