import { runHypnosisCompilerPipeline } from "../orchestrator/run-hypnosis-compiler.mjs";

function feedbackFrom(result, attempt) {
  return {
    attempt,
    deterministic_issues: result?.deterministicAudit?.issues ?? [],
    final_verdict: result?.finalReview?.verdict ?? "unknown",
    remaining_issues: result?.finalReview?.remaining_issues ?? [],
    instruction: "Correct the specific remaining issues without weakening app-owned consent, route isolation, or the waking return contract. Do not repeat rejected wording."
  };
}

export async function runHypnosisAutopilot({ context, providers, config, caseId, onProgress }) {
  const attempts = [];
  let currentContext = context;
  for (let attempt = 1; attempt <= config.autopilotMaxHypnosisAttempts; attempt += 1) {
    onProgress?.({ stage: `H001-attempt-${attempt}`, status: "started", detail: `of ${config.autopilotMaxHypnosisAttempts}` });
    try {
      const result = await runHypnosisCompilerPipeline({
        context: currentContext,
        providers,
        config,
        caseId: `${caseId}-attempt-${attempt}`,
        onProgress
      });
      attempts.push({ attempt, anthropicModel: providers.anthropic.model, openaiModel: providers.openai.model, result });
      if (result.releaseable) {
        onProgress?.({ stage: `H001-attempt-${attempt}`, status: "completed", detail: "releaseable" });
        return { ok: true, result, attempts };
      }
      onProgress?.({ stage: `H001-attempt-${attempt}`, status: "failed", detail: result.finalReview?.verdict ?? "blocked" });
      currentContext = { ...context, autopilotFeedback: feedbackFrom(result, attempt) };
    } catch (error) {
      attempts.push({
        attempt,
        anthropicModel: providers.anthropic.model,
        openaiModel: providers.openai.model,
        error: { message: error.message, code: error.code, details: error.details }
      });
      onProgress?.({ stage: `H001-attempt-${attempt}`, status: "failed", detail: error.message });
      currentContext = {
        ...context,
        autopilotFeedback: {
          attempt,
          error: error.message,
          instruction: "Return valid structured output matching the exact schema and preserve all safety constraints."
        }
      };
    }
  }
  return { ok: false, result: attempts.at(-1)?.result ?? null, attempts };
}
