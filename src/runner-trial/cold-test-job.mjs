import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { RuntimeError } from "../core/errors.mjs";
import { COLD_TEST_ATTEMPT_FILE, COLD_TEST_RECEIPT_FILE, addQuestionsHeldBack, clientJournalFolder, journalConsentState, readColdTestAttempt, readColdTestMarker,
  readQuestionsHeldBack, syncFolder } from "./clients.mjs";
import { inventedJournalOpening, readQuestionPassages, writeColdQuestions } from "./cold-questions.mjs";
import { createSealedColdTestPort, runJournalColdTest } from "./journal-cold-test.mjs";
import { openSessionUseReader } from "./journal-gate.mjs";

// The journal's cold-test job, one implementation for the command (scripts/runner-trial-journal.mjs, --cold-test) and, from pull request 4,
// the runner's page (docs/superpowers/specs/2026-11-26-runner-journal-upload-and-tab-design.md, section 4.9). It was the command's own
// `runClientColdTest`, moved here unchanged in what it does:
// - its start, under the trial folder's lock: the client's confirmed consent and copy, the copy's run number, the receipt removed and the
//   marker of this attempt written (the receipt first, so a receipt that is there is the one the marked test gave);
// - the person's consent and copy read again under the lock right before each packet leaves (`beforeSend`), the copy looked for in the
//   vault itself as it was when the test started;
// - only a pass, still marked as the test started last, writes the receipt; of tests that overlap, the newest decides; a test that
//   doesn't pass takes the receipt away only while it is still the newest.
// What it adds: the questions may be written by GPT for this run (section 3: `createGptQuestionsWriter`), after the start and before the
// test, with the same reads before each packet, and the held-back list read in the same hold of the lock (3.2).
//
// The caller gives what differs between the command and the page: how to find the client under the lock (`findClient`), how to read the
// list (`readClients`), the folder's lock (`underLock`), the vault with a one-time read grant (`openVault`), the private folder and file
// writes (`ensureFolder`, `writeFile`), and the workers. Its own refusals are ColdTestJobErrors, by reason, which the caller words.

export class ColdTestJobError extends RuntimeError {
  constructor(reason, message) {
    super(message, { code: reason });
    this.name = "ColdTestJobError";
    this.reason = reason;
  }
}
const refuse = (reason, message) => { throw new ColdTestJobError(reason, message); };

export const COLD_TEST_JOB_WORDS = Object.freeze({
  COLD_TEST_NO_CONSENT: "The client has no confirmed journal consent.",
  COLD_TEST_NO_COPY: "The client has no journal copy here yet.",
  COLD_TEST_CHANGED: "The client's consent or copy changed during the cold test: it stopped, and gave no receipt.",
  COLD_TEST_MARKER_GONE: "The marker of this cold test's start is gone or can't be read: it gave no receipt. Run it again.",
  COLD_TEST_NEWER_STARTED: "A newer cold test of this copy has started, and that one decides: this one gave no receipt. If no other is running, run it again.",
  COLD_QUESTIONS_NOT_INVENTED: "This copy doesn't open with the invented-journal sentinel, its first passage the sentence alone, so GPT's questions don't run on it: they run only on an invented journal until a consent in its new words names them. Nothing was sent; as with any test that starts, the copy has no cold-test receipt now."
});

// A file of the client's journal folder removed (their cold-test receipt, or the marker of the test started last), and that made durable.
async function removeJournalFile(trialDir, caseId, name) {
  const folder = clientJournalFolder(trialDir, caseId);
  try { await fsp.unlink(path.join(folder, name)); } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  await syncFolder(folder);
}

/**
 * One cold test of a client's copy. Returns `{ passed, newerStarted, report, questionsReport }`: the test's report, and, when GPT wrote
 * the questions, the questions tool's (numbers only). `questions` is a checked questions file, or `writeQuestions` writes them for this
 * run (createGptQuestionsWriter); one of the two.
 */
export async function runColdTestJob({ trialDir, findClient, readClients, underLock, openVault, ensureFolder, writeFile, consumer, judge,
  questions = null, writeQuestions = null, now = () => new Date() }) {
  if ((questions === null) === (writeQuestions === null)) throw new RuntimeError("The cold test needs its questions, or a writer of them.", { code: "COLD_TEST_JOB_INVALID" });
  const attempt = randomUUID();
  const { caseId, corpusId, run } = await underLock(async () => {
    const client = await findClient();
    if (journalConsentState(client) !== "confirmed") refuse("COLD_TEST_NO_CONSENT", COLD_TEST_JOB_WORDS.COLD_TEST_NO_CONSENT);
    if (!client.journal.corpus_id) refuse("COLD_TEST_NO_COPY", COLD_TEST_JOB_WORDS.COLD_TEST_NO_COPY);
    const folder = clientJournalFolder(trialDir, client.case_id);
    await ensureFolder(folder, "The client's journal folder");
    // Which of the tests started on this copy it is: an import begins a new count (it removes the marker).
    const marked = await readColdTestMarker(trialDir, client.case_id);
    const started = marked?.corpus_id === client.journal.corpus_id ? marked.run + 1 : 1;
    // The receipt goes first: whatever stops the start between the two, a receipt that's there is the one the marked test gave.
    await removeJournalFile(trialDir, client.case_id, COLD_TEST_RECEIPT_FILE);
    await writeFile(path.join(folder, COLD_TEST_ATTEMPT_FILE), `${JSON.stringify({ schema_version: 1, attempt, started_at: now().toISOString(), corpus_id: client.journal.corpus_id, run: started }, null, 2)}\n`);
    return { caseId: client.case_id, corpusId: client.journal.corpus_id, run: started };
  });
  // A test that doesn't pass leaves no receipt, unless a newer one has started: that one decides. Returns whether one has.
  const leaveNone = () => underLock(async () => {
    const marked = await readColdTestAttempt(trialDir, caseId);
    if (marked === attempt) await removeJournalFile(trialDir, caseId, COLD_TEST_RECEIPT_FILE);
    return marked !== null && marked !== attempt;
  });
  let result, questionsReport = null;
  try {
    const vault = await openVault(caseId);
    try {
      const { service, auth } = vault;
      // What the vault publishes of the copy, or null when the case, or the copy in it, is gone.
      const published = async () => {
        try {
          return (await service.inspectJournalCorpus(caseId, corpusId, { requiredScope: "case:read", requiredPurpose: "session_use" }, auth)).reference;
        } catch (error) {
          if (error?.code === "PRIVATE_CASE_NOT_FOUND") return null;
          throw error;
        }
      };
      const tested = await published();
      const stillSo = async () => {
        const listed = (await readClients()).clients.find((entry) => entry.case_id === caseId);
        const consented = journalConsentState(listed) === "confirmed" && listed.journal.corpus_id === corpusId;
        const there = consented ? await published() : null;
        if (!there || ["active_generation", "manifest_object_id", "visibility_epoch"].some((name) => there[name] !== tested?.[name])) {
          refuse("COLD_TEST_CHANGED", COLD_TEST_JOB_WORDS.COLD_TEST_CHANGED);
        }
      };
      const beforeSend = () => underLock(stillSo);
      let file = questions;
      if (writeQuestions) {
        // The writer gets the check unlocked (`check`) too, to run it in the one hold of the lock in which it reads the held-back list.
        const written = await writeQuestions({ service, auth, caseId, corpusId, tested, beforeSend, check: stillSo, underLock });
        file = written.questions;
        questionsReport = written.report;
      }
      const port = createSealedColdTestPort({ consumer, judge, beforeSend });
      result = await runJournalColdTest({ service, auth, caseId, corpusId, questions: file, port, run, now });
      if (result.passed) {
        await underLock(async () => {
          await stillSo();
          const marked = await readColdTestAttempt(trialDir, caseId);
          if (marked !== attempt) {
            if (marked === null) refuse("COLD_TEST_MARKER_GONE", COLD_TEST_JOB_WORDS.COLD_TEST_MARKER_GONE);
            refuse("COLD_TEST_NEWER_STARTED", COLD_TEST_JOB_WORDS.COLD_TEST_NEWER_STARTED);
          }
          await writeFile(path.join(clientJournalFolder(trialDir, caseId), COLD_TEST_RECEIPT_FILE), `${JSON.stringify(result.receipt, null, 2)}\n`);
        });
      }
    } finally {
      vault?.close?.();
    }
  } catch (error) {
    // What stopped the test is what's told.
    await leaveNone().catch(() => {});
    throw error;
  }
  const newerStarted = result.passed ? false : await leaveNone();
  return { passed: result.passed, newerStarted, report: result.report, questionsReport };
}

/**
 * GPT's questions for one run (section 3), as `runColdTestJob`'s `writeQuestions`: the copy's passages read from exactly the snapshot
 * under test; with `inventedOnly` (pull request 1, until a consent in its new words names the questions), the copy's first passage in
 * source order, of all its passages, required to be the invented-journal sentinel whole, before any call, and that passage left out of
 * the sample; the client's held-back passages read (`readHeld`), and added to, under the folder's lock; right before each packet leaves,
 * one hold of that lock in which the job's consent check (`check`) runs and the held-back list is read again (a caller with no `check`
 * gives `beforeSend`, which takes the lock on its own); the replies' reader asked with each unanswerable question, on that same snapshot;
 * and `worker`, the sealed Codex worker, for every call.
 */
export function createGptQuestionsWriter({ trialDir, worker, inventedOnly = true, readerFor = openSessionUseReader, readHeld = readQuestionsHeldBack, random = undefined,
  timeoutMs = undefined }) {
  return async ({ service, auth, caseId, corpusId, tested, beforeSend = null, check = null, underLock }) => {
    if (!tested?.active_generation) throw new RuntimeError("The copy isn't published.", { code: "COLD_TEST_NOT_PUBLISHED" });
    const { passages, keyPassages, wordList, openingId } = await readQuestionPassages({ service, auth, caseId, corpusId, before: tested });
    const opening = inventedJournalOpening({ passages, openingId });
    if (inventedOnly && !opening) refuse("COLD_QUESTIONS_NOT_INVENTED", COLD_TEST_JOB_WORDS.COLD_QUESTIONS_NOT_INVENTED);
    const heldBack = await underLock(() => readHeld(trialDir, caseId));
    const reader = await readerFor({ caseAccessService: service, corpusId });
    const askReader = async (question) => {
      const part = await reader.read({ caseId, query: question, authContext: auth });
      if (part?.availability !== "available") throw new RuntimeError("The replies' reader isn't available.", { code: "COLD_TEST_READER_UNAVAILABLE" });
      const read = part.receipts?.[0];
      if (read?.corpus_id !== corpusId || read.generation !== tested.active_generation || read.manifest_object_id !== tested.manifest_object_id
        || read.visibility_epoch !== tested.visibility_epoch) throw new RuntimeError("The copy changed during the questions.", { code: "COLD_TEST_SNAPSHOT_CHANGED" });
      return part.source_items.length;
    };
    // One hold of the lock a packet: the consent and copy checked and the held-back list read in it, so that nothing changes between the
    // two. The packet leaves after the lock is released (section 12).
    const readHeldBack = () => underLock(async () => {
      if (check) await check();
      return readHeld(trialDir, caseId);
    });
    return writeColdQuestions({ passages, keyPassages, wordList, worker, askReader, beforeSend: check ? null : beforeSend, heldBack,
      holdBack: (digests) => underLock(() => addQuestionsHeldBack(trialDir, caseId, digests)), readHeldBack,
      exclude: new Set(opening ? [opening.id] : []), ...(random ? { random } : {}), ...(timeoutMs ? { timeoutMs } : {}) });
  };
}
