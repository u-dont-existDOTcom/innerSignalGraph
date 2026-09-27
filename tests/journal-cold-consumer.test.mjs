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

test("a pattern's supporting assertions are not sent for source resolution; its closure passages are", async () => {
  const requested = [];
  const journalApi = {
    async search() {
      return {
        snapshot: { generation: "generation:synthetic" },
        items: [{ id: "pattern:1", kind: "pattern", data: { support_assertion_ids: ["assertion:1"], counter_assertion_ids: ["assertion:2"] } }],
        next_cursor: null
      };
    },
    async getSubgraph({ seedIds }) {
      assert.deepEqual(seedIds, ["pattern:1"]);
      return {
        closure_status: "complete",
        more_available: false,
        nodes: [
          { id: "assertion:1", kind: "assertion", data: { evidence_ids: ["passage:1"] } },
          { id: "assertion:2", kind: "assertion", data: { evidence_ids: ["passage:2"] } },
          { id: "passage:1", kind: "passage" },
          { id: "passage:2", kind: "passage" }
        ],
        edges: []
      };
    },
    async resolveEvidence({ evidenceIds }) {
      requested.push(...evidenceIds);
      if (evidenceIds.some((id) => !id.startsWith("passage:"))) throw Object.assign(new Error("not a passage"), { code: "EVIDENCE_RECORD_NOT_PASSAGE" });
      return { exact_spans: [], source_locators: [], next_cursor: null };
    }
  };
  const result = await createJournalColdConsumer({ journalApi }).retrieveQuestion({
    locator, question: { id: "q1", query: "synthetic" }, authContext: {}
  });
  assert.equal(result.status, "evidence_retrieved");
  assert.deepEqual(requested.sort(), ["passage:1", "passage:2"]);
});
