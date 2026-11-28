import fsp from "node:fs/promises";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { RuntimeError, ValidationError } from "../core/errors.mjs";
import {
  JOURNAL_CONSENT_WORDS_VERSION,
  MAX_RUNNER_CLIENTS,
  journalConsentCurrent,
  readRunnerClients,
  runnerListEntry,
  syncFolder,
  tabConsentState,
  validateClientLabel,
  writeRunnerClients
} from "./clients.mjs";

// Adding a client and recording a consent, one function each for the start script's commands and the trial's page
// (docs/superpowers/specs/2026-11-26-runner-journal-upload-and-tab-design.md, 4.2 and 4.3). Every function here that changes the trial
// folder expects its caller to hold the folder's lock (src/runner-trial/folder-lock.mjs). A label goes into clients.json alone: no message
// here repeats it.

export const RUNNER_TRIAL_PRINCIPAL = "runner-trial-local-owner";
export const CREDENTIALS_FILE = "credentials.json";

const fail = (code, message) => new RuntimeError(message, { code });

export const newCaseKeys = () => ({ routine_kek_base64: randomBytes(32).toString("base64"), recovery_secret_base64: randomBytes(32).toString("base64") });
export const validCaseKeys = (keys) => Boolean(keys) && typeof keys === "object" && typeof keys.routine_kek_base64 === "string" && typeof keys.recovery_secret_base64 === "string";

// Writes a file only its owner can read (mode 0600) whole or not at all: a new file beside it, synced, then renamed over it, and the
// folder synced, so a power cut can't keep a newer client list beside older credentials.
export async function writePrivateTrialFile(file, text) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await fsp.open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(text, "utf8");
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => {});
    await fsp.rm(temporary, { force: true });
    throw error;
  }
  await handle.close();
  try { await fsp.rename(temporary, file); } catch (error) {
    await fsp.rm(temporary, { force: true });
    throw error;
  }
  await syncFolder(path.dirname(file));
}

// The trial's credentials as the start script makes them (docs/PRIVATE-CASE-CONTINUITY.md): the owner's own case's grant first, every
// case's keys made once and never changed. Null when the file isn't there; a file the script didn't make is refused and left as it is.
export async function readTrialCredentials(file, vault) {
  let info;
  try { info = await fsp.lstat(file); } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  if (!info.isFile()) throw fail("RUNNER_CREDENTIALS_INVALID", `${file} must be a file, not a link or a folder.`);
  if ((info.mode & 0o077) !== 0) throw fail("RUNNER_CREDENTIALS_INVALID", `${file} can be read by others (it must be mode 0600); it was left as it is.`);
  let value;
  try { value = JSON.parse(await fsp.readFile(file, "utf8")); } catch { throw fail("RUNNER_CREDENTIALS_INVALID", `${file} isn't valid JSON; it was left as it is.`); }
  const grant = Array.isArray(value?.grants) && value.grants.length >= 1 ? value.grants[0] : null;
  const caseId = Array.isArray(grant?.case_ids) && grant.case_ids.length === 1 ? grant.case_ids[0] : null;
  const keys = typeof caseId === "string" && value?.case_keys && typeof value.case_keys === "object" && !Array.isArray(value.case_keys) ? value.case_keys[caseId] : null;
  if (value?.schema_version !== 1 || grant?.principal_id !== RUNNER_TRIAL_PRINCIPAL || typeof caseId !== "string" || !validCaseKeys(keys)
    || Object.values(value.case_keys).some((entry) => !validCaseKeys(entry))) {
    throw fail("RUNNER_CREDENTIALS_INVALID", `${file} wasn't made by this script; it was left as it is. Use another --dir for the trial.`);
  }
  if (value.root_dir !== vault) throw fail("RUNNER_CREDENTIALS_INVALID", `${file} names another vault folder; it was left as it is. Start with the --dir it was made for.`);
  return value;
}

const notReady = (trialDir) => fail("RUNNER_TRIAL_NOT_READY", `The trial folder ${trialDir} isn't ready: start the trial once (or use --prepare-only) before adding a client.`);

// A client added (design, 4.2): a case with keys of its own, made from random bytes and never changed, and the owner's label for them.
// The keys first, then the list: a list that names a case always has its keys, and keys that no list names open nothing. Labels are
// compared without regard to case. A running server has neither the keys nor a grant for the new case until its next start.
export async function addRunnerClientLocked({ trialDir, label, now = () => new Date() }) {
  const vault = path.join(trialDir, "vault");
  const credentialsPath = path.join(trialDir, CREDENTIALS_FILE);
  const credentials = await readTrialCredentials(credentialsPath, vault);
  if (credentials === null) throw notReady(trialDir);
  let checked;
  try { checked = validateClientLabel(label); } catch (error) { throw new ValidationError(error.message); }
  const list = await readRunnerClients(trialDir);
  if (list.clients.length >= MAX_RUNNER_CLIENTS) throw fail("RUNNER_CLIENTS_FULL", `The client list holds at most ${MAX_RUNNER_CLIENTS} clients.`);
  if (list.clients.some((client) => client.label.toLocaleLowerCase("en") === checked.toLocaleLowerCase("en"))) throw fail("RUNNER_CLIENT_LABEL_TAKEN", "Another client already has that label; choose another.");
  let caseId;
  do { caseId = `case-${randomUUID()}`; } while (Object.hasOwn(credentials.case_keys, caseId) || caseId === list.own_journal?.case_id);
  credentials.case_keys[caseId] = newCaseKeys();
  await writePrivateTrialFile(credentialsPath, `${JSON.stringify(credentials, null, 2)}\n`);
  const added = { case_id: caseId, label: checked, added_at: now().toISOString(), journal: { corpus_id: null, consent: null, tab_consent: null } };
  try { await writeRunnerClients(trialDir, { ...list, clients: [...list.clients, added] }); }
  catch (error) { throw fail("RUNNER_CLIENTS_UNWRITTEN", `The client list couldn't be written: ${error.message}`); }
  return { number: list.clients.length + 1, caseId };
}

export const CONSENT_PARTS = Object.freeze(["journal", "tab"]);
export const CONSENT_ACTIONS = Object.freeze(["confirm", "withdraw"]);

// A consent recorded or withdrawn (design, 4.3), for a client on the list or for the owner's own case (`ownCaseId`, whose journal consent
// has no tab consent beside it). `parts` names the journal consent, the Journal-tab consent or both, in that order. A confirmation of the
// journal consent names the version of the words that were read out, which must be the current one: it records a new confirmation over a
// standing one in version 1's words ("Ask again in the new words") and changes nothing over a standing one in version 2's. The tab consent
// is recorded only while the journal consent stands (after this request's own part), and counts only while both do; a withdrawal of the
// journal consent leaves the tab consent's record as it is. A withdrawal of what doesn't stand changes nothing. One write for the request,
// with the time. Returns whether anything changed and the person's entry as recorded.
export async function recordRunnerConsentLocked({ trialDir, ownCaseId = null, caseId, action, parts, words = null, now = () => new Date() }) {
  if (!CONSENT_ACTIONS.includes(action)) throw new ValidationError("A consent is confirmed or withdrawn.");
  if (!Array.isArray(parts) || parts.length < 1 || parts.length > 2 || parts.some((part) => !CONSENT_PARTS.includes(part)) || new Set(parts).size !== parts.length) {
    throw new ValidationError("A consent's parts are the journal and the Journal tab.");
  }
  const list = await readRunnerClients(trialDir);
  const found = runnerListEntry(list, caseId, { ownCaseId });
  if (!found) throw fail("RUNNER_CASE_UNKNOWN", "This case isn't one of the runner trial's cases.");
  if (found.kind === "own" && parts.includes("tab")) throw new ValidationError("Your own journal has no Journal-tab consent.");
  if (action === "confirm" && parts.includes("journal") && words !== JOURNAL_CONSENT_WORDS_VERSION) {
    throw fail("RUNNER_CONSENT_WORDS_OUTDATED", "These aren't the consent's current words: reload the page and read them out again.");
  }
  const journal = { ...found.entry.journal };
  const at = now().toISOString();
  let changed = false;
  for (const part of [...parts].sort((a, b) => CONSENT_PARTS.indexOf(a) - CONSENT_PARTS.indexOf(b))) {
    const field = part === "journal" ? "consent" : "tab_consent";
    const record = journal[field] ?? null;
    const stands = record !== null && record.withdrawn_at === null;
    if (action === "withdraw") {
      if (!stands) continue;
      journal[field] = { ...record, withdrawn_at: at };
    } else if (part === "journal") {
      if (journalConsentCurrent({ journal }, { words: JOURNAL_CONSENT_WORDS_VERSION })) continue;
      journal.consent = { confirmed_at: at, withdrawn_at: null, words: JOURNAL_CONSENT_WORDS_VERSION };
    } else {
      if (!journalConsentCurrent({ journal })) throw fail("RUNNER_TAB_CONSENT_NEEDS_JOURNAL", "The Journal-tab consent can be recorded only while the journal consent stands.");
      if (tabConsentState({ journal }) === "confirmed") continue;
      journal.tab_consent = { confirmed_at: at, withdrawn_at: null };
    }
    changed = true;
  }
  if (!changed) return { changed, kind: found.kind, entry: found.entry };
  if (found.kind === "own") list.own_journal = { case_id: caseId, ...journal };
  else found.entry.journal = journal;
  try { await writeRunnerClients(trialDir, list); }
  catch (error) { throw fail("RUNNER_CLIENTS_UNWRITTEN", `The client list couldn't be written: ${error.message}`); }
  return { changed, kind: found.kind, entry: { case_id: caseId, journal } };
}
