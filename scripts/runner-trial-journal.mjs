#!/usr/bin/env node
// A client's journal in the runner trial (docs/superpowers/specs/2026-11-23-runner-client-cases-design.md, points 4 and 5; the
// owner's answer 1a to the InnerSignal lane's question i73):
//
//   node scripts/runner-trial-journal.mjs --copy-key [--dir PATH]
//   node scripts/runner-trial-journal.mjs --import FILE [--dir PATH]
//   node scripts/runner-trial-journal.mjs --cold-test FILE --provider mixed|claude|codex [--dir PATH]
//
// The export is the journal import's `export` command, run where the client's journal lives, only on the owner's go for each copy.
// Each command here asks for the client's number in the terminal (the numbers --journal-consent shows) and prints no label, no question
// id, no journal text, and no unexpected error's own words (which can quote what a file holds).

import fsp from "node:fs/promises";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { withOpenedRegularFile } from "../src/core/opened-regular-file.mjs";
import { isOutside } from "../src/core/private-path.mjs";
import { createJournalCopyKeyPair, importJournalCopy, journalCopyCorpusId, journalCopyRecipientDigest, journalCopySourceDigest, openJournalCopy, readSealedJournalCopy } from "../src/journal-import/journal-copy.mjs";
import { COLD_TEST_ATTEMPT_FILE, COLD_TEST_RECEIPT_FILE, clientJournalFolder, journalConsentState, readColdTestAttempt, readRunnerClients, syncFolder, writeRunnerClients } from "../src/runner-trial/clients.mjs";
import { folderLockLeftNotice } from "../src/runner-trial/folder-lock.mjs";
import { COLD_TEST_RULE, createSealedColdTestPort, runJournalColdTest, validateColdQuestionsFile } from "../src/runner-trial/journal-cold-test.mjs";
import { createRunnerWorkerFactory } from "../src/runner-trial/settings.mjs";
import { RUNNER_CLAUDE_CONFIG_DIR } from "../src/runner-trial/switch.mjs";
import { PRIVATE_CASE_SCOPES, PRIVATE_JOURNAL_PURPOSES, createPrivateCaseAccessService, loadDevelopmentPrivateCaseProviders } from "../src/storage/private-case-access.mjs";
import { acquirePrivateRootWriterLock } from "../src/storage/shared-case-coordinator.mjs";
import { COMMAND_LOCK_WAIT_MS, StartError, ask, checkTrialHome, defaultClaudeConfigDir, defaultTrialHome, privateFolder, repositoryRoot, trialSettings,
  withTrialFolderLock, writePrivateFile } from "./runner-trial-start.mjs";

// Each client's key for journal copies, in their journal folder: their Delete removes it, and with it the means to open any copy
// sealed for them.
export const CLIENT_COPY_KEY_FILE = "copy-key.json";
const MAX_SEALED_BYTES = 1024 * 1024 * 1024;

export const USAGE = `Usage: node scripts/runner-trial-journal.mjs --copy-key [--dir PATH]
       node scripts/runner-trial-journal.mjs --import FILE [--dir PATH]
       node scripts/runner-trial-journal.mjs --cold-test FILE --provider mixed|claude|codex [--dir PATH]

A client's journal, copied into their runner case and tested there before any reply uses it. Each command asks for the client's
number (the one --journal-consent shows) and prints no label, no question id and no journal text.
  --copy-key         make the client's key for journal copies (once; its private half stays in their folder in the trial folder,
                     mode 0600, and their Delete removes it) and print its public half, for the export where the journal lives
                     (the journal import's export, with runner_trial_export in its private configuration)
  --import FILE      import the sealed copy the export wrote, while the trial is stopped, into the client's runner case, checked
                     quote by quote and record by record against the export. FILE must be outside the trial folder and stays where
                     it is: once imported it's no longer needed, and you may delete it. A copy sealed for another client's key is
                     refused, and so is one of a journal another client's copy came from. The first import ties the client's copies
                     to that server case until their Delete, also when it fails: a copy from another one is refused. An import that
                     starts first removes the client's cold-test receipt, whatever copy it names and also when the import then
                     fails: the copy is tested again before any reply uses it.
  --cold-test FILE   the copy's cold test, with the questions and their key from FILE (mode 0600, outside the checkout). For each
                     question, what a reply to it as the message would get from the copy goes to a fresh call of the trial's
                     writer's worker, which answers from that alone; and the answer, with the same passages and the key quotes, to a
                     fresh call of the checker's worker, which judges it (and is asked again when it finds something wrong): two
                     calls a question, three at most, one at a time. The copy passes when the file has at least ${COLD_TEST_RULE.answerable} questions
                     the journal answers and ${COLD_TEST_RULE.unanswerable} it doesn't, no answer is wrong, at least ${COLD_TEST_RULE.right.at_least} of every ${COLD_TEST_RULE.right.of} questions that share a
                     search word with their key quotes are right, and the copy's publication didn't change meanwhile.
                     A test that starts removes the copy's receipt; only a pass gives a new one, which the journal gate asks for.
                     Of two tests that overlap, the one started last decides, also when it never ends.
                     It sends excerpts of the client's journal to the companies running those workers (with --provider mixed,
                     Anthropic and OpenAI; claude, Anthropic; codex, OpenAI), so it needs the client's confirmed journal consent.
  --provider mixed|claude|codex  the cold test's workers: mixed (the answers from GPT, judged by Claude), claude (both through
                     \`claude -p\`, signed in at ${RUNNER_CLAUDE_CONFIG_DIR}) or codex (both through \`codex exec\`, signed in)
  --dir PATH         the trial folder (default ${defaultTrialHome()})`;

const usageError = (message) => new StartError(`${message}\n\n${USAGE}`, 2);
const COMMANDS = Object.freeze(["--copy-key", "--import", "--cold-test"]);
const COLD_TEST_PROVIDERS = Object.freeze(["mixed", "claude", "codex"]);

export function parseJournalArguments(argv) {
  const options = { command: null, file: null, provider: null, dir: null };
  const args = [...argv];
  while (args.length) {
    const flag = args.shift();
    if (COMMANDS.includes(flag)) {
      if (options.command !== null) throw usageError("Give one command: --copy-key, --import or --cold-test.");
      options.command = flag.slice(2);
      if (flag !== "--copy-key" && args.length && !args[0].startsWith("--")) options.file = args.shift();
    } else if (flag === "--provider" || flag === "--dir") {
      const name = flag.slice(2);
      const value = args.shift();
      if (typeof value !== "string" || value === "" || value.startsWith("--")) throw usageError(`${flag} needs a value.`);
      if (options[name] !== null) throw usageError(`${flag} is given twice.`);
      options[name] = value;
    } else {
      throw usageError(`Unknown argument: ${String(flag).startsWith("-") ? flag : "(a value without its option)"}`);
    }
  }
  if (options.command === null) throw usageError("Give one command: --copy-key, --import or --cold-test.");
  if (options.dir !== null && !path.isAbsolute(options.dir)) throw usageError("--dir must be an absolute path.");
  if (options.file !== null && !path.isAbsolute(options.file)) throw usageError("Give the file's absolute path.");
  if (options.command !== "copy-key" && options.file === null) throw usageError(`--${options.command} needs its file.`);
  if (options.command === "cold-test") {
    if (!COLD_TEST_PROVIDERS.includes(options.provider)) throw usageError("--cold-test needs --provider mixed, claude or codex.");
  } else if (options.provider !== null) {
    throw usageError("--provider goes with --cold-test only.");
  }
  return options;
}

// An error's code when it has one, the only part of an unexpected error a message here shows: its own text can quote what a file holds (a
// JSON parse error does).
const codeOf = (error) => (typeof error?.code === "string" && /^[A-Z0-9_]{1,60}$/u.test(error.code) ? error.code : null);

async function clientList(resolved) {
  try { return await readRunnerClients(resolved); }
  catch { throw new StartError("The client list can't be read; it was left as it is."); }
}

async function writeClientList(resolved, list, then) {
  try { await writeRunnerClients(resolved, list); }
  catch (error) { throw new StartError(`The client list couldn't be written (${codeOf(error) ?? "failed"}); ${then}`); }
}

// The trial's credentials, as the app's own loader reads and checks them (one opened handle).
async function trialProviders(resolved) {
  try { return await loadDevelopmentPrivateCaseProviders(path.join(resolved, "credentials.json")); }
  catch (error) { throw new StartError(`The trial's credentials can't be read (${codeOf(error) ?? "not valid"}); credentials.json was left as it is.`); }
}

async function requireReady(resolved) {
  try { await withOpenedRegularFile(path.join(resolved, "credentials.json"), () => {}); }
  catch { throw new StartError(`The trial folder ${resolved} isn't ready: start the trial once (or use --prepare-only) first.`); }
}

// A file opened once and read through that handle, so what is checked (a regular file, its mode, its size) is what is read. Null when
// it isn't there.
async function readOpenedFileOrNull(file, read) {
  try { return await withOpenedRegularFile(file, read); } catch (error) {
    if (error?.code === "ENOENT") return null;
    if (error?.code === "ELOOP" || error?.code === "ERR_NOT_REGULAR_FILE") throw new StartError(`${file} must be a file, not a link or a folder.`);
    throw error;
  }
}

const copyKeyPath = (resolved, client) => path.join(clientJournalFolder(resolved, client.case_id), CLIENT_COPY_KEY_FILE);

async function readClientCopyKey(resolved, client, number, { missingOk = false } = {}) {
  const file = copyKeyPath(resolved, client);
  const text = await readOpenedFileOrNull(file, (handle, info) => {
    if ((info.mode & 0o077) !== 0) throw new StartError(`${file} must be readable by you alone (mode 0600); it was left as it is.`);
    return handle.readFile("utf8");
  });
  if (text === null) {
    if (missingOk) return null;
    throw new StartError(`Client ${number} has no key for journal copies yet: make it with --copy-key, and export their journal for it.`);
  }
  let value;
  try { value = JSON.parse(text); } catch { throw new StartError(`${file} isn't valid JSON; it was left as it is.`); }
  if (value?.schema_version !== 1 || value.kind !== "runner_journal_copy_key" || value.case_id !== client.case_id
    || typeof value.public_key !== "string" || typeof value.private_key !== "string") {
    throw new StartError(`${file} wasn't made by this script for this client; it was left as it is.`);
  }
  return { publicKey: value.public_key, privateKey: value.private_key };
}

async function clientByNumber(resolved, number) {
  const list = await clientList(resolved);
  const client = Number.isSafeInteger(number) && number >= 1 ? list.clients[number - 1] : null;
  if (!client) throw new StartError("There's no client with that number.");
  return { list, client };
}

// --copy-key: the client's key pair for journal copies, made once. Only its public half leaves the trial folder.
export async function ensureJournalCopyKey({ home, number, lockWaitMs = COMMAND_LOCK_WAIT_MS }) {
  const resolved = checkTrialHome(home);
  await requireReady(resolved);
  return withTrialFolderLock(resolved, async () => {
    const { client } = await clientByNumber(resolved, number);
    const existing = await readClientCopyKey(resolved, client, number, { missingOk: true });
    if (existing) return { publicKey: existing.publicKey, made: false };
    await privateFolder(clientJournalFolder(resolved, client.case_id), "The client's journal folder");
    const pair = createJournalCopyKeyPair();
    await writePrivateFile(copyKeyPath(resolved, client),
      `${JSON.stringify({ schema_version: 1, kind: "runner_journal_copy_key", case_id: client.case_id, public_key: pair.publicKey, private_key: pair.privateKey }, null, 2)}\n`);
    return { publicKey: pair.publicKey, made: true };
  }, { waitMs: lockWaitMs });
}

// A grant made in this process for one command and one case alone, with a random token only this process knows: the copy step's
// write with the archive, organize_search and session_use purposes the store asks (design, point 4), or the cold test's read
// with session use. Nothing of it is written.
export function oneTimeGrant(caseId, { scopes, purposes }) {
  const token = randomBytes(32).toString("base64url");
  const authorizationProvider = Object.freeze({
    async authorize({ caseId: asked, authContext, requiredScope }) {
      const allowed = asked === caseId && authContext?.bearerToken === token && scopes.includes(requiredScope);
      return { allowed, principalId: "runner-trial-journal-step", scopes: allowed ? [requiredScope] : [], purposes: allowed ? [...purposes] : [] };
    }
  });
  return { authorizationProvider, authContext: { bearerToken: token } };
}

export const IMPORT_PURPOSES = Object.freeze([PRIVATE_JOURNAL_PURPOSES.ARCHIVE, PRIVATE_JOURNAL_PURPOSES.ORGANIZE_SEARCH, PRIVATE_JOURNAL_PURPOSES.SESSION_USE]);

// A file of the client's journal folder removed (their cold-test receipt, whatever copy it names, or the marker of the cold test started
// last), and that made durable.
async function removeJournalFile(resolved, caseId, name) {
  const folder = clientJournalFolder(resolved, caseId);
  try { await fsp.unlink(path.join(folder, name)); } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  await syncFolder(folder);
}

// --import: the copy step's laptop half. Under the trial folder's lock and the vault's writer lock (which the running trial holds,
// so the trial must be stopped), the sealed file is read where the owner put it and left there, opened with the chosen client's key (a
// copy sealed for another client's key can't be opened), checked against the other clients' copies and the client's own, imported into
// the client's runner case (src/journal-import/journal-copy.mjs) and named on the client list. Nothing is moved, and nothing is written
// before the copy opens, so a wrong file changes nothing.
//
// A client's copies come from one server case until their Delete: the list names it (as a digest) before the vault is touched, and keeps
// it when a later step fails. So every copy the vault may hold, an unfinished import's included, has its one client on the list, and
// neither another server case for that client nor that server case for another client is imported.
export async function importClientJournal({ home, number, sealedPath, lockWaitMs = COMMAND_LOCK_WAIT_MS }) {
  const resolved = checkTrialHome(home);
  await requireReady(resolved);
  if (typeof sealedPath !== "string" || !path.isAbsolute(sealedPath)) throw new StartError("--import needs the sealed file's absolute path.");
  const source = path.resolve(sealedPath);
  let outsideTrial = false;
  try { outsideTrial = isOutside(resolved, source); } catch { outsideTrial = false; }
  if (!outsideTrial) throw new StartError("The sealed file must be outside the trial folder; nothing was changed.");
  return withTrialFolderLock(resolved, async () => {
    const { list, client } = await clientByNumber(resolved, number);
    const keyPair = await readClientCopyKey(resolved, client, number);
    let bundle;
    try {
      const sealed = await readOpenedFileOrNull(source, (handle, info) => {
        if (info.size > MAX_SEALED_BYTES) throw new StartError("That file is too large to be a sealed journal copy; nothing was changed.");
        return readSealedJournalCopy(handle);
      });
      if (sealed === null) throw new StartError(`${source} isn't there.`);
      if (sealed.recipient_sha256 !== journalCopyRecipientDigest(keyPair.publicKey)) {
        throw new StartError(`That copy was sealed for another key, not client ${number}'s: check the client's number, or export their journal for their key. Nothing was changed.`);
      }
      bundle = openJournalCopy(sealed, keyPair);
    } catch (error) {
      if (error instanceof StartError) throw error;
      throw new StartError(`That file isn't a sealed journal copy that client ${number}'s key opens (${codeOf(error) ?? "unreadable"}); nothing was changed.`);
    }
    const sourceDigest = journalCopySourceDigest(bundle);
    const other = list.clients.findIndex((entry) => entry !== client && entry.journal?.source_sha256 === sourceDigest);
    if (other >= 0) throw new StartError(`That journal was already copied for client ${other + 1} (or a copy of it begun); nothing was imported.`);
    const reserved = client.journal.source_sha256 ?? null;
    if (reserved !== null && reserved !== sourceDigest) {
      throw new StartError(`Client ${number}'s journal copy comes from another server case; to import a different one, delete their case first. Nothing was changed.`);
    }
    if (reserved === null) {
      client.journal = { ...client.journal, source_sha256: sourceDigest };
      await writeClientList(resolved, list, "nothing was imported.");
    }
    try {
      return await importOpenedCopy({ resolved, list, client, number, bundle });
    } catch (error) {
      throw new StartError(`${error instanceof StartError ? error.message : `The import didn't finish (${codeOf(error) ?? "failed"}).`} Until their Delete, client ${number}'s copies can come only from that server case; the same file can be imported again.`);
    }
  }, { waitMs: lockWaitMs });
}

// The vault's part of --import, once the client list names the server case the copy comes from.
//
// No receipt survives an import that starts. Once the vault's writer lock is had, and before anything is written to the vault, the client's
// cold-test receipt goes, whatever copy it names, with the marker of the test started last (so that one still running gives none), and that
// is made durable. The same sealed file makes the very copy an earlier receipt named (after a Delete that couldn't clear the receipt, say),
// so one left for later would open the journal on an import that failed, or was killed, half-way. With both gone first, the order of what
// follows doesn't matter. A removal that fails stops the import before it starts. All of it is under the folder's lock, which a cold test
// takes to start and to give its receipt, so none comes back meanwhile.
async function importOpenedCopy({ resolved, list, client, number, bundle }) {
  const providers = await trialProviders(resolved);
  let writerLock = null;
  try {
    try { writerLock = await acquirePrivateRootWriterLock({ rootDir: providers.rootDir }); } catch (error) {
      if (error?.code === "PRIVATE_ROOT_WRITER_ACTIVE") throw new StartError("The trial is running: stop it (Ctrl-C in its terminal), then import again. Nothing was imported.");
      throw error;
    }
    try {
      for (const name of [COLD_TEST_RECEIPT_FILE, COLD_TEST_ATTEMPT_FILE]) await removeJournalFile(resolved, client.case_id, name);
      // Also when an earlier import had removed them and couldn't make that durable.
      await syncFolder(clientJournalFolder(resolved, client.case_id));
    } catch (error) {
      throw new StartError(`Client ${number}'s cold-test receipt couldn't be removed for good (${codeOf(error) ?? "failed"}); nothing was imported.`);
    }
    const grant = oneTimeGrant(client.case_id, { scopes: [PRIVATE_CASE_SCOPES.READ, PRIVATE_CASE_SCOPES.WRITE], purposes: IMPORT_PURPOSES });
    const service = createPrivateCaseAccessService({ rootDir: providers.rootDir, heldRootDir: providers.rootDir, authorizationProvider: grant.authorizationProvider,
      keyProvider: providers.keyProvider, allowDevelopmentFileProvider: true });
    const result = await importJournalCopy({ caseAccessService: service, caseId: client.case_id, corpusId: journalCopyCorpusId(bundle), authContext: grant.authContext, bundle });
    client.journal = { ...client.journal, corpus_id: result.corpus_id };
    await writeClientList(resolved, list, "the copy is in the client's case, but nothing uses it.");
    return { number, corpus_id: result.corpus_id, passages_verified: result.passages_verified, records_verified: result.records_verified };
  } finally {
    await writerLock?.release();
    providers.close();
  }
}

async function readQuestionsFile(file) {
  if (typeof file !== "string" || !path.isAbsolute(file)) throw new StartError("--cold-test needs the absolute path of the questions file.");
  let outside = false;
  try { outside = isOutside(repositoryRoot, path.dirname(file)); } catch { outside = false; }
  if (!outside) throw new StartError("The questions file must be outside the InnerSignal checkout.");
  const text = await readOpenedFileOrNull(file, (handle, info) => {
    if ((info.mode & 0o077) !== 0) throw new StartError("The questions file must be readable by you alone (mode 0600).");
    return handle.readFile("utf8");
  });
  if (text === null) throw new StartError("The questions file isn't there.");
  try { return validateColdQuestionsFile(JSON.parse(text)); }
  catch (error) { throw new StartError(`The questions file isn't valid (${codeOf(error) ?? "not JSON"}).`); }
}

// The cold test's workers for a provider choice, as the trial makes them (sealed, signed in): the writer's for the consumer, the whole-reply
// checker's for the judge.
const CONSUMER_ROLE = "W", JUDGE_ROLE = "CW";
function coldTestSettings(provider) {
  if (!COLD_TEST_PROVIDERS.includes(provider)) throw new StartError("Choose the cold test's workers: --provider mixed, claude or codex.");
  return trialSettings(provider);
}
const providersOf = (settings) => new Set([CONSUMER_ROLE, JUDGE_ROLE].map((role) => settings.workers[role].provider));
// The companies that get excerpts of the journal in that test.
const COMPANY = Object.freeze({ claude: "Anthropic", codex: "OpenAI" });
const companiesOf = (settings) => [...providersOf(settings)].map((provider) => COMPANY[provider]).sort().join(" and ");

function coldTestWorkers(settings, environment) {
  const claudeConfigDir = providersOf(settings).has("claude") ? (environment[RUNNER_CLAUDE_CONFIG_DIR]?.trim() || defaultClaudeConfigDir()) : null;
  if (claudeConfigDir !== null && !path.isAbsolute(claudeConfigDir)) throw new StartError(`${RUNNER_CLAUDE_CONFIG_DIR} must be an absolute path.`);
  return createRunnerWorkerFactory({ ...settings, claudeConfigDir },
    { environment, claudeCommand: environment.CLAUDE_COMMAND || "claude", codexCommand: environment.CODEX_COMMAND || "codex" });
}

// --cold-test: the copy's cold test (src/runner-trial/journal-cold-test.mjs). A test that starts removes the copy's receipt; only a pass
// gives a new one: an error, a withdrawal, a wrong or malformed answer, a file too small to pass leaves none. The client's consent and copy
// are read again before every packet leaves (the judge's too) and before the receipt is written, so a withdrawal, a new copy or a deleted
// case stops it.
//
// Of tests that overlap, the one started last decides. Each marks its start, where it removes the receipt, with an attempt of its own. A
// pass is recorded, and a receipt taken away by a test that doesn't pass, only while the marker still names that test's attempt. So once a
// newer test has started, also one that never ends, an earlier one gives no receipt and takes away none. All of it under the trial
// folder's lock.
//
// The boundary: the consent is read under the trial folder's lock, the one --journal-consent takes, right before each packet is handed to
// the worker's process, and the lock is released before that hand-over (a call can take minutes). So a withdrawal lands wholly before
// that reading, and the packet doesn't leave, or after it; one that lands after the hand-over is honoured at the next packet and before
// the receipt is written, again under the lock. `workerFor` (a worker for a role of the trial's) replaces the signed-in workers in tests.
export async function runClientColdTest({ home, number, questionsPath, provider = null, workerFor = null, environment = process.env, now = () => new Date(), lockWaitMs = COMMAND_LOCK_WAIT_MS }) {
  const resolved = checkTrialHome(home);
  await requireReady(resolved);
  const settings = coldTestSettings(provider);
  const questions = await readQuestionsFile(questionsPath);
  const workers = workerFor ?? coldTestWorkers(settings, environment);
  const consumer = workers(CONSUMER_ROLE), judge = workers(JUDGE_ROLE);
  const attempt = randomUUID();
  const underLock = (operation) => withTrialFolderLock(resolved, operation, { waitMs: lockWaitMs });
  const { caseId, corpusId } = await underLock(async () => {
    const { client } = await clientByNumber(resolved, number);
    if (journalConsentState(client) !== "confirmed") {
      throw new StartError(`Client ${number} has no confirmed journal consent. The cold test sends excerpts of their journal to ${companiesOf(settings)}, so it runs only with their consent (runner-trial-start.mjs --journal-consent confirm).`);
    }
    if (!client.journal.corpus_id) throw new StartError(`Client ${number} has no journal copy here yet: import it with --import.`);
    const folder = clientJournalFolder(resolved, client.case_id);
    await privateFolder(folder, "The client's journal folder");
    // The receipt goes first: whatever stops the start between the two, a receipt that's there is the one the marked test gave.
    await removeJournalFile(resolved, client.case_id, COLD_TEST_RECEIPT_FILE);
    await writePrivateFile(path.join(folder, COLD_TEST_ATTEMPT_FILE), `${JSON.stringify({ schema_version: 1, attempt, started_at: now().toISOString() }, null, 2)}\n`);
    return { caseId: client.case_id, corpusId: client.journal.corpus_id };
  });
  const stillSo = async () => {
    const current = (await clientList(resolved)).clients.find((entry) => entry.case_id === caseId);
    if (!current || journalConsentState(current) !== "confirmed" || current.journal?.corpus_id !== corpusId) {
      throw new StartError("The client's consent or copy changed during the cold test: it stopped, and gave no receipt.");
    }
  };
  const port = createSealedColdTestPort({ consumer, judge, beforeSend: () => underLock(stillSo) });
  // A test that doesn't pass leaves no receipt, unless a newer one has started: that one decides. Returns whether one has.
  const leaveNone = () => underLock(async () => {
    const marked = await readColdTestAttempt(resolved, caseId);
    if (marked === attempt) await removeJournalFile(resolved, caseId, COLD_TEST_RECEIPT_FILE);
    return marked !== null && marked !== attempt;
  });
  let result;
  try {
    const providers = await trialProviders(resolved);
    try {
      const grant = oneTimeGrant(caseId, { scopes: [PRIVATE_CASE_SCOPES.READ], purposes: [PRIVATE_JOURNAL_PURPOSES.SESSION_USE] });
      const service = createPrivateCaseAccessService({ rootDir: providers.rootDir, authorizationProvider: grant.authorizationProvider, keyProvider: providers.keyProvider, allowDevelopmentFileProvider: true });
      result = await runJournalColdTest({ service, auth: grant.authContext, caseId, corpusId, questions, port, now });
    } finally {
      providers.close();
    }
    if (result.passed) {
      await underLock(async () => {
        await stillSo();
        const marked = await readColdTestAttempt(resolved, caseId);
        if (marked !== attempt) {
          throw new StartError(marked === null ? "The marker of this cold test's start is gone or can't be read: it gave no receipt. Run it again."
            : "A newer cold test of this copy has started, and that one decides: this one gave no receipt. If no other is running, run it again.");
        }
        await writePrivateFile(path.join(clientJournalFolder(resolved, caseId), COLD_TEST_RECEIPT_FILE), `${JSON.stringify(result.receipt, null, 2)}\n`);
      });
    }
  } catch (error) {
    // What stopped the test is what's told.
    await leaveNone().catch(() => {});
    throw error;
  }
  const newerStarted = result.passed ? false : await leaveNone();
  return { passed: result.passed, newerStarted, report: result.report };
}

async function askClientNumber(resolved, command, { log, askQuestion }) {
  const { clients } = await clientList(resolved);
  if (!clients.length) throw new StartError("There are no clients yet: add one with runner-trial-start.mjs --add-client.");
  log("Clients (their labels are on the runner page, beside the same numbers):");
  clients.forEach((client, index) => log(`  ${index + 1}. added ${client.added_at.slice(0, 10)}, journal consent: ${journalConsentState(client)}, ${client.journal?.corpus_id ? "a copy here" : "no copy here"}`));
  const question = { "copy-key": "Number of the client whose journal is to be copied: ", import: "Number of the client whose journal copy this is: ",
    "cold-test": "Number of the client whose copy to test (a test that starts removes the copy's receipt; only a pass gives a new one): " }[command];
  const answer = (await askQuestion(question)).trim();
  if (!/^[1-9][0-9]{0,2}$/u.test(answer)) throw new StartError("That isn't a client's number; nothing was changed.");
  return Number(answer);
}

async function main(argv, { log, askQuestion, workerFor }) {
  const options = parseJournalArguments(argv);
  const home = checkTrialHome(options.dir ?? defaultTrialHome());
  const number = await askClientNumber(home, options.command, { log, askQuestion });
  if (options.command === "copy-key") {
    const { publicKey, made } = await ensureJournalCopyKey({ home, number });
    log(`${made ? `Made client ${number}'s key for journal copies.` : `Client ${number} already has a key for journal copies.`} Its public half, for runner_trial_export.recipient_public_key in the private configuration that exports their journal:`);
    log(publicKey);
    return 0;
  }
  if (options.command === "import") {
    const result = await importClientJournal({ home, number, sealedPath: options.file });
    log(`Imported client ${number}'s journal copy into their runner case: ${result.passages_verified} quotations and ${result.records_verified} records checked against the export. Its cold test comes next (--cold-test); until one passes, no reply uses it.`);
    log("The sealed file is no longer needed, and was left where it is: you may delete it.");
    return 0;
  }
  const result = await runClientColdTest({ home, number, questionsPath: options.file, provider: options.provider, workerFor });
  log(JSON.stringify(result.report, null, 2));
  log(result.passed
    ? `Passed: client ${number}'s copy has its cold-test receipt, so their sessions can use their journal while their consent holds (a consent confirmed after the trial started holds from its next start).`
    : result.newerStarted
      ? `Not passed. A newer cold test of client ${number}'s copy has started, and that one decides whether the copy has a receipt.`
      : `Not passed: client ${number}'s copy has no cold-test receipt, so their journal stays out of their sessions.`);
  return result.passed ? 0 : 1;
}

// A command as the terminal runs it: what it prints, and its exit code. A refusal prints its own fixed message; any other error a fixed
// line with its code, never its own text; then, when the trial folder's lock was left too, the fixed line that says so. `log`, `logError`,
// `askQuestion` and `workerFor` are for tests.
export async function runMain(argv, { log = console.log, logError = console.error, askQuestion = ask, workerFor = null } = {}) {
  try { return await main(argv, { log, askQuestion, workerFor }); } catch (error) {
    const refusal = error instanceof StartError;
    const code = codeOf(error);
    logError(refusal ? error.message : `The journal command failed${code ? `: ${code}` : ""}.`);
    const lockLeft = folderLockLeftNotice(error);
    if (lockLeft) logError(lockLeft);
    return refusal ? error.exitCode : 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runMain(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
