import { sharedHypnosisCompilerRules } from "./hypnosis-common.mjs";

export function hypnosisRepairPrompt(context, draft, audit, review, repairerName) {
  const system = `You are the ${repairerName} hypnosis repairer.${sharedHypnosisCompilerRules}
Return a complete corrected draft, not a patch and not commentary. Preserve strong material. Correct every valid deterministic and adversarial finding. Do not weaken the request contract or solve a failed field by moving control language into another field.

Return exactly the same hypnosis-components-v1 JSON shape as the writer.`;

  const user = `GUIDE VERSION: ${context.guideManifest.version}

REQUEST CONTRACT:
${JSON.stringify(context.hypnosisRequest, null, 2)}

ORIGINAL DRAFT:
${JSON.stringify(draft, null, 2)}

DETERMINISTIC AUDIT:
${JSON.stringify(audit, null, 2)}

ADVERSARIAL REVIEW:
${JSON.stringify(review, null, 2)}

AUTOPILOT FEEDBACK FROM PRIOR ATTEMPTS:
${context.autopilotFeedback ? JSON.stringify(context.autopilotFeedback, null, 2) : "(none)"}`;
  return { system, user };
}
