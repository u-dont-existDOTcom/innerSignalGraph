import test from "node:test";
import assert from "node:assert/strict";
import { createJournalWorkTools, MAX_JOURNAL_TOOL_RESULT_CHARS } from "../src/server/journal-work-tools.mjs";
import { codexEventReader } from "../src/journal-import/codex-worker.mjs";

const SENTINEL = "SYNTHETIC_SCHEMA_PRIVATE_SENTINEL";
const workId = "job:synthetic-schema-error";

for (const tier of ["standard", "hardest"]) {
  test(`${tier} submit errors contain codes, anonymous paths and counts only`, async () => {
    const entry = { case_id: "synthetic-case", work_id: workId, tier,
      output_schema: { type: "object", additionalProperties: false, required: ["items"],
        properties: { items: { type: "array", items: { type: "object", additionalProperties: false,
          properties: { flag: { type: "boolean" } } } } } } };
    const tools = createJournalWorkTools({ caseId: entry.case_id, tier,
      authorizeCase: async () => ({ principalId: "synthetic" }),
      exchange: { readWork: async () => entry, isExpired: () => false,
        submitResult: async () => { throw new Error("invalid output was stored"); } } });
    const error = await tools.call("submit_journal_work_result", { work_id: workId,
      output: { [SENTINEL]: SENTINEL, items: [{ flag: SENTINEL, [SENTINEL]: SENTINEL }] } });
    assert.equal(error.toolError.code, "JOURNAL_OUTPUT_SCHEMA_INVALID");
    assert.ok(!JSON.stringify(error).includes(SENTINEL));
    assert.ok(error.toolError.details.errors.some(item => item.instance_path === "/property/0/property"));
    assert.ok(error.toolError.details.errors.every(item => Object.keys(item).sort().join() === "instance_path,keyword"));
    const reader = codexEventReader(workId);
    reader.accept(JSON.stringify({ type: "item.completed", item: { type: "mcp_tool_call", server: "journal",
      tool: "submit_journal_work_result", arguments: { work_id: workId }, status: "completed",
      result: { isError: true, structuredContent: error.toolError } } }));
    assert.ok(!JSON.stringify(reader.state).includes(SENTINEL));
  });
}

test("a hardest packet above the declared tool limit is refused without truncation or a fetch marker", async () => {
  const entry = { case_id: "synthetic-case", work_id: workId, tier: "hardest", packet: { text: "x".repeat(MAX_JOURNAL_TOOL_RESULT_CHARS + 1) } };
  const tools = createJournalWorkTools({ caseId: entry.case_id, tier: "hardest", stageDir: "/synthetic-stage",
    authorizeCase: async () => ({ principalId: "synthetic" }),
    exchange: { readWork: async () => entry, isExpired: () => false, hasResult: async () => false,
      submitResult: async () => {}, markPacketFetched: async () => { throw new Error("oversize packet was fetched"); } } });
  const result = await tools.call("get_journal_work_packet", { work_id: workId });
  assert.equal(result.toolError.code, "JOURNAL_WORK_PACKET_TOO_LARGE");
  assert.ok(JSON.stringify(result).length < 200);
});

test("the Claude size guard does not change the standard Codex fetch contract", async () => {
  const packet = { text: "x".repeat(MAX_JOURNAL_TOOL_RESULT_CHARS + 1) };
  const entry = { case_id: "synthetic-case", work_id: workId, tier: "standard", role: "reference_reader",
    instruction: "Synthetic instruction", packet, output_schema: { type: "object" },
    expected_generation: "synthetic-generation", expires_at: "2099-01-01T00:00:00.000Z" };
  let fetched = 0;
  const tools = createJournalWorkTools({ caseId: entry.case_id, tier: "standard", stageDir: "/synthetic-stage",
    authorizeCase: async () => ({ principalId: "synthetic" }),
    exchange: { readWork: async () => entry, isExpired: () => false, hasResult: async () => false,
      submitResult: async () => {}, markPacketFetched: async () => { fetched += 1; } } });
  const result = await tools.call("get_journal_work_packet", { work_id: workId });
  assert.deepEqual(result, { value: { work_id: workId, status: "ready", role: "reference_reader",
    instruction: "Synthetic instruction", packet, output_schema: { type: "object" },
    expected_generation: "synthetic-generation", expires_at: "2099-01-01T00:00:00.000Z",
    submit_with: "submit_journal_work_result" } });
  assert.equal(fetched, 1);
});

test("hardest complete packet boundary is 450,000 characters, below the 500,000 tool declaration", async () => {
  const { journalWorkPacketValue, MAX_HARDEST_PACKET_CHARS } = await import("../src/journal-import/packet-bounds.mjs");
  assert.equal(MAX_JOURNAL_TOOL_RESULT_CHARS, 500_000);
  assert.equal(MAX_HARDEST_PACKET_CHARS, 450_000);
  for (const extra of [0, 1]) {
    const entry = { case_id: "synthetic-case", work_id: workId, tier: "hardest", role: "extractor",
      instruction: "SYNTHETIC_INSTRUCTION", packet: { text: "" }, output_schema: { type: "object" },
      expected_generation: "synthetic-generation", expires_at: "2099-01-01T00:00:00.000Z" };
    entry.packet.text = "x".repeat(MAX_HARDEST_PACKET_CHARS - JSON.stringify(journalWorkPacketValue(entry)).length + extra);
    let fetched = false, attemptFetched = false;
    const record = { work_id: workId, attempt_identity: "a".repeat(48) };
    const tools = createJournalWorkTools({ caseId: entry.case_id, tier: "hardest", stageDir: "/synthetic-stage",
      markAttemptPacketFetched: async (root, dispatch) => {
        assert.equal(root, "/synthetic-exchange"); assert.deepEqual(dispatch, record); attemptFetched = true;
      },
      authorizeCase: async () => ({ principalId: "synthetic" }), exchange: {
        root: "/synthetic-exchange", listDispatch: async () => [record],
        readWork: async () => entry, isExpired: () => false, hasResult: async () => false,
        submitResult: async () => {}, markPacketFetched: async () => { fetched = true; } } });
    const result = await tools.call("get_journal_work_packet", { work_id: workId });
    assert.equal(fetched, extra === 0);
    assert.equal(attemptFetched, extra === 0);
    if (extra) assert.equal(result.toolError.code, "JOURNAL_WORK_PACKET_TOO_LARGE");
    else assert.equal(JSON.stringify(result.value).length, MAX_HARDEST_PACKET_CHARS);
  }
});

test("a server scoped to one item neither serves, marks nor accepts another item", async () => {
  const other = "job:synthetic-other-item";
  let reads = 0, marks = 0, stores = 0;
  const tools = createJournalWorkTools({ caseId: "synthetic-case", tier: "hardest", stageDir: "/synthetic-stage", workId,
    authorizeCase: async () => ({ principalId: "synthetic" }),
    markAttemptPacketFetched: async () => { marks += 1; },
    exchange: { readWork: async () => { reads += 1; return null; }, isExpired: () => false, hasResult: async () => false,
      submitResult: async () => { stores += 1; }, stageResult: async () => { stores += 1; },
      markPacketFetched: async () => { marks += 1; }, listDispatch: async () => [] } });
  for (const name of ["get_journal_work_packet", "submit_journal_work_result"]) {
    const result = await tools.call(name, { work_id: other, output: {} });
    assert.equal(result.toolError.code, "JOURNAL_WORK_SCOPE_MISMATCH");
  }
  assert.deepEqual({ reads, marks, stores }, { reads: 0, marks: 0, stores: 0 });
  assert.throws(() => createJournalWorkTools({ caseId: "synthetic-case", workId: "bad id", authorizeCase: async () => ({}),
    exchange: { readWork: async () => null, submitResult: async () => {} } }), TypeError);
});
