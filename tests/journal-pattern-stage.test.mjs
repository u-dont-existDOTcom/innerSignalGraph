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
  const broadMatches = Array.from({ length: 70 }, (_, index) => ({
    ...structuredClone(graph.nodes.find(node => node.id === "p4")), id: `broad-match-${index}`
  }));
  const sourceReader = { async search({ query, cursor }) {
    searches.push({ query, cursor });
    return { records: cursor ? broadMatches.slice(35) : broadMatches.slice(0, 35), next_cursor: cursor ? null : "page:2" };
  } };
  let reviewerCalls = 0;
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
    reviewerCalls += 1;
    assert.ok(searches.length > 0);
    assert.equal(packetInput.frozen_observations.source_only_first_pass, true);
    assert.equal(packetInput.source_retrieval.counterevidence[
      packetInput.candidate_patterns[0].id].complete, true);
    assert.equal(packetInput.source_retrieval.counterevidence[
      packetInput.candidate_patterns[0].id].total_matches, 70);
    assert.ok(packetInput.source_retrieval.counterevidence[
      packetInput.candidate_patterns[0].id].records.length < 70);
    assert.ok(packetInput.source_retrieval.counterevidence[
      packetInput.candidate_patterns[0].id].records.length > 0);
    return [{ output: { schema_version: "1.0", target_generation: generation,
      review_role: "pattern_reviewer", assessments: [{
        target_id: packetInput.candidate_patterns[0].id, outcome: "preserved",
        critical: false, finding_type: "none",
        explanation: "Synthetic source challenge preserved scope.", evidence_ids: ["p1", "p3", "p4"]
      }], proposed_repairs: [], unassessed_ids: [],
      status: reviewerCalls === 1 ? "incomplete" : "sufficient_for_stated_scope" },
      receipt: receipt("reviewer", `fresh-reviewer-${reviewerCalls}`) }];
  };
  const args = { graph, units, unitGraphs, sourceReader, work,
    readIfPresent, writeOnce, counterReceiptSecret: Buffer.alloc(32, 63),
    generation, representations, counterevidenceMaximumBytes: 5_000 };
  const first = await runJournalPatternPass(args);
  assert.deepEqual(calls, ["reference_reader", "pattern_builder", "pattern_reviewer", "pattern_reviewer"]);
  assert.equal(first.status, "pass");
  assert.equal(first.graph.nodes.find(node => node.kind === "pattern").data.review_state, "reviewed");
  const currentSearchId = [...saved.keys()].find(id => id.startsWith("pattern:counter-search:v2:"));
  assert.ok(currentSearchId);
  const currentSearch = saved.get(currentSearchId);
  saved.delete(currentSearchId);
  saved.set(currentSearchId.replace(":v2:", ":"), {
    records: currentSearch.records.slice(0, 64),
    receipt: { ...currentSearch.receipt, complete: false, more_available: true }
  });
  const searchesBeforeLegacyReplay = searches.length;
  const second = await runJournalPatternPass({ ...args,
    work: async () => { throw new Error("Durable replay submitted again"); },
    sourceReader });
  assert.ok(searches.length > searchesBeforeLegacyReplay, "legacy capped search must be replaced");
  assert.equal(second.status, "pass");
  const third = await runJournalPatternPass({ ...args,
    work: async () => { throw new Error("Durable replay submitted again"); },
    sourceReader: { search: async () => { throw new Error("Durable search repeated"); } } });
  assert.equal(third.status, "pass");
  assert.deepEqual(third.graph, first.graph);
});

// Two single-unit batches over the synthetic graph: the first unit holds a restricted passage, the
// second does not.
function twoBatchScope() {
  const graph = fixture("synthetic-graph.json");
  graph.nodes = graph.nodes.filter(node => node.kind !== "pattern");
  graph.edges = graph.edges.filter(edge => edge.from !== "pat" && edge.to !== "pat");
  const p1 = graph.nodes.find(node => node.id === "p1");
  graph.nodes.push({ ...structuredClone(p1), id: "restricted-passage",
    data: { ...structuredClone(p1.data), unit_id: "u1", quote: null, disclosure: "restricted" } });
  const representations = fixture("synthetic-sources.json");
  const text = representations.repr;
  const units = ["u1", "u2"].map((unitId, index) => ({ unit_id: unitId, representation_id: "repr", text,
    start_byte: 0, end_byte: Buffer.byteLength(text), source_order: index }));
  const part = ids => ({ ...graph, nodes: graph.nodes.filter(node => ids.includes(node.id)), edges: [] });
  return { graph, representations, units,
    unitGraphs: [{ unit_id: "u1", graph: part(["a1", "restricted-passage"]) }, { unit_id: "u2", graph: part(["a3"]) }] };
}

function stageHarness(scope, answer) {
  const saved = new Map(), calls = [];
  return {
    saved, calls,
    args: { graph: scope.graph, units: scope.units, unitGraphs: scope.unitGraphs, generation, representations: scope.representations,
      sourceReader: { async search() { return { records: [], next_cursor: null }; } },
      readIfPresent: async id => saved.get(id) ?? null,
      writeOnce: async (id, value) => { assert.equal(saved.has(id), false); saved.set(id, value); return value; },
      counterReceiptSecret: Buffer.alloc(32, 63), maximumBytes: 10000,
      work: async (request) => { calls.push(request.id); return [answer(request)]; } }
  };
}

const freezeOutput = (unassessed = []) => ({ schema_version: "1.0", source_only_first_pass: true,
  reference_items: [], questions: [], unassessed_unit_ids: unassessed });
const emptyBuild = { schema_version: "1.0", target_generation: generation, patterns: [], unclassified_assertion_ids: [],
  coverage_note: "Invented bounded source.", status: "complete_for_stated_scope" };

test("a restricted unit may stay unassessed in the source freeze, and no other unit may", async () => {
  const scope = twoBatchScope();
  const { args, calls } = stageHarness(scope, (request) => request.role === "reference_reader"
    ? { output: freezeOutput(request.units.map(unit => unit.unit_id)), receipt: receipt("freeze", request.id) }
    : { output: emptyBuild, receipt: receipt("builder", request.id) });
  const result = await runJournalPatternPass(args);
  // The restricted unit's freeze is used at once. The other unit's freeze, which leaves an
  // ordinary unit unassessed, is asked three times and its batch recorded as unresolved.
  const freezes = calls.filter(id => id.startsWith("pattern:source-freeze:"));
  assert.equal(freezes.length, 4);
  assert.equal(result.status, "partial");
  assert.deepEqual(result.reports.map(report => report.status).sort(), ["reviewed_empty_scope", "unresolved"]);
  assert.equal(result.reports.find(report => report.status === "unresolved").reason, "PATTERN_SOURCE_FREEZE_INCOMPLETE");
  assert.equal(result.counts.unresolved_batches, 1);
});

test("an unresolved batch keeps its candidates out of the graph, and a rerun replays every attempt without asking again", async () => {
  const scope = twoBatchScope();
  const candidate = (request) => ({ schema_version: "1.0", target_generation: generation,
    patterns: [{ local_id: "candidate", data: {
      statement: "Invented reports show a bounded contrast.", pattern_kind: "recurrent", scope: "Two invented support groups.",
      // Only the builder for the first unit's batch cites an assertion the graph doesn't have.
      support_assertion_ids: request.units[0].unit_id === "u1" ? ["a1", "invented-assertion"] : ["a1", "a3"],
      counter_assertion_ids: [], alternative_explanations: ["Different invented contexts."],
      observation_gaps: ["Unwritten periods remain unknown."], disconfirming_question: "Where does this contrast not hold?",
      disconfirmation: { status: "pending", search_receipt_ref: null }, review_state: "provisional", independent_review_ref: null,
      producer_ref: "producer:synthetic" },
      counterevidence_queries: ["invented exception"] }],
    unclassified_assertion_ids: [], coverage_note: "Invented bounded source.", status: "complete_for_stated_scope" });
  const answer = (request) => {
    if (request.role === "reference_reader") return { output: freezeOutput(), receipt: receipt("freeze", request.id) };
    if (request.role === "pattern_builder") return { output: candidate(request), receipt: receipt("builder", request.id) };
    return { output: { schema_version: "1.0", target_generation: generation, review_role: "pattern_reviewer",
      assessments: request.packetInput.candidate_patterns.map(pattern => ({ target_id: pattern.id, outcome: "preserved", critical: false,
        finding_type: "none", explanation: "Synthetic source challenge preserved scope.", evidence_ids: ["p1"] })),
      proposed_repairs: [], unassessed_ids: [], status: "sufficient_for_stated_scope" }, receipt: receipt("reviewer", request.id) };
  };
  const { args, calls, saved } = stageHarness(scope, answer);
  const first = await runJournalPatternPass(args);
  assert.equal(calls.filter(id => id.startsWith("pattern:builder:")).length, 4);
  assert.deepEqual(first.reports.map(report => [report.status, report.reason ?? null]).sort(),
    [["reviewed", null], ["unresolved", "PATTERN_SUPPORT_MISSING"]]);
  const patterns = first.graph.nodes.filter(node => node.kind === "pattern");
  assert.equal(patterns.length, 1);
  assert.equal(patterns[0].data.review_state, "reviewed");
  const second = await runJournalPatternPass({ ...args, readIfPresent: async id => saved.get(id) ?? null,
    work: async () => { throw new Error("Durable replay submitted again"); } });
  assert.deepEqual(second.graph, first.graph);
  assert.deepEqual(second.reports, first.reports);
});

test("an incomplete or missing candidate assessment cannot settle a pattern as disputed", async () => {
  const graph = fixture("synthetic-graph.json");
  graph.nodes = graph.nodes.filter(node => node.kind !== "pattern");
  graph.edges = graph.edges.filter(edge => edge.from !== "pat" && edge.to !== "pat");
  const representations = fixture("synthetic-sources.json");
  const unit = { unit_id: "u1", representation_id: "repr", text: representations.repr,
    start_byte: 0, end_byte: Buffer.byteLength(representations.repr), source_order: 0 };
  const scope = { graph, representations, units: [unit], unitGraphs: [{ unit_id: "u1", graph }] };
  const candidate = () => {
    return { schema_version: "1.0", target_generation: generation,
      patterns: [{ local_id: "candidate", data: {
        statement: "Invented reports show a bounded contrast.", pattern_kind: "recurrent", scope: "One invented support group.",
        support_assertion_ids: ["a1", "a3"], counter_assertion_ids: [], alternative_explanations: ["Different invented contexts."],
        observation_gaps: ["Unwritten periods remain unknown."], disconfirming_question: "Where does this contrast not hold?",
        disconfirmation: { status: "pending", search_receipt_ref: null }, review_state: "provisional", independent_review_ref: null,
        producer_ref: "producer:synthetic" }, counterevidence_queries: ["invented exception"] }],
      unclassified_assertion_ids: [], coverage_note: "Invented bounded source.", status: "complete_for_stated_scope" };
  };
  let reviewCalls = 0;
  const { args } = stageHarness(scope, (request) => {
    if (request.role === "reference_reader") {
      return { output: freezeOutput(), receipt: receipt("freeze", request.id) };
    }
    if (request.role === "pattern_builder") return { output: candidate(request), receipt: receipt("builder", request.id) };
    reviewCalls += 1;
    const patternId = request.packetInput.candidate_patterns[0].id;
    const assessments = reviewCalls % 2 === 1 ? [] : [{ target_id: patternId, outcome: "distorted", critical: true,
      finding_type: "unsupported_claim", explanation: "The claim is unsupported.", evidence_ids: [] }];
    return { output: { schema_version: "1.0", target_generation: generation, review_role: "pattern_reviewer",
      assessments, proposed_repairs: [], unassessed_ids: assessments.length ? [] : [patternId],
      status: assessments.length ? "repair_required" : "sufficient_for_stated_scope" },
      receipt: receipt("reviewer", request.id) };
  });

  const result = await runJournalPatternPass({ ...args, maximumBytes: 50_000 });

  assert.equal(reviewCalls, 3);
  assert.equal(result.status, "partial");
  assert.equal(result.graph.nodes.some(node => node.kind === "pattern"), false);
  assert.deepEqual(result.reports.map(report => [report.status, report.stage, report.reason]),
    [["unresolved", "PATTERN_REVIEW", "PATTERN_REVIEW_INCOMPLETE"]]);
});
