import { ValidationError } from "../core/errors.mjs";
import { resolveExactQuote, validateJournalGraph } from "./contracts.mjs";
import { createJournalPatternBatches } from "./pattern-batches.mjs";
import { addProvisionalPatterns, buildEpisodeThemeMatrix,
  executeCounterevidenceSearch, reviewPatternRegister } from "./pattern.mjs";

const requireValue = (condition, code) => {
  if (!condition) throw new ValidationError(code, { code });
};

/** How many times one batch step is asked before the batch is recorded as unresolved. */
export const PATTERN_STEP_ATTEMPTS = 3;

// A review decision that ends a pattern's review: kept as reviewed, or kept and marked disputed.
// A provisional decision means the review itself was incomplete.
const SETTLED_DECISIONS = new Set(["reviewed", "disputed"]);

// The code a stored output fails its check with, or null when it passes.
function failureOf(check, saved) {
  try {
    check(saved);
    return null;
  } catch (error) {
    if (error instanceof ValidationError) return error.code ?? "PATTERN_STEP_OUTPUT_INVALID";
    throw error;
  }
}

/**
 * Each batch gets a source-only freeze before its first candidate is shown to a
 * separate review context. Durable records let a crash replay the same decisions
 * without issuing a second inference submission.
 *
 * A step's output is used only once it passes its checks. Each attempt is stored
 * under its own ID, so a rerun neither uses a failed attempt nor sends it again.
 * When every attempt fails, the batch is recorded as unresolved with the check's
 * code, none of its candidates enter the graph, and the pass goes on to the next
 * batch: one hard batch does not hold up the rest of the register.
 */
export async function runJournalPatternPass({
  graph: reconciledGraph, units, unitGraphs, sourceReader, work,
  readIfPresent, writeOnce, counterReceiptSecret, generation,
  representations, maximumBytes = 50000, counterevidenceMaximumBytes = maximumBytes,
  stepFailure = () => null
}) {
  requireValue(reconciledGraph?.generation === generation, "PATTERN_GENERATION_MISMATCH");
  requireValue(Array.isArray(units) && units.length === unitGraphs.length, "PATTERN_UNIT_SCOPE_INVALID");
  const byId = new Map(units.map(unit => [unit.unit_id, unit]));
  // A unit holding restricted material, which the reference reader is told to leave unassessed.
  const restrictedUnits = new Set(unitGraphs.filter(({ unit_id: unitId, graph: part }) => part.nodes.some(node =>
    node.kind === "passage" && node.data?.disclosure === "restricted" && node.data.unit_id === unitId))
    .map(({ unit_id: unitId }) => unitId));
  const batches = createJournalPatternBatches({ graph: reconciledGraph, unitGraphs, maximumBytes });
  let graph = structuredClone(reconciledGraph);
  const reports = [];

  const checkedStep = async (baseId, request, check) => {
    let failure = null;
    for (let attempt = 1; attempt <= PATTERN_STEP_ATTEMPTS; attempt += 1) {
      const id = attempt === 1 ? baseId : `${baseId}:attempt:${attempt}`;
      let saved = await readIfPresent(id);
      if (!saved) {
        const result = await work({ ...request, id });
        if (!result) {
          // A job that failed for good (the caller says which) is a failed attempt; any other
          // blocker pauses the pass.
          failure = stepFailure();
          if (!failure) return { blocked: true };
          continue;
        }
        saved = await writeOnce(id, result[0]);
      }
      failure = failureOf(check, saved);
      if (!failure) return { saved, attempts: attempt };
    }
    return { failure };
  };
  const unresolved = (batch, stage, reason) => reports.push({ batch_id: batch.id, pattern_ids: [], status: "unresolved", stage, reason });

  for (const batch of batches) {
    const batchUnits = batch.unit_ids.map(id => byId.get(id));
    requireValue(batchUnits.every(Boolean), "PATTERN_BATCH_UNIT_MISSING");
    const sourceWindows = batchUnits.map(unit => ({ unit_id: unit.unit_id, text: unit.text }));

    const freeze = await checkedStep(`pattern:source-freeze:${batch.id}`, {
      role: "reference_reader", stage: "REFERENCE_AUDIT",
      units: batchUnits, packetInput: { source_windows: sourceWindows,
        adjacent_context: { before: "", after: "" }, visual_context: [],
        neutral_reading_instructions: [] }
    }, (saved) => {
      requireValue(saved.output.source_only_first_pass === true, "PATTERN_SOURCE_FREEZE_INCOMPLETE");
      // Only a restricted unit may stay unassessed.
      requireValue(saved.output.unassessed_unit_ids.every(id => batch.unit_ids.includes(id) && restrictedUnits.has(id)),
        "PATTERN_SOURCE_FREEZE_INCOMPLETE");
      for (const item of saved.output.reference_items) for (const anchor of item.anchors) {
        const unit = byId.get(anchor.unit_id);
        requireValue(unit && batch.unit_ids.includes(anchor.unit_id), "PATTERN_SOURCE_FREEZE_ANCHOR_OUTSIDE_BATCH");
        resolveExactQuote(unit.text, anchor.quote, anchor.occurrence);
      }
    });
    if (freeze.blocked) return { status: "blocked", stage: "REFERENCE_AUDIT", reports };
    if (freeze.failure) { unresolved(batch, "REFERENCE_AUDIT", freeze.failure); continue; }
    const frozen = freeze.saved;

    const buildId = `pattern:builder:${batch.id}`;
    const build = await checkedStep(buildId, {
      role: "pattern_builder", stage: "PATTERN_BUILD",
      units: batchUnits, packetInput: {
        validated_graph: batch.graph,
        episode_theme_matrix: buildEpisodeThemeMatrix(batch.graph),
        source_retrieval: { source_passages: batch.graph.nodes.filter(node => node.kind === "passage") },
        coverage_ledger: { assigned_unit_ids: batch.unit_ids, scope_complete: true,
          source_only_unresolved: false },
        target_generation: generation, producer_ref: buildId
      }
    }, (saved) => {
      requireValue(saved.output.status === "complete_for_stated_scope", "PATTERN_BUILD_SCOPE_INCOMPLETE");
      const trial = addProvisionalPatterns({ graph, patternResult: saved.output,
        producerReceipt: saved.receipt, localIdNamespace: batch.id });
      // Every candidate needs a search for contrary evidence before it can be reviewed.
      for (const id of trial.created_pattern_ids) {
        const queries = trial.counterevidence_queries[id];
        requireValue(Array.isArray(queries) && queries.length > 0, "PATTERN_COUNTER_QUERY_MISSING");
      }
    });
    if (build.blocked) return { status: "blocked", stage: "PATTERN_BUILD", reports };
    if (build.failure) { unresolved(batch, "PATTERN_BUILD", build.failure); continue; }
    const built = build.saved;
    const added = addProvisionalPatterns({ graph, patternResult: built.output,
      producerReceipt: built.receipt, localIdNamespace: batch.id });
    if (!added.created_pattern_ids.length) {
      graph = added.graph;
      reports.push({ batch_id: batch.id, pattern_ids: [], status: "reviewed_empty_scope" });
      continue;
    }

    const searchRecords = {}, counterReceipts = {};
    for (const id of added.created_pattern_ids) {
      // v2 identifies the exhaustive, byte-bounded paginator. Do not replay receipts written by
      // the former 64-result search, because those receipts can be incomplete.
      const searchId = `pattern:counter-search:v2:${id}`;
      let saved = await readIfPresent(searchId);
      if (!saved) {
        saved = await executeCounterevidenceSearch({
          reader: sourceReader, patternId: id, queries: added.counterevidence_queries[id],
          generation, receiptSecret: counterReceiptSecret, maximumBytes: counterevidenceMaximumBytes
        });
        saved = await writeOnce(searchId, saved);
      }
      counterReceipts[id] = saved.receipt;
      searchRecords[id] = { records: saved.records, complete: saved.receipt.complete,
        more_available: saved.receipt.more_available, total_matches: saved.receipt.matched_count };
    }
    const selected = new Set(added.created_pattern_ids);
    const scoped = {
      ...added.graph,
      nodes: added.graph.nodes.filter(node => node.kind !== "pattern" || selected.has(node.id)),
      edges: added.graph.edges.filter(edge => !["supports_pattern", "exception_to"].includes(edge.relation)
        || selected.has(edge.to))
    };
    const decide = (saved) => {
      const decision = reviewPatternRegister({
        graph: scoped, reviewResult: saved.output, reviewReceipt: saved.receipt,
        builderReceipt: built.receipt, frozenSourceReceipt: frozen.receipt,
        counterevidenceReceipts: counterReceipts, counterReceiptSecret
      });
      // A dispute is settled only when it is the reviewer's explicit conclusion in a complete
      // review. reviewPatternRegister deliberately marks missing or unsupported assessments as
      // disputed, so validate review coverage before using those normalized decisions as the
      // batch's completion signal.
      requireValue(saved.output.status === "sufficient_for_stated_scope", "PATTERN_REVIEW_INCOMPLETE");
      const assessmentCounts = new Map();
      for (const assessment of saved.output.assessments) {
        assessmentCounts.set(assessment.target_id, (assessmentCounts.get(assessment.target_id) ?? 0) + 1);
      }
      requireValue(added.created_pattern_ids.every(id => assessmentCounts.get(id) === 1),
        "PATTERN_REVIEW_INCOMPLETE");
      requireValue(decision.decisions.every(({ decision: outcome }) => SETTLED_DECISIONS.has(outcome)),
        "PATTERN_REVIEW_INCOMPLETE");
      return decision;
    };
    const review = await checkedStep(`pattern:reviewer:${batch.id}`, {
      role: "pattern_reviewer", stage: "PATTERN_REVIEW",
      units: batchUnits, acceptReviewFindings: true,
      packetInput: {
        phase: "B", target_generation: generation,
        candidate_patterns: added.graph.nodes.filter(node => selected.has(node.id)),
        frozen_observations: frozen.output,
        source_retrieval: { source_graph: batch.graph, counterevidence: searchRecords }
      }
    }, decide);
    if (review.blocked) return { status: "blocked", stage: "PATTERN_REVIEW", reports };
    // Candidates whose review never produced a usable result stay out of the graph.
    if (review.failure) { unresolved(batch, "PATTERN_REVIEW", review.failure); continue; }
    const decision = decide(review.saved);
    graph = added.graph;
    const resolved = new Map(decision.graph.nodes.filter(node => selected.has(node.id)).map(node => [node.id, node]));
    graph.nodes = graph.nodes.map(node => resolved.get(node.id) ?? node);
    reports.push({ batch_id: batch.id, pattern_ids: added.created_pattern_ids,
      status: "reviewed",
      decisions: decision.decisions,
      counter_search_complete: Object.values(counterReceipts).every(receipt => receipt.complete) });
  }
  validateJournalGraph(graph, representations);
  // Pass: every batch settled every candidate, as reviewed or as disputed. Partial: a batch is
  // unresolved, or a candidate's review was incomplete; the report says which.
  const decisions = reports.flatMap(report => report.decisions ?? []);
  return {
    status: reports.every(report => ["reviewed", "reviewed_empty_scope"].includes(report.status)) ? "pass" : "partial",
    graph, reports, batches: batches.length,
    counts: {
      unresolved_batches: reports.filter(report => report.status === "unresolved").length,
      reviewed_patterns: decisions.filter(({ decision }) => decision === "reviewed").length,
      disputed_patterns: decisions.filter(({ decision }) => decision === "disputed").length,
      provisional_patterns: decisions.filter(({ decision }) => decision === "provisional").length
    }
  };
}
