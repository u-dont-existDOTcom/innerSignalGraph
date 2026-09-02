# Offline learning groundwork evidence

**Directive:** `ctc-innersignal-learning-offline-groundwork-20260831-001`

**Owner outcome:** `OO-INNERSIGNAL-ASKRIGOR-LIKE-LEARNING-20260831-E1`, epoch 1

**Strategy:** `dual-lane-typed-evidence-offline-enablement-v1`

**Start head:** `d6b08ce3c47ccd09faf72173348198e9f32bcc25`

**Typed worker claim:** `SUBTASK_COMPLETE_PARENT_OPEN`, subject to post-execution reasoning review

## Boundary

This slice adds only offline contracts, pure functions, fabricated fixtures, tests, and a
static reviewer preview. It adds no runtime consumer or outbound network capability. No real
GitHub App, private queue, issue, endpoint, credential, candidate transmission, personalization
runtime, owner decision, therapy-policy activation, or therapy-ledger mutation is part of the
implementation.

The active consent constant is `local-only`; all generalized candidates structurally retain
`runtimeAuthority: none`, `therapyPolicyAuthority: none`, and
`transmissionAuthority: none`. Passing a deterministic privacy screen is explicitly not live
transmission approval.

## Contract inventory

- Six strict JSON Schemas reject unknown fields: feedback evidence, personalization memory,
  lesson candidate, review card, truthful queue status, and external owner-decision reference.
- Seven fabricated fixture files cover a style preference, benefit and worsening reports,
  an independently verified factual correction, unsupported disagreement, an unsafe
  validation request, and contradictory outcomes.
- The privacy screen covers `SECRET_LIKE`, `EMAIL`, `PHONE`,
  `UUID_OR_ACCOUNT_IDENTIFIER`, `ABSOLUTE_LOCAL_PATH`, `IDENTIFYING_URL_QUERY`,
  `RAW_CONVERSATION_FORMAT`, `LONG_QUOTED_SPAN`, and `ADDRESS_LIKE_TEXT` before and after a
  synthetic transform. Its `liveTransmissionApproved` result is always `false`.
- Candidate fingerprints use SHA-256 over bounded canonical fields. Occurrence and revocation
  tokens use HMAC-SHA-256 with an injected local secret that never appears in candidates or
  queue receipts.
- Recurrence and contradiction aggregation preserve benefit, no-change, mixed, worsening,
  and unclear separately; counts do not change evidence class, causal boundary, or authority.
- The mock queue is in-memory only, deduplicates retries, accepts opaque revocation, and reports
  unavailable counts as `null` rather than zero.
- Review cards exclude `approve-and-deploy`. The promotion gate is a pure predicate requiring
  an exact synthetic decision reference and regression-first evidence; it performs no write
  or activation.

## Verification plan

Pre-freeze focused gates on 2026-08-31 are green:

- `npm run learning:groundwork:test`: PASS, 50/50 tests;
- `npm run learning:groundwork:verify`: PASS, six strict schemas, 34 required artifacts, two
  synthetic review cards, zero network-capable learning imports, and zero runtime consumers;
- `node --test tests/correction-learning.test.mjs`: PASS, 26/26 tests;
- `npm run community:test`: PASS, 17/17 tests.

The frozen-diff execution receipt will additionally record diff check, repository audit, the
single final package verification, commit, push, and exact-head hosted check results. That
receipt is returned to the assigned Extra High reasoning lane; this file does not pre-claim
those later results.

## Adequacy states

- Operational alignment: pending the complete mechanical gate; confined to offline/no-network/no-runtime behavior.
- Scientific adequacy: `NOT_ASSESSED_UNCHANGED`.
- Release adequacy: `NOT_AUTHORIZED`.
- Parent outcome: `OPEN`; live transmission, real review operations, runtime personalization,
  and owner-gated incorporation remain future work requiring separate authority.
