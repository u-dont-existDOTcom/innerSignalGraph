# Map/literature implementation checkpoint

Updated 2026-09-07. R1-R6 are owner-authorized and implemented in draft PR #46. Implementation commit: `8e393a74b047d6e714f9f4e506c1ce45c1b8c5ce`; baseline: `77bd76e2b8a5252dedfcaa502673dd877b1336ae`.

Read `CLOSEOUT.md` for exact implemented behavior, verification, source manifest and the remaining execution boundary. `IMPLEMENTATION-RECEIPT.md` retains the change history. Source mapping is in `docs/research/THERAPEUTIC-SOURCES.md` and `docs/superpowers/specs/2026-09-06-map-literature-reconciliation.md`. Do not repeat the broad book review or recreate existing goals, borrowed adulthood or history infrastructure.

Local and checksum-matched hosted preparation both passed the complete Node24.18.0 package: 712/712 automated tests, 29/29 graph regressions, authoring and package/smoke gates. Candidate totals: 53 nodes,70 edges,80 source sections,26 amendments,292 generated files. The normal exact-head checks on the native cleanup/closeout commit are recorded in the PR after actual completion, not inferred from the preparation run.

Guide-fidelity runner: `tasks/guide-fidelity-20260906/PROTOCOL.md`. Twelve original development scenarios,23 user turns,three source/graph conditions,two independent graders and six grader calibration controls. The three-arm smoke and resume were checked with fake transport, not live model answers. Frozen companion v1/v2 evaluation inputs remain unchanged.

Actual live preflight with --live --smoke returned BLOCKED_CONFIGURATION. Zero live calls,zero responder outputs,zero independent semantic grades,no pass rate. Exact authenticated responder/grader settings and bounded budget are required in the established execution worker; use the already-authorized intended GPT-5.6 Sol xhigh route without guessing API identifiers or reviving stale Claude defaults. The pipeline for this supplement uses the explicitly selected responder for each role.

## 2026-09-07 owner adoption of guide edits

The owner explicitly adopted **all E01-E12** from `GUIDE-EDITORIAL-PATCH-2026-09-06.md`. Durable decision record: `OWNER-ADOPTION-2026-09-07.md`.

Treat the exact wording/placement in that patch as approved article text. Do not ask for another conceptual approval of those twelve edits.

Important: `guides/inner-child-guide.txt` is an older source snapshot and materially differs from the complete current guide pasted by the owner before adoption. Do not splice the accepted edits into that stale file and call it current. The next bounded content task is to synchronize the complete current article into a new versioned guide source, apply E01-E12 exactly, update manifest/hash/source layout, and preserve the older source/evaluation versions.

After source sync, run guide-fidelity evaluation against the newly pinned current guide. Do not claim that the live runner is already running; latest recorded state is still configuration-blocked.

Next engineering step after source sync: execute calibrated live smoke in the authenticated worker, inspect source-grounded results and per-stage traces, then proceed to the full guide-fidelity supplement and the preserved evaluation corpus. No repeated design approval or new broad literature scan is needed. Candidate-source/prompt fidelity, actual model behavior and clinical usefulness remain separate gates.

Keep PR draft. No merge/release/stable promotion, deployment, real-user history or new memory backend. This task does not supersede the independent DEV-R005 frontier.
