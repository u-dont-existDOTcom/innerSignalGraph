import { parseModelJson } from "../core/json.mjs";
import { ValidationError } from "../core/errors.mjs";
import {
  boundedGraphAuditPrompt,
  graphAuditSchema,
  modelFirstIntegrationPrompt,
  semanticFormulationPrompt,
  semanticFormulationSchema
} from "../prompts/semantic-formulation.mjs";
import { realizationSchema } from "../schemas/json-schemas.mjs";
import { validateRealization } from "../schemas/validators.mjs";

function validateString(value, label, allowEmpty = false) {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) throw new ValidationError(`${label} must be a string.`);
}

function validateStringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new ValidationError(`${label} must be an array of strings.`);
}

export function validateSemanticFormulation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ValidationError("semantic formulation must be an object.");
  for (const key of ["direct_observations", "important_relationships", "potentially_useful_implications", "unresolved_alternatives", "uncertainty"]) {
    validateStringArray(value[key], `semantic formulation.${key}`);
  }
  validateString(value.central_live_knot, "semantic formulation.central_live_knot");
  validateString(value.proportionate_next_move, "semantic formulation.proportionate_next_move");
  return value;
}

export function validateGraphAudit(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ValidationError("graph audit must be an object.");
  for (const key of ["hard_safety_constraints", "epistemic_prohibitions", "prerequisites", "important_omitted_branches", "sequencing_concerns", "relevant_techniques", "formulation_graph_conflicts", "advisory_opportunities"]) {
    validateStringArray(value[key], `graph audit.${key}`);
  }
  validateString(value.audit_summary, "graph audit.audit_summary");
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

async function structuredCall({ provider, prompt, stage, fixtureKey, schema, validator, onProgress }) {
  const started = Date.now();
  onProgress?.({ stage, status: "started", detail: `${provider.id}/${provider.model}` });
  const raw = await provider.generate({ ...prompt, metadata: { stage, fixtureKey }, outputSchema: schema });
  const value = validator(parseModelJson(raw.text, `${provider.id} ${stage}`));
  const durationMs = Date.now() - started;
  onProgress?.({ stage, status: "completed", detail: `${(durationMs / 1000).toFixed(1)}s` });
  return { value, raw, durationMs };
}

export async function runSemanticFormulation({ context, provider, onProgress }) {
  const result = await structuredCall({
    provider,
    prompt: semanticFormulationPrompt(context, provider.id === "anthropic" ? "Claude" : "OpenAI"),
    stage: "semantic_formulation",
    fixtureKey: "semantic_formulation",
    schema: semanticFormulationSchema,
    validator: validateSemanticFormulation,
    onProgress
  });
  return { ...result, value: deepFreeze(result.value) };
}

export async function runBoundedGraphAudit({ context, semanticFormulation, rawCaseExtraction, caseAuditDelta, auditedSnapshot, plan, authority, provider, onProgress }) {
  return await structuredCall({
    provider,
    prompt: boundedGraphAuditPrompt({ context, semanticFormulation, rawCaseExtraction, caseAuditDelta, auditedSnapshot, plan, authority }),
    stage: "graph_audit",
    fixtureKey: "graph_audit",
    schema: graphAuditSchema,
    validator: validateGraphAudit,
    onProgress
  });
}

export async function runModelFirstIntegration({ context, semanticFormulation, rawCaseExtraction, caseAuditDelta, auditedSnapshot, plan, graphAudit, authority, provider, onProgress }) {
  return await structuredCall({
    provider,
    prompt: modelFirstIntegrationPrompt({ context, semanticFormulation, rawCaseExtraction, caseAuditDelta, auditedSnapshot, plan, graphAudit, authority, rendererName: provider.id === "anthropic" ? "Claude" : "OpenAI" }),
    stage: "model_first_integration",
    fixtureKey: "model_first_integration",
    schema: realizationSchema,
    validator: validateRealization,
    onProgress
  });
}
