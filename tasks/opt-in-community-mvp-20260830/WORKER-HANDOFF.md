# Worker handoff — InnerSignal Commons MVP

Continue in `u-dont-existDOTcom/innerSignalGraph`, branch `design/opt-in-community-learning-20260830`, PR #15. Recover fresh from GitHub; do not trust this handoff over current code, tests, PR discussion, or CI.

Read in order:

1. `AGENTS.md`
2. `tasks/opt-in-community-mvp-20260830/CURRENT-STATE.md`
3. `docs/superpowers/specs/2026-08-30-opt-in-community-learning-design.md`
4. `docs/superpowers/plans/2026-08-30-opt-in-community-learning-mvp.md`
5. `state/CODEX-CURRENT-STATE.md` only where it does not conflict with the active task
6. `community-learning/README.md`
7. current PR diff and CI

Mission status: the bounded MVP repair at `e4bb5d1d11ad2a1ee92525f1e5945a899d4adb10`, its exact-head hosted readback, and Extra High acceptance are complete. Do not repeat the push, hosted check readback, or independent repair review. Preserve these invariants:

- posts are conversation-only;
- private sessions are never imported;
- consent is per contribution and per purpose;
- shared community-derived cards need three independent contributors;
- no raw Field Note prose is republished in shared cards;
- withdrawal recomputes cards and stales affected proposals;
- network mode requires invitation and moderation secrets;
- Learning Cards have no runtime authority;
- proposal exports cannot write active runtime or `stable`;
- production conversation must reuse a mature Discourse substrate rather than scaling the prototype forum.
- product-improvement-only consent never feeds participant-facing Commons aggregation;
- community-derived cards remain participant-hidden and non-exportable until human-reviewed, and this MVP contains no mechanism that can grant that status;
- linked proposals stale whenever a contributing Field Note withdraws an applicable scope;
- current-content removal and account deactivation do not claim erasure of the append-only pseudonymous event metadata.

No further Commons implementation is currently authorized. The remaining production and launch work is queued as `COMMUNITY-R001` through `COMMUNITY-R010` in `roadmap/autonomous-development.json`; every entry has `autoStart: false`. A fresh worker must not start any of those tasks until the owner-defined core InnerSignal app-completion gate is satisfied and a later authorized reasoning directive activates one bounded task. Do not infer that the app is complete and do not treat queue presence as execution authority.

The 2026-08-31 bounded repair directive is `ctc-innersignal-pr15-repair-20260831-001`, reviewed against starting head `e70ea3648f40163ce41ba8933f9d0f670b36a769`. Local post-repair evidence is `community:test` 15/15, `community:verify` PASS, `npm test` 456/456, repository audit PASS with the unrelated historical installed-App warning, and package verification PASS. Exact-head hosted evidence at `e4bb5d1d11ad2a1ee92525f1e5945a899d4adb10` is also complete: all three workflow jobs and the separate GHAS CodeQL check succeeded, with zero GHAS annotations/new alerts and zero analysis results. Extra High accepted the repair and authorized only the durable closeout/queue persistence cycle in `ctc-innersignal-pr15-closeout-queue-20260831-002`; it did not authorize merge, release, launch, research, therapy activation, or additional product implementation.
