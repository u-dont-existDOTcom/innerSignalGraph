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
const CONCLUSIVE_REVIEW_OUTCOMES = new Set(["preserved", "omitted", "distorted"]);

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
 * When every attempt fails, the step's scope is recorded as unresolved with the
 * check's code. A failed review group excludes only its candidates; an earlier
 * batch-step failure excludes the whole batch. Other groups and batches continue.
 */
export async function runJournalPatternPass({
  graph: reconciledGraph, units, unitGraphs, sourceReader, work,
  readIfPresent, writeOnce, counterReceiptSecret, generation,
  representations, maximumBytes = 50000, counterevidenceMaximumBytes = maximumBytes,
  reviewPacketMaximumBytes = 3 * 1024 * 1024,
  stepFailure = () => null
}) {
  requireValue(reconciledGraph?.generation === generation, "PATTERN_GENERATION_MISMATCH");
  requireValue(Array.isArray(units) && units.length === unitGraphs.length, "PATTERN_UNIT_SCOPE_INVALID");
  requireValue(Number.isSafeInteger(reviewPacketMaximumBytes) && reviewPacketMaximumBytes > 0,
    "PATTERN_REVIEW_PACKET_BYTE_BUDGET_INVALID");
  const byId = new Map(units.map(unit => [unit.unit_id, unit]));
  // A unit holding restricted material, which the reference reader is told to leave unassessed.
  const restrictedUnits = new Set(unitGraphs.filter(({ unit_id: unitId, graph: part }) => part.nodes.some(node =>
    node.kind === "passage" && node.data?.disclosure === "restricted" && node.data.unit_id === unitId))
    .map(({ unit_id: unitId }) => unitId));
  const oversizedUnits = [];
  const batches = createJournalPatternBatches({ graph: reconciledGraph, unitGraphs, maximumBytes,
    onOversizedUnit: unitId => oversizedUnits.push(unitId) });
  let graph = structuredClone(reconciledGraph);
  const reports = oversizedUnits.map(unitId => ({ batch_id: `pattern-unit:${unitId}`,
    unit_ids: [unitId], pattern_ids: [], status: "unresolved", stage: "PATTERN_BUILD",
    reason: "PATTERN_UNIT_CONTEXT_EXCEEDS_BOUND" }));

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
          if (failure === "REFERENCE_RESEND_EXHAUSTED") return { failure };
          continue;
        }
        saved = await writeOnce(id, result[0]);
      }
      failure = failureOf(check, saved);
      if (!failure) return { saved, attempts: attempt };
    }
    return { failure };
  };
  const unresolved = (batch, stage, reason, patternIds = [], reviewGroup = null) => reports.push({
    batch_id: batch.id, pattern_ids: patternIds, status: "unresolved", stage, reason,
    ...(reviewGroup === null ? {} : { review_group: reviewGroup })
  });

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
    const unassessedAssertions = new Set(unitGraphs.filter(part =>
      frozen.output.unassessed_unit_ids.includes(part.unit_id))
      .flatMap(part => part.graph.nodes.filter(node => node.kind === "assertion").map(node => node.id)));
    const eligibleBatchGraph = { ...batch.graph,
      nodes: batch.graph.nodes.filter(node => !unassessedAssertions.has(node.id)),
      edges: batch.graph.edges.filter(edge => !unassessedAssertions.has(edge.from)
        && !unassessedAssertions.has(edge.to)
        && edge.evidence_ids.every(id => !unassessedAssertions.has(id))) };
    const allowedAssertionIds = new Set(eligibleBatchGraph.nodes.filter(node => node.kind === "assertion")
      .map(node => node.id));

    const buildId = `pattern:builder:${batch.id}`;
    const build = await checkedStep(buildId, {
      role: "pattern_builder", stage: "PATTERN_BUILD",
      units: batchUnits, packetInput: {
        validated_graph: eligibleBatchGraph,
        episode_theme_matrix: buildEpisodeThemeMatrix(eligibleBatchGraph),
        source_retrieval: { source_passages: eligibleBatchGraph.nodes.filter(node => node.kind === "passage") },
        coverage_ledger: { assigned_unit_ids: batch.unit_ids,
          scope_complete: frozen.output.unassessed_unit_ids.length === 0,
          source_only_unresolved: frozen.output.unassessed_unit_ids.length > 0 },
        target_generation: generation, producer_ref: buildId
      }
    }, (saved) => {
      requireValue(saved.output.status === "complete_for_stated_scope", "PATTERN_BUILD_SCOPE_INCOMPLETE");
      const trial = addProvisionalPatterns({ graph, patternResult: saved.output,
        producerReceipt: saved.receipt, localIdNamespace: batch.id, allowedAssertionIds });
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
      producerReceipt: built.receipt, localIdNamespace: batch.id, allowedAssertionIds });
    if (!added.created_pattern_ids.length) {
      reports.push({ batch_id: batch.id, pattern_ids: [], status: "reviewed_empty_scope" });
      continue;
    }

    const searchRecords = {}, counterReceipts = {};
    for (const id of added.created_pattern_ids) {
      // v3 rejects receipts that called a byte-truncated search complete. Do not replay v2 receipts,
      // which could settle a pattern without every matched counterevidence record.
      const searchId = `pattern:counter-search:v3:${id}`;
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
    const created = new Set(added.created_pattern_ids);
    const candidates = new Map(added.graph.nodes.filter(node => created.has(node.id))
      .map(node => [node.id, node]));
    const packetFor = ids => ({
      phase: "B", target_generation: generation,
      candidate_patterns: ids.map(id => candidates.get(id)),
      frozen_observations: frozen.output,
      source_retrieval: { source_graph: batch.graph,
        counterevidence: Object.fromEntries(ids.map(id => [id, searchRecords[id]])) }
    });
    const fits = ids => Buffer.byteLength(JSON.stringify(packetFor(ids)), "utf8") <= reviewPacketMaximumBytes;
    const groups = [], oversized = [];
    let current = [];
    for (const id of added.created_pattern_ids) {
      if (fits([...current, id])) { current.push(id); continue; }
      if (current.length) { groups.push(current); current = []; }
      if (fits([id])) current.push(id);
      else oversized.push(id);
    }
    if (current.length) groups.push(current);
    for (const id of oversized) unresolved(batch, "PATTERN_REVIEW", "PATTERN_REVIEW_PACKET_TOO_LARGE", [id]);

    const successful = new Set(), resolved = new Map();
    for (const [index, ids] of groups.entries()) {
      const selected = new Set(ids);
      const reviewGroup = groups.length > 1 ? `group-${index + 1}` : null;
      const scoped = {
        ...added.graph,
        nodes: added.graph.nodes.filter(node => node.kind !== "pattern" || selected.has(node.id)),
        edges: added.graph.edges.filter(edge => !["supports_pattern", "exception_to"].includes(edge.relation)
          || selected.has(edge.to))
      };
      const groupReceipts = Object.fromEntries(ids.map(id => [id, counterReceipts[id]]));
      const decide = (saved) => {
        const decision = reviewPatternRegister({
          graph: scoped, reviewResult: saved.output, reviewReceipt: saved.receipt,
          builderReceipt: built.receipt, frozenSourceReceipt: frozen.receipt,
          counterevidenceReceipts: groupReceipts, counterReceiptSecret
        });
        // A dispute is settled only when it is the reviewer's explicit conclusion in a complete
        // review. reviewPatternRegister deliberately marks missing or unsupported assessments as
        // disputed, so validate review coverage before using those normalized decisions as the
        // group's completion signal.
        requireValue(saved.output.status === "sufficient_for_stated_scope", "PATTERN_REVIEW_INCOMPLETE");
        const assessmentCounts = new Map();
        const assessmentsById = new Map();
        for (const assessment of saved.output.assessments) {
          assessmentCounts.set(assessment.target_id, (assessmentCounts.get(assessment.target_id) ?? 0) + 1);
          assessmentsById.set(assessment.target_id, assessment);
        }
        const explicitlyUnassessed = new Set(saved.output.unassessed_ids);
        requireValue(ids.every(id => assessmentCounts.get(id) === 1
          && !explicitlyUnassessed.has(id)
          && CONCLUSIVE_REVIEW_OUTCOMES.has(assessmentsById.get(id)?.outcome)),
          "PATTERN_REVIEW_INCOMPLETE");
        // Semantic disagreement is a settled result, but it cannot substitute for authenticated,
        // independent review and a verified counterevidence search.
        requireValue(decision.review_evidence_verified === true, "PATTERN_REVIEW_EVIDENCE_INVALID");
        requireValue(decision.decisions.every(({ decision: outcome }) => SETTLED_DECISIONS.has(outcome)),
          "PATTERN_REVIEW_INCOMPLETE");
        return decision;
      };
      const reviewId = `pattern:reviewer:${batch.id}${reviewGroup ? `:${reviewGroup}` : ""}`;
      const review = await checkedStep(reviewId, {
        role: "pattern_reviewer", stage: "PATTERN_REVIEW",
        units: batchUnits, acceptReviewFindings: true, packetInput: packetFor(ids)
      }, decide);
      if (review.blocked) return { status: "blocked", stage: "PATTERN_REVIEW", reports };
      // Candidates whose review never produced a usable result stay out of the graph.
      if (review.failure) { unresolved(batch, "PATTERN_REVIEW", review.failure, ids, reviewGroup); continue; }
      const decision = decide(review.saved);
      for (const id of ids) successful.add(id);
      for (const node of decision.graph.nodes.filter(node => selected.has(node.id))) resolved.set(node.id, node);
      reports.push({ batch_id: batch.id, pattern_ids: ids,
        ...(reviewGroup === null ? {} : { review_group: reviewGroup }),
        status: "reviewed", decisions: decision.decisions,
        counter_search_complete: Object.values(groupReceipts).every(receipt => receipt.complete) });
    }
    if (successful.size) {
      const acceptedSupport = new Set([...successful].flatMap(id =>
        (resolved.get(id) ?? candidates.get(id)).data.support_assertion_ids));
      const createdThemes = new Set(added.created_theme_ids);
      const themeMembers = new Map([...createdThemes].map(id => [id, []]));
      for (const edge of added.graph.edges) if (edge.relation === "about_theme" && createdThemes.has(edge.to))
        themeMembers.get(edge.to).push(edge.from);
      const keptThemes = new Set([...themeMembers].filter(([, members]) => members.length > 0
        && members.every(id => acceptedSupport.has(id))).map(([id]) => id));
      graph = {
        ...added.graph,
        nodes: added.graph.nodes.filter(node => (!created.has(node.id) || successful.has(node.id))
          && (!createdThemes.has(node.id) || keptThemes.has(node.id)))
          .map(node => resolved.get(node.id) ?? node),
        edges: added.graph.edges.filter(edge => (!created.has(edge.to) || successful.has(edge.to))
          && (!createdThemes.has(edge.to) || keptThemes.has(edge.to)))
      };
    }
  }
  validateJournalGraph(graph, representations);
  // Pass: every batch settled every candidate, as reviewed or as disputed. Partial: a batch is
  // unresolved, or a candidate's review was incomplete; the report says which.
  const decisions = reports.flatMap(report => report.decisions ?? []);
  return {
    status: reports.every(report => ["reviewed", "reviewed_empty_scope"].includes(report.status)) ? "pass" : "partial",
    graph, reports, batches: batches.length + oversizedUnits.length,
    counts: {
      unresolved_batches: new Set(reports.filter(report => report.status === "unresolved")
        .map(report => report.batch_id)).size,
      reviewed_patterns: decisions.filter(({ decision }) => decision === "reviewed").length,
      disputed_patterns: decisions.filter(({ decision }) => decision === "disputed").length,
      provisional_patterns: decisions.filter(({ decision }) => decision === "provisional").length
    }
  };
}
