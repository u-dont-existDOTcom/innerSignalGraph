import { OPERATION_CLASSES } from "./contract.mjs";
import { loadCompleteCorpus } from "./corpus.mjs";
import {
  THERAPY_PROTOCOL_ROUTER_VERSION,
  routeTherapyProtocol,
  simpleCapabilityRoute,
  simpleSupportedChoiceRoute
} from "./router.mjs";

export const DETERMINISTIC_CAMPAIGN_VERSION = "therapy-protocol-deterministic-v2";
export const ABLATION_CAMPAIGN_VERSION = "therapy-protocol-ablation-v2";

const INNER_OPERATIONS = new Set([
  OPERATION_CLASSES.BORROWED_CAPACITY,
  OPERATION_CLASSES.LIGHT_REPARENTING,
  OPERATION_CLASSES.TRUST_BEHAVIOR,
  OPERATION_CLASSES.IDENTITY_DIFFERENTIATION,
  OPERATION_CLASSES.DEPTH_ACCESS
]);

const COMMON_FIELDS = Object.freeze([
  "request_actor",
  "beneficiary_present",
  "primary_problem_class",
  "current_external_danger",
  "basic_needs_failure",
  "condition_instability",
  "dependent_danger",
  "current_sobriety",
  "operation_consent",
  "consent_scope",
  "resource_required",
  "resource_access_status",
  "handoff_state"
]);

export const MAP15_FULL_FIELDS = Object.freeze([
  "insight_present",
  "behavioral_control",
  "skill_or_instruction_deficit",
  "instruction_access",
  "scaffold_status",
  "nurturing_quality",
  "protecting_quality",
  "guiding_quality",
  "witness_capacity",
  "parent_quality_context",
  "external_action_required",
  "physical_cost",
  "problem_portfolio_present",
  "current_sobriety",
  "condition_instability",
  "resource_required",
  "resource_access_status",
  "unmet_external_need",
  "adverse_trajectory"
]);

export const MAP15_SIMPLE_FIELDS = Object.freeze([
  "skill_or_instruction_deficit",
  "scaffold_status",
  "insight_present",
  "behavioral_control"
]);

export const MAP16_FULL_FIELDS = Object.freeze([
  "decision_subject",
  "request_actor",
  "beneficiary_present",
  "decision_impact",
  "third_party_rights_or_consent",
  "bodily_decision_owner",
  "decision_capacity_status",
  "capacity_concern",
  "capacity_concern_basis",
  "lawful_decision_maker_status",
  "change_target_endorsement",
  "person_owned_goal",
  "minimum_safety_goal",
  "harm_reduction_goal",
  "full_change_goal",
  "provider_or_setting_condition",
  "third_party_or_dependent_safety_goal",
  "smallest_endorsed_step",
  "current_external_danger",
  "condition_instability",
  "dependent_danger",
  "supporter_role_boundary"
]);

export const MAP16_SIMPLE_FIELDS = Object.freeze([
  "current_external_danger",
  "condition_instability",
  "dependent_danger",
  "request_actor",
  "capacity_concern",
  "decision_impact"
]);

function unique(values) {
  return [...new Set(values)];
}

function unknown(value) {
  return value === undefined || value === null || value === "" || value === "unknown";
}

function burden(profile, fields) {
  const consulted = unique(fields);
  const questions = consulted.filter((field) => unknown(profile[field]));
  return { fieldsConsulted: consulted, requiredFieldCount: consulted.length, questionsRequired: questions, questionCount: questions.length };
}

function severeError(grader, operation) {
  if (grader.expected.acceptableOperations.includes(operation)) return false;
  if (grader.expected.wrongRouteSeverity === "severe") return true;
  if (INNER_OPERATIONS.has(operation) && !INNER_OPERATIONS.has(grader.expected.operation)) return true;
  return false;
}

function falseEscalation(grader, operation) {
  return grader.expected.falseEscalationOperations.includes(operation);
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function summaryStats(rows, key) {
  const values = rows.map((row) => row[key]);
  return { mean: mean(values), median: median(values), max: Math.max(...values) };
}

function metrics(rows) {
  return {
    disagreements: rows.filter((row) => row.disagreement).length,
    decisionRelevantDisagreements: rows.filter((row) => row.decisionRelevantDifference).length,
    severeRoutingErrorsFull: rows.filter((row) => row.severeErrorFull).length,
    severeRoutingErrorsSimple: rows.filter((row) => row.severeErrorSimple).length,
    falseEscalationsFull: rows.filter((row) => row.falseEscalationFull).length,
    falseEscalationsSimple: rows.filter((row) => row.falseEscalationSimple).length,
    meanRequiredFieldsFull: mean(rows.map((row) => row.requiredFieldCountFull)),
    meanRequiredFieldsSimple: mean(rows.map((row) => row.requiredFieldCountSimple)),
    meanQuestionBurdenFull: mean(rows.map((row) => row.questionCountFull)),
    meanQuestionBurdenSimple: mean(rows.map((row) => row.questionCountSimple)),
    fieldBurdenFull: summaryStats(rows, "requiredFieldCountFull"),
    fieldBurdenSimple: summaryStats(rows, "requiredFieldCountSimple"),
    questionBurdenFull: summaryStats(rows, "questionCountFull"),
    questionBurdenSimple: summaryStats(rows, "questionCountSimple")
  };
}

export function runDeterministicCampaign(root = process.cwd()) {
  const corpus = loadCompleteCorpus(root);
  const results = corpus.cases.map(({ input, grader }) => {
    const route = routeTherapyProtocol({ protocolProfile: grader.protocolProfile, variables: grader.variables, ablationVariant: "production" });
    const operationPass = route.primaryOperation === grader.expected.operation;
    const dispositionPass = route.disposition === grader.expected.disposition;
    const unknownsPass = JSON.stringify([...route.materialUnknowns].sort()) === JSON.stringify([...grader.expected.requiredUnknowns].sort());
    const pass = operationPass && dispositionPass && unknownsPass;
    return {
      id: input.id,
      querySha256: input.querySha256,
      expectedOperation: grader.expected.operation,
      actualOperation: route.primaryOperation,
      expectedDisposition: grader.expected.disposition,
      actualDisposition: route.disposition,
      expectedUnknowns: grader.expected.requiredUnknowns,
      actualUnknowns: route.materialUnknowns,
      operationPass,
      dispositionPass,
      unknownsPass,
      severeError: severeError(grader, route.primaryOperation),
      falseEscalation: falseEscalation(grader, route.primaryOperation),
      status: pass ? "pass" : "fail",
      pass
    };
  });
  return {
    schemaVersion: 2,
    campaignVersion: DETERMINISTIC_CAMPAIGN_VERSION,
    routerVersion: THERAPY_PROTOCOL_ROUTER_VERSION,
    productionVariant: "map15-full-map16-supported-choice-hybrid",
    sourceCommit: corpus.manifest.source.commit,
    corpusManifestSha256: corpus.manifestSha256,
    caseCount: results.length,
    passCount: results.filter((item) => item.pass).length,
    severeErrorCount: results.filter((item) => item.severeError).length,
    falseEscalationCount: results.filter((item) => item.falseEscalation).length,
    results
  };
}

function ablationRow({ input, grader }, map) {
  const simpleVariant = `${map}-simple`;
  const full = routeTherapyProtocol({ protocolProfile: grader.protocolProfile, variables: grader.variables, ablationVariant: "full" });
  const simple = routeTherapyProtocol({ protocolProfile: grader.protocolProfile, variables: grader.variables, ablationVariant: simpleVariant });
  const relevantClass = map === "map15" ? "capability_skill_scaffold" : "refusal_capacity_ambivalence";
  const fullMapFields = map === "map15" ? MAP15_FULL_FIELDS : MAP16_FULL_FIELDS;
  const simpleMapFields = map === "map15" ? MAP15_SIMPLE_FIELDS : MAP16_SIMPLE_FIELDS;
  const applicable = grader.protocolProfile.primary_problem_class === relevantClass;
  const fullBurden = burden(grader.protocolProfile, applicable ? [...COMMON_FIELDS, ...fullMapFields] : COMMON_FIELDS);
  const simpleBurden = burden(grader.protocolProfile, applicable ? [...COMMON_FIELDS, ...simpleMapFields] : COMMON_FIELDS);
  const severeFull = severeError(grader, full.primaryOperation);
  const severeSimple = severeError(grader, simple.primaryOperation);
  const escalationFull = falseEscalation(grader, full.primaryOperation);
  const escalationSimple = falseEscalation(grader, simple.primaryOperation);
  const disagreement = full.primaryOperation !== simple.primaryOperation || full.disposition !== simple.disposition;
  return {
    id: input.id,
    querySha256: input.querySha256,
    sourceRelevant: grader.ablationMaps.includes(map),
    selectorApplicable: applicable,
    expectedOperation: grader.expected.operation,
    fullOperation: full.primaryOperation,
    simpleOperation: simple.primaryOperation,
    fullDisposition: full.disposition,
    simpleDisposition: simple.disposition,
    disagreement,
    decisionRelevantDifference: disagreement && (severeFull !== severeSimple || escalationFull !== escalationSimple || full.primaryOperation !== grader.expected.operation || simple.primaryOperation !== grader.expected.operation),
    severeErrorFull: severeFull,
    severeErrorSimple: severeSimple,
    falseEscalationFull: escalationFull,
    falseEscalationSimple: escalationSimple,
    requiredFieldsFull: fullBurden.fieldsConsulted,
    requiredFieldsSimple: simpleBurden.fieldsConsulted,
    requiredFieldCountFull: fullBurden.requiredFieldCount,
    requiredFieldCountSimple: simpleBurden.requiredFieldCount,
    questionsFull: fullBurden.questionsRequired,
    questionsSimple: simpleBurden.questionsRequired,
    questionCountFull: fullBurden.questionCount,
    questionCountSimple: simpleBurden.questionCount,
    fullTrace: { routerVersion: full.routerVersion, variant: full.ablationVariant, materialUnknowns: full.materialUnknowns },
    simpleTrace: {
      routerVersion: simple.routerVersion,
      variant: simple.ablationVariant,
      selectorOperation: map === "map15" ? simpleCapabilityRoute(grader.protocolProfile) : simpleSupportedChoiceRoute(grader.protocolProfile),
      materialUnknowns: simple.materialUnknowns
    }
  };
}

function decisionFor(map, aggregate) {
  if (aggregate.severeRoutingErrorsSimple > aggregate.severeRoutingErrorsFull) return "RETAIN_FULL";
  if (aggregate.falseEscalationsSimple < aggregate.falseEscalationsFull) return map === "map16" ? "HYBRID" : "SIMPLIFY";
  if (aggregate.severeRoutingErrorsSimple === aggregate.severeRoutingErrorsFull
      && aggregate.falseEscalationsSimple <= aggregate.falseEscalationsFull
      && aggregate.meanRequiredFieldsSimple < aggregate.meanRequiredFieldsFull
      && aggregate.meanQuestionBurdenSimple <= aggregate.meanQuestionBurdenFull) return "SIMPLIFY";
  return "RETAIN_FULL";
}

export function runAblationCampaign(root = process.cwd()) {
  const corpus = loadCompleteCorpus(root);
  const artifacts = {};
  for (const map of ["map15", "map16"]) {
    const results = corpus.cases.map((item) => ablationRow(item, map));
    const aggregate = metrics(results);
    artifacts[map] = {
      schemaVersion: 2,
      campaignVersion: ABLATION_CAMPAIGN_VERSION,
      map,
      executed: true,
      sourceCommit: corpus.manifest.source.commit,
      corpusManifestSha256: corpus.manifestSha256,
      routerVersion: THERAPY_PROTOCOL_ROUTER_VERSION,
      fullVariant: "full",
      simpleVariant: `${map}-simple`,
      competitorProvenance: map === "map15"
        ? "InnerSignalGraph implementation translation of the source's ordinary-functional-analysis falsifier; the pinned source does not specify an executable competitor."
        : "Coarse operation selector implementing the pinned source's supported-choice checklist boundary; semantic safeguards remain separately required.",
      caseCount: results.length,
      metrics: aggregate,
      decision: decisionFor(map, aggregate),
      results
    };
  }
  return {
    ...artifacts,
    summary: {
      schemaVersion: 2,
      campaignVersion: ABLATION_CAMPAIGN_VERSION,
      executed: true,
      sourceCommit: corpus.manifest.source.commit,
      corpusManifestSha256: corpus.manifestSha256,
      map15Decision: artifacts.map15.decision,
      map16Decision: artifacts.map16.decision,
      decisionRule: "Retain full when the simple arm adds a severe error; simplify when safety is equivalent with lower burden; use hybrid when the simple selector reduces false escalation but full semantic safeguards remain necessary.",
      map15Metrics: artifacts.map15.metrics,
      map16Metrics: artifacts.map16.metrics
    }
  };
}
