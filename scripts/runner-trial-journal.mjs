#!/usr/bin/env node
// A client's journal in the runner trial (docs/superpowers/specs/2026-11-23-runner-client-cases-design.md, points 4 and 5; the
// owner's answer 1a to the InnerSignal lane's question i73):
//
//   node scripts/runner-trial-journal.mjs --copy-key [--dir PATH]
//   node scripts/runner-trial-journal.mjs --import FILE [--dir PATH]
//   node scripts/runner-trial-journal.mjs --cold-test FILE --provider claude|codex [--dir PATH]
//
// The export is the journal import's `export` command, run where the client's journal lives, only on the owner's go for each copy.
// Each command here asks for the client's number in the terminal (the numbers --journal-consent shows) and prints no label and no
// journal text.

import fsp from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { withOpenedRegularFile } from "../src/core/opened-regular-file.mjs";
import { isOutside } from "../src/core/private-path.mjs";
import { createJournalCopyKeyPair, importJournalCopy, journalCopyCorpusId, journalCopyRecipientDigest, journalCopySourceDigest, openJournalCopy, readSealedJournalCopy } from "../src/journal-import/journal-copy.mjs";
import { COLD_TEST_RECEIPT_FILE, clientJournalFolder, journalConsentState, readColdTestReceipt, writeRunnerClients } from "../src/runner-trial/clients.mjs";
import { createSealedColdConsumerPort, runJournalColdTest, validateColdQuestionsFile } from "../src/runner-trial/journal-cold-test.mjs";
import { createRunnerWorkerFactory } from "../src/runner-trial/settings.mjs";
import { RUNNER_CLAUDE_CONFIG_DIR } from "../src/runner-trial/switch.mjs";
import { PRIVATE_CASE_SCOPES, PRIVATE_JOURNAL_PURPOSES, createPrivateCaseAccessService, loadDevelopmentPrivateCaseProviders } from "../src/storage/private-case-access.mjs";
import { acquirePrivateRootWriterLock } from "../src/storage/shared-case-coordinator.mjs";
import { COMMAND_LOCK_WAIT_MS, StartError, ask, checkTrialHome, defaultClaudeConfigDir, defaultTrialHome, privateFolder, readClientList, repositoryRoot, trialSettings,
  withTrialFolderLock, writePrivateFile } from "./runner-trial-start.mjs";

// Each client's key for journal copies, in their journal folder: their Delete removes it, and with it the means to open any copy
// sealed for them.
export const CLIENT_COPY_KEY_FILE = "copy-key.json";
const MAX_SEALED_BYTES = 1024 * 1024 * 1024;

export const USAGE = `Usage: node scripts/runner-trial-journal.mjs --copy-key [--dir PATH]
       node scripts/runner-trial-journal.mjs --import FILE [--dir PATH]
       node scripts/runner-trial-journal.mjs --cold-test FILE --provider claude|codex [--dir PATH]

A client's journal, copied into their runner case and tested there before any reply uses it. Each command asks for the client's
number (the one --journal-consent shows) and prints no label and no journal text.
  --copy-key         make the client's key for journal copies (once; its private half stays in their folder in the trial folder,
                     mode 0600, and their Delete removes it) and print its public half, for the export where the journal lives
                     (the journal import's export, with runner_trial_export in its private configuration)
  --import FILE      import the sealed copy the export wrote, while the trial is stopped, into the client's runner case, checked
                     quote by quote and record by record against the export. FILE must be outside the trial folder; it is
                     removed once the copy is published. A copy sealed for another client's key, or of a journal already copied
                     for another client, is refused. A new copy needs its own cold test.
  --cold-test FILE   the copy's cold test, with the questions and their key from FILE (mode 0600, outside the checkout): a fresh
                     consumer on the trial's signed-in worker answers from the copy alone. A pass records the receipt the
                     journal gate asks for; a test that ends without one removes the copy's receipt (one stopped by an error
                     before its end decides nothing). It sends excerpts of the client's journal to the company running that
                     worker, so it needs the client's confirmed journal consent.
  --provider claude|codex  the cold test's worker: claude (\`claude -p\`, signed in at ${RUNNER_CLAUDE_CONFIG_DIR}) or codex
                     (\`codex exec\`, signed in)
  --dir PATH         the trial folder (default ${defaultTrialHome()})`;

const usageError = (message) => new StartError(`${message}\n\n${USAGE}`, 2);
const COMMANDS = Object.freeze(["--copy-key", "--import", "--cold-test"]);

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
    if (!["claude", "codex"].includes(options.provider)) throw usageError("--cold-test needs --provider claude or codex.");
  } else if (options.provider !== null) {
    throw usageError("--provider goes with --cold-test only.");
  }
  return options;
}

async function requireReady(resolved) {
  let handle;
  try { handle = await fsp.open(path.join(resolved, "credentials.json"), "r"); }
  catch { throw new StartError(`The trial folder ${resolved} isn't ready: start the trial once (or use --prepare-only) first.`); }
  await handle.close();
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
  const list = await readClientList(resolved);
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

// --import: the copy step's laptop half. Under the trial folder's lock and the vault's writer lock (which the running trial holds,
// so the trial must be stopped), the sealed file is read where the owner put it, opened with the chosen client's key (a copy
// sealed for another client's key can't be opened), checked against the other clients' copies, imported into the client's
// runner case (src/journal-import/journal-copy.mjs) and named on the client list; the file is removed only then. Nothing is moved
// or written before the copy opens, so a wrong file is left as it was.
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
      throw new StartError(`That file isn't a sealed journal copy that client ${number}'s key opens (${error?.code ?? "unreadable"}); nothing was changed.`);
    }
    const sourceDigest = journalCopySourceDigest(bundle);
    const other = list.clients.findIndex((entry) => entry !== client && entry.journal?.source_sha256 === sourceDigest);
    if (other >= 0) throw new StartError(`That journal was already copied for client ${other + 1}; nothing was imported.`);
    const providers = await loadDevelopmentPrivateCaseProviders(path.join(resolved, "credentials.json"));
    let writerLock = null;
    try {
      try { writerLock = await acquirePrivateRootWriterLock({ rootDir: providers.rootDir }); } catch (error) {
        if (error?.code === "PRIVATE_ROOT_WRITER_ACTIVE") throw new StartError("The trial is running: stop it (Ctrl-C in its terminal), then import again. Nothing was changed.");
        throw error;
      }
      const grant = oneTimeGrant(client.case_id, { scopes: [PRIVATE_CASE_SCOPES.READ, PRIVATE_CASE_SCOPES.WRITE], purposes: IMPORT_PURPOSES });
      const service = createPrivateCaseAccessService({ rootDir: providers.rootDir, heldRootDir: providers.rootDir, authorizationProvider: grant.authorizationProvider,
        keyProvider: providers.keyProvider, allowDevelopmentFileProvider: true });
      let result;
      try { result = await importJournalCopy({ caseAccessService: service, caseId: client.case_id, corpusId: journalCopyCorpusId(bundle), authContext: grant.authContext, bundle }); }
      catch (error) { throw new StartError(`The copy wasn't imported (${error?.code ?? "failed"}); the sealed file was left where it is.`); }
      // A new copy's earlier receipt first, then the list, then the file: a failure at any point leaves the journal closed, never
      // open on a copy no cold test passed.
      if (client.journal.corpus_id !== result.corpus_id) await fsp.rm(path.join(clientJournalFolder(resolved, client.case_id), COLD_TEST_RECEIPT_FILE), { force: true });
      client.journal = { ...client.journal, corpus_id: result.corpus_id, source_sha256: sourceDigest };
      try { await writeRunnerClients(resolved, list); }
      catch (error) { throw new StartError(`The client list couldn't be written: ${error.message}`); }
      await fsp.rm(source, { force: true });
      return { number, corpus_id: result.corpus_id, passages_verified: result.passages_verified, records_verified: result.records_verified };
    } finally {
      await writerLock?.release();
      providers.close();
    }
  }, { waitMs: lockWaitMs });
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
  catch (error) { throw new StartError(`The questions file isn't valid (${error?.code ?? "not JSON"}).`); }
}

// The cold test's consumer: the trial's whole-reply checker worker for that provider, as the trial makes it (sealed, signed in).
function coldWorker(provider, environment) {
  if (!["claude", "codex"].includes(provider)) throw new StartError("Choose the cold test's worker: --provider claude or codex.");
  const claudeConfigDir = provider === "claude" ? (environment[RUNNER_CLAUDE_CONFIG_DIR]?.trim() || defaultClaudeConfigDir()) : null;
  if (claudeConfigDir !== null && !path.isAbsolute(claudeConfigDir)) throw new StartError(`${RUNNER_CLAUDE_CONFIG_DIR} must be an absolute path.`);
  return createRunnerWorkerFactory({ ...trialSettings(provider), claudeConfigDir },
    { environment, claudeCommand: environment.CLAUDE_COMMAND || "claude", codexCommand: environment.CODEX_COMMAND || "codex" })("CW");
}

// --cold-test: the copy's cold test (src/runner-trial/journal-cold-test.mjs). The client's consent and copy are read again before
// every packet leaves and before the receipt is written, so a withdrawal, a new copy or a deleted case stops it. The latest test that
// ends decides: a pass writes the copy's receipt, anything less removes it, an answer outside the answer's rules included. One stopped
// by an error (a failed call, a key quote that doesn't fit, a withdrawal) decides nothing. `port` replaces the signed-in worker in tests.
export async function runClientColdTest({ home, number, questionsPath, provider = null, port = null, environment = process.env, now = () => new Date(), lockWaitMs = COMMAND_LOCK_WAIT_MS }) {
  const resolved = checkTrialHome(home);
  await requireReady(resolved);
  const questions = await readQuestionsFile(questionsPath);
  const { client } = await clientByNumber(resolved, number);
  const corpusId = client.journal?.corpus_id ?? null;
  if (journalConsentState(client) !== "confirmed") {
    throw new StartError(`Client ${number} has no confirmed journal consent. The cold test sends excerpts of their journal to the company running its worker, so it runs only with their consent (runner-trial-start.mjs --journal-consent confirm).`);
  }
  if (!corpusId) throw new StartError(`Client ${number} has no journal copy here yet: import it with --import.`);
  const stillSo = async () => {
    const current = (await readClientList(resolved)).clients.find((entry) => entry.case_id === client.case_id);
    if (!current || journalConsentState(current) !== "confirmed" || current.journal?.corpus_id !== corpusId) {
      throw new StartError("The client's consent or copy changed during the cold test; no receipt was recorded.");
    }
  };
  const consumer = port ?? createSealedColdConsumerPort({ worker: coldWorker(provider, environment), beforeSend: stillSo });
  const providers = await loadDevelopmentPrivateCaseProviders(path.join(resolved, "credentials.json"));
  try {
    const grant = oneTimeGrant(client.case_id, { scopes: [PRIVATE_CASE_SCOPES.READ], purposes: [PRIVATE_JOURNAL_PURPOSES.SESSION_USE] });
    const service = createPrivateCaseAccessService({ rootDir: providers.rootDir, authorizationProvider: grant.authorizationProvider, keyProvider: providers.keyProvider, allowDevelopmentFileProvider: true });
    const result = await runJournalColdTest({ service, auth: grant.authContext, caseId: client.case_id, corpusId, questions, port: consumer, now });
    const receiptPath = path.join(clientJournalFolder(resolved, client.case_id), COLD_TEST_RECEIPT_FILE);
    await withTrialFolderLock(resolved, async () => {
      if (!result.passed) {
        // A copy that doesn't pass its latest test keeps no receipt (one naming another copy is the import's to drop).
        if ((await readColdTestReceipt(resolved, client.case_id))?.corpus_id === corpusId) await fsp.rm(receiptPath, { force: true });
        return;
      }
      await stillSo();
      await privateFolder(clientJournalFolder(resolved, client.case_id), "The client's journal folder");
      await writePrivateFile(receiptPath, `${JSON.stringify(result.receipt, null, 2)}\n`);
    }, { waitMs: lockWaitMs });
    return { passed: result.passed, report: result.report };
  } finally {
    providers.close();
  }
}

async function askClientNumber(resolved, command) {
  const { clients } = await readClientList(resolved);
  if (!clients.length) throw new StartError("There are no clients yet: add one with runner-trial-start.mjs --add-client.");
  console.log("Clients (their labels are on the runner page, beside the same numbers):");
  clients.forEach((client, index) => console.log(`  ${index + 1}. added ${client.added_at.slice(0, 10)}, journal consent: ${journalConsentState(client)}, ${client.journal?.corpus_id ? "a copy here" : "no copy here"}`));
  const question = { "copy-key": "Number of the client whose journal is to be copied: ", import: "Number of the client whose journal copy this is: ", "cold-test": "Number of the client whose copy to test: " }[command];
  const answer = (await ask(question)).trim();
  if (!/^[1-9][0-9]{0,2}$/u.test(answer)) throw new StartError("That isn't a client's number; nothing was changed.");
  return Number(answer);
}

async function main(argv) {
  const options = parseJournalArguments(argv);
  const home = checkTrialHome(options.dir ?? defaultTrialHome());
  const number = await askClientNumber(home, options.command);
  if (options.command === "copy-key") {
    const { publicKey, made } = await ensureJournalCopyKey({ home, number });
    console.log(`${made ? `Made client ${number}'s key for journal copies.` : `Client ${number} already has a key for journal copies.`} Its public half, for runner_trial_export.recipient_public_key in the private configuration that exports their journal:`);
    console.log(publicKey);
    return 0;
  }
  if (options.command === "import") {
    const result = await importClientJournal({ home, number, sealedPath: options.file });
    console.log(`Imported client ${number}'s journal copy into their runner case: ${result.passages_verified} quotations and ${result.records_verified} records checked against the export. Its cold test comes next (--cold-test); until one passes, no reply uses it.`);
    return 0;
  }
  const result = await runClientColdTest({ home, number, questionsPath: options.file, provider: options.provider });
  console.log(JSON.stringify(result.report, null, 2));
  console.log(result.passed
    ? `Passed: client ${number}'s copy has its cold-test receipt, so their sessions can use their journal while their consent holds (a consent confirmed after the trial started holds from its next start).`
    : `Not passed: client ${number}'s copy keeps no cold-test receipt, so their journal stays out of their sessions.`);
  return result.passed ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (error) => {
      if (error instanceof StartError) {
        console.error(error.message);
        process.exitCode = error.exitCode;
      } else {
        console.error(`The journal command failed: ${error?.code ?? error?.message ?? error}`);
        process.exitCode = 1;
      }
    }
  );
}
