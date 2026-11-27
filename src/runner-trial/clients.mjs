import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ValidationError } from "../core/errors.mjs";
import { withOpenedRegularFile } from "../core/opened-regular-file.mjs";
import { COLD_QUESTION_AUTHORS, COLD_TEST_RULE } from "./cold-test-rule.mjs";
import { RUNNER_TRIAL_CASE_ID_PATTERN } from "./switch.mjs";

// The runner trial's clients (docs/superpowers/specs/2026-11-23-runner-client-cases-design.md, the owner's answer 1a to question
// i73, 24 Nov 2026): the people the owner works with, each with a case of their own in the trial's own vault. The list is one
// file in the trial folder, mode 0600, beside the credentials that hold each case's keys. A client's label is the owner's own word
// for them: shown only by the trial's page on this computer, and never put into a Git file, a log, the run log, a worker's packet
// or a report. Nothing here reads the vault.

export const RUNNER_CLIENTS_FILE = "clients.json";
// Each client's journal folder in the trial folder: their key for journal copies, their copy's cold-test receipt, the marker of the
// cold test started last (scripts/runner-trial-journal.mjs) and the questions tool's held-back passages. "Delete this case" removes it
// with the case.
export const RUNNER_JOURNAL_FOLDER = "journal";
export const COLD_TEST_RECEIPT_FILE = "cold-test-receipt.json";
export const COLD_TEST_ATTEMPT_FILE = "cold-test-attempt.json";
// The digests of the passages the cold test's questions tool sends GPT no more (src/runner-trial/cold-questions.mjs): those of a batch
// that came back without an answer in its schema, which may have been a refusal. Digests only; their Delete removes them with the folder.
export const QUESTIONS_HELD_BACK_FILE = "questions-held-back.json";
export const MAX_RUNNER_CLIENTS = 50;
export const CLIENT_LABEL_MAX = 80;

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u;
const CORPUS_ID = /^[A-Za-z0-9:_-]{1,160}$/u;
const ID = /^[A-Za-z0-9:._-]{1,160}$/u;
const ATTEMPT = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const invalid = (message) => { throw new ValidationError(message, { code: "RUNNER_CLIENTS_INVALID" }); };
const plainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, keys, name) => {
  if (!plainObject(value) || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) invalid(`${name} has unexpected fields.`);
};
const timestamp = (value, name) => {
  if (typeof value !== "string" || !TIMESTAMP.test(value) || Number.isNaN(Date.parse(value))) invalid(`${name} must be a UTC time.`);
  return value;
};

// A label: one line of at most 80 characters, with no control characters; surrounding spaces are dropped. The message never
// repeats the label.
export function validateClientLabel(value) {
  if (typeof value !== "string") invalid("A client's label must be text.");
  const label = value.trim();
  if (!label || [...label].length > CLIENT_LABEL_MAX || /\p{Cc}/u.test(label)) invalid(`A client's label is one line of 1 to ${CLIENT_LABEL_MAX} characters, with no control characters.`);
  return label;
}

function validateConsent(value, name) {
  if (value === null) return null;
  exactKeys(value, ["confirmed_at", "withdrawn_at"], name);
  timestamp(value.confirmed_at, `${name}.confirmed_at`);
  if (value.withdrawn_at !== null) {
    timestamp(value.withdrawn_at, `${name}.withdrawn_at`);
    if (Date.parse(value.withdrawn_at) < Date.parse(value.confirmed_at)) invalid(`${name} was withdrawn before it was confirmed.`);
  }
  return value;
}

export function validateRunnerClients(value) {
  exactKeys(value, ["schema_version", "clients"], "The client list");
  if (value.schema_version !== 1) invalid("The client list's version is unknown.");
  if (!Array.isArray(value.clients) || value.clients.length > MAX_RUNNER_CLIENTS) invalid(`The client list holds at most ${MAX_RUNNER_CLIENTS} clients.`);
  const caseIds = new Set();
  const labels = new Set();
  value.clients.forEach((client, index) => {
    const name = `Client ${index + 1}`;
    exactKeys(client, ["case_id", "label", "added_at", "journal"], name);
    if (typeof client.case_id !== "string" || !RUNNER_TRIAL_CASE_ID_PATTERN.test(client.case_id)) invalid(`${name}'s case id isn't of the start script's form.`);
    if (caseIds.has(client.case_id)) invalid(`${name}'s case id is listed twice.`);
    caseIds.add(client.case_id);
    if (validateClientLabel(client.label) !== client.label) invalid(`${name}'s label has surrounding spaces.`);
    const folded = client.label.toLocaleLowerCase("en");
    if (labels.has(folded)) invalid(`${name}'s label is another client's too.`);
    labels.add(folded);
    timestamp(client.added_at, `${name}.added_at`);
    // `source_sha256`: a digest of the server case the client's copies come from (scripts/runner-trial-journal.mjs, --import), written
    // before the first import touches the vault and kept until a Delete of theirs that the vault finishes: no other server case can be
    // imported for them, and this one for no other client. Absent before a first import.
    exactKeys(client.journal, Object.hasOwn(client.journal ?? {}, "source_sha256") ? ["corpus_id", "consent", "source_sha256"] : ["corpus_id", "consent"], `${name}.journal`);
    if (Object.hasOwn(client.journal, "source_sha256") && !/^[0-9a-f]{64}$/u.test(client.journal.source_sha256 ?? "")) invalid(`${name}'s journal source is invalid.`);
    if (client.journal.corpus_id !== null && (typeof client.journal.corpus_id !== "string" || !CORPUS_ID.test(client.journal.corpus_id))) invalid(`${name}'s journal corpus id is invalid.`);
    validateConsent(client.journal.consent, `${name}'s journal consent`);
  });
  return value;
}

export const emptyRunnerClients = () => ({ schema_version: 1, clients: [] });

// Whether the owner has confirmed this client's consent and not withdrawn it (design, point 5a). Read at every journal retrieval
// and again before every delivery, because a grant is read only once, when the server starts.
export function journalConsentCurrent(client) {
  const consent = client?.journal?.consent;
  return Boolean(consent && typeof consent.confirmed_at === "string" && consent.withdrawn_at === null);
}

export function journalConsentState(client) {
  const consent = client?.journal?.consent;
  if (!consent) return "none";
  return consent.withdrawn_at === null ? "confirmed" : "withdrawn";
}

// How an open refuses what is no regular file: a link, a socket, or (checked on the opened handle) a folder or a named pipe.
const NOT_A_FILE = new Set(["ELOOP", "ENXIO", "ERR_NOT_REGULAR_FILE"]);

// A private file of the trial folder: a regular file only you can read (mode 0600), never a link. Its text, or null when missing. It is
// opened once, without following a link or waiting on a pipe, and checked and read through that one handle.
async function readPrivateFile(file, name) {
  try {
    return await withOpenedRegularFile(file, async (handle, info) => {
      if ((info.mode & 0o077) !== 0) invalid(`${name} can be read by others (it must be mode 0600).`);
      if (typeof process.getuid === "function" && info.uid !== process.getuid()) invalid(`${name} belongs to another user.`);
      return handle.readFile("utf8");
    });
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    if (NOT_A_FILE.has(error?.code)) invalid(`${name} must be a file, not a link or a folder.`);
    throw error;
  }
}

export const runnerClientsPath = (trialDir) => path.join(trialDir, RUNNER_CLIENTS_FILE);

// The client list, or an empty one when the file isn't there. A file that isn't the script's stops everything that reads it.
export async function readRunnerClients(trialDir) {
  if (typeof trialDir !== "string" || !path.isAbsolute(trialDir)) invalid("The trial folder must be an absolute path.");
  const text = await readPrivateFile(runnerClientsPath(trialDir), RUNNER_CLIENTS_FILE);
  if (text === null) return emptyRunnerClients();
  let value;
  try { value = JSON.parse(text); } catch { invalid(`${RUNNER_CLIENTS_FILE} isn't valid JSON.`); }
  return validateRunnerClients(value);
}

// Written whole or not at all, mode 0600: a new file beside it, synced, then renamed over it.
export async function writeRunnerClients(trialDir, value) {
  validateRunnerClients(value);
  const file = runnerClientsPath(trialDir);
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => {});
    await fs.rm(temporary, { force: true });
    throw error;
  }
  await handle.close();
  try { await fs.rename(temporary, file); } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
  await syncFolder(trialDir);
}

// After "Delete this case" of a client has removed their copies from the vault: the list names no copy of theirs and no server case they
// came from, so a copy from another one can be imported for them. With `keepSource` (the vault removed the case and couldn't finish, so
// the case and its copies may come back after a power cut) the list keeps naming the server case, which stays theirs alone. Their consent
// stays as recorded. A list with nothing to take off is made durable, since an earlier Delete may have changed it and not got that far.
// The caller holds the folder's lock.
export async function forgetClientCopy(trialDir, caseId, { keepSource = false } = {}) {
  const list = await readRunnerClients(trialDir);
  const client = list.clients.find((entry) => entry.case_id === caseId);
  const tied = Boolean(client) && Object.hasOwn(client.journal, "source_sha256");
  if (!client || (client.journal.corpus_id === null && (keepSource || !tied))) return syncFolder(trialDir);
  client.journal = { corpus_id: null, consent: client.journal.consent, ...(keepSource && tied ? { source_sha256: client.journal.source_sha256 } : {}) };
  await writeRunnerClients(trialDir, list);
}

// A rename is durable only once its folder is synced (Codex's reviews 1 and 2): without it, a power cut could keep a newer client
// list beside older credentials. A failed sync stops the command before anything that depends on it is written; only a filesystem
// that can't sync a folder at all (EINVAL, ENOTSUP) is let through.
export async function syncFolder(folder) {
  const handle = await fs.open(folder, constants.O_RDONLY | constants.O_DIRECTORY);
  try { await handle.sync(); }
  catch (error) { if (!["EINVAL", "ENOTSUP", "EOPNOTSUPP"].includes(error?.code)) throw error; }
  finally { await handle.close(); }
}

export function clientJournalFolder(trialDir, caseId) {
  if (typeof caseId !== "string" || !RUNNER_TRIAL_CASE_ID_PATTERN.test(caseId)) invalid("A client's case id isn't of the start script's form.");
  return path.join(trialDir, RUNNER_JOURNAL_FOLDER, caseId);
}

// "Delete this case" of a client: their journal folder goes (their key for journal copies, their copy's cold-test receipt and its test's
// marker), and that is made durable: until the folder it was in is synced, a power cut could bring the key back, and with it the means
// to open a sealed copy. The sync is made also when the folder is gone already, since an earlier Delete may not have got that far; where
// no client ever had such a folder there's nothing to sync. The caller holds the folder's lock.
export async function removeClientJournalFolder(trialDir, caseId) {
  const folder = clientJournalFolder(trialDir, caseId);
  await fs.rm(folder, { recursive: true, force: true });
  try { await syncFolder(path.dirname(folder)); } catch (error) { if (error?.code !== "ENOENT") throw error; }
}

// The cold test's receipt for a client's journal (design, point 5c), written by the cold test (scripts/runner-trial-journal.mjs,
// --cold-test): a passing test of exactly this case's corpus, at exactly one published generation, manifest and visibility epoch, of what
// one version of the replies' reader gives (`reader_version`), by one version of the pass rule (`rule`); and, for the record, how many
// questions the rule counted and who wrote them, the provider and model of the consumer and of the judge, and which of the tests started on
// this copy it was (`run`). A receipt that is missing, malformed or not a pass counts as none, like a withdrawal: no journal is used. One of
// the first form (schema version 1, of a test that searched another way than a reply does) names no reader, so it matches none.
const RECEIPT_FIELDS = Object.freeze(["schema_version", "kind", "result", "case_id", "corpus_id", "generation", "manifest_object_id", "visibility_epoch", "tested_at"]);
const RECEIPT_TEST_FIELDS = Object.freeze(["reader_version", "rule", "questions", "author", "consumer", "judge", "run"]);
const PROVIDER = /^[a-z][a-z0-9-]{0,39}$/u;
// A model's name, or the words a worker gives where the provider's CLI chooses it ("codex default").
const MODEL = /^[A-Za-z0-9][A-Za-z0-9 ._:-]{0,79}$/u;

export function validateColdTestReceipt(value) {
  exactKeys(value, value?.schema_version === 1 ? RECEIPT_FIELDS : [...RECEIPT_FIELDS, ...RECEIPT_TEST_FIELDS], "The cold-test receipt");
  if (![1, 2].includes(value.schema_version) || value.kind !== "journal_cold_test" || value.result !== "pass") invalid("The cold-test receipt isn't a passing journal cold test.");
  if (typeof value.case_id !== "string" || !RUNNER_TRIAL_CASE_ID_PATTERN.test(value.case_id)) invalid("The cold-test receipt's case id is invalid.");
  if (typeof value.corpus_id !== "string" || !CORPUS_ID.test(value.corpus_id)) invalid("The cold-test receipt's corpus id is invalid.");
  for (const field of ["generation", "manifest_object_id"]) if (typeof value[field] !== "string" || !ID.test(value[field])) invalid(`The cold-test receipt's ${field} is invalid.`);
  if (!Number.isSafeInteger(value.visibility_epoch) || value.visibility_epoch < 0) invalid("The cold-test receipt's visibility epoch is invalid.");
  timestamp(value.tested_at, "The cold-test receipt's tested_at");
  if (value.schema_version === 1) return value;
  for (const field of ["reader_version", "rule"]) if (typeof value[field] !== "string" || !ID.test(value[field])) invalid(`The cold-test receipt's ${field} is invalid.`);
  exactKeys(value.questions, ["answerable", "unanswerable", "planted"], "The cold-test receipt's questions");
  for (const kind of ["answerable", "unanswerable", "planted"]) if (!Number.isSafeInteger(value.questions[kind]) || value.questions[kind] < 1) invalid("The cold-test receipt's question counts are invalid.");
  if (!COLD_QUESTION_AUTHORS.includes(value.author)) invalid("The cold-test receipt's author is invalid.");
  if (!Number.isSafeInteger(value.run) || value.run < 1) invalid("The cold-test receipt's run is invalid.");
  for (const role of ["consumer", "judge"]) {
    exactKeys(value[role], ["provider", "model"], `The cold-test receipt's ${role}`);
    if (typeof value[role].provider !== "string" || !PROVIDER.test(value[role].provider) || typeof value[role].model !== "string" || !MODEL.test(value[role].model)) invalid(`The cold-test receipt's ${role} is invalid.`);
  }
  return value;
}

export async function readColdTestReceipt(trialDir, caseId) {
  try {
    const text = await readPrivateFile(path.join(clientJournalFolder(trialDir, caseId), COLD_TEST_RECEIPT_FILE), COLD_TEST_RECEIPT_FILE);
    if (text === null) return null;
    const receipt = validateColdTestReceipt(JSON.parse(text));
    return receipt.case_id === caseId ? receipt : null;
  } catch {
    return null;
  }
}

// The marker every cold test writes when it starts: its attempt, the copy it tests and how many tests were started on that copy, itself
// included. Only the test it names may give a receipt or take one away (scripts/runner-trial-journal.mjs). Null when it's missing or
// malformed, so that no test may.
export async function readColdTestMarker(trialDir, caseId) {
  try {
    const text = await readPrivateFile(path.join(clientJournalFolder(trialDir, caseId), COLD_TEST_ATTEMPT_FILE), COLD_TEST_ATTEMPT_FILE);
    if (text === null) return null;
    const marker = JSON.parse(text);
    exactKeys(marker, ["schema_version", "attempt", "started_at", "corpus_id", "run"], "The cold test's marker");
    timestamp(marker.started_at, "The cold test's started_at");
    return marker.schema_version === 1 && typeof marker.attempt === "string" && ATTEMPT.test(marker.attempt) && typeof marker.corpus_id === "string" && CORPUS_ID.test(marker.corpus_id)
      && Number.isSafeInteger(marker.run) && marker.run >= 1 ? marker : null;
  } catch {
    return null;
  }
}

export async function readColdTestAttempt(trialDir, caseId) {
  return (await readColdTestMarker(trialDir, caseId))?.attempt ?? null;
}

const DIGEST = /^[0-9a-f]{64}$/u;
const MAX_HELD_BACK = 100_000;
const heldBackPath = (trialDir, caseId) => path.join(clientJournalFolder(trialDir, caseId), QUESTIONS_HELD_BACK_FILE);

// The passages the questions tool holds back for a client, as digests: none when the file isn't there. A file that isn't the tool's
// stops the tool (what it holds back can't be told), as any private file of the trial folder does.
export async function readQuestionsHeldBack(trialDir, caseId) {
  const text = await readPrivateFile(heldBackPath(trialDir, caseId), QUESTIONS_HELD_BACK_FILE);
  if (text === null) return new Set();
  let value;
  try { value = JSON.parse(text); } catch { invalid(`${QUESTIONS_HELD_BACK_FILE} isn't valid JSON.`); }
  exactKeys(value, ["schema_version", "kind", "digests"], QUESTIONS_HELD_BACK_FILE);
  if (value.schema_version !== 1 || value.kind !== "runner_questions_held_back" || !Array.isArray(value.digests) || value.digests.length > MAX_HELD_BACK
    || !value.digests.every((digest) => typeof digest === "string" && DIGEST.test(digest))) invalid(`${QUESTIONS_HELD_BACK_FILE} isn't the questions tool's.`);
  return new Set(value.digests);
}

// Adds digests to a client's held-back passages, written whole or not at all (mode 0600) and made durable. The caller holds the folder's
// lock, and the client's journal folder exists.
export async function addQuestionsHeldBack(trialDir, caseId, digests) {
  if (!Array.isArray(digests) || !digests.every((digest) => typeof digest === "string" && DIGEST.test(digest))) invalid("Held-back passages are digests.");
  const all = new Set(await readQuestionsHeldBack(trialDir, caseId));
  for (const digest of digests) all.add(digest);
  if (all.size > MAX_HELD_BACK) invalid(`${QUESTIONS_HELD_BACK_FILE} would hold too many passages.`);
  const file = heldBackPath(trialDir, caseId);
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    await handle.writeFile(`${JSON.stringify({ schema_version: 1, kind: "runner_questions_held_back", digests: [...all].sort() }, null, 2)}\n`, "utf8");
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => {});
    await fs.rm(temporary, { force: true });
    throw error;
  }
  await handle.close();
  try { await fs.rename(temporary, file); } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
  await syncFolder(path.dirname(file));
}

// Whether a receipt names the version of the reader given and the pass rule as it is. One of the first form names neither.
export function coldTestReceiptNames(receipt, readerVersion) {
  return Boolean(receipt) && typeof readerVersion === "string" && receipt.reader_version === readerVersion && receipt.rule === COLD_TEST_RULE.version;
}

// Whether a receipt names exactly the snapshot a retrieval read (the same case, corpus, generation, manifest and epoch), the version of the
// reader that read it and the pass rule as it is.
export function coldTestReceiptMatches(receipt, { caseId, corpusId, generation, manifestObjectId, visibilityEpoch, readerVersion }) {
  return coldTestReceiptNames(receipt, readerVersion) && receipt.case_id === caseId && receipt.corpus_id === corpusId && receipt.generation === generation
    && receipt.manifest_object_id === manifestObjectId && receipt.visibility_epoch === visibilityEpoch;
}

// What the trial's page may show of the cases it can use: the owner's own case first, then each client the server has a grant
// for, in the list's order, with the label and the journal's state. Nothing else of the list; a client the server has no grant
// for (added since it started) is shown as needing a restart, without its case id.
export function runnerCasesView({ ownCaseId, clients, grantedCaseIds, receiptsFor = () => false }) {
  const granted = new Set(grantedCaseIds);
  const cases = [];
  if (ownCaseId) cases.push({ caseId: ownCaseId, kind: "own", number: null, label: null, journal: null });
  let waiting = 0;
  for (const [index, client] of clients.entries()) {
    if (!granted.has(client.case_id)) { waiting += 1; continue; }
    cases.push({
      caseId: client.case_id,
      kind: "client",
      // The client's number on the list, which --journal-consent asks for; the page shows it beside the label.
      number: index + 1,
      label: client.label,
      journal: { consent: journalConsentState(client), copied: client.journal.corpus_id !== null, coldTestPassed: receiptsFor(client.case_id) === true }
    });
  }
  return { cases, clientsAwaitingRestart: waiting };
}
