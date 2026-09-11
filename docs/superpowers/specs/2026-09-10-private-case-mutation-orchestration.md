# Private case mutation and candidate-audit orchestration

Status: candidate architecture on draft PR #49. This design complements, and does not weaken or replace, the deliberately read-only `InnerSignal Private Continuity` MCP.

## Trust boundaries

There are two distinct capabilities:

1. **Private Continuity** is the auditor-facing read surface. It exposes exact authorized case and handoff retrieval, advertises only read-only MCP tools, and requires `case:read` or `case:audit` as appropriate.
2. **Private Case Operations** is a backend/operator controller. It accepts mode-`0600` request files outside the public checkout, receives the bearer credential only through `INNER_SIGNAL_PRIVATE_CASE_OPERATION_TOKEN`, and invokes the existing authorization/key-provider boundary with `case:write` or `case:audit`. It returns a non-content receipt and never becomes an MCP tool.

Real case text, candidate text, findings, source manifests, hashes derived from private bytes, keys, and tokens stay in encrypted private storage or protected files outside Git. Public schemas and tests use synthetic content only.

## Append-only transcript completion

An incomplete source turn is never edited. Record version 5 adds `transcript_amendments`, whose completion record binds:

- the immutable raw target turn and its exact-byte digest;
- the exact completion text and digest;
- the resulting effective-text digest;
- a producer context and creation time; and
- an exact byte range in a separately persisted immutable source artifact.

The effective transcript is a deterministic projection of raw turns plus validated amendments. Recent-verbatim selection, evidence retrieval, case context, and newly compiled handoffs use that projection while retaining the raw archive and amendment list. One target turn may have only one completion amendment. Existing version-1 and version-2 handoffs remain readable; newly compiled packets use handoff schema version 3.

## Candidate state machine

Each candidate is an immutable `(id, version, exact_text)` record with lineage and producer context. Status changes are controlled transitions:

```text
pending_audit --failed audit--> audit_failed
audit_failed --reconstruct--> reconstructed_pending_audit
reconstructed_pending_audit --fresh independent pass--> audited
audited --exact audit approval--> approved_for_delivery
approved_for_delivery --send--> sent
```

A reconstruction supersedes its parent, increments the global version and lineage repair cycle, and starts with an empty audit history. Audits bind candidate ID, version, and exact-byte digest. An independent audit context must differ from the candidate producer context. Reconstructed candidates require the complete repair-induced-error checklist. A third reconstruction is rejected after repair cycle 2 and routes to discrimination or blocked delivery.

Audit, approval, and delivery records are exact-version-bound. Delivery atomically appends the exact approved candidate bytes as an assistant transcript turn and marks that candidate sent with the approving audit and replied-to user-turn identifiers. An earlier version's audit cannot approve changed bytes; a handoff that is continuation-safe cannot imply candidate approval.

### Externally supplied failed audits with unavailable identity

A fresh independent audit can sometimes arrive through an owner-authorized external channel without an auditor/session identifier or trustworthy audit-completion timestamp. The controller represents those fields as `null` with explicit `unavailable` statuses; it does not invent sentinel identities or treat the ingestion time as the audit-completion time. The immutable record instead carries a separate recording time and structured external provenance identifying the owner as supplier, the receipt time, and the exact candidate producer context from which the external auditor reported independence.

This bounded path is failure-only. Runtime validation requires an independent classification, at least one unresolved substantive/high finding, the complete repair-induced checklist for a reconstructed candidate, and an exact match between the provenance's reported producer context and the candidate's stored producer context. Such evidence always has `sufficient_for_approval: false`. A PASS, approval, or sent transition requires a known fresh auditor context and known completion time, so unavailable identity can preserve a real blocking result without weakening producer/auditor separation.

## Backend operations and replay safety

`src/supervisor/private-case-orchestration.mjs` implements the operation contract in `schemas/private-case/operation-request-v1.schema.json`:

- `append_transcript_completion`
- `record_candidate_audit`
- `reconstruct_candidate_and_create_handoff`
- `create_handoff`
- `approve_candidate_for_delivery`
- `deliver_candidate_and_create_handoff`
- `mark_candidate_sent`

Stable amendment, audit, candidate, transcript-turn, and handoff IDs make operations retry-safe. An exact replay returns `reused: true`; a replay with different immutable content fails closed. The combined reconstruction/handoff operation either reuses the matching immutable candidate and handoff or rejects an identity/content conflict. The combined delivery/handoff operation atomically persists the exact assistant response before compiling a continuation-safe post-delivery handoff whose `delivery_completion` projection is bound to the candidate ID/version/digest, approving audit, assistant turn, replied-to user turn, and delivery time. Receipts contain only opaque IDs, versions, statuses, repair cycles, and gate actions.

Invoke the controller with protected paths outside the checkout:

```bash
INNER_SIGNAL_PRIVATE_CASE_OPERATION_TOKEN='<transport-secret>' \
  npm run private-case:operations -- \
  --credentials /absolute/private/bridge-credentials.json \
  --request /absolute/private/operation.json \
  --receipt /absolute/private/receipt.json
```

Hosted execution uses `--hosted-env` and the same production OAuth/ACL/managed-key provider as continuity. The token never belongs in argv, request JSON, receipts, or logs. Request and receipt paths are rejected if they resolve inside the public repository.

## Handoff and independent audit sequence

The normal repair path is:

1. append the provenance-bearing completion without modifying the raw turn;
2. persist the already-produced structured audit against exact candidate v1;
3. reconstruct immutable v2 with `parent_candidate_id`, `based_on_audit_id`, repair cycle 1, and the producing context;
4. compile immutable handoff v2 containing the raw transcript, amendment, effective transcript, failed v1 evidence in lineage, and exact v2 in `reconstructed_pending_audit`;
5. let a fresh session retrieve that handoff through read-only Private Continuity;
6. persist the fresh v2 audit through the backend controller; and
7. only after a sufficient exact-version pass, perform explicit approval, transcript-bound delivery, and post-delivery handoff creation.

Steps 6 and 7 do not occur in the reconstruction producer context. If step 6 returns a substantive failure, persist the exact-version FAIL, reconstruct a new immutable child if the repair-cycle limit allows it, and compile another handoff. At repair cycle 2, the child remains pending a fresh independent audit and no further repair is permitted unless the lifecycle contract is deliberately versioned.

## Verification contract

Synthetic acceptance covers raw-turn preservation, exact source-range provenance, effective transcript construction, record migration, immutable candidate/audit history, failed-v1 to repair-cycle-1-v2 reconstruction, truthful external-FAIL ingestion with unavailable auditor metadata, repair-cycle-2-v3 reconstruction, retry behavior, handoff retrieval, producer/auditor separation, complete repair-induced checks, exact transcript-bound delivery, tamper rejection, continuation-safe post-delivery handoffs, the two-cycle maximum, strict JSON Schema compilation, and the unchanged read-only MCP tool list. The complete repository and publication gates remain required before publication.
