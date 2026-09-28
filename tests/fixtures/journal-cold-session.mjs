import fs from "node:fs/promises";
import { createJournalColdConsumer } from "../../src/case-state/journal-cold-consumer.mjs";

const [mcpUrl, outputPath] = process.argv.slice(2);
const token = process.env.INNER_SIGNAL_JOURNAL_COLD_TOKEN;
const caseId = process.env.INNER_SIGNAL_JOURNAL_COLD_CASE_ID;
const corpusId = process.env.INNER_SIGNAL_JOURNAL_COLD_CORPUS_ID;
if (!mcpUrl || !outputPath || !token || !caseId || !corpusId) throw new Error("Cold journal session arguments are incomplete.");

async function call(name, args) {
  const response = await fetch(mcpUrl, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: `${name}:${crypto.randomUUID()}`, method: "tools/call", params: { name, arguments: args } })
  });
  const body = await response.json();
  if (response.status !== 200 || body.error || body.result?.isError) throw new Error(`Cold journal tool ${name} failed.`);
  return body.result.structuredContent;
}

const journalApi = Object.freeze({
  search(input) {
    return call("search_journal_graph", {
      case_id: input.caseId,
      corpus_id: input.corpusId,
      query: input.query,
      purpose: input.purpose,
      graph_enabled: input.graphEnabled,
      filters: input.filters,
      page_size: input.pageSize,
      cursor: input.cursor
    });
  },
  getSubgraph(input) {
    return call("get_journal_subgraph", {
      case_id: input.caseId,
      corpus_id: input.corpusId,
      seed_ids: input.seedIds,
      purpose: input.purpose,
      node_limit: input.nodeLimit
    });
  },
  resolveEvidence(input) {
    return call("resolve_journal_evidence", {
      case_id: input.caseId,
      corpus_id: input.corpusId,
      evidence_ids: input.evidenceIds,
      purpose: input.purpose
    });
  }
});

const consumer = createJournalColdConsumer({ journalApi });
const result = await consumer.retrieveFrozenQuestions({
  locator: { case_id: caseId, corpus_id: corpusId, purpose: "organize_search" },
  questions: [
    { id: "early", query: "hesitate" },
    { id: "middle", query: "discomfort" },
    { id: "late-visual", query: "mieux" },
    { id: "correction", query: "Correction" },
    { id: "absent", query: "volcano" }
  ],
  authContext: null
});
await fs.writeFile(outputPath, `${JSON.stringify(result)}\n`, { mode: 0o600, flag: "wx" });
