# Real private-case import and fresh-session continuity

Status: ACTIVATION IN PROGRESS on draft, open, unmerged PR #49 from `codex/private-case-import-20260909`, starting from current `main` at `fabc5b582e8b725248c37b44e5189e51653c9d82`.

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
- The local assurance is truthfully `development_external_file`: a mode-`0600` external credential file supplies case-scoped bearer grants and per-case key material only after authorization; it is not production auth. The vault and parent storage directory are mode `0600`/`0700` respectively.
- A separate Node process reopened the store using only the stable case ID and authorized external credential path. The complete source, baseline, corrections, recent turns, candidate, last diff, current episode, and provenance-addressed older source all matched exactly. Private lengths and hashes are retained only in the private receipt.
- Stable owner-authorized identifiers: case `case-57a69465-4434-41cf-ad24-310b13a2cc81`; pending candidate `candidate:pending:50804229-a5b2-4760-b956-4e5926a56051`.
- The fixed exchange-count gate was replaced by semantic active-episode completeness. The exact contiguous supplied episode from its declared start through the latest user turn is complete; the unsent candidate remains a separate pending artifact rather than invented transcript history.
- Real handoff `handoff:92f179eb-299a-47cf-87de-43791d95bf70` was created, encrypted, reopened, and loaded by a separate client process using only that ID plus ambient authorization. Its exact recent episode and exact pending candidate matched the private source. This is `READY_FOR_FRESH_SESSION_TEST`, not ChatGPT proof.
- Hosted provider code verifies OAuth JWT signature, issuer, audience, expiry, scope and subject-to-case ACL before a managed-secret key provider can release case keys. The MCP publishes protected-resource metadata, per-tool OAuth schemes, and runtime reauthorization challenges.
- The public synthetic oversized-source regression verifies exact Unicode and mixed-newline reconstruction across restart and rejects missing, duplicated, reordered, or altered chunks.
- Local verification passed: focused private continuity 11/11; affected context, audit, UI, and private tests 34/34; full Node 24 suite 1034/1034; graph regressions 29/29; therapy lessons 5/5; repository and publication audits; and the complete package verification command.

## Honest blocking boundary

The semantic continuation gate and local fresh-process handoff load are green. Fresh ChatGPT availability still requires a live HTTPS/tunnel deployment with a configured OAuth issuer and host-managed case keys, ChatGPT registration/connection, and `load_handoff` execution from a newly created conversation given only the stable handoff ID. The handoff remains `READY_FOR_FRESH_SESSION_TEST` and the candidate audit has not run.

The separate all-hosted-history publication audit is also incomplete: GitHub returns `log not found` for pre-existing failed CodeQL run `34060739398` from 2026-09-06, identified by the auditor as `actions-run:234:log`. The auditor therefore fails closed with zero certified hosted records. This is not a detected private-content finding and does not replace the required exact-head PR checks, which must be read directly from the current PR head.

## Safety boundary

Do not commit private source, credentials, tokens, private manifests, or private-derived hashes. Do not treat the pending candidate as sent history. Do not merge, deploy the public app, promote stable, or claim clinical validation.
