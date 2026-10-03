import { outputComplete, planJournalOperation } from "./controller.mjs";

// Only the exchange is written here. Snapshots are private, in-memory copies; the sequential
// controller remains the sole writer of ledgers, durable inference and run state.
export function createJournalLookahead({ limit, port, authorize, prepare, grant, pollMs = 5_000 }) {
  if (!Number.isSafeInteger(limit) || limit < 2 || limit > 8) throw new TypeError("lookahead limit");
  const running = new Map();
  const finished = new Set();
  const sent = new Set();
  const used = new Set();
  const wake = new Set();
  let closed = false;
  let errors = 0;
  let publication = Promise.resolve();
  let scheduling = Promise.resolve();
  // The latest ahead() call's descriptors not yet started, in order. A slot that frees up takes the next one,
  // so a short task (a reference reading) doesn't leave the rest of the window idle until the next call.
  let pending = [];
  const pause = () => new Promise(resolve => {
    const timer = setTimeout(() => { wake.delete(stop); resolve(); }, pollMs);
    const stop = () => { clearTimeout(timer); wake.delete(stop); resolve(); };
    wake.add(stop);
  });
  // Check access immediately before each publication, including when several lookahead
  // tasks become ready together and an earlier send changes access state.
  const prefetch = (request) => {
    const task = publication.then(async () => {
      if (closed) return null;
      await authorize();
      if (closed) return null;
      return port.prefetch({ ...request, grant, tier: "standard" });
    });
    publication = task.then(() => {}, () => {});
    return task;
  };
  const send = async (request) => {
    if (closed) return null;
    // Without its dispatch record a published item can't be answered, so publication is tried again.
    let dispatchMissing = false;
    try {
      const result = await prefetch(request);
      if (!result) return null;
      if (result?.published) sent.add(request.operationKey);
    } catch (error) {
      if (!error.workPublished) throw error;
      sent.add(request.operationKey);
      dispatchMissing = true;
    }
    // The item is published, so its slot stays occupied until it resolves or the lookahead closes, also
    // while publishing its dispatch record or reading the exchange fails. A failing stretch counts once.
    let failing = dispatchMissing;
    if (failing) errors += 1;
    for (;;) {
      if (closed) return null;
      if (dispatchMissing) {
        await pause();
        if (closed) return null;
        try {
          if (!(await prefetch(request))) return null;
          dispatchMissing = false;
          failing = false;
        } catch {
          if (!failing) errors += 1;
          failing = true;
        }
        continue;
      }
      let peek;
      try { peek = await port.peek(request.operationKey); }
      catch {
        if (!failing) errors += 1;
        failing = true;
        await pause();
        continue;
      }
      failing = false;
      if (peek.status === "completed") return peek.output;
      if (peek.status !== "pending") return null;
      await pause();
    }
  };
  const walk = async (planned) => {
    if (closed) return;
    if (planned.direct) {
      if (planned.direct.tier === "hardest") return;
      const output = await send(planned.direct);
      if (output && planned.next && !closed) {
        const next = await planned.next(output);
        if (next) {
          const preparedNext = await prepare(next);
          if (preparedNext) await walk(preparedNext);
        }
      }
      return;
    }
    const snapshot = structuredClone(planned.snapshot);
    for (const work of snapshot.work_items) {
      if (closed || work.tier === "hardest") return;
      if (work.status === "completed") continue;
      // A retry, reserialization or parked job belongs entirely to the sequential controller.
      if (work.status !== "planned" || work.attempts !== 0
        || work.operation_key !== null || work.retry_epoch !== 0) return;
      const { packet, operationKey } = await planJournalOperation({
        work, snapshot, grant, resolvePacketInput: planned.resolvePacketInput
      });
      const output = await send({ role: work.role, packet, outputSchema: work.output_schema_id, operationKey });
      if (!output || !outputComplete(work.role, output)) return;
      work.output = structuredClone(output);
      work.status = "completed";
    }
  };
  // Build candidates outside task slots. A cached or source-only candidate does not consume capacity; work
  // starts in descriptor order while slots are free.
  const fill = () => {
    scheduling = scheduling.then(async () => {
      while (!closed && running.size < limit - 1 && pending.length) {
        const descriptor = pending.shift();
        if (running.has(descriptor.jobId) || finished.has(descriptor.jobId)) continue;
        let planned;
        try { planned = await prepare(descriptor); }
        catch { errors += 1; finished.add(descriptor.jobId); continue; }
        if (!planned || planned.direct?.tier === "hardest") {
          finished.add(descriptor.jobId);
          continue;
        }
        const task = walk(planned).catch(() => { errors += 1; }).finally(() => {
          running.delete(descriptor.jobId);
          finished.add(descriptor.jobId);
          fill();
        });
        running.set(descriptor.jobId, task);
      }
    });
  };
  return Object.freeze({
    ahead(descriptors) {
      if (closed) return;
      // Each call is the current view of upcoming work; descriptors from an earlier call that never
      // started are dropped (the sequential run has reached them or moved past).
      pending = [...descriptors];
      fill();
    },
    markUsed(operationKey) { used.add(operationKey); },
    sentOperationKeys() { return [...sent]; },
    summary() {
      let consumed = 0;
      for (const operationKey of sent) if (used.has(operationKey)) consumed += 1;
      return { concurrency: limit, sent: sent.size, used: consumed,
        unused: sent.size - consumed, errors };
    },
    async close() {
      closed = true;
      for (const stop of [...wake]) stop();
      await scheduling;
      await Promise.allSettled([...running.values()]);
    }
  });
}
