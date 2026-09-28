# Journal import: the hardest-case lane

Date: 2026-09-28. Author: Claude (Opus), for implementation by Codex. Status: task, with the owner's decisions recorded. Classification: public design; no private data.

This expands Task 3 of `2026-09-28-journal-import-handoff.md`. A step that fails all its standard attempts gets one more attempt, answered by Claude Opus, before it is labeled a residual. Build it on this branch, which sits on the finishes branch.

## Owner decisions (2026-09-28)

- **Consent.** The journal owner's consent covers a second model provider. A hardest step's packet may go to Anthropic as well as OpenAI.
- **Daily limit.** 20 hardest attempts per UTC day by default. Past the limit the run pauses until the next UTC day. It never skips the step, because that many hard failures in one day usually means something is broken.
- **Where Claude runs.** On the import host, next to the exchange, through Claude Code signed in to the owner's subscription (Mission Control's Claude worker, a separate task). It uses no API key and has no external spend.

## Rules

- Journal text, packets and answers never enter Git, logs or PR text. Tests use synthetic data.
- Every existing job ID stays the same, so runs already in progress replay unchanged.
- Each change comes with a test that fails without it. `npm test`, `npm run verify`, `npm run audit:repository`, `npm run audit:publication` and `npm run journal:ui:test` pass.
- Record the change in `state/CODEX-CURRENT-STATE.md`, in this PR's own entry.

## 1. The hardest attempt

**Where it applies:**
- `checkedWork` in `src/journal-import/private-runtime.mjs`, after its last standard attempt. This covers the calibration reference after its splits, visual binding, reconciliation batches and audited units.
- `checkedStep` in `src/journal-import/pattern-stage.mjs`, after `PATTERN_STEP_ATTEMPTS`.
- A single extraction unit still unresolved after its repair cycles, before it is admitted as `needs_review`. That attempt carries the same `repair_request` the last repair cycle built.

**How it works:**
- The attempt's ID is `<step id>:hardest`, and it carries `tier: "hardest"`.
- It goes through the step's usual check.
  - If it passes, it is used like any other attempt.
  - If not, the step records its residual as it does today, with `hardest: "failed"` on the residual record.
- A rerun replays the stored hardest attempt and never sends it again, like the standard attempts.
- If the owner's configuration has no hardest lane (`hardest_lane.enabled` false, the default until deployment), steps behave exactly as they do today.

## 2. Plumbing

- **`work()`** accepts `tier`, `"standard"` by default. It adds `tier` to the job identity only when it is `"hardest"`, so standard job IDs don't change.
- **The controller** keeps `tier` in the work definition and passes it to `port.invoke`. The `REFERENCE_AUDIT` path, which calls the port directly, passes it too.
- **The exchange port** (`src/journal-import/exchange-port.mjs`):
  - It writes `tier` into the work item and the dispatch record. Add `tier` to the dispatch fields `work-exchange.mjs` allows. A record without it reads as `"standard"`, so existing records stay valid.
  - A hardest item takes its `model` and `effort` from `hardest_lane.model` and `hardest_lane.effort` in the run config (defaults `claude-opus-5-5` and `max`), and its expiry from `hardest_lane.ttl_hours` (default 24).
- **Transport.** A hardest item follows the same transport rules as any other job. An item that expires unanswered is confirmed unsent and pauses the run; the next run sends it again. The import waits for the Claude lane rather than skipping it.
- **Evidence.** The runtime records the tier, and the exchange's `subject`, with every answer it admits. The owner receipt counts answers by tier.

## 3. Daily limit

- The run config gains `hardest_lane.daily_limit` (default 20).
- The run state keeps `hardest_lane: { day, sent }`, where `day` is the UTC date. Only a newly sent hardest attempt counts. A replayed one doesn't, and a new day starts again at 0.
- Before sending a new hardest attempt when `sent >= daily_limit`, set the blocker `HARDEST_DAILY_LIMIT`, save, and pause the run, just as a quota pause does. The next run on a later UTC day sends the attempt.
- The run summary gains `hardest_lane: { day, sent, daily_limit }`, and `residuals` gains `hardest_attempted` and `hardest_resolved`.

## 4. A local work server for workers on the import host

The Claude worker runs on the import host, so it doesn't need the network connector. Add `npm run journal:work:mcp -- --config <private run config> --principal <name> [--tier hardest]` in its own file, `src/cli/journal-work-mcp.mjs`. (The dispatch listing, in the provider PR, adds `npm run journal:work`; keeping this command separate avoids a conflict when the branches meet.)

- It runs an MCP server over stdio exposing `get_journal_work_packet` and `submit_journal_work_result`.
- Build the tools with `createJournalWorkTools` from `src/server/journal-work-tools.mjs`, over the same exchange the connector uses. Reuse the JSON-RPC handling in `src/server/private-case-mcp.mjs` where it fits.
- `authorizeCase` returns the fixed principal `local:<name>`, and the exchange stores it as each answer's `subject`.
- With `--tier hardest`, it serves and accepts only hardest items. Any other work ID gets `JOURNAL_WORK_NOT_FOUND`.
- It opens the exchange through the same root checks as the connector (`resolveJournalWorkExchangeRoot`, `assertJournalWorkExchangeRoot`).
- It writes nothing but MCP messages to stdout, logs nothing from packets or answers, and exits when stdin closes.

## Tests

1. A step that fails its standard attempts and passes a hardest attempt is used, and the dispatch record carries `tier: "hardest"` with the configured model and effort.
2. A step that fails both is labeled with `hardest: "failed"`.
3. The daily limit pauses the run with `HARDEST_DAILY_LIMIT`. A run on the next UTC day, with an injected clock, sends the attempt. A replayed attempt doesn't count.
4. A rerun replays the stored hardest attempt without sending it again.
5. With the lane disabled, the existing end-to-end tests in `tests/journal-runtime-finish.test.mjs` produce the same job IDs and results as before.
6. The stdio server:
   - completes a full round trip for a published hardest item, and records the answer's subject;
   - refuses a standard item under `--tier hardest`;
   - never writes packet or answer text to stderr, checked with a sentinel string in the packet.
