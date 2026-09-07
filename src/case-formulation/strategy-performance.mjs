// Current-session strategy review. Evidence labels are audited interpretations,
// not clinical measurements, and this module owns no storage or model calls.
const text = { type: "string", maxLength: 1600 };
export const strategyReviewSchema = {
  anyOf: [{ type: "null" }, {
    type: "object", additionalProperties: false,
    properties: {
      target: text,
      expected_change: text,
      fit: { type: "string", enum: ["unknown", "fitting", "poor_fit", "rupture"] },
      fit_observation_ids: { type: "array", maxItems: 12, items: { type: "string", maxLength: 160 } },
      outcome: { type: "string", enum: ["improving", "no_yield", "worsening", "mixed", "unknown"] },
      outcome_observation_ids: { type: "array", maxItems: 12, items: { type: "string", maxLength: 160 } },
      review_due: { type: "boolean" },
      alternative_angle: text,
      alternative_node_id: { type: "string", maxLength: 160 }
    }, required: ["target", "expected_change", "fit", "fit_observation_ids", "outcome", "outcome_observation_ids", "review_due", "alternative_angle", "alternative_node_id"]
  }]
};

export function validateStrategyEvidence(review, task, fail) {
  if (!review) return;
  if (!review.target.trim() || !review.expected_change.trim()) fail("Strategy review needs a target and expected change.");
  const taskIds = new Set(task.observation_ids);
  const fitIds = review.fit_observation_ids;
  if (new Set(fitIds).size !== fitIds.length || fitIds.some(id => !taskIds.has(id))) fail("Strategy fit needs current task observation references.");
  if (review.fit !== "unknown" && !fitIds.length) fail("Strategy fit cannot be asserted without observations.");
  const ids = review.outcome_observation_ids;
  if (new Set(ids).size !== ids.length || ids.some(id => !taskIds.has(id))) fail("Strategy outcomes need current task observation references.");
  if (review.outcome !== "unknown" && !ids.length) fail("Strategy outcomes cannot be asserted without observations.");
  if (!review.review_due && review.outcome !== "unknown") fail("A pending outcome cannot establish success or failure.");

}

export function strategyPerformanceDecision(task) {
  const result = (status, pauseCurrent, compareAlternatives) => ({ status, pauseCurrent, compareAlternatives });
  if (!task || task.phase === "close") return result("NO_ACTIVE_REVIEW", false, false);
  if (task.agreement === "declined") return result("RESPECT_REFUSAL", true, false);
  const review = task.strategy_review;
  if (!review) return result("UNMEASURED", false, false);
  if (review.fit === "rupture") return result("REPAIR_RELATIONSHIP", true, true);
  if (review.fit === "poor_fit") return result("REASSESS_FIT", true, true);
  // The audited label describes the target's reported response over a meaningful
  // opportunity. Never manufacture episode counts or clinical cutoffs from text.
  if (!review.review_due || review.outcome === "unknown") return result("OUTCOME_UNKNOWN", false, false);
  if (review.outcome === "worsening") return result("REASSESS_WORSENING", true, true);
  if (review.outcome === "no_yield") return result("REASSESS_NO_YIELD", true, true);
  if (review.outcome === "mixed") return result("ADAPT_AND_REVIEW", false, true);
  return result("CONTINUE_WITH_REVIEW", false, false);

}

export function strategyPerformanceGuidance(review, decision) {
  if (!review || ["NO_ACTIVE_REVIEW", "RESPECT_REFUSAL"].includes(decision.status)) return [];
  const common = "Judge the agreed target and expected change against the reported effects, including ordinary-life functioning and delayed costs. Agreement, exercise completion, articulate insight, intensity, silence and app engagement are not proof of benefit. Treat causal attribution as uncertain.";
  if (decision.pauseCurrent) return [common,
    "Pause the current exercise. Acknowledge the mismatch without blaming the person. If the app misunderstood or pressured them, repair that first. Compare the current formulation with a materially different explanation or approach, including practical help, human support, a pause or no exercise; changing wording alone is not a new strategy.",
    "Offer at most one fitting alternative or ask one premise-light question that distinguishes the alternatives. An eligible graph node is not consent to perform its exercise. Do not intensify, search for hidden memories, or treat lack of benefit as resistance. Keep existing protection and clinical-support routes first."
  ];
  if (decision.status === "ADAPT_AND_REVIEW") return [common, "Preserve the useful part and examine the reported cost or mismatch. Compare one adjustment with a different permitted angle; do not automatically restart or switch the whole method."];
  if (decision.status === "CONTINUE_WITH_REVIEW") return [common, "Carry forward the supported gain and continue only while the task remains wanted and useful. Check later effects at a meaningful opportunity; do not declare the person healed."];
  return [common, "Missing or early outcome evidence is uncertainty, not success or failure. Do not repeat the exercise merely to fill the gap. If the answer would change the next move, use one low-burden fit or outcome question; respect refusal to review and allow time for delayed effects."];
}
