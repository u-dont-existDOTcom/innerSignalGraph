const stringArray = {
  type: "array",
  items: { type: "string" }
};

export const candidateSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    direct_observations: stringArray,
    interpretive_hypotheses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          claim: { type: "string" },
          support: { type: "string" },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
          alternatives: stringArray
        },
        required: ["claim", "support", "confidence", "alternatives"]
      }
    },
    guide_basis: stringArray,
    unresolved_questions: stringArray,
    proposed_intervention: { type: "string" },
    response_draft: { type: "string" },
    risk_flags: stringArray
  },
  required: [
    "direct_observations",
    "interpretive_hypotheses",
    "guide_basis",
    "unresolved_questions",
    "proposed_intervention",
    "response_draft",
    "risk_flags"
  ]
};

export const critiqueSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    strongest_insights: stringArray,
    unsupported_assignments: stringArray,
    generic_therapy_scripts: stringArray,
    missed_user_language: stringArray,
    premature_siding: stringArray,
    age_or_agency_conflations: stringArray,
    guide_misapplications: stringArray,
    safety_or_memory_risks: stringArray,
    required_corrections: stringArray,
    verdict: { type: "string", enum: ["accept", "revise", "reject"] }
  },
  required: [
    "strongest_insights",
    "unsupported_assignments",
    "generic_therapy_scripts",
    "missed_user_language",
    "premature_siding",
    "age_or_agency_conflations",
    "guide_misapplications",
    "safety_or_memory_risks",
    "required_corrections",
    "verdict"
  ]
};

export const adjudicationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    answer: { type: "string" },
    what_is_clear: stringArray,
    uncertainties: stringArray,
    next_question: { type: "string" },
    accepted_insights: stringArray,
    rejected_claims: stringArray,
    safety_flags: stringArray,
    decision_summary: { type: "string" }
  },
  required: [
    "answer",
    "what_is_clear",
    "uncertainties",
    "next_question",
    "accepted_insights",
    "rejected_claims",
    "safety_flags",
    "decision_summary"
  ]
};


export const realizationSchema = {
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


export const operationalDiagnosisSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    category: { type: "string", enum: ["environment", "authentication", "cli_compatibility", "model_selector", "package_defect", "model_contract", "user_decision", "unknown"] },
    retryable: { type: "boolean" },
    automatic_fix_available: { type: "boolean" },
    human_action_required: { type: "boolean" },
    summary: { type: "string" },
    next_action: { type: "string" },
    do_not_do: stringArray,
    internal_note: { type: "string" }
  },
  required: ["category", "retryable", "automatic_fix_available", "human_action_required", "summary", "next_action", "do_not_do", "internal_note"]
};

export const entitlementSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    ok: { type: "boolean" }
  },
  required: ["ok"]
};

const hypnosisScopeSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    memory: { type: "string", enum: ["no-memory-recovery"] },
    identity: { type: "string", enum: ["ordinary-adult-identity"] },
    post_session: { type: "string", enum: ["no-automatic-cues"] },
    substances: { type: "string", enum: ["no-substance-guidance"] }
  },
  required: ["memory", "identity", "post_session", "substances"]
};

export const hypnosisDraftSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    contract_version: { type: "string", enum: ["hypnosis-components-v1"] },
    language: { type: "string", enum: ["en"] },
    relationship: { type: "string", enum: ["command", "communion"] },
    target: { type: "string" },
    premise: { type: "string" },
    orientation: { type: "string" },
    continue_inward: {
      type: "object",
      additionalProperties: false,
      properties: {
        induction: { type: "string" },
        deepening: { type: "string" },
        target_work: { type: "string" },
        integration: { type: "string" },
        return_lead: { type: "string" }
      },
      required: ["induction", "deepening", "target_work", "integration", "return_lead"]
    },
    stay_external: {
      type: "object",
      additionalProperties: false,
      properties: {
        grounding: { type: "string" },
        ordinary_choice: { type: "string" }
      },
      required: ["grounding", "ordinary_choice"]
    },
    aftercare: { type: "string" },
    scope: hypnosisScopeSchema,
    design_notes: stringArray
  },
  required: [
    "contract_version",
    "language",
    "relationship",
    "target",
    "premise",
    "orientation",
    "continue_inward",
    "stay_external",
    "aftercare",
    "scope",
    "design_notes"
  ]
};

export const hypnosisReviewSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: ["accept", "revise", "reject"] },
    strengths: stringArray,
    structural_issues: stringArray,
    semantic_issues: stringArray,
    consent_issues: stringArray,
    hypnosis_craft_issues: stringArray,
    target_scope_issues: stringArray,
    return_issues: stringArray,
    required_repairs: stringArray
  },
  required: [
    "verdict",
    "strengths",
    "structural_issues",
    "semantic_issues",
    "consent_issues",
    "hypnosis_craft_issues",
    "target_scope_issues",
    "return_issues",
    "required_repairs"
  ]
};

export const hypnosisFinalReviewSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: ["pass", "revise", "reject"] },
    accepted_strengths: stringArray,
    remaining_issues: stringArray,
    release_summary: { type: "string" }
  },
  required: ["verdict", "accepted_strengths", "remaining_issues", "release_summary"]
};
