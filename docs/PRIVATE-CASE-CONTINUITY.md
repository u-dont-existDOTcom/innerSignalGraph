# Private case continuity and fresh-session access

Status: merged PR #49 extends the encrypted case store with the InnerSignal Universal Handoff Binding and its complementary private mutation/audit orchestration path. `InnerSignal Private Continuity` remains deliberately read-only. Synthetic acceptance proves an immutable encrypted handoff can be created in Session A and loaded in a separate Session B using only `handoff_id` plus authorized transport context, including a history larger than 100,000 characters split into deterministic chunks no larger than 20,000 bytes. It also proves append-only transcript completions, immutable candidate versions, exact-version audits, bounded reconstruction, independent-auditor separation, and explicit approval/sent transitions. The real owner-supplied source remains outside Git.

## Acceptance contract

A case is continuation-safe only when an authorized loader, starting with no prior session memory, can use a stable case ID to recover all of the following:

1. current structured case state;
2. the last state diff;
3. the exact active therapy episode from its declared semantic start through the latest turn, with no missing, reordered, foreign-episode, or truncated turns;
4. the exact versioned pending candidate response, or an exact transcript-bound delivery completion after the candidate is sent;
5. older raw turns by query, provenance/item ID, or time range;
6. the current therapeutic episode; and
7. the constitution version/reference, without copying the constitution into the case.

`loadCaseContext`, `loadHandoff`, and the MCP `load_case_context` / `load_handoff` tools enforce this gate. They fail with `CASE_NOT_CONTINUATION_SAFE` rather than returning a public fixture, a summary, a hash, or regenerated prose when a required artifact is absent. `Create Handoff` may still freeze an incomplete snapshot, but it is labeled `BLOCKED_CONTINUATION_UNSAFE`; local encrypted round-trip alone remains `PENDING_FRESH_SESSION`, never `FRESH_SESSION_GREEN`. None of these APIs returns hidden model reasoning.

## Candidate audit and reconstruction gate

`src/supervisor/private-candidate-lifecycle.mjs` is the binding runtime rule. Audit approval is tied to the exact candidate ID, version, and encrypted exact-byte digest. Any substantive repair or reconstruction creates a new immutable child candidate in `reconstructed_pending_audit`, supersedes its parent, starts with no audit evidence or approval, and blocks delivery until that exact version passes a fresh independent audit and receives exact-version delivery approval. A parent audit never certifies changed bytes. The reconstruction producer cannot serve as its independent auditor, and a same-context self-critique cannot create delivery approval.

The independent audit of a reconstructed candidate must explicitly check causal overclaim, leading presuppositions, overly specific homework/tracking, verbosity/repetition, reduced information gain, safety inflation or underreaction, telos/steering drift, history omissions, hypothesis rigidification, unjustified treatment or behavior recommendations, and replacement of one problem with another. After two repair cycles, unresolved substantive/high findings route to the smallest discriminating question, explicit uncertainty, or blocked delivery; a third reconstruction is rejected.

Structured audit output produced by an independent auditor can be persisted later by the backend through `persistPrivateCandidateAuditResult`; the auditor-facing continuity service itself receives no mutation tool. `src/supervisor/private-case-orchestration.mjs` owns the retry-safe append/audit/reconstruction/handoff/approval/sent sequence. Its operator CLI accepts only protected files outside the checkout and a transport-owned token from the environment. See `docs/superpowers/specs/2026-09-10-private-case-mutation-orchestration.md`.

For ordinary app use, `src/supervisor/private-therapy-turn-controller.mjs` now owns the complete lifecycle behind the single `/v1/therapy/respond` request. It first persists an encrypted exact inbound record, produces an immutable candidate, starts a packet-only inference request whose actual provider response/session identity differs from the producer, binds the resulting audit to the exact candidate ID/version/digest, and atomically approves and delivers only a sufficient PASS. A substantive FAIL is persisted and automatically enters a separate repair context followed by another fresh audit. Two repair cycles are the hard maximum; a final substantive FAIL produces the current episode's one-line discriminating question and never creates a third repair. Operational invocation failures are retried only within `PRIVATE_RUNTIME_INVOCATION_ATTEMPTS` and otherwise return a concise failure without exposing or delivering the candidate.

The controller is restart-safe because semantic transitions and invocation attempts live in the encrypted record. Completed invocation output needed for recovery remains inside that record, not in a public ledger or HTTP error. A replay of an already delivered runtime-turn ID returns the exact persisted delivery without another model call. This automatic path replaces owner-mediated movement of candidates, audits, and handoff IDs during ordinary therapy; the backend-only operator CLI remains available for explicit migration/recovery work.

Handoff fidelity remains separate from candidate-audit and reconstruction-audit fidelity. Newly compiled private handoffs include a `candidate_lifecycle` component with the current candidate ID/version, parent and lineage, status, current version-bound audit status, previous findings, reconstruction-audit status, and delivery block. Schema-v3 handoffs created after delivery also include a `delivery_completion` projection whose candidate digest, approving audit, assistant turn, replied-to user turn, and timestamp are validated against the exact persisted transcript. Pre-binding immutable handoffs remain readable but carry no inferred approval; their pending candidate must pass the current fresh audit gate.

## Public/private boundary

Public Git contains the schemas, code, tests, synthetic fixtures, constitution, and this operational contract. It must not contain real transcript text, exact real candidate replies, credentials, key bytes, bearer tokens, or private-derived hashes. Opaque stable case/candidate identifiers may appear in a handoff only when the owner explicitly authorizes that disclosure; an identifier never proves that its payload is available.

The private store keeps separate fields for:

- append-only exact transcript turns (`id`, `exchange_id`, `role`, `text`, `at`, and optional `episode_id`);
- immutable completion amendments that bind a preserved raw turn to an exact source-artifact byte range and produce a deterministic effective transcript;
- provenance-aware structured state;
- state-diff history;
- tracker and journal data;
- immutable exact candidate versions and their status;
- append-only automatic runtime-turn state, invocation evidence, discriminator, and exact delivery records;
- immutable exact source artifacts plus a lossless byte-range/chunk integrity manifest; and
- current episode state through the structured record.

Each immutable handoff is stored separately as a mode-`0600` encrypted envelope below the private root. The handoff contains a canonical snapshot, component hashes, exact deterministic component chunks with contiguous byte ranges, and a retrieval index. An authorized loader can therefore reconstruct an oversized component without treating one source read larger than the 20,000-byte handoff ceiling as available. Private mode-`0600` locator records map opaque handoff or candidate IDs to the case required for authorization; they contain routing metadata only, never therapy text, candidate text, state, journal/tracker content, secrets, or private-derived payload hashes. A production implementation should place this locator mapping in its authenticated private database rather than a public or client-controlled store.

Ordinary reasoning ledgers now default to `redacted`; that form excludes user-facing response text, case formulation, audit prose, and reasoning evidence. The automatic private controller forces the underlying candidate pipeline ledger off and persists its recovery state only in the encrypted case record. `LEDGER_MODE=full` remains an explicit operator choice for non-private diagnostics and is not the private case persistence mechanism.

## Repository interfaces

`src/storage/private-case-access.mjs` authorizes before requesting keys and exposes these operations:

| Operation | Meaning |
| --- | --- |
| `beginPrivateRuntimeTurn` / `getPrivateRuntimeTurn` | Persist the exact encrypted inbound before inference and restore its executable lifecycle frontier |
| `recordPrivateRuntimeInvocationEvent` / `transitionPrivateRuntimeTurn` | Append retry/restart evidence and enforce the explicit state graph |
| `commitPrivateRuntimeCandidate` / `commitPrivateRuntimeAudit` | Atomically persist immutable candidate/state or exact-version audit plus approval/repair/discriminator transition |
| `savePrivateRuntimeDiscriminator` | Freeze the final episode-permitted one-line discriminator after repair cycle 2 |
| `deliverPrivateRuntimeCandidate` / `deliverPrivateRuntimeDiscriminator` | Atomically append exact assistant bytes and the terminal sent/delivery state |
| `saveCaseState` / `getCaseState` | Structured case state only |
| `saveCaseDiff` / `getCaseDiff` | Versioned turn-associated diffs |
| `appendTranscriptTurn` / `getRecentVerbatim` | Append-only raw turns and exact recent episode |
| `appendTranscriptCompletionAmendment` / `getTranscriptAmendments` | Persist an immutable completion source plus provenance-bound amendment; read the amendment ledger |
| `saveCandidateResponse` / `getCandidateResponse` | Immutable original candidate versions and `current_pending` / `current_candidate` resolution |
| `recordCandidateAudit` / `getCandidateLifecycle` | Persist exact-version audit evidence and expose the current version-bound gate |
| `reconstructCandidateResponse` | Create an immutable child version in `reconstructed_pending_audit`; never edit or reactivate the parent |
| `approveCandidateForDelivery` / `deliverCandidateResponse` | Enforce fresh exact-version approval, append the exact assistant response, and bind sent state to the approving audit and user turn |
| `markCandidateSent` | Retained legacy status-only transition for compatible operator recovery; ordinary and migrated deliveries use transcript-bound delivery |
| `updateCandidateStatus` | Legacy/manual surface restricted to explicit supersession; it cannot bypass audit, approval, or delivery gates |
| `saveSourceArtifact` / `getSourceArtifact` | Immutable exact private source plus a contiguous byte-range integrity manifest |
| `retrieveCaseEvidence` | Raw older turns by query, stable provenance IDs, or time range |
| `getCurrentEpisode` | Current therapeutic path/episode |
| `loadCaseContext` | All-in-one fresh-session bootstrap and continuation-safety gate |
| `createHandoff` / `loadHandoff` | Freeze and retrieve an immutable exact private continuation snapshot; the loader needs only `handoff_id` |
| `getStateDiffByReference` / `getRecentVerbatimByReference` | Read current or handoff-frozen state diff and exact recent episode |
| `getPendingCandidateByReference` | Resolve exact text using only `candidate_id` or `handoff_id` |
| `getTrackerWindowByReference` / `getJournalEntriesByReference` | Query current or handoff-frozen longitudinal records without causal promotion |
| `exportHandoff` | Export the already-encrypted handoff envelope as a portable private fallback |

Candidate audit code in `src/supervisor/private-candidate-audit.mjs` accepts a candidate ID, resolves the exact private text through `loadCaseContext`, invokes the configured independent auditor, derives rather than trusts the pass/fail status, and persists the resulting evidence against that exact candidate version.

An externally supplied fresh-audit FAIL may be ingested when the external auditor/session identifier or exact completion time is unavailable. Those facts are stored explicitly as unavailable, never as fabricated identifiers or timestamps. Separate structured provenance records the owner-authorized source, receipt time, and the exact producer context from which independence was reported. This exception is fail-closed: it requires a blocking finding, can never be sufficient for approval, and cannot authorize delivery. A passing approval audit still requires a known context distinct from the candidate producer and a known completion time.

The public schemas for transcript amendments, candidate versions, candidate audits, automatic therapy-turn lifecycles, and backend operation requests are in `schemas/private-case/`. Schemas describe transport/storage shape; runtime validators additionally enforce cross-record integrity, exact byte digests, lineage, independence, event replay, and allowed state transitions.

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

The ordinary local app activates the encrypted automatic controller when these process-private settings are present:

- `INNER_SIGNAL_PRIVATE_RUNTIME_MODE=development`;
- `INNER_SIGNAL_PRIVATE_RUNTIME_CREDENTIALS=/absolute/outside-repository/credentials.json`; and
- `INNER_SIGNAL_PRIVATE_CASE_OPERATION_TOKEN`, supplied through the process environment rather than a URL, request body, or Git-tracked file.

Hosted app mode uses `INNER_SIGNAL_PRIVATE_RUNTIME_MODE=hosted` plus the managed private-root/OAuth/ACL/key settings below. Each request supplies its bearer token. Both modes compose the same authorization-first access service; the key provider is never consulted before case/scope authorization. The runtime needs `case:read`, `case:write`, and `case:audit`. This does not add mutation scopes or tools to the read-only MCP.

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

No private mutation operation is registered as an MCP tool. Backend/operator mutation runs separately through `npm run private-case:operations` and requires `case:write` or `case:audit` at the existing access boundary.

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

The full executable gate is `npm run private-case:acceptance`. It creates an external temporary private store in Session A, compiles an immutable handoff, exits that process, deletes candidate/case expectations from the child environment, and has independent Session B recover exact text using only the stable handoff ID and authorized test transport. Its synthetic longitudinal history exceeds 100,000 characters; Session B reconstructs the transcript component from contiguous exact chunks, each no larger than 20,000 UTF-8 bytes. The test compares the decision-relevant continuation projection as well as exact candidate/recent-turn content. It also tests denied authorization, missing/wrong keys, ciphertext at rest, full-episode retention, historical retrieval, exact candidate audit, blocked acceptance, public-path leak prevention, lossless Unicode/newline reconstruction, automatic one-message delivery, repair/re-audit, self-certification denial, maximum-cycle discrimination, bounded retry, and restart persistence. Chunk manifests reject gaps, duplication, reordered chunks, altered byte ranges, and changed bytes.

The loopback web server is not a replacement for the authenticated ChatGPT MCP boundary and intentionally has no raw transcript or candidate inspectors. When its private-runtime environment is configured, ordinary therapy requests do pass through the authorization-first encrypted mutation controller; without that configuration, non-mock therapy fails closed rather than silently using session-only storage. The existing **Current saved state** and **What changed this turn** views remain structured/no-raw-content controls; exact **Recent Verbatim** and **Pending Candidate** inspection remains available only through the authorized read-only MCP tools.

## First-class private handoff format

`compilePrivateHandoffArtifact` in `src/storage/private-case-handoff.mjs` canonicalizes one immutable packet containing:

- canonical state and current episode/path;
- the last state diff, or explicit `null` when the handoff is blocked;
- exact recent turns selected directly from the private transcript;
- every currently pending exact candidate version, or an exact persisted delivery completion after sending;
- exact current candidate lineage, audit state, previous findings, and delivery/await-next-turn gate;
- the full private transcript archive and tracker/journal snapshot;
- the preserved raw transcript archive, immutable completion-amendment ledger, and deterministic effective transcript;
- constitution, runtime, and audit version references;
- indexes for transcript, tracker, journal, intervention, adverse-event, historical-decision, and source-artifact IDs; and
- component byte counts/hashes plus contiguous 20,000-byte-or-smaller artifact chunks.

For a sent candidate, schema-v3 packets carry no pending artifact. Instead, `delivery_completion` binds the exact transcript bytes to the sent candidate ID/version/digest, approval audit, assistant turn, replied-to user turn, and delivery time. A mismatch at any of these surfaces makes the packet invalid rather than continuation-safe.

The packet is wrapped as an exact artifact, encrypted with the existing dual-wrap case keys, stored outside Git, reopened, and compared byte-for-byte before `local_round_trip_verified` can be true. `load_handoff(handoff_id)` resolves the private locator, authorizes the resolved case before obtaining key material, decrypts and validates every identity/integrity relationship, and then applies the continuation gate. A missing or incorrect grant/key fails without falling back to a public or de-identified substitute.

The older `createPrivateCaseHandoff` reference-only record remains for compatibility, but it is not the Universal Handoff artifact or its fresh-session evidence.

The owner-authorized opaque identifiers for the pre-audit private state are case `case-57a69465-4434-41cf-ad24-310b13a2cc81`, superseded v1 `candidate:pending:50804229-a5b2-4760-b956-4e5926a56051`, superseded v2 `candidate:repair:f45e8a19-47b5-49fb-8a14-c5c66482875c`, v3 `candidate:repair:abdd6d89-68fa-4e4e-bb89-96b7d206327b`, and historical handoff `handoff:da297f25-1ae4-4494-b8e1-63591e438d88`. The raw target turn remains byte-identical; an immutable source artifact and provenance-bound completion amendment supply the effective transcript without overwriting it. Failed audits remain bound to their exact immutable candidate versions. The externally supplied v2 FAIL preserves unavailable auditor identity/time explicitly and cannot authorize approval. V2 is superseded, not approved, and not sent. The authoritative fresh independent v3 audit has a known context distinct from its producer, is persisted against exact v3 with the complete repair-induced checklist, and passed without a blocking finding. V3 was explicitly approved and delivered unchanged as an exact assistant transcript turn. A new continuation-safe schema-v3 handoff binds that sent response to the candidate, audit, replied-to user turn, and delivery time; its private identifier and all private-derived hashes remain outside Git. The next action is `AWAIT_NEXT_USER_TURN`.

## Hosted production/ChatGPT acceptance evidence

Repository-local success alone does not make a tool callable from a new ChatGPT conversation. The real handoff passed every external layer on 2026-09-10:

1. Hosted mode runs behind stable HTTPS with a publicly reachable dedicated Keycloak identity provider.
2. OAuth discovery exposes the exact issuer, authorization/token/JWKS endpoints, PKCE S256, resource audience, and the pre-registered ChatGPT CIMD client identifier and redirect URI.
3. The owner-controlled host injects the case key and subject-to-case ACL from a mode-`0600` secret environment outside Git; the provider removes raw key JSON from the child environment after construction and zeroizes its in-memory copies on close. The ciphertext vault/handoff is mounted read-only from mode-`0600` files. A future platform secret-manager migration can harden host operations further without changing the provider contract.
4. ChatGPT plugin `InnerSignal Private Continuity` is registered, OAuth-connected, and scoped to `case:read` plus `case:audit`.
5. A new post-registration ChatGPT conversation received only the real `handoff_id` and executed `load_handoff`.
6. A separate hosted OAuth loader compared the same immutable response's exact candidate and recent turns with the private source; both matched and an unauthorized request returned no private content.
7. After the provenance amendment and v2 reconstruction, another newly created ChatGPT conversation received only the v2 handoff ID, called the read-only tool, and confirmed exact v2 retrievability plus the closed fresh-audit gate without quoting or mutating private material.
8. After the externally supplied v2 FAIL and maximum-cycle v3 reconstruction, a further new ChatGPT conversation received only the v3 handoff ID and confirmed exact v3 lifecycle metadata, zero audits, and the closed fresh-audit gate through the same read-only tool without quoting or mutating private material.
9. The completed independent v3 audit was resolved to a known authoritative conversation context distinct from the producer, persisted as an exact-version PASS, explicitly approved, and delivered unchanged. The resulting private schema-v3 handoff validates the exact transcript-bound delivery and awaits the next user turn.

Candidate v3 is sent after an approval-sufficient exact-version audit; there is no pending candidate and no re-audit or repair action. Official OpenAI references: [Build an MCP server](https://developers.openai.com/plugins/concepts/mcp-server), [MCP authentication](https://developers.openai.com/plugins/build/auth), [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels), and [Connect from ChatGPT](https://developers.openai.com/plugins/deploy/connect-chatgpt).
