import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCompiledGuideGraphBundle } from "../src/guide-graph/compiler.mjs";
import { runAblationCampaign, runDeterministicCampaign } from "../src/therapy-protocol/campaign.mjs";
import { OPERATION_CLASSES, ROUTE_DISPOSITIONS } from "../src/therapy-protocol/contract.mjs";
import { expectedCorpusIds, loadCompleteCorpus, loadGraders, loadModelInputs } from "../src/therapy-protocol/corpus.mjs";
import { routeTherapyProtocolLongitudinal, transitionProtocolProfile } from "../src/therapy-protocol/longitudinal.mjs";
import { GRAPH_NODE_OPERATIONS, routeTherapyProtocol } from "../src/therapy-protocol/router.mjs";
import { REQUIRED_TRAJECTORY_IDS, loadTrajectoryGraders, loadTrajectoryInputs } from "../src/therapy-protocol/trajectory-corpus.mjs";
import { pipelineRecord } from "../src/therapy-protocol/live-campaign.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function baseProfile(overrides = {}) {
  const corpus = loadCompleteCorpus(root);
  return { ...corpus.cases[0].grader.protocolProfile, ...overrides };
}

test("all 49 source cases are hash-bound and physically split into allowlisted inputs and validated graders", () => {
  const inputs = loadModelInputs(root);
  const graders = loadGraders(root);
  assert.equal(inputs.inputs.length, 49);
  assert.equal(graders.graders.size, 49);
  assert.equal(inputs.manifestSha256, graders.manifestSha256);
  assert.deepEqual(inputs.inputs.map((item) => item.id).sort(), expectedCorpusIds().sort());
  assert.ok(inputs.inputs.every((item) => Object.keys(item).sort().join(",") === "batch,id,query,queryFileSha256,querySha256"));
  for (const item of inputs.manifest.cases) {
    assert.notEqual(item.queryPath, item.graderPath);
    assert.match(item.queryPath, /\/queries\//);
    assert.match(item.graderPath, /\/graders\//);
  }
});

test("deterministic production routing passes all 49 and genuine Map 15/16 ablations keep per-case burden evidence", () => {
  const deterministic = runDeterministicCampaign(root);
  assert.equal(deterministic.caseCount, 49);
  assert.equal(deterministic.passCount, 49);
  assert.equal(deterministic.severeErrorCount, 0);
  const comparison = runAblationCampaign(root);
  assert.equal(comparison.map15.caseCount, 49);
  assert.equal(comparison.map16.caseCount, 49);
  assert.equal(comparison.map15.decision, "RETAIN_FULL");
  assert.equal(comparison.map16.decision, "HYBRID");
  assert.ok(comparison.map15.results.some((item) => item.disagreement));
  assert.ok(comparison.map16.results.some((item) => item.disagreement));
  for (const artifact of [comparison.map15, comparison.map16]) {
    assert.ok(artifact.results.every((item) => Number.isInteger(item.requiredFieldCountFull)
      && Number.isInteger(item.requiredFieldCountSimple)
      && Number.isInteger(item.questionCountFull)
      && Number.isInteger(item.questionCountSimple)));
  }
});

test("every compiled guide node has an explicit operation mapping and unknown nodes fail closed", async () => {
  const bundle = await loadCompiledGuideGraphBundle();
  const ids = [...new Set(bundle.graphs.flatMap((graph) => graph.nodes.map((node) => node.id)))].sort();
  assert.deepEqual(Object.keys(GRAPH_NODE_OPERATIONS).sort(), ids);
  const route = routeTherapyProtocol({ variables: {} });
  assert.throws(() => route.graphNodeOperation({ id: "IC.UNMAPPED" }), /No explicit therapy-protocol operation mapping/);
});

test("hard safety and unavailable resources outrank all-engagement not-now", () => {
  const safety = routeTherapyProtocol({
    protocolProfile: baseProfile({
      primary_problem_class: "danger_basic_needs",
      current_external_danger: "present",
      operation_consent: "not_now",
      consent_scope: "all_engagement"
    }),
    variables: { present_safety: "unsafe" }
  });
  assert.equal(safety.primaryOperation, OPERATION_CLASSES.PRACTICAL_SAFETY);
  const unavailable = routeTherapyProtocol({
    protocolProfile: baseProfile({
      primary_problem_class: "medical_condition",
      resource_required: "yes",
      resource_access_status: "unaffordable",
      handoff_state: "unavailable",
      operation_consent: "not_now",
      consent_scope: "all_engagement"
    }),
    variables: {}
  });
  assert.equal(unavailable.primaryOperation, OPERATION_CLASSES.EXTERNAL_HANDOFF);
});

test("longitudinal routing preserves unresolved need/provenance and detects repeated unavailable referral", () => {
  const first = transitionProtocolProfile({ protocolProfile: baseProfile({
    primary_problem_class: "medical_condition",
    resource_required: "yes",
    required_external_resource: "specialist assessment",
    resource_access_status: "unaffordable",
    handoff_state: "unavailable",
    unmet_external_need: "present",
    historical_provenance_stable: "no"
  }) });
  const second = routeTherapyProtocolLongitudinal({
    previousState: { profile: first.profile, transition: first.transition },
    protocolProfile: baseProfile({
      primary_problem_class: "medical_condition",
      resource_required: "yes",
      required_external_resource: "specialist assessment",
      resource_access_status: "unknown",
      handoff_state: "suggested",
      unmet_external_need: "unknown",
      historical_provenance_stable: "unknown"
    })
  });
  assert.equal(second.primaryOperation, OPERATION_CLASSES.EXTERNAL_HANDOFF);
  assert.equal(second.profile.unmet_external_need, "present");
  assert.equal(second.profile.repeated_referral, "yes");
  assert.equal(second.profile.adverse_trajectory, "repeated_unavailable_referral");
  assert.equal(second.profile.historical_provenance_stable, "no");
});

test("all required adversarial trajectory inputs are grader-free, hash-bound, and separately validated", () => {
  const inputs = loadTrajectoryInputs(root);
  const graders = loadTrajectoryGraders(root);
  assert.equal(inputs.inputs.length, REQUIRED_TRAJECTORY_IDS.length);
  assert.equal(graders.graders.size, REQUIRED_TRAJECTORY_IDS.length);
  assert.equal(inputs.manifestSha256, graders.manifestSha256);
  for (const trajectory of inputs.inputs) {
    assert.deepEqual(Object.keys(trajectory).sort(), ["id", "schemaVersion", "source", "turns"]);
    assert.ok(trajectory.turns.every((turn) => Object.keys(turn).sort().join(",") === "index,message"));
  }
  const runner = fs.readFileSync(path.join(root, "scripts/run-therapy-protocol-live.mjs"), "utf8");
  assert.match(runner, /--execute-live/);
  assert.match(runner, /--grade-live/);
});

test("incomplete provider telemetry is safely blocked rather than labeled executed", () => {
  const record = pipelineRecord("RQ8-04", "a".repeat(64), {
    interventionContract: { therapyProtocol: { primaryOperation: OPERATION_CLASSES.HIGH_IMPACT_DECISION, disposition: ROUTE_DISPOSITIONS.INNER_CHILD_DEFERRED, materialUnknowns: [], profile: {} } },
    processingTier: "forensic",
    mode: "adversarial",
    routingReason: "test",
    answer: "test",
    next_question: "",
    safety_flags: [],
    responseContract: {},
    caseFormulation: {},
    realizationContractVersion: "response-realization-v5",
    rendererModel: "claude-sonnet-4-6"
  }, [{ provider: "anthropic", model: "claude-opus-5", transport: "cli", requestId: null, responseId: null }]);
  assert.equal(record.executionStatus, "safely_blocked");
  assert.equal(record.telemetryComplete, false);
  assert.equal(record.error.code, "INCOMPLETE_EXECUTION_TELEMETRY");
});
