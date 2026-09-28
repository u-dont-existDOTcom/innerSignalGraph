import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runJournalPatternPass } from "../src/journal-import/pattern-stage.mjs";

const fixture = name => JSON.parse(readFileSync(
  new URL(`../schemas/journal-import/fixtures/${name}`, import.meta.url), "utf8"));
const generation = "generation-1";
const receipt = (role, context) => ({
  receipt_id: `receipt:${role}`, transport: "mock",
  request_id: `request:${role}`, request_context_id: context,
  input_manifest_sha256: "a".repeat(64), role_instruction_sha256: "b".repeat(64),
  completion_status: "completed", target_generation: generation,
  grant_id: "grant:synthetic", grant_purpose: "organize_search",
  authentication_tag: "authenticated-synthetic-tag"
});

test("pattern pass freezes source before neutral candidates, searches contrary source, then reviews in a fresh context", async () => {
  const graph = fixture("synthetic-graph.json");
  graph.nodes = graph.nodes.filter(node => node.kind !== "pattern");
  graph.edges = graph.edges.filter(edge => edge.from !== "pat" && edge.to !== "pat");
  const representations = fixture("synthetic-sources.json");
  const units = [{ unit_id: "u1", representation_id: "repr",
    text: representations.repr, start_byte: 0,
    end_byte: Buffer.byteLength(representations.repr), source_order: 0 }];
  const unitGraphs = [{ unit_id: "u1", graph }];
  const saved = new Map(), calls = [], searches = [];
  const readIfPresent = async id => saved.get(id) ?? null;
  const writeOnce = async (id, value) => { assert.equal(saved.has(id), false); saved.set(id, value); return value; };
  const sourceReader = { async search({ query, cursor }) {
    searches.push({ query, cursor });
    return { records: cursor ? [] : [graph.nodes.find(node => node.id === "p4")], next_cursor: null };
  } };
  const work = async ({ role, packetInput }) => {
    calls.push(role);
    if (role === "reference_reader") {
      assert.equal(calls.length, 1);
      assert.equal(Object.hasOwn(packetInput, "candidate_patterns"), false);
      return [{ output: { schema_version: "1.0", source_only_first_pass: true,
        reference_items: [], questions: [], unassessed_unit_ids: [] },
        receipt: receipt("freeze", "fresh-freeze") }];
    }
    if (role === "pattern_builder") {
      assert.equal(calls[0], "reference_reader");
      assert.equal(Object.hasOwn(packetInput, "candidate_patterns"), false);
      assert.equal(packetInput.validated_graph.nodes.some(node => node.kind === "pattern"), false);
      return [{ output: { schema_version: "1.0", target_generation: generation,
        patterns: [{ local_id: "candidate", data: {
          statement: "Invented reports show a bounded contrast.",
          pattern_kind: "recurrent", scope: "Only two invented support groups.",
          support_assertion_ids: ["a1", "a3"], counter_assertion_ids: ["a4"],
          alternative_explanations: ["Different invented contexts."],
          observation_gaps: ["Unwritten periods remain unknown."],
          disconfirming_question: "Where does this contrast not hold?",
          disconfirmation: { status: "pending", search_receipt_ref: null },
          review_state: "provisional", independent_review_ref: null,
          producer_ref: "producer:synthetic"
        }, counterevidence_queries: ["invented exception"] }],
        unclassified_assertion_ids: ["a2", "a4", "a5", "a6", "a7"],
        coverage_note: "Invented bounded source.", status: "complete_for_stated_scope" },
        receipt: receipt("builder", "fresh-builder") }];
    }
    assert.equal(role, "pattern_reviewer");
    assert.equal(calls[1], "pattern_builder");
    assert.ok(searches.length > 0);
    assert.equal(packetInput.frozen_observations.source_only_first_pass, true);
    assert.equal(packetInput.source_retrieval.counterevidence[
      packetInput.candidate_patterns[0].id].complete, true);
    return [{ output: { schema_version: "1.0", target_generation: generation,
      review_role: "pattern_reviewer", assessments: [{
        target_id: packetInput.candidate_patterns[0].id, outcome: "preserved",
        critical: false, finding_type: "none",
        explanation: "Synthetic source challenge preserved scope.", evidence_ids: ["p1", "p3", "p4"]
      }], proposed_repairs: [], unassessed_ids: [],
      status: "sufficient_for_stated_scope" },
      receipt: receipt("reviewer", "fresh-reviewer") }];
  };
  const args = { graph, units, unitGraphs, sourceReader, work,
    readIfPresent, writeOnce, counterReceiptSecret: Buffer.alloc(32, 63),
    generation, representations };
  const first = await runJournalPatternPass(args);
  assert.deepEqual(calls, ["reference_reader", "pattern_builder", "pattern_reviewer"]);
  assert.equal(first.status, "pass");
  assert.equal(first.graph.nodes.find(node => node.kind === "pattern").data.review_state, "reviewed");
  const second = await runJournalPatternPass({ ...args,
    work: async () => { throw new Error("Durable replay submitted again"); },
    sourceReader: { search: async () => { throw new Error("Durable search repeated"); } } });
  assert.equal(second.status, "pass");
  assert.deepEqual(second.graph, first.graph);
});
