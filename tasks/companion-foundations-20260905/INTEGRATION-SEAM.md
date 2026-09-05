# Companion integration seam: freshness before interpretation

Status: offline implementation proposal, 2026-09-05. No real-history integration.
Owner continuation: the preview looked good; fictional-history opt-in was misplaced.

## Implemented

The history opt-in, example selector and reflection preference are grouped in the example workspace, not the invitation sidebar. The empty-state instruction points to the checkbox's new location. Label association, grouping and mobile layout are browser-tested.

Three fixed fictional corrections demonstrate replacing the visible source and invalidating the old interpretation. A corrected or withdrawn source cannot silently produce a cleaner version of the original scripted reading. Rejection/correction/withdrawal survive scenario and permission toggles within the demo. Explicit fictional reset reloads the authored fixture; it does not recover real deleted data.

`reflection-handoff.mjs` owns at most one opaque request ticket. `begin(check)` requires a synchronous literal true, superseding any earlier attempt. `consume(ticket, check)` checks ticket identity before calling the eligibility callback, rechecks current eligibility, and consumes the ticket exactly once even if that check fails. `invalidate()` makes every earlier ticket unusable. Restoring the prior scenario/permission is not restoration of a prior ticket. Reentrant context changes fail closed without erasing a newer request.

The mock uses this seam in its delayed-reflection controls. It invalidates before preferences, history, scenario, source correction/withdrawal, rejection, reset, a new immediate review, exit and restart. Page-hide clears the demonstration session. A stale delivery does not erase a newer displayed reading. No model, timer or network is involved.

## Real application responsibilities — not implemented

The caller must be a trusted controller, not an untrusted preference object or a model's assurance of permission. Vault access must come through the existing DEV-R005 boundary and OS-backed routine-access path when that architecture is ready. This seam neither unlocks a vault nor verifies a user's identity, and browser tickets must never be treated as server authorization.

Before generating or displaying a real reflection, obtain a permission-scoped current snapshot from the approved history source. Keep user reports, hypotheses and corrections distinct; bind episode/source versions; retrieve relevant complicating evidence; apply the existing permission/provenance gate. Do not import whole account histories or create a parallel storage backend.

Every material mutation must invalidate pending work and visible/derived interpretations before applying the new source or permission state. In particular, correction, deletion, consent withdrawal, user/scope change, logout, close and mandatory vault-lock events must invalidate work. Optional inactivity behavior remains the user's configured vault policy; this task sets no timeout. Unknown lifecycle events must follow the existing fail-closed vault route.

An async model or reviewer result must first pass the live request-freshness check, then a separate substantive semantic check bound to the exact current source snapshot and candidate text. A fresh ticket or a model-supplied `approved` flag cannot certify evidence completeness, meaning, honesty, safety or clinical benefit. After any asynchronous review, recheck freshness again before display. Define that multi-stage controller in a separate reviewed slice; the current guard covers one boundary, not an entire model pipeline.

Cancelling a ticket does not recall data already sent to a provider, erase browser/process memory, or delete persistent records. The upstream caller owns transport cancellation, provider disclosure/retention boundaries and deletion propagation. The guard stores no transcripts, evidence, source IDs, private-derived hashes, identity, or reply prose. No external data has been sent by this prototype.

## Current release boundary

This remains task-local code with synthetic fixtures only. Production code does not import it. No storage, vault, crypto, model roles, active prompts, guide graphs, Guide Packets, plugin, deployment, main merge, stable promotion or diagnostics change. Founder philosophy and secular terminology remain unchanged. The original 16 synthetic model-behavior cases are still unevaluated.

## Prior repository failure: investigation, not a claimed repair

PR #46 head `2a638d9089922380fc111898882d6f002c3c9b15`, merge `31aff11ea36562425dfa8bc5bb0919419254a8e2`, Verify run 33981730924, job 101348077366: 591/592 passed on Node 24.18.0. The failing publication-wrapper test expected exit 2 and observed 1 at tests/publication-audit.test.mjs:1595. The assertion occurs before its stderr assertion, so this log does not identify the failing shell command.

Read the exact wrapper and PR #32's repair/test diff. The wrapper already captures its incoming exit status, makes up to five cleanup attempts and restores that status after successful cleanup. Replacing it with the same repair would not diagnose the current failure. PR #38 also records a superficially similar 1-versus-2 wrapper-test failure, but it is not proof of the same cause. The current local environment still cannot resolve github.com for a full supported checkout. No unrelated test, workflow, retry budget or concurrency setting was changed.

Next focused diagnostic on a supported Node 24 checkout: reproduce the exact named publication-wrapper test and capture sanitized child exit/signal/stdout/stderr plus fixture stage markers on failure, then exercise it alongside the full suite. Do not log real scanner results, matched secrets or personal data. Preserve this historical failure even if the new head passes CI. A new green run does not establish that an intermittent defect was repaired.
