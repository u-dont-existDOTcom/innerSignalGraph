# Default contribution and API privacy offline evidence

**Directive:** `ctc-innersignal-option-a-api-privacy-offline-20260831-001`, revision 2

**Review request:** `rr-innersignal-option-a-api-privacy-offline-20260831-004`

**Owner outcome:** `OO-INNERSIGNAL-ASKRIGOR-LIKE-LEARNING-20260831-E1`

**Strategy:** `option-a-default-contribution-provider-truth-offline-v1`

**Start head:** `434707a83180a36568a258df3bfba79c7e87317f`
**Typed worker claim:** `SUBTASK_COMPLETE_PARENT_OPEN`, subject to the final gates and
post-execution Extra High review.

## Owner decision evidence

The exact owner statement is stored in
`OWNER-PRODUCT-PRIVACY-DECISION-20260831-003.json`. Its UTF-8 SHA-256 is
`1146d9832a04ad7b3310d684f8ec580a6c3676604688a4990d455d3e48dc608c`.
The receipt selects Option A: free community contribution is default-on, every eligible
privacy-screened generalized candidate must be previewed, and the user may refuse that
candidate at no charge without reduced access. Paid API mode may offer a global contribution
control; its future default remains unspecified.

This is a product/privacy/economic decision with `therapyPolicyAuthority: none`. It cannot
approve or change therapy semantics, guides, graphs, prompts, safety or evidence policy, or
runtime behavior.

## Provider truth and privacy boundary

The unpublished draft copy distinguishes the user's own ChatGPT account from a future paid,
InnerSignal-controlled OpenAI API account. The API copy preserves the official distinctions:
API content is not used for model training by default unless the API customer opts in;
ordinary abuse monitoring remains possible; related logs are generally retained for up to
30 days subject to documented exceptions; application-state retention is endpoint/feature
dependent; and ordinary paid API access does not establish Modified Abuse Monitoring or Zero
Data Retention.

Both paths carry a content-identifiability warning. A deterministic helper flags five
synthetic categories but always returns `anonymous: false`; a clean scan is not an anonymity
claim.

## Mechanical boundary

- `networkWriteCount=0`
- `OpenAIApiCallCount=0`
- `realQueueWriteCount=0`
- `billingEnabled=false`
- `liveSignupEnabled=false`
- `privacyPolicyPublished=false`
- `candidateTransmissionEnabled=false`
- `backfillEnabled=false`
- `runtimePersonalizationEnabled=false`
- `therapyPolicyActivated=false`
- `therapyLedgerMutationCount=0`
- no InnerSignal retention duration, paid global-toggle default, or live contribution timing
  window is selected.

Revision 2 makes one mechanical change to the older groundwork verifier:
`groundworkVerifierChanged=true` and
`groundworkVerifierChangeScope=changed-path-allowlist-only`. The exact new offline-policy
paths must pass the real changed-path predicate, while the enumerated unrelated runtime,
therapy-ledger, roadmap, script, test, and task paths must continue to fail closed.

## Verification record

Pre-freeze focused results:

- `npm run learning:policy:test`: PASS 22/22 in 1.214 seconds after one initial diagnostic
  run exposed and repaired two test-assertion defects without changing the required copy;
- `npm run learning:policy:verify`: PASS in 0.747 seconds, 24 required artifacts, three
  strict schemas, exact owner-source hash, truthful provider copy, identifiability warnings,
  zero network/provider/queue/signup/billing/publication/runtime consumers, and no therapy
  authority;
- `npm run learning:groundwork:test`: PASS 50/50 in 0.866 seconds;
- amended `npm run learning:groundwork:verify`: PASS in 0.628 seconds;
- `newlyAuthorizedPathRegressionResult=PASS` for all eight exact revision-2 paths;
- `unrelatedPathFailClosedRegressionResult=PASS` for all nine enumerated negative paths;
- `node --test tests/correction-learning.test.mjs`: PASS 26/26 in 0.263 seconds;
- `npm run community:test`: PASS 17/17 in 1.293 seconds;
- `git diff --check`: PASS;
- `npm run audit:repository`: PASS in 0.646 seconds with only the known unrelated
  repository-global `github_app_permissions` warning.

Evidence artifact SHA-256 values before diff freeze:

- owner receipt: `ad4b28fbcee5febe5b2fdf808a4b7f1aebf7988413c15b4074cb9b18ac6cff57`;
- provider facts: `e3ffc5de9ca25800cfdf50e7e521c65810ca9d089c0ba9af0d8f37537431316e`;
- privacy draft: `7fae4242bc2db9edefc7704cd49f92939bf3e62f0a20a12f36febee7c139eb34`;
- signup draft: `3319fa73703acfd15d781f86940d04a92c5b1e8cecd32467779a16a63ed2358c`;
- provider disclosure: `de027c230b384da1d1a227c2ee6aea449dbc2725e4d227f179612506ad1e2531`.

The post-freeze evidence packet sent to Extra High will add the single final package gate,
commit and PR head, hosted checks, GHAS annotations/alerts, and unchanged `main`/`stable`
refs. This tracked file does not pre-claim those results before they exist.

## Adequacy states

- Worker-to-contract alignment: `GREEN` before the final package and hosted gates.
- Contract-to-owner alignment: `MATCH` for this bounded offline slice.
- Operational alignment: `ADEQUATE` for the mechanically verified offline/no-network/
  no-runtime boundary only.
- Scientific adequacy: `NOT_ASSESSED_UNCHANGED`.
- Release adequacy: `NOT_AUTHORIZED`.
- Parent outcome: `OPEN`; later live transport, API, billing, signup, retention, and therapy
  incorporation need separate authority.
