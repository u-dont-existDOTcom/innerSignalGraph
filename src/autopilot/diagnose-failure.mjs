import { operationalDiagnosisSchema } from "../schemas/json-schemas.mjs";
import { validateOperationalDiagnosis } from "../schemas/validators.mjs";
import { operationalDiagnosisPrompt } from "../prompts/operational-diagnosis.mjs";
import { parseModelJson } from "../core/json.mjs";

function truncate(value, max = 18000) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return text.length <= max ? text : `${text.slice(0, max)}\n...[truncated]`;
}

export async function diagnoseFailure({ provider, stage, summary, evidence }) {
  if (!provider) return null;
  try {
    const prompt = operationalDiagnosisPrompt({ stage, summary, evidence: truncate(evidence) });
    const raw = await provider.generate({
      ...prompt,
      outputSchema: operationalDiagnosisSchema,
      metadata: { stage: "autopilot_failure_diagnosis" }
    });
    return validateOperationalDiagnosis(parseModelJson(raw.text, "autopilot operational diagnosis"));
  } catch {
    return null;
  }
}
