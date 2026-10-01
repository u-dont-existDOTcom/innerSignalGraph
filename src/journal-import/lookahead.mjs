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
  const pause = () => new Promise(resolve => {
    const timer = setTimeout(() => { wake.delete(stop); resolve(); }, pollMs);
    const stop = () => { clearTimeout(timer); wake.delete(stop); resolve(); };
    wake.add(stop);
  });
  const send = async (request) => {
    if (closed) return null;
    try {
      // Check access immediately before each publication, including when several lookahead
      // tasks become ready together and an earlier send changes access state.
      const task = publication.then(async () => {
        if (closed) return null;
        await authorize();
        if (closed) return null;
        return port.prefetch({ ...request, grant, tier: "standard" });
      });
      publication = task.then(() => {}, () => {});
      const result = await task;
      if (!result) return null;
      if (result?.published) sent.add(request.operationKey);
    } catch (error) {
      if (!error.workPublished) throw error;
      sent.add(request.operationKey);
      errors += 1;
    }
    for (;;) {
      if (closed) return null;
      const peek = await port.peek(request.operationKey);
      if (peek.status === "completed") return peek.output;
      if (peek.status !== "pending") return null;
      await pause();
    }
  };
  const walk = async (descriptor) => {
    const planned = await prepare(descriptor);
    if (!planned || closed) return;
    if (planned.direct) {
      const output = await send(planned.direct);
      if (output && planned.next && !closed) {
        const next = await planned.next(output);
        if (next) await walk(next);
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
  return Object.freeze({
    ahead(descriptors) {
      if (closed) return;
      for (const descriptor of descriptors) {
        if (running.size >= limit - 1) break;
        if (running.has(descriptor.jobId) || finished.has(descriptor.jobId)) continue;
        const task = walk(descriptor).catch(() => { errors += 1; }).finally(() => {
          running.delete(descriptor.jobId);
          finished.add(descriptor.jobId);
        });
        running.set(descriptor.jobId, task);
      }
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
      await Promise.allSettled([...running.values()]);
    }
  });
}
