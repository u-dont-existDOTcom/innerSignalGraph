import { ValidationError } from "../core/errors.mjs";
import { runSavedProfileColdConsumer } from "../journal-import/cold-profile-runner.mjs";
import { validateColdTestReceipt } from "./clients.mjs";

// The journal's cold test for a client's copy in the runner trial (design for clients, point 5c; the journal import's design,
// docs/superpowers/specs/2026-09-21-journal-implementation-decisions.md, sections 6, 7 and 9): a fresh consumer gets the saved profile
// and frozen questions only, never the source, the producer's history or the answer key, and answers from what the session-use reader
// finds, graph on and off. The controller here keeps the key and scores retrieval apart from answers. Only a pass yields the receipt
// the journal gate asks for, naming exactly the snapshot tested (case, corpus, generation, manifest, epoch).
//
// The pass rule is strict by default (a method choice for the owner, adjustable): for every question the key marks answerable, the
// graph-on consumer retrieved every key passage and answered "supported" citing one of them; for every question the key marks
// unanswerable (absent, false premise), it did not answer "supported"; and graph-on got at least as many questions right as graph-off.

const invalid = (code) => { throw new ValidationError("The journal cold test is invalid.", { code }); };
const UNANSWERABLE = new Set(["not_found", "false_premise", "insufficient_context"]);

export function validateFrozenQuestions(frozen) {
  if (!Array.isArray(frozen) || frozen.length === 0) invalid("COLD_QUESTIONS_REQUIRED");
  const ids = new Set();
  for (const entry of frozen) {
    if (!entry || typeof entry.id !== "string" || !/^[A-Za-z0-9:_-]{1,80}$/u.test(entry.id) || ids.has(entry.id) || typeof entry.question !== "string" || !entry.question.trim()) invalid("COLD_QUESTIONS_INVALID");
    ids.add(entry.id);
    const key = entry.key;
    if (!key || typeof key.answerable !== "boolean" || !Array.isArray(key.evidence_ids) || (key.answerable && key.evidence_ids.length === 0)) invalid("COLD_QUESTIONS_INVALID");
  }
  if (!frozen.some((entry) => entry.key.answerable) || !frozen.some((entry) => !entry.key.answerable)) invalid("COLD_QUESTIONS_NEED_BOTH_KINDS");
  return frozen;
}

function scoreVariant(entry, variant) {
  const retrieved = new Set((variant.retrieval?.records ?? []).map((record) => record.id));
  const output = variant.result?.output ?? {};
  const supported = output.answerability === "supported";
  // An unanswerable question is answered right only as not found, a false premise or too little context, never as (partly) supported.
  if (!entry.key.answerable) return { retrieved_all: null, right: UNANSWERABLE.has(output.answerability) };
  const retrievedAll = entry.key.evidence_ids.every((id) => retrieved.has(id));
  return { retrieved_all: retrievedAll, right: supported && output.evidence_ids?.some((id) => entry.key.evidence_ids.includes(id)) === true };
}

export async function runJournalColdTest({ service, auth, caseId, corpusId, frozen, port, now = () => new Date() }) {
  validateFrozenQuestions(frozen);
  const access = { requiredScope: "case:read", requiredPurpose: "session_use" };
  const before = (await service.inspectJournalCorpus(caseId, corpusId, access, auth)).reference;
  if (!before?.active_generation) invalid("COLD_TEST_NOT_PUBLISHED");
  const saved = new Map();
  const results = await runSavedProfileColdConsumer({
    service, auth, caseId, corpusId, expectedGeneration: before.active_generation,
    questions: frozen.map(({ id, question }) => ({ id, question })), port,
    grant: { purpose: "session_use", allowed_roles: ["cold_consumer"] },
    readIfPresent: async (key) => saved.get(key) ?? null,
    writeOnce: async (key, value) => { if (!saved.has(key)) saved.set(key, value); return saved.get(key); }
  });
  const byQuestion = frozen.map((entry) => {
    const found = results.find((result) => result.question_id === entry.id);
    const variant = (name) => found?.variants.find((item) => item.variant === name);
    return { id: entry.id, answerable: entry.key.answerable, graph: scoreVariant(entry, variant("graph") ?? {}), raw: scoreVariant(entry, variant("raw") ?? {}) };
  });
  const graphRight = byQuestion.filter((entry) => entry.graph.right).length;
  const rawRight = byQuestion.filter((entry) => entry.raw.right).length;
  const after = (await service.inspectJournalCorpus(caseId, corpusId, access, auth)).reference;
  const sameSnapshot = after?.active_generation === before.active_generation && after.manifest_object_id === before.manifest_object_id && after.visibility_epoch === before.visibility_epoch;
  const passed = sameSnapshot && graphRight >= rawRight
    && byQuestion.every((entry) => entry.graph.right && (entry.answerable ? entry.graph.retrieved_all : true));
  const report = {
    generation: before.active_generation, questions: byQuestion.length, graph_right: graphRight, raw_right: rawRight, same_snapshot: sameSnapshot,
    by_question: byQuestion.map(({ id, answerable, graph, raw }) => ({ id, answerable, graph, raw })), passed
  };
  const receipt = passed ? validateColdTestReceipt({ schema_version: 1, kind: "journal_cold_test", result: "pass", case_id: caseId, corpus_id: corpusId,
    generation: before.active_generation, manifest_object_id: before.manifest_object_id, visibility_epoch: before.visibility_epoch, tested_at: now().toISOString() }) : null;
  return { passed, report, receipt };
}
