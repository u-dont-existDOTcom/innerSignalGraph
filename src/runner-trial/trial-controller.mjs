import { RuntimeError, ValidationError } from "../core/errors.mjs";
import { loadRunnerRules, runnerTrialDirectory } from "./released-rules.mjs";
import { RUNNER_LOG_FILE, createRunnerLogWriter, runnerClientLogFile, runnerLogFromRecord } from "./run-log.mjs";
import { forgetClientCopy, removeClientJournalFolder } from "./clients.mjs";
import { acquireTrialFolderLock, releaseAfterFailure } from "./folder-lock.mjs";
import { runnerTurnDetailsFromRecord } from "./turn-details.mjs";
import { createPrivateTherapyTurnController } from "../supervisor/private-therapy-turn-controller.mjs";
import { cutRuleParts } from "./rule-parts.mjs";
import { DEFAULT_RUNNER_SETTINGS, createRunnerTrialRuntime } from "./runtime.mjs";
import { createRunnerJournalGate } from "./journal-gate.mjs";
import { RUNNER_TRIAL_SETTING, createRunnerWorkerFactory, loadRunnerTrialSettings, runnerArrangement } from "./settings.mjs";

// What the server builds when INNER_SIGNAL_RUNNER_TRIAL is on (docs/superpowers/specs/2026-11-21-runner-trial-design.md, sections
// 8 and 11): the turn controller over the trial's runtime, and the hub that carries the runtime's events to the page's stream.

// The events the page may see, each with only its own fields: the step being worked on, the provisional reply, that the
// emergency line was put into the conversation, and that the turn was closed without a reply.
const EVENT_FIELDS = Object.freeze({
  status: Object.freeze(["step"]),
  provisional: Object.freeze(["text"]),
  emergency_line: Object.freeze(["reason"]),
  closed: Object.freeze(["kind", "reason"])
});

export function runnerEventLine(event) {
  if (!event || typeof event !== "object" || !Object.hasOwn(EVENT_FIELDS, event.type)) return null;
  const line = { type: event.type };
  for (const field of EVENT_FIELDS[event.type]) if (typeof event[field] === "string") line[field] = event[field];
  return line;
}

// How long a client's deletion waits for the trial folder's lock, as the commands do.
const DELETE_LOCK_WAIT_MS = 10_000;

// A deletion's steps after the vault's, whose case is gone by then: each is tried whatever became of the others, and one that fails is
// named by its code, never raised. The result carries the codes (`cleanup_left`) when there are any.
async function clearOrName(left, code, step) {
  try { await step(); } catch { left.push(code); }
}
const withCleanupLeft = (deleted, left) => (left.length ? Object.freeze({ ...deleted, cleanup_left: Object.freeze([...(deleted?.cleanup_left ?? []), ...left]) }) : deleted);

// Keyed by case id and runtime turn id together: the page chooses its turn id, so two cases may use the same one, and a case's
// events must never reach another case's stream. Nothing is kept: an event with no listener is dropped, and a listener that
// throws never stops a turn.
const hubKey = (caseId, runtimeTurnId) => (typeof caseId === "string" && caseId && typeof runtimeTurnId === "string" && runtimeTurnId ? JSON.stringify([caseId, runtimeTurnId]) : null);

export function createRunnerEventHub() {
  const listeners = new Map();
  return Object.freeze({
    publish(caseId, runtimeTurnId, event) {
      const current = listeners.get(hubKey(caseId, runtimeTurnId));
      if (!current) return;
      for (const listener of [...current]) {
        try { listener(event); } catch { /* a page's stream never stops a turn */ }
      }
    },
    subscribe(caseId, runtimeTurnId, listener) {
      const key = hubKey(caseId, runtimeTurnId);
      if (!key || typeof listener !== "function") throw new ValidationError("A runner event listener needs a case id, a runtime turn id and a function.");
      let current = listeners.get(key);
      if (!current) {
        current = new Set();
        listeners.set(key, current);
      }
      current.add(listener);
      return () => {
        current.delete(listener);
        if (current.size === 0 && listeners.get(key) === current) listeners.delete(key);
      };
    },
    listenerCount(caseId, runtimeTurnId) {
      return listeners.get(hubKey(caseId, runtimeTurnId))?.size ?? 0;
    }
  });
}

export function isRunnerEventHub(value) {
  return Boolean(value) && typeof value.publish === "function" && typeof value.subscribe === "function";
}

// The trial's controller. Rule parts are cut once, here, from the served protocol; settings come from the environment through
// loadConfig unless given. `workerFor`, `parts`, `settings` and `now` are for tests, which use stand-in workers. The plan kept for
// next time is on only when INNER_SIGNAL_RUNNER_KEPT_PLAN is (config.runnerKeptPlanEnabled; design, section 9), the crisis
// reader's number_now only when INNER_SIGNAL_RUNNER_NUMBER_NOW is (config.runnerNumberNowEnabled; design, section 9b), and the
// owner's fixed message after the plan's limit, a lapsed sign-in or the time only when INNER_SIGNAL_RUNNER_FIXED_MESSAGE_ON_FAILURE
// is (config.runnerFixedMessageOnFailureEnabled; design, section 7), with INNER_SIGNAL_OWNER_FALLBACK on too, and after every other
// failure as well only when INNER_SIGNAL_RUNNER_FIXED_MESSAGE_ON_ANY_FAILURE is too (config.runnerFixedMessageOnAnyFailureEnabled).
// `clientCaseIds`: the clients' cases the start script gave a grant (the design for clients, point 2); each has its own run log file
// and journal folder, which "Delete this case" removes with the case.
export function createRunnerTrialController({ privateCaseSource, config = {}, clientCaseIds = [], settings = null, parts = null, workerFor = null, events = null, now = undefined } = {}) {
  if (!privateCaseSource) {
    throw new RuntimeError(`${RUNNER_TRIAL_SETTING} is on, but encrypted private case storage isn't configured: the runner trial needs a vault of its own.`, { code: "BAD_CONFIG" });
  }
  const hub = events ?? createRunnerEventHub();
  if (!isRunnerEventHub(hub)) throw new ValidationError("The runner trial needs an event hub.");
  const trialSettings = settings ?? loadRunnerTrialSettings({ settingsPath: config.runnerTrialSettingsPath ?? null, claudeConfigDir: config.runnerClaudeConfigDir ?? null });
  const rules = loadRunnerRules(config);
  const runnerConfig = { rules: rules.runnerRules, arrangement: runnerArrangement(trialSettings) };
  // Response evidence for the trial (INNER_SIGNAL_RESPONSE_EVIDENCE, --response-evidence; pull request 241 and the design for clients,
  // point 6): every turn is checked against the sources it rests on, by the whole checker. With clients, their journals reach a turn
  // only through the journal gate (consent, a published session_use copy, a matching cold-test receipt). Off, nothing changes.
  const evidenceOn = config.responseEvidenceEnforced === true;
  if (evidenceOn && (trialSettings.runtime?.checkerMode ?? DEFAULT_RUNNER_SETTINGS.checkerMode) !== "whole") {
    throw new RuntimeError("Response evidence in the runner trial needs the whole checker (checkerMode whole), which reviews each reply against its sources.", { code: "BAD_CONFIG" });
  }
  const trialDirectory = runnerTrialDirectory(config);
  const clientCases = new Set(clientCaseIds);
  // The gate exists whenever there are clients, so a case that read its journal stops when the gate closes even with response
  // evidence off; the reader is attached only with it on.
  const journalGate = clientCases.size > 0 && trialDirectory && typeof privateCaseSource.inspectJournalCorpus === "function"
    ? createRunnerJournalGate({ trialDir: trialDirectory, caseAccessService: privateCaseSource })
    : null;
  const runtime = createRunnerTrialRuntime({
    privateCaseSource,
    parts: parts ?? cutRuleParts(rules.protocol),
    workerSettings: trialSettings.workers,
    settings: trialSettings.runtime,
    workerFor: workerFor ?? createRunnerWorkerFactory(trialSettings, { claudeCommand: config.claudeCommand ?? "claude", codexCommand: config.codexCommand ?? "codex" }),
    ownerFallbackEnabled: config.ownerFallbackEnabled === true,
    keptPlanEnabled: config.runnerKeptPlanEnabled === true,
    numberNowEnabled: config.runnerNumberNowEnabled === true,
    fixedMessageOnFailureEnabled: config.runnerFixedMessageOnFailureEnabled === true,
    fixedMessageOnAnyFailureEnabled: config.runnerFixedMessageOnAnyFailureEnabled === true,
    journalGate,
    trialDir: trialDirectory,
    onEvent: hub.publish,
    now
  });
  const loadExisting = async (caseId, authContext) => {
    try {
      return await (typeof privateCaseSource.loadPrivateRuntimeCase === "function" ? privateCaseSource.loadPrivateRuntimeCase(caseId, authContext) : privateCaseSource.load(caseId));
    } catch (error) { if (error?.code === "PRIVATE_CASE_NOT_FOUND") return null; throw error; }
  };
  // The vault removes a case's file before its own last steps (what else names the case, then the syncs), so its deletion can fail with the
  // case gone already: that is found by loading the case, never by the error. A case that's gone is deleted, with the vault's own cleanup
  // named among what's left (deleting again finishes it); how much the vault had removed by then isn't known. Short of that certainty
  // (the case is still there, or can't be looked at), and for a caller the vault refused, whose request deleted nothing, the error stands.
  const goneAllTheSame = async (error, caseId, authContext) => {
    if (error?.code === "PRIVATE_CASE_ACCESS_DENIED") return false;
    try { return await loadExisting(caseId, authContext) === null; } catch { return false; }
  };
  const deleteFromVault = async (caseId, ...rest) => {
    try { return await privateCaseSource.deletePrivateCase(caseId, ...rest); } catch (error) {
      if (!(await goneAllTheSame(error, caseId, ...rest))) throw error;
      return withCleanupLeft({ case_id: caseId, case_file_removed: true }, ["VAULT_CLEANUP"]);
    }
  };
  // "Delete this case" of a client, once it's its turn in the case's queue: under the trial folder's lock, which every command takes, the
  // case and its journal copies go from the vault; then the client list names neither the copy nor the server case it came from, so a
  // cold test still running stops and another server case can be theirs; and their journal folder goes (their key for journal copies, their
  // copy's cold-test receipt and its test's marker). While the vault hasn't finished (VAULT_CLEANUP: a power cut could bring the case and
  // its copies back), the list keeps the server case, so no other client's copy can come from it; a Delete the vault finishes lets it go.
  // Without the lock nothing is deleted. Once the case is gone from the vault it is deleted, whatever becomes of the rest: what couldn't be
  // cleared is named in the result, and deleting again clears it (the vault's deletion finds nothing of the case any more and goes on). A
  // deletion that fails is told by the vault's own error, which also names the lock when that can't be let go either. The owner's own case
  // has the vault's part alone.
  const deletingSource = Object.create(privateCaseSource, { deletePrivateCase: { value: async (caseId, ...rest) => {
    if (!clientCases.has(caseId) || !trialDirectory) return deleteFromVault(caseId, ...rest);
    const lock = await acquireTrialFolderLock(trialDirectory, { waitMs: DELETE_LOCK_WAIT_MS });
    let deleted;
    try { deleted = await deleteFromVault(caseId, ...rest); } catch (error) {
      await releaseAfterFailure(lock, trialDirectory, error);
      throw error;
    }
    const left = [];
    const keepSource = deleted?.cleanup_left?.includes("VAULT_CLEANUP") === true;
    await clearOrName(left, "JOURNAL_LIST", () => forgetClientCopy(trialDirectory, caseId, { keepSource }));
    await clearOrName(left, "JOURNAL_FOLDER", () => removeClientJournalFolder(trialDirectory, caseId));
    await clearOrName(left, "FOLDER_LOCK", () => lock.release());
    return withCleanupLeft(deleted, left);
  } } });
  // The runtime retries each worker itself (never after a plan limit, a lapsed sign-in or a refusal), so the controller tries once.
  const controller = createPrivateTherapyTurnController({ privateCaseSource: deletingSource, modelRuntime: runtime, runnerConfig, maximumInvocationAttempts: 1,
    ...(evidenceOn ? { responseEvidence: { enforced: true, journalTimeoutMs: 4000 } } : {}), ...(evidenceOn && journalGate ? { journalEvidenceProvider: journalGate } : {}) });
  const logWriters = new Map();
  const logWriterFor = (caseId) => {
    const fileName = clientCases.has(caseId) ? runnerClientLogFile(caseId) : RUNNER_LOG_FILE;
    if (!logWriters.has(fileName)) logWriters.set(fileName, createRunnerLogWriter({ directory: trialDirectory, fileName, runnerRules: runnerConfig.rules, arrangement: runnerConfig.arrangement, loadRecord: loadExisting }));
    return logWriters.get(fileName);
  };
  const logWriter = logWriterFor(config.runnerTrialCaseId ?? null);
  const loggedController = Object.freeze({
    ...controller,
    async run(input) {
      try { return await controller.run(input); }
      finally { logWriterFor(input.caseId).schedule(input.caseId, input.authContext); }
    },
    async reconcile(input) {
      try { return await controller.reconcile(input); }
      finally { logWriterFor(input.caseId).schedule(input.caseId, input.authContext); }
    },
    // What the runtime remembers of the case and its own run log go with it (a client's place on the list and journal folder go in
    // deletingSource above).
    async deleteCase(input) {
      const deleted = await controller.deleteCase(input);
      const left = [];
      await clearOrName(left, "RUNTIME_STATE", () => runtime.forgetCase(input.caseId));
      await clearOrName(left, "RUN_LOG", () => logWriterFor(input.caseId).remove());
      return withCleanupLeft(deleted, left);
    },
    async runLog({ caseId, authContext }) { return runnerLogFromRecord(await loadExisting(caseId, authContext)); },
    async turnDetails({ caseId, turn, authContext }) { return runnerTurnDetailsFromRecord(await loadExisting(caseId, authContext), turn); },
    // At start, each case's log is rewritten from its stored turns: the owner's with the owner's token, each client's with its own.
    startRunLog(authContext, caseAuthContexts = new Map()) {
      if (config.runnerTrialCaseId) logWriter.schedule(config.runnerTrialCaseId, authContext);
      for (const [caseId, context] of caseAuthContexts) if (clientCases.has(caseId)) logWriterFor(caseId).schedule(caseId, context);
    }
  });
  // Every case's log writes queued so far, the owner's and each client's (for a caller that must wait for them, such as a test that
  // then removes the trial folder).
  const flushLogs = async () => { await Promise.all([...logWriters.values()].map((writer) => writer.flush())); };
  return Object.freeze({ controller: loggedController, events: hub, runtime, settings: trialSettings, runnerRules: rules.runnerRules, logWriter, flushLogs });
}
