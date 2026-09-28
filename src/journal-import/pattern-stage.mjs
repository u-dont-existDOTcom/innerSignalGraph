import { ValidationError } from "../core/errors.mjs";
import { resolveExactQuote, validateJournalGraph } from "./contracts.mjs";
import { createJournalPatternBatches } from "./pattern-batches.mjs";
import { addProvisionalPatterns, buildEpisodeThemeMatrix,
  executeCounterevidenceSearch, reviewPatternRegister } from "./pattern.mjs";

const requireValue = (condition, code) => {
  if (!condition) throw new ValidationError(code, { code });
};

/**
 * Each batch gets a source-only freeze before its first candidate is shown to a
 * separate review context. Durable records let a crash replay the same decisions
 * without issuing a second inference submission.
 */
export async function runJournalPatternPass({
  graph: reconciledGraph, units, unitGraphs, sourceReader, work,
  readIfPresent, writeOnce, counterReceiptSecret, generation,
  representations, maximumBytes = 50000
}) {
  requireValue(reconciledGraph?.generation === generation, "PATTERN_GENERATION_MISMATCH");
  requireValue(Array.isArray(units) && units.length === unitGraphs.length, "PATTERN_UNIT_SCOPE_INVALID");
  const byId = new Map(units.map(unit => [unit.unit_id, unit]));
  const batches = createJournalPatternBatches({ graph: reconciledGraph, unitGraphs, maximumBytes });
  let graph = structuredClone(reconciledGraph);
  const reports = [];
  for (const batch of batches) {
    const batchUnits = batch.unit_ids.map(id => byId.get(id));
    requireValue(batchUnits.every(Boolean), "PATTERN_BATCH_UNIT_MISSING");
    const sourceWindows = batchUnits.map(unit => ({ unit_id: unit.unit_id, text: unit.text }));
    const freezeId = `pattern:source-freeze:${batch.id}`;
    let frozen = await readIfPresent(freezeId);
    if (!frozen) {
      const result = await work({
        id: freezeId, role: "reference_reader", stage: "REFERENCE_AUDIT",
        units: batchUnits, packetInput: { source_windows: sourceWindows,
          adjacent_context: { before: "", after: "" }, visual_context: [],
          neutral_reading_instructions: [] }
      });
      if (!result) return { status: "blocked", stage: "REFERENCE_AUDIT", reports };
      frozen = await writeOnce(freezeId, result[0]);
    }
    requireValue(frozen.output.source_only_first_pass === true
      && frozen.output.unassessed_unit_ids.length === 0, "PATTERN_SOURCE_FREEZE_INCOMPLETE");
    for (const item of frozen.output.reference_items) for (const anchor of item.anchors) {
      const unit = byId.get(anchor.unit_id);
      requireValue(unit && batch.unit_ids.includes(anchor.unit_id), "PATTERN_SOURCE_FREEZE_ANCHOR_OUTSIDE_BATCH");
      resolveExactQuote(unit.text, anchor.quote, anchor.occurrence);
    }

    const buildId = `pattern:builder:${batch.id}`;
    let built = await readIfPresent(buildId);
    if (!built) {
      const result = await work({
        id: buildId, role: "pattern_builder", stage: "PATTERN_BUILD",
        units: batchUnits, packetInput: {
          validated_graph: batch.graph,
          episode_theme_matrix: buildEpisodeThemeMatrix(batch.graph),
          source_retrieval: { source_passages: batch.graph.nodes.filter(node => node.kind === "passage") },
          coverage_ledger: { assigned_unit_ids: batch.unit_ids, scope_complete: true,
            source_only_unresolved: false },
          target_generation: generation, producer_ref: buildId
        }
      });
      if (!result) return { status: "blocked", stage: "PATTERN_BUILD", reports };
      built = await writeOnce(buildId, result[0]);
    }
    requireValue(built.output.status === "complete_for_stated_scope", "PATTERN_BUILD_SCOPE_INCOMPLETE");
    const added = addProvisionalPatterns({ graph, patternResult: built.output,
      producerReceipt: built.receipt, localIdNamespace: batch.id });
    graph = added.graph;

    const searchRecords = {}, counterReceipts = {};
    for (const id of added.created_pattern_ids) {
      const searchId = `pattern:counter-search:${id}`;
      let saved = await readIfPresent(searchId);
      if (!saved) {
        const queries = added.counterevidence_queries[id];
        requireValue(Array.isArray(queries) && queries.length > 0, "PATTERN_COUNTER_QUERY_MISSING");
        saved = await executeCounterevidenceSearch({
          reader: sourceReader, patternId: id, queries,
          generation, receiptSecret: counterReceiptSecret, maximumResults: 64
        });
        saved = await writeOnce(searchId, saved);
      }
      counterReceipts[id] = saved.receipt;
      searchRecords[id] = { records: saved.records, complete: saved.receipt.complete,
        more_available: saved.receipt.more_available };
    }
    if (!added.created_pattern_ids.length) {
      reports.push({ batch_id: batch.id, pattern_ids: [], status: "reviewed_empty_scope" });
      continue;
    }
    const reviewId = `pattern:reviewer:${batch.id}`;
    let reviewed = await readIfPresent(reviewId);
    if (!reviewed) {
      const result = await work({
        id: reviewId, role: "pattern_reviewer", stage: "PATTERN_REVIEW",
        units: batchUnits, acceptReviewFindings: true,
        packetInput: {
          phase: "B", target_generation: generation,
          candidate_patterns: graph.nodes.filter(node => added.created_pattern_ids.includes(node.id)),
          frozen_observations: frozen.output,
          source_retrieval: { source_graph: batch.graph, counterevidence: searchRecords }
        }
      });
      if (!result) return { status: "blocked", stage: "PATTERN_REVIEW", reports };
      reviewed = await writeOnce(reviewId, result[0]);
    }
    const selected = new Set(added.created_pattern_ids);
    const scoped = {
      ...graph,
      nodes: graph.nodes.filter(node => node.kind !== "pattern" || selected.has(node.id)),
      edges: graph.edges.filter(edge => !["supports_pattern", "exception_to"].includes(edge.relation)
        || selected.has(edge.to))
    };
    const decision = reviewPatternRegister({
      graph: scoped, reviewResult: reviewed.output, reviewReceipt: reviewed.receipt,
      builderReceipt: built.receipt, frozenSourceReceipt: frozen.receipt,
      counterevidenceReceipts: counterReceipts, counterReceiptSecret
    });
    const resolved = new Map(decision.graph.nodes.filter(node => selected.has(node.id)).map(node => [node.id, node]));
    graph.nodes = graph.nodes.map(node => resolved.get(node.id) ?? node);
    reports.push({ batch_id: batch.id, pattern_ids: added.created_pattern_ids,
      status: decision.patterns_reviewed, decisions: decision.decisions,
      counter_search_complete: Object.values(counterReceipts).every(receipt => receipt.complete) });
  }
  validateJournalGraph(graph, representations);
  return { status: reports.every(report => ["pass", "reviewed_empty_scope"].includes(report.status))
    ? "pass" : "partial", graph, reports, batches: batches.length };
}
