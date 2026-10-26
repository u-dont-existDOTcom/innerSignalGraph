# InnerSignal therapy plugin 0.2.2 — 26 October 2026

Scope: update only the packaged advisory plugin and three reviewed reference files, from development PR #197. Stable predecessor: `7b412184a1403114c0df0271ae496217366b3e05`; prior live protocol: `ac72686048f564440296c9a34bf02718837f0ba0134ba8d0e6418e593961b97d`. Preserve the existing backend image, private data, credentials and previous plugin for rollback. No unrelated `main` changes, no journal import and no public-guide publication.

Release gates: pinned stable plugin blobs and full package CI; independent final diff review; exact stable commit and tree; candidate protocol hash computed by the canonical loader; offline layer validation; service-only transactional activation with rollback; post-restart health and live protocol readback. A stable merge is not proof of deployment.
