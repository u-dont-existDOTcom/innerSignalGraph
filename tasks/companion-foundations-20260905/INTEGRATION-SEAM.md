# Companion integration seam: freshness, provenance, and semantic review

Status: offline implementation proposal, 2026-09-05. No real-history integration.

## Revision-2 interface and one-boundary freshness guard

The fictional-history opt-in, example selector, and reflection preference are grouped in the progress/example workspace, not the invitation sidebar. Three fixed fictional corrections demonstrate replacing the visible source and invalidating an old interpretation. A corrected or withdrawn source cannot silently produce a cleaner version of the original scripted reading.

`reflection-handoff.mjs` owns at most one opaque request ticket. It stores no evidence, source IDs, private-derived hashes, identity, or prose. A newer attempt supersedes older work; a stale ticket is rejected before its callback; context/consent/source changes must invalidate pending work. The mock uses this only to demonstrate that an old delayed reply cannot overwrite newer state.

This seam checks request freshness only. It is not authentication, a memory store, a vault, transport cancellation, evidence extraction, or semantic review.

## Multi-stage reflection controller now implemented

`reflection-controller.mjs` and `synthetic-snapshot.mjs` add a task-local controller for synthetic snapshots. The controller deliberately separates four authorities:

1. **Snapshot authority:** the adapter captures a current immutable snapshot and opaque version.
2. **Eligibility/freshness authority:** the trusted caller confirms that the snapshot is still current and the current permissions allow work to continue.
3. **Drafting:** a draft may be created from that exact snapshot, but it has no display authority.
4. **Semantic review:** a separate reviewer must explicitly approve the exact candidate and echo the exact opaque snapshot version and review binding. Approval is denied by default.

The controller rechecks freshness after drafting, after semantic review, and immediately before returning `READY_FOR_DISPLAY`. A newer run or explicit invalidation supersedes old asynchronous work. Source or permission mutation blocks the old result. Exceptions and malformed results fail closed without returning draft prose.

An `approved: true` flag is insufficient unless bound by object identity to the exact candidate, version, and review boundary. This makes it harder for a stale, forged, or unrelated approval result to be confused with approval of the current candidate. The caller still owns actual display.

Critically, **deterministic freshness/provenance is not semantic approval**. A fresh request can still contain a poor, sycophantic, incomplete, misleading, or clinically inappropriate interpretation. Conversely, semantic review of an old candidate cannot make it current again.

## What semantic review must eventually evaluate

The controller does not define the substantive rubric. The next reviewed slice should define it separately. At minimum, the semantic reviewer should examine whether the draft:

- accurately distinguishes reported events, interpretations, and inferred motives;
- represents relevant mixed or complicating evidence rather than cherry-picking improvement;
- remains tentative where evidence is limited and does not manufacture longitudinal change;
- respects corrections, refusal, and the user's terminology;
- validates experience without automatic factual endorsement;
- preserves accountability without shame or reflexive blame-sharing;
- recognizes genuine development outside InnerSignal and outside the founder's preferred modalities;
- does not convert founder philosophy into an individualized clinical verdict;
- does not create dependency, a healing score, or an obligation to keep using the app;
- does not treat a spiritual impression, inner answer, or confidence as proof of factual authority.

Passing that rubric would still be evidence about a particular candidate/model run, not proof of clinical benefit.

## Real application responsibilities — not implemented

The caller must be a trusted controller. Real vault access must use the existing approved DEV-R005 boundary and OS-backed routine-access path when available. This work neither unlocks a vault nor verifies identity, and browser/controller tokens must never become server authorization.

Before drafting a real reflection, obtain a permission-scoped current snapshot from the approved history source. Keep user reports, assistant hypotheses, confirmations, and corrections distinguishable; bind episode/source versions; retrieve relevant complicating evidence; apply the existing permission/provenance gate. Do not import whole account histories or create a parallel storage backend.

Every material mutation must invalidate pending work and visible/derived interpretations before applying new state: correction, deletion, consent withdrawal, user/scope change, logout, close, mandatory vault-lock events, and any other context change that invalidates the snapshot. Optional inactivity remains governed by the user's configured vault policy.

After every asynchronous drafting or review stage, recheck current authorization and snapshot version before continuing. Cancelling controller work does not recall data already sent to a provider, erase process memory, or delete persistent records; the upstream integration owns transport cancellation, provider disclosure/retention constraints, and deletion propagation.

## Verification and limits

The local companion/controller suite passed 77/77 on Node v22.16.0. The controller and synthetic adapter contain no model/network/persistence/hash implementation. Revision-2 UI browser evidence remains 64 assertions on the exact v2 UI source; the controller itself is not wired into that UI or production.

The original 16 synthetic model-behavior cases remain unevaluated. No paid call, clinical review, model-level non-sycophancy claim, real history, deployment, merge, or stable promotion is authorized by this document.

## Historical unrelated Verify failure

Earlier PR #46 verification at head `2a638d9089922380fc111898882d6f002c3c9b15` had one publication-wrapper test failure (591/592 total). Its cause remains unproven. Preserve it for focused infrastructure diagnosis; do not weaken or edit unrelated audit controls to obtain a green companion PR.
