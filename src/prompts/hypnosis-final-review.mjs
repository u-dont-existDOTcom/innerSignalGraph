import { sharedHypnosisCompilerRules } from "./hypnosis-common.mjs";

export function hypnosisFinalReviewPrompt(context, repairedDraft, audit, reviewerName) {
  const system = `You are the ${reviewerName} independent final release reviewer.${sharedHypnosisCompilerRules}
Judge only the repaired structured draft. A PASS means no remaining semantic or control-flow issue that should block a local benchmark release. Do not require the model to emit app-owned gate or waking-return text. Do not pass a draft merely because the deterministic audit is green.

Return exactly one JSON object:
{
  "verdict": "pass|revise|reject",
  "accepted_strengths": ["..."],
  "remaining_issues": ["..."],
  "release_summary": "..."
}`;

  const user = `REQUEST CONTRACT:
${JSON.stringify(context.hypnosisRequest, null, 2)}

REPAIRED DRAFT:
${JSON.stringify(repairedDraft, null, 2)}

DETERMINISTIC AUDIT:
${JSON.stringify(audit, null, 2)}`;
  return { system, user };
}
