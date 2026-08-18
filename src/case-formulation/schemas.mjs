import { CASE_VARIABLE_ENUMS, CASE_VARIABLE_FIELDS } from "../guide-graph/contract.mjs";
import {
  PROTOCOL_PROFILE_ENUMS,
  PROTOCOL_PROFILE_FIELDS,
  PROTOCOL_TEXT_FIELDS
} from "../therapy-protocol/contract.mjs";

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

const protocolProperties = {
  ...Object.fromEntries(
    Object.entries(PROTOCOL_PROFILE_ENUMS).map(([field, values]) => [field, { type: "string", enum: values }])
  ),
  ...Object.fromEntries(PROTOCOL_TEXT_FIELDS.map((field) => [field, { type: "string" }]))
};

const protocolProfileSchema = {
  type: "object",
  additionalProperties: false,
  properties: protocolProperties
};

export const caseSnapshotSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    user_goal: { type: "string" },
    current_issue: { type: "string" },
    direct_observations: { type: "array", items: observationSchema },
    variables: {
      type: "object",
      additionalProperties: false,
      properties: variableProperties,
      required: CASE_VARIABLE_FIELDS
    },
    protocol_profile: protocolProfileSchema,
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
  required: ["user_goal", "current_issue", "direct_observations", "variables", "hypotheses", "unknowns"]
};

export const caseAuditSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
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
    protocol_profile_corrections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          field: { type: "string", enum: [...PROTOCOL_PROFILE_FIELDS, ...PROTOCOL_TEXT_FIELDS] },
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
  required: [
    "remove_observation_ids",
    "remove_hypothesis_ids",
    "variable_corrections",
    "protocol_profile_corrections",
    "add_unknowns",
    "safety_flags",
    "verdict",
    "summary"
  ]
};
