import { RuntimeError, ValidationError } from "../core/errors.mjs";
import { loadRunnerRules, runnerTrialDirectory } from "./released-rules.mjs";
import { createRunnerLogWriter, runnerLogFromRecord } from "./run-log.mjs";
import { createPrivateTherapyTurnController } from "../supervisor/private-therapy-turn-controller.mjs";
import { cutRuleParts } from "./rule-parts.mjs";
import { createRunnerTrialRuntime } from "./runtime.mjs";
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
export function createRunnerTrialController({ privateCaseSource, config = {}, settings = null, parts = null, workerFor = null, events = null, now = undefined } = {}) {
  if (!privateCaseSource) {
    throw new RuntimeError(`${RUNNER_TRIAL_SETTING} is on, but encrypted private case storage isn't configured: the runner trial needs a vault of its own.`, { code: "BAD_CONFIG" });
  }
  const hub = events ?? createRunnerEventHub();
  if (!isRunnerEventHub(hub)) throw new ValidationError("The runner trial needs an event hub.");
  const trialSettings = settings ?? loadRunnerTrialSettings({ settingsPath: config.runnerTrialSettingsPath ?? null, claudeConfigDir: config.runnerClaudeConfigDir ?? null });
  const rules = loadRunnerRules(config);
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
    onEvent: hub.publish,
    now
  });
  // The runtime retries each worker itself (never after a plan limit, a lapsed sign-in or a refusal), so the controller tries once.
  const controller = createPrivateTherapyTurnController({ privateCaseSource, modelRuntime: runtime, maximumInvocationAttempts: 1 });
  const loadExisting = async (caseId, authContext) => {
    try {
      return await (typeof privateCaseSource.loadPrivateRuntimeCase === "function" ? privateCaseSource.loadPrivateRuntimeCase(caseId, authContext) : privateCaseSource.load(caseId));
    } catch (error) { if (error?.code === "PRIVATE_CASE_NOT_FOUND") return null; throw error; }
  };
  const logWriter = createRunnerLogWriter({ directory: runnerTrialDirectory(config), runnerRules: rules.runnerRules, arrangement: runnerArrangement(trialSettings), loadRecord: loadExisting });
  const loggedController = Object.freeze({
    ...controller,
    async run(input) {
      try { return await controller.run(input); }
      finally { logWriter.schedule(input.caseId, input.authContext); }
    },
    async reconcile(input) {
      try { return await controller.reconcile(input); }
      finally { logWriter.schedule(input.caseId, input.authContext); }
    },
    async deleteCase(input) {
      const result = await controller.deleteCase(input);
      await logWriter.remove();
      return result;
    },
    async runLog({ caseId, authContext }) { return runnerLogFromRecord(await loadExisting(caseId, authContext)); },
    startRunLog(authContext) { if (config.runnerTrialCaseId) logWriter.schedule(config.runnerTrialCaseId, authContext); }
  });
  return Object.freeze({ controller: loggedController, events: hub, runtime, settings: trialSettings, runnerRules: rules.runnerRules, logWriter });
}
