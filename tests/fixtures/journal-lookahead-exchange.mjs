import { createHash } from "node:crypto";
import { createExchangeJournalInferencePort } from "../../src/journal-import/exchange-port.mjs";

const digest = value => createHash("sha256").update(value).digest("hex");
const answer = { schema_version: "1.0", source_only_first_pass: true, reference_items: [],
  questions: [], unassessed_unit_ids: [] };

export function exchangeHarness({ caseId = "synthetic-case", defaultAnswer = answer,
  waitMs = 1000, onDispatch = () => {}, now = () => new Date(), ttlMs } = {}) {
  const work = new Map(), results = new Map(), dispatch = new Map();
  const successful = new Map();
  const exchange = {
    async removeStaleTemporaries() {},
    readWork: async id => structuredClone(work.get(id) ?? null),
    readResult: async id => structuredClone(results.get(id) ?? null),
    async publishWork(entry) {
      if (work.has(entry.work_id)) return { created: false };
      work.set(entry.work_id, structuredClone(entry));
      successful.set(entry.work_id, (successful.get(entry.work_id) ?? 0) + 1);
      return { created: true };
    },
    async publishDispatch(record) {
      dispatch.set(record.work_id, structuredClone(record));
      onDispatch({ work, results, dispatch });
    },
    async listDispatch() { return [...dispatch.values()].map(item => structuredClone(item)); },
    async closeUnanswered(id) {
      if (results.has(id)) return { closed: false };
      results.set(id, { retired: true, unanswered: true }); dispatch.delete(id);
      return { closed: true };
    },
    async retireWork(id) {
      results.set(id, { retired: true }); dispatch.delete(id);
      work.delete(id);
    }
  };
  const makePort = () => createExchangeJournalInferencePort({ exchange, caseId,
    receiptKey: Buffer.alloc(32, 17), routeRef: "synthetic:route",
    allowanceEvidence: { authorization_ref: "synthetic:allowance", maximum_incremental_cost_usd: 0 },
    model: "GPT-5.6 Sol", effort: "Pro", pollMs: 1, waitMs, now,
    ...(ttlMs === undefined ? {} : { ttlMs }) });
  const answerWork = (id, output = defaultAnswer) => {
    const record = dispatch.get(id);
    results.set(id, { output: structuredClone(output), receipt: {
      receipt_id: `synthetic:${id}`, work_file_key: `synthetic:${id}`,
      received_at: "2026-10-01T00:00:00.000Z", output_sha256: digest(JSON.stringify(output)),
      subject_sha256: digest(id), request_context_id: `synthetic-chat:${id}`,
      effective_model_profile: record.model, effective_effort: record.effort
    } });
  };
  const port = makePort();
  return { port, makePort, work, results, dispatch, successful, answerWork };
}
