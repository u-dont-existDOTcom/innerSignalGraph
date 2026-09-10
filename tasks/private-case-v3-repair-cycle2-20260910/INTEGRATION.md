# Private v3 repair cycle 2

Status: active on draft PR #49, branch `codex/private-case-import-20260909`, starting from exact head `a98f9f7d46ed8233cf638b76121d7b293ccef9b4`.

## Objective

Persist the externally supplied exact-v2 failure without fabricating unavailable auditor metadata, reconstruct the owner-supplied exact v3 as the maximum repair cycle, and publish a new immutable read-only handoff for a fresh independent audit.

The real candidate and audit material remains outside Git. This ledger may record only generic behavior, opaque identifiers after persistence, and non-content state facts.

## Recovery ledger

- Starting branch/head verified clean.
- Existing v1/v2 lineage and immutable handoff are the only authorized private baseline.
- No private mutation occurs until schema/runtime changes pass focused synthetic tests.
- Unknown-identity external audit evidence must be failure-only and never approval-sufficient.
- v3 must have zero audits and closed approval/sent gates at closeout.

## Remaining checkpoints

1. Add backward-compatible external-audit provenance enforcement and tests.
2. Run focused and full public verification.
3. Deploy exact implementation checkpoint to the private host.
4. Apply and verify the exact private v2-fail/v3-reconstruction/handoff sequence.
5. Verify read-only exact-v3 retrieval from a fresh independent ChatGPT session without auditing it.
6. Publish a content-free receipt and canonical continuation handoff, rerun privacy checks, commit, push, and verify exact-head PR state.
