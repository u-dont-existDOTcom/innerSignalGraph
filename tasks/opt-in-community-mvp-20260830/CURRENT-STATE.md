# Opt-in community MVP current state

**Task:** `opt-in-community-mvp-20260830`  
**Branch:** `design/opt-in-community-learning-20260830`  
**PR:** #15  
**Authority:** current owner instruction → this task state → current task design/spec/plan → current PR code/tests/CI → repository-global state only where non-conflicting.

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

## Independent review repair cycle

Extra High independently reviewed PR #15 at `e70ea3648f40163ce41ba8933f9d0f670b36a769` under directive `ctc-innersignal-pr15-repair-20260831-001`. The bounded repair:

- isolates participant-facing aggregation from product-improvement-only consent;
- keeps unreviewed community-derived cards out of participant bootstrap and proposal export without adding a review-approval mechanism;
- stales every proposal linked to a withdrawn contribution even when the recomputed card remains above threshold;
- classifies multiple reports from one contributor as `REPEATED_PERSONAL_PATTERN`;
- removes the cookie property-injection and Authorization polynomial-regex paths and stops reflecting unexpected exception detail;
- replaces overstated deletion/bounded-ledger claims with the factual current-content, account-deactivation, and retained pseudonymous audit-metadata boundary.

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

Repository verification at executable commit `6c983eb93c1c0392c2f19fdc2c4ac3593a762f0f`:

- repository workflow policy: **PASS**;
- AJV schema/example verification: **PASS**;
- complete test suite and deterministic package gate: **PASS**;
- clean final worktree gate: **PASS**;
- CodeQL JavaScript analysis: **PASS**.

Independent privacy/security/therapy-boundary review remains the next non-CI gate.

Post-repair local verification on 2026-08-31:

- `npm run community:test`: **PASS 15/15** after locked dependencies were installed with lifecycle scripts disabled;
- `npm run community:verify`: **PASS**;
- `npm test`: **PASS 456/456**;
- `npm run audit:repository`: **PASS** with the known repository-global installed-GitHub-App-permission warning, which belongs to the older hardening task and does not block this task;
- `npm run verify`: **PASS**.

Exact-head hosted workflow and separate GitHub Advanced Security CodeQL readback remain required after this repair is pushed. The earlier required workflow jobs were green at `e70ea3648f40163ce41ba8933f9d0f670b36a769`, but the separate GHAS CodeQL check reported three new alerts; this repair does not claim those alerts cleared until the new exact-head readback proves it.

## Product-policy state

No community-derived therapy behavior is active. No automatic AI extraction is active. No research use is authorized. No public or network pilot is authorized by this implementation alone.

## Next executable slice

1. Push the bounded repair, read the exact-head required workflow and separate GHAS CodeQL conclusions, and return the execution receipt to Extra High.
2. Exercise the local interface with synthetic participants and record usability defects only under the next authorized directive.
3. Keep production Discourse + SSO + PostgreSQL composition, a graphical moderator console, participant challenge/correction, and signed contributor-verification receipts deferred.
4. Complete legal/privacy and research-boundary review before inviting real participants over a network.
