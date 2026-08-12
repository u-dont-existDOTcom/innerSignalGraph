import { CodexCliProvider } from "../providers/codex-cli.mjs";
import { parseModelJson } from "../core/json.mjs";
import { DEV_FAILURE, classifyDevelopmentFailure } from "./failure-classification.mjs";

const reviewSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: ["approve", "reject", "human-decision"] },
    policy_change: { type: "string", enum: ["none", "restorative", "substantive", "uncertain"] },
    promotion_safe: { type: "boolean" },
    safety_guard_weakening: { type: "boolean" },
    test_weakening: { type: "boolean" },
    findings: { type: "array", items: { type: "string" } },
    required_changes: { type: "array", items: { type: "string" } },
    human_decision_reason: { type: "string" },
    behavioral_effect: { type: "string" },
    worst_plausible_failure: { type: "string" },
    confidence: { type: "string", enum: ["low", "medium", "high"] }
  },
  required: ["verdict", "policy_change", "promotion_safe", "safety_guard_weakening", "test_weakening", "findings", "required_changes", "human_decision_reason", "behavioral_effect", "worst_plausible_failure", "confidence"]
};

const comparisonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: ["improved", "not-improved", "human-decision"] },
    addresses_feedback: { type: "boolean" },
    preserves_prior_strengths: { type: "boolean" },
    introduces_new_overclaim: { type: "boolean" },
    findings: { type: "array", items: { type: "string" } },
    human_decision_reason: { type: "string" },
    behavioral_effect: { type: "string" },
    worst_plausible_failure: { type: "string" },
    confidence: { type: "string", enum: ["low", "medium", "high"] }
  },
  required: ["verdict", "addresses_feedback", "preserves_prior_strengths", "introduces_new_overclaim", "findings", "human_decision_reason", "behavioral_effect", "worst_plausible_failure", "confidence"]
};

export async function runCandidateCodeReview({ config, candidateRoot, developmentCase, audit, gates, changes, timeoutMs = config.devReviewTimeoutMs ?? config.requestTimeoutMs }) {
  const reviewer = new CodexCliProvider({
    command: config.codexCommand,
    model: config.devReviewModel,
    reasoningEffort: "high",
    timeoutMs,
    cwd: candidateRoot,
    isolateConfig: true
  });
  const system = `You are the independent Inner Signal patch reviewer. Inspect the candidate repository read-only, especially .inner-signal-dev/DEVELOPMENT_CASE.json, DEVELOPMENT_AUDIT.json, DEVELOPMENT_CHANGESET.json, and the changed source/tests. Deterministic gate results are supplied below. Reject any safety/consent/epistemic weakening, test weakening, evidence overclaim, unrelated broad refactor, or repair that does not reproduce the user's complaint. Classify whether the patch merely restores already-approved behavior or changes substantive therapy policy. A substantive/uncertain policy change requires a human decision. Do not approve merely because tests pass.`;
  const user = `DEVELOPMENT CASE SUMMARY:\n${JSON.stringify({ feedback: developmentCase.feedback, audit, gates, changes }, null, 2)}\n\nInspect the actual candidate files before deciding.`;
  const raw = await reviewer.generate({ system, user, outputSchema: reviewSchema, metadata: { stage: "development_patch_review" } });
  return { ...parseModelJson(raw.text, "development patch review"), model: reviewer.model, requestId: raw.requestId };
}

export async function runReplayComparisonReview({ config, candidateRoot, developmentCase, audit, candidateResult, timeoutMs = config.devReviewTimeoutMs ?? config.requestTimeoutMs }) {
  const reviewer = new CodexCliProvider({
    command: config.codexCommand,
    model: config.devReviewModel,
    reasoningEffort: "high",
    timeoutMs,
    cwd: candidateRoot,
    isolateConfig: true
  });
  const original = developmentCase.ledger?.result ?? {};
  const system = `You are the independent Inner Signal regression adjudicator. Compare the exact original user-rated response with the candidate replay using the user's feedback and the development audit. Judge whether the candidate actually fixes the reported issue while preserving the original response's valid insights, uncertainty, safety, and route fidelity. Do not prefer different wording merely because it is different. If the requested behavior involves a genuine therapy-policy choice rather than a fidelity repair, require human decision.`;
  const user = JSON.stringify({ feedback: developmentCase.feedback, audit, original: { answer: original.answer, processingMs: original.processingMs, processingTier: original.processingTier, interventionContract: original.interventionContract }, candidate: { answer: candidateResult.answer, processingMs: candidateResult.processingMs, processingTier: candidateResult.processingTier, interventionContract: candidateResult.interventionContract, responseContract: candidateResult.responseContract } }, null, 2);
  const raw = await reviewer.generate({ system, user, outputSchema: comparisonSchema, metadata: { stage: "development_replay_comparison" } });
  return { ...parseModelJson(raw.text, "development replay comparison"), model: reviewer.model, requestId: raw.requestId };
}

export async function runRoadmapCandidateReview({ config, candidateRoot, roadmapTask, audit, gates, changes, timeoutMs = config.devReviewTimeoutMs ?? config.requestTimeoutMs }) {
  const reviewer = new CodexCliProvider({
    command: config.codexCommand,
    model: config.devReviewModel,
    reasoningEffort: "high",
    timeoutMs,
    cwd: candidateRoot,
    isolateConfig: true
  });
  const system = `You are the independent Inner Signal autonomous-roadmap patch reviewer. Inspect the candidate repository read-only, especially .inner-signal-dev/DEVELOPMENT_CASE.json, DEVELOPMENT_AUDIT.json, DEVELOPMENT_CHANGESET.json, and the changed source/tests. Determine whether the candidate actually advances the stated engineering roadmap task while preserving therapy routing, guide policy, epistemic caution, hypnosis consent/return contracts, and all existing safety boundaries. Reject test weakening, safety weakening, evidence overclaim, benchmark gaming, unrelated broad refactors, or a patch whose claimed acceptance evidence is not present in the repository/gates. Classify substantive product-policy changes as human-decision. Do not approve merely because tests pass.`;
  const user = `ROADMAP TASK AND GATES:\n${JSON.stringify({ roadmapTask, audit, gates, changes }, null, 2)}\n\nInspect the actual candidate files before deciding.`;
  const raw = await reviewer.generate({ system, user, outputSchema: reviewSchema, metadata: { stage: "roadmap_patch_review" } });
  return { ...parseModelJson(raw.text, "roadmap patch review"), model: reviewer.model, requestId: raw.requestId };
}


export async function runReviewWithRecovery({ attempt, normalTimeoutMs, extendedTimeoutMs, onAttempt = () => {} }) {
  const attempts = [];
  const timeouts = [normalTimeoutMs, extendedTimeoutMs];
  for (let index = 0; index < timeouts.length; index += 1) {
    const timeoutMs = timeouts[index];
    const attemptNumber = index + 1;
    onAttempt({ attemptNumber, timeoutMs });
    try {
      const result = await attempt(timeoutMs, attemptNumber);
      attempts.push({ attemptNumber, timeoutMs, ok: true });
      return { status: "completed", result, attempts, failureClass: null };
    } catch (error) {
      const failureClass = classifyDevelopmentFailure(error, { phase: "independent-review" });
      attempts.push({ attemptNumber, timeoutMs, ok: false, failureClass, message: error.message });
      if (failureClass !== DEV_FAILURE.REVIEW_TIMEOUT) throw error;
    }
  }
  return { status: "review-pending", result: null, attempts, failureClass: DEV_FAILURE.REVIEW_TIMEOUT };
}
