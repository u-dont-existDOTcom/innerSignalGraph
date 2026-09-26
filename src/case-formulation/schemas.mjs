import { pathUpdateSchema, representationSchema, strategyReviewSchema } from "./path-performance.mjs";
import { turnTaskSchema } from "./turn-task.mjs";
import { relationalReadinessSchema } from "./relational-readiness.mjs";
import { romanceGuideContextSchema } from "./romance-guide.mjs";
import { threatPathwaySchema } from "./threat-pathway.mjs";
import { innerSpeechProfileSchema, observationPhenomenologySchema } from "./phenomenology.mjs";
import { compatibilityAssessmentSchema } from "./protective-compatibility.mjs";
import { focusReclassificationsSchema, sessionFocusSchema, unknownFocusProperties } from "./focus-discipline.mjs";
import { CASE_VARIABLE_ENUMS, CASE_VARIABLE_FIELDS } from "../guide-graph/contract.mjs";

const observationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    statement: { type: "string" },
    evidence: { type: "string" },
    phenomenology: observationPhenomenologySchema
  },
  // Historical snapshots remain valid without the newer provenance field. The
  // provider-generation schema below requires an explicit null/object.
  required: ["id", "statement", "evidence"]
};

const variableProperties = Object.fromEntries(
  Object.entries(CASE_VARIABLE_ENUMS).map(([field, values]) => [field, { type: "string", enum: values }])
);

export const caseSnapshotSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    user_goal: { type: "string" },
    current_issue: { type: "string" },
    turn_task: turnTaskSchema,
    path_update: pathUpdateSchema,
    relational_readiness: relationalReadinessSchema,
    romance_guide_context: romanceGuideContextSchema,
    threat_pathway: threatPathwaySchema,
    compatibility_assessment: compatibilityAssessmentSchema,
    inner_speech_profile: innerSpeechProfileSchema,
    session_focus: sessionFocusSchema,
    direct_observations: { type: "array", items: observationSchema },
    variables: {
      type: "object",
      additionalProperties: false,
      properties: variableProperties,
      required: CASE_VARIABLE_FIELDS
    },
    hypotheses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          claim: { type: "string" },
          evidence: { type: "string" },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
          alternatives: { type: "array", items: { type: "string" } }
        },
        required: ["id", "claim", "evidence", "confidence", "alternatives"]
      }
    },
    unknowns: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          variable: { type: "string" },
          question: { type: "string" },
          importance: { type: "integer", minimum: 1, maximum: 5 },
          ...unknownFocusProperties
        },
        required: ["variable", "question", "importance"]
      }
    }
  },
  // Newer semantic fields remain optional for historical/mock compatibility.
  // The live candidate extractor is required separately to emit them explicitly.
  required: ["user_goal", "current_issue", "turn_task", "path_update", "direct_observations", "variables", "hypotheses", "unknowns"]
};

// Provider generation requires all newer semantic fields declared, with null for
// unavailable evidence. Historical runtime snapshots remain compatible.
export const caseSnapshotGenerationSchema = structuredClone(caseSnapshotSchema);
caseSnapshotGenerationSchema.required.push("relational_readiness", "romance_guide_context", "threat_pathway", "compatibility_assessment", "inner_speech_profile");
caseSnapshotGenerationSchema.required.push("session_focus");
caseSnapshotGenerationSchema.properties.unknowns.items.required.push("focus_relation", "why_it_matters");
caseSnapshotGenerationSchema.properties.direct_observations.items.required.push("phenomenology");
caseSnapshotGenerationSchema.properties.path_update.anyOf[1].required.push("delivery_review", "representation", "strategy_review");
caseSnapshotGenerationSchema.properties.path_update.anyOf[1].properties.strategy.anyOf[1].required.push("evaluation_contract");

export const caseAuditSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    corrected_turn_task: turnTaskSchema,
    invalidate_turn_task: { type: "boolean" },
    corrected_path_representation: { anyOf: [{ type: "null" }, representationSchema] },
    invalidate_path_representation: { type: "boolean" },
    corrected_strategy_review: { anyOf: [{ type: "null" }, strategyReviewSchema] },
    invalidate_strategy_review: { type: "boolean" },
    corrected_relational_readiness: relationalReadinessSchema,
    invalidate_relational_readiness: { type: "boolean" },
    corrected_romance_guide_context: romanceGuideContextSchema,
    invalidate_romance_guide_context: { type: "boolean" },
    corrected_threat_pathway: threatPathwaySchema,
    invalidate_threat_pathway: { type: "boolean" },
    corrected_compatibility_assessment: compatibilityAssessmentSchema,
    invalidate_compatibility_assessment: { type: "boolean" },
    remove_observation_ids: { type: "array", items: { type: "string" } },
    remove_hypothesis_ids: { type: "array", items: { type: "string" } },
    variable_corrections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          field: { type: "string", enum: CASE_VARIABLE_FIELDS },
          value: { type: "string" },
          reason: { type: "string" }
        },
        required: ["field", "value", "reason"]
      }
    },
    add_unknowns: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          variable: { type: "string" },
          question: { type: "string" },
          importance: { type: "integer", minimum: 1, maximum: 5 },
          ...unknownFocusProperties
        },
        required: ["variable", "question", "importance"]
      }
    },
    corrected_session_focus: sessionFocusSchema,
    focus_reclassifications: focusReclassificationsSchema,
    safety_flags: { type: "array", items: { type: "string" } },
    verdict: { type: "string", enum: ["accept", "revise", "reject"] },
    summary: { type: "string" }
  },
  required: ["corrected_turn_task", "invalidate_turn_task", "remove_observation_ids", "remove_hypothesis_ids", "variable_corrections", "add_unknowns", "safety_flags", "verdict", "summary"]
};

// Keep historical audit omission compatibility while requiring explicit provider output.
export const caseAuditGenerationSchema = structuredClone(caseAuditSchema);
caseAuditGenerationSchema.required.push(
  "corrected_path_representation",
  "invalidate_path_representation",
  "corrected_strategy_review",
  "invalidate_strategy_review",
  "corrected_relational_readiness",
  "invalidate_relational_readiness",
  "corrected_romance_guide_context",
  "invalidate_romance_guide_context",
  "corrected_threat_pathway",
  "invalidate_threat_pathway",
  "corrected_compatibility_assessment",
  "invalidate_compatibility_assessment",
  "corrected_session_focus",
  "focus_reclassifications"
);
caseAuditGenerationSchema.properties.add_unknowns.items.required.push("focus_relation", "why_it_matters");
