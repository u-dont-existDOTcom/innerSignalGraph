import { ValidationError } from "../core/errors.mjs";

function invariant(condition, code) {
  if (!condition) throw new ValidationError(code, { code });
}

// Passage IDs a record cites as evidence. A pattern cites assertions, not passages; its passages
// arrive through the subgraph closure, which seeds from every non-passage record.
function evidenceIds(record) {
  if (record.kind === "passage") return [record.id];
  if (Array.isArray(record.evidence_ids)) return record.evidence_ids;
  if (Array.isArray(record.data?.evidence_ids)) return record.data.evidence_ids;
  return [];
}

// Search, closure and evidence for a question, and every question in one run, must come from one
// published snapshot. A generation published mid-run is reported, never combined; a facade that
// reports no snapshot is taken at its word.
const snapshotKey = (value) => value ? JSON.stringify([value.generation, value.visibility_epoch ?? null]) : null;
const sameSnapshot = (expected, value) => expected == null || value == null || snapshotKey(expected) === snapshotKey(value);

export function createJournalColdConsumer({ journalApi, maximumPagesPerQuestion = 100 } = {}) {
  invariant(journalApi && typeof journalApi.search === "function" && typeof journalApi.getSubgraph === "function"
    && typeof journalApi.resolveEvidence === "function", "JOURNAL_READ_FACADE_REQUIRED");
  invariant(Number.isSafeInteger(maximumPagesPerQuestion) && maximumPagesPerQuestion >= 1 && maximumPagesPerQuestion <= 1_000, "COLD_PAGE_LIMIT_INVALID");

  const retrieveQuestion = async ({ locator, question, authContext }) => {
    invariant(locator && typeof locator.case_id === "string" && typeof locator.corpus_id === "string", "COLD_LOCATOR_INVALID");
    invariant(question && typeof question.id === "string" && typeof question.query === "string" && question.query.trim(), "COLD_QUESTION_INVALID");
    const records = new Map();
    let cursor = null;
    let snapshot = null;
    let pages = 0;
    do {
      const page = await journalApi.search({
        caseId: locator.case_id,
        corpusId: locator.corpus_id,
        query: question.query,
        purpose: locator.purpose ?? "organize_search",
        graphEnabled: question.graph_enabled !== false,
        filters: question.filters ?? {},
        pageSize: question.page_size ?? 50,
        cursor
      }, authContext);
      pages += 1;
      invariant(pages <= maximumPagesPerQuestion, "COLD_RETRIEVAL_PAGE_LIMIT");
      if (snapshot == null) snapshot = page.snapshot;
      else invariant(JSON.stringify(snapshot) === JSON.stringify(page.snapshot), "CURSOR_STALE");
      for (const record of page.items) records.set(record.id, record);
      cursor = page.next_cursor;
    } while (cursor);

    if (records.size === 0) {
      return Object.freeze({
        question_id: question.id,
        status: "not_found_in_authorized_material",
        snapshot_generation: snapshot?.generation ?? null,
        snapshot_visibility_epoch: snapshot?.visibility_epoch ?? null,
        records: [],
        evidence: { exact_spans: [], source_locators: [] },
        coverage_note: `searched ${pages} authorized snapshot page(s); absence is not proof the event never occurred`,
        more_available: false
      });
    }

    const initialEvidence = [...new Set([...records.values()].flatMap(evidenceIds))];
    const nonPassageSeeds = [...records.values()].filter((record) => record.kind !== "passage").map((record) => record.id);
    // Closure and evidence are bounded per question. What doesn't fit is reported as more available,
    // never silently dropped.
    const MAXIMUM_SEEDS = 50;
    const MAXIMUM_PASSAGES = 200;
    let closure = { nodes: [], edges: [], closure_status: "not_required", more_available: false };
    if (nonPassageSeeds.length) {
      closure = await journalApi.getSubgraph({
        caseId: locator.case_id,
        corpusId: locator.corpus_id,
        seedIds: nonPassageSeeds.slice(0, MAXIMUM_SEEDS),
        purpose: locator.purpose ?? "organize_search",
        nodeLimit: question.node_limit ?? 100
      }, authContext);
      invariant(closure.closure_status === "complete", "INSUFFICIENT_CONTEXT");
      invariant(sameSnapshot(snapshot, closure.coverage), "COLD_SNAPSHOT_CHANGED");
    }
    const allRecords = [...records.values(), ...closure.nodes, ...closure.edges];
    // Only passages can be resolved to exact source; an ID known to be another kind never is.
    const otherKinds = new Set(allRecords.filter((record) => record.kind !== "passage").map((record) => record.id));
    const passages = [...new Set([...initialEvidence, ...allRecords.filter((record) => record.kind === "passage").map((record) => record.id)])]
      .filter((id) => !otherKinds.has(id));
    const evidence = passages.length
      ? await journalApi.resolveEvidence({
          caseId: locator.case_id,
          corpusId: locator.corpus_id,
          evidenceIds: passages.slice(0, MAXIMUM_PASSAGES),
          purpose: locator.purpose ?? "organize_search"
        }, authContext)
      : { exact_spans: [], source_locators: [], next_cursor: null };
    invariant(sameSnapshot(snapshot, evidence.snapshot), "COLD_SNAPSHOT_CHANGED");
    return Object.freeze({
      question_id: question.id,
      status: "evidence_retrieved",
      snapshot_generation: snapshot.generation,
      snapshot_visibility_epoch: snapshot.visibility_epoch ?? null,
      records: allRecords,
      evidence: { exact_spans: evidence.exact_spans, source_locators: evidence.source_locators },
      coverage_note: passages.length > MAXIMUM_PASSAGES || nonPassageSeeds.length > MAXIMUM_SEEDS
        ? `traversed ${pages} authorized search page(s); closure and evidence were cut to their bounds`
        : `traversed ${pages} authorized search page(s) with mandatory evidence closure`,
      more_available: Boolean(closure.more_available || evidence.next_cursor
        || passages.length > MAXIMUM_PASSAGES || nonPassageSeeds.length > MAXIMUM_SEEDS)
    });
  };

  return Object.freeze({
    retrieveQuestion,
    async retrieveFrozenQuestions({ locator, questions, authContext }) {
      invariant(Array.isArray(questions) && questions.length > 0 && questions.length <= 100, "COLD_QUESTIONS_INVALID");
      const ids = new Set();
      for (const question of questions) {
        invariant(!ids.has(question.id), "COLD_QUESTION_DUPLICATE");
        ids.add(question.id);
        invariant(!Object.hasOwn(question, "answer") && !Object.hasOwn(question, "answer_key"), "COLD_ANSWER_KEY_FORBIDDEN");
      }
      const results = [];
      for (const question of questions) {
        const result = await retrieveQuestion({ locator, question, authContext });
        const first = results.find((item) => item.snapshot_generation != null);
        invariant(!first || result.snapshot_generation == null || (first.snapshot_generation === result.snapshot_generation
          && first.snapshot_visibility_epoch === result.snapshot_visibility_epoch), "COLD_SNAPSHOT_CHANGED");
        results.push(result);
      }
      return Object.freeze({
        schema_version: 1,
        isolation: Object.freeze({ original_upload_available: false, producer_history_available: false, corpus_key_available: false, answer_key_available: false }),
        locator: structuredClone(locator),
        results: Object.freeze(results)
      });
    }
  });
}
