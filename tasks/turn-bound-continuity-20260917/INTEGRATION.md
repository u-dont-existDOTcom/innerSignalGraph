# Turn-bound continuity integration ledger

Updated: 2026-09-17T23:10:40+00:00

## Status

`DESIGN_IMPLEMENTED_OFFLINE`

Issue #72 remains open. The repository implementation and bounded synthetic consumer tests are complete for this iteration. The ordinary ChatGPT host route is not proven: the live connection exposed only the incumbent ten read-only tools, and a synthetic read probe stopped at reauthentication before returning any case content. No controlled component write command or native separate-reviewer route was exposed.

## Implemented

- Schema v7 separates record bookkeeping and semantic evidence revisions while preserving immutable artifact versions and conservatively migrating older runtime inputs.
- Exact inbound records bind original bytes, trusted receipt time, authenticated submitter when the access service supplies one, attributed speaker, source/relay status, claimed-send-time status, and idempotency identity.
- Turn preparation compiles the effective amended transcript, complete active episode, structured spine, question state, current-message retrieval, raw older evidence, source/index watermarks, full-history baseline, coverage, and a server digest. Oversized complete episodes stop with `CONTEXT_BUDGET_UNRESOLVED` rather than claiming complete coverage.
- The actual writer prompt receives the prepared evidence fields. The audit packet is selected independently from the original inbound and binds its own digest alongside the writer packet under the same evidence revision.
- Candidate-produced state remains a proposal. It becomes canonical only during the serialized exact release operation after candidate, audit, evidence revision, inbound, and current authorization epoch checks.
- Encrypted writes now use a bounded cross-process case lock in addition to the process-local queue.
- `native_controlled` pauses at `READY_FOR_DRAFT`, accepts one immutable exact native candidate, and remains `DRAFT_PENDING_REVIEW`; it cannot fall through to provider inference.
- The existing read-only MCP remains read-only. The private-continuity skill now refreshes evidence per case-related turn, reports tool/auth failures, and labels off-path controlled coverage unknown.

## Verification

- Package reference reproducibility: green; isolated reference only.
- Issue-specific integrated suite: 6/6 green.
- Affected persistence/access/runtime/prompt suite: 65/65 green.
- Repository private-case acceptance: 47/47 green.
- Repository audit: zero errors, one pre-existing warning that hosted GitHub App permissions remain unverified.
- Skill validation: green.
- Test-efficiency observation at final recorded summary: 126.05 seconds observed test time, 7.97% of task wall time, zero forced redundant green reruns.

The integrated cases cover actual writer-prompt assembly with an old raw source absent from short state, source-instruction isolation, a 130-turn amended active episode, explicit oversized-context blocking, zero-call native drafting, immutable candidate/language variants, forged audit binding, correction-after-preparation stale release denial, replay/idempotency, and eight overlapping processes at the encrypted persistence boundary.

No behavioral model evaluation ran. `evals/gold.json` was not supplied to a writer. Deterministic tests do not establish clinical usefulness, native-host tool invocation, or reviewer ability to detect subtle omissions.

## Host and cost boundary

- Private case content accessed: no.
- Synthetic host case content returned: no.
- Paid inference calls: 0.
- Real-case migrations: 0.
- Installations/deployments/stable promotions: 0.
- Native controlled component submission: not run.
- Separate subscription-funded native reviewer: unavailable/unknown.
- Exact released component rendering and reconnect: not run.

See `CAPABILITY-RECEIPT.json` for the separate server/host evidence matrix.

## Residual decision and recovery

The root gap is a supported host command/component route and genuinely separate native reviewer. Reauthentication is the smallest user gesture needed to resume read-only host probing, but it does not by itself expose the missing write/component commands. Under the current no-paid-inference and no-deployment constraints, the candidate must remain pending at the host boundary.

After PR review, the next authorized synthetic host step is: reauthenticate the existing InnerSignal connection, verify the fresh tool catalog, and test controlled intake/candidate submission only if a supported mutating application surface is actually exposed. If no native separate reviewer exists, the reasoning supervisor must choose an explicitly manual reviewer route or wait for supported native capability; this task does not silently select a paid API reviewer.

Resume by reading this ledger, `EXECUTION-RECEIPT.json`, `CAPABILITY-RECEIPT.json`, and the current PR/check state. Do not migrate a real case, deploy, install, merge, or promote `stable` from this checkpoint.
