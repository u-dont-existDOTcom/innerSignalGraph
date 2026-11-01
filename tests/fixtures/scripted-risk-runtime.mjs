import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../../src/core/config.mjs";
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

// "ideation" or { state: "ideation", context: "pain_episode" }.
function normalizeReading(reading) {
  if (reading == null) return { state: "absent", context: null };
  return typeof reading === "string" ? { state: reading, context: null } : { state: reading.state, context: reading.context ?? null };
}

export function syntheticMessage(number) {
  return `Synthetic message ${number}.`;
}

/**
 * @param t node:test context, used to close the store and delete the temporary folder.
 * @param options.readings the extraction's suicidal_state for each turn (string or { state, context }); later turns read "absent".
 * @param options.itemsPerTurn 1, or 6 for four observations and two hypotheses (the busiest ordinary extraction).
 * @param options.auditFindings ({ turn, auditNumber, packet }) => findings for that audit; audit numbers restart at 1 on each turn.
 * @param options.auditFails ({ turn, auditNumber }) => true to make the audit provider itself fail.
 * @param options.onAuditPacket ({ turn, auditNumber, packet }) => void, called with the packet the auditor received.
 * @param options.onPrompt ({ stage, turn, input }) => void, called for every provider call.
 */
export async function openScriptedRiskRuntime(t, {
  caseId = "synthetic-risk-runtime",
  readings = [],
  itemsPerTurn = 1,
  maximumTurns = 10,
  auditFindings = () => [],
  auditFails = () => false,
  onAuditPacket = () => {},
  onPrompt = () => {}
} = {}) {
  if (![1, 6].includes(itemsPerTurn)) throw new Error("itemsPerTurn must be 1 or 6.");
  if (!Number.isSafeInteger(maximumTurns) || maximumTurns < 1 || maximumTurns > MAXIMUM_TURNS) throw new Error("maximumTurns is out of range.");
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-synthetic-risk-"));
  const store = createEncryptedPrivateCaseStore({
    rootDir,
    routineKek: Buffer.alloc(32, 61),
    recoverySecretBytes: Buffer.alloc(32, 62),
    developmentExternalCredentialAuthorized: true
  });
  t.after(async () => {
    store.close();
    await fs.rm(rootDir, { recursive: true, force: true });
  });
  const config = loadConfig({ mode: "mock", ledgerMode: "off", devAutomationEnabled: false });
  const scenario = {
    id: "synthetic-risk-runtime",
    synthetic: true,
    phases: Array.from({ length: Math.ceil(maximumTurns / TURNS_PER_PHASE) }, () => ({ messages: ["Synthetic placeholder."], repeat: TURNS_PER_PHASE }))
  };
  const { providers, counts } = await makeScriptedProviders({ scenario });

  let turn = 0;
  let auditNumber = 0;
  let currentMessage = syntheticMessage(1);
  for (const provider of Object.values(providers)) {
    const generate = provider.generate.bind(provider);
    provider.generate = async (input) => {
      const stage = input.metadata?.fixtureKey ?? input.metadata?.stage;
      if (stage === "case_extraction") { turn += 1; auditNumber = 0; }
      onPrompt({ stage, turn, input });
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
      return raw;
    };
  }

  const modelRuntime = createPrivateTherapyModelRuntime({ privateCaseSource: store, providers, config });
  const controller = createPrivateTherapyTurnController({ privateCaseSource: store, modelRuntime, maximumInvocationAttempts: 1 });
  return {
    caseId,
    store,
    counts,
    modelRuntime,
    // Runs the nth user turn through the whole audit loop and returns the controller's result, or throws what it throws.
    async run(number) {
      currentMessage = syntheticMessage(number);
      const id = `risk-${number}`;
      return controller.run({
        caseId,
        runtimeTurnId: `runtime-${id}`,
        exchangeId: id,
        userTurnId: `${id}-user`,
        assistantTurnId: `${id}-assistant`,
        userMessage: currentMessage,
        userInput: { processingMode: "fast" }
      });
    },
    load: () => store.load(caseId)
  };
}

// A blocking finding under a code that is not one of the record-only codes and not a role/belief code.
export const BLOCKING_FINDING = Object.freeze({ id: "synthetic-blocking", code: "SYNTHETIC_BLOCKING_DEFECT", severity: "substantive", summary: "Synthetic defect that must block." });
