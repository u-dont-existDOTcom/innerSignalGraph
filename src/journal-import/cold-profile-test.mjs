import { createHash } from "node:crypto";
import { ValidationError } from "../core/errors.mjs";
import { buildJournalRolePacket } from "./provider-port.mjs";
import { lexicalTerms } from "./graph.mjs";

const requireValue = (condition, code) => {
  if (!condition) throw new ValidationError(code, { code });
};
const digest = value => createHash("sha256").update(value).digest("hex");

export async function collectColdRetrieval({
  reader, question, graphEnabled, maximumTraversed = 1000, packetRecordLimit = 64
}) {
  requireValue(reader && typeof reader.search === "function", "COLD_READER_REQUIRED");
  requireValue(typeof question === "string" && question.trim(), "COLD_QUESTION_REQUIRED");
  requireValue(Number.isSafeInteger(maximumTraversed) && maximumTraversed > 200
    && Number.isSafeInteger(packetRecordLimit) && packetRecordLimit > 0
    && packetRecordLimit <= maximumTraversed, "COLD_RETRIEVAL_BOUND_INVALID");
  const stopWords = new Set(["what", "when", "where", "which", "happened", "about",
    "does", "were", "with", "from", "that", "this", "have", "been", "their"]);
  const terms = lexicalTerms(question);
  const queries = terms.filter(term => term.length >= 4 && !stopWords.has(term))
    .sort((a, b) => b.length - a.length || a.localeCompare(b)).slice(0, 8);
  if (!queries.length) queries.push(...terms.slice(0, 1));
  requireValue(queries.length > 0, "COLD_SEARCH_QUERY_EMPTY");
  const records = [], seen = new Set(), queryResults = [], byQuery = [];
  let complete = true;
  for (const query of queries) {
    let cursor = null, totalMatches = null, terminal = false;
    const queryRecords = [];
    do {
      const page = await reader.search({ query, graphEnabled, pageSize: 200, cursor });
      requireValue(Array.isArray(page.records) && Number.isSafeInteger(page.total_matches),
        "COLD_RETRIEVAL_PAGE_INVALID");
      totalMatches = page.total_matches;
      for (const record of page.records) if (!seen.has(record.id)) {
        seen.add(record.id);
        if (records.length < maximumTraversed) { records.push(record); queryRecords.push(record); }
      }
      cursor = page.next_cursor;
      terminal = cursor === null;
    } while (!terminal && records.length < maximumTraversed);
    queryResults.push({ query, total_matches: totalMatches ?? 0, complete: terminal });
    byQuery.push(queryRecords);
    if (!terminal) { complete = false; break; }
  }
  const packetRecords = [];
  for (let offset = 0; packetRecords.length < packetRecordLimit; offset += 1) {
    let found = false;
    for (const group of byQuery) if (group[offset]) {
      found = true; packetRecords.push(group[offset]);
      if (packetRecords.length === packetRecordLimit) break;
    }
    if (!found) break;
  }
  return {
    graph_enabled: graphEnabled, question, queries,
    query_results: queryResults, records: packetRecords,
    traversed_count: records.length,
    more_available: !complete || records.length > packetRecordLimit,
    search_complete: complete
  };
}

/**
 * Called from a fresh consumer process that has only the saved-profile reader,
 * frozen questions, and inference route. No source upload or answer key is
 * accepted by this interface.
 */
export async function runColdConsumerComparisons({
  reader, questions, port, grant, caseId, corpusId, generation,
  readIfPresent, writeOnce, maximumTraversed = 1000, packetRecordLimit = 64
}) {
  requireValue(Array.isArray(questions) && questions.length > 0, "COLD_QUESTIONS_REQUIRED");
  const results = [];
  for (const question of questions) {
    requireValue(question && Object.keys(question).sort().join(",") === "id,question"
      && typeof question.id === "string" && typeof question.question === "string",
      "COLD_QUESTION_ISOLATION_INVALID");
    const variants = [];
    for (const graphEnabled of [true, false]) {
      const variant = graphEnabled ? "graph" : "raw";
      const key = `cold:answer:${digest(`${generation}\\0${question.id}\\0${variant}`).slice(0,40)}`;
      let saved = await readIfPresent(key);
      if (!saved) {
        const retrieval = await collectColdRetrieval({ reader, question: question.question,
          graphEnabled, maximumTraversed, packetRecordLimit });
        const packet = buildJournalRolePacket("cold_consumer", {
          protocol_version: "1.0", output_schema_id: "answer-result",
          assigned_core_ids: [question.id], source_locators: [{
            case_id: caseId, corpus_id: corpusId, generation
          }], expected_generation: generation,
          controller_provenance_tag: key, grant_purpose: grant.purpose,
          frozen_question: question, current_locator: { case_id: caseId, corpus_id: corpusId, generation },
          retrieved_evidence: retrieval
        });
        const result = await port.invoke({
          role: "cold_consumer", packet, outputSchema: "answer-result",
          operationKey: key, grant
        });
        requireValue(result.output.question_id === question.id
          && result.output.snapshot_generation === generation, "COLD_ANSWER_BINDING_MISMATCH");
        const suppliedIds = new Set(retrieval.records.map(record => record.id));
        requireValue([...result.output.evidence_ids, ...result.output.qualifier_ids]
          .every(id => suppliedIds.has(id)), "COLD_ANSWER_UNRETRIEVED_EVIDENCE");
        requireValue(result.output.answerability !== "supported"
          || result.output.evidence_ids.length > 0, "COLD_ANSWER_UNSUPPORTED");
        saved = await writeOnce(key, { question_id: question.id, variant, retrieval, result });
      }
      variants.push(saved);
    }
    results.push({ question_id: question.id, variants });
  }
  return results;
}
