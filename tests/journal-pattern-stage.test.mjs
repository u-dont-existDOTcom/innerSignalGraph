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
    assert.equal(packetInput.source_retrieval.counterevidence[
      packetInput.candidate_patterns[0].id].records.length, 70);
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
    generation, representations, counterevidenceMaximumBytes: 50_000 };
  const first = await runJournalPatternPass(args);
  assert.deepEqual(calls, ["reference_reader", "pattern_builder", "pattern_reviewer", "pattern_reviewer"]);
  assert.equal(first.status, "pass");
  assert.equal(first.graph.nodes.find(node => node.kind === "pattern").data.review_state, "reviewed");
  const currentSearchId = [...saved.keys()].find(id => id.startsWith("pattern:counter-search:v3:"));
  assert.ok(currentSearchId);
  const currentSearch = saved.get(currentSearchId);
  saved.delete(currentSearchId);
  saved.set(currentSearchId.replace(":v3:", ":v2:"), {
    records: currentSearch.records.slice(0, 64),
    receipt: currentSearch.receipt
  });
  const searchesBeforeLegacyReplay = searches.length;
  const second = await runJournalPatternPass({ ...args,
    work: async () => { throw new Error("Durable replay submitted again"); },
    sourceReader });
  assert.ok(searches.length > searchesBeforeLegacyReplay, "older truncated receipt must be replaced");
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

function reviewPacketHarness(statements, reviewAnswer = null) {
  const graph = fixture("synthetic-graph.json");
  graph.nodes = graph.nodes.filter(node => node.kind !== "pattern");
  graph.edges = graph.edges.filter(edge => edge.from !== "pat" && edge.to !== "pat");
  const representations = fixture("synthetic-sources.json");
  const text = representations.repr;
  const unit = { unit_id: "u1", representation_id: "repr", text,
    start_byte: 0, end_byte: Buffer.byteLength(text), source_order: 0 };
  const candidate = (statement, index) => ({ local_id: `candidate-${index + 1}`, data: {
    statement, pattern_kind: "single_event", scope: "Invented source only.",
    support_assertion_ids: ["a1", "a3"], counter_assertion_ids: [],
    alternative_explanations: ["Different invented contexts."],
    observation_gaps: ["Unwritten periods remain unknown."],
    disconfirming_question: "Where does this contrast not hold?",
    disconfirmation: { status: "pending", search_receipt_ref: null },
    review_state: "provisional", independent_review_ref: null,
    producer_ref: "producer:synthetic"
  }, counterevidence_queries: ["invented exception"] });
  const reviewerRequests = [];
  const harness = stageHarness({ graph, representations, units: [unit], unitGraphs: [{ unit_id: "u1", graph }] },
    (request) => {
      if (request.role === "reference_reader") return {
        output: freezeOutput(), receipt: receipt("freeze", request.id)
      };
      if (request.role === "pattern_builder") return {
        output: { schema_version: "1.0", target_generation: generation,
          patterns: statements.map(candidate), unclassified_assertion_ids: [],
          coverage_note: "Invented bounded source.", status: "complete_for_stated_scope" },
        receipt: receipt("builder", request.id)
      };
      reviewerRequests.push(request);
      const output = { schema_version: "1.0", target_generation: generation,
        review_role: "pattern_reviewer", assessments: request.packetInput.candidate_patterns.map(pattern => ({
          target_id: pattern.id, outcome: "preserved", critical: false,
          finding_type: "none", explanation: "Synthetic source challenge preserved scope.", evidence_ids: ["p1"]
        })), proposed_repairs: [], unassessed_ids: [], status: "sufficient_for_stated_scope" };
      return { output: reviewAnswer?.(request, output) ?? output,
        receipt: receipt("reviewer", request.id) };
    });
  return { ...harness, reviewerRequests };
}

test("truncated counterevidence stays incomplete and its candidate remains unresolved", async () => {
  const { args, saved, reviewerRequests } = reviewPacketHarness(["Invented bounded contrast."]);
  const records = ["first", "second"].map(id => ({ id, text: "é".repeat(350) }));
  const result = await runJournalPatternPass({ ...args, maximumBytes: 50_000,
    counterevidenceMaximumBytes: 800,
    sourceReader: { async search() { return { records, next_cursor: null }; } } });

  const searchId = [...saved.keys()].find(id => id.startsWith("pattern:counter-search:"));
  assert.ok(searchId);
  const search = saved.get(searchId);
  assert.equal(search.records.length, 1);
  assert.equal(search.receipt.matched_count, 2);
  assert.equal(search.receipt.complete, false);
  assert.equal(search.receipt.more_available, true);
  assert.ok(reviewerRequests.length > 0);
  assert.ok(reviewerRequests.every(request => {
    const counter = Object.values(request.packetInput.source_retrieval.counterevidence)[0];
    return counter.complete === false && counter.more_available === true;
  }));
  assert.equal(result.status, "partial");
  assert.equal(result.counts.unresolved_batches, 1);
  assert.equal(result.graph.nodes.some(node => node.kind === "pattern"), false);
  assert.ok(result.reports.some(report => report.status === "unresolved"
    && report.reason === "PATTERN_REVIEW_EVIDENCE_INVALID"));
});

test("a large pattern batch is reviewed in ordered packets within the byte budget", async () => {
  const budget = 35_000;
  const statements = [1, 2, 3].map(index => `Invented pattern ${index}: ${"é".repeat(6_000)}`);
  const { args, reviewerRequests } = reviewPacketHarness(statements);
  const result = await runJournalPatternPass({ ...args, maximumBytes: 50_000,
    reviewPacketMaximumBytes: budget });

  assert.equal(result.status, "pass");
  assert.ok(reviewerRequests.length > 1);
  assert.deepEqual(reviewerRequests.flatMap(request =>
    request.packetInput.candidate_patterns.map(pattern => pattern.data.statement)), statements);
  assert.deepEqual(reviewerRequests.map(request => request.id.split(":").at(-1)),
    reviewerRequests.map((_, index) => `group-${index + 1}`));
  assert.ok(reviewerRequests.every(request => Buffer.byteLength(JSON.stringify(request.packetInput), "utf8") <= budget));
  assert.ok(reviewerRequests.every(request =>
    Object.keys(request.packetInput.source_retrieval.counterevidence).join() ===
    request.packetInput.candidate_patterns.map(pattern => pattern.id).join()));
  assert.equal(result.graph.nodes.filter(node => node.kind === "pattern").length, 3);
  assert.equal(result.counts.reviewed_patterns, 3);
  assert.deepEqual(result.reports.map(report => report.review_group),
    reviewerRequests.map((_, index) => `group-${index + 1}`));
  const replay = await runJournalPatternPass({ ...args, maximumBytes: 50_000,
    reviewPacketMaximumBytes: budget,
    work: async () => { throw new Error("Grouped durable replay submitted again"); } });
  assert.deepEqual(replay.graph, result.graph);
  assert.deepEqual(replay.reports, result.reports);
});

test("a candidate too large for a review packet stays unresolved while smaller candidates settle", async () => {
  const budget = 45_000;
  const { args, reviewerRequests } = reviewPacketHarness([
    `Small invented pattern: ${"é".repeat(6_000)}`,
    `Oversized invented pattern: ${"é".repeat(20_000)}`,
    `Another small invented pattern: ${"é".repeat(6_000)}`
  ]);
  const result = await runJournalPatternPass({ ...args, maximumBytes: 50_000,
    reviewPacketMaximumBytes: budget });

  assert.equal(result.status, "partial");
  assert.equal(reviewerRequests.length, 2);
  assert.ok(reviewerRequests.every(request =>
    Buffer.byteLength(JSON.stringify(request.packetInput), "utf8") <= budget));
  const oversized = result.reports.find(report => report.reason === "PATTERN_REVIEW_PACKET_TOO_LARGE");
  assert.equal(oversized.pattern_ids.length, 1);
  assert.ok(reviewerRequests.every(request =>
    request.packetInput.candidate_patterns.every(pattern => pattern.id !== oversized.pattern_ids[0])));
  assert.equal(result.graph.nodes.some(node => node.id === oversized.pattern_ids[0]), false);
  assert.equal(result.graph.nodes.filter(node => node.kind === "pattern").length, 2);
  assert.equal(result.counts.reviewed_patterns, 2);
  assert.equal(result.counts.unresolved_batches, 1);
});

test("a single review packet retains the pre-existing batch step ID", async () => {
  const split = reviewPacketHarness([1, 2].map(index =>
    `Invented pattern ${index}: ${"é".repeat(6_000)}`));
  await runJournalPatternPass({ ...split.args, maximumBytes: 50_000,
    reviewPacketMaximumBytes: 35_000 });
  assert.equal(split.reviewerRequests.length, 2);

  const { args, reviewerRequests } = reviewPacketHarness(["A short invented pattern."]);
  const result = await runJournalPatternPass({ ...args, maximumBytes: 50_000,
    reviewPacketMaximumBytes: 35_000 });

  assert.equal(result.status, "pass");
  assert.equal(reviewerRequests.length, 1);
  assert.equal(reviewerRequests[0].id, `pattern:reviewer:${result.reports[0].batch_id}`);
  assert.equal(Object.hasOwn(result.reports[0], "review_group"), false);
});

test("failure of one review group leaves other groups' patterns settled", async () => {
  const { args, reviewerRequests } = reviewPacketHarness(
    [1, 2, 3].map(index => `Invented pattern ${index}: ${"é".repeat(6_000)}`),
    (request, output) => request.id.endsWith("group-2") || request.id.includes("group-2:attempt:")
      ? { ...output, status: "incomplete" } : output);
  const result = await runJournalPatternPass({ ...args, maximumBytes: 50_000,
    reviewPacketMaximumBytes: 35_000 });

  assert.equal(result.status, "partial");
  assert.equal(reviewerRequests.filter(request => request.id.includes("group-2")).length, 3);
  assert.equal(result.reports.find(report => report.review_group === "group-2").reason, "PATTERN_REVIEW_INCOMPLETE");
  assert.deepEqual(result.reports.filter(report => report.status === "reviewed").map(report => report.review_group),
    ["group-1", "group-3"]);
  assert.equal(result.graph.nodes.filter(node => node.kind === "pattern").length, 2);
  assert.equal(result.counts.reviewed_patterns, 2);
  assert.equal(result.counts.unresolved_batches, 1);
});

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

test("an explicitly unassessed candidate cannot settle a sufficient pattern review", async () => {
  const graph = fixture("synthetic-graph.json");
  graph.nodes = graph.nodes.filter(node => node.kind !== "pattern");
  graph.edges = graph.edges.filter(edge => edge.from !== "pat" && edge.to !== "pat");
  const representations = fixture("synthetic-sources.json");
  const unit = { unit_id: "u1", representation_id: "repr", text: representations.repr,
    start_byte: 0, end_byte: Buffer.byteLength(representations.repr), source_order: 0 };
  let reviewCalls = 0;
  const { args } = stageHarness({ graph, representations, units: [unit], unitGraphs: [{ unit_id: "u1", graph }] },
    (request) => {
      if (request.role === "reference_reader") {
        return { output: freezeOutput(), receipt: receipt("freeze", request.id) };
      }
      if (request.role === "pattern_builder") {
        return { output: { schema_version: "1.0", target_generation: generation,
          patterns: [{ local_id: "candidate", data: {
            statement: "Invented reports show a bounded contrast.", pattern_kind: "recurrent", scope: "Two invented supports.",
            support_assertion_ids: ["a1", "a3"], counter_assertion_ids: [], alternative_explanations: ["Other contexts."],
            observation_gaps: ["Unwritten periods."], disconfirming_question: "Where does this not hold?",
            disconfirmation: { status: "pending", search_receipt_ref: null }, review_state: "provisional",
            independent_review_ref: null, producer_ref: "producer:synthetic" }, counterevidence_queries: ["exception"] }],
          unclassified_assertion_ids: [], coverage_note: "Bounded source.", status: "complete_for_stated_scope" },
        receipt: receipt("builder", request.id) };
      }
      reviewCalls += 1;
      const patternId = request.packetInput.candidate_patterns[0].id;
      return { output: { schema_version: "1.0", target_generation: generation, review_role: "pattern_reviewer",
        assessments: [{ target_id: patternId, outcome: reviewCalls === 1 ? "unassessed" : "preserved",
          critical: false, finding_type: "none", explanation: "The candidate was not conclusively assessed.", evidence_ids: [] }],
        proposed_repairs: [], unassessed_ids: reviewCalls === 1 ? [] : [patternId],
        status: "sufficient_for_stated_scope" }, receipt: receipt("reviewer", request.id) };
    });

  const result = await runJournalPatternPass({ ...args, maximumBytes: 50_000 });

  assert.equal(reviewCalls, 3);
  assert.equal(result.status, "partial");
  assert.equal(result.graph.nodes.some(node => node.kind === "pattern"), false);
  assert.deepEqual(result.reports.map(report => [report.status, report.stage, report.reason]),
    [["unresolved", "PATTERN_REVIEW", "PATTERN_REVIEW_INCOMPLETE"]]);
});

test("a disputed pattern still requires authenticated independent receipts and counterevidence", async () => {
  const graph = fixture("synthetic-graph.json");
  graph.nodes = graph.nodes.filter(node => node.kind !== "pattern");
  graph.edges = graph.edges.filter(edge => edge.from !== "pat" && edge.to !== "pat");
  const representations = fixture("synthetic-sources.json");
  const unit = { unit_id: "u1", representation_id: "repr", text: representations.repr,
    start_byte: 0, end_byte: Buffer.byteLength(representations.repr), source_order: 0 };
  let reviewCalls = 0;
  let builderContext;
  const { args } = stageHarness({ graph, representations, units: [unit], unitGraphs: [{ unit_id: "u1", graph }] },
    (request) => {
      if (request.role === "reference_reader") {
        return { output: freezeOutput(), receipt: receipt("freeze", request.id) };
      }
      if (request.role === "pattern_builder") {
        builderContext = request.id;
        return { output: { schema_version: "1.0", target_generation: generation,
          patterns: [{ local_id: "candidate", data: {
            statement: "Invented reports show a bounded contrast.", pattern_kind: "recurrent", scope: "Two invented supports.",
            support_assertion_ids: ["a1", "a3"], counter_assertion_ids: [], alternative_explanations: ["Other contexts."],
            observation_gaps: ["Unwritten periods."], disconfirming_question: "Where does this not hold?",
            disconfirmation: { status: "pending", search_receipt_ref: null }, review_state: "provisional",
            independent_review_ref: null, producer_ref: "producer:synthetic" }, counterevidence_queries: ["exception"] }],
          unclassified_assertion_ids: [], coverage_note: "Bounded source.", status: "complete_for_stated_scope" },
        receipt: receipt("builder", request.id) };
      }
      reviewCalls += 1;
      const patternId = request.packetInput.candidate_patterns[0].id;
      return { output: { schema_version: "1.0", target_generation: generation, review_role: "pattern_reviewer",
        assessments: [{ target_id: patternId, outcome: "distorted", critical: true,
          finding_type: "unsupported_claim", explanation: "The claim is unsupported.", evidence_ids: [] }],
        proposed_repairs: [], unassessed_ids: [], status: "sufficient_for_stated_scope" },
      // Sharing the builder context violates the independence requirement even though the
      // semantic dispute itself is a complete and acceptable outcome.
      receipt: receipt("reviewer", builderContext) };
    });

  const result = await runJournalPatternPass({ ...args, maximumBytes: 50_000 });

  assert.equal(reviewCalls, 3);
  assert.equal(result.status, "partial");
  assert.equal(result.graph.nodes.some(node => node.kind === "pattern"), false);
  assert.deepEqual(result.reports.map(report => [report.status, report.stage, report.reason]),
    [["unresolved", "PATTERN_REVIEW", "PATTERN_REVIEW_EVIDENCE_INVALID"]]);
});
