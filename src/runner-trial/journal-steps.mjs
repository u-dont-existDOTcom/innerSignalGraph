import { randomBytes } from "node:crypto";
import { RuntimeError, ValidationError } from "../core/errors.mjs";
import { PRIVATE_CASE_SCOPES, PRIVATE_JOURNAL_PURPOSES } from "../storage/private-case-access.mjs";
import { readRunnerClients, runnerPeopleView } from "./clients.mjs";
import { withTrialFolderLock } from "./folder-lock.mjs";
import { addRunnerClientLocked, recordRunnerConsentLocked } from "./people.mjs";

// The journal steps' service in the trial's server (docs/superpowers/specs/2026-11-26-runner-journal-upload-and-tab-design.md, 4.1),
// built by the trial controller. Decisions it holds, for every step that comes to it:
// - The lock order: a step that changes a case's record runs inside that case's queue (the turn controller's, as Delete's), and one that
//   also needs the trial folder's lock takes it inside the queue, never the other way round (`inQueue`).
// - The folder's lock is waited for ten seconds at most, then the page is told the runner is busy (`RUNNER_FOLDER_BUSY`).
// - Delete wins (`stopForDeletion`): while a case is being deleted no journal work of it is admitted; its deletion count rises, and every
//   piece of journal work admitted before stops at its next check (`check`, made inside the queue, under the lock, and by later stages
//   before each batch of object writes and each call); the work it tracks (`track`) is stopped and waited for before Delete takes the
//   case's queue, since a copy's own last step needs that queue.
// - A step writes to the vault under a grant made in the process for that step and that case alone (`journalStepGrant`).
// Stage 1 of the build (docs/superpowers/plans/2026-11-28-runner-journal-steps.md) brings people and consent; previews, the reading, the
// copy and the test come with later stages and use the same machinery. Tests: tests/runner-journal-steps.test.mjs.

export const JOURNAL_STEP_LOCK_WAIT_MS = 10_000;

// A grant made in this process for one step and one case alone, with a random token only this process knows. Nothing of it is written.
// The command's import and cold test use it as well (scripts/runner-trial-journal.mjs).
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

// What the store asks of each step's grant: a copy and its checks read and write with the import's purposes; a tombstone writes with
// `delete`.
export const JOURNAL_STEP_GRANTS = Object.freeze({
  copy: Object.freeze({ scopes: Object.freeze([PRIVATE_CASE_SCOPES.READ, PRIVATE_CASE_SCOPES.WRITE]),
    purposes: Object.freeze([PRIVATE_JOURNAL_PURPOSES.ARCHIVE, PRIVATE_JOURNAL_PURPOSES.ORGANIZE_SEARCH, PRIVATE_JOURNAL_PURPOSES.SESSION_USE]) }),
  tombstone: Object.freeze({ scopes: Object.freeze([PRIVATE_CASE_SCOPES.WRITE]), purposes: Object.freeze([PRIVATE_JOURNAL_PURPOSES.DELETE]) })
});

export function journalStepGrant(caseId, step) {
  if (!Object.hasOwn(JOURNAL_STEP_GRANTS, step)) throw new ValidationError("This isn't a journal step that writes to the vault.");
  return oneTimeGrant(caseId, JOURNAL_STEP_GRANTS[step]);
}

// Fixed words, never a case's, for what the page is told.
export const JOURNAL_STEP_WORDS = Object.freeze({
  RUNNER_FOLDER_BUSY: "The runner is busy with another change: try again in a moment.",
  RUNNER_JOURNAL_CASE_DELETING: "This case is being deleted.",
  RUNNER_JOURNAL_CASE_DELETED: "This case was deleted meanwhile: nothing more of it is written."
});
const stepError = (code) => new RuntimeError(JOURNAL_STEP_WORDS[code], { code });

export function createRunnerJournalSteps({ trialDir, ownCaseId = null, grantedCaseIds = [], inCaseQueue, lockWaitMs = JOURNAL_STEP_LOCK_WAIT_MS, now = () => new Date() } = {}) {
  if (typeof trialDir !== "string" || !trialDir) throw new ValidationError("The journal steps need the trial folder.");
  if (typeof inCaseQueue !== "function") throw new ValidationError("The journal steps need the case's queue.");
  const granted = Object.freeze([...grantedCaseIds]);
  // Each case's deletion mark (how many deletions of it are under way), its deletion count, and the journal work it runs now.
  const cases = new Map();
  const of = (caseId) => {
    if (!cases.has(caseId)) cases.set(caseId, { deleting: 0, count: 0, work: new Set() });
    return cases.get(caseId);
  };

  // The trial folder's lock for one change, waited for up to ten seconds; one still held then is told as the runner being busy. A lock
  // left by a command that ended without finishing is told as it is, for the owner to remove.
  async function underLock(operation) {
    try { return await withTrialFolderLock(trialDir, operation, { waitMs: lockWaitMs }); }
    catch (error) { throw error?.code === "RUNNER_FOLDER_LOCKED" ? stepError("RUNNER_FOLDER_BUSY") : error; }
  }

  // A piece of journal work is admitted only while its case isn't being deleted, and carries the case's deletion count from then on.
  function admit(caseId) {
    if (of(caseId).deleting > 0) throw stepError("RUNNER_JOURNAL_CASE_DELETING");
    return Object.freeze({ caseId, count: of(caseId).count });
  }
  const current = (ticket) => of(ticket.caseId).deleting === 0 && of(ticket.caseId).count === ticket.count;
  function check(ticket) {
    if (!current(ticket)) throw stepError("RUNNER_JOURNAL_CASE_DELETED");
  }

  // Runs a piece of journal work, known to Delete until it ends however it ends: Delete calls `stop` and waits for it.
  async function track(ticket, operation, { stop = () => {} } = {}) {
    check(ticket);
    const entry = of(ticket.caseId);
    let settle;
    const work = { stop, settled: new Promise((resolve) => { settle = resolve; }) };
    entry.work.add(work);
    try { return await operation(); }
    finally {
      entry.work.delete(work);
      settle();
    }
  }

  // A step inside the case's queue and, with `lock`, then under the folder's lock; the deletion count is checked in each.
  function inQueue(ticket, operation, { lock = false } = {}) {
    return inCaseQueue(ticket.caseId, async () => {
      check(ticket);
      if (!lock) return operation();
      return underLock(async () => {
        check(ticket);
        return operation();
      });
    });
  }

  // Delete wins (design, 4.1 and 4.10): called by Delete before it takes the case's queue. Returns what lets the mark go once the deletion
  // is over, however it ended.
  async function stopForDeletion(caseId) {
    const entry = of(caseId);
    entry.deleting += 1;
    entry.count += 1;
    const running = [...entry.work];
    for (const work of running) {
      try { work.stop(); } catch { /* a stop that fails leaves the work to its next check */ }
    }
    await Promise.all(running.map((work) => work.settled));
    let released = false;
    return () => {
      if (released) return;
      released = true;
      entry.deleting -= 1;
    };
  }

  return Object.freeze({
    admit,
    check,
    current,
    track,
    inQueue,
    underLock,
    stopForDeletion,
    deleting: (caseId) => of(caseId).deleting > 0,
    // What the People tab shows, read from the list now (design, section 2).
    async people() {
      return runnerPeopleView({ ownCaseId, list: await readRunnerClients(trialDir), grantedCaseIds: granted });
    },
    // 4.2: under the folder's lock alone, as the command does (a new client has no case yet, so no queue).
    addClient({ label } = {}) {
      return underLock(() => addRunnerClientLocked({ trialDir, label, now }));
    },
    // 4.3: the list changes under the folder's lock alone: the gate reads the consents at every retrieval and before every output.
    recordConsent({ caseId, action, parts, words = null } = {}) {
      return underLock(() => recordRunnerConsentLocked({ trialDir, ownCaseId, caseId, action, parts, words, now }));
    }
  });
}
