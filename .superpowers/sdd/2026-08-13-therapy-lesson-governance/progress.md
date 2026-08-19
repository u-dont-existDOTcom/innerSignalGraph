# SDD ledger — plan: docs/superpowers/plans/2026-08-13-therapy-lesson-governance.md
Setup: isolated worktree `/home/joel/Téléchargements/innerSignalGraph/.worktrees/therapy-lesson-governance` on branch `therapy-lesson-governance` at `98768da`.
Baseline: `npm test` PASS 250/250, 0 failed, 0 skipped, 2026-08-13.
Pre-flight: no conflicts found between tasks, Global Constraints, or the test-quality rubric.
Task 1: minor (deferred): identifier validation accepts whitespace-only scalar IDs and array members (`scripts/verify-therapy-lessons.mjs:58-59,88-90`).
Task 1: fix round 1/5 (2 addressed, 0 open — approval implementationStatus; required ID arrays; commit `9ca3abd`).
Task 1: complete (commits `98768da..9ca3abd`, review clean; one deferred minor).
Task 2: minor (deferred): temporary fixture maps the correct finding union to the wrong decision IDs (`tests/therapy-lessons.test.mjs:40`).
Task 2: fix round 1/5 (1 addressed, 1 open — state-branch coverage fixed; unanchored field parsing remained; commit `0deefcb`).
Task 2: fix round 2/5 (1 addressed, 0 open — line-anchored non-empty brief fields; commit `e22237d`).
Task 2: complete (commits `9ca3abd..e22237d`, review clean; one deferred minor).
Task 3: minor (deferred): malformed-commit test name is not selected by the prescribed approval-focused pattern (`tests/therapy-lessons.test.mjs:513`).
Task 3: fix round 1/5 (1 addressed, 0 open — ledger-native identity selection; commit `536bb49`).
Task 3: complete (commits `e22237d..536bb49`, review clean; one deferred minor).
Task 4: minor (deferred): Guide impact prose lists identifiers more often than explicit behavioral downstream effects/unchanged areas.
Task 4: minor (deferred): decision 1 calls the generated decision card owner-authored instead of owner-authored source prose represented by the card.
Task 4: fix round 1/5 (3 addressed, 0 open — exact decision briefs/mappings and restored history coverage; commit `6849c0c`).
Task 4: complete (commits `536bb49..6849c0c`, review clean; two deferred minors).
Task 2: minor (resolved downstream): Task 4 corrected the temporary fixture to the exact r02 per-decision finding mapping in commit `bff4503` and added literal mapping enforcement in `6849c0c`.
Task 5: diagnosis: nested workspace sandbox caused opaque test-file failures; isolation-disabled reproduction exposed loopback `EPERM` and blank nested-child stdout. Unchanged unsandboxed `npm run verify` passed through final VERDICT with 326/326 tests.
Task 5: minor (deferred until integration): the plan expects local `stable` to contain governance commits, while the reviewed work is still isolated on `therapy-lesson-governance`.
Task 5: complete (commits `6849c0c..f47a0ca`, review clean; generated output restored, origin-to-HEAD diff clean, worktree clean).
Final review: NOT READY — authorization must be bound per packet/card/review; candidate activation must require implemented approval; implementation commits/evidence must be real; malformed markers/whitespace IDs/protocol deletion must fail; affected IDs and r02 provenance/content must be corrected.
Final review: owner decision required — approved design says declined suggestions create no approval entry, while durable enforcement requires an explicit decline receipt. Awaiting choice of receipt location before the single coordinated fix wave.
Final review owner decision: RESOLVED — Joel selected a fourth root ledger, `THERAPY-DECISIONS`, as the append-only source of explicit direct-conversation approve/decline receipts. `APPROVED-THERAPY-LESSONS` is now an approve-only implementation view; technical supersession remains receipt-free and must use a compatible structured replacement link.
Final review architecture amendment: RECORDED — the approved design and implementation plan now describe all four ledgers and the versioned structured owner protocol. The governance-design approval created no therapy-policy receipt; production remains at five blocked r02 suggestions, zero decision receipts, zero approvals, and zero implementations while the coordinated fix wave is in progress.
Final review fix wave: COMPLETE — causal authorization tests were observed RED before implementation, including two-revision historical eligibility, review artifact/card/affected-ID fidelity, typed receipts, immutable history, strict markers/protocol, and real Git implementation evidence. Final focused suite passed 169/169; full repository suite passed 412/412; unchanged unsandboxed `npm run verify` ended `VERDICT PASS`; r01/r02 hashes remained exact. Production remains at five blocked r02 suggestions, zero receipts, zero approvals, and zero implementations.
Final independent audit fix: COMPLETE — six causal tests for five findings were observed RED 0/6, then GREEN 6/6: authoritative packet content now comes from the hashed ZIP, archive-only newer candidates cannot be skipped, the passed-r03 positive fixture contains explicit deterministic repairs, prompt IDs resolve in actual source, candidate history and retained suggestions are bidirectional, and AGENTS has exactly one protocol contract. The same delegated audit returned RESOLVED. Final focused suite passed 175/175; approval pattern 44/44; full repository suite 418/418; unchanged unsandboxed `npm run verify` ended `VERDICT PASS`; production state and r01/r02 hashes remained exact.
