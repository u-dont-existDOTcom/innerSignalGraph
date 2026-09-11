# Prior-work scan — Universal Handoff Binding v1.0

Decision: **COMPOSE + ADAPT**.

The current repository already has the necessary lower-level primitives: an AES-256-GCM dual-wrap case vault, authorization-before-key access, exact source chunk manifests, immutable candidate versions, append-only transcript, structured state/diffs, tracker/journal storage, recent-episode selection, historical retrieval, a read-only MCP bridge, and structured state/diff UI controls.

The missing product layer is a first-class immutable handoff artifact and its lifecycle. In particular, the existing `createPrivateCaseHandoff` produces only a small reference record after continuity is already green; it does not compile or encrypt a snapshot, resolve from `handoff_id`, expose tracker/journal retrieval, create a portable encrypted export, or prove the >100k Session A/Session B binding regression.

This task therefore reuses the existing vault and access model, adds the missing handoff compiler/locator/retrieval/export seams, and retains the existing real-case and external ChatGPT blockers. No new external persistence service or GitHub-backed runtime is introduced.
