import test from "node:test";
import assert from "node:assert/strict";
import Ajv from "ajv";
import { DELIVERY_DIMENSIONS, deliveryAssessmentSchema, assessDeliverySystem, assessOpportunityCost, validateDeliveryAssessment, updateDeliveryAssessment, withdrawDeliveryEvidence, deliverySystemGuidance } from "../src/case-formulation/delivery-system-assessment.mjs";
import { evaluatePathPerformance, pathPerformanceGuidance, pathUpdateSchema, validatePathUpdate } from "../src/case-formulation/path-performance.mjs";
import { applyCaseAudit, planCaseSnapshot } from "../src/case-formulation/run.mjs";
import { deriveCaseVariables, planFromGraphs } from "../src/guide-graph/planner.mjs";
import { compileGuideGraphs } from "../src/guide-graph/compiler.mjs";
import { blankCaseVariables } from "../src/guide-graph/contract.mjs";
import { enforceResponseContract } from "../src/orchestrator/response-contract.mjs";
import { classifyTherapyTier } from "../src/orchestrator/run-tiered-pipeline.mjs";

// Fictional providers and synthetic event IDs only. Inputs are not clinical validation.
const adverse = new Set(["premium_required_for_basic_safety", "package_pressure", "urgency_scarcity", "unique_or_total_cure_claim", "push_through_destabilization", "independent_complaints_or_adverse_reports"]);
const fact = (dimension, value, oid = "O3") => ({ dimension, value, observation_ids: [oid], basis: "DOCUMENTED_OFFER", current: true });
const good = (patch = {}) => ({ method_id: "method-a", provider_id: "fictional-provider-a", observation_ids: ["O1"], method: { benefit: "OBSERVED_PARTIAL", durability: "TEMPORARY", observation_ids: ["O2"], basis: "USER_REPORT", current: true }, facts: DELIVERY_DIMENSIONS.map(d => fact(d, adverse.has(d) ? "NO" : "YES")), financial: null, ...patch });
const withFacts = (input, patch, oid = "O3") => ({ ...input, facts: input.facts.map(f => patch[f.dimension] ? fact(f.dimension, patch[f.dimension], oid) : f) });
const paywall = () => withFacts(good(), { ordinary_safety_support: "NO", low_cost_safety_questions: "NO", stop_criteria_accessible: "NO", titration_guidance_accessible: "NO", premium_required_for_basic_safety: "YES", package_proportionate: "NO", lower_cost_options: "NO" });
const resources = { consentToIncome: true, monthlyIncome: 900, monthlyDisposable: 180, maxCommitment: 300 };
const financial = totalCommitment => ({ resources, totalCommitment, currency: "EUR", observation_ids: ["O4"], current: true });
const ids = new Set(Array.from({ length: 90 }, (_, i) => `O${i+1}`));
const variables = deriveCaseVariables({ ...blankCaseVariables(), present_safety: "safe", orientation: "oriented", ability_to_stop: "yes", ability_to_return: "yes", suicidal_state: "absent", activation: "low", dissociation: "none", altered_state: "sober", inner_adult_access: "available", witness_capacity: "present", coherent_child_state: "present", body_capacity: "adequate", current_intent: "conversation", other_person_central: "no", influence_domain: "none", actionable_problem: "absent", unresolved_inner_material: "present", attention_loop: "absent", inward_attention_effect: "neutral" });
const strategy = { process_id: "synthetic-process", target: "identify the current need", formulation: "Care may enable need access", family: "responsive_care", node_id: "ROUTE.GO_INWARD", selection_reason: "User requests support", observation_ids: ["O20"], predictions: [{ id: "P1", sign: "need_access", description: "Identify a current need", horizon: "immediate" }], adverse_signs: ["fragmentation"] };
const update = (assessment = null, signals = [], patch = {}) => ({ strategy: null, response: "meaningful", signals, failure_hypotheses: [], probe: null, ...(assessment ? { delivery_review: { process_id: strategy.process_id, node_id: strategy.node_id, assessment } } : {}), ...patch });
const signal = (kind, prediction_id = "", observation_id = "O21", severity = "ordinary") => ({ kind, prediction_id, observation_id, timing: "immediate", severity });
const step = (prior, update, v = variables) => evaluatePathPerformance({ prior, update, variables: v, observationIds: ids });
const start = () => {
 const s = step(null, update(null, [], { strategy, response: "not_observed" }));
 s.active.delivery = { node_id: strategy.node_id, review: 0, evidence: "synthetic_execution" };
 return s;
};
const moving = assessment => step(start(), update(assessment, [signal("need_access", "P1")]));
const bundle = await compileGuideGraphs({ write: false });
const plan = s => planFromGraphs({ variables, graphs: bundle.graphs, pathPerformance: s });

test("1: helpful method and excellent provider continue with independent method and trust outputs", () => {
 const s = moving(good());
 assert.equal(s.latest.status, "MOVING"); assert.equal(s.latest.decision, "CONTINUE");
 assert.equal(s.latest.delivery_assessment.trustStatus, "TRUSTED_ENOUGH");
 assert.equal(s.latest.delivery_assessment.method.clinicalEfficacyEstablished, false);
 assert.equal(plan(s).primaryJob.id, strategy.node_id);
});
test("2: optional overpriced premium plus adequate basic safety does not force provider rejection", () => {
 const a = assessDeliverySystem(withFacts(good(), { package_proportionate: "NO", lower_cost_options: "NO" }));
 assert.equal(a.trustStatus, "TRUSTED_ENOUGH"); assert.ok(a.findings.some(f => f.code === "PACKAGE_VALUE_CONCERN"));
 assert.ok(!a.actions.includes("SEEK_ALTERNATIVE_PROVIDER"));
 assert.equal(moving(withFacts(good(), { package_proportionate: "NO" })).latest.decision, "CONTINUE");
});
test("3: cheap self-practice, destabilization risk, no basic support, required exorbitant premium flags delivery while preserving method", () => {
 const input = { ...paywall(), financial: financial(2500) };
 const s = moving(input), a = s.latest.delivery_assessment;
 assert.equal(a.trustStatus, "HIGH_RISK_DELIVERY"); assert.equal(a.practitionerDecision, "METHOD_OK_PROVIDER_NOT_OK");
 assert.equal(a.method.benefit, "OBSERVED_PARTIAL"); assert.equal(s.latest.method_status, "MOVING");
 assert.equal(s.latest.decision, "SEEK_ALTERNATIVE_SUPERVISION");
 assert.ok(a.findings.some(f => f.code === "BASIC_SAFETY_BEHIND_EXORBITANT_PREMIUM" && f.observation_ids.length));
 assert.equal(a.motive, "NOT_INFERRED"); assert.match(deliverySystemGuidance(a).join(" "), /serious trust red flag/);
 assert.equal(plan(s).pathPerformanceContract.prohibit_prior_exercise, true);
});
test("4: fragmentation dismissed as breakthrough de-escalates even when benefit and external action are present", () => {
 const input = withFacts(good(), { push_through_destabilization: "YES" });
 const s = step(start(), update(input, [signal("fragmentation")]), { ...variables, actionable_problem: "present" });
 assert.equal(s.latest.decision, "STOP_DEESCALATE"); assert.equal(s.latest.route, "safety");
 assert.equal(s.latest.delivery_assessment.trustStatus, "HIGH_RISK_DELIVERY");
 assert.equal(plan(s).primaryJob.id, "IC.SAFETY_ORIENTATION");
});
test("5: affordable consult, accessible dose/stop support and clear escalation reduce concern only on fresh correction", () => {
 const first = updateDeliveryAssessment(null, paywall(), ids);
 const correction = good({ facts: good().facts.map(f => ({ ...f, observation_ids: ["O5"] })) });
 const repaired = updateDeliveryAssessment(first.state, correction, ids);
 assert.equal(repaired.assessment.trustStatus, "TRUSTED_ENOUGH");
 const replay = updateDeliveryAssessment(repaired.state, paywall(), ids);
 assert.equal(replay.assessment.trustStatus, "TRUSTED_ENOUGH");
 const sameIdReassurance = updateDeliveryAssessment(first.state, good(), ids);
 assert.equal(sameIdReassurance.assessment.trustStatus, "HIGH_RISK_DELIVERY");
 assert.equal(updateDeliveryAssessment(first.state, null, ids).assessment.trustStatus, "HIGH_RISK_DELIVERY");
});
test("6: several months of low fixed income requires strong opportunity-cost warning and staged trial", () => {
 const a = assessDeliverySystem({ ...good(), financial: financial(2400) });
 assert.ok(a.financial.ratios.monthsOfIncome > 2);
 assert.equal(a.financial.strongOpportunityCostWarning, true); assert.equal(a.financial.stagedTrialRequired, true);
 assert.ok(a.actions.includes("STAGED_REVERSIBLE_TRIAL_REQUIRED"));
 assert.equal(a.trustStatus, "TRUSTED_ENOUGH", "resource fit is separate from provider trust");
 const withheld = assessOpportunityCost({ consentToIncome: false, monthlyIncome: null, monthlyDisposable: null, maxCommitment: null }, 2400);
 assert.equal(withheld.ratios, null); assert.equal(withheld.affordability, "UNKNOWN");
 assert.throws(() => assessOpportunityCost({ ...resources, consentToIncome: false }, 2400));
});
test("7: total-cure marketing cannot inflate temporary anxiety relief beyond a partial tool", () => {
 const a = assessDeliverySystem(withFacts(good(), { unique_or_total_cure_claim: "YES" }));
 assert.equal(a.method.benefit, "OBSERVED_PARTIAL"); assert.equal(a.method.durability, "TEMPORARY");
 assert.equal(a.method.mechanismEstablished, false); assert.ok(a.actions.includes("REJECT_UNSUPPORTED_TOTAL_CURE_CLAIM"));
 assert.equal(a.trustStatus, "CAUTION");
});
test("benefit plus dose problem allows KEEP_BUT_TITRATE with alternative supervision; no method counters reset", () => {
 const initial = start(); initial.active.prediction_failures.P1 = 1;
 const s = step(initial, update(paywall(), [signal("need_access", "P1"), signal("dose_problem", "", "O22")]));
 assert.equal(s.active.id, initial.active.id); assert.equal(s.latest.decision, "KEEP_BUT_TITRATE");
 assert.ok(s.latest.delivery_actions.includes("SEEK_ALTERNATIVE_SUPERVISION"));
 assert.equal(s.latest.delivery_assessment.safeDoseEstablished, false); assert.equal(plan(s).pathPerformanceContract.prohibit_prior_exercise, true);
});
test("poor method and poor provider switch both; good delivery cannot wash out method failures", () => {
 for (const input of [paywall(), good()]) {
  const a = { ...input, method: { ...input.method, benefit: "NO_BENEFIT" } };
  const s = step(start(), update(a, [], { failure_hypotheses: [{ kind: "METHOD_MISMATCH", observation_ids: ["O22"] }] }));
  assert.equal(s.latest.decision, "SWITCH");
  if (input.facts.find(f => f.dimension === "ordinary_safety_support").value === "NO") assert.ok(s.latest.delivery_actions.includes("DISCONTINUE_OR_SWITCH_METHOD"));
 }
});
test("significant harm and consent refusal are never overridden by useful method or dose adjustment", () => {
 const s = step(start(), update(paywall(), [signal("fragmentation", "", "O21", "significant"), signal("dose_problem", "", "O22")]));
 assert.equal(s.latest.decision, "STOP_DEESCALATE"); assert.equal(s.latest.route, "safety");
 const declined = step(start(), update(paywall(), [signal("dose_problem")], { response: "declined" }));
 assert.equal(declined.latest.decision, "SWITCH");
});
test("plausibility and reported relief do not forge prospective MOVING evidence", () => {
 for (const benefit of ["PLAUSIBLE", "OBSERVED_PARTIAL", "UNKNOWN"]) {
  const input = good(); input.method.benefit = benefit;
  const s = step(start(), update(input, [signal("relief")]));
  assert.equal(s.latest.status, "UNCLEAR");
  assert.equal(s.latest.predictions[0].result, "UNOBSERVED");
 }
});
test("unknown/stale facts cannot certify trust; every dimension and evidence basis stays explicit", () => {
 const a = assessDeliverySystem(good({ facts: [] }));
 assert.equal(a.trustStatus, "UNCLEAR"); assert.equal(a.unknowns.length, DELIVERY_DIMENSIONS.length);
 const stale = good(); stale.facts = stale.facts.map(f => ({ ...f, current: false }));
 assert.equal(assessDeliverySystem(stale).trustStatus, "UNCLEAR");
});
test("schema rejects extra fields, unknown references, duplicate dimensions, malformed amounts and unbound delivery scope", () => {
 const validate = new Ajv({ strict: true }).compile(deliveryAssessmentSchema);
 assert.equal(validate(good()), true);
 assert.throws(() => validateDeliveryAssessment(good({ greed: true })), /Invalid/);
 assert.throws(() => validateDeliveryAssessment(good(), new Set(["O1"])), /unavailable/);
 assert.throws(() => assessDeliverySystem(good({ facts: [fact("ordinary_safety_support", "YES"), fact("ordinary_safety_support", "NO")] })), /unique/);
 assert.throws(() => assessOpportunityCost(resources, NaN), /Invalid/);
 const u = update(good()); u.delivery_review.process_id = "unrelated";
 assert.throws(() => step(start(), u), /active strategy/);
 assert.ok(new Ajv({ strict: true }).compile(pathUpdateSchema)(update(good())));
 assert.doesNotThrow(() => validatePathUpdate(update(good()), ids));
});
test("different provider requires new scope and provider-specific evidence; returning cannot erase old risk", () => {
 const first = updateDeliveryAssessment(null, paywall(), ids);
 const sameIds = good({ provider_id: "fictional-provider-b" });
 assert.equal(updateDeliveryAssessment(first.state, sameIds, ids).assessment.provider_id, "fictional-provider-a");
 assert.throws(() => updateDeliveryAssessment(first.state, { ...sameIds, observation_ids: ["O6"] }, ids), /own delivery evidence/);
 const newProvider = good({ provider_id: "fictional-provider-b", observation_ids: ["O6"], facts: good().facts.map(f => ({ ...f, observation_ids: ["O7"] })) });
 const changed = updateDeliveryAssessment(first.state, newProvider, ids);
 assert.equal(changed.assessment.trustStatus, "TRUSTED_ENOUGH");
 const back = updateDeliveryAssessment(changed.state, { ...paywall(), observation_ids: ["O8"] }, ids);
 assert.equal(back.assessment.trustStatus, "HIGH_RISK_DELIVERY");
});
test("withdrawal removes dependent trust facts and prevents replay while preserving method episode evidence", () => {
 const s = moving(paywall());
 withdrawDeliveryEvidence(s.delivery_system_state, new Set(["O3"]));
 const next = step(s, update(paywall(), [], { response: "not_observed" }));
 assert.equal(next.latest.delivery_assessment.trustStatus, "UNCLEAR");
 assert.equal(next.active.invalidated, false); assert.equal(next.latest.delivery_assessment.method.benefit, "OBSERVED_PARTIAL");
});
test("provider-only correction does not count as a failed method opportunity", () => {
 const s = moving(paywall());
 const reviewed = step(s, update(good({ facts: good().facts.map(f => ({ ...f, observation_ids: ["O5"] })) }), [], { response: "not_observed" }));
 assert.equal(reviewed.active.unclear, s.active.unclear); assert.equal(reviewed.active.misses, s.active.misses);
 assert.equal(reviewed.latest.delivery_assessment.trustStatus, "TRUSTED_ENOUGH");
});
test("delivery guidance and deterministic trace reach plan and block declared old exercise during provider reconsideration", () => {
 const s = moving(paywall()), p = plan(s);
 assert.equal(p.pathPerformanceContract.delivery_assessment.trustStatus, "HIGH_RISK_DELIVERY");
 assert.match(pathPerformanceGuidance(s).join(" "), /Basic harm-management/);
 const answer = "Review safer supervision options. Continue the old inward exercise.";
 const result = enforceResponseContract({ answer, next_question: "", realized_nodes: [{ id: p.primaryJob.id, evidence_quote: "Review safer supervision options." }, { id: strategy.node_id, evidence_quote: "Continue the old inward exercise." }] }, { plan: p });
 assert.equal(result.responseContract.pathPerformanceAdherencePassed, false);
});

test("provider marketing cannot be upgraded to observed personal benefit or absence of benefit", () => {
 for (const benefit of ["OBSERVED_PARTIAL", "OBSERVED_USEFUL", "NO_BENEFIT"]) {
  const input = good(); input.method.basis = "PROVIDER_STATEMENT"; input.method.benefit = benefit;
  assert.throws(() => assessDeliverySystem(input), /not provider marketing/);
 }
});
test("audit removes a prior delivery fact without invalidating unrelated method predictions, including closed episodes", async () => {
 const prior = moving(paywall());
 const snapshot = { user_goal: "Synthetic support goal", current_issue: "synthetic-process", variables, hypotheses: [], unknowns: [], direct_observations: [...ids].map(id => ({ id, statement: "Synthetic observation", evidence: "Synthetic source" })), path_update: update(null, [], { response: "not_observed" }), _path_prior: prior };
 const audit = { remove_observation_ids: ["O3"], remove_hypothesis_ids: [], variable_corrections: [], add_unknowns: [], verdict: "accept", summary: "Synthetic source correction", safety_flags: [] };
 const corrected = applyCaseAudit(snapshot, audit);
 assert.equal(corrected._path_invalidated, false);
 await planCaseSnapshot(corrected, { loadPlanningGraphBundle: async () => bundle });
 assert.equal(corrected.path_performance.latest.delivery_assessment.trustStatus, "UNCLEAR");
 assert.equal(corrected.path_performance.active.invalidated, false);
 const state = prior.delivery_system_state;
 withdrawDeliveryEvidence(state, new Set(["O2", "O4"]));
 const remaining = updateDeliveryAssessment(state, good(), ids).assessment;
 assert.equal(remaining.method.benefit, "UNKNOWN");
});
test("explicit delivery review is audited even when fast mode was requested", () => {
 assert.notEqual(classifyTherapyTier({ variables, path_update: update(good()) }, "fast").tier, "fast");
});
test("legacy graph policy cannot activate delivery assessment", async () => {
 const legacy = { ...bundle, graphs: bundle.graphs.map(({ pathPerformancePolicyVersion, ...g }) => g) };
 const snapshot = { variables, direct_observations: [...ids].map(id => ({ id })), unknowns: [], path_update: update(paywall(), [], { strategy }) };
 const { plan: p } = await planCaseSnapshot(snapshot, { loadPlanningGraphBundle: async () => legacy });
 assert.equal(p.pathPerformance, undefined); assert.equal(snapshot.path_performance, undefined);
});
test("repeated failed predictions survive provider correction and keep method reconsideration active", () => {
 const initial = start();
 let s = step(initial, update(paywall(), [signal("prediction_failed", "P1")]));
 s.active.delivery = { node_id: strategy.node_id, review: s.active.review_count, evidence: "synthetic_delivery" };
 s = step(s, update(paywall(), [signal("prediction_failed", "P1", "O22")]));
 const repaired = good({ facts: good().facts.map(f => ({ ...f, observation_ids: ["O5"] })) });
 const next = step(s, update(repaired, [], { response: "not_observed" }));
 assert.equal(next.active.prediction_failures.P1, 2);
 assert.equal(next.latest.status, "STALLED"); assert.equal(next.latest.decision, "SWITCH");
});

test("delivery review cannot downgrade deep intent, unresolved ambiguity or forensic safety", () => {
 for (const requested of ["auto", "fast"]) for (const current_intent of ["hypnosis", "memory_processing", "deep_dialogue", "photo_work", "altered_state", "advanced_release"]) {
  assert.equal(classifyTherapyTier({ variables: { ...variables, current_intent }, path_update: update(good()) }, requested).tier, "deep");
 }
 const ambiguous = { ...variables, age_agency_ambiguity: "present", resentment_toward_younger_self: "present", credibility_conflict: "present", current_intent: "trust_decision" };
 assert.equal(classifyTherapyTier({ variables: ambiguous, path_update: update(good()) }, "auto").tier, "deep");
 assert.equal(classifyTherapyTier({ variables: { ...variables, present_safety: "unsafe" }, path_update: update(good()) }, "fast").tier, "forensic");
});
test("existing provider cannot borrow another provider's favorable evidence, even after withdrawal", () => {
 const a = updateDeliveryAssessment(null, paywall(), ids);
 const bInput = good({ provider_id: "fictional-provider-b", observation_ids: ["O6"], facts: good().facts.map(f => ({ ...f, observation_ids: ["O7"] })) });
 const b = updateDeliveryAssessment(a.state, bInput, ids);
 const laundering = good({ observation_ids: ["O8"], facts: bInput.facts });
 assert.throws(() => updateDeliveryAssessment(b.state, laundering, ids), /own delivery evidence/);
 withdrawDeliveryEvidence(b.state, new Set(["O7"]));
 assert.throws(() => updateDeliveryAssessment(b.state, laundering, ids), /own delivery evidence/);
});

test("withdrawing current method benefit does not erase independently supported high-risk delivery", async () => {
 const snapshot = { user_goal: "Synthetic", current_issue: "synthetic-process", variables, hypotheses: [], unknowns: [], direct_observations: [...ids].map(id => ({ id, statement: "Synthetic observation", evidence: "Synthetic source" })), path_update: update(paywall(), [], { strategy }), _path_prior: null };
 const corrected = applyCaseAudit(snapshot, { remove_observation_ids: ["O2"], remove_hypothesis_ids: [], variable_corrections: [], add_unknowns: [], verdict: "accept", summary: "Synthetic correction", safety_flags: [] });
 await planCaseSnapshot(corrected, { loadPlanningGraphBundle: async () => bundle });
 assert.equal(corrected.path_performance.latest.delivery_assessment.method.benefit, "UNKNOWN");
 assert.equal(corrected.path_performance.latest.delivery_assessment.trustStatus, "HIGH_RISK_DELIVERY");
});
test("new process cannot clear known provider risk using the same old observation IDs", () => {
 const a = moving(paywall());
 const other = { ...strategy, process_id: "other-process", observation_ids: ["O24"] };
 const u = update(good(), [signal("new_process", "", "O25")], { strategy: other, response: "not_observed" });
 u.delivery_review.process_id = other.process_id;
 const b = step(a, u);
 assert.equal(b.active.strategy.process_id, other.process_id);
 assert.equal(b.latest.delivery_assessment.trustStatus, "HIGH_RISK_DELIVERY");
 const noProvider = step(a, update(null, [signal("new_process", "", "O25")], { strategy: other, response: "not_observed" }));
 assert.equal(noProvider.latest.delivery_assessment, undefined, "unrelated process does not inherit an unselected provider");
 assert.ok(noProvider.delivery_system_state.entries.length, "evidence remains retained for subsequent review");
});
test("correcting delivery with unknown method benefit does not invent method failure", () => {
 const input = paywall(); input.method.benefit = "UNKNOWN";
 const a = step(start(), update(input, [], { response: "not_observed" }));
 assert.equal(a.latest.decision, "SEEK_ALTERNATIVE_SUPERVISION"); assert.equal(a.active.switch_pending, false);
 const repaired = good({ method: input.method, facts: good().facts.map(f => ({ ...f, observation_ids: ["O5"] })) });
 const b = step(a, update(repaired, [], { response: "not_observed" }));
 assert.equal(b.latest.delivery_assessment.trustStatus, "TRUSTED_ENOUGH");
 assert.notEqual(b.latest.status, "STALLED"); assert.equal(b.active.misses, 0);
 assert.ok(!b.latest.failure_sources.some(f => f.kind === "FORMULATION_MISMATCH"));
});

import { caseSnapshotGenerationSchema, caseAuditGenerationSchema } from "../src/case-formulation/schemas.mjs";
test("generation schema declares nullable delivery review and uses supported conditional shapes", () => {
 const walk = s => {
  if (!s || typeof s !== "object") return;
  for (const forbidden of ["allOf", "if", "then", "else"]) assert.equal(Object.hasOwn(s, forbidden), false, forbidden);
  if (s.type === "object") assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort());
  for (const child of Object.values(s)) if (Array.isArray(child)) child.forEach(walk); else if (child && typeof child === "object") walk(child);
 };
 walk(caseSnapshotGenerationSchema);
 walk(caseAuditGenerationSchema);
 const schema = new Ajv({ strict: true }).compile(caseSnapshotGenerationSchema.properties.path_update);
 assert.ok(schema(update(good())));
 assert.ok(schema(update(null, [], { delivery_review: null })));
 assert.equal(schema(update()), false);
 assert.doesNotThrow(() => validatePathUpdate(update(), ids), "legacy omission remains accepted by runtime validation");
});
test("provider-wide credentials can be reused across methods, while method-specific safety requires its own evidence", () => {
 const a = updateDeliveryAssessment(null, good(), ids);
 const next = good({ method_id: "method-b", observation_ids: ["O6"], facts: [fact("credentials_transparent", "YES")] });
 const b = updateDeliveryAssessment(a.state, next, ids);
 assert.equal(b.assessment.provider_id, "fictional-provider-a");
 assert.ok(b.assessment.positiveSignals.some(f => f.dimension === "credentials_transparent"));
 assert.equal(b.assessment.trustStatus, "UNCLEAR");
 const bad = { ...next, facts: [fact("stop_criteria_accessible", "YES")] };
 assert.throws(() => updateDeliveryAssessment(a.state, bad, ids), /own delivery evidence/);
});

import { checkBoundedSchema } from "../src/case-formulation/bounded-schema.mjs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
test("runtime delivery validator imports without development dependencies", async t => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), "delivery-runtime-contract-"));
 t.after(() => fs.rm(root, { recursive: true, force: true }));
 for (const relative of ["core/errors.mjs", "case-formulation/bounded-schema.mjs", "case-formulation/delivery-system-assessment.mjs"]) {
  await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  await fs.copyFile(new URL(`../src/${relative}`, import.meta.url), path.join(root, relative));
 }
 const url = pathToFileURL(path.join(root, "case-formulation/delivery-system-assessment.mjs")).href;
 await promisify(execFile)(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(url)})`], { cwd: root });
});
test("bounded runtime schema validation agrees with AJV on structural adversarial mutations", () => {
 const oracle = new Ajv({ strict: true }).compile(deliveryAssessmentSchema);
 const mutations = [a => a, a => { a.extra = true; }, a => { delete a.method; }, a => { a.facts = null; }, a => { a.provider_id = 3; }, a => { a.provider_id = ''; }, a => { a.method.benefit = 'CURE'; }, a => { a.method.observation_ids = []; }, a => { a.method.current = 'yes'; }, a => { a.facts[0].basis = 'FABRICATED'; }, a => { a.observation_ids.push(a.observation_ids[0]); }, a => { a.financial = financial(-1); }, a => { a.financial = financial(2); a.financial.resources.consentToIncome = false; }, a => { a.financial = financial(2); a.financial.currency = 'not_currency'; }, a => { a.financial = financial(2); a.financial.resources.monthlyIncome = '900'; }];
 for (const mutate of mutations) {
  const a = good(); mutate(a);
  let accepted = true;
  try { checkBoundedSchema(a, deliveryAssessmentSchema); } catch { accepted = false; }
  assert.equal(accepted, oracle(a));
 }
 const unknown = good(); unknown.method.benefit = 'UNKNOWN'; unknown.method.observation_ids = [];
 assert.ok(oracle(unknown)); assert.doesNotThrow(() => checkBoundedSchema(unknown, deliveryAssessmentSchema));
});


import { applyRelationalReadinessToPath, preparePathPriorForReadiness, relationalReadinessDecision, decoratePlanWithRelationalReadiness } from "../src/case-formulation/relational-readiness.mjs";
const relational = (cleared = false) => ({
 issue: "synthetic current decision", scope: "romantic_sexual_pursuit",
 current_stability: cleared ? "sufficient" : "insufficient", stability_observation_ids: ["O40"],
 foreseeable_harm: cleared ? "not_substantial" : "substantial", harm_observation_ids: ["O40"], harm_to: cleared ? [] : ["self"],
 risk_signals: [], trajectory: "stable", trajectory_observation_ids: ["O40"],
 support_purpose: "nonromantic", support_observation_ids: ["O40"], supports: "", supports_observation_ids: [],
 reasons: "Synthetic current functioning and harm assessment.", readiness_markers: ["Reliable ordinary functioning"], review_when: "After a fresh current reassessment."
});

test("strict nullable audit no-correction preserves readiness while explicit withdrawal still invalidates", () => {
 const snapshot = { user_goal: "synthetic goal", current_issue: relational().issue, relational_readiness: relational(),
  direct_observations: [{ id: "O40", statement: "synthetic current finding", evidence: "fictional only" }], variables, hypotheses: [], unknowns: [] };
 const audit = { corrected_turn_task: null, invalidate_turn_task: false, corrected_relational_readiness: null, invalidate_relational_readiness: false,
  remove_observation_ids: [], remove_hypothesis_ids: [], variable_corrections: [], add_unknowns: [], safety_flags: [], verdict: "accept", summary: "Synthetic audit" };
 assert.deepEqual(applyCaseAudit(snapshot, audit).relational_readiness, snapshot.relational_readiness);
 assert.equal(applyCaseAudit(snapshot, { ...audit, remove_observation_ids: ["O40"] }).relational_readiness, null);
 assert.equal(applyCaseAudit(snapshot, { ...audit, invalidate_relational_readiness: true }).relational_readiness, null);
});

test("fresh readiness reopening preserves separate provider constraint and does not invent method failure", () => {
 const unknown = { benefit: "UNKNOWN", durability: "UNKNOWN", observation_ids: [], basis: "USER_REPORT", current: true };
 const delivery = step(start(), update({ ...paywall(), method: unknown }, [], { response: "not_observed" }));
 assert.equal(delivery.latest.decision, "SEEK_ALTERNATIVE_SUPERVISION");
 let paused = applyRelationalReadinessToPath(delivery, relationalReadinessDecision(relational()));
 assert.equal(paused.active.relational_constraint_only, true);
 for (let turn = 0; turn < 3; turn += 1) {
  const stillPausedDecision = relationalReadinessDecision(relational());
  const baseline = preparePathPriorForReadiness(paused, stillPausedDecision);
  paused = applyRelationalReadinessToPath(step(baseline, update(null, [], { response: "not_observed" })), stillPausedDecision);
  assert.equal(paused.active.relational_constraint_only, true);
  assert.equal(paused.latest.method_status, "UNCLEAR");
  assert.ok(!paused.latest.failure_sources.some(f => f.kind === "FORMULATION_MISMATCH"));
 }
 const prepared = preparePathPriorForReadiness(paused, relationalReadinessDecision(relational(true)));
 assert.equal(prepared.active.switch_pending, false);
 const stillUnsafe = step(prepared, update(null, [], { response: "not_observed" }));
 assert.equal(stillUnsafe.latest.decision, "SEEK_ALTERNATIVE_SUPERVISION");
 const corrected = good({ method: unknown, facts: good().facts.map(f => ({ ...f, observation_ids: ["O41"] })) });
 const reopened = applyRelationalReadinessToPath(step(prepared, update(corrected, [], { response: "not_observed" })), relationalReadinessDecision(relational(true)));
 assert.equal(reopened.latest.delivery_assessment.trustStatus, "TRUSTED_ENOUGH");
 assert.equal(reopened.latest.method_status, "UNCLEAR"); assert.equal(reopened.active.misses, 0);
 assert.equal(reopened.active.switch_pending, false);
 assert.ok(!reopened.latest.failure_sources.some(f => f.kind === "FORMULATION_MISMATCH"));
});

test("broad readiness harm must not manufacture the narrow partner-as-regulator explanation", () => {
 const paused = applyRelationalReadinessToPath(moving(good()), relationalReadinessDecision(relational()));
 assert.equal(paused.latest.goal_substitution.romance_pause, true);
 assert.equal(paused.latest.goal_substitution.narrow_romance_pause, false);
 assert.doesNotMatch(pathPerformanceGuidance(paused).join(" "), /using a partner as regulator\/rescuer\/proof-of-worth/);
 assert.equal(paused.latest.method_status, "MOVING");
 assert.equal(paused.latest.delivery_assessment.trustStatus, "TRUSTED_ENOUGH");
});

test("effective readiness guidance honors a narrow pause over broad not-blocked without rewriting either assessment", () => {
 const narrow = step(start(), update(good(), ["significant_instability", "external_regulation_dependency", "loneliness", "relapse_or_dissociation_risk", "romance_as_regulator"].map((kind, i) => signal(kind, "", `O${50+i}`))));
 const decision = relationalReadinessDecision(relational(true));
 const composed = applyRelationalReadinessToPath(narrow, decision);
 const decorated = decoratePlanWithRelationalReadiness(plan(composed), composed, decision);
 const guidance = decorated.pathPerformanceContract.guidance.join(" ");
 assert.match(guidance, /pausing active romance-seeking/);
 assert.doesNotMatch(guidance, /Current evidence does not block dating/);
 assert.equal(composed.latest.relational_readiness.status, "NOT_BLOCKED");
 assert.equal(composed.latest.goal_substitution.romance_pause, true);
});
