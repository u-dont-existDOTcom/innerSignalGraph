# Response-fidelity lessons — development handoff (25 October 2026)

## Authority and scope
Owner explicitly requested corrections to InnerSignal's map and rules following an unsent-response review, and specifically asked that a topic not be repeated in the same reply. This change uses generalized synthetic wording; no private case transcript, case identifiers, personal history, or names appear in the public repository.

**Current state:** isolated development candidate on `task/therapy-response-fidelity-20261025`; not merged, promoted to `stable`, deployed, or behaviorally validated.

## Changes
- `guides/owner-amendments.json`: owner amendment `AMEND.CROSS.RESPONSE_FIDELITY_20261025` records the scope and provenance.
- `guide-graphs/candidates/cross-guide.graph.json`: existing medical red-flag, refractory-pain, altered-state aftermath, stable therapy, practical-action and three-way-gate nodes receive precise required nuance. No activation/safety gate was widened or weakened.
- `src/prompts/response-fidelity.mjs`, `src/prompts/common.mjs`: common response-quality guidance and audit failures reach application roles (candidate, critique, adjudication, realization, private audit/repair) through their shared rules.
- Packaged MCP skill and served `references/RESPONSE-FIDELITY.md` ensure a host that loads the therapy protocol receives the same rules; `src/protocol/therapy-protocol.mjs` includes the new reference.
- Generated graph bundle, projection and inner-child map are regenerated; served map is copied byte-for-byte from the canonical generated map.
- `THERAPY-LESSONS` and `authoring/PENDING-PUBLIC-GUIDE-CHANGES.md` capture source/provenance and the limited downstream reader-facing sync obligation.
- `tests/response-fidelity.test.mjs` checks source/served parity, owner amendment, graph scope and retained urgency.

## Behavior-level safeguards to assess
1. Repeated failed or coercive care + no identified treatment delta: do not repeat generic medical or psychiatric referral; allow consultation if person sees an actionable benefit.
2. New severe acute impairment: protect urgent assessment instead of using non-referral rule to skip it. Explain purpose when possible without delay.
3. Reported helpful hypnosis/somatic practice: ask about specific benefit and downside before speculation; preserve actual contraindications and reported prior destabilization.
4. Quoted speech inside dream/altered state is not independently verified waking testimony. Felt harm can be addressed without producing historical facts.
5. Return to a harmful behavior after sustained abstinence: ask what changed/what it supplied, not just ask about intention to stop.
6. A proposed one-symptom root is a hypothesis; use known low-symptom periods to distinguish its ongoing constraints from recurrence drivers.
7. Evaluate individualized support separately from alleged supplement or detox mechanism.
8. A single reply normally has one passage per practice or topic; retain additional coverage only for new decisions or safety needs.

## Verification and release boundary
- Node 24.18.0; `npm ci --ignore-scripts`.
- `npm run graph:compile` and `npm run graph:test`: 110/110 graph cases passed.
- `npm run authoring:project`, `npm run authoring:validate`, `npm run authoring:check`, `npm run authoring:maps:check`: passed.
- `node --test tests/response-fidelity.test.mjs tests/therapy-protocol-mcp.test.mjs tests/longitudinal-synthesis.test.mjs`: 25/25 passed after served-map synchronization.
- Remaining: full package verification, CI and independent review of final commit, GitHub PR; exact Guide Packet owner-decision and stable/deploy gates remain authoritative. No provider/model adherence test was performed. Do not call this live until stable deployment and host readback.
