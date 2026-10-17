# Private case operator boundary

The private case operator is a one-shot backend process. It is not an MCP server, has no listening port, registers no tools, and must not share the ChatGPT connector's ACL.

## Identity and grant

Provision a dedicated confidential Keycloak client with service accounts enabled and Full Scope Allowed disabled. Give the service-account token only the `case:write` scope. The operator ACL binds that service-account subject to the exact case and only the purposes required by the import:

```json
[
  {
    "subject": "<dedicated-service-account-subject>",
    "case_ids": ["<exact-existing-case-id>"],
    "scopes": ["case:write"],
    "purposes": ["archive", "organize_search", "session_use"]
  }
]
```

Rollback is a correction, so `rollback_journal_generation` needs the `correct` purpose, which this import grant leaves out on purpose. The operator ACL is supplied per run, and only the first entry for a subject and case counts, so run a rollback with an operator ACL whose entry for this subject lists `"purposes": ["correct"]`. Check it first with `probe_journal_write` and purpose `correct`, and go back to the import ACL afterwards.

The import needs no `case:read`. It checks what it publishes through a write-authorized inspection that returns the case revision, the corpus reference and a digest of the state outside the journal, never case content.

Do not add this grant to `INNER_SIGNAL_CASE_ACL_JSON`, which belongs to the read-only MCP. Supply it only as `INNER_SIGNAL_OPERATOR_CASE_ACL_JSON` to the one-shot operator.

Keycloak's supported machine-to-machine flow is the client-credentials grant backed by the client's service account. Obtain a short-lived token immediately before an operation and pass it only through `INNER_SIGNAL_PRIVATE_CASE_OPERATION_TOKEN`; never put the token in argv, a request file, a receipt, or logs.

## Networkless verification

Snapshot the realm's current public JWKS into `INNER_SIGNAL_OPERATOR_OAUTH_JWKS_JSON`. The operator validates the short-lived JWT against that pinned public key set and runs with `network_mode: none`. Refresh the snapshot deliberately after Keycloak signing-key rotation. The issuer and audience checks remain mandatory.

## One-shot execution

Create an operator working directory outside the checkout with mode `0700`. The request must be a regular file with mode `0600`; the receipt is created with mode `0600`. The Compose service in `deploy/private-case-operator.compose.yml` mounts only that working directory and the private vault, with the vault writable only for the duration of the operation.

For named-case continuity, bind a private alias only after the exact existing case ID is independently known. The alias request is private, mode-`0600`, and the receipt does not echo the alias. The read-only MCP never exposes a bind/list operation:

```json
{
  "schema_version": 1,
  "operation": "bind_case_alias",
  "case_id": "<exact-existing-case-id>",
  "case_alias": "<private-user-facing-case-name>"
}
```

Binding is idempotent after normalization when the alias already maps to the same case and fails closed if it maps to a different case. The private locator stores only the normalized-alias SHA-256 digest and opaque case ID; successful named loading still requires the caller's ordinary case read/audit authorization and case keys.

Start journal work with a non-mutating authorization probe:

```json
{
  "schema_version": 1,
  "operation": "probe_journal_write",
  "case_id": "<exact-existing-case-id>",
  "purpose": "archive"
}
```

The remaining journal operations are `create_journal_corpus`, `commit_journal_generation`, `rollback_journal_generation`, and `increment_journal_visibility`. Commit reopens and authenticates the staged manifest, applies the expected case revision/generation/visibility checks, and verifies that therapy state, transcript, and candidate records remain unchanged. `increment_journal_visibility` also retires the active generation, since no reader accepts its old epoch. The generation moves to the previous generations, where rollback refuses it, and handoffs stop presenting the corpus as attached until a generation is committed under the new epoch.

A case's plan (issue #172; `docs/superpowers/specs/2026-10-17-case-roadmap.md`) changes only through `record_roadmap_decision`, under the audit scope: the import's `case:write` grant above is refused, so recording a plan needs a supervisor identity whose token and operator ACL entry carry `case:audit` for that case. A decision applies whole or not at all, and the receipt holds no plan content. Its `source` says whose priority it records: `client` (its `evidence_refs` must name user turns or source artifacts of the case, where the client said it), `authorized_plan` (the owner or a supervisor), or `provisional` (a proposal). Decisions are recorded in time order with exact UTC times; goal ids appear in error messages, so keep them neutral (`goal:aim-1`). A synthetic example:

```json
{
  "schema_version": 1,
  "operation": "record_roadmap_decision",
  "case_id": "<exact-existing-case-id>",
  "decision": {
    "decision_id": "plan-2026-10-18-1",
    "source": "client",
    "at": "2026-10-18T10:00:00.000Z",
    "evidence_refs": ["<turn id where the client said it>"],
    "changes": [
      { "op": "add", "goal": { "id": "goal:felt-safety", "kind": "primary_aim", "title": "<the aim in the client's words>" } },
      { "op": "add", "goal": { "id": "goal:weekly-step", "kind": "actionable_step", "parent_id": "goal:felt-safety", "title": "<the step>", "review_condition": "<when to revisit it>" } }
    ]
  }
}
```

Other changes are `{"op": "update", "goal_id", "set": {...}}`, `{"op": "order", "parent_id", "goal_ids": [...]}` (add `"tracks": true` to order the independent, safety and medical tracks) and `{"op": "safety_override", "reason": "..." | null}`. An authorized plan can't change the title, status, agreement, rank, review condition or linked episode of a goal the client chose, agreed to or declined, nor remove its evidence references; the decision is refused whole and nothing changes. Replaying the same decision changes nothing; reusing its id with other content is refused.

Only one writer changes a vault at a time. An InnerSignal server with a private runtime holds the vault's writer lock for as long as it runs, so stop it before an operator write or a journal publication: either one refuses to start with `PRIVATE_ROOT_WRITER_ACTIVE` while the server runs, and the server refuses to start while either is writing. The read-only MCP takes no lock and keeps running.

Deletion is intentionally absent from this operator surface. It requires a separate authority and lifecycle.
