// Owner-authorized candidate policy. These are audited current-session judgments,
// not a diagnostic score, clinical clearance, permanent prohibition or data store.
const text = { type: "string", maxLength: 1600 };
const ids = { type: "array", maxItems: 12, items: { type: "string", maxLength: 160 } };
const choice = values => ({ type: "string", enum: values });
const record = properties => ({ type: "object", additionalProperties: false, properties, required: Object.keys(properties) });

export const relationalReadinessSchema = { anyOf: [{ type: "null" }, record({
  issue: text,
  scope: choice(["romantic_sexual_pursuit", "support_building"]),
  current_stability: choice(["sufficient", "insufficient", "unknown"]),
  stability_observation_ids: ids,
  foreseeable_harm: choice(["substantial", "not_substantial", "unknown"]),
  harm_observation_ids: ids,
  harm_to: { type: "array", maxItems: 4, items: choice(["self", "partner", "dependent_children", "future_children"]) },
  risk_signals: { type: "array", maxItems: 12, items: record({
    kind: choice(["hospitalization", "reality_testing", "suicidality_self_harm", "substance_dependence_relapse", "violent_dyscontrol", "self_care", "dissociation", "dependency", "relational_preoccupation", "escalating_pursuit", "partner_as_regulator", "other"]),
    timeframe: choice(["current", "historical", "unknown"]),
    observation_ids: ids
  }) },
  trajectory: choice(["improving", "stable", "worsening", "unknown"]),
  trajectory_observation_ids: ids,
  support_purpose: choice(["nonromantic", "partner_seeking", "mixed", "unknown"]),
  support_observation_ids: ids,
  supports: text,
  supports_observation_ids: ids,
  reasons: text,
  readiness_markers: { type: "array", maxItems: 8, items: text },
  review_when: text
})] };

function validateShape(value, schema, label, fail) {
  if (schema.anyOf) {
    if (value === null) return;
    return validateShape(value, schema.anyOf[1], label, fail);
  }
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return fail(`${label} must be an object.`);
    if (schema.additionalProperties === false && Object.keys(value).some(key => !Object.hasOwn(schema.properties, key))) return fail(`${label} has undeclared fields.`);
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) return fail(`${label}.${key} is required.`);
      validateShape(value[key], schema.properties[key], `${label}.${key}`, fail);
    }
    return;
  }
  if (schema.type === "array") {
    if (!Array.isArray(value) || value.length > (schema.maxItems ?? Number.POSITIVE_INFINITY)) return fail(`${label} must be a bounded array.`);
    value.forEach((item, index) => validateShape(item, schema.items, `${label}[${index}]`, fail));
    return;
  }
  if (schema.type === "string") {
    if (typeof value !== "string" || value.length > (schema.maxLength ?? Number.POSITIVE_INFINITY)) return fail(`${label} must be bounded text.`);
    if (schema.enum && !schema.enum.includes(value)) return fail(`${label} is invalid.`);
    return;
  }
  return fail(`${label} has an unsupported schema.`);
}

export function validateRelationalEvidence(readiness, { issue, observationIds = new Set() } = {}, fail = message => { throw new TypeError(message); }) {
  if (!readiness) return null;
  validateShape(readiness, relationalReadinessSchema.anyOf[1], "relational_readiness", fail);
  if (!readiness.issue.trim() || (issue != null && readiness.issue !== issue)) fail("Relational readiness must be bound to the current issue.");
  const references = (values, required = false) => {
    if ((required && !values.length) || new Set(values).size !== values.length || values.some(id => !observationIds.has(id))) {
      fail("Relational readiness needs current direct-observation references.");
    }
  };
  for (const [field, evidence] of [["current_stability", "stability_observation_ids"], ["foreseeable_harm", "harm_observation_ids"], ["trajectory", "trajectory_observation_ids"], ["support_purpose", "support_observation_ids"]]) {
    references(readiness[evidence], readiness[field] !== "unknown");
  }
  references(readiness.supports_observation_ids, Boolean(readiness.supports.trim()));
  for (const signal of readiness.risk_signals) references(signal.observation_ids, true);
  if (!readiness.reasons.trim() || !readiness.review_when.trim() || !readiness.readiness_markers.length || readiness.readiness_markers.some(marker => !marker.trim())) {
    fail("Relational readiness needs reasons and revisitable readiness markers.");
  }
  if (new Set(readiness.harm_to).size !== readiness.harm_to.length || (readiness.foreseeable_harm === "substantial" && !readiness.harm_to.length)) {
    fail("Substantial relational harm needs an identified affected party.");
  }
  return structuredClone(readiness);
}

const dependencySignals = new Set(["dependency", "relational_preoccupation", "escalating_pursuit", "partner_as_regulator"]);
const readinessProbe = "How are you managing daily life and distress at the moment, including any non-romantic support you can rely on?";

export function relationalReadinessDecision(readiness, { immediateProtection = false } = {}) {
  if (!readiness) return null;
  const instrumental = ["partner_seeking", "mixed"].includes(readiness.support_purpose);
  const adverse = readiness.trajectory === "worsening"
    && readiness.risk_signals.some(signal => signal.timeframe === "current" && dependencySignals.has(signal.kind));
  const pause = immediateProtection || readiness.foreseeable_harm === "substantial" || adverse;
  const ready = !pause && readiness.current_stability === "sufficient" && readiness.foreseeable_harm === "not_substantial";
  const status = pause ? "PAUSE_ROMANCE" : ready ? "NOT_BLOCKED" : "ASSESS_BEFORE_ROMANCE";
  const sourceRuleIds = new Set(["RG01", "RG03", "RG06"]);
  if (instrumental || adverse || readiness.risk_signals.some(signal => dependencySignals.has(signal.kind))) {
    sourceRuleIds.add("RG05"); sourceRuleIds.add("RG11");
  }
  if (immediateProtection || readiness.foreseeable_harm === "substantial") sourceRuleIds.add("RG08");
  if (readiness.harm_to.some(item => ["dependent_children", "future_children"].includes(item))) sourceRuleIds.add("RG10");
  return {
    version: 1,
    issue: readiness.issue,
    status,
    allowRomanceRecommendation: ready,
    pauseRomance: pause,
    nonRomanticSupportAllowed: true,
    supportProgress: instrumental ? "NOT_EQUIVALENT_TO_NONROMANTIC_SUPPORT" : "REQUIRES_OBSERVED_BENEFIT",
    adverseTrajectory: adverse,
    pauseCurrent: (readiness.scope === "romantic_sexual_pursuit" && !ready)
      || (readiness.scope === "support_building" && instrumental) || adverse,
    reasonCodes: [
      ...(immediateProtection ? ["IMMEDIATE_PROTECTION"] : []),
      ...(readiness.foreseeable_harm === "substantial" ? ["CURRENT_FORESEEABLE_HARM"] : []),
      ...(adverse ? ["WORSENING_RELATIONAL_DEPENDENCY"] : []),
      ...(instrumental ? ["SUPPORT_SUBSTITUTION"] : []),
      ...(!pause && !ready ? ["CURRENT_READINESS_UNRESOLVED"] : []),
      ...(ready ? ["CURRENT_STABILITY_AND_HARM_ASSESSED"] : [])
    ],
    sourceRuleIds: [...sourceRuleIds],
    assessment: structuredClone(readiness)
  };
}

function intrinsicPathFailure(state) {
  const active = state?.active;
  const latest = state?.latest;
  // Provider/pacing constraints are not method failure. Reopening readiness must
  // preserve their separate assessment without converting them to formulation failure.
  const deliveryOnly = latest?.delivery_assessment && ["MOVING", "UNCLEAR"].includes(latest.method_status);
  const intrinsicSources = (latest?.failure_sources ?? []).filter(source => !(deliveryOnly && ["DELIVERY_MISMATCH", "PACING_MISMATCH"].includes(source.kind)));
  return Boolean(active?.invalidated || active?.misses > 0
    || Object.values(active?.prediction_failures ?? {}).some(count => count > 0)
    || intrinsicSources.length
    || latest?.status === "ADVERSE"
    || latest?.goal_substitution?.narrow_romance_pause === true);
}

// A broad readiness pause is a current decision constraint, not evidence that an
// otherwise viable therapeutic mechanism failed. Clear only that relational-only
// switch after a fresh audited reopening or a genuinely new issue; retain all path
// failures and the pre-existing narrow persistent-risk state.
export function preparePathPriorForReadiness(prior, currentDecision, { issueChanged = false } = {}) {
  if (!prior) return prior;
  const state = structuredClone(prior);
  const active = state.active;
  if (!active?.relational_constraint_only || intrinsicPathFailure(state)) return state;
  const clears = issueChanged || (currentDecision?.status === "NOT_BLOCKED"
    && currentDecision.supportProgress !== "NOT_EQUIVALENT_TO_NONROMANTIC_SUPPORT");
  // Re-evaluate an audited continuing pause around the base controller. Feeding
  // its synthetic switch back into the method counters would invent a failure.
  if (!clears && !currentDecision) return state;
  active.switch_pending = false;
  active.relational_constraint_only = false;
  state.readiness_constraint_review = true;
  if (active.status === "STALLED" && active.decision === "SWITCH") {
    active.status = "UNCLEAR";
    active.decision = "PROBE";
  }
  if (clears) state.readiness_reopened = {
    reason: issueChanged ? "issue_changed" : "fresh_current_readiness",
    from_status: state.latest?.relational_readiness?.status ?? "support_substitution",
    to_status: currentDecision?.status ?? "not_applicable_to_new_issue",
    retained_episode_id: active.id,
    retained_path_evidence: true
  };
  return state;
}

function readinessEvidenceIds(decision) {
  const r = decision?.assessment;
  if (!r) return [];
  return [...new Set([
    ...r.stability_observation_ids,
    ...r.harm_observation_ids,
    ...r.trajectory_observation_ids,
    ...r.support_observation_ids,
    ...r.supports_observation_ids,
    ...r.risk_signals.flatMap(signal => signal.observation_ids)
  ])];
}

// Compose the broader audited readiness decision around the existing Path Performance
// Controller rather than changing its authoring-semantic implementation. The original
// narrow five-signal romance-risk rule remains intact and independently protective.
export function applyRelationalReadinessToPath(control, decision) {
  if (!control || !decision) return control;
  const state = structuredClone(control);
  const t = state.latest;
  const active = state.active;
  const baseNarrowPause = Boolean(t.goal_substitution?.romance_pause);
  const baseDecision = t.decision;
  const baseStatus = t.status;
  const baseRoute = t.route;
  const instrumental = decision.supportProgress === "NOT_EQUIVALENT_TO_NONROMANTIC_SUPPORT";
  const combinedPause = baseNarrowPause || decision.pauseRomance;
  const highPriority = ["safety", "external", "protective", "leave"].includes(baseRoute)
    || baseDecision === "STOP_DEESCALATE" || baseStatus === "ADVERSE";
  const intrinsicBefore = intrinsicPathFailure(state) || baseNarrowPause
    || ["SWITCH", "STOP_DEESCALATE", "CLOSE"].includes(baseDecision);

  t.relational_readiness = decision;
  t.readiness_conflict = baseNarrowPause && decision.status === "NOT_BLOCKED"
    ? "NARROW_CURRENT_RISK_OVERRIDES_GENERAL_NOT_BLOCKED"
    : decision.pauseRomance && !baseNarrowPause
      ? "BROAD_FORESEEABLE_HARM_PAUSE_WITHOUT_NARROW_CONJUNCTION" : null;
  t.goal_substitution = {
    ...(t.goal_substitution ?? {}),
    romance_pause: combinedPause,
    narrow_romance_pause: baseNarrowPause,
    instrumental_socializing: Boolean(t.goal_substitution?.instrumental_socializing || instrumental),
    evidence_ids: [...new Set([...(t.goal_substitution?.evidence_ids ?? []), ...readinessEvidenceIds(decision)])],
    source_rule_ids: decision.sourceRuleIds
  };

  if (!highPriority && decision.status === "ASSESS_BEFORE_ROMANCE" && decision.assessment.scope === "romantic_sexual_pursuit"
      && ["CONTINUE", "PROBE"].includes(baseDecision) && !baseNarrowPause) {
    t.status = "UNCLEAR";
    t.decision = "PROBE";
    t.route = "reconsider";
    t.reason = "Romantic readiness is unresolved; assess current functioning and foreseeable harm before normalizing or recommending dating.";
  }

  if (!highPriority && instrumental && decision.assessment.scope === "support_building") {
    t.status = "STALLED";
    t.decision = "SWITCH";
    t.route = "action";
    t.reason = "Partner-seeking is substituting for the non-romantic support target; preserve any separate friendship gain and choose a genuinely non-romantic support step.";
  }

  if (!highPriority && decision.pauseRomance) {
    if (t.status !== "ADVERSE") t.status = "STALLED";
    t.decision = "SWITCH";
    t.route = "action";
    t.reason = "Current foreseeable-harm/readiness evidence requires pausing active romance-seeking while widening non-romantic support.";
  }

  if (active) {
    active.status = t.status;
    active.decision = t.decision;
    active.switch_pending = ["SWITCH", "STOP_DEESCALATE", "CLOSE"].includes(t.decision);
    active.relational_constraint_only = Boolean(active.switch_pending && !intrinsicBefore && !baseNarrowPause
      && (decision.pauseRomance || (instrumental && decision.assessment.scope === "support_building")));
  }
  return state;
}

export function relationalReadinessGuidance(decision) {
  if (!decision) return [];
  const common = "Distinguish romantic/sexual involvement from friendship, community and practical support. Readiness concerns current functioning, foreseeable serious harm to self, partner and dependent or future children, load and responsibility; it is not worthiness, moral purity, complete healing or 'love yourself first'. A diagnosis or hospitalization history alone is never a permanent ban. Generic evidence that human connection helps cannot override this case-specific harm assessment.";
  const status = decision.status === "PAUSE_ROMANCE"
    ? "Explicitly recommend pausing active romance-seeking for now, explain the evidenced current reasons and revisit when the stated readiness markers improve. Do not facilitate pursuit, normalize dating as safe, or turn the pause into a compulsory breakup or permanent prohibition."
    : decision.status === "ASSESS_BEFORE_ROMANCE"
      ? "Current readiness is unresolved. Do not normalize or recommend dating before assessing the missing current functional stability and harm evidence; uncertainty is not a permanent prohibition."
      : "Current evidence does not block dating. Do not impose a full-healing prerequisite or treat loneliness, diagnosis or historical hospitalization as disqualifying. This is not clinical clearance or a guarantee of safety.";
  return [
    common,
    status,
    "Use demonstrated recent functioning—ordinary conflict behavior, repair, self-care, dependability, judgment, boundaries and follow-through—rather than affirmations, insight, spiritual depth or a healing story as the main readiness evidence.",
    "Do not advise isolation. Offer a fitting form of non-romantic support when useful: friendship, peer support, mentoring or a structured supervised/community setting. Therapeutic community, care-farm/green-care or Soteria-like settings are possible locally dependent options, not universally suitable or a replacement for needed immediate care. Do not change medication or prescribe a level of care from this gate.",
    ...(decision.supportProgress === "NOT_EQUIVALENT_TO_NONROMANTIC_SUPPORT" ? ["Socializing primarily to obtain a partner does not count as successful non-romantic support-building. Preserve any separately evidenced friendship gains, but reassess substitution and offer a genuinely non-romantic support context."] : []),
    ...(decision.adverseTrajectory ? ["Worsening dependency, relational preoccupation or pursuit, including a partner used as analgesic, reality anchor, rescuer or proof of worth, is an adverse trajectory. Reassess toward external stabilization rather than counting temporary relief as progress."] : []),
    "A powerful conversation, sexual/romantic high, altered-state insight or temporary relief is not durable evidence by itself. Look for transfer into ordinary life and change course when the predicted functioning does not appear.",
    `Owner romance-guide provenance for this decision: ${decision.sourceRuleIds.join(", ")}. The guide's medical, contraceptive, anatomical and drug-treatment claims are not imported by this gate.`
  ];
}

export function decoratePlanWithRelationalReadiness(plan, control, decision) {
  if (!decision) return plan;
  const narrowOverrides = control?.latest?.readiness_conflict === "NARROW_CURRENT_RISK_OVERRIDES_GENERAL_NOT_BLOCKED";
  const effectiveDecision = narrowOverrides ? { ...decision, status: "PAUSE_ROMANCE", pauseRomance: true, allowRomanceRecommendation: false } : decision;
  const guidance = relationalReadinessGuidance(effectiveDecision);
  if (narrowOverrides) guidance.push("The broader assessment and the still-current narrow risk pattern disagree. Preserve the current pause until fresh functional evidence resolves that conflict; do not erase either assessment or announce dating as unblocked.");
  const result = structuredClone(plan);
  result.requiredNuance = [...new Set([...(result.requiredNuance ?? []), ...guidance])];
  result.forbiddenOverclaims = [...new Set([...(result.forbiddenOverclaims ?? []),
    "Do not collapse supportive human connection into romantic readiness or treat temporary relational relief as evidence that dating is safe.",
    "Do not turn a current relational pause into a permanent person-level prohibition, moral judgment, or compulsory breakup."] )];
  if (result.executionContract) {
    result.executionContract.taskGuidance = [...new Set([...(result.executionContract.taskGuidance ?? []), ...guidance])];
  }
  if (result.pathPerformanceContract) {
    result.pathPerformanceContract.guidance = [...new Set([...(result.pathPerformanceContract.guidance ?? []), ...guidance])];
  }
  if (result.pathPerformance) result.pathPerformance.relational_readiness = decision;
  if (decision.status === "ASSESS_BEFORE_ROMANCE" && control?.latest?.route === "reconsider") {
    result.nextQuestion = readinessProbe;
    result.nextQuestionSource = { type: "relational-readiness", issue: decision.issue };
    result.questionContract = { mode: "canonical", question: readinessProbe, source: result.nextQuestionSource };
  }
  return result;
}
