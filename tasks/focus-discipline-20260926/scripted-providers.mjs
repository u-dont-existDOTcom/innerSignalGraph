import fs from "node:fs/promises";

// Scripted providers for focus-discipline trajectories. Each turn's extraction
// (focus relations, session focus) and audit reclassifications are chosen by
// the test, so these runs exercise the real runtime, persistence, and
// deterministic focus controller; they cannot show that a live model
// classifies questions or focus well.
export const REDIRECT_SENTENCE = "That sounds worth coming back to, and I have saved it; for now let us stay with what we were working on.";
export const MENTION_SENTENCE = "Earlier you raised something else that is still saved for when there is room.";
const MAIN_SENTENCE = "This scripted response keeps to the current focus.";

// Calm inner-child variables whose selected nodes carry no default question, so
// the model-supplied unknowns decide the next question.
const CALM_OVERRIDES = Object.freeze({
  age_agency_ambiguity: "absent",
  credibility_conflict: "absent",
  self_directed_love: "safe",
  resentment_toward_younger_self: "absent",
  protective_response: "absent"
});

export async function makeFocusScriptedProviders({ turns, onPlan = () => {} }) {
  const baseline = JSON.parse(await fs.readFile(new URL("../../fixtures/mock-responses/A001.json", import.meta.url), "utf8"));
  let turn = 0;
  let sequence = 0;
  const counts = {};
  const isolation = Object.freeze({ packetOnly: true, freshContextPerGenerate: true, tools: false, filesystem: false,
    sessionPersistence: false, transport: "synthetic" });
  function provider(role) {
    return {
      id: `scripted-focus-${role}`, model: "scripted-not-a-model", privateInferenceIsolation: isolation,
      async generate(input) {
        const stage = input.metadata?.fixtureKey ?? input.metadata?.stage;
        counts[stage] = (counts[stage] ?? 0) + 1;
        const step = turns[Math.max(0, turn - (stage === "case_extraction" ? 0 : 1))] ?? {};
        let value;
        if (stage === "case_extraction") {
          turn += 1;
          const script = turns[turn - 1];
          const snapshot = structuredClone(baseline.anthropic.case_extraction);
          snapshot.user_goal = "Build a trustworthy caring adult function for a younger self.";
          snapshot.current_issue = "Synthetic focus-discipline trajectory.";
          snapshot.variables = { ...snapshot.variables, ...CALM_OVERRIDES, ...(script.variables ?? {}) };
          snapshot.turn_task = null;
          snapshot.path_update = null;
          snapshot.relational_readiness = null;
          snapshot.romance_guide_context = null;
          snapshot.threat_pathway = null;
          snapshot.compatibility_assessment = null;
          snapshot.inner_speech_profile = null;
          snapshot.direct_observations = [{ id: "O1", statement: "The client supplied a synthetic report.", evidence: script.message, phenomenology: null }];
          snapshot.hypotheses = [];
          snapshot.unknowns = structuredClone(script.unknowns ?? []);
          snapshot.session_focus = script.focus === undefined ? null : structuredClone(script.focus);
          value = snapshot;
        } else if (stage === "case_audit") {
          value = { corrected_turn_task: null, invalidate_turn_task: false, remove_observation_ids: [], remove_hypothesis_ids: [],
            variable_corrections: [], add_unknowns: [], safety_flags: [], verdict: "accept", summary: "Scripted infrastructure audit.",
            corrected_path_representation: null, invalidate_path_representation: false,
            corrected_strategy_review: null, invalidate_strategy_review: false,
            corrected_relational_readiness: null, invalidate_relational_readiness: false,
            corrected_romance_guide_context: null, invalidate_romance_guide_context: false,
            corrected_threat_pathway: null, invalidate_threat_pathway: false,
            corrected_compatibility_assessment: null, invalidate_compatibility_assessment: false,
            corrected_session_focus: null, focus_reclassifications: structuredClone(step.audit?.focus_reclassifications ?? []) };
        } else if (stage === "realization") {
          const encodedPlan = input.user.split("DETERMINISTIC INTERVENTION CONTRACT:\n")[1]?.split("\n\nRESOLVED REASONING PACKET:")[0];
          const plan = JSON.parse(encodedPlan);
          onPlan({ turn, plan });
          const ids = [...new Set(plan.executionContract?.requiredNodeIds ?? [plan.primaryJob?.id])].filter(Boolean);
          const sentences = ids.map((_id, index) => `This synthetic scaffold represents step ${index + 1}.`);
          const parts = [];
          if (plan.focusContract?.redirect) parts.push(REDIRECT_SENTENCE);
          parts.push(MAIN_SENTENCE, ...sentences);
          if (plan.focusContract?.surface?.mode === "mention") parts.push(MENTION_SENTENCE);
          value = { answer: parts.join(" "), next_question: plan.nextQuestion ?? "",
            realized_nodes: ids.map((id, index) => ({ id, evidence_quote: sentences[index] })) };
        } else if (stage === "private_candidate_audit") {
          const packet = JSON.parse(input.user.split("\n").slice(1).join("\n"));
          value = { findings: [], repair_induced_checks: packet.repair_induced_error_checks ?? [] };
        } else {
          throw new Error(`Unscripted provider stage: ${stage}`);
        }
        return { provider: this.id, model: this.model, text: JSON.stringify(value), responseId: `synthetic-focus-${role}-${++sequence}`,
          usage: { input_tokens: 0, output_tokens: 0 } };
      }
    };
  }
  return { providers: { openai: provider("case-auditor"), anthropic: provider("private-auditor"), renderer: provider("producer") }, counts };
}
