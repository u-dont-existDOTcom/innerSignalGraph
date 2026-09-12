import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { applyCaseAudit, runCaseAudit, runCaseExtraction } from "../src/case-formulation/run.mjs";
import { reconcileIssueScope, validateTurnTask } from "../src/case-formulation/turn-task.mjs";
import { loadConfig } from "../src/core/config.mjs";
import { readZipEntries } from "../src/core/zip.mjs";
import { runGraphRegressionSuite } from "../src/guide-graph/regressions.mjs";
import { planFromGraphs } from "../src/guide-graph/planner.mjs";
import { runGuidePacketRegressionSuite } from "../src/guide-packet/regressions.mjs";
import { verifyGuidePacket } from "../src/guide-packet/verifier.mjs";
import { buildContext } from "../src/orchestrator/context-builder.mjs";
import { requiredRealizationNodeIds } from "../src/orchestrator/response-contract.mjs";
import { runTieredTherapyPipeline } from "../src/orchestrator/run-tiered-pipeline.mjs";
import { realizationPrompt } from "../src/prompts/realize.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const candidateRoot = path.join(root, "tasks", "wisdom-practices-20260912", "candidate");
const candidateBundle = JSON.parse(await fs.readFile(path.join(candidateRoot, "candidate", "bundle.json"), "utf8"));
const canonicalBundle = JSON.parse(await fs.readFile(path.join(root, "guide-graphs", "compiled", "bundle.json"), "utf8"));
const proposalCases = await Promise.all(
  (await fs.readdir(path.join(root, "authoring", "obsidian", "proposals", "wisdom-practices-20260912", "tests")))
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map(async (name) => JSON.parse(await fs.readFile(path.join(root, "authoring", "obsidian", "proposals", "wisdom-practices-20260912", "tests", name), "utf8")))
);
const casesById = new Map(proposalCases.map((item) => [item.id, item]));

function syntheticProvider({ value, prompts }) {
  return {
    id: "synthetic",
    model: "mock-synthetic",
    async generate(request) {
      prompts.push(request);
      return { text: JSON.stringify(value), requestId: `synthetic-${request.metadata.stage}` };
    }
  };
}

test("all supplied graph cases pass against the actual compiled candidate", async () => {
  const result = await runGraphRegressionSuite({ root, bundle: candidateBundle, cases: proposalCases });
  assert.equal(result.ok, true, JSON.stringify(result.results.filter((item) => !item.ok), null, 2));
  assert.equal(result.count, 33);
  assert.equal(result.results.every((item) => item.ok), true);
});

test("proposal packet preserves task-backed cases and remains exactly owner-gated", async () => {
  const packet = await fs.readFile(path.join(candidateRoot, "packet", "proposal.zip"));
  const regression = runGuidePacketRegressionSuite(packet);
  assert.equal(regression.ok, true, JSON.stringify(regression.results.filter((item) => item.status !== "pass"), null, 2));
  assert.equal(regression.count, 62);
  const draft = regression.results.find((item) => item.id === "G961");
  assert.deepEqual(draft.evidence.requiredNodeIds, ["ROUTE.ACT_OUTWARD", "IC.DRAFT_EDITOR"]);

  const verified = verifyGuidePacket(packet, { installedBundle: canonicalBundle });
  assert.equal(verified.ok, true, verified.errors.join("\n"));
  assert.equal(verified.approved, false);
  assert.equal(verified.installable, false);
  assert.equal(verified.decisionCards.length > 0, true);
  const entries = readZipEntries(packet);
  const decisions = JSON.parse(entries.get("audit/owner-decisions.json").toString("utf8"));
  assert.equal(decisions.status, "awaiting-owner");
  assert.equal(decisions.allApproved, false);
});

test("production context enables prompt rules only from complete candidate membership", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "wisdom-context-"));
  const config = loadConfig({ mode: "mock", ledgerMode: "off", autopilotStateDir: temp });
  const installedGraphs = path.join(config.guidePacketRoot, "installed", "current", "contents", "graphs");
  await fs.mkdir(installedGraphs, { recursive: true });
  await fs.writeFile(path.join(installedGraphs, "bundle.json"), `${JSON.stringify(candidateBundle, null, 2)}\n`);

  const context = await buildContext({
    userMessage: "Help me draft a truthful boundary, then come back to the hurt.",
    recentTranscript: "Synthetic test only.",
    userFacts: [],
    guideExcerpts: "Synthetic guide excerpt."
  }, config);
  assert.equal(context.perspectivePracticesEnabled, true);

  const extractionPrompts = [];
  const extraction = await runCaseExtraction({
    context,
    provider: syntheticProvider({
      prompts: extractionPrompts,
      value: {
        user_goal: "Receive help with the current synthetic request.",
        current_issue: "Synthetic draft lifecycle",
        direct_observations: [],
        variables: { perspective_practice: "wiser_self" },
        hypotheses: [],
        unknowns: []
      }
    })
  });
  assert.match(extractionPrompts[0].system, /PERSPECTIVE PRACTICES/);
  assert.equal(extractionPrompts[0].outputSchema.properties.variables.properties.perspective_practice.enum.includes("return_to_care"), true);

  const auditPrompts = [];
  const audit = await runCaseAudit({
    context,
    snapshot: extraction.value,
    provider: syntheticProvider({
      prompts: auditPrompts,
      value: {
        remove_observation_ids: [],
        remove_hypothesis_ids: [],
        variable_corrections: [{ field: "perspective_practice", value: "draft_editor", reason: "Synthetic spoof-resistance check." }],
        add_unknowns: [],
        safety_flags: [],
        verdict: "revise",
        summary: "The planner must derive the practice from a grounded task."
      }
    })
  });
  assert.match(auditPrompts[0].system, /PERSPECTIVE-PRACTICE AUDIT ADDENDUM/);
  const audited = applyCaseAudit(extraction.value, audit.value);
  const plan = planFromGraphs({ variables: audited.variables, graphs: candidateBundle.graphs, turnTask: null });
  assert.equal(plan.variables.perspective_practice, "unknown");
  assert.equal(plan.selectedNodes.some((node) => node.id === "IC.DRAFT_EDITOR"), false);
});

test("legacy and incomplete graph sets keep the capability and prompt rules disabled", async () => {
  const config = loadConfig({ mode: "mock", ledgerMode: "off", autopilotStateDir: await fs.mkdtemp(path.join(os.tmpdir(), "wisdom-legacy-")) });
  const context = await buildContext({
    userMessage: "Synthetic legacy request.",
    recentTranscript: "",
    userFacts: [],
    guideExcerpts: "Synthetic guide excerpt."
  }, config);
  assert.equal(context.perspectivePracticesEnabled, false);

  const prompts = [];
  await runCaseExtraction({
    context,
    provider: syntheticProvider({
      prompts,
      value: {
        user_goal: "Keep legacy behavior.",
        current_issue: "Synthetic legacy issue",
        direct_observations: [],
        variables: {},
        hypotheses: [],
        unknowns: []
      }
    })
  });
  assert.doesNotMatch(prompts[0].system, /PERSPECTIVE PRACTICES/);
});

test("outward action stays primary while draft editing becomes required realization support", () => {
  const definition = casesById.get("G961");
  const plan = planFromGraphs({
    variables: definition.variables,
    unknowns: definition.unknowns,
    graphs: candidateBundle.graphs,
    turnTask: definition.turn_task
  });
  assert.equal(plan.primaryJob.id, "ROUTE.ACT_OUTWARD");
  assert.deepEqual(plan.executionContract.requiredNodeIds, ["ROUTE.ACT_OUTWARD", "IC.DRAFT_EDITOR"]);
  assert.deepEqual(requiredRealizationNodeIds(plan), ["ROUTE.ACT_OUTWARD", "IC.DRAFT_EDITOR"]);
  assert.equal(plan.executionContract.task.node_id, "IC.DRAFT_EDITOR");
  const prompt = realizationPrompt({
    userMessage: "Help me compose the chosen boundary.",
    recentTranscript: "Synthetic test.",
    interventionContract: plan
  }, { answer: "", next_question: "" }, "Synthetic");
  assert.match(prompt.user, /IC\.DRAFT_EDITOR/);
  assert.match(prompt.user, /raw draft/i);
  assert.match(prompt.user, /actual send|send authority|human decides/i);
});

test("ordinary reviewed runtime carries an accepted draft task through extraction, audit, planning and realization", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "wisdom-runtime-"));
  const config = loadConfig({ mode: "mock", ledgerMode: "off", autopilotStateDir: temp });
  const installedGraphs = path.join(config.guidePacketRoot, "installed", "current", "contents", "graphs");
  await fs.mkdir(installedGraphs, { recursive: true });
  await fs.writeFile(path.join(installedGraphs, "bundle.json"), `${JSON.stringify(candidateBundle, null, 2)}\n`);
  const definition = casesById.get("G961");
  const prompts = [];
  const provider = {
    id: "synthetic",
    model: "mock-synthetic",
    async generate(request) {
      prompts.push(request);
      const stage = request.metadata.stage;
      const value = stage === "case_extraction" ? {
        user_goal: "Compose a truthful boundary without authorizing an automatic send.",
        current_issue: definition.turn_task.issue,
        direct_observations: [{ id: "W_OBS_1", statement: "The person explicitly requested bounded drafting help.", evidence: "Synthetic acceptance fixture." }],
        variables: definition.variables,
        turn_task: definition.turn_task,
        hypotheses: [],
        unknowns: []
      } : stage === "case_audit" ? {
        remove_observation_ids: [],
        remove_hypothesis_ids: [],
        variable_corrections: [],
        add_unknowns: [],
        safety_flags: [],
        verdict: "accept",
        summary: "The current, observation-backed drafting request remains accepted and bounded."
      } : {
        answer: "Keep the outward boundary as the actual action. Use a private raw draft and caring editor; the human retains send authority.",
        next_question: "",
        realized_nodes: [
          { id: "ROUTE.ACT_OUTWARD", evidence_quote: "Keep the outward boundary as the actual action." },
          { id: "IC.DRAFT_EDITOR", evidence_quote: "Use a private raw draft and caring editor; the human retains send authority." }
        ]
      };
      return { text: JSON.stringify(value), requestId: `synthetic-${stage}` };
    }
  };
  const context = await buildContext({
    userMessage: "Help me edit a firm refusal. Do not send it for me.",
    recentTranscript: "Synthetic ordinary-flow fixture.",
    userFacts: [],
    guideExcerpts: "Synthetic guide excerpt."
  }, config);

  const result = await runTieredTherapyPipeline({
    context,
    providers: { renderer: provider, openai: provider },
    config,
    processingMode: "reviewed",
    instrumentation: {
      loadPreflightGraphBundle: async () => candidateBundle,
      loadPlanningGraphBundle: async () => candidateBundle
    }
  });

  assert.deepEqual(prompts.map((item) => item.metadata.stage), ["case_extraction", "case_audit", "realization"]);
  assert.match(prompts[0].system, /PERSPECTIVE PRACTICES/);
  assert.match(prompts[1].system, /PERSPECTIVE-PRACTICE AUDIT ADDENDUM/);
  assert.equal(result.processingTier, "reviewed");
  assert.equal(result.interventionContract.primaryJob.id, "ROUTE.ACT_OUTWARD");
  assert.deepEqual(result.interventionContract.executionContract.requiredNodeIds, ["ROUTE.ACT_OUTWARD", "IC.DRAFT_EDITOR"]);
  assert.equal(result.interventionContract.executionContract.task.node_id, "IC.DRAFT_EDITOR");
  assert.equal(result.responseContract.realizationCoveragePassed, true);
  assert.equal(result.responseContract.missingRealizationNodeIds.length, 0);
  assert.match(result.answer, /human retains send authority/i);
});

test("outward completion does not imply inward-care completion or permission", () => {
  const returnDefinition = casesById.get("G936");
  const returnPlan = planFromGraphs({
    variables: returnDefinition.variables,
    graphs: candidateBundle.graphs,
    turnTask: returnDefinition.turn_task
  });
  assert.equal(returnPlan.primaryJob.id, "IC.DRAFT_RETURN_TO_CARE");

  for (const id of ["G937", "G938"]) {
    const definition = casesById.get(id);
    const plan = planFromGraphs({ variables: definition.variables, graphs: candidateBundle.graphs, turnTask: definition.turn_task });
    assert.equal(plan.selectedNodes.some((node) => node.id === "IC.DRAFT_RETURN_TO_CARE"), false);
    assert.equal(plan.executionContract.requiredNodeIds.includes("IC.DRAFT_RETURN_TO_CARE"), false);
  }
});

test("issue change, closure and withdrawn evidence cannot revive a practice task", () => {
  const accepted = structuredClone(casesById.get("G933").turn_task);
  const changed = reconcileIssueScope({
    current_issue: "New synthetic issue",
    variables: { relational_check_status: "completed", loop_target_relation: "live_work", guard_engagement: "willing_to_allow", leave_alone_eligibility: "eligible" },
    turn_task: accepted
  }, { current_issue: accepted.issue });
  const changedTask = validateTurnTask(changed.turn_task, { issue: changed.current_issue });
  const changedPlan = planFromGraphs({ variables: changed.variables, graphs: candidateBundle.graphs, turnTask: changedTask });
  assert.equal(changedPlan.variables.perspective_practice, "unknown");

  const closed = structuredClone(accepted);
  closed.phase = "close";
  const closedPlan = planFromGraphs({ variables: casesById.get("G933").variables, graphs: candidateBundle.graphs, turnTask: closed });
  assert.equal(closedPlan.variables.perspective_practice, "unknown");
  assert.equal(closedPlan.nextQuestion, "");

  const snapshot = {
    user_goal: "Synthetic",
    current_issue: accepted.issue,
    direct_observations: [{ id: "W_OBS_1", statement: "A current request was made.", evidence: "synthetic" }],
    variables: casesById.get("G933").variables,
    hypotheses: [],
    unknowns: [],
    turn_task: accepted
  };
  const audited = applyCaseAudit(snapshot, {
    remove_observation_ids: ["W_OBS_1"],
    remove_hypothesis_ids: [],
    variable_corrections: [],
    add_unknowns: [],
    safety_flags: [],
    verdict: "revise",
    summary: "Withdraw the sole task observation."
  });
  assert.equal(audited.turn_task, null);
  const withdrawnPlan = planFromGraphs({ variables: audited.variables, graphs: candidateBundle.graphs, turnTask: audited.turn_task });
  assert.equal(withdrawnPlan.variables.perspective_practice, "unknown");
});
