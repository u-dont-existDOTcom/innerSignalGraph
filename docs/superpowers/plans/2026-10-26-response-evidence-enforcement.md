# Response evidence enforcement — implementation plan

Status: **implementation-ready proposal; steps below have not been implemented by this document**.

Authority: [design specification](../specs/2026-10-26-response-evidence-enforcement.md), [issue #195](https://github.com/u-dont-existDOTcom/innerSignalGraph/issues/195), current project guidance, and the owner's request to develop this architecture. This is an engineering plan, not a runtime therapy prompt. Baseline: `09a0f5af80fbf80ea985ce49347a7d66565d546d`.

## Result to preserve

An unsent supervisor draft must never be treated as delivered client history. Relevant personal history must actually be available to the auditor, and to the writer for backend-produced candidates, before a materially history-dependent claim or recommendation is approved. Original-writer exposure for an external draft remains explicitly unattested. The exact approved text must be the text exported by the controlled supervisor workflow or delivered by the application.

Do not substitute a protocol update, a new boolean, a larger model, a green schema test, or a server-only gate for that outcome. The free-form host boundary remains explicit: an external ChatGPT response is not mechanically controlled merely because the connector returns a protocol or an audit result.

## Engineering decisions already made

- Reuse the existing encrypted case store, immutable candidates, independent auditor, bounded repair, provider isolation, generation-aware retrieval, and writer locks.
- Create a trusted evidence snapshot before dependent model calls. Bind source availability, actual request inclusion, relevant communication state and exact candidate bytes.
- Apply one shared validator at authoritative store approval/export/delivery operations, including both current audit-persistence paths.
- Extend the existing auditor's structured output with complete source-support coverage. Use the whole exact candidate, including questions and materially history-dependent recommendations.
- Prior source-backed turns can satisfy history needs. Journal lookup is conditional on relevance and authorization, not a ritual on every reply.
- Retain two candidate repair cycles; allow one reviewed fallback attempt, then an explicit bounded terminal result. Never reset limits through retrieval or a different endpoint.
- Build the controlled supervisor draft/export adapter on the same backend. Export is not client sending. An unambiguous authenticated owner report of sending is sufficient for reported delivery.
- Keep private receipts private. No new database, remote telemetry stream, full journal reimport, external messaging integration, or default additional judge is needed.

## Slice 1 — Normalize communication evidence and close delivery inconsistencies

### Source changes

- Add the typed communication/delivery projection near the existing private candidate/continuity code.
- Extend the encrypted record validator and corresponding public schemas for additive audience/source/evidence metadata and explicit unknown legacy values.
- Normalize `candidateDeliveryCompletion` so transcript-bound runtime deliveries and ordinary deliveries resolve consistently.
- Update `deliverPrivateRuntimeCandidate` to bind the inbound turn and transcript identity consistently with `deliverCandidateResponse`.
- Keep `markCandidateSent` status-only for compatible recovery; ensure it cannot generate a stronger delivery projection or authorize new enforced candidates.
- Represent owner-reported historical delivery without inventing an earlier audit. Reconcile the contract in the separate unmerged historical-delivery proposal; do not import its stale state files wholesale.

### Tests at the consumer seam

Extend `tests/private-candidate-lifecycle.test.mjs`, `tests/private-case-continuity.test.mjs`, `tests/private-therapy-runtime.test.mjs`, and orchestration tests as affected. Verify exact unsent/sent pairs, owner-reported sending, ambiguous reports, supervisor/client audiences, runtime completion, and idempotent replay. Call the real store delivery methods in synthetic encrypted stores; do not test only a projection helper.

**Slice completion:** authoritative context distinguishes draft/exposed/exported/reported-sent/app-committed states. No claim that relevant history enforcement is complete yet.

## Slice 2 — Trusted response-evidence snapshot and bounded retrieval adapter

### Source changes

- Proposed shared module: `src/supervisor/response-evidence-contract.mjs`, with schema validation, deterministic binding, source-reference validation, and the common admission result. Keep semantic truth out of this validator.
- Add a small snapshot builder using trusted store projections and the established pre-production case state. Reuse `evidence-authority.mjs` so proposed extractions cannot corroborate themselves.
- Extend `src/supervisor/private-therapy-turn-controller.mjs` to persist an explicit evidence snapshot/disposition before the first writer invocation. Preserve existing completed-invocation reuse after restart.
- Implement a bounded provider behind the existing `journalEvidenceProvider.freezeForTurn` seam using the authorized journal service and `session_use` purpose. A missing provider produces an explicit unavailable state, not an invented retrieval.
- Freeze full relevant source excerpts and communication projection, not just a hash. Record exact immutable locators, snapshot/generation/visibility, scope, source actor, dates, coverage and omissions.
- Request at most the existing 8,000 journal tokens and enforce the current 64,000-byte cap. Reserve current episode and audit context; test a single overlarge quotation. Reuse snapshot/purpose/query caching and bound any additional retrieval within the same per-turn budget.

### Tests at the consumer seam

Extend `tests/journal-continuity.test.mjs`, `tests/private-therapy-model-runtime.test.mjs` and new focused contract tests. Capture the actual synthetic provider request and assert that exact authorized excerpts reached writer/auditor/repair with identical snapshot identity. Exercise missing permission, wrong case, source correction, partial index, no match, budget exhaustion, one oversized quotation, and replay after a simulated restart.

**Slice completion:** retrieval/inclusion can be evidenced. This is not proof the model used sources correctly. The production provider stays disabled until its existing source-consent and release criteria are met.

## Slice 3 — Source-support report and shared admission enforcement

### Source changes

- Extend `src/schemas/private-runtime.mjs` and `schemas/private-case/candidate-audit-v1.schema.json` through a versioned successor/migration contract rather than silently reinterpreting old PASS records.
- Update `src/prompts/private-runtime-audit.mjs` and repair input to require the five design coverage dimensions. The writer's declaration of “no history” cannot exempt the text.
- Bind exact client-language spans, sources, snapshot, policy and candidate identity in the auditor report. Validate references/UTF-8 boundaries mechanically and derive blocking findings from report contents.
- Every `unsupported`/`contradicted` item in the five source-support dimensions and every unresolved material-history dependency blocks. Ordinary style severity remains separate; do not let an unstructured materiality label waive the new checks.
- Preserve the fresh packet-only auditor and current privacy isolation. Do not supply producer hidden reasoning, prior desired verdict, or repository governance in the packet.
- Call the common validator in **both** `recordCandidateAudit` and `commitPrivateRuntimeAudit`, then recheck it in approval/export/delivery under trusted store mutation.
- Store review and dependency identities with the candidate lineage. Use effective content projections rather than the entire record revision, which changes during audit bookkeeping.
- Normalize the current inbound once across runtime storage and its later transcript insertion. Candidate-owned proposed state changes must not stale the established-history snapshot or become corroborating evidence. Independent amendments/new turns still invalidate; preserve the separate current safety binding.
- Reauthorize at release/export; reject stale inbound, corrected delivery history, revoked source access, or mismatched generation/visibility. Preserve stale result evidence without delivering it.

### Tests at the consumer seam

Inject an empty generic PASS without coverage; a forged receipt; a source from another case; an unrelated but genuine quotation; unsupported advice findings; candidate bytes changed after audit; and a source/delivery correction arriving between audit and commit. Verify refusal from low-level store methods, not just from the controller wrapper. Verify valid prior-turn support, accurate uncertainty and bookkeeping-only revision changes remain usable. Exercise the real snapshot→first candidate commit→audit→delivery path so the controller's own inbound insertion/proposed-state update does not invalidate every turn.

**Slice completion:** the controlled lifecycle rejects missing/mismatched evidence and detected support failures. Semantic detection still needs the separate behavioral evaluation.

## Slice 4 — Fallbacks, liveness and recovery

### Source changes

- Extend fallback/discriminator representation to carry the exact-text support review and current evidence binding.
- Replace the assumption that a stored one-line question is inherently acceptable. Audit the actual question, including historical presuppositions.
- Preserve the current two-repair bound. A single fallback attempt either passes or terminates explicitly; retrieval expansion and endpoint changes cannot restart the budget.
- Prioritize current-message threat/safety handling without waiting for optional journal retrieval. The baseline has model-pipeline safety guidance, not a verified independent offline urgent-help service; retain truthful operational failure when inference/review is unavailable. Do not add a model-controlled emergency flag or an unapproved canned clinical response.
- Verify the actual process-owner/root-lock topology; route any new operator/writer through it. Keep the shared in-process coordinator as a separate layer.

### Tests at the consumer seam

Use a final failed candidate and a fallback with an unsupported historical premise, plus a matched neutral fallback. Simulate auditor outage and retrieval outage separately. Verify truthful terminal status, no unbounded model/retrieval loop, no lost already-completed stage and no duplicate delivery. With the model path available, missing journal data must not delay current-message safety handling; with required inference unavailable, expect an honest operational result, not an invented offline service. Run a narrow competing-process test with the actual root-lock path.

**Slice completion:** evidence failures cause bounded repair/narrowing without a new bypass or a global support outage.

## Slice 5 — Controlled supervisor draft/export on the same service

This slice is essential because the reported mistakes occurred in a supervisor's host chat.

### Source changes

- Implement the internal prepare/submit/review/export/report-sent operations specified in the design using existing private orchestration/access boundaries.
- Add the controlled artifact/copy surface to the existing application (`apps/web/` and `src/server/create-server.mjs`), using the same stored exact candidate. Do not stand up a separate host just for this control.
- Support a supervisor revision as a different input type from a client inbound message. Persist sender/source/audience from authenticated context; a client-provided field cannot impersonate the owner.
- Distinguish `external_draft` from `backend_produced`. For the former, attest exact received bytes and auditor source inclusion while marking original-writer inclusion `not_attested`; admit supported text after full audit without a pointless rewrite for provenance.
- Bind the full client-language artifact and the supervisor translation separately. Export the exact reviewed client artifact; any client-language edit must be resubmitted for review. Translation review checks meaning as well as exact output identity.
- Add owner-reported sending only when explicitly reported. Bind a trusted owner-message event or deliberate owner UI/operator action; an authenticated agent's bare assertion is not proof of owner authorship. Where the host supplies only an agent-relayed report, keep that weaker origin and the retained source. Resolve the unambiguous existing draft without another routine confirmation. Preserve actual send time as unknown if it was not supplied.
- Treat any MCP draft adapter as a separately reviewed extension with narrow submission/audit permissions; do not upgrade the existing read-only continuity service or its auditor to general `case:write`.
- Never add a client-send action merely to complete this slice. Transmission to another person needs explicit authorization.

### Tests at the consumer seam

Exercise the real server-to-artifact/copy route. Check that only approved exact bytes are copied, edited bytes have no inherited approval, the English companion is not marked client-sent, stale artifacts cannot be exported after revocation, and an owner report of sending is distinct from export. Test externally authored text without host-request attestation and an authenticated model trying to fabricate an owner event. Verify attempts to call mutation through the old read-only MCP remain denied.

**Slice completion:** the approved artifact workflow is enforceable. Arbitrary host prose outside it remains outside the guarantee and is labeled accordingly. A protocol instruction alone cannot satisfy this slice.

## Slice 6 — Behavioral evaluation and staged release

### Bounded semantic evaluation

Use synthetic cases; do not reopen private journals. Freeze the rubric and paired cases before inference. Include original failure shapes in different wording, valid counterexamples, questions with presuppositions, history-dependent advice with no overt historical assertion, incomplete search, source conflict, and French/English translation variants.

Compare the current generic audit against the evidence-aware version while holding case sources and candidate text constant. Then evaluate the complete writer→audit→repair→export path on a smaller representative set. Report false approvals, unnecessary blocks, repair success and added latency/token volume separately. Instrument/retrieval failures are not semantic false negatives. Do not infer a universal reliability rate from a small passing sample.

Use only authorized provider routes and existing budgets. If a required provider is unavailable, preserve deterministic progress and mark model detection unmeasured. A scripted auditor that returns the expected finding verifies propagation, not detection.

### Release boundary

Before merge/release, run the exact project gates applicable to changed code, required independent final review, privacy checks and hosted required checks on the containing commit. `main` remains development and `stable` remains installation authority. Reconcile a scoped release against current stable divergence; do not promote unrelated development work.

Retain the previous runtime image and storage compatibility. A new service version must not silently migrate a real case, add source authorization or broaden connector permissions. Rollback must preserve already committed historical records without mislabeling their approval strength.

Add a content-free capability/version readback sufficient to distinguish `advisory`, `internal_runtime_enforced`, and `supervisor_export_enforced`, plus whether an authorized journal provider is configured. A label is not proof: run a synthetic unauthorized/unsupported candidate through each claimed production exit and observe refusal; run its valid counterpart and observe exact approved export. Existing health/protocol identity alone does not prove the new gate ran.

**Issue completion:** close #195 only when its required runtime and supervisor-artifact paths are implemented and tested at their actual consumers, production claims match deployment evidence, and any remaining external-host limitation is explicit. Publishing this architecture does not close the issue.

## Verification discipline

Use the project's pinned Node runtime and locked dependencies. Route test commands through the canonical UDA test-efficiency observer or a verified equivalent. Focused and affected suites are the inner loop; full verification belongs at the actual merge/release checkpoint. Avoid another unchanged full run for reassurance.

For this architecture-only change, verify the document links, source references, requirements/acceptance coverage, privacy of the changed diff, and the repository integrity bindings. Do not fabricate runtime test results for proposed behavior. Existing targeted tests may establish baseline facts but cannot prove an unimplemented control.

## Recovery handoff

Start with the task checkpoint and exact branch, then read the design and this plan. Confirm current `main`/`stable` and any active worker before code changes. Preserve the historical-delivery proposal and the journal worker's independent source/import scope. The first implementation step is Slice 1; it can be built and tested entirely on synthetic encrypted records without source migration, a paid provider call, or production access.
