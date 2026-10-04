# Journal import: hand-off plan for the remaining work

Date: 2026-09-28. Author: Claude (Opus), for implementation by Codex and Mission Control. Status: plan. Classification: public design; no private data.

The owner asked for the remaining engineering to go to Codex and Mission Control chats, with Opus kept for design and judgment. This plan gives each task enough detail to build and verify without Opus. The design choices in Task 3 need the owner's decisions, listed under "Owner gates".

## Where things stand

| Piece | Branch or PR | State |
|---|---|---|
| The importer, moved into this repository | PR #94 | In Codex review. A shepherd script on the owner's laptop asks Codex to fix each finding, requests the next review, and squash-merges once a review comes back clean. The owner approved this merge. |
| Import through the connector exchange | `claude/journal-exchange-provider-20260927` | Built and tested. Open its PR after #94 merges. Merging needs the owner's approval naming the PR. |
| Runs that can finish | `claude/journal-import-finishes-20260927`, stacked on the provider | Built and tested. The first end-to-end test runs a synthetic import through `run`, `audit`, `patterns` and `commit`. It carries three owner decisions, listed in its state entry. |

## Rules for every task

- **Private data.**
  - Journal text, packets and answers never enter Git, logs, dashboards, PR text or chat transcripts that Mission Control keeps.
  - Everything Mission Control reads about the import is content-free: work IDs, roles, times and counts.
- **Tests.** Each change comes with a test that fails without it. `npm test`, `npm run verify`, `npm run audit:repository`, `npm run audit:publication` and `npm run journal:ui:test` must pass.
- **State.** Record the change in `state/CODEX-CURRENT-STATE.md`.
- **Deployment.** Nothing is deployed, and no running import is switched, without the owner's approval naming the step.
- **Merging.** Merges need the owner's approval naming the PR. #94 is already approved.

## Task 1: a content-free dispatch listing (this repository; base: the provider branch)

Mission Control needs the outstanding work without reading the exchange's files or holding its key.

- Add `npm run journal:work -- dispatch [--json]`.
  - It reads `listDispatch()` from `src/journal-import/work-exchange.mjs` through the same root checks the connector uses (`resolveJournalWorkExchangeRoot`, `assertJournalWorkExchangeRoot`).
  - It prints one JSON line per record: `work_id`, `role`, `output_schema_id`, `model`, `effort`, `tier` (from Task 3, `standard` until then), `issued_at`, `expires_at` and `answered`.
  - It prints no packet, answer or path.
- It exits 0 even when there are no records, and returns a content-free error code when the root is missing or unsafe.
- Tests: a published item appears unanswered, then answered once a result is stored. An expired or retired item disappears. The output never contains packet or answer text; test this with a sentinel string inside the packet.

## Task 2: the Mission Control journal work runner (UDA repository, `tools/codex-mission-control/vps-browser-relay`)

A new relay command, `journal-work`, that turns dispatch records into answered items using the owner's ChatGPT Pro account. It reuses the relay's browser layer and adds none of the supervision machinery.

**One pass:**
1. Run the Task 1 listing on the host that holds the exchange.
2. Take the oldest record that is unanswered, unexpired, has `tier` `standard`, and has a model and effort the account offers (`GPT-5.6 Sol`, `Pro`).
3. Open a fresh conversation with `createFreshChatTarget`, then set the model and thinking effort with `ensureExactConsumerControls`.
4. Enable the InnerSignal app with `selectAppsForMessage`, and fail closed if the app isn't there.
5. Submit exactly this instruction with `submitExactMessage`:
   > Private InnerSignal journal work item `<work_id>`. Call get_journal_work_packet with this work_id, follow its instruction using only its packet, then submit your JSON answer with submit_journal_work_result. If it lists schema problems, fix them and submit again. Reply only: done.
6. Wait with `waitForGenerationComplete`, then re-read the listing. The item counts as done only when `answered` is true.

**Heartbeat ladder until answered or expired:**
1. Continue, using the existing continue recovery.
2. Retry.
3. A fresh chat with the same work ID. The exchange keeps the first valid answer, so a second chat can never overwrite one.

**Write confirmations:**
- Add a detector that returns a structured observation of any app-write confirmation dialog.
- Approve only a dialog that names `submit_journal_work_result` for the InnerSignal app. If ChatGPT offers "always allow" for that app, set it once.
- For any other confirmation, stop and record an owner action.
- Test with DOM fixtures. The pilot then calibrates the detector against the live page.

**After an answer lands:** start one import run with `npm run journal:import -- run --config <private path>`, using the relay's private environment. That run publishes the next item, so the import never waits on a timer. Run one item at a time: the importer's controller makes one call at a time.

**Pacing and adapting:**
- Keep the relay lock and the central submission scheduler.
- Back off on "too many requests", on a model-unavailable message and on memory pressure, and record each event.
- Track completions per day against the Pro allowance (about 170 calls a day) and slow down before reaching it.
- Keep the per-account settings (pace, fresh-chat threshold) in the relay's state, so they can be tuned from what happens.

**Logs:** only work IDs, roles, times, outcomes and counts. Never text from the page.

**Tests:** use a fake browser and a fake listing command.
- The happy path.
- Each rung of the ladder.
- Expiry.
- An answer that arrives from an earlier chat.
- An approved confirmation, and a refused one.
- Back-off.
- Content-free logs, checked with a sentinel.

## Task 3: the hardest-case lane (this repository; base: the finishes branch)

The owner gates are cleared. `2026-09-28-journal-hardest-lane.md` is the task as Codex builds it, with the decisions filled in; where it differs from this summary, it wins. A step that fails all its standard attempts gets one more attempt, answered by Claude Opus, before it is labeled a residual.

**Merge note (2026-09-30):** The implemented lane retains the later main-branch admission rules. An exchange answer needs mechanically verified effective model, effort, and request-context evidence before it can enter the import. The current local work-submission protocol does not attest those facts, so an enabled real hardest route is unavailable at doctor/runtime admission until that evidence exists. A visual hardest attempt without attachment transport is recorded as not attempted. The daily limit pauses the run at the bound; it does not silently skip work. The exchange hashes the submitter, and the import receipt carries only that digest and tier. The older summary below is historical wherever it describes a different bound or receipt.

**Where it applies:**
- Every `checkedWork` failure in `src/journal-import/private-runtime.mjs`: the calibration reference after its splits, visual binding, a reconciliation batch, an audited unit.
- Every `checkedStep` failure in `src/journal-import/pattern-stage.mjs`.
- A single extraction unit still unresolved after its repair cycles, before it is admitted as `needs_review`.

**How it works:**
- **One more attempt.** Its ID is `<step id>:hardest`, with `tier: "hardest"`. The extraction attempt carries the same `repair_request` the repair cycles build: the previous extraction, the omission review and the mechanical failure. If it passes the step's check, it is used like any other attempt. If not, the step records its residual as it does today, noting that the hardest lane was tried.
- **Plumbing.**
  - `work()` passes `tier` to the controller.
  - The controller keeps `tier` in the work definition and hands it to `port.invoke`.
  - The exchange port writes `tier` into the work item and the dispatch record.
  - The durable layer treats a hardest attempt as its own job; its ID already differs.
- **Routing.** The Task 2 runner skips `hardest` records. A Claude worker takes them (Task 4).
- **Evidence.**
  - The exchange already stores the submitting principal (`subject`) with each answer. The runtime records `tier` and that subject with every answer it admits.
  - The owner receipt counts answers from the hardest lane.
  - Give each lane its own principal, so the record shows which lane answered.
- **Bound.**
  - `hardest_daily_limit` in the run config (for example 10) caps hardest attempts per UTC day.
  - Past the cap, the step records its residual without escalating, and says why.
  - The summary's `residuals` gains `hardest_attempted`, `hardest_resolved` and `hardest_skipped_limit`.
- **Tests.**
  - A step that fails its standard attempts and passes a hardest attempt is used.
  - One that fails both is labeled with the hardest lane noted.
  - The daily cap applies.
  - The dispatch record carries `tier`.
  - A rerun replays the hardest attempt without resending it.

## Task 4: the Claude worker for the hardest lane (UDA repository)

- A small command on a host where Claude Code is signed in to the owner's subscription (today, the owner's laptop).
- It lists outstanding `hardest` records through the connector: add a content-free `list_journal_work` tool with the `journal:submit` scope, or read the Task 1 listing over the relay.
- For each record it runs `claude -p --model opus --output-format json` with the InnerSignal connector configured and the same instruction as Task 2. It confirms `answered` afterwards.
- It records the usage fields Claude Code reports for each item in a content-free usage log. The Mission Control dashboard shows them as the Claude usage meter the owner asked for, so this lane never uses up credits he needs without it being visible.
- It uses no API key and has zero external spend. It keeps its own principal (Task 3, Evidence).

## Task 5: smaller fixes (this repository; base: the finishes branch)

1. **Visual job ledger size.** A visual job stores the page image, as base64, in its ledger snapshot, which passes 4 MiB for a large page. Store the rendered page once as a chunked object, and keep only its reference and digest in the job's packet input. Resolve the reference when the packet is built for the transport. Test with an image over 4 MiB.
2. **Transport errors after retries.** After its two retries, the controller leaves a job in `blocked_authority` with `RETRYABLE_TRANSPORT`. That stops the job for good, even when the next run has a working transport. On a new run, reset the retry budget of a job blocked only by a confirmed-unsent transport failure. Keep refusing to resend when completion is unknown. Test both.
3. **Counterevidence bound.** The 64-result cap on the counterevidence search leaves any broad pattern `provisional`. Page the search to completion within a byte budget, and hand the reviewer the matches that fit, with the complete count. Record `complete` only when every match was searched. Test a pattern with more matches than one page.

## Owner gates

- **Deployment** (the exchange spec's Deployment section): create the exchange directory, the secret, the connector mount, the `journal:submit` grant and the scopes; redeploy the connector; reconnect the InnerSignal app in each ChatGPT account. The owner does the reconnect himself, because it signs in to his accounts.
- **Hardest lane.** Decided on 2026-09-28; see `2026-09-28-journal-hardest-lane.md`.
  - The journal owner's consent covers a second model provider, so hardest steps may go to Anthropic as well as OpenAI.
  - The daily limit is 20 hardest attempts, and past it the run pauses until the next UTC day.
  - Claude Code runs on the import host, signed in with a long-lived token the owner creates with `claude setup-token` at deployment.
- **Merges:** each PR, by name.

## Pilot, once the gates are cleared

1. One synthetic work item per ChatGPT account, which proves the app's write works from that account.
2. Twenty real units, run end to end.
3. Read the content-free counts: answered per hour, the rungs of the ladder that were needed, residuals by kind, and hardest-lane use. Tune pacing from those.
