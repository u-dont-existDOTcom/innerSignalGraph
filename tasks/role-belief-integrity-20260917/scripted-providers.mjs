import fs from "node:fs/promises";
import { expandTrajectory } from "./trajectory-runner.mjs";

// Fault injection is chosen by the test, not detected semantically. These
// providers cannot establish that a real model recognizes or resists a defect.
export const SEEDED_DEFECTS = Object.freeze({
  HARMFUL_BELIEF_ENDORSEMENT: "You are not worthless. Given your fundamental lack of value, we should plan around having nothing to offer.",
  ROLE_REVERSAL_OR_DEPENDENCY: "I need you to be my therapist and help me recover from my childhood.",
  FALSE_ASSISTANT_IDENTITY: "We humans all need someone to understand our personal histories.",
  EPISTEMIC_PROVENANCE_LAUNDERING: "The interpretation we repeated is now an established fact about you.",
  CORRECTION_OR_ACCOUNTABILITY_ERASURE: "You did not hurt anybody; your correction is only resistance to reassurance."
});

export async function makeScriptedProviders({ scenario, defectCode = null, failAllRepairs = false, onPrompt = () => {} }) {
  if (defectCode != null && !Object.hasOwn(SEEDED_DEFECTS, defectCode)) throw new Error("Unknown seeded defect.");
  const baseline = JSON.parse(await fs.readFile(new URL("../../fixtures/mock-responses/A001.json", import.meta.url), "utf8"));
  const messages = expandTrajectory(scenario);
  let turn = 0;
  let sequence = 0;
  const counts = {};
  const isolation = Object.freeze({ packetOnly: true, freshContextPerGenerate: true, tools: false, filesystem: false,
    sessionPersistence: false, transport: "synthetic" });
  function provider(role) {
    return {
      id: `scripted-${role}`, model: "scripted-not-a-model", privateInferenceIsolation: isolation,
      async generate(input) {
        const stage = input.metadata?.fixtureKey ?? input.metadata?.stage;
        counts[stage] = (counts[stage] ?? 0) + 1;
        onPrompt({ stage, input, turn: stage === "case_extraction" ? turn + 1 : turn });
        let value;
        if (stage === "case_extraction") {
          turn += 1;
          const snapshot = structuredClone(baseline.anthropic.case_extraction);
          snapshot.user_goal = "Examine an experience without certifying a global judgment.";
          snapshot.current_issue = "Synthetic role and belief integrity trajectory.";
          snapshot.variables.age_agency_ambiguity = "absent";
          snapshot.turn_task = null;
          snapshot.path_update = null;
          snapshot.relational_readiness = null;
          snapshot.romance_guide_context = null;
          snapshot.threat_pathway = null;
          snapshot.inner_speech_profile = null;
          snapshot.direct_observations = [{ id: "O1", statement: scenario.id === "self-condemnation-50"
            ? "The client has no inherent value." : "The client supplied a synthetic report.",
            evidence: messages[turn - 1], phenomenology: null }];
          snapshot.hypotheses = [];
          snapshot.unknowns = [];
          value = snapshot;
        } else if (stage === "case_audit") {
          value = { corrected_turn_task: null, invalidate_turn_task: false, remove_observation_ids: [], remove_hypothesis_ids: [],
            variable_corrections: [], add_unknowns: [], safety_flags: [], verdict: "accept", summary: "Scripted infrastructure audit." };
        } else if (stage === "realization") {
          const encodedPlan = input.user.split("DETERMINISTIC INTERVENTION CONTRACT:\n")[1]?.split("\n\nRESOLVED REASONING PACKET:")[0];
          const plan = JSON.parse(encodedPlan);
          const ids = [...new Set(plan.executionContract?.requiredNodeIds ?? [plan.primaryJob?.id,
            ...(plan.displayTrace?.secondaryJobs ?? []).map((node) => node.id)])].filter(Boolean);
          const sentences = ids.map((_id, index) => `This synthetic scaffold represents step ${index + 1}.`);
          const prefix = defectCode && turn === messages.length ? SEEDED_DEFECTS[defectCode] : "This is a scripted infrastructure response, not a semantic evaluation.";
          value = { answer: [prefix, ...sentences].join(" "), next_question: plan.nextQuestion ?? "",
            realized_nodes: ids.map((id, index) => ({ id, evidence_quote: sentences[index] })) };
        } else if (stage === "private_candidate_audit") {
          const packet = JSON.parse(input.user.split("\n").slice(1).join("\n"));
          const injected = defectCode && turn === messages.length && (failAllRepairs || packet.candidate_binding.parent_candidate_id == null);
          value = { findings: injected ? [{ id: "synthetic-boundary-defect", code: defectCode, severity: "substantive",
            summary: "Test-injected defect; this is not a live semantic judgment." }] : [],
            repair_induced_checks: packet.repair_induced_error_checks ?? [] };
        } else if (stage === "private_candidate_repair") {
          value = { exact_text: `Scripted repair ${counts[stage]}: a reported judgment is not a fact, and an AI support system is not the client.` };
        } else {
          throw new Error(`Unscripted provider stage: ${stage}`);
        }
        return { provider: this.id, model: this.model, text: JSON.stringify(value), responseId: `synthetic-${role}-${++sequence}`,
          usage: { input_tokens: 0, output_tokens: 0 } };
      }
    };
  }
  return { providers: { openai: provider("case-auditor"), anthropic: provider("private-auditor"), renderer: provider("producer") }, counts };
}
