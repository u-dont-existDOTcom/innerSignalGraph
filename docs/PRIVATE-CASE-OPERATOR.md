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

The import needs no `case:read`. It checks what it publishes through a write-authorized inspection that returns the case revision, the corpus reference and a digest of the state outside the journal, never case content.

Do not add this grant to `INNER_SIGNAL_CASE_ACL_JSON`, which belongs to the read-only MCP. Supply it only as `INNER_SIGNAL_OPERATOR_CASE_ACL_JSON` to the one-shot operator.

Keycloak's supported machine-to-machine flow is the client-credentials grant backed by the client's service account. Obtain a short-lived token immediately before an operation and pass it only through `INNER_SIGNAL_PRIVATE_CASE_OPERATION_TOKEN`; never put the token in argv, a request file, a receipt, or logs.

## Networkless verification

Snapshot the realm's current public JWKS into `INNER_SIGNAL_OPERATOR_OAUTH_JWKS_JSON`. The operator validates the short-lived JWT against that pinned public key set and runs with `network_mode: none`. Refresh the snapshot deliberately after Keycloak signing-key rotation. The issuer and audience checks remain mandatory.

## One-shot execution

Create an operator working directory outside the checkout with mode `0700`. The request must be a regular file with mode `0600`; the receipt is created with mode `0600`. The Compose service in `deploy/private-case-operator.compose.yml` mounts only that working directory and the private vault, with the vault writable only for the duration of the operation.

Start with a non-mutating authorization probe:

```json
{
  "schema_version": 1,
  "operation": "probe_journal_write",
  "case_id": "<exact-existing-case-id>",
  "purpose": "archive"
}
```

The remaining journal operations are `create_journal_corpus`, `commit_journal_generation`, `rollback_journal_generation`, and `increment_journal_visibility`. Commit reopens and authenticates the staged manifest, applies the expected case revision/generation/visibility checks, and verifies that therapy state, transcript, and candidate records remain unchanged.

Deletion is intentionally absent from this operator surface. It requires a separate authority and lifecycle.
