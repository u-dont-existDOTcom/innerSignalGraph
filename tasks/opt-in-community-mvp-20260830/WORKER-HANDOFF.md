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

Mission: verify and finish the bounded MVP without expanding community anecdotes into therapy authority. Preserve these invariants:

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

Run targeted community tests, then `npm test`, then `npm run verify`. Repair implementation defects autonomously. Stop only for a substantive therapy, consent, research, launch, or product-policy decision.

The 2026-08-31 bounded repair directive is `ctc-innersignal-pr15-repair-20260831-001`, reviewed against starting head `e70ea3648f40163ce41ba8933f9d0f670b36a769`. Local post-repair evidence is `community:test` 15/15, `community:verify` PASS, `npm test` 456/456, repository audit PASS with the unrelated historical installed-App warning, and package verification PASS. Do not treat those local results as exact-head hosted evidence: required workflows and the separate GHAS CodeQL check must be read back after push, then the execution receipt returns to the assigned Extra High chat.
