import test from "node:test";
import assert from "node:assert/strict";
import { collectColdRetrieval, runColdConsumerComparisons } from "../src/journal-import/cold-profile-test.mjs";

test("cold consumer uses only saved-profile retrieval, traverses past 200 and replays without redisclosure", async () => {
  const rows = Array.from({ length: 250 }, (_, i) => ({
    id: `passage:${i}`, kind: "passage",
    data: { quote: `Synthetic evidence ${i}` }
  }));
  const searches = [], calls = [], saved = new Map();
  const reader = { async search({ query, graphEnabled, pageSize, cursor }) {
    assert.ok(["invented", "middle", "period"].includes(query));
    assert.equal(pageSize, 200);
    searches.push({ graphEnabled, cursor });
    const offset = cursor ? Number(cursor) : 0;
    return { records: rows.slice(offset, offset + pageSize),
      total_matches: rows.length,
      next_cursor: offset + pageSize < rows.length ? String(offset + pageSize) : null };
  } };
  const port = { async invoke({ role, packet, outputSchema }) {
    assert.equal(role, "cold_consumer");
    assert.equal(outputSchema, "answer-result");
    assert.equal(Object.hasOwn(packet, "source_upload"), false);
    assert.equal(Object.hasOwn(packet.frozen_question, "expected_elements"), false);
    assert.equal(packet.retrieved_evidence.traversed_count, 250);
    assert.equal(packet.retrieved_evidence.records.length, 32);
    assert.equal(packet.retrieved_evidence.more_available, true);
    calls.push(packet.retrieved_evidence.graph_enabled);
    return { output: { schema_version: "1.0", question_id: packet.frozen_question.id,
      answer: "", answerability: "insufficient_context", evidence_ids: [], qualifier_ids: [],
      snapshot_generation: packet.current_locator.generation,
      coverage_note: "Synthetic packet limited to thirty-two matches.", more_available: true },
      receipt: { receipt_id: "receipt:synthetic" } };
  } };
  const readIfPresent = async id => saved.get(id) ?? null;
  const writeOnce = async (id, value) => { assert.equal(saved.has(id), false); saved.set(id, value); return value; };
  const args = { reader, port, questions: [{ id: "question:synthetic",
    question: "What happened in the invented middle period?" }],
    grant: { purpose: "session_use" }, caseId: "case:synthetic",
    corpusId: "corpus:synthetic", generation: "generation:synthetic",
    readIfPresent, writeOnce, packetRecordLimit: 32 };
  const first = await runColdConsumerComparisons(args);
  assert.deepEqual(calls, [true, false]);
  assert.equal(searches.length, 12);
  assert.equal(first[0].variants[0].retrieval.traversed_count, 250);
  const second = await runColdConsumerComparisons({
    ...args, reader: { search() { throw new Error("Cold replay searched again"); } },
    port: { invoke() { throw new Error("Cold replay submitted again"); } }
  });
  assert.deepEqual(second, first);
  await assert.rejects(() => runColdConsumerComparisons({ ...args,
    questions: [{ id: "question:synthetic", question: "Question?",
      expected_elements: ["Forbidden answer key"] }] }), { code: "COLD_QUESTION_ISOLATION_INVALID" });
});

test("cold packet samples distinct lexical queries before filling from a common term", async () => {
  const queryRows = {
    invented: Array.from({ length: 100 }, (_, i) => ({ id: `common:${i}` })),
    middle: [{ id: "rare:middle" }],
    period: [{ id: "rare:period" }]
  };
  const reader = { async search({ query, cursor }) {
    const rows = queryRows[query];
    assert.ok(rows);
    assert.equal(cursor, null);
    return { records: rows, total_matches: rows.length, next_cursor: null };
  } };
  const result = await collectColdRetrieval({ reader,
    question: "What happened in the invented middle period?",
    graphEnabled: true, packetRecordLimit: 3 });
  assert.deepEqual(result.records.map(record => record.id),
    ["common:0", "rare:middle", "rare:period"]);
  assert.equal(result.traversed_count, 102);
  assert.equal(result.more_available, true);
});
