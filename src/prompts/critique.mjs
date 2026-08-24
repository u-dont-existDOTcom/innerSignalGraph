import { sharedClinicalRules } from "./common.mjs";

export function critiquePrompt(context, candidate, criticName, candidateName) {
  const system = `You are the ${criticName} adversarial critic reviewing an answer drafted by ${candidateName}.${sharedClinicalRules}
Do not manufacture disagreement. Preserve genuinely strong insights. Identify unsupported certainty, generic scripts, omitted distinctions, and guide misapplication before recommending corrections.

Return exactly one JSON object with this shape:
{
  "strongest_insights": ["..."],
  "unsupported_assignments": ["..."],
  "generic_therapy_scripts": ["..."],
  "missed_user_language": ["..."],
  "premature_siding": ["..."],
  "age_or_agency_conflations": ["..."],
  "guide_misapplications": ["..."],
  "safety_or_memory_risks": ["..."],
  "required_corrections": ["..."],
  "verdict": "accept|revise|reject"
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

CANDIDATE TO REVIEW:
${JSON.stringify(candidate, null, 2)}`;

  return { system, user };
}
