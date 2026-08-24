import { sharedClinicalRules } from "./common.mjs";

const noOutcomeOverclaim = "Do not claim that reception, trust, healing, integration, or therapeutic change has already occurred.";

export const semanticFormulationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    direct_observations: { type: "array", items: { type: "string" } },
    central_live_knot: { type: "string" },
    important_relationships: { type: "array", items: { type: "string" } },
    potentially_useful_implications: { type: "array", items: { type: "string" } },
    unresolved_alternatives: { type: "array", items: { type: "string" } },
    uncertainty: { type: "array", items: { type: "string" } },
    proportionate_next_move: { type: "string" }
  },
  required: [
    "direct_observations",
    "central_live_knot",
    "important_relationships",
    "potentially_useful_implications",
    "unresolved_alternatives",
    "uncertainty",
    "proportionate_next_move"
  ]
};

export const graphAuditSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    hard_safety_constraints: { type: "array", items: { type: "string" } },
    epistemic_prohibitions: { type: "array", items: { type: "string" } },
    prerequisites: { type: "array", items: { type: "string" } },
    important_omitted_branches: { type: "array", items: { type: "string" } },
    sequencing_concerns: { type: "array", items: { type: "string" } },
    relevant_techniques: { type: "array", items: { type: "string" } },
    formulation_graph_conflicts: { type: "array", items: { type: "string" } },
    advisory_opportunities: { type: "array", items: { type: "string" } },
    audit_summary: { type: "string" }
  },
  required: [
    "hard_safety_constraints",
    "epistemic_prohibitions",
    "prerequisites",
    "important_omitted_branches",
    "sequencing_concerns",
    "relevant_techniques",
    "formulation_graph_conflicts",
    "advisory_opportunities",
    "audit_summary"
  ]
};

export function semanticFormulationPrompt(context, modelName = "Claude") {
  return {
    system: `You are the ${modelName} primary semantic formulator for Inner Signal. Formulate from the person's raw language before categorical routing or graph-node selection.${sharedClinicalRules}
Identify direct observations, the central live knot, important relationships among the observations, a potentially useful implication the person may not already have articulated when supported, unresolved alternatives, uncertainty, and one proportionate next move. Do not turn the formulation into a taxonomy, enum ledger, checklist, or diagnosis. ${noOutcomeOverclaim}
Return only the requested JSON.`,
    user: `CURRENT USER MESSAGE:\n${context.userMessage}\n\nRECENT TRANSCRIPT:\n${context.recentTranscript || "(none supplied)"}\n\nEXPLICIT USER FACTS:\n${context.userFacts.length ? context.userFacts.map((fact) => `- ${fact}`).join("\n") : "(none supplied)"}\n\nRELEVANT GUIDE EXCERPTS:\n${context.guideExcerpts}`
  };
}

export function boundedGraphAuditPrompt({ context, semanticFormulation, rawCaseExtraction, caseAuditDelta, auditedSnapshot, plan, authority, tierReasoning = null }) {
  return {
    system: `You are Inner Signal's bounded graph auditor. A semantic formulation was produced independently from raw language before graph routing. Use deterministic graph evidence only to flag hard safety constraints, epistemic prohibitions, prerequisites, important omitted branches, sequencing concerns, relevant techniques, conflicts, and advisory opportunities.${sharedClinicalRules}
Do not replace the semantic formulation, demand coverage of every selected node, determine the case's meaning merely from variables, or convert a hypothesis into a fact. ${noOutcomeOverclaim}
Return only the requested JSON.`,
    user: `ORIGINAL CURRENT USER MESSAGE:\n${context.userMessage}\n\nORIGINAL RECENT TRANSCRIPT:\n${context.recentTranscript || "(none supplied)"}\n\nIMMUTABLE RAW SEMANTIC FORMULATION:\n${JSON.stringify(semanticFormulation, null, 2)}${tierReasoning ? `\n\nTIER-SPECIFIC REASONING PACKET:\n${JSON.stringify(tierReasoning, null, 2)}` : ""}\n\nRAW CATEGORICAL EXTRACTION:\n${JSON.stringify(rawCaseExtraction, null, 2)}\n\nCASE AUDIT DELTA:\n${JSON.stringify(caseAuditDelta, null, 2)}\n\nAUDITED SNAPSHOT:\n${JSON.stringify(auditedSnapshot, null, 2)}\n\nDETERMINISTIC PLAN:\n${JSON.stringify(plan, null, 2)}\n\nDETERMINISTIC AUTHORITY CLASSES:\n${JSON.stringify(authority, null, 2)}\n\nRELEVANT GUIDE EXCERPTS:\n${context.guideExcerpts}`
  };
}

export function modelFirstIntegrationPrompt({ context, semanticFormulation, rawCaseExtraction, caseAuditDelta, auditedSnapshot, plan, graphAudit, authority, tierReasoning = null, rendererName = "Claude" }) {
  return {
    system: `You are the ${rendererName} final integrator for Inner Signal. The raw-language semantic formulation was produced independently before categorical routing; the graph then audited it. Write the strongest natural response to this particular person.${sharedClinicalRules}
You may correct or reweight the semantic formulation, case audit, and advisory graph plan when the transcript warrants it. You may not override deterministic present-safety blocks, epistemic prohibitions, prerequisites, or explicitly blocked interventions. The graph constrains safety and justified omissions; it does not own the meaning of the case or require mechanical node coverage. Give one proportionate main next move. ${noOutcomeOverclaim}
Do not mention models, formulation, extraction, audit, graph, routing, or internal machinery. End the answer field in declarative prose. The runtime owns the unchanged canonical question. In realized_nodes list only graph nodes actually used, each with an exact supporting quote from the answer. Return only the requested JSON.`,
    user: `ORIGINAL CURRENT USER MESSAGE:\n${context.userMessage}\n\nORIGINAL RECENT TRANSCRIPT:\n${context.recentTranscript || "(none supplied)"}\n\nIMMUTABLE RAW SEMANTIC FORMULATION:\n${JSON.stringify(semanticFormulation, null, 2)}${tierReasoning ? `\n\nTIER-SPECIFIC REASONING PACKET:\n${JSON.stringify(tierReasoning, null, 2)}` : ""}\n\nRAW CATEGORICAL EXTRACTION:\n${JSON.stringify(rawCaseExtraction, null, 2)}\n\nCASE AUDIT DELTA:\n${JSON.stringify(caseAuditDelta, null, 2)}\n\nCORRECTED VARIABLES:\n${JSON.stringify(auditedSnapshot.variables, null, 2)}\n\nDETERMINISTIC PLAN (ADVISORY EXCEPT FOR ITS HARD AND PREREQUISITE CLASSES):\n${JSON.stringify(plan, null, 2)}\n\nBOUNDED GRAPH AUDIT:\n${JSON.stringify(graphAudit, null, 2)}\n\nHARD AND ADVISORY AUTHORITY:\n${JSON.stringify(authority, null, 2)}\n\nUNCHANGED CANONICAL QUESTION:\n${authority.canonicalQuestion || "(none)"}`
  };
}
