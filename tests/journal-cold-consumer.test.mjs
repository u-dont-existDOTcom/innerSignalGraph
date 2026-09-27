import test from "node:test";
import assert from "node:assert/strict";
import { createJournalColdConsumer } from "../src/case-state/journal-cold-consumer.mjs";

const locator = Object.freeze({ case_id: "synthetic-case", corpus_id: "synthetic-corpus" });

function passagesApi(count) {
  const resolved = [];
  const journalApi = {
    async search() {
      return {
        snapshot: { generation: "generation:synthetic" },
        items: Array.from({ length: count }, (_, index) => ({ id: `passage:${index}`, kind: "passage" })),
        next_cursor: null
      };
    },
    async getSubgraph() { throw new Error("no non-passage seeds in this fixture"); },
    async resolveEvidence({ evidenceIds }) {
      resolved.push(evidenceIds.length);
      return { exact_spans: [], source_locators: [], next_cursor: null };
    }
  };
  return { journalApi, resolved };
}

test("cold retrieval reports passages beyond its evidence bound as more available", async () => {
  const { journalApi, resolved } = passagesApi(250);
  const result = await createJournalColdConsumer({ journalApi }).retrieveQuestion({
    locator, question: { id: "q1", query: "synthetic" }, authContext: {}
  });
  assert.deepEqual(resolved, [200]);
  assert.equal(result.more_available, true);
  assert.match(result.coverage_note, /cut to their bounds/u);
});

test("cold retrieval within its bounds reports complete evidence", async () => {
  const { journalApi, resolved } = passagesApi(12);
  const result = await createJournalColdConsumer({ journalApi }).retrieveQuestion({
    locator, question: { id: "q1", query: "synthetic" }, authContext: {}
  });
  assert.deepEqual(resolved, [12]);
  assert.equal(result.more_available, false);
  assert.match(result.coverage_note, /mandatory evidence closure/u);
});
