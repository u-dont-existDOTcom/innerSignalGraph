# Journal import: parallel calls through lookahead

Date: 2026-10-01. Author: Claude (Opus), for implementation by Codex. Status: task. Classification: public design; no private data.

## Why

The importer makes one model call at a time. At three to six minutes a call and roughly 150 to 300 calls, one import takes 8 to 30 hours. The owner's product target is a few hours for a journal this size, and the speed must come from running independent calls at the same time, never from skipping or shrinking a check.

The run's logic is long and stateful: `processBatch`, `audit()`, `reconcile()` and `patterns()` read and write the run state, split batches, retry, pause and record residuals in a fixed order. Running those bodies concurrently would make results depend on timing. This task leaves all of that logic sequential and unchanged. It adds a **lookahead** that sends the upcoming independent calls early, through the same work exchange and under the same operation keys the sequential run will use. When the sequential run reaches a call, its answer is usually already stored, and it returns at once.

## Rules

- With `semantic_concurrency` at 1 (the default) the importer behaves exactly as today: no lookahead code runs.
- The lookahead never writes the run state, a job ledger, a durable intent or result, a reference marker, or anything else the sequential run reads. It only publishes exchange items and reads answers. Everything the run records, it records itself, in the same order as today.
- The lookahead sends only what the sequential run would send next under the same operation key. A guess that turns out different costs one wasted call and changes nothing else.
- It never sends a retry, a reserialization, a repair cycle, a split it can't compute in advance, or a hardest-tier call.
- The live access check (`authorize()`) runs before every lookahead send, as before every ordinary send.
- Journal text, packets and answers never enter Git, logs or PR text. Tests use synthetic data.
- Each change comes with a test that fails without it. `npm test`, `npm run verify`, `npm run audit:repository`, `npm run audit:publication` and `npm run journal:ui:test` pass on Node 24.18.0. Record the change in `state/CODEX-CURRENT-STATE.md` in this PR's own entry, and add this plan to `docs/INDEX.md` (update the reviewed SHA-256 binding in `scripts/audit-repository.mjs` in the same change).

## 1. Configuration

- The run config gains `semantic_concurrency`: an integer from 1 to 8, default 1. It counts the sequential call plus the lookahead calls in flight, so 4 means the current call and up to three ahead.
- Lookahead needs a port with `prefetch` and `peek` (section 2). With any other port the importer runs as if the value were 1, and the run summary says so (`lookahead: "unsupported_port"`).
- The run summary gains `lookahead: { concurrency, sent, used, unused }`: lookahead sends, sends the sequential run later used, and sends it never used.

## 2. The exchange port

Two new methods on `createExchangeJournalInferencePort`:

- `prefetch({ role, packet, outputSchema, operationKey, grant, tier })` validates and digests exactly as `invoke` does, then publishes the work item and its dispatch record if neither the item nor an answer exists for the head of that operation key's chain. It never waits and never closes anything. An existing item with a different input digest throws `OPERATION_KEY_CONFLICT`. `tier: "hardest"` throws `JOURNAL_PREFETCH_TIER_UNSUPPORTED`. For an open speculative item that already exists, it publishes the dispatch record if this process hasn't yet (added 2026-10-03, after review): a dispatch record that failed to publish the first time is retried this way, since `peek` never writes.
- `peek(operationKey)` reports `completed` (with the schema-validated output; no receipt), `pending`, `not_submitted`, `invalid_output` or `retired`, with no side effects. It neither closes an expired item nor publishes a dispatch record.

`invoke` already resumes an item that exists with the same digest, so the sequential run's call to an item the lookahead published waits on that item instead of publishing another. Keep it that way, and test it (section 5).

The controller records its intent before `invoke` adopts such an item. A run interrupted between the two (added 2026-10-03, after review) resumes an `intent_persisted` item through an authoritative port by invoking the same operation key again, after the access check (`beforeInvoke` with `resumed: true`, which charges no second hardest slot). The port adopts the item the lookahead sent, or sends the call once if nothing went out. Asking only for the completion would read "not submitted" from the durable layer, which never recorded its own intent, and retry under a new key while the speculative item could still complete.

## 3. Shared request builders

The lookahead must compute the same packet and the same operation key as the sequential run. Do that by sharing code, not by copying it:

- **Controller.** Split `initialize` into a pure `buildJournalJobSnapshot(...)` and the persisting part. Split the packet and operation-key computation in `step()` into a pure `planJournalOperation({ work, snapshot, grant, resolvePacketInput })` that returns `{ packet, operationKey }`. `step()` uses it unchanged for every status; the lookahead uses it only for items whose status is `planned`.
- **Runtime.** Factor the job-ID computation in `work()` into `journalJobId(request)`. Factor each request the lookahead covers (section 4) into a function that both the sequential code and the lookahead call. The sequential code must keep producing byte-identical requests: add a test that the job IDs and operation keys of an existing end-to-end run don't change.

## 4. The lookahead

`src/journal-import/lookahead.mjs` exports `createJournalLookahead({ limit, port, authorize, ... })`. The runtime creates one per run when `semantic_concurrency > 1` and the port supports it, and closes it when the run ends.

- `ahead(requests)` takes the next requests of a loop, in order. It starts tasks for the first `limit - 1` that aren't running or finished, skipping duplicates by job ID.
- A task follows one request's chain:
  - For a controller job, it builds the job snapshot (`buildJournalJobSnapshot`, or the existing ledger read-only), then walks its items in order. An item already completed in the ledger supplies its output. A `planned` item gets its packet and key from `planJournalOperation`, then `authorize()`, `prefetch`, and `peek` every `poll_ms` until it is no longer pending. A completed answer must pass the schema and the controller's own completeness rule (`outputComplete`) before the walk continues to a dependent item, which reads it through the same `$work_output` materialization. Any other status ends the walk.
  - For a `REFERENCE_AUDIT` request, which the runtime sends without a controller, it skips the request if a cached result, a failure marker or a completion-unknown marker exists. Otherwise the operation key is the job ID, as in `work()`.
  - A chain continues past an answer only when the loop's own check on that answer passes (section 4, per loop). Otherwise it stops; the sequential run will retry under a different job ID.
- A task ends when its chain ends, when `peek` reports `retired` (the sequential run took the answer), on any error, or when the run closes. Errors are counted, never thrown, and never logged with content. Once its item is published, a failing exchange read doesn't end the task: it keeps its slot and polls again, counting the failing stretch once. An item whose dispatch record failed to publish keeps its slot too, and the task calls `prefetch` again after each pause until the record is published, since no worker can answer the item without it.
- At most `limit - 1` lookahead items are outstanding (published and unanswered) at once.

### Loops covered

- **Regular extraction batches** (`for (const ids of frozenPlan.regular_batches)` in `runBatched`). For batch *i*, look ahead at the cycle-0 extraction jobs of batches *i+1* onward: extractor, then its omission checker. Calibration batches stayed strictly sequential at first, since calibration decides whether the run goes on.
- **Calibration batches** (added 2026-10-03). A calibration round now runs every calibration unit (stopping only at its failure limit), so the units are independent work. For batch *i*, look ahead at batches *i+1* onward: the frozen reference reading and the cycle-0 extraction job (extractor, then its omission checker), both built by the same functions processBatch uses. Repairs, fidelity audits and hardest-tier calls stay sequential, and regular batches still start only after every calibration unit passes. When a round stops at its failure limit, at most `semantic_concurrency - 1` calls sent ahead go unused.
- **Audit units** (`audit()`). For unit *i*, look ahead at units *i+1* onward: the `reference:final:<unit>` reading, then, once its answer passes the same anchor check the loop applies, the `fidelity:final:<unit>` job built from that answer. Units whose imported graph is source-only are skipped, as in the loop.
- **Reconciliation batches** and **pattern batches**: cover the first call of each upcoming batch (the reconciler; the pattern source freeze) only where its request can be computed from data the sequential run won't change before it gets there. Where it can't, leave the loop sequential and say why in the state entry.

## 5. Tests

Run the existing synthetic end-to-end import through the real exchange port, with an answering fake that serves items in random order with random delays.

1. **Same results.** At `semantic_concurrency` 1 and 4, with a fixed audit seed and clock: the committed generation, audit report counts, residuals, every job ID and every operation key the sequential run used are identical. The four-wide run finishes in fewer fake-time rounds.
2. **No double sends.** Count successful `publishWork` calls per work ID: never more than one, including when the run is closed while lookahead tasks are waiting and a new run starts on the same state.
3. **Retry epochs.** A job resumed from `blocked_authority` with a confirmed-unsent failure, and a job in `invalid_output`, are never sent by the lookahead. Their retry and reserialization keys come only from the sequential run, and match the run at concurrency 1.
4. **Bound.** The fake never sees more than `semantic_concurrency` unanswered items from the run at once.
5. **No hardest sends**, and no sends at all at concurrency 1.
6. **Access.** A revoked grant stops lookahead sends before any further item is published.
7. **No side effects.** After a lookahead task finishes, the corpus store holds no new ledger, intent, result or reference marker objects.
8. **Unsupported port.** A mock or provider port runs sequentially, and the summary says `unsupported_port`.
