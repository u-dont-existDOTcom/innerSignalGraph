# Opt-in community MVP current state

**Task:** `opt-in-community-mvp-20260830`  
**Branch:** `design/opt-in-community-learning-20260830`  
**PR:** #15  
**Authority:** owner request → community design spec → this task state → current code/tests.

## Completed in this slice

- Executable standalone InnerSignal Commons service and web client.
- Separate community data root from private InnerSignal state.
- Pseudonymous sessions, recovery, invitation enforcement, adults-only acknowledgment, and CSRF.
- Response contracts and separated social/evidence reactions.
- Structured Field Notes and granular consent receipts.
- Withdrawal/recomputation and stale-proposal tracking.
- Minimum three-contributor shared-card threshold.
- No verbatim Field Note prose in participant-facing community-derived cards.
- Key-protected moderation queue and decisions.
- Proposal-only exports and authority-path verification.
- Main local launcher integration and standalone container files.
- Synthetic contested, adverse-signal, and product-friction cards.
- Bounded implementation and continuation documentation.

## Verification

Local bounded suite: **PASS 11/11** for all tests runnable without repository-installed AJV.

Covered:

- contract validation;
- adults-only participation acknowledgment;
- response-contract enforcement;
- consent dependency rules;
- safety holds;
- invitation, cookie session, and CSRF;
- human moderation authorization and decisions;
- conversation-only posts;
- three-contributor suppression;
- non-verbatim shared cards;
- withdrawal and recomputation;
- stale proposal records;
- participant export secret exclusion;
- proposal non-activation;
- UI privacy and consent boundaries.

Pending after push:

- AJV schema/example verification under repository dependencies;
- complete `npm test`;
- complete `npm run verify`;
- GitHub Actions status and independent code review.

## Product-policy state

No community-derived therapy behavior is active. No automatic AI extraction is active. No research use is authorized. No public or network pilot is authorized by this implementation alone.

## Next executable slice

1. Review CI and repair implementation defects only.
2. Run an independent privacy/security/therapy-boundary review.
3. Build the production composition around self-hosted Discourse + SSO + PostgreSQL rather than scaling the prototype forum store.
4. Add a graphical moderator console, participant challenge/correction flow, and signed contributor-verification receipts.
5. Complete legal/privacy and research-boundary review before inviting real participants over a network.
