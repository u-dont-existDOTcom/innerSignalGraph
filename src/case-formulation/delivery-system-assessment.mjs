import { checkBoundedSchema } from "./bounded-schema.mjs";
import { ValidationError } from "../core/errors.mjs";

// OWNER_POLICY delivery safeguards. These are explainable decision rules, not a
// clinical instrument, efficacy estimate, provider certification or motive finding.
export const DELIVERY_DIMENSIONS = Object.freeze([
  "enables_self_practice", "potentially_destabilizing", "adverse_effects_explained",
  "stop_criteria_accessible", "titration_guidance_accessible", "low_cost_safety_questions",
  "ordinary_safety_support", "premium_required_for_basic_safety", "package_proportionate",
  "lower_cost_options", "package_pressure", "urgency_scarcity", "unique_or_total_cure_claim",
  "push_through_destabilization", "responds_with_titration", "scope_transparent",
  "credentials_transparent", "supervision_transparent", "cancellation_refund_transparent",
  "adverse_escalation_transparent", "boundaries_transparent", "between_session_support_defined",
  "independent_reviews_checked", "independent_complaints_or_adverse_reports",
  "acknowledges_uncertainty", "acknowledges_alternatives"
]);
const critical = ["adverse_effects_explained", "stop_criteria_accessible", "titration_guidance_accessible", "low_cost_safety_questions", "ordinary_safety_support", "scope_transparent", "credentials_transparent", "supervision_transparent", "cancellation_refund_transparent", "adverse_escalation_transparent", "boundaries_transparent", "between_session_support_defined", "independent_reviews_checked", "acknowledges_uncertainty", "acknowledges_alternatives"];
const providerWide = new Set(["scope_transparent", "credentials_transparent", "supervision_transparent", "cancellation_refund_transparent", "boundaries_transparent", "between_session_support_defined", "independent_reviews_checked", "independent_complaints_or_adverse_reports", "acknowledges_uncertainty", "acknowledges_alternatives"]);
const negative = ["premium_required_for_basic_safety", "package_pressure", "urgency_scarcity", "unique_or_total_cure_claim", "push_through_destabilization", "independent_complaints_or_adverse_reports"];
const text = { type: "string", minLength: 1, maxLength: 120 };
const choice = values => ({ type: "string", enum: values });
const object = properties => ({ type: "object", additionalProperties: false, properties, required: Object.keys(properties) });
const refs = { type: "array", items: text, uniqueItems: true, minItems: 1, maxItems: 12 };
const money = { type: ["number", "null"], minimum: 0 };
export const resourceSchema = { anyOf: [
  object({ consentToIncome: { type: "boolean", enum: [false] }, monthlyIncome: { type: "null" }, monthlyDisposable: { type: "null" }, maxCommitment: money }),
  object({ consentToIncome: { type: "boolean", enum: [true] }, monthlyIncome: money, monthlyDisposable: money, maxCommitment: money })
] };
const basis = choice(["USER_REPORT", "PROVIDER_STATEMENT", "DOCUMENTED_OFFER", "INDEPENDENT_REPORT"]);
export const deliveryAssessmentSchema = object({
  method_id: text, provider_id: text,
  // Binding must itself be observed. A provider label change is not evidence of better care.
  observation_ids: refs,
  method: { anyOf: [
    object({ benefit: choice(["UNKNOWN"]), durability: choice(["UNKNOWN", "TEMPORARY", "SUSTAINED"]), observation_ids: { ...refs, minItems: 0 }, basis, current: { type: "boolean" } }),
    object({ benefit: choice(["PLAUSIBLE", "OBSERVED_PARTIAL", "OBSERVED_USEFUL", "NO_BENEFIT"]), durability: choice(["UNKNOWN", "TEMPORARY", "SUSTAINED"]), observation_ids: refs, basis, current: { type: "boolean" } })
  ] },
  facts: { type: "array", maxItems: DELIVERY_DIMENSIONS.length, items: object({ dimension: choice(DELIVERY_DIMENSIONS), value: choice(["YES", "NO", "UNKNOWN"]), observation_ids: refs, basis, current: { type: "boolean" } }) },
  financial: { anyOf: [{ type: "null" }, object({ resources: resourceSchema, totalCommitment: money, currency: { type: "string", pattern: "^[A-Z]{3}$" }, observation_ids: refs, current: { type: "boolean" } })] }
});

export function deliveryObservationIds(input) {
  return input ? [...input.observation_ids, ...input.method.observation_ids, ...input.facts.flatMap(f => f.observation_ids), ...(input.financial?.observation_ids ?? [])] : [];
}
export function validateDeliveryAssessment(input, observationIds) {
  checkBoundedSchema(input, deliveryAssessmentSchema, "Invalid delivery assessment");
  if (input.method.current && ["OBSERVED_PARTIAL", "OBSERVED_USEFUL", "NO_BENEFIT"].includes(input.method.benefit) && !["USER_REPORT", "INDEPENDENT_REPORT"].includes(input.method.basis)) throw new ValidationError("Observed personal method value requires user or independent observation evidence, not provider marketing.");
  if (new Set(input.facts.map(f => f.dimension)).size !== input.facts.length) throw new ValidationError("Delivery dimensions must be unique.");
  if (observationIds && deliveryObservationIds(input).some(id => !observationIds.has(id))) throw new ValidationError("Delivery assessment references unavailable observations.");
  return structuredClone(input);
}

// Shared with the external navigator. All amounts must use the same currency and
// commitment horizon. Missing/withheld income remains unknown, never unaffordable by inference.
export function assessOpportunityCost(resources, totalCommitment) {
  checkBoundedSchema(resources, resourceSchema, "Invalid opportunity-cost resources");
  if (totalCommitment !== null && (typeof totalCommitment !== "number" || !Number.isFinite(totalCommitment) || totalCommitment < 0)) throw new ValidationError("Invalid opportunity-cost inputs.");
  const known = totalCommitment === 0 || (totalCommitment !== null && resources.maxCommitment !== null);
  const affordability = !known ? "UNKNOWN" : totalCommitment > resources.maxCommitment ? "TOO_EXPENSIVE" : "WITHIN_USER_CAP";
  const ratios = resources.consentToIncome && resources.monthlyIncome > 0 && totalCommitment !== null ? { monthsOfIncome: totalCommitment / resources.monthlyIncome, fractionOfAnnualIncome: totalCommitment / (12 * resources.monthlyIncome) } : null;
  const disposableMonths = resources.consentToIncome && resources.monthlyDisposable > 0 && totalCommitment !== null ? totalCommitment / resources.monthlyDisposable : null;
  // Transparent candidate review trigger, not a clinical or universal affordability cutoff.
  const extreme = totalCommitment > 0 && (affordability === "TOO_EXPENSIVE" || ratios?.monthsOfIncome >= 2 || disposableMonths >= 2 || resources.consentToIncome && (resources.monthlyIncome === 0 || resources.monthlyDisposable === 0));
  return { affordability, ratios, disposableMonths, strongOpportunityCostWarning: Boolean(extreme), stagedTrialRequired: Boolean(extreme), thresholdBasis: "OWNER_POLICY_CANDIDATE_MULTIPLE_MONTHS_OR_RESOURCE_CAP", commitment: extreme ? "DEFER_LARGE_PACKAGE_TRY_SMALL_REVERSIBLE_OPTION" : "ASSESS_DELIVERABLES_AND_ALTERNATIVES" };
}

export function assessDeliverySystem(input) {
  input = validateDeliveryAssessment(input);
  const facts = new Map(input.facts.map(f => [f.dimension, f]));
  const value = key => facts.get(key)?.current ? facts.get(key).value : "UNKNOWN";
  const yes = key => value(key) === "YES", no = key => value(key) === "NO";
  const findings = [];
  const finding = (code, severity, dimensions, explanation) => findings.push({ code, severity, dimensions, observation_ids: [...new Set(dimensions.flatMap(d => facts.get(d)?.observation_ids ?? []))], policy_basis: "OWNER_POLICY_DELIVERY_SAFETY_2026_09_07", explanation });
  const safetyGap = ["ordinary_safety_support", "low_cost_safety_questions", "stop_criteria_accessible", "titration_guidance_accessible"].some(no);
  const safetyPaywall = yes("enables_self_practice") && yes("potentially_destabilizing") && safetyGap && yes("premium_required_for_basic_safety") && no("package_proportionate");
  if (safetyPaywall) finding("BASIC_SAFETY_BEHIND_EXORBITANT_PREMIUM", "HIGH", ["enables_self_practice", "potentially_destabilizing", ...["ordinary_safety_support", "low_cost_safety_questions", "stop_criteria_accessible", "titration_guidance_accessible"].filter(no), "premium_required_for_basic_safety", "package_proportionate"], "The business/supervision model is a serious trust red flag: basic harm-management support is inaccessible without an exorbitant premium. I would not rely on this provider yet.");
  else if (yes("enables_self_practice") && yes("potentially_destabilizing") && safetyGap) finding("UNSUPPORTED_DESTABILIZING_SELF_PRACTICE", "HIGH", ["enables_self_practice", "potentially_destabilizing", ...critical.filter(no)], "Self-practice of a potentially destabilizing method lacks accessible basic harm-management support; seek a safer supervision arrangement.");
  if (yes("push_through_destabilization")) finding("DESTABILIZATION_DISMISSED_AS_RELEASE", "HIGH", ["push_through_destabilization"], "Dismissal of destabilization as breakthrough, release or trauma leaving is a serious delivery-risk signal. De-escalate; do not intensify on that assurance.");
  for (const d of critical.filter(no)) finding(`MISSING_${d.toUpperCase()}`, "CAUTION", [d], `Delivery safeguard is reported inadequate: ${d.replaceAll("_", " ")}.`);
  for (const d of negative.filter(yes).filter(d => d !== "push_through_destabilization")) finding(`CONCERN_${d.toUpperCase()}`, "CAUTION", [d], `Delivery concern: ${d.replaceAll("_", " ")}; assess the arrangement and evidence without attributing motives.`);
  if (no("package_proportionate")) finding("PACKAGE_VALUE_CONCERN", "PRICE", ["package_proportionate"], "The package appears disproportionate to its deliverables. Adequate accessible basic support and optional premium coaching do not by themselves require rejecting this provider.");
  const unknowns = DELIVERY_DIMENSIONS.filter(d => value(d) === "UNKNOWN");
  const high = findings.some(f => f.severity === "HIGH");
  const caution = findings.some(f => f.severity === "CAUTION");
  const trustStatus = high ? "HIGH_RISK_DELIVERY" : caution ? "CAUTION" : [...critical, ...negative].some(d => value(d) === "UNKNOWN") ? "UNCLEAR" : "TRUSTED_ENOUGH";
  const method = { ...input.method, benefit: input.method.current ? input.method.benefit : "UNKNOWN", durability: input.method.current ? input.method.durability : "UNKNOWN", clinicalEfficacyEstablished: false, mechanismEstablished: false };
  const useful = ["OBSERVED_PARTIAL", "OBSERVED_USEFUL"].includes(method.benefit);
  const financial = input.financial?.current ? assessOpportunityCost(input.financial.resources, input.financial.totalCommitment) : null;
  const practitionerDecision = high ? useful ? "METHOD_OK_PROVIDER_NOT_OK" : "SEEK_ALTERNATIVE_PROVIDER" : trustStatus;
  const actions = high ? ["SEEK_ALTERNATIVE_PROVIDER", "SEEK_ALTERNATIVE_SUPERVISION", "DEFER_PREMIUM_COMMITMENT"] : trustStatus === "TRUSTED_ENOUGH" ? ["CONTINUE_IF_METHOD_AND_SAFETY_PERMIT"] : ["VERIFY_DELIVERY_SAFEGUARDS"];
  if (financial?.stagedTrialRequired) actions.push("STRONG_OPPORTUNITY_COST_WARNING", "STAGED_REVERSIBLE_TRIAL_REQUIRED");
  if (yes("unique_or_total_cure_claim")) actions.push("REJECT_UNSUPPORTED_TOTAL_CURE_CLAIM", "ASSESS_OTHER_SUPPORTS");
  return { version: 1, method_id: input.method_id, provider_id: input.provider_id, method, trustStatus, practitionerDecision, findings, positiveSignals: input.facts.filter(f => f.current && ((critical.includes(f.dimension) || ["responds_with_titration", "lower_cost_options", "package_proportionate"].includes(f.dimension)) ? f.value === "YES" : negative.includes(f.dimension) && f.value === "NO")), unknowns, financial, actions, motive: "NOT_INFERRED", safeDoseEstablished: false, clinicalValidation: "NOT_ESTABLISHED" };
}

export function deliverySystemGuidance(assessment) {
  if (!assessment) return [];
  return [
    "Assess method value separately from delivery-system/practitioner trust. Preserve observed personal or partial benefit as reported evidence; it establishes neither clinical efficacy, mechanism nor a total cure. Poor delivery does not prove the method is bad, and a helpful method does not establish provider trust.",
    "Basic harm-management information, stop criteria, titration guidance and a reasonable route for safety questions should not require a premium luxury package when the ordinary offering enables self-practice of a potentially destabilizing intervention. Price structure plus safety architecture and accessibility can be a substantial trust red flag. Assess the business/supervision model directly; do not infer that the practitioner is greedy, a scammer or only cares about money.",
    ...assessment.findings.map(f => f.explanation),
    ...(assessment.trustStatus === "HIGH_RISK_DELIVERY" ? ["Seek an alternative provider or supervision strategy. Retain a useful method as a possible partial tool, subject to safe dose, supervision, consent and current adverse-response gates; do not continue unsafe self-practice while looking for support."] : []),
    ...(assessment.financial?.stagedTrialRequired ? ["This uncertain commitment creates a strong opportunity-cost concern relative to available resources. Defer the large package; require a small reversible staged trial and review one-off, sliding-scale, group, donation or lower-cost support before reconsidering it. Do not change prescribed treatment abruptly."] : []),
    ...(assessment.actions.includes("REJECT_UNSUPPORTED_TOTAL_CURE_CLAIM") ? ["Reject the unsupported total-cure or uniquely necessary claim. Temporary anxiety reduction can remain a valuable partial tool while functional outcomes and other supports are assessed."] : []),
    "A concrete, current provider response with dose reduction, stop criteria, affordable safety support and appropriate referral/escalation can reduce concern. It must resolve the relevant adverse findings; reassurance, silence or a new provider label cannot erase them. Unknown or unverified safeguards remain unknown."
  ];
}

// Session-owned evidence ledger. It composes the existing strategy episode; models
// cannot supply these counters or restore a withdrawn/previously consumed claim.
export function updateDeliveryAssessment(prior = null, input = null, observationIds) {
  if (input) input = validateDeliveryAssessment(input, observationIds);
  const state = prior ? structuredClone(prior) : { entries: [], selected: null, binding_ids: [] };
  if (!Array.isArray(state.entries) || state.entries.length > 12 || !Array.isArray(state.binding_ids)) throw new ValidationError("Invalid delivery evidence ledger.");
  const validIds = values => Array.isArray(values) && values.length <= 512 && values.every(id => typeof id === "string" && id.length > 0 && id.length <= 120) && new Set(values).size === values.length;
  if (!validIds(state.binding_ids) || new Set(state.entries.map(e => e.key)).size !== state.entries.length) throw new ValidationError("Invalid delivery ledger identity.");
  for (const entry of state.entries) {
    validateDeliveryAssessment(entry.input);
    if (entry.key !== JSON.stringify([entry.input.method_id, entry.input.provider_id]) || !validIds(entry.consumed_ids) || (entry.fact_ids && !validIds(entry.fact_ids))) throw new ValidationError("Invalid retained delivery evidence.");
  }
  if (state.selected !== null && !state.entries.some(e => e.key === state.selected)) throw new ValidationError("Invalid selected delivery assessment.");
  if (input) {
    const key = JSON.stringify([input.method_id, input.provider_id]);
    let entry = state.entries.find(e => e.key === key);
    const selecting = state.selected !== key;
    const freshBinding = input.observation_ids.some(id => !state.binding_ids.includes(id));
    const resumeKnown = state.selected === null && entry && !entry.binding_withdrawn && input.observation_ids.every(id => entry.input.observation_ids.includes(id));
    if (!selecting || freshBinding || resumeKnown) {
      for (const fact of input.facts) {
        const otherScopeEvidence = new Set(state.entries.filter(e => e.key !== key && (e.input.provider_id !== input.provider_id || !providerWide.has(fact.dimension))).flatMap(e => e.fact_ids ?? e.input.facts.flatMap(f => f.observation_ids)));
        if (fact.observation_ids.some(id => otherScopeEvidence.has(id))) throw new ValidationError("A different provider or method-specific context requires its own delivery evidence.");
      }
      if (!entry) {
        if (state.entries.length >= 12) throw new ValidationError("Delivery history capacity reached; retain assessment history for review.");
        entry = { key, input: structuredClone(input), fact_ids: [...new Set(input.facts.flatMap(f => f.observation_ids))], consumed_ids: [...new Set(deliveryObservationIds(input))] };
        state.entries.push(entry);
      } else {
        const fresh = item => item.observation_ids.some(id => !entry.consumed_ids.includes(id));
        const previous = new Map(entry.input.facts.map(f => [f.dimension, f]));
        for (const fact of input.facts) if (fresh(fact)) previous.set(fact.dimension, fact);
        entry.fact_ids = [...new Set([...(entry.fact_ids ?? entry.input.facts.flatMap(f => f.observation_ids)), ...input.facts.flatMap(f => f.observation_ids)])];
        entry.input.facts = [...previous.values()];
        if (fresh(input.method)) entry.input.method = input.method;
        if (input.financial && fresh(input.financial)) entry.input.financial = input.financial;
        if (freshBinding) { entry.input.observation_ids = input.observation_ids; entry.binding_withdrawn = false; }
        entry.consumed_ids = [...new Set([...entry.consumed_ids, ...deliveryObservationIds(input)])];
        if (entry.consumed_ids.length > 512) throw new ValidationError("Delivery evidence capacity reached; preserve history for reassessment.");
      }
      state.selected = key;
      state.binding_ids = [...new Set([...state.binding_ids, ...input.observation_ids])];
      if (state.binding_ids.length > 512) throw new ValidationError("Delivery binding capacity reached.");
    }
  }
  const current = state.entries.find(e => e.key === state.selected);
  return { state, assessment: current && !current.binding_withdrawn ? assessDeliverySystem(current.input) : null };
}

export function withdrawDeliveryEvidence(state, removedIds) {
  if (!state) return;
  for (const entry of state.entries) {
    const removed = item => item?.observation_ids.some(id => removedIds.has(id));
    if (removed(entry.input)) { entry.binding_withdrawn = true; if (state.selected === entry.key) state.selected = null; }
    entry.input.facts = entry.input.facts.filter(f => !removed(f));
    if (removed(entry.input.method)) entry.input.method = { ...entry.input.method, benefit: "UNKNOWN", durability: "UNKNOWN", current: false, observation_ids: [] };
    if (removed(entry.input.financial)) entry.input.financial = null;
    // Retain consumed IDs as tombstones. Old observations cannot restore withdrawn facts.
  }
}
