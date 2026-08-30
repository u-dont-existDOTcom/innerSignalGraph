# Worker handoff — InnerSignal Commons MVP

Continue in `u-dont-existDOTcom/innerSignalGraph`, branch `design/opt-in-community-learning-20260830`, PR #15. Recover fresh from GitHub; do not trust this handoff over current code, tests, PR discussion, or CI.

Read in order:

1. `AGENTS.md`
2. `state/CODEX-CURRENT-STATE.md`
3. `docs/superpowers/specs/2026-08-30-opt-in-community-learning-design.md`
4. `docs/superpowers/plans/2026-08-30-opt-in-community-learning-mvp.md`
5. `tasks/opt-in-community-mvp-20260830/CURRENT-STATE.md`
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

Run targeted community tests, then `npm test`, then `npm run verify`. Repair implementation defects autonomously. Stop only for a substantive therapy, consent, research, launch, or product-policy decision.
