// Owner-authorized candidate policy. These are audited current-session judgments,
// not a diagnostic score, clinical clearance, permanent prohibition or data store.
const text = { type: "string", maxLength: 1600 };
const ids = { type: "array", maxItems: 12, items: { type: "string", maxLength: 160 } };
const choice = values => ({ type: "string", enum: values });
const record = properties => ({ type: "object", additionalProperties: false, properties, required: Object.keys(properties) });
export const relationalReadinessSchema = { anyOf: [{ type: "null" }, record({
  scope: choice(["romantic_sexual_pursuit", "support_building"]),
  current_stability: choice(["sufficient", "insufficient", "unknown"]),
  stability_observation_ids: ids,
  foreseeable_harm: choice(["substantial", "not_substantial", "unknown"]),
  harm_observation_ids: ids,
  harm_to: { type: "array", maxItems: 4, items: choice(["self", "partner", "dependent_children", "future_children"]) },
  risk_signals: { type: "array", maxItems: 12, items: record({
    kind: choice(["hospitalization", "reality_testing", "suicidality_self_harm", "substance_dependence_relapse", "violent_dyscontrol", "self_care", "dissociation", "dependency", "relational_preoccupation", "escalating_pursuit", "partner_as_regulator", "other"]),
    timeframe: choice(["current", "historical", "unknown"]), observation_ids: ids
  }) },
  trajectory: choice(["improving", "stable", "worsening", "unknown"]),
  trajectory_observation_ids: ids,
  support_purpose: choice(["nonromantic", "partner_seeking", "mixed", "unknown"]),
  support_observation_ids: ids,
  supports: text, supports_observation_ids: ids,
  reasons: text,
  readiness_markers: { type: "array", maxItems: 8, items: text },
  review_when: text
})] };

export function validateRelationalEvidence(readiness, task, fail) {
  if (!readiness) return;
  const taskIds = new Set(task.observation_ids);
  const references = (values, required = false) => {
    if ((required && !values.length) || new Set(values).size !== values.length || values.some(id => !taskIds.has(id))) fail("Relational readiness needs current task observation references.");
  };
  for (const [field, evidence] of [["current_stability", "stability_observation_ids"], ["foreseeable_harm", "harm_observation_ids"], ["trajectory", "trajectory_observation_ids"], ["support_purpose", "support_observation_ids"]]) {
    references(readiness[evidence], readiness[field] !== "unknown");
  }
  references(readiness.supports_observation_ids, Boolean(readiness.supports.trim()));
  for (const signal of readiness.risk_signals) references(signal.observation_ids, true);
  if (!readiness.reasons.trim() || !readiness.review_when.trim() || !readiness.readiness_markers.length || readiness.readiness_markers.some(marker => !marker.trim())) fail("Relational readiness needs reasons and revisitable readiness markers.");
  if (new Set(readiness.harm_to).size !== readiness.harm_to.length || (readiness.foreseeable_harm === "substantial" && !readiness.harm_to.length)) fail("Substantial relational harm needs an identified affected party.");
}

const dependencySignals = new Set(["dependency", "relational_preoccupation", "escalating_pursuit", "partner_as_regulator"]);
export function relationalReadinessDecision(readiness, { immediateProtection = false } = {}) {
  if (!readiness) return null;
  const instrumental = ["partner_seeking", "mixed"].includes(readiness.support_purpose);
  const adverse = readiness.trajectory === "worsening" && readiness.risk_signals.some(signal => signal.timeframe === "current" && dependencySignals.has(signal.kind));
  const pause = immediateProtection || readiness.foreseeable_harm === "substantial" || adverse;
  const ready = !pause && readiness.current_stability === "sufficient" && readiness.foreseeable_harm === "not_substantial";
  const status = pause ? "PAUSE_ROMANCE" : ready ? "NOT_BLOCKED" : "ASSESS_BEFORE_ROMANCE";
  return {
    version: 1, status, allowRomanceRecommendation: ready, pauseRomance: pause,
    nonRomanticSupportAllowed: true,
    supportProgress: instrumental ? "NOT_EQUIVALENT_TO_NONROMANTIC_SUPPORT" : "REQUIRES_OBSERVED_BENEFIT",
    adverseTrajectory: adverse,
    pauseCurrent: (readiness.scope === "romantic_sexual_pursuit" && !ready) || (readiness.scope === "support_building" && instrumental) || adverse,
    reasonCodes: [
      ...(immediateProtection ? ["IMMEDIATE_PROTECTION"] : []),
      ...(readiness.foreseeable_harm === "substantial" ? ["CURRENT_FORESEEABLE_HARM"] : []),
      ...(adverse ? ["WORSENING_RELATIONAL_DEPENDENCY"] : []),
      ...(instrumental ? ["SUPPORT_SUBSTITUTION"] : []),
      ...(!pause && !ready ? ["CURRENT_READINESS_UNRESOLVED"] : []),
      ...(ready ? ["CURRENT_STABILITY_AND_HARM_ASSESSED"] : [])
    ],
    // Preserve the assessed evidence, counterevidence, supports and reopening
    // conditions with this decision in the existing private strategy episode.
    assessment: structuredClone(readiness)
  };
}

export function relationalReadinessGuidance(decision) {
  if (!decision) return [];
  const common = "Distinguish romantic/sexual involvement from friendship, community and practical support. Readiness concerns current functioning, foreseeable serious harm to self, partner and dependent or future children, load and responsibility; it is not worthiness, moral purity, complete healing or 'love yourself first'. A diagnosis or hospitalization history alone is never a permanent ban. Generic evidence that connection helps cannot override this case-specific harm assessment.";
  const status = decision.status === "PAUSE_ROMANCE"
    ? "Explicitly recommend pausing active romance-seeking for now, explain the evidenced current reasons and revisit when the stated readiness markers improve. Do not facilitate pursuit, normalize dating as safe, or turn the pause into a compulsory breakup or a permanent prohibition."
    : decision.status === "ASSESS_BEFORE_ROMANCE"
      ? "Current readiness is unresolved. Do not normalize or recommend dating before assessing the missing current functional stability and harm evidence; uncertainty is not a permanent prohibition."
      : "Current evidence does not block dating. Do not impose a full-healing prerequisite or treat loneliness, diagnosis or historical hospitalization as disqualifying. This is not clinical clearance or a guarantee of safety.";
  return [common, status,
    "Do not advise isolation. Offer one fitting form of non-romantic support: friendship, peer support, mentoring or a structured supervised/community setting. Therapeutic community, care-farm/green-care or Soteria-like settings are possible locally dependent options, not universally suitable or a replacement for needed immediate care. Do not change medication or prescribe a level of care from this gate.",
    ...(decision.supportProgress === "NOT_EQUIVALENT_TO_NONROMANTIC_SUPPORT" ? ["Socializing primarily to obtain a partner does not count as successful non-romantic support-building. Preserve any separately evidenced friendship gains, but reassess substitution and offer a genuinely non-romantic support context."] : []),
    ...(decision.adverseTrajectory ? ["Worsening dependency, relational preoccupation or pursuit, including a partner used as analgesic, reality anchor, rescuer or proof of worth, is an adverse trajectory. Reassess toward external stabilization rather than counting temporary relief as progress."] : [])
  ];
}

export const relationalAdviceSchema = record({
  romance: choice(["not_addressed", "discuss_without_endorsement", "normalize_or_recommend", "pause"]),
  support: choice(["not_addressed", "offer_nonromantic", "acknowledge_partial_friendship_gain", "claim_support_progress"]),
  evidence_quote: text
});

// Checks declared action semantics and a verbatim grounding quote. It cannot
// establish that unclaimed prose is safe; that requires separate semantic review.
export function relationalAdviceViolations(advice, decision, answer) {
  if (!decision) return [];
  if (!advice || Object.keys(advice).some(key => !Object.hasOwn(relationalAdviceSchema.properties, key))
      || !relationalAdviceSchema.properties.romance.enum.includes(advice.romance)
      || !relationalAdviceSchema.properties.support.enum.includes(advice.support)
      || typeof advice.evidence_quote !== "string" || advice.evidence_quote.length > 1600) return ["MISSING_OR_INVALID_RELATIONAL_ADVICE"];
  const errors = [];
  if ((advice.romance !== "not_addressed" || advice.support !== "not_addressed") && (advice.evidence_quote.trim().length < 8 || !answer.includes(advice.evidence_quote.trim()))) errors.push("UNGROUNDED_RELATIONAL_ADVICE");
  if (!decision.allowRomanceRecommendation && advice.romance === "normalize_or_recommend") errors.push("ROMANCE_NOT_READY");
  if (decision.status === "NOT_BLOCKED" && advice.romance === "pause") errors.push("UNSUPPORTED_ROMANCE_PAUSE");
  if (decision.supportProgress === "NOT_EQUIVALENT_TO_NONROMANTIC_SUPPORT" && advice.support === "claim_support_progress") errors.push("SUPPORT_SUBSTITUTION_NOT_PROGRESS");
  return errors;
}
