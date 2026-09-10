# Private case continuity and fresh-session access

Status: draft PR #49 extends the encrypted case store with the InnerSignal Universal Handoff Binding v1.0. Synthetic acceptance proves an immutable encrypted handoff can be created in Session A and loaded in a separate Session B using only `handoff_id` plus authorized transport context, including a history larger than 100,000 characters split into deterministic chunks no larger than 20,000 bytes. The real owner-supplied source passed exact encrypted import, semantic active-episode completeness, immutable handoff creation, separate-process exact round trip, hosted OAuth/ACL/key retrieval, and an actual brand-new ChatGPT `load_handoff` call given only its stable handoff ID. Independent comparison against the same immutable hosted packet matched the exact candidate and complete recent episode, so this real handoff is `FRESH_SESSION_GREEN`.

## Acceptance contract

A case is continuation-safe only when an authorized loader, starting with no prior session memory, can use a stable case ID to recover all of the following:

1. current structured case state;
2. the last state diff;
3. the exact active therapy episode from its declared semantic start through the latest turn, with no missing, reordered, foreign-episode, or truncated turns;
4. the exact versioned candidate response selected by stable candidate ID or `current_pending`;
5. older raw turns by query, provenance/item ID, or time range;
6. the current therapeutic episode; and
7. the constitution version/reference, without copying the constitution into the case.

`loadCaseContext`, `loadHandoff`, and the MCP `load_case_context` / `load_handoff` tools enforce this gate. They fail with `CASE_NOT_CONTINUATION_SAFE` rather than returning a public fixture, a summary, a hash, or regenerated prose when a required artifact is absent. `Create Handoff` may still freeze an incomplete snapshot, but it is labeled `BLOCKED_CONTINUATION_UNSAFE`; local encrypted round-trip alone remains `PENDING_FRESH_SESSION`, never `FRESH_SESSION_GREEN`. None of these APIs returns hidden model reasoning.

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

Each immutable handoff is stored separately as a mode-`0600` encrypted envelope below the private root. The handoff contains a canonical snapshot, component hashes, exact deterministic component chunks with contiguous byte ranges, and a retrieval index. An authorized loader can therefore reconstruct an oversized component without treating one source read larger than the 20,000-byte handoff ceiling as available. Private mode-`0600` locator records map opaque handoff or candidate IDs to the case required for authorization; they contain routing metadata only, never therapy text, candidate text, state, journal/tracker content, secrets, or private-derived payload hashes. A production implementation should place this locator mapping in its authenticated private database rather than a public or client-controlled store.

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
| `createHandoff` / `loadHandoff` | Freeze and retrieve an immutable exact private continuation snapshot; the loader needs only `handoff_id` |
| `getStateDiffByReference` / `getRecentVerbatimByReference` | Read current or handoff-frozen state diff and exact recent episode |
| `getPendingCandidateByReference` | Resolve exact text using only `candidate_id` or `handoff_id` |
| `getTrackerWindowByReference` / `getJournalEntriesByReference` | Query current or handoff-frozen longitudinal records without causal promotion |
| `exportHandoff` | Export the already-encrypted handoff envelope as a portable private fallback |

Candidate audit code in `src/supervisor/private-candidate-audit.mjs` accepts a candidate ID, resolves the exact private text through `loadCaseContext`, and only then invokes an auditor.

## Encryption and key-provider model

Each case is one mode-`0600` AES-256-GCM envelope below a mode-`0700` private root. A random data-encryption key is wrapped twice: once by a 32-byte routine key and once by a recovery key derived from the user-held recovery secret with Argon2id. Ordinary authorized updates decrypt the wrapped data key with the routine key, replace the encrypted payload with a fresh IV, and preserve both key wraps. The recovery secret is required to create a new envelope but need not be released for routine reads or updates. There is no plaintext fallback.

The access service accepts two injected boundaries:

- `authorizationProvider.authorize({ caseId, authContext, requiredScope })` returns an authenticated principal and case-scoped `case:read`, `case:write`, or `case:audit` grants.
- `keyProvider.getCaseKeyMaterial(...)` returns routine key material only after the provider's unlock/reauthentication policy succeeds. A recovery secret may additionally be returned when a case is created.

The bundled development provider is deliberately not production security. It reads one non-symlink mode-`0600` JSON file outside the repository, matches SHA-256 bearer-token digests in constant time, scopes grants by case, and loads per-case test keys. It reports `productionReady: false` and returns the explicit `development_external_file` assurance. The access service rejects that assurance unless its local-only `allowDevelopmentFileProvider` switch was deliberately enabled; it never presents the file as OS-backed reauthentication.

Hosted mode uses `src/storage/hosted-private-case-providers.mjs`. It verifies every JWT signature against the configured JWKS and requires the exact issuer, resource audience, expiration, requested OAuth scope, authenticated subject, and a server-side subject-to-case ACL before key acquisition. Case keys are supplied by the host's managed secret boundary through `INNER_SIGNAL_CASE_KEYS_JSON`, copied only after authorization, zeroized on close, and removed from the child process environment after provider construction. The encrypted vault itself resides at the volume-backed absolute `INNER_SIGNAL_PRIVATE_ROOT`; it must remain outside the public checkout. This is a production-capable resource-server/key-provider boundary, not evidence that any particular host or identity-provider configuration is live.

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

For hosted mode, configure the deployment platform's secret manager rather than a repository `.env` file:

- `INNER_SIGNAL_PRIVATE_ROOT`: absolute mounted private volume path;
- `INNER_SIGNAL_MCP_RESOURCE`: canonical public HTTPS resource identifier;
- `INNER_SIGNAL_OAUTH_ISSUER`, `INNER_SIGNAL_OAUTH_AUDIENCE`, and `INNER_SIGNAL_OAUTH_JWKS_URI`: established identity-provider values;
- `INNER_SIGNAL_CASE_ACL_JSON`: subject-to-case/scopes grants;
- `INNER_SIGNAL_CASE_KEYS_JSON`: secret per-case routine/recovery key material; and
- `PORT`: host-assigned listening port.

Run `npm run private-case:mcp:hosted`. The server binds on `0.0.0.0`, publishes RFC 9728 protected-resource metadata, advertises per-tool OAuth schemes, emits MCP authentication challenges, and reports production auth ready only in hosted provider mode. The identity provider must independently provide OAuth 2.1 authorization-code flow, PKCE S256, issuer identification, resource/audience echo, and CIMD, DCR, or a pre-registered ChatGPT client.

## Executable repository bridge

Start the separate read-only MCP service with the external development credential file:

```bash
npm run private-case:mcp -- --credentials /absolute/private/bridge-credentials.json --port 0
```

The process prints a local `/mcp` URL. Authentication is an HTTP bearer token supplied by the transport, never a tool argument. Its read-only tools are:

- `load_handoff`
- `load_case_context`
- `get_state_diff`
- `get_recent_verbatim`
- `retrieve_case_evidence`
- `get_pending_candidate`
- `get_tracker_window`
- `get_journal_entries`
- `get_candidate_response`
- `get_source_artifact`

A fresh client normally performs this exact bootstrap call after transport authentication:

```json
{
  "name": "load_handoff",
  "arguments": {
    "handoff_id": "<stable-handoff-id>"
  }
}
```

The returned packet includes its `case_id`, pending candidate IDs and exact text, canonical state, frozen diff, exact recent episode, complete transcript archive, tracker/journal records, version references, retrieval index, and continuation evidence. The caller can then use the narrower tools. `load_case_context` remains available for live case-ID bootstrap and `retrieve_case_evidence` can query the returned `case_id` by text, provenance IDs, or time range.

The full executable gate is `npm run private-case:acceptance`. It creates an external temporary private store in Session A, compiles an immutable handoff, exits that process, deletes candidate/case expectations from the child environment, and has independent Session B recover exact text using only the stable handoff ID and authorized test transport. Its synthetic longitudinal history exceeds 100,000 characters; Session B reconstructs the transcript component from contiguous exact chunks, each no larger than 20,000 UTF-8 bytes. The test compares the decision-relevant continuation projection as well as exact candidate/recent-turn content. It also tests denied authorization, missing/wrong keys, ciphertext at rest, full-episode retention, historical retrieval, exact candidate audit, blocked acceptance, public-path leak prevention, and lossless Unicode/newline reconstruction. Chunk manifests reject gaps, duplication, reordered chunks, altered byte ranges, and changed bytes.

The ordinary loopback web server remains unsuitable as a private ChatGPT boundary because its development endpoints do not implement user authentication. It was intentionally not given raw transcript or candidate inspectors. The existing **Current saved state** and **What changed this turn** views remain structured/no-raw-content controls; exact **Recent Verbatim** and **Pending Candidate** inspection is available only through the authorized read-only MCP tools.

## First-class private handoff format

`compilePrivateHandoffArtifact` in `src/storage/private-case-handoff.mjs` canonicalizes one immutable packet containing:

- canonical state and current episode/path;
- the last state diff, or explicit `null` when the handoff is blocked;
- exact recent turns selected directly from the private transcript;
- every currently pending exact candidate version;
- the full private transcript archive and tracker/journal snapshot;
- constitution, runtime, and audit version references;
- indexes for transcript, tracker, journal, intervention, adverse-event, historical-decision, and source-artifact IDs; and
- component byte counts/hashes plus contiguous 20,000-byte-or-smaller artifact chunks.

The packet is wrapped as an exact artifact, encrypted with the existing dual-wrap case keys, stored outside Git, reopened, and compared byte-for-byte before `local_round_trip_verified` can be true. `load_handoff(handoff_id)` resolves the private locator, authorizes the resolved case before obtaining key material, decrypts and validates every identity/integrity relationship, and then applies the continuation gate. A missing or incorrect grant/key fails without falling back to a public or de-identified substitute.

The older `createPrivateCaseHandoff` reference-only record remains for compatibility, but it is not the Universal Handoff artifact or its fresh-session evidence.

The owner-authorized opaque identifiers for the present import are `case-57a69465-4434-41cf-ad24-310b13a2cc81`, `candidate:pending:50804229-a5b2-4760-b956-4e5926a56051`, and `handoff:92f179eb-299a-47cf-87de-43791d95bf70`. The private payload and immutable handoff round-trip exactly from a separate process using only the handoff ID plus ambient authorization. Its active episode is complete from the declared semantic start through the latest supplied turn. The hosted read-only service is `https://private-mcp.185-233-106-15.sslip.io/mcp`; ChatGPT plugin `InnerSignal Private Continuity` connects through Keycloak OAuth with PKCE S256, exact issuer/resource audience, `case:read` and `case:audit`, subject-to-case ACL enforcement before managed key release, and no plaintext fallback. Fresh ChatGPT conversation `6aa28621-3a20-83e9-93b8-640d6054cdf3` received only the handoff ID, invoked `load_handoff`, and reported the complete six-turn episode plus the exact unsent pending candidate. Private receipts retain the independent exactness comparison without publishing private bytes or private-derived hashes. This handoff is `FRESH_SESSION_GREEN`; candidate audit remains pending.

## Hosted production/ChatGPT acceptance evidence

Repository-local success alone does not make a tool callable from a new ChatGPT conversation. The real handoff passed every external layer on 2026-09-10:

1. Hosted mode runs behind stable HTTPS with a publicly reachable dedicated Keycloak identity provider.
2. OAuth discovery exposes the exact issuer, authorization/token/JWKS endpoints, PKCE S256, resource audience, and the pre-registered ChatGPT CIMD client identifier and redirect URI.
3. The owner-controlled host injects the case key and subject-to-case ACL from a mode-`0600` secret environment outside Git; the provider removes raw key JSON from the child environment after construction and zeroizes its in-memory copies on close. The ciphertext vault/handoff is mounted read-only from mode-`0600` files. A future platform secret-manager migration can harden host operations further without changing the provider contract.
4. ChatGPT plugin `InnerSignal Private Continuity` is registered, OAuth-connected, and scoped to `case:read` plus `case:audit`.
5. A new post-registration ChatGPT conversation received only the real `handoff_id` and executed `load_handoff`.
6. A separate hosted OAuth loader compared the same immutable response's exact candidate and recent turns with the private source; both matched and an unauthorized request returned no private content.

The pending candidate remains unsent and awaiting its substantive audit. Official OpenAI references: [Build an MCP server](https://developers.openai.com/plugins/concepts/mcp-server), [MCP authentication](https://developers.openai.com/plugins/build/auth), [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels), and [Connect from ChatGPT](https://developers.openai.com/plugins/deploy/connect-chatgpt).
