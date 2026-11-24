import { ValidationError } from "../core/errors.mjs";
import { journalSchema, validateJournalSchema } from "../journal-import/contracts.mjs";
import { runSavedProfileColdConsumer } from "../journal-import/cold-profile-runner.mjs";
import { journalRoleInstruction } from "../journal-import/provider-port.mjs";
import { validateColdTestReceipt } from "./clients.mjs";

// The journal's cold test for a client's copy in the runner trial (design for clients, point 5c; the journal import's design,
// docs/superpowers/specs/2026-09-21-journal-implementation-decisions.md, sections 6, 7 and 9): a fresh consumer gets the saved profile
// and frozen questions only, never the source, the producer's history or the answer key, and answers from what the session-use reader
// finds, graph on and off. The controller here keeps the key and scores retrieval apart from answers. Only a pass yields the receipt
// the journal gate asks for, naming exactly the snapshot tested (case, corpus, generation, manifest, epoch).
//
// The questions and their key come from a file (`journal_cold_questions`): each question says whether the journal answers it, and
// an answerable one names its evidence by exact words from the journal, which the controller finds in the copy's passages (an exact
// match, after Unicode normalization and with runs of white space as one space). A key quote must name its evidence: one found in
// no passage, or in more than three, stops the test.
//
// The pass rule is strict by default (a method choice for the owner, adjustable): for every question the key marks answerable, the
// graph-on consumer retrieved a passage for each key quote and answered "supported" citing a passage for each key quote; for every
// question the key marks unanswerable (absent, false premise), it answered not found, false premise or too little context; and
// graph-on got at least as many questions right as graph-off. These are exact checks of what the consumer declares (its
// answerability and the passages it cites). Whether its answer's words say what those passages say is a judgment of meaning, which
// this test doesn't make: that would take a judge model, a choice for the owner.

const invalid = (code, details) => { throw new ValidationError("The journal cold test is invalid.", { code, ...(details ? { details } : {}) }); };
const UNANSWERABLE = new Set(["not_found", "false_premise", "insufficient_context"]);
const QUESTION_KEYS = new Set(["id", "question", "answerable", "evidence_quotes"]);
export const MAX_KEY_QUOTE_PASSAGES = 3;
// How the consumer runner refuses an answer outside the answer's rules (it answers another question or snapshot, cites what it wasn't
// given, says "supported" with no evidence, isn't in the answer's form). Such an answer is a test not passed, never one that stopped.
const BROKEN_ANSWERS = new Set(["COLD_ANSWER_BINDING_MISMATCH", "COLD_ANSWER_UNRETRIEVED_EVIDENCE", "COLD_ANSWER_UNSUPPORTED", "JOURNAL_SCHEMA_INVALID"]);
export const MAX_COLD_QUESTIONS = 64;

export function validateColdQuestionsFile(value) {
  if (value?.schema_version !== 1 || value.kind !== "journal_cold_questions" || !Array.isArray(value.questions)
    || value.questions.length === 0 || value.questions.length > MAX_COLD_QUESTIONS) invalid("COLD_QUESTIONS_INVALID");
  const ids = new Set();
  for (const entry of value.questions) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).some((key) => !QUESTION_KEYS.has(key))
      || typeof entry.id !== "string" || !/^[A-Za-z0-9:_-]{1,80}$/u.test(entry.id) || ids.has(entry.id)
      || typeof entry.question !== "string" || !entry.question.trim() || typeof entry.answerable !== "boolean") invalid("COLD_QUESTIONS_INVALID");
    ids.add(entry.id);
    const quotes = entry.evidence_quotes ?? [];
    if (!Array.isArray(quotes) || quotes.some((quote) => typeof quote !== "string" || !quote.trim())
      || (entry.answerable ? quotes.length === 0 : quotes.length !== 0)) invalid("COLD_QUESTIONS_INVALID", { question_id: entry.id });
  }
  if (!value.questions.some((entry) => entry.answerable) || !value.questions.some((entry) => !entry.answerable)) invalid("COLD_QUESTIONS_NEED_BOTH_KINDS");
  return value;
}

const normal = (text) => text.normalize("NFC").replace(/\s+/gu, " ").trim();

// Each key quote becomes the group of passages that hold it; the consumer has to retrieve one passage of every group.
export function resolveColdKey(questions, passages) {
  validateColdQuestionsFile(questions);
  const texts = passages.map((passage) => ({ id: passage.id, text: normal(passage.quote) }));
  return questions.questions.map((entry) => ({
    id: entry.id, question: entry.question,
    key: { answerable: entry.answerable, evidence_groups: (entry.evidence_quotes ?? []).map((quote) => {
      const wanted = normal(quote);
      const ids = texts.filter((passage) => passage.text.includes(wanted)).map((passage) => passage.id);
      if (!ids.length) invalid("COLD_KEY_QUOTE_NOT_IN_JOURNAL", { question_id: entry.id });
      if (ids.length > MAX_KEY_QUOTE_PASSAGES) invalid("COLD_KEY_QUOTE_NOT_SPECIFIC", { question_id: entry.id });
      return ids;
    }) }
  }));
}

function scoreVariant(entry, variant) {
  const retrieved = new Set((variant.retrieval?.records ?? []).map((record) => record.id));
  const output = variant.result?.output ?? {};
  if (!entry.key.answerable) return { retrieved_all: null, right: UNANSWERABLE.has(output.answerability) };
  const cited = new Set(output.evidence_ids ?? []);
  return {
    retrieved_all: entry.key.evidence_groups.every((ids) => ids.some((id) => retrieved.has(id))),
    right: output.answerability === "supported" && entry.key.evidence_groups.every((ids) => ids.some((id) => cited.has(id)))
  };
}

// The copy's passages, read once by the controller (never by the consumer), from the snapshot the test runs on.
async function copyPassages({ service, auth, caseId, corpusId, access, before }) {
  return service.withJournalCorpus(caseId, corpusId, access, async ({ corpusStore, reference }) => {
    if (reference?.active_generation !== before.active_generation || reference.manifest_object_id !== before.manifest_object_id) invalid("COLD_TEST_SNAPSHOT_CHANGED");
    const manifest = await corpusStore.readJsonObject({ objectId: reference.manifest_object_id });
    const passages = [];
    for (const shard of manifest.record_shards) {
      for (const record of (await corpusStore.readJsonObject({ objectId: shard.object_id })).records) {
        if (record.kind === "passage" && typeof record.data?.quote === "string") passages.push({ id: record.id, quote: record.data.quote });
      }
    }
    return passages;
  }, auth);
}

export async function runJournalColdTest({ service, auth, caseId, corpusId, questions, port, now = () => new Date(), requiredScope = "case:read" }) {
  validateColdQuestionsFile(questions);
  const access = { requiredScope, requiredPurpose: "session_use" };
  const before = (await service.inspectJournalCorpus(caseId, corpusId, access, auth)).reference;
  if (!before?.active_generation) invalid("COLD_TEST_NOT_PUBLISHED");
  const frozen = resolveColdKey(questions, await copyPassages({ service, auth, caseId, corpusId, access, before }));
  const saved = new Map();
  let results;
  try {
    results = await runSavedProfileColdConsumer({
      service, auth, caseId, corpusId, expectedGeneration: before.active_generation, requiredScope,
      questions: frozen.map(({ id, question }) => ({ id, question })), port,
      grant: { purpose: "session_use", allowed_roles: ["cold_consumer"] },
      readIfPresent: async (key) => saved.get(key) ?? null,
      writeOnce: async (key, value) => { if (!saved.has(key)) saved.set(key, value); return saved.get(key); }
    });
  } catch (error) {
    if (!BROKEN_ANSWERS.has(error?.code)) throw error;
    return { passed: false, report: { generation: before.active_generation, questions: frozen.length, broken_answer: error.code, passed: false }, receipt: null };
  }
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
  // Ids, counts and scores only: no question, answer or journal text.
  const report = {
    generation: before.active_generation, questions: byQuestion.length, graph_right: graphRight, raw_right: rawRight, same_snapshot: sameSnapshot,
    by_question: byQuestion.map(({ id, answerable, graph, raw }) => ({ id, answerable, graph, raw })), passed
  };
  const receipt = passed ? validateColdTestReceipt({ schema_version: 1, kind: "journal_cold_test", result: "pass", case_id: caseId, corpus_id: corpusId,
    generation: before.active_generation, manifest_object_id: before.manifest_object_id, visibility_epoch: before.visibility_epoch, tested_at: now().toISOString() }) : null;
  return { passed, report, receipt };
}

// The fresh consumer on one of the trial's own signed-in workers (`claude -p` or `codex exec`, sealed: no tools, an empty folder, no
// session kept), one call per question and variant, with the cold consumer's instruction and the packet and nothing else. Its answer
// is checked against the answer schema. `beforeSend` runs right before each packet leaves.
export function createSealedColdConsumerPort({ worker, timeoutMs = 10 * 60_000, beforeSend = null }) {
  if (!worker || typeof worker.call !== "function") invalid("COLD_PORT_INVALID");
  return Object.freeze({
    async invoke({ role, packet, outputSchema }) {
      if (role !== "cold_consumer" || outputSchema !== "answer-result") invalid("COLD_PORT_ROLE_INVALID");
      const { value, receipt } = await worker.call({ system: journalRoleInstruction("cold_consumer"), user: JSON.stringify(packet),
        schema: journalSchema("answer-result"), timeoutMs, stage: "cold_consumer", beforeSend });
      return { output: validateJournalSchema("answer-result", value), receipt: { provider: receipt?.provider ?? null, model: receipt?.model ?? null } };
    }
  });
}
