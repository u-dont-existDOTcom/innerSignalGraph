# InnerSignal Universal Handoff Binding v1.0

Status: `FRESH_SESSION_GREEN`; exact candidate audit remains next. Draft PR #49 remains open, draft, and unmerged on `codex/private-case-import-20260909`, starting from `44819602ad147b1ee670d46b4d1672ce05951871` after exact local/remote reconciliation.

## Owner outcome

Implement the owner-supplied public binding as a GitHub-independent private encrypted handoff lifecycle. A new authorized process should normally need only `handoff_id`; stored or same-process evidence must never be labeled `FRESH_SESSION_GREEN`.

## Implemented composition

1. Immutable encrypted handoff artifact compiled from the current private case record.
2. Private opaque-ID locator that resolves `handoff_id` or `candidate_id` to a case before case-scoped authorization; it contains no therapy payload.
3. Authorized store/access/MCP operations for handoff, state diff, recent exact episode, pending candidate, older evidence, tracker, and journal retrieval.
4. Local UI controls for Create Handoff and encrypted portable export with truthful readiness language.
5. A >100k-character deterministic-chunk regression with a 20k source-read simulation and a separate Session B that receives only `handoff_id`.

## Direct evidence

- `compilePrivateHandoffArtifact` freezes canonical state, the latest diff, the exact complete active episode, current exact pending candidates, full private transcript history, tracker/journal records, retrieval indexes, and constitution/runtime/audit references. Canonical component manifests and contiguous artifact chunks reject altered or inconsistent content.
- Each handoff is a separate mode-`0600` AES-256-GCM dual-wrap envelope under a mode-`0700` private root. The ordinary routine key is provider-supplied after authorization; the user-held recovery secret creates the independent recovery wrap. Missing or wrong material has no plaintext/public fallback.
- Private opaque locator files let `load_handoff(handoff_id)` and candidate-ID retrieval resolve the case before case-scoped authorization. Locators contain only ID routing metadata and stay outside Git; production must use its authenticated private database for this mapping.
- The read-only MCP surface now exposes `load_handoff`, `load_case_context`, `get_state_diff`, `get_recent_verbatim`, `retrieve_case_evidence`, `get_pending_candidate`, `get_tracker_window`, `get_journal_entries`, `get_candidate_response`, and `get_source_artifact`. Bearer credentials remain transport-owned, never tool arguments.
- The local UI has Current Saved State, What Changed This Turn, Create Handoff, and Export Private Handoff. A locally round-tripped ready packet is explicitly “not complete until FRESH_SESSION_GREEN”; an incomplete packet is stored and displayed as `BLOCKED_CONTINUATION_UNSAFE`. Raw recent turns and candidate text remain absent from the unauthenticated local UI.
- Session A created a synthetic history larger than 100,000 characters with multiple candidate versions, exact Unicode/newlines, contradictions, mixed trajectory, settled answers, a failed path, current consent/method state, tracker/journal history, older evidence, and a vivid latest-turn distraction. Session B ran in a separate process with only `handoff_id`, credentials-path configuration, and authorized bearer transport; candidate/case expectations were removed from its environment. It recovered exact candidate bytes, the exact full episode, all state, historical data, and a decision projection equal to Session A. Every compiled chunk was at most 20,000 UTF-8 bytes.
- Wrong bearer authorization and wrong routine keys failed without revealing the synthetic marker. The exported envelope contained no plaintext marker and decrypted exactly with the independent recovery secret.

## Verification

- Focused storage/security/MCP/UI/API suite: 42/42 tests passed at the host boundary.
- Complete package: `npm run verify` PASS on Node 24.18.0, including 1035/1035 automated tests, 29/29 graph regressions, 5/5 therapy lessons, authoring projection checks, immutable packet checks, syntax, runtime/web/autopilot smokes, and package hygiene.
- Repository audit: PASS with the inherited warning that GitHub App permissions remain unverified.
- Local publication audit: PASS, 158,932 records scanned, zero findings.
- Final exact-head GitHub checks and the separate hosted publication-history scan must be recorded after the containing commit is pushed. Earlier hosted history remained fail-closed because GitHub no longer served one old CodeQL run log; this was not a detected leak.

## 2026-09-10 semantic gate and hosted fresh-session acceptance

The owner superseded the fixed three-exchange quota with semantic active-episode completeness. The real exact episode is contiguous from its declared start through the latest supplied turn, so immutable handoff `handoff:92f179eb-299a-47cf-87de-43791d95bf70` passes the continuation gate. The owner-controlled Netcup deployment now hosts the encrypted read-only vault and private MCP behind Keycloak OAuth. The live path validates JWT signature, issuer, exact resource audience, expiration, `case:read`/`case:audit`, and a subject-to-case ACL before managed key release. Protected-resource discovery, PKCE S256, per-tool OAuth schemes, and uniform fail-closed challenges passed live verification.

ChatGPT plugin `InnerSignal Private Continuity` is OAuth-connected. Brand-new conversation `6aa28621-3a20-83e9-93b8-640d6054cdf3` received only the handoff ID, invoked `load_handoff`, and reported the saved state, later corrections, complete six-turn active episode, and exact unsent pending response rather than a reconstructed summary. A separate hosted OAuth call against the same immutable handoff independently compared the candidate and every recent turn to the private source exactly; unauthorized access returned no private content. The real handoff is `FRESH_SESSION_GREEN`. The candidate remains unsent and `pending_audit`; its exact audit is the next supervisor task.
