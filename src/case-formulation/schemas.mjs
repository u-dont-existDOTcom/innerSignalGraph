import { pathUpdateSchema } from "./path-performance.mjs";
import { turnTaskSchema } from "./turn-task.mjs";
import { relationalReadinessSchema } from "./relational-readiness.mjs";
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

export const caseSnapshotSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    user_goal: { type: "string" },
    current_issue: { type: "string" },
    turn_task: turnTaskSchema,
    path_update: pathUpdateSchema,
    relational_readiness: relationalReadinessSchema,
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
          importance: { type: "integer", minimum: 1, maximum: 5 }
        },
        required: ["variable", "question", "importance"]
      }
    }
  },
  // relational_readiness is optional for historical/mock compatibility. The live
  // candidate extractor is required separately to emit it explicitly as null/object.
  required: ["user_goal", "current_issue", "turn_task", "path_update", "direct_observations", "variables", "hypotheses", "unknowns"]
};

// Provider generation requires all properties declared, with null for optional
// semantics. The historical runtime validator still accepts omitted delivery_review.
export const caseSnapshotGenerationSchema = structuredClone(caseSnapshotSchema);
caseSnapshotGenerationSchema.required.push("relational_readiness");
caseSnapshotGenerationSchema.properties.path_update.anyOf[1].required.push("delivery_review");

export const caseAuditSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    corrected_turn_task: turnTaskSchema,
    invalidate_turn_task: { type: "boolean" },
    corrected_relational_readiness: relationalReadinessSchema,
    invalidate_relational_readiness: { type: "boolean" },
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
          importance: { type: "integer", minimum: 1, maximum: 5 }
        },
        required: ["variable", "question", "importance"]
      }
    },
    safety_flags: { type: "array", items: { type: "string" } },
    verdict: { type: "string", enum: ["accept", "revise", "reject"] },
    summary: { type: "string" }
  },
  required: ["corrected_turn_task", "invalidate_turn_task", "remove_observation_ids", "remove_hypothesis_ids", "variable_corrections", "add_unknowns", "safety_flags", "verdict", "summary"]
};

// Keep historical audit omission compatibility while requiring explicit provider output.
export const caseAuditGenerationSchema = structuredClone(caseAuditSchema);
caseAuditGenerationSchema.required.push("corrected_relational_readiness", "invalidate_relational_readiness");
