import { sharedHypnosisCompilerRules } from "./hypnosis-common.mjs";

export function hypnosisRepairPrompt(context, draft, audit, review, repairScope, repairerName) {
  const system = `You are the ${repairerName} hypnosis repairer.${sharedHypnosisCompilerRules}
Return only a structured component patch, never a complete draft and never commentary. Replace every requested component exactly once and no other component. Preserve strong material. Correct every valid deterministic and adversarial finding within the supplied repair scope. Do not weaken the request contract or solve a failed field by moving control language into another field.

Return exactly:
{
  "patch_version": "hypnosis-component-patch-v1",
  "replacements": [
    {
      "component_id": "orientation",
      "replacement": "exact replacement text"
    }
  ]
}`;

  const user = `GUIDE VERSION: ${context.guideManifest.version}

REQUEST CONTRACT:
${JSON.stringify(context.hypnosisRequest, null, 2)}

READ-ONLY ORIGINAL DRAFT CONTEXT:
${JSON.stringify(draft, null, 2)}

DETERMINISTIC AUDIT:
${JSON.stringify(audit, null, 2)}

ADVERSARIAL REVIEW:
${JSON.stringify(review, null, 2)}

EXACT REPAIR COMPONENT IDS:
${JSON.stringify(repairScope.componentIds, null, 2)}

DEPENDENCY EDGES APPLIED BY THE APPLICATION:
${JSON.stringify(repairScope.dependencyEdgesApplied, null, 2)}

AUTOPILOT FEEDBACK FROM PRIOR ATTEMPTS:
${context.autopilotFeedback ? JSON.stringify(context.autopilotFeedback, null, 2) : "(none)"}`;
  return { system, user };
}
