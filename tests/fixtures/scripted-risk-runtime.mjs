import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../../src/core/config.mjs";
import { diffCaseStates } from "../../src/case-state/longitudinal-state.mjs";
import { createEncryptedPrivateCaseStore } from "../../src/storage/private-case-store.mjs";
import { createPrivateTherapyModelRuntime } from "../../src/supervisor/private-therapy-model-runtime.mjs";
import { createPrivateTherapyTurnController } from "../../src/supervisor/private-therapy-turn-controller.mjs";
import { makeScriptedProviders } from "../../tasks/role-belief-integrity-20260917/scripted-providers.mjs";

// A real private runtime (encrypted store, controller, model runtime, audit loop) driven by scripted providers, for tests of the
// self-directed-risk record and the reply check. Nothing here is a model: the extraction's suicidal_state for each turn, the audit's
// findings and every message are chosen by the test. All wording is an abstract placeholder; it is not client, case or journal
// material, and it describes nothing about how anyone would harm themselves.
const TURNS_PER_PHASE = 10;
const MAXIMUM_TURNS = 100;

// "ideation", { state: "ideation", context: "pain_episode" }, or with other extraction variables for that turn:
// { state: "ideation", variables: { inner_adult_access: "low" } }.
function normalizeReading(reading) {
  if (reading == null) return { state: "absent", context: null, variables: null };
  return typeof reading === "string"
    ? { state: reading, context: null, variables: null }
    : { state: reading.state, context: reading.context ?? null, variables: reading.variables ?? null };
}

export function syntheticMessage(number) {
  return `Synthetic message ${number}.`;
}

// A clock that depends only on the user turn being run and on how many times it has been read during that turn, so a run is
// reproducible byte for byte and a copy of the store that continues from turn N reads the same times the original did.
function turnClock() {
  const state = { turn: 0, ticks: 0 };
  const base = Date.UTC(2026, 10, 1, 0, 0, 0);
  return {
    begin(turn) { state.turn = turn; state.ticks = 0; },
    now() { state.ticks += 1; return new Date(base + state.turn * 3_600_000 + state.ticks * 1_000).toISOString(); }
  };
}

/**
 * @param t node:test context, used to close the store and delete the temporary folder.
 * @param options.readings the extraction's suicidal_state for each turn (string or { state, context, variables }); later turns read "absent".
 * @param options.itemsPerTurn 1, or 6 for four observations and two hypotheses (the busiest ordinary extraction).
 * @param options.auditFindings ({ turn, auditNumber, packet }) => findings for that audit; audit numbers restart at 1 on each turn.
 * @param options.auditFails ({ turn, auditNumber }) => true to make the audit provider itself fail.
 * @param options.onAuditPacket ({ turn, auditNumber, packet }) => void, called with the packet the auditor received.
 * @param options.onPrompt ({ stage, turn, input }) => void or a promise, called (and awaited) for every provider call.
 * @param options.messages the user's text for each turn: an array (the nth turn is messages[n - 1]) or (number) => text. Turns without one read
 *   "Synthetic message N." as before.
 * @param options.reply ({ number, ids }) => text or null, the candidate's answer for that turn in place of the scaffold sentence. null keeps the
 *   scaffold. One paragraph, ending in a statement and not a question: the question is the plan's own and is added after it.
 * @param options.clock true for a clock that depends only on the turn number (reproducible packets, and a copy of the store continues with
 *   the times the original read); a function returning an ISO time; false (the default) for the real clock.
 * @param options.copyStoreFrom a folder holding a copy of an earlier state of this case's store (see snapshot()), and options.startTurn the
 *   number of user turns it holds. Together they open the case at that point; fork() does this.
 * @param options.ownerFallback true to turn the fixed fallback message on (INNER_SIGNAL_OWNER_FALLBACK). Off by default, as it is in production,
 *   and set explicitly in the config so that the environment of whoever runs the tests never decides it.
 * @param options.forcedRoute a route id, or ({ turn }) => route id or null, written to the stored episode's route and active step after the
 *   real pipeline has produced the turn's candidate. For a route the planner does not choose: IC.PRECIOUS_HUMAN_OPPORTUNITY is not the
 *   primary job for any variable set, because the inquiry and adult-seat routes that outrank it are active whenever it is (a test in
 *   owner-fallback-routes.test.mjs checks this, and fails if a graph change makes the route reachable). Everything after that point (the
 *   audit loop, the repairs, the discriminator step, the store) is real. The state diff is recomputed for the changed state. Leave it out to
 *   use the planner's own route.
 */
export async function openScriptedRiskRuntime(t, {
  caseId = "synthetic-risk-runtime",
  readings = [],
  itemsPerTurn = 1,
  maximumTurns = 10,
  auditFindings = () => [],
  auditFails = () => false,
  onAuditPacket = () => {},
  onPrompt = () => {},
  ownerFallback = false,
  forcedRoute = null,
  messages = null,
  reply = null,
  clock = false,
  copyStoreFrom = null,
  startTurn = 0
} = {}) {
  if (![1, 6].includes(itemsPerTurn)) throw new Error("itemsPerTurn must be 1 or 6.");
  if (!Number.isSafeInteger(maximumTurns) || maximumTurns < 1 || maximumTurns > MAXIMUM_TURNS) throw new Error("maximumTurns is out of range.");
  if (!Number.isSafeInteger(startTurn) || startTurn < 0 || startTurn > maximumTurns || (startTurn > 0) !== (copyStoreFrom != null)) throw new Error("startTurn and copyStoreFrom go together.");
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-synthetic-risk-"));
  if (copyStoreFrom != null) await fs.cp(copyStoreFrom, rootDir, { recursive: true });
  const turnTimes = clock === true ? turnClock() : null;
  const store = createEncryptedPrivateCaseStore({
    rootDir,
    routineKek: Buffer.alloc(32, 61),
    recoverySecretBytes: Buffer.alloc(32, 62),
    developmentExternalCredentialAuthorized: true,
    ...(turnTimes ? { now: () => turnTimes.now() } : {}),
    ...(typeof clock === "function" ? { now: clock } : {})
  });
  t.after(async () => {
    store.close();
    await fs.rm(rootDir, { recursive: true, force: true });
  });
  const config = loadConfig({ mode: "mock", ledgerMode: "off", devAutomationEnabled: false, ownerFallbackEnabled: ownerFallback === true });
  const scenario = {
    id: "synthetic-risk-runtime",
    synthetic: true,
    phases: Array.from({ length: Math.ceil(maximumTurns / TURNS_PER_PHASE) }, () => ({ messages: ["Synthetic placeholder."], repeat: TURNS_PER_PHASE }))
  };
  const { providers, counts } = await makeScriptedProviders({ scenario });
  // The scripted providers count the turns they have read; a case opened at turn N has them read N empty extractions first.
  for (let burned = 0; burned < startTurn; burned += 1) await providers.openai.generate({ system: "", user: "", metadata: { stage: "case_extraction" } });
  const messageFor = (number) => (typeof messages === "function" ? messages(number) : messages?.[number - 1]) ?? syntheticMessage(number);

  let turn = startTurn;
  let auditNumber = 0;
  let currentMessage = messageFor(startTurn + 1);
  for (const provider of Object.values(providers)) {
    const generate = provider.generate.bind(provider);
    provider.generate = async (input) => {
      const stage = input.metadata?.fixtureKey ?? input.metadata?.stage;
      if (stage === "case_extraction") { turn += 1; auditNumber = 0; }
      await onPrompt({ stage, turn, input });
      if (stage === "private_candidate_audit" && auditFails({ turn, auditNumber: auditNumber + 1 })) {
        auditNumber += 1;
        throw new Error("Synthetic audit provider failure.");
      }
      const raw = await generate(input);
      if (stage === "case_extraction") {
        const reading = normalizeReading(readings[turn - 1]);
        const value = JSON.parse(raw.text);
        value.variables.suicidal_state = reading.state;
        if (reading.context) value.variables.suicidal_ideation_context = reading.context;
        if (reading.variables) Object.assign(value.variables, reading.variables);
        if (itemsPerTurn === 6) {
          value.direct_observations = Array.from({ length: 4 }, (_unused, index) => ({
            id: `O${index + 1}`,
            statement: `Synthetic observation ${index + 1}.`,
            evidence: currentMessage,
            phenomenology: null
          }));
          value.hypotheses = Array.from({ length: 2 }, (_unused, index) => ({
            id: `H${index + 1}`,
            claim: `Synthetic hypothesis ${index + 1}.`,
            evidence: "Synthetic placeholder evidence.",
            confidence: "low",
            alternatives: ["Synthetic alternative."]
          }));
        }
        return { ...raw, text: JSON.stringify(value) };
      }
      if (stage === "private_candidate_audit") {
        auditNumber += 1;
        const packet = JSON.parse(input.user.split("\n").slice(1).join("\n"));
        onAuditPacket({ turn, auditNumber, packet });
        const value = JSON.parse(raw.text);
        value.findings = auditFindings({ turn, auditNumber, packet }) ?? [];
        return { ...raw, text: JSON.stringify(value) };
      }
      if (stage === "realization" && reply) {
        const value = JSON.parse(raw.text);
        const text = reply({ number: turn, ids: value.realized_nodes.map((node) => node.id) });
        if (typeof text === "string" && text.trim()) {
          // The contract check wants each realized node's evidence quote to be in the answer, so every node quotes the reply's first sentence.
          const quote = text.trim().split(/(?<=[.!])\s/u)[0];
          value.answer = text.trim();
          value.realized_nodes = value.realized_nodes.map((node) => ({ ...node, evidence_quote: quote }));
          return { ...raw, text: JSON.stringify(value) };
        }
      }
      return raw;
    };
  }

  const routed = (runtime) => (forcedRoute == null ? runtime : Object.freeze({
    ...runtime,
    async produceCandidate(input) {
      const produced = await runtime.produceCandidate(input);
      const route = typeof forcedRoute === "function" ? forcedRoute({ turn }) : forcedRoute;
      if (!route || !produced.caseState.current_episode) return produced;
      const previous = (await store.load(input.caseId)).case_state;
      const caseState = { ...produced.caseState, current_episode: { ...produced.caseState.current_episode, route, active_step: route } };
      return { ...produced, caseState, stateDiff: diffCaseStates(previous, caseState) };
    }
  }));
  const modelRuntime = routed(createPrivateTherapyModelRuntime({ privateCaseSource: store, providers, config }));
  const controller = createPrivateTherapyTurnController({ privateCaseSource: store, modelRuntime, maximumInvocationAttempts: 1 });
  // Runs the nth user turn through the given controller.
  function runThrough(through, number) {
    currentMessage = messageFor(number);
    turnTimes?.begin(number);
    const id = `risk-${number}`;
    return through.run({
      caseId,
      runtimeTurnId: `runtime-${id}`,
      exchangeId: id,
      userTurnId: `${id}-user`,
      assistantTurnId: `${id}-assistant`,
      userMessage: currentMessage,
      userInput: { processingMode: "fast" }
    });
  }
  async function snapshotStore() {
    const copy = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-synthetic-risk-snapshot-"));
    await fs.cp(rootDir, copy, { recursive: true });
    t.after(() => fs.rm(copy, { recursive: true, force: true }));
    return copy;
  }
  const options = { caseId, readings, itemsPerTurn, maximumTurns, auditFindings, auditFails, onAuditPacket, onPrompt, ownerFallback, forcedRoute, messages, reply, clock };
  return {
    caseId,
    rootDir,
    store,
    config,
    providers,
    controller,
    counts,
    modelRuntime,
    // Runs the nth user turn through the whole audit loop and returns the controller's result, or throws what it throws.
    run: (number) => runThrough(controller, number),
    // How many user turns the scripted providers have read, including ones that ended without a reply.
    get turns() { return turn; },
    // A copy of the store as it is now, in a new folder (removed at the end of the test). Take it between turns, never during one.
    snapshot: snapshotStore,
    // A second runtime over a copy of this one's stored case at its current turn, with other options for the turns that follow (for example
    // other audit findings, or the fallback setting). The original is untouched.
    async fork(t2 = t, overrides = {}) {
      const copy = await snapshotStore();
      return openScriptedRiskRuntime(t2, { ...options, ...overrides, copyStoreFrom: copy, startTurn: turn });
    },
    // A second model runtime and controller over the same store and the same scripted providers, with the setting chosen here. For a test
    // that opens a case again under the other setting: the case, its saved turns and the providers' turn count carry over.
    reopen({ ownerFallback: enabled = false } = {}) {
      const reopenedRuntime = routed(createPrivateTherapyModelRuntime({ privateCaseSource: store, providers, config: { ...config, ownerFallbackEnabled: enabled === true } }));
      const reopenedController = createPrivateTherapyTurnController({ privateCaseSource: store, modelRuntime: reopenedRuntime, maximumInvocationAttempts: 1 });
      return { modelRuntime: reopenedRuntime, controller: reopenedController, run: (number) => runThrough(reopenedController, number) };
    },
    load: () => store.load(caseId)
  };
}

// A blocking finding under a code that is not one of the record-only codes and not a role/belief code.
export const BLOCKING_FINDING = Object.freeze({ id: "synthetic-blocking", code: "SYNTHETIC_BLOCKING_DEFECT", severity: "substantive", summary: "Synthetic defect that must block." });
