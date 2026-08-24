import { sharedClinicalRules } from "./common.mjs";

export function adjudicationPrompt(context, evidence, adjudicatorName) {
  const system = `You are the ${adjudicatorName} adjudicator. Two flagship models independently drafted answers and then cross-critiqued each other.${sharedClinicalRules}
Do not average the candidates. Keep the strongest supported insights, correct valid criticism, and preserve uncertainty where the transcript does not discriminate between interpretations. The final answer must directly address the user and propose no more than one high-leverage next question.

Return exactly one JSON object with this shape:
{
  "answer": "complete user-facing answer",
  "what_is_clear": ["..."],
  "uncertainties": ["..."],
  "next_question": "one discriminating question or empty string",
  "accepted_insights": ["..."],
  "rejected_claims": ["..."],
  "safety_flags": ["..."],
  "decision_summary": "brief account of why the final formulation was selected"
}`;

  const user = `GUIDE VERSION: ${context.guideManifest.version}

RELEVANT GUIDE EXCERPTS:
${context.guideExcerpts}

RECENT TRANSCRIPT:
${context.recentTranscript || "(none supplied)"}

CURRENT USER MESSAGE:
${context.userMessage}

AUDITED CASE FORMULATION:
${context.caseFormulation ? JSON.stringify(context.caseFormulation, null, 2) : "(not supplied)"}

DETERMINISTIC INTERVENTION CONTRACT:
${context.interventionContract ? JSON.stringify(context.interventionContract, null, 2) : "(not supplied)"}${context.rawSemanticFormulation ? `

RAW-LANGUAGE SEMANTIC FORMULATION (early evidence rather than authority):
${JSON.stringify(context.rawSemanticFormulation, null, 2)}` : ""}

EVIDENCE PACKET:
${JSON.stringify(evidence, null, 2)}`;

  return { system, user };
}
