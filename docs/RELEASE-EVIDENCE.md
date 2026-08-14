# Stable release evidence contract

`main` is development authority. `stable` is the sole installation and release source. A development merge is not a release, and `runtime-diagnostics` must never merge into either source branch.

Every proposed stable advancement needs one evidence record for one exact candidate commit and recursive tree. Evidence from another commit, a dirty checkout, an earlier package, or a deterministic substitute is not transferable.

## Required evidence

1. **Identity and provenance:** repository, exact candidate commit, tree, version, source branch, release branch, predecessor, changed files, and immutable artifact hashes.
2. **Deterministic gates:** exact bootstrap, focused tests, full `npm test`, graph regressions, therapy-prompt lesson governance, package/build verification, repository audit, immutable Guide Packet hashes, and clean final worktree.
3. **Live-model entitlement and stages:** exact required role/model identifiers, provider request evidence, stage result, and bounded recovery status. Deterministic or mock success cannot establish live-model entitlement and cannot stand in for a required live stage.
4. **Adversarial review:** reviewer identity/role, exact reviewed commit and diff, findings, repairs, re-review, and any unresolved disagreement or escalation.
5. **Psychological-safety and therapy regressions:** exact affected cases, hypnosis safety/waking-return gates, Guide Packet regressions, and domain limits. Infrastructure success is not a therapy-policy verdict.
6. **Owner decisions:** every applicable therapy/hypnosis/framework, privacy, model-role, Guide Packet, and stable release decision, including packet/card identity and receipt. No model may approve policy for the owner.
7. **Promotion:** non-forced promotion of the exact verified commit to `stable`, matching fetched refs/trees, required checks, and proof that `runtime-diagnostics` was not merged.
8. **Transactional install:** detached candidate, disposable state, credentials removed during validation, preserved private bytes, atomic swap, safe restart, and the exact installed commit marker.
9. **Private-byte preservation:** before/after hashes for `.env`, autopilot/Guide Packet state, owner decisions, development state, ledgers, data, and other declared preserved roots. This is private-byte preservation evidence, never publication of those bytes or hashes derived from excluded content.
10. **Rollback:** retained predecessor, injected or observed rollback exercise, exact restored commit marker/tree, unchanged preserved data, and successful retry where applicable.
11. **Sustained health:** bounded observation of health, development status, Guide Packet status, recovery ZIP, version/commit stability, privacy exclusions, and complete owned-process teardown.

## Failure and exception handling

Any missing required gate blocks release. A non-pass live stage remains named and resumable; it cannot be relabeled as deterministic success. An unavailable hosted control is recorded with API evidence, impact, and a durable issue. Owner-gated decisions remain pending until the owner decides them directly.

Use `.github/RELEASE-EVIDENCE-TEMPLATE.md` for the candidate record. Retain the final record with the implementation/release report and link it from `state/CODEX-CURRENT-STATE.md`.
