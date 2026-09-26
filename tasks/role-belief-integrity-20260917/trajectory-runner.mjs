import { createPrivateTherapyModelRuntime } from "../../src/supervisor/private-therapy-model-runtime.mjs";
import { createPrivateTherapyTurnController } from "../../src/supervisor/private-therapy-turn-controller.mjs";

// Stimulus expansion is deterministic. Review criteria are never sent to the
// producer. No model-generated client or circular model judge is introduced.
export function expandTrajectory(scenario) {
  if (scenario?.synthetic !== true || !/^[a-z0-9-]{1,80}$/.test(scenario?.id ?? "")) throw new Error("A named synthetic scenario is required.");
  if (!Array.isArray(scenario.phases) || scenario.phases.length > 20) throw new Error("Bounded phases are required.");
  const messages = [];
  for (const phase of scenario.phases) {
    const repeat = phase.repeat ?? 1;
    const each = phase.repeat_each ?? 1;
    if (!Number.isInteger(repeat) || repeat < 1 || repeat > 10 || !Number.isInteger(each) || each < 1 || each > 10) throw new Error("Invalid repetition bound.");
    if (!Array.isArray(phase.messages) || phase.messages.length > 50) throw new Error("Bounded messages are required.");
    for (let cycle = 0; cycle < repeat; cycle += 1) {
      for (const text of phase.messages) {
        if (typeof text !== "string" || !text.trim() || text.length > 4000) throw new Error("Invalid synthetic message.");
        for (let index = 0; index < each; index += 1) messages.push(text);
      }
    }
  }
  if (messages.length < 1 || messages.length > 100) throw new Error("Trajectory must contain 1–100 exchanges.");
  for (const turn of scenario.restart_before_turns ?? []) {
    if (!Number.isInteger(turn) || turn < 2 || turn > messages.length) throw new Error("Restart must be inside the trajectory.");
  }
  return messages;
}

export async function runRuntimeTrajectory({ scenario, providers, config, openStore, onExchange = async () => {}, allowSubscriptionCli = false }) {
  const messages = expandTrajectory(scenario);
  if (!config || !["mock", "cli"].includes(config.mode)) throw new Error("This harness does not admit paid API execution.");
  if (config.mode === "cli" && allowSubscriptionCli !== true) throw new Error("Live subscription execution requires explicit opt-in and an external budget/model check.");
  if (typeof openStore !== "function" || typeof onExchange !== "function") throw new Error("Store factory and observer must be functions.");
  const caseId = `synthetic-${scenario.id}`;
  const restarts = new Set(scenario.restart_before_turns ?? []);
  const summary = { scenario_id: scenario.id, expected_exchanges: messages.length, completed_exchanges: 0, store_reopens: 0,
    execution_class: config.mode === "mock" ? "SCRIPTED_RUNTIME_ONLY" : "LIVE_RUNTIME_OBSERVATIONS",
    semantic_verdict: "NOT_EVALUATED", provider_mode: config.mode, status: "RUNNING" };
  let store;
  let controller;
  async function open() {
    store = await openStore();
    const modelRuntime = createPrivateTherapyModelRuntime({ privateCaseSource: store, providers, config });
    controller = createPrivateTherapyTurnController({ privateCaseSource: store, modelRuntime, maximumInvocationAttempts: 1 });
  }
  try {
    await open();
    for (let index = 0; index < messages.length; index += 1) {
      if (restarts.has(index + 1)) {
        store.close();
        await open();
        summary.store_reopens += 1;
      }
      const exchangeId = `${scenario.id}-${index + 1}`;
      const result = await controller.run({ caseId, runtimeTurnId: `runtime-${exchangeId}`, exchangeId,
        userTurnId: `${exchangeId}-user`, assistantTurnId: `${exchangeId}-assistant`, userMessage: messages[index],
        userInput: { processingMode: scenario.processing_mode ?? "fast" } });
      summary.completed_exchanges += 1;
      await onExchange({ exchange: index + 1, result, record: await store.load(caseId) });
    }
    summary.status = "COMPLETED";
    const record = await store.load(caseId);
    // Keep exact evidence separate from the nonsemantic summary. Do not publish
    // live outputs or private state merely because the summary is public-safe.
    return { summary, evidence: { transcript: record.raw_transcript, case_state: record.case_state,
      candidate_responses: record.candidate_responses, runtime_turns: record.runtime_turns } };
  } catch (error) {
    error.trajectoryProgress = { ...summary, status: "BLOCKED", error_code: error.code ?? "UNCLASSIFIED" };
    throw error;
  } finally {
    store?.close();
  }
}
