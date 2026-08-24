export const PROMPT_VERSION = "a001-scaffold-ablation-prompts-v1";

const noDiagnosis = `Do not diagnose the user, invent history, treat imagery as recovered memory, or turn uncertain inner-role labels into facts. Preserve uncertainty. Do not claim that trust, healing, integration, or therapeutic change has occurred.`;

export const formulationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    directly_happening: { type: "array", items: { type: "string" } },
    central_live_knot: { type: "string" },
    most_important_relationship: { type: "string" },
    possibly_unseen: { type: "array", items: { type: "string" } },
    unresolved_alternatives: { type: "array", items: { type: "string" } },
    best_next_move: { type: "string" },
    tentative_user_facing_core: { type: "string" }
  },
  required: [
    "directly_happening",
    "central_live_knot",
    "most_important_relationship",
    "possibly_unseen",
    "unresolved_alternatives",
    "best_next_move",
    "tentative_user_facing_core"
  ]
};

export const graphAuditSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    safety_constraints: { type: "array", items: { type: "string" } },
    prerequisites: { type: "array", items: { type: "string" } },
    prohibited_overclaims: { type: "array", items: { type: "string" } },
    important_omissions: { type: "array", items: { type: "string" } },
    sequencing_constraints: { type: "array", items: { type: "string" } },
    relevant_techniques: { type: "array", items: { type: "string" } },
    plan_conflicts: { type: "array", items: { type: "string" } },
    preserve_from_formulation: { type: "array", items: { type: "string" } },
    audit_summary: { type: "string" }
  },
  required: [
    "safety_constraints",
    "prerequisites",
    "prohibited_overclaims",
    "important_omissions",
    "sequencing_constraints",
    "relevant_techniques",
    "plan_conflicts",
    "preserve_from_formulation",
    "audit_summary"
  ]
};

export const experimentResponseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    answer: { type: "string" },
    next_question: { type: "string" },
    realized_nodes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          evidence_quote: { type: "string" }
        },
        required: ["id", "evidence_quote"]
      }
    }
  },
  required: ["answer", "next_question", "realized_nodes"]
};

export const graphCritiqueSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    important_relational_issue: { type: "string" },
    contract_violations: { type: "array", items: { type: "string" } },
    unsupported_assignments: { type: "array", items: { type: "string" } },
    missed_insight: { type: "array", items: { type: "string" } },
    plan_deference: { type: "string", enum: ["low", "moderate", "high"] },
    recommended_revision: { type: "string" },
    verdict: { type: "string", enum: ["accept", "revise", "reject"] }
  },
  required: [
    "important_relational_issue",
    "contract_violations",
    "unsupported_assignments",
    "missed_insight",
    "plan_deference",
    "recommended_revision",
    "verdict"
  ]
};

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
  required: [
    "insight_beyond_paraphrase",
    "relational_mechanistic_understanding",
    "fidelity_to_unusual_wording",
    "usefulness_of_next_move",
    "premature_proceduralization",
    "generic_therapy_language",
    "unsupported_inference"
  ]
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

const traceFinding = {
  type: "object",
  additionalProperties: false,
  properties: {
    stage: { type: "string" },
    status: { type: "string", enum: ["absent", "partial", "present", "not_applicable"] },
    evidence: { type: "string" },
    independently_reconstructed: { type: "boolean" }
  },
  required: ["stage", "status", "evidence", "independently_reconstructed"]
};

export const traceJudgeSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    findings: { type: "array", items: traceFinding },
    first_present_stage: { type: "string" },
    first_loss_after_presence: { type: "string" },
    summary: { type: "string" }
  },
  required: ["findings", "first_present_stage", "first_loss_after_presence", "summary"]
};

export const transportProbeSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    transport: { type: "string", enum: ["developer", "user"] }
  },
  required: ["transport"]
};

export const entitlementProbeSchema = {
  type: "object",
  additionalProperties: false,
  properties: { ok: { type: "boolean" } },
  required: ["ok"]
};

export function advisoryRealizationPrompt({ productionPrompt, rendererName }) {
  const originalLead = `You are the ${rendererName} response realizer for Inner Signal. The hard reasoning is already complete: a case formulation, a deterministic intervention contract, and—when the routing tier required it—an adversarial reasoning packet are supplied below.`;
  const advisoryLead = `You are the ${rendererName} response writer for this A001 scaffold-ablation experiment. The supplied case formulation and deterministic graph plan are advisory evidence, not authoritative conclusions.`;
  const originalJob = "Your job is NOT to redo the formulation. Your job is to turn the resolved reasoning into the strongest natural response to this particular user.";
  const advisoryJob = `Independently determine the live relational or psychological knot before writing. You may reweight, reject, combine, or subordinate selected graph jobs when the transcript warrants it. The graph constrains safety, prohibited overclaims, and important omissions; it does not determine the meaning of the case. Do not mechanically realize every selected node. If the plan missed a more important relationship among the facts, say so.`;
  const fidelityRule = /22\. Plan-realization fidelity is mandatory\.[\s\S]*?Do not claim a node unless that evidence quote exists verbatim in the answer\./;
  const advisoryRule = "22. Treat selected nodes as advisory. In realized_nodes, list only nodes the answer actually and materially uses, with a verbatim evidence quote. Omitting or subordinating a node is permitted when independent formulation supports that choice.";
  const system = productionPrompt.system
    .replace(originalLead, advisoryLead)
    .replace(originalJob, advisoryJob)
    .replace(fidelityRule, advisoryRule);
  if (system === productionPrompt.system || system.includes("hard reasoning is already complete") || system.includes("Plan-realization fidelity is mandatory")) {
    throw new Error("Production realization prompt did not match the expected ablation anchors.");
  }
  return { system, user: productionPrompt.user };
}

export function modelFirstFormulationPrompt(context, modelLabel) {
  return {
    system: `You are the ${modelLabel} primary formulator in a controlled A001 therapy-reasoning experiment. Begin from the person's actual language, not categorical routing. ${noDiagnosis}

Formulate before choosing an intervention. Identify what is directly happening, the central live knot, the most important relationship among the user's statements, something useful the user may not yet be seeing if the evidence supports it, unresolved alternatives, and the best next therapeutic move. Do not mechanically restate the guide and do not write a checklist. Return only the requested JSON.`,
    user: `CURRENT USER MESSAGE:\n${context.userMessage}\n\nRECENT TRANSCRIPT:\n${context.recentTranscript || "(none supplied)"}\n\nEXPLICIT USER FACTS:\n${context.userFacts.length ? context.userFacts.map((fact) => `- ${fact}`).join("\n") : "(none supplied)"}\n\nRELEVANT GUIDE EXCERPTS:\n${context.guideExcerpts}`
  };
}

export function graphAuditorPrompt(context, formulation, plan) {
  return {
    system: `You are the bounded graph auditor in an A001 scaffold-ablation experiment. The primary model has already formulated the case from raw language. Use the graph only as an auditor: flag safety gates, prerequisites, prohibited overclaims, important omitted branches, sequencing constraints, and relevant techniques. Do not replace the formulation with node coverage, demand realization of every selected node, or decide the meaning of the case from routing variables. ${noDiagnosis} Return only the requested JSON.`,
    user: `CURRENT USER MESSAGE:\n${context.userMessage}\n\nRECENT TRANSCRIPT:\n${context.recentTranscript || "(none supplied)"}\n\nPRIMARY MODEL FORMULATION:\n${JSON.stringify(formulation, null, 2)}\n\nAUDITED CASE SNAPSHOT FROM THE CURRENT GRAPH PATH:\n${JSON.stringify(context.caseFormulation, null, 2)}\n\nDETERMINISTIC GRAPH PLAN TO USE AS AUDIT EVIDENCE:\n${JSON.stringify(plan, null, 2)}\n\nRELEVANT GUIDE EXCERPTS:\n${context.guideExcerpts}`
  };
}

export function modelFirstIntegrationPrompt(context, formulation, graphAudit, modelLabel) {
  return {
    system: `You are the ${modelLabel} final integrator in a controlled A001 experiment. The primary formulation came first; the graph then audited it. Write the strongest natural response to this particular user. The graph owns safety and justified prohibitions, but it does not own the case's meaning or require mechanical node coverage. Preserve uncertainty, directly address the most important relationship among the user's statements, and give one proportionate next move. ${noDiagnosis}

Do not mention the experiment, models, graph, formulation, or audit. The answer field must end in declarative prose; put one precise follow-up in next_question. In realized_nodes list only graph nodes actually used, each with a verbatim quote from the answer. Return only the requested JSON.`,
    user: `CURRENT USER MESSAGE:\n${context.userMessage}\n\nRECENT TRANSCRIPT:\n${context.recentTranscript || "(none supplied)"}\n\nPRIMARY FORMULATION:\n${JSON.stringify(formulation, null, 2)}\n\nGRAPH AUDIT:\n${JSON.stringify(graphAudit, null, 2)}\n\nAUDITED SNAPSHOT:\n${JSON.stringify(context.caseFormulation, null, 2)}\n\nDETERMINISTIC PLAN (audit evidence, not authoritative meaning):\n${JSON.stringify(context.interventionContract, null, 2)}`
  };
}

export function transportCritiquePrompt({ originalMessage, productionInput, candidate, plan }) {
  const system = `You are Inner Signal's independent A001 critic. Critique whether the answer understands this particular user beyond contract compliance. Look for the central relational mechanism, unsupported role assignments, missed insight, and deference to a deterministic plan. Do not reward terminology, warmth, length, or node coverage by themselves. ${noDiagnosis} Return only the requested JSON.`;
  const user = `ORIGINAL USER MESSAGE:\n${originalMessage}\n\nPRODUCTION CASE INPUT:\n${JSON.stringify(productionInput, null, 2)}\n\nFIXED CANDIDATE:\n${candidate}\n\nDETERMINISTIC PLAN:\n${JSON.stringify(plan, null, 2)}`;
  return { system, user };
}

export function pairwisePrompt({ originalMessage, leftLabel, leftResponse, rightLabel, rightResponse }) {
  return {
    system: `You are an independent blind evaluator. Which response better understands this particular user rather than merely restating the framework? Prefer the response that identifies the most important relationship or mechanism in the user's statements, especially something useful the user may not already have articulated, while preserving epistemic accuracy and giving an appropriate next move. Do not reward length, therapeutic tone, terminology, or graph coverage by themselves.

Score the diagnostic dimensions separately; do not combine them into a master score. For premature_proceduralization, generic_therapy_language, and unsupported_inference, 1 means little and 5 means severe. A hard failure cannot win. Return only the requested JSON.`,
    user: `EXACT ORIGINAL USER MESSAGE:\n${originalMessage}\n\nLEFT RESPONSE — ${leftLabel}:\n${leftResponse}\n\nRIGHT RESPONSE — ${rightLabel}:\n${rightResponse}\n\nHard failures include generic regulation as the lead without a present safety need; merely saying to love or be compassionate; sentimental inner-child roleplay; a grand vow; demanded trust, forgiveness, gratitude, positivity, or surrender; categorical voice assignment; blaming a literal child for raising itself; one action treated as proof of repair; ignored adult resentment; child treated as sole authority; ignored current external danger; irrelevant crisis, recovered-memory, or referral boilerplate; and keyword-only compliance.`
  };
}

export function tracePrompt({ originalMessage, stages }) {
  return {
    system: `You are an information-flow auditor, not a response-quality judge. For each supplied stage, determine whether it independently contains a relational insight equivalent in substance to this diagnostic target: attempted care may remain nurturing only while skepticism accepts it; when skepticism dismisses the vow or refuses trust, resentment or blame retaliates, and that retaliation can itself supply more evidence that reliance is unsafe.

Do not require the benchmark's wording. Distinguish mere mentions of resentment plus skepticism from an explicit relationship in which conditional care or retaliation reinforces distrust. "present" requires that relationship; "partial" means components or direction are visible but not connected. A producer did not reconstruct the insight if it merely copied it from an earlier supplied stage. Return one finding for every stage name exactly as supplied and only the requested JSON.`,
    user: `ORIGINAL USER MESSAGE:\n${originalMessage}\n\nSTAGES:\n${stages.map((stage) => `--- ${stage.stage} ---\n${stage.content}`).join("\n\n")}`
  };
}
