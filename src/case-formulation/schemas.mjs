import { pathUpdateSchema, representationSchema } from "./path-performance.mjs";
import { turnTaskSchema } from "./turn-task.mjs";
import { relationalReadinessSchema } from "./relational-readiness.mjs";
import { romanceGuideContextSchema } from "./romance-guide.mjs";
import { threatPathwaySchema } from "./threat-pathway.mjs";
import { developmentalCapacitySchema, questionEligibilityFindingSchema } from "./developmental-capacity.mjs";
import { CASE_VARIABLE_ENUMS, CASE_VARIABLE_FIELDS } from "../guide-graph/contract.mjs";

const observationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    statement: { type: "string" },
    evidence: { type: "string" }
  },
  required: ["id", "statement", "evidence"]
};

const variableProperties = Object.fromEntries(
  Object.entries(CASE_VARIABLE_ENUMS).map(([field, values]) => [field, { type: "string", enum: values }])
);

const unknownSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    variable: { type: "string" },
    question: { type: "string" },
    importance: { type: "integer", minimum: 1, maximum: 5 },
    // Optional in the persisted schema for backward compatibility. Current prompt
    // contracts ask providers to declare it explicitly.
    changes_next_action: { type: "boolean" },
    developmental_prerequisite_valid: { type: "boolean" }
  },
  required: ["variable", "question", "importance"]
};

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
    developmental_capacity: developmentalCapacitySchema,
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
      items: unknownSchema
    }
  },
  // relational_readiness is optional for historical/mock compatibility. The live
  // candidate extractor is required separately to emit it explicitly as null/object.
  required: ["user_goal", "current_issue", "turn_task", "path_update", "direct_observations", "variables", "hypotheses", "unknowns"]
};

// Provider generation requires all properties declared, with null for optional
// semantics. The historical runtime validator still accepts omitted delivery_review.
export const caseSnapshotGenerationSchema = structuredClone(caseSnapshotSchema);
caseSnapshotGenerationSchema.required.push("relational_readiness", "romance_guide_context", "threat_pathway", "developmental_capacity");
caseSnapshotGenerationSchema.properties.path_update.anyOf[1].required.push("delivery_review", "representation");
caseSnapshotGenerationSchema.properties.unknowns.items.required.push("changes_next_action");
caseSnapshotGenerationSchema.properties.unknowns.items.required.push("developmental_prerequisite_valid");

export const caseAuditSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    corrected_turn_task: turnTaskSchema,
    invalidate_turn_task: { type: "boolean" },
    // Strategy invalidation is separate from observation withdrawal. A target can
    // be semantically wrong even when every underlying observation is true.
    invalidate_path_strategy: { type: "boolean" },
    corrected_path_representation: { anyOf: [{ type: "null" }, representationSchema] },
    invalidate_path_representation: { type: "boolean" },
    corrected_relational_readiness: relationalReadinessSchema,
    invalidate_relational_readiness: { type: "boolean" },
    corrected_romance_guide_context: romanceGuideContextSchema,
    invalidate_romance_guide_context: { type: "boolean" },
    corrected_threat_pathway: threatPathwaySchema,
    invalidate_threat_pathway: { type: "boolean" },
    corrected_developmental_capacity: developmentalCapacitySchema,
    invalidate_developmental_capacity: { type: "boolean" },
    question_eligibility_findings: {
      type: "array",
      maxItems: 24,
      items: questionEligibilityFindingSchema
    },
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
      items: unknownSchema
    },
    safety_flags: { type: "array", items: { type: "string" } },
    verdict: { type: "string", enum: ["accept", "revise", "reject"] },
    summary: { type: "string" }
  },
  required: ["corrected_turn_task", "invalidate_turn_task", "remove_observation_ids", "remove_hypothesis_ids", "variable_corrections", "add_unknowns", "safety_flags", "verdict", "summary"]
};

// Keep historical audit omission compatibility while requiring explicit provider output.
export const caseAuditGenerationSchema = structuredClone(caseAuditSchema);
caseAuditGenerationSchema.required.push(
  "invalidate_path_strategy",
  "corrected_path_representation",
  "invalidate_path_representation",
  "corrected_relational_readiness",
  "invalidate_relational_readiness",
  "corrected_romance_guide_context",
  "invalidate_romance_guide_context",
  "corrected_threat_pathway",
  "invalidate_threat_pathway",
  "corrected_developmental_capacity",
  "invalidate_developmental_capacity",
  "question_eligibility_findings"
);
caseAuditGenerationSchema.properties.add_unknowns.items.required.push("changes_next_action");
caseAuditGenerationSchema.properties.add_unknowns.items.required.push("developmental_prerequisite_valid");
