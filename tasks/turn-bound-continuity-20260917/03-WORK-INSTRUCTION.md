# Work instruction — implement turn-bound InnerSignal continuity

## Controlling objective

Implement the architecture in this package so a continuing case can use prior evidence without the operator repeatedly reminding the reasoner of its history. Implement the mechanical path and run the smallest actual-consumer tests that can disprove success. Preserve native ChatGPT reasoning as the preferred profile; do not turn this into an undisclosed paid API application.

**Role:** bounded implementation and evidence collection. Architectural decisions, therapy semantics, model/billing changes, acceptance interpretation, and unresolved product trade-offs belong to the reasoning supervisor. Do not write patient-facing therapeutic responses as a substitute for integrating the system.

**Recommended executor:** GPT-6 Astra, Low thinking, for the cross-file integration and recovery work below. A source inventory or verbatim file import alone can use GPT-5.6 Sol Low. These are routing recommendations, not claims that a model is already configured. Read the live routing rule; escalate only after diagnosing a concrete execution failure. Never substitute the execution model for the therapeutic writer or independent semantic auditor.

**Assurance lane:** Iteration until an actual merge, installation, deployment or release boundary. The complete project gates still apply at their declared boundary, not after every edit.

## Inputs and authority

Repository: `u-dont-existDOTcom/innerSignalGraph`.

Inspected development baseline: `bf35a23dc0146c21586108fed0f726c50db8c436`; tree `574ca1a676f1fce57dd5b36109f9d808c73ad8bb`. This is a reproducible inspection baseline, not permission to reset a newer branch.

Read, in order:

1. Live default-branch `AGENTS.md` in `u-dont-existDOTcom/universal-dev-architecture`, then only task-triggered rules in its authority order. Required task topics: execution routing, Work effort, task-time enforcement, assurance lanes, test efficiency, requirement accretion and owner-facing delivery.
2. Target `AGENTS.md`, `.github/codex-repository.json`, `state/CODEX-CURRENT-STATE.md`, `README.md`, `AUTOPILOT.md`, `docs/INDEX.md`, and `docs/INSTRUCTION-CONSUMER-MAP.md` at the current authoritative development head.
3. This package: `01-ARCHITECTURE.md`, `02-INTERFACES.md`, this directive, `04-VERIFICATION-PLAN.md`, `05-PRIOR-WORK-AND-SOURCES.md`, and `reference/README.md`.
4. The exact incumbent files listed under Architecture §3 and Interfaces §10. Inspect their callers and tests before editing. The relevant plugin is `plugins/inner-signal-therapy`, not a guessed similarly named folder.

No private case content is supplied in this public-safe packet. Do not search public Git for a real client's transcript or treat prior conversational summaries as original private evidence. Do not reproduce a real client's combined history in a public regression fixture.

## Phase A — recover, measure, and inspect the actual host

Create an isolated task branch/worktree from current development authority. Check for an existing task branch/checkpoint for this exact objective; resume it instead of creating duplicates. Preserve unrelated branches and changes. Record the actual base commit and comparison against the inspection baseline.

Import this package into one task directory, for example `tasks/turn-bound-continuity-20260917/`, retaining filenames and the manifest. Keep generated test logs in that task's declared artifact area, not inside product source. Do not blindly copy the reference into `src/`.

Start test-cost observation before implementation. Use the canonical Universal `scripts/test_efficiency.py`, or a verified equivalent with command, input fingerprint, tier, duration, exit code and unchanged-green suppression. The package observer only covers the isolated reference run; it is not a replacement for repository-wide measurement.

The inspected repository declares Node 24.18.0. Use the actual current `.nvmrc` and supported bootstrap (`npm ci --ignore-scripts` at the inspection baseline). Run only a focused baseline initially. Inspect `package.json` and existing test layout before selecting exact test filenames.

Produce `CAPABILITY-RECEIPT.json` with separate server and host observations for:

- Current InnerSignal plugin identity, exposed continuity tools, authentication result, and whether a fresh host session is necessary after configuration changes.
- Read-only case access; application write scope; controlled component tool calls; component-to-native-chat message dispatch; native exact candidate submission.
- Independent reviewer dispatch, actual supported model/effort evidence, genuinely separate context, and returned evidence under the existing accepted provenance standard.
- Billing route, permission/confirmation boundary, exact approved-artifact rendering, reconnect behavior and durable status.

Allowed values are `verified`, `documented_not_tested`, `unavailable`, `unknown`, with exact evidence. An empty tool catalog is not proof a server is down. A server health check is not proof a particular ChatGPT conversation exposes its tools. A same-chat follow-up message is not a separate reviewer. Codex hooks and Work subagents are not automatically ordinary ChatGPT capabilities.

Use synthetic content only for a bounded host probe when the host is already authorized. Do not extract cookies, call undocumented private ChatGPT endpoints, borrow another user's session, bypass confirmations, or make paid provider calls. A required user authentication gesture is a genuine gate; finish independent work first and report the one exact action.

**Do not wait for host availability to implement the independent offline data and admission changes. Do not mark native end-to-end success if the host probe fails.**

## Phase B — extend the existing data path

Implement the following within current validators and encrypted persistence:

1. Exact inbound records distinguish authenticated submitter, attributed speaker, relay/paraphrase status, trusted receipt time and unknown claimed send time. Keep original bytes unchanged.
2. Separate record bookkeeping revision, semantic evidence revision, and immutable artifact version. Check revocation against current authorization. Derive legacy metadata conservatively; never turn unknown provenance into verified provenance.
3. Prepare effective amended source text, the full semantic active episode, current spine, question state and source/index watermarks before candidate generation.
4. Feed the incoming message and active topic into older-source retrieval, including raw sources not already marked high relevance. Preserve required state/episode evidence, source neighborhoods, corrections, relationship counterparts and explicit omissions.
5. Keep full-history input as the measured small-history baseline. Use local lexical/alias/relationship retrieval before adding an external index or embedding service. Do not introduce new paid infrastructure.
6. Compile an immutable prepared-context manifest and persist it against the exact inbound and evidence revision. Compute digests server-side. Return explicit incomplete coverage rather than silent truncation.
7. Stage candidate-generated state patches as proposals. Do not allow an unaudited model inference to become canonical case evidence or the reviewer's trusted premise. Reuse incumbent proposal/adjudication surfaces rather than inventing another approval subsystem.

Reference code demonstrates selected pure predicates only. Integrate equivalent behavior into the incumbent services and preserve public/private boundaries. Specifically inspect whether `record.raw_transcript` in the producer path already reflects completion amendments; change it only if the consumer test proves a gap.

## Phase C — bind actual generation, review and release

Extend the current context builder and all applicable formulation/planning/realization call sites so the prepared evidence reaches the actual writer, not just an unused return field. Trace the exact inputs in a synthetic test.

Add the compact context-use structure: source IDs, historical relationship now relevant, uncertainty/currentness, answered-question disposition, and next-focus relation to the ongoing agenda. It is an evidence/decision summary, not hidden chain-of-thought. Keep it out of the patient-facing prose.

The native profile must pause at `READY_FOR_DRAFT` and accept an immutable native candidate submission. It must not fall through to `runTieredTherapyPipeline` or another provider call. The API profile may use the existing provider runtime only when separately authorized and explicitly selected.

For review, preserve the existing fresh packet-only standard and accepted external-provenance route. Prepare review evidence from the original input and case sources independently of the writer's selected snippets. Persist the writer packet digest and the separately prepared audit packet digest against the same evidence revision. Do not force their source sets to be identical.

Bind audit to exact candidate ID/version/digest, turn, evidence revision and both applicable context identities. Register identity/provenance through trusted backend/operator authority. Do not accept a writer-supplied `independent=true` or a freeform self-described model name as proof. Do not add a new cryptographic attestation requirement to an already accepted external audit route.

Retain at most two substantive repair cycles and existing invocation retry ceilings. Distinguish operational error, semantic failure and inconclusive evidence. Revalidate the final discriminator against current evidence and episode policy. Preserve normal immediate safety support during technical failure; it is not an audited therapy candidate unless actually admitted.

Perform authorization, freshness, exact-byte and audit checks in the same serialized operation that records release. Inspect the existing store's concurrency controls before adding a new locking mechanism. Test a real overlapping-update scenario; do not assume a process-local mutex provides cross-process safety.

## Phase D — native component and truthful ordinary-chat fallback

Use one user-facing InnerSignal plugin and existing host/services. The read-only continuity MCP remains read-only. New mutating application commands have correct scopes and annotations; no secret/token material in tool arguments.

For component implementation, fresh-read the current design repository skill and relevant project/surface rules. Preserve existing product identity and tokens. This package specifies behavior, not a visual redesign. Use the documented current MCP Apps standard bridge and metadata; use documented compatibility aliases only when required by the actual host.

The component must:

- Persist controlled input before dispatching a native request; retain the one case binding until genuinely changed.
- Use one idempotency key for retry/resume of the same submission; never duplicate a source event after a timeout.
- Show server-derived stages and a concise actual blocker. Restore phase from canonical status, not from a missing draft.
- Render and copy the exact released language variant. Mark drafts, advisory native prose, pending audit and released artifacts differently. Do not fabricate a verified badge.
- Distinguish displayed, copied, operator-reported-sent and externally delivered. Never claim to have sent a WhatsApp/email/message when only text was shown or copied.
- Support keyboard operation, readable long text, error recovery, cancellation and reconnect without inventing case progress.

Ordinary native chat remains available. Update only the appropriate plugin/project instruction using the supplied compact activation candidate: retrieve current case context for each case-related turn, disclose failures, and avoid claiming controlled coverage for off-path messages. This is behavioral assistance, not a universal interception hook.

If automatic subscription-only independent reviewer dispatch is unavailable, leave it truthfully unavailable. Complete the mechanical path and native drafting/component improvements, then return the exact remaining choice to the reasoning supervisor. Do not silently enable paid APIs, replace the requested reasoning model with Work, or require a new Mission Control deployment to claim completion.

## Phase E — verification at the consumer boundary

Run the package reference tests only as a reproducibility check. Then add focused tests to existing repository tests for the integrated behavior. Use the matrix in `04-VERIFICATION-PLAN.md`, including actual prompt assembly, old raw evidence absent from the summary, later corrections, complete episode, forged receipt, same-context audit, language changes, concurrent updates and replay.

Run the native synthetic host cases without exposing `evals/gold.json` to the writer. Do not use a mock provider result as semantic or native-host evidence. A deterministic local test can verify a supplied reviewer FAIL blocks release; it cannot prove that a real reviewer will detect a subtle history omission.

Record metrics separately: source recall, evidence use, overclaim/contradiction rate, redundant questions, operator reminders, latency, calls/cost, and unresolved operational boundaries. Missing host/model evidence stays `NOT_RUN` or `UNKNOWN`, not PASS. Use a bounded synthetic pilot before any real case.

Run required complete repository, graph/lesson and publication gates at the actual merge/release boundary as current project rules require. No `stable` change, installation, deployment, live real-case migration, or paid inference is authorized by this directive.

## Checkpoints, output and stop conditions

Maintain one `INTEGRATION.md` and machine-readable `EXECUTION-RECEIPT.json` in the task directory. Update at meaningful phase boundaries, not after every command. A minimum receipt contains actual base/head, changed files, configured/observed executor, commands and test fingerprints, results, test-time share, capability observations, private-data access, paid-call count, root gap, and next executable action.

Use these completion labels distinctly:

- `DESIGN_IMPLEMENTED_OFFLINE`: source/integration tests pass; host route unproven.
- `NATIVE_DRAFT_PATH_VERIFIED`: actual controlled input and native candidate submission verified.
- `AUDITED_NATIVE_FLOW_VERIFIED`: actual separate native reviewer and exact release verified.
- `OWNER_OUTCOME_VERIFIED`: frozen no-reminder consumer cases passed under the agreed profile, with limitations recorded.

A green compile, stored source, successful audit invocation, or copied instruction does not establish the last label. Report counts, failed cases and remaining unknowns; do not invent a numeric universal reliability guarantee.

Pause only the affected action for missing permission, spending/model choice, destructive migration, inaccessible secrets, release/deployment authority, conflicting current owner requirements, or a material design question. Continue independent safe work. Return source evidence and the smallest discriminator to the reasoning supervisor rather than redesigning the product inside Work.

Deliver the implementation diff/PR, capability receipt, test results and concise residual decision. Do not leave a vague draft PR as the only recovery record. Keep the primary objective open until the actual user's route is proven, or the owner explicitly accepts a narrower outcome.
