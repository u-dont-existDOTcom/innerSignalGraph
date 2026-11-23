# Response evidence enforcement — architecture checkpoint

## Owner outcome and authority

Current request: develop the mechanical enforcement architecture for the already-tracked delivery-provenance and journal-use failures (issue #195). The preceding therapy-protocol deployment is complete according to the supplied release handoff; this task does not re-release that plugin.

Authorized boundary: a source-grounded, reviewable implementation architecture, including the actual supervisor-drafting surface. Runtime implementation, private-data migration, a new connector write scope, provider spending, and deployment are not completion claims of this architecture change. Existing authorized implementation work is preserved; this record does not cancel it.

Task: `response-evidence-enforcement-20261026`.
Branch: `task/response-evidence-architecture-20261026`.
Baseline: `09a0f5af80fbf80ea985ce49347a7d66565d546d` on development `main`.
Universal guidance read live at bootstrap; checkout: `f8f6f000d1942e4741ccc1b4cf18434064abc99e`.
Assurance lane: decision/design; implementation and release evidence remain separate.

## Active contract

| Obligation | Required behavior | Failure condition | Enforcement / repair |
| --- | --- | --- | --- |
| Actual owner outcome | Cover delivery provenance and materially relevant history at the paths the owner uses | A server-only design is represented as fixing unrestricted host chat | Source audit + architecture review; specify the controlled draft/export path and its limit |
| Source-first recovery | Use current source, issue #195, and existing primitives | Reimplement frozen evidence, approval, or storage already present | Source map in the specification; reuse/adapt |
| Evidence is not interpretation | Separate fetched/included evidence from source entailment and comprehension | A digest or model assertion is presented as proof of semantic truth | Explicit mechanical/semantic guarantee table |
| No private disclosure | Public artifacts contain generic or synthetic examples only | Client identifiers, transcripts, journal passages, private-derived hashes or infrastructure credentials appear | Inspect the entire changed diff before publication |
| No invented requirement | Tie mandatory checks to the reported failure or existing project gates | Optional whole-journal completion, new database, extra review tournament or new clinical policy becomes a prerequisite | Requirement-origin table; remove the added prerequisite |
| Preserve useful support | Missing journal access constrains the affected assertion/advice | All current-message support or urgent help is suppressed | Paired positive/negative acceptance cases |
| Correct completion level | Distinguish design, implementation, installed control, and observed model behavior | Planned tests or source inspection are called live enforcement | Explicit status and unexecuted acceptance ledger |

## Recovery and coordination

Only the primary writer changes this branch. The two delegated investigations are read-only: current-code/bypass review and a bounded primary-source prior-work scan. No private journal was opened and no competing importer was started.

The mandated inbox CLI was attempted and returned `fetch failed`. Equivalent read-only discovery through the connected GitHub API succeeded: three default-lane files and four files in open `uda-lane` pull requests, all seven already dispositioned in `docs/suggested-fixes-inbox-receipts.json`. All 35 open `uda-lane` PR file lists were inspected. No new item needs disposition. The separate historical-delivery proposal, PR #139, was inspected as related unmerged work; its contract is useful precedent, not current installed authority.

## Independent conception / prior work

Before external comparison: extend the existing immutable candidate/audit lifecycle with server-created evidence of delivery and relevant history, then validate it at every controlled exit. Preserve source identity across writer/auditor/repair. The design must not confuse missing evidence with a negative historical finding.

Disposition: **compose/adapt**. Reuse current encrypted records, invocation replay, authorization, candidate lifecycle, writer locks, and independent review. The specification records the four primary external sources and the smaller baseline. No new framework or database is required.

## Architecture and review completed

- Specification: `docs/superpowers/specs/2026-10-26-response-evidence-enforcement.md`.
- Companion plan: `docs/superpowers/plans/2026-10-26-response-evidence-enforcement.md`.
- The design covers the shared store gate, immutable source snapshot, explicit auditor support coverage, meaningful prior-history dependencies in advice, actual audience/delivery provenance, conditional bounded retrieval, fallback limits, concurrency, privacy, and the controlled supervisor artifact path.
- Independent source/design review found three substantive integration problems: candidate-owned inbound/state persistence could self-invalidate; external authoring cannot have fabricated writer-inclusion receipts; an independent offline urgent-support surface was not established by baseline source. All were corrected and a narrow reread confirmed the fixes. A final surrounding sentence about external-draft provenance was then aligned.
- The prior-work/minimality review additionally required explicit owner-event provenance distinct from account authentication and a fixed blocking mapping for support items. Both were incorporated. The optional producer claim manifest is deferred.
- No major new framework, database, full journal completion dependency, default additional judge, or routine owner reconfirmation was added.

## Verification and limits

- `npm ci --ignore-scripts --prefer-offline`: succeeded; no dependency files changed.
- `npm run audit:repository`, through the canonical test-efficiency observer: passed with zero errors and the existing unverified hosted GitHub App permissions warning.
- Documentation relative links/fences, branch lease, privacy-focused changed-file inspection, source seam readback and `git diff --check`: checked.
- The documentation-index SHA-256 binding was updated in `scripts/audit-repository.mjs`; no audit logic changed.
- No runtime source, live provider evaluation, private case, journal import, source authorization, production configuration, stable release or deployed service changed. Acceptance cases are planned and unexecuted. Full package/hosted release checks are not claimed by this design checkpoint.

## Current frontier / stop admission

Architecture outcome: SATISFIED at the reviewable design boundary once this exact change is published and read back. The broader issue #195 implementation outcome remains OPEN; the issue must not be closed by this documentation PR. The next concrete implementation action is Slice 1: normalize communication/delivery evidence in synthetic encrypted store tests, then implement the source-bound gate and the actual supervisor export path according to the plan. This architecture request does not require a fresh owner preference decision; a later new connector grant or production change has its own applicable boundary.

Publication target: draft PR from `task/response-evidence-architecture-20261026` to `main`. Containing commit and PR identity are obtained from Git/GitHub readback rather than self-embedded. Preserve the independent journal/import work and the separate historical-delivery proposal.

## Implementation, 23 November 2026

### Frontier and authority

The owner's request of 26 October (issue #195, promise IS10) is built on branch `claude/response-evidence-enforcement-20261123` in three committed parts, A1 `13b2250d6`, A2 `5a8db246d` and part B, from the build contract `BUILD-20261123.md`; Codex built each part and Claude reviewed, tested and committed it.

The supervisor service freezes `snapshot:supervisor:<operationKey>:r1` before storing or producing text and reuses it after replay/restart. The newest effective client turn supplies the inbound identity; owner inputs keep their type and supplier. The store binds submissions inside the mutation, checks case/operation/newest/current snapshot, and verifies a backend root's returned view digest against its receipt. External roots and supervisor repairs have no writer attestation. Repairs bind the lineage's newest snapshot; audit and repair receive its view. The shared check uses the root's `root_source`, verifies the supervisor audit disclosure receipt, and admits only a complete passing review with no derived support failure. A trusted internal reconstruction argument carries the binding; ordinary caller metadata still cannot create it.

Supervisor approval checks everything except dependency freshness because it releases no bytes; export repeats freshness and maps a moved-on case to the existing `SUPERVISOR_ARTIFACT_STALE` outcome. Generic operator approval still checks freshness. The service default admission hook is a pre-check; the store decides inside its mutation. A governed active draft reports enforced source-support coverage and owner inputs included. The connector uses its existing review ticket for freezing; it gets no new tool, input, scope or status. Its descriptions remain accurate and were unchanged.

The new session-use adapter is explicitly constructed with one configured corpus ID and defaults to a maximum of 40 passage results (configurable from 1 to 40). That bounded lexical search and ID-only caching are implementation choices within the contract, not a claim of complete historical coverage. The adapter checks the case's `session_use` grant before inspection, verifies the active published generation and its permitted use, verifies exact quotation spans, counts serialized excerpt bytes and conservative bytes/3 tokens, omits whole items, and returns coverage and one receipt. Search refusal never falls back to another route. The native cache keys include case, corpus, purpose, generation, visibility epoch, query and filters; a cache hit still reauthorizes and resolves exact bytes.

Still off: the response-evidence setting defaults off; the adapter is not wired into any server, CLI or default configuration; readback remains `journalProvider: unconfigured`. Record version 7, existing runtime states, store-only built-in imports and existing advisory packets remain. No package installation, live model call, private-source read, production flag change, clinical-policy change, release or deployment occurred. A1/A2 supply the snapshot/runtime/review/fallback machinery; this pass supplies supervisor integration, the opt-in journal reader and documentation. Live behavioral evaluation and production source-consent/release decisions remain separate work. The runtime stale-at-delivery turn still stays APPROVED, as the accepted contract records.

### Verification

Node `/home/joel/.nvm/versions/node/v24.18.0/bin/node` was used throughout. `TMPDIR=/tmp/inner-signal-evidence-b.8pRjFx` was freshly created with mode 0700. No packages were installed and no full test suite was run. The normal isolated reporter counts files here; the counts below are files unless individual cases are explicitly named. The two new files contain **21 cases**, all passing, and are added to `private-case:acceptance`.

Every command below starts with:

```sh
env TMPDIR=/tmp/inner-signal-evidence-b.8pRjFx /home/joel/.nvm/versions/node/v24.18.0/bin/node --test --test-concurrency=2
```

Append these exact arguments for the corresponding run:

```sh
# Core: 8/8 files passed.
tests/response-evidence-supervisor.test.mjs tests/response-evidence-journal.test.mjs tests/response-evidence-contract.test.mjs tests/response-evidence-runtime.test.mjs tests/private-supervisor-draft.test.mjs tests/supervisor-review-runner.test.mjs tests/private-therapy-model-runtime.test.mjs tests/private-case-store-imports.test.mjs

# Final changed store/new suites: 3/3 files passed; only the existing child-process test excluded.
--test-skip-pattern='^the existing root writer lock' tests/response-evidence-store.test.mjs tests/response-evidence-supervisor.test.mjs tests/response-evidence-journal.test.mjs

# Other affected non-server files: 15/15 passed.
tests/journal-capacity.test.mjs tests/case-roadmap.test.mjs tests/journal-publication.test.mjs tests/case-roadmap-operator-cli.test.mjs tests/journal-review-convergence-calibration.test.mjs tests/worldview-evidence-scope.test.mjs tests/journal-pointer-runtime.test.mjs tests/role-belief-trajectories.test.mjs tests/journal-reading-first-runtime.test.mjs tests/journal-storage.test.mjs tests/private-case-operator-cli.test.mjs tests/focus-discipline-trajectories.test.mjs tests/journal-runtime-finish.test.mjs tests/private-case-orchestration.test.mjs tests/private-candidate-lifecycle.test.mjs

# Mixed files, server/transport cases excluded: 7/8 passed; the remaining file also had a second server case (next command).
--test-skip-pattern='^(purpose-scoped profile commitment|build-quotes stages|separate read-only MCP process|the served MCP route|the connector asks for the protocol|the plugin reads the longitudinal synthesis reference|case-state endpoints|one HTTP user message|the private respond route)' tests/journal-continuity.test.mjs tests/journal-quote-index.test.mjs tests/private-case-continuity.test.mjs tests/reparenting-framing.test.mjs tests/longitudinal-synthesis.test.mjs tests/constitution-context-state.test.mjs tests/private-therapy-runtime.test.mjs tests/self-directed-risk-gate-server-and-replay.test.mjs

# Remaining runtime non-server cases: 1/1 file passed.
--test-skip-pattern='^(one HTTP user message|private runtime authorizes before key)' tests/private-therapy-runtime.test.mjs

# Other mixed files' non-server cases: 2/2 files passed.
--test-name-pattern='^MCP refuses|^production-ready server|^hosted operator ACL|^the connector.s source' tests/private-case-oauth.test.mjs tests/private-supervisor-connector-denial.test.mjs

# Explicit requested journal-continuity non-server cases: 1/1 file, 2/2 cases passed.
--test-name-pattern='^therapy producer|^a restart after' tests/journal-continuity.test.mjs
```

Together these cover **34 distinct affected files** with their runnable non-server checks passing. `git diff --check` passed. The store-import gate passed: the new adapter does not enter the store's import graph. The old A1 tests were changed only to reflect the build contract's supervisor approval/export rule (section 9, a Claude design decision within the merged design) and to create pre-enforcement legacy work under advisory policy before checking enforced exits; no test was changed for sandbox restrictions.

Full `tests/response-evidence-store.test.mjs` was also run and fails only its unchanged child-process root-writer-lock test. A diagnostic run with `--test-isolation=none` exposed **44 passing cases / 1 failure**, whose child stdout was empty instead of `PRIVATE_ROOT_WRITER_ACTIVE`. An independent bounded Node child-process probe returned `spawnSync ... EPERM`, confirming that the sandbox also restricts process spawning. The diagnostic flag was used to expose assertions, not to waive a test. Claude must run that test unchanged outside the sandbox.

An initial negative name filter accidentally matched the parent file name and therefore included server cases. They failed on `listen EPERM`/unavailable child-process transport, not on implementation assertions. The successful reruns above used explicit positive selection or `--test-skip-pattern`; no test implementation was edited to bypass these restrictions.

Claude/CI must run the complete server-dependent files: `tests/supervisor-reply-{connector,denials,async,deployment,providers}.test.mjs`, `tests/private-supervisor-export-route.test.mjs`, `tests/private-supervisor-connector-denial.test.mjs`, `tests/private-case-oauth.test.mjs`, `tests/journal-continuity.test.mjs`, `tests/journal-quote-index.test.mjs`, `tests/private-case-continuity.test.mjs`, `tests/private-therapy-runtime.test.mjs`, `tests/constitution-context-state.test.mjs`, `tests/self-directed-risk-gate-server-and-replay.test.mjs`, `tests/reparenting-framing.test.mjs`, `tests/longitudinal-synthesis.test.mjs`, `tests/case-roadmap-mcp.test.mjs`, `tests/journal-work-tools.test.mjs`, `tests/therapy-protocol-mcp.test.mjs`, `tests/feedback-connector.test.mjs` and `tests/feedback-inbox-script.test.mjs`. Their non-server subsets noted above already passed. Full-suite/package gates are left to Claude/CI as instructed.

### Mailbox and closeout

The live default-branch UDA root and task-relevant operating/assurance/test/continuity rules were loaded. The required local inbox CLI failed because sandbox networking is unavailable: its result is **unknown**, not empty. Equivalent read-only connected GitHub discovery succeeded: ten default-lane files and two additional lane files across 23 open `uda-lane` PR file lists; all twelve have receipts and narrative dispositions already, so no new item was adopted, deferred or declined in this pass. Existing deferred triggers remain unchanged. The project has no new issue comments or PR review comments on 23 November, no reviews on its sole open PR, and no newer checkpoint/owner-question edits than the local baseline. Those existing workstreams remain with their recorded owners; part B adds no authority over them. Retry the local inbox CLI in Claude's networked environment at the next turn/checkpoint. Runtime messages consisted of this task's owner instructions; there were no queued agent requests. Mailbox locations: the UDA default lane and open labeled PR files, project issues/PRs/comments/reviews, `state/CODEX-CURRENT-STATE.md`, `OWNER-QUESTIONS.md` and runtime messages.

No extra worktree, dependency cache, Mastro session or Wine/Xvfb helper was created. `git worktree list --porcelain` was denied by the sandbox's approval policy, so broader inherited-worktree inventory is unverified; no worktree was removed or changed. The current worktree is retained because the owner explicitly requires uncommitted changes for Claude. Seven leftover synthetic journal test directories (about 5.5 MiB) were inspected and removed after all owning test commands had exited; only small validation logs remain in the private TMPDIR for Claude to inspect. These logs are local diagnostics, not the recovery authority. Branch and commit preservation was verified read-only from the worktree HEAD and log. The five hash-bound files named in the owner instruction were not edited.

Resume: Claude reviews this uncommitted part B diff, runs the server/child-process checks and CI, then commits. GitHub handoff is intentionally unsaved because the owner forbids committing in this pass.
