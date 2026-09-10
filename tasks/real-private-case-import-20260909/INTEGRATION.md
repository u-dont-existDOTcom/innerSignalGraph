# Real private-case import and fresh-session continuity

Status: `FRESH_SESSION_GREEN`; exact candidate audit is next. Draft PR #49 remains open, draft, and unmerged on `codex/private-case-import-20260909`, starting from `main` at `fabc5b582e8b725248c37b44e5189e51653c9d82`.

The owner supplied the complete private human-gold baseline, later corrections, exact recent episode, exact pending candidate, and a bounded execution sequence through private task attachments. Those private bytes and their hashes must remain outside Git.

## Execution layers

1. Lossless source and correction import into encrypted private storage.
2. Exact candidate, transcript, state/diff, provenance, and restart verification.
3. Generic oversized-source ingestion regression and public/private leak gates.
4. Strongest available case-scoped auth/key boundary and reachable MCP.
5. ChatGPT registration plus a genuinely fresh tool call.
6. Exact candidate audit only after layer 5 succeeds.

Each layer retains its own result. Local success cannot certify a later external layer.

## Current evidence

- The owner-approved combined source, human-gold baseline, later Correction B source, six supplied recent turns, and pending candidate were imported outside the checkout into an AES-256-GCM private vault.
- Local import assurance remains truthfully `development_external_file`. The hosted path uses Keycloak OAuth JWT verification, an exact MCP resource audience, `case:read`/`case:audit`, a server-side subject-to-case ACL checked before managed key release, an encrypted read-only vault mount, and HTTPS through the owner-controlled Netcup host. Secrets and private payloads remain outside Git.
- A separate Node process reopened the store using only the stable case ID and authorized external credential path. The complete source, baseline, corrections, recent turns, candidate, last diff, current episode, and provenance-addressed older source all matched exactly. Private lengths and hashes are retained only in the private receipt.
- Stable owner-authorized identifiers: case `case-57a69465-4434-41cf-ad24-310b13a2cc81`; pending candidate `candidate:pending:50804229-a5b2-4760-b956-4e5926a56051`.
- The fixed exchange-count gate was replaced by semantic active-episode completeness. The exact contiguous supplied episode from its declared start through the latest user turn is complete; the unsent candidate remains a separate pending artifact rather than invented transcript history.
- Real handoff `handoff:92f179eb-299a-47cf-87de-43791d95bf70` was created, encrypted, reopened, and loaded by a separate client process using only that ID plus ambient authorization. Its exact recent episode and exact pending candidate matched the private source.
- Hosted provider code verifies OAuth JWT signature, issuer, audience, expiry, scope and subject-to-case ACL before a managed-secret key provider can release case keys. The MCP publishes protected-resource metadata, per-tool OAuth schemes, and runtime reauthorization challenges.
- The live service at `https://private-mcp.185-233-106-15.sslip.io/mcp` passed issuer, PKCE S256, protected-resource metadata, token audience/scope/ACL, managed-key decryption, exact candidate, exact episode, and unauthorized fail-closed verification without emitting private content.
- ChatGPT plugin `InnerSignal Private Continuity` connected through OAuth. Brand-new conversation `6aa28621-3a20-83e9-93b8-640d6054cdf3` was given only the handoff ID, called `load_handoff`, and reported the complete six-turn active episode and exact unsent pending candidate rather than a reconstructed summary. The same immutable hosted packet independently matched the private source exactly. This is `FRESH_SESSION_GREEN`.
- The public synthetic oversized-source regression verifies exact Unicode and mixed-newline reconstruction across restart and rejects missing, duplicated, reordered, or altered chunks.
- Local verification passed: focused storage/auth/MCP checks, uniform OAuth denial tests, full Node 24 suite 1038/1038, graph regressions 29/29, therapy lessons 5/5, repository and publication audits, and the complete package verification command. Pre-closeout head `1359470b45290d372a9a2c5d876ec046b2860e99` also passed hosted deterministic-package Verify, workflow-policy, CodeQL, and codeql-javascript.

## Remaining boundary

Fresh ChatGPT availability is now directly verified. The remaining supervisor task is to audit the exact pending candidate through `load_handoff` before choosing a new therapeutic direction. The candidate remains `pending_audit` and unsent. The fresh acceptance chat identified possible structured-state reconciliation issues but made no private-store mutation; the supervisor-defined gold state remains canonical until an authorized correction is applied.

The separate all-hosted-history publication audit is also incomplete: GitHub returns `log not found` for pre-existing failed CodeQL run `34060739398` from 2026-09-06, identified by the auditor as `actions-run:234:log`. The auditor therefore fails closed with zero certified hosted records. This is not a detected private-content finding and does not replace the required exact-head PR checks, which must be read directly from the current PR head.

## Safety boundary

Do not commit private source, credentials, tokens, private manifests, or private-derived hashes. Do not treat the pending candidate as sent history. Do not merge, deploy the public app, promote stable, or claim clinical validation.
