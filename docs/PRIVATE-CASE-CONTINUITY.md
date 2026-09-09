# Private case continuity and fresh-session access

Status: the repository implementation from merged PR #46 is being extended on `codex/private-case-import-20260909`. The real owner-supplied source has passed exact local encrypted import and fresh-process round-trip, but the case is **not continuation-safe** because the supplied transcript contains only one complete user-assistant exchange and the contract requires three. A production ChatGPT connection is also **not deployed, registered, or fresh-chat verified**.

## Acceptance contract

A case is continuation-safe only when an authorized loader, starting with no prior session memory, can use a stable case ID to recover all of the following:

1. current structured case state;
2. the last state diff;
3. at least three complete exact user-assistant exchanges, extended to the complete active episode when required;
4. the exact versioned candidate response selected by stable candidate ID or `current_pending`;
5. older raw turns by query, provenance/item ID, or time range;
6. the current therapeutic episode; and
7. the constitution version/reference, without copying the constitution into the case.

`loadCaseContext` and the MCP `load_case_context` tool enforce this gate. They fail with `CASE_NOT_CONTINUATION_SAFE` rather than returning a public fixture, a summary, a hash, or regenerated prose when a required artifact is absent. Neither API returns hidden model reasoning.

## Public/private boundary

Public Git contains the schemas, code, tests, synthetic fixtures, constitution, and this operational contract. It must not contain real transcript text, exact real candidate replies, credentials, key bytes, bearer tokens, or private-derived hashes. Opaque stable case/candidate identifiers may appear in a handoff only when the owner explicitly authorizes that disclosure; an identifier never proves that its payload is available.

The private store keeps separate fields for:

- append-only exact transcript turns (`id`, `exchange_id`, `role`, `text`, `at`, and optional `episode_id`);
- provenance-aware structured state;
- state-diff history;
- tracker and journal data;
- immutable exact candidate versions and their status;
- immutable exact source artifacts plus a lossless byte-range/chunk integrity manifest; and
- current episode state through the structured record.

Ordinary reasoning ledgers now default to `redacted`. `LEDGER_MODE=full` remains an explicit operator choice and is not the private case persistence mechanism.

## Repository interfaces

`src/storage/private-case-access.mjs` authorizes before requesting keys and exposes these operations:

| Operation | Meaning |
| --- | --- |
| `saveCaseState` / `getCaseState` | Structured case state only |
| `saveCaseDiff` / `getCaseDiff` | Versioned turn-associated diffs |
| `appendTranscriptTurn` / `getRecentVerbatim` | Append-only raw turns and exact recent episode |
| `saveCandidateResponse` / `getCandidateResponse` | Immutable exact candidate versions and `current_pending` resolution |
| `updateCandidateStatus` | `pending_audit`, `audited`, `superseded`, or `sent` |
| `saveSourceArtifact` / `getSourceArtifact` | Immutable exact private source plus a contiguous byte-range integrity manifest |
| `retrieveCaseEvidence` | Raw older turns by query, stable provenance IDs, or time range |
| `getCurrentEpisode` | Current therapeutic path/episode |
| `loadCaseContext` | All-in-one fresh-session bootstrap and continuation-safety gate |

Candidate audit code in `src/supervisor/private-candidate-audit.mjs` accepts a candidate ID, resolves the exact private text through `loadCaseContext`, and only then invokes an auditor.

## Encryption and key-provider model

Each case is one mode-`0600` AES-256-GCM envelope below a mode-`0700` private root. A random data-encryption key is wrapped twice: once by a 32-byte routine key and once by a recovery key derived from the user-held recovery secret with Argon2id. Ordinary authorized updates decrypt the wrapped data key with the routine key, replace the encrypted payload with a fresh IV, and preserve both key wraps. The recovery secret is required to create a new envelope but need not be released for routine reads or updates. There is no plaintext fallback.

The access service accepts two injected boundaries:

- `authorizationProvider.authorize({ caseId, authContext, requiredScope })` returns an authenticated principal and case-scoped `case:read`, `case:write`, or `case:audit` grants.
- `keyProvider.getCaseKeyMaterial(...)` returns routine key material only after the provider's unlock/reauthentication policy succeeds. A recovery secret may additionally be returned when a case is created.

The bundled development provider is deliberately not production security. It reads one non-symlink mode-`0600` JSON file outside the repository, matches SHA-256 bearer-token digests in constant time, scopes grants by case, and loads per-case test keys. It reports `productionReady: false` and returns the explicit `development_external_file` assurance. The access service rejects that assurance unless its local-only `allowDevelopmentFileProvider` switch was deliberately enabled; it never presents the file as OS-backed reauthentication. A production provider must instead return `os_backed_reauthenticated` evidence from an OS keychain, HSM/KMS, or equivalent secret manager.

Its external credential file has this shape; placeholder values are not usable secrets:

```json
{
  "schema_version": 1,
  "root_dir": "/absolute/private/path/vaults",
  "grants": [
    {
      "token_sha256": "<64-lowercase-hex-digest>",
      "principal_id": "<authenticated-principal>",
      "case_ids": ["<stable-case-id>"],
      "scopes": ["case:read", "case:write", "case:audit"]
    }
  ],
  "case_keys": {
    "<stable-case-id>": {
      "routine_kek_base64": "<base64-encoded-32-byte-test-key>",
      "recovery_secret_base64": "<base64-encoded-development-recovery-secret>"
    }
  }
}
```

Do not put this file beneath the checkout. The loader rejects repository-contained credentials and storage roots.

## Executable repository bridge

Start the separate read-only MCP service with the external development credential file:

```bash
npm run private-case:mcp -- --credentials /absolute/private/bridge-credentials.json --port 0
```

The process prints a local `/mcp` URL. Authentication is an HTTP bearer token supplied by the transport, never a tool argument. Its read-only tools are:

- `load_case_context`
- `get_recent_verbatim`
- `retrieve_case_evidence`
- `get_candidate_response`
- `get_source_artifact`

A fresh client performs this exact bootstrap call after transport authentication:

```json
{
  "name": "load_case_context",
  "arguments": {
    "case_id": "<stable-case-id>",
    "candidate_id": "<stable-candidate-id>"
  }
}
```

The full executable gate is `npm run private-case:acceptance`. It creates an external temporary private store in Session A, exits that process, and has independent Session B recover exact text using only the stable case ID and authorized test transport. It also tests denied authorization, missing/wrong keys, ciphertext at rest, full-episode retention, historical retrieval, exact candidate audit, private handoff validation, public-path leak prevention, and lossless Unicode/newline reconstruction for a synthetic source larger than the former single-read ceiling. Chunk manifests reject gaps, duplication, reordered chunks, altered byte ranges, and changed bytes.

The ordinary loopback web server remains unsuitable as a private ChatGPT boundary because its development endpoints do not implement user authentication. It was intentionally not given raw transcript or candidate inspectors. The existing **Current saved state** and **What changed this turn** views remain structured/no-raw-content controls; exact **Recent Verbatim** and **Pending Candidate** inspection is available only through the authorized read-only MCP tools.

## Private handoff format

`createPrivateCaseHandoff` in `src/storage/private-case-handoff.mjs` creates the private, do-not-commit handoff record. It requires:

- the real stable `case_id`;
- the real stable `candidate_id`;
- evidence that the continuation-safety gate passed; and
- the concrete `load_case_context` tool call using those same identifiers.

The validator rejects a handoff that claims availability without continuity evidence or embeds transcript/candidate payload. The owner-authorized opaque identifiers for the present import are `case-57a69465-4434-41cf-ad24-310b13a2cc81` and `candidate:pending:50804229-a5b2-4760-b956-4e5926a56051`. The private payload exists locally and round-trips exactly, but no validated private handoff may yet claim continuation safety: only one supplied exchange is complete, two fewer than the fixed minimum. The local credential/key provider remains development-only, and ChatGPT registration is still absent.

## Blocking production/ChatGPT obligations

Repository-local success does not make the tool callable from a new ChatGPT conversation. Before making that claim, all of these must happen and be evidenced:

1. Implement the production authorization provider with OAuth identity-to-case ACLs.
2. Implement the production key provider using the approved OS credential store, KMS, or HSM and the owner-selected user-held recovery-secret flow.
3. Supply and append at least two additional complete exact historical user-assistant exchanges, then pass the continuation gate for the imported real case without inventing missing replies.
4. Expose the MCP endpoint over public HTTPS, or use an approved secure MCP tunnel for development.
5. Implement MCP OAuth 2.1 protected-resource metadata, authorization-server discovery, PKCE S256, and the chosen client-registration path.
6. Register/connect the MCP server in ChatGPT.
7. Create a new post-registration ChatGPT conversation and successfully execute `load_case_context` with the real IDs.

These are external deployment/authentication actions and were not authorized by this task. Official OpenAI references: [Build an MCP server](https://developers.openai.com/plugins/concepts/mcp-server), [MCP authentication](https://developers.openai.com/plugins/build/auth), and [Connect from ChatGPT](https://developers.openai.com/plugins/deploy/connect-chatgpt).
