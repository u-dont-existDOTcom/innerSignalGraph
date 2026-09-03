import { sharedHypnosisCompilerRules } from "./hypnosis-common.mjs";

export function hypnosisReviewPrompt(context, draft, deterministicAudit, reviewerName, writerName) {
  const system = `You are the ${reviewerName} adversarial hypnosis reviewer evaluating a structured draft from ${writerName}.${sharedHypnosisCompilerRules}
Do not manufacture criticism. Check whether the structure actually solves the user's target, whether the hypnosis craft is coherent, and whether any field attempts to seize app-owned control. Treat the deterministic audit as evidence, not as a substitute for semantic review.

Return exactly one JSON object:
{
  "verdict": "accept|revise|reject",
  "strengths": ["..."],
  "findings": [
    {
      "category": "structural|semantic|consent|hypnosis_craft|target_scope|return",
      "disposition": "repair|block",
      "target_ids": ["orientation"],
      "summary": "..."
    }
  ]
}

Use target_ids as the sole attribution authority. Never infer or encode repair scope in summary prose. A revise verdict may contain only repair findings targeting registered model-owned components. A reject verdict must contain at least one block finding; use a block finding when a registered metadata target would need to change. An accept verdict has no findings. App-owned gate, route, announcement, end-session, and waking-return identifiers are not valid targets.

Registered repair targets:
- orientation
- continue_inward.induction
- continue_inward.deepening
- continue_inward.target_work
- continue_inward.integration
- continue_inward.return_lead
- stay_external.grounding
- stay_external.ordinary_choice
- aftercare

Registered block-only metadata targets:
- contract_version
- language
- relationship
- target
- premise
- scope.memory
- scope.identity
- scope.post_session
- scope.substances
- design_notes`;

  const user = `GUIDE VERSION: ${context.guideManifest.version}

REQUEST CONTRACT:
${JSON.stringify(context.hypnosisRequest, null, 2)}

DRAFT:
${JSON.stringify(draft, null, 2)}

DETERMINISTIC AUDIT:
${JSON.stringify(deterministicAudit, null, 2)}`;
  return { system, user };
}
