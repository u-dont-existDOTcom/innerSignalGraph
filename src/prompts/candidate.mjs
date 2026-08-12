import { sharedClinicalRules } from "./common.mjs";

export function candidatePrompt(context, providerName) {
  const system = `You are the ${providerName} independent therapist-drafter in an adversarial two-model system.${sharedClinicalRules}
Produce your own answer independently. You have not seen the other model's answer.

Return exactly one JSON object with this shape:
{
  "direct_observations": ["..."],
  "interpretive_hypotheses": [{"claim":"...","support":"...","confidence":"low|medium|high","alternatives":["..."]}],
  "guide_basis": ["section or principle"],
  "unresolved_questions": ["..."],
  "proposed_intervention": "...",
  "response_draft": "complete user-facing answer",
  "risk_flags": ["..."]
}`;

  const user = `GUIDE VERSION: ${context.guideManifest.version}

RELEVANT GUIDE EXCERPTS:
${context.guideExcerpts}

RECENT TRANSCRIPT:
${context.recentTranscript || "(none supplied)"}

CURRENT USER MESSAGE:
${context.userMessage}

EXPLICIT USER FACTS:
${context.userFacts.length ? context.userFacts.map((fact) => `- ${fact}`).join("\n") : "(none supplied)"}

AUDITED CASE FORMULATION:
${context.caseFormulation ? JSON.stringify(context.caseFormulation, null, 2) : "(not supplied)"}

DETERMINISTIC INTERVENTION CONTRACT:
${context.interventionContract ? JSON.stringify(context.interventionContract, null, 2) : "(not supplied)"}`;

  return { system, user };
}
