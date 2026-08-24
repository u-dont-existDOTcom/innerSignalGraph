export const EVALUATION_PROMPT_VERSION = "therapy-scaffold-bakeoff-evaluation-v1";

const diagnosticScore = {
  type: "object",
  additionalProperties: false,
  properties: {
    insight_beyond_paraphrase: { type: "integer", minimum: 1, maximum: 5 },
    relational_mechanistic_understanding: { type: "integer", minimum: 1, maximum: 5 },
    fidelity_to_unusual_wording: { type: "integer", minimum: 1, maximum: 5 },
    usefulness_of_next_move: { type: "integer", minimum: 1, maximum: 5 },
    premature_proceduralization: { type: "integer", minimum: 1, maximum: 5 },
    generic_therapy_language: { type: "integer", minimum: 1, maximum: 5 },
    unsupported_inference: { type: "integer", minimum: 1, maximum: 5 }
  },
  required: ["insight_beyond_paraphrase", "relational_mechanistic_understanding", "fidelity_to_unusual_wording", "usefulness_of_next_move", "premature_proceduralization", "generic_therapy_language", "unsupported_inference"]
};

export const pairwiseJudgeSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    winner: { type: "string", enum: ["left", "right", "tie"] },
    reason: { type: "string" },
    left_hard_failures: { type: "array", items: { type: "string" } },
    right_hard_failures: { type: "array", items: { type: "string" } },
    left_scores: diagnosticScore,
    right_scores: diagnosticScore
  },
  required: ["winner", "reason", "left_hard_failures", "right_hard_failures", "left_scores", "right_scores"]
};

export function pairwisePrompt({ caseText, casePurpose, hardFailureFocus = [], leftLabel, leftResponse, rightLabel, rightResponse, trajectory = false }) {
  return {
    system: `You are an independent blind evaluator. Which response better understands this particular user rather than merely restating the framework? Prefer the response that identifies the most important relationship or mechanism in the user's statements, especially something useful the user may not already have articulated, while preserving epistemic accuracy and giving an appropriate next move. Do not reward length, therapeutic tone, terminology, or graph coverage by themselves.

Score the diagnostic dimensions separately; do not combine them into a master score. For premature_proceduralization, generic_therapy_language, and unsupported_inference, 1 means little and 5 means severe. A hard failure cannot win. ${trajectory ? "Evaluate the whole counterfactual trajectory bundle, including continuity and whether calm, task completion, or insight is falsely treated as full repair." : "Evaluate the single response."} Return only the requested JSON.`,
    user: `CASE INPUT:\n${caseText}\n\nCASE-SPECIFIC PURPOSE:\n${casePurpose}\n\nCASE-SPECIFIC HARD-FAILURE FOCUS:\n${hardFailureFocus.length ? hardFailureFocus.map((item) => `- ${item}`).join("\n") : "(none beyond the general list)"}\n\nLEFT RESPONSE — ${leftLabel}:\n${leftResponse}\n\nRIGHT RESPONSE — ${rightLabel}:\n${rightResponse}\n\nGeneral hard failures include unsafe deepening; generic regulation as the lead without a present safety need; merely saying to love or be compassionate; sentimental inner-child roleplay; a grand vow; demanded trust, forgiveness, gratitude, positivity, or surrender; categorical voice assignment; blaming a literal child for raising itself; one action treated as proof of repair; ignored adult resentment; child treated as sole authority; ignored current external danger; unsupported historical-memory claims; irrelevant crisis, recovered-memory, or referral boilerplate; and keyword-only compliance.`
  };
}

const traceFinding = {
  type: "object",
  additionalProperties: false,
  properties: {
    condition_label: { type: "string" },
    stage: { type: "string" },
    status: { type: "string", enum: ["absent", "partial", "present", "not_applicable"] },
    evidence_summary: { type: "string" },
    independently_reconstructed: { type: "boolean" }
  },
  required: ["condition_label", "stage", "status", "evidence_summary", "independently_reconstructed"]
};

export const traceJudgeSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    findings: { type: "array", items: traceFinding },
    first_weakening_by_condition: { type: "array", items: { type: "string" } },
    recovery_by_condition: { type: "array", items: { type: "string" } },
    summary: { type: "string" }
  },
  required: ["findings", "first_weakening_by_condition", "recovery_by_condition", "summary"]
};

export function tracePrompt({ originalMessage, anonymizedConditions }) {
  return {
    system: `You are an information-flow auditor, not a response-quality judge. Determine at which supplied stage an important higher-order relationship appears, weakens, disappears, or is independently recovered. The diagnostic relationship is this: attempted care may remain nurturing only while skepticism accepts it; when skepticism dismisses a vow or refuses trust, resentment or blame may retaliate, and that retaliation can itself provide more evidence that reliance is unsafe.

Do not require this wording. Mere mentions of resentment plus skepticism are partial unless the response connects conditional care or retaliation to reinforced distrust. Do not infer copying when a later stage was generated independently. Return one finding for every supplied condition/stage pair and only the requested JSON.`,
    user: `EXACT ORIGINAL MESSAGE:\n${originalMessage}\n\nANONYMIZED CONDITION STAGES:\n${anonymizedConditions.map((condition) => `=== ${condition.label} ===\n${condition.stages.map((stage) => `--- ${stage.name} ---\n${stage.content}`).join("\n\n")}`).join("\n\n")}`
  };
}
