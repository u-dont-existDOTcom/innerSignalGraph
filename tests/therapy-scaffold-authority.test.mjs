import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadConfig } from "../src/core/config.mjs";
import { buildContext } from "../src/orchestrator/context-builder.mjs";
import { createProviders } from "../src/providers/factory.mjs";
import { realizeAdjudication } from "../src/orchestrator/run-pipeline.mjs";
import { enforceResponseContract } from "../src/orchestrator/response-contract.mjs";
import { runTieredTherapyPipeline } from "../src/orchestrator/run-tiered-pipeline.mjs";
import { assertHardAuthorityPreserved, classifyInterventionAuthority } from "../src/orchestrator/scaffold-authority.mjs";
import { realizationPrompt } from "../src/prompts/realize.mjs";
import { semanticFormulationPrompt } from "../src/prompts/semantic-formulation.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(root, "fixtures/mock-responses/A001.json");
const advancedReleaseCasePath = path.join(root, "corpus/graph-cases/G007.json");
const plan = {
  variables: { present_safety: "safe", orientation: "oriented", ability_to_stop: "yes", ability_to_return: "yes", dissociation: "none", altered_state: "sober", memory_source_risk: "absent" },
  primaryJob: { id: "IC.CREDIBILITY_REPAIR", title: "Credibility repair" },
  displayTrace: { secondaryJobs: [{ id: "IC.BORROW_ONE_FUNCTION", title: "Borrow one function" }] },
  selectedNodes: [], blockedNodes: [], deferredNodes: [], forbiddenOverclaims: [], graphTrace: { sequencingNotes: [] },
  questionContract: { question: "Canonical question?" }, nextQuestion: "Canonical question?"
};
const adjudication = { next_question: "Canonical question?" };
const promptContext = (therapyScaffoldMode) => ({ userMessage: "Exact user wording", recentTranscript: "Exact recent transcript", userFacts: [], interventionContract: plan, therapyScaffoldMode });

class RecordingFixtureProvider {
  constructor({ id, model, fixture, calls, extractionVariables = null, unsafeIntegration = false }) {
    this.id = id;
    this.model = model;
    this.fixture = fixture;
    this.calls = calls;
    this.extractionVariables = extractionVariables;
    this.unsafeIntegration = unsafeIntegration;
  }

  async generate({ metadata = {}, system = "" }) {
    const fixtureKey = metadata.fixtureKey ?? metadata.stage;
    this.calls.push({ provider: this.id, model: this.model, stage: metadata.stage, fixtureKey });
    let value = this.fixture[this.id][fixtureKey];
    if (fixtureKey === "case_extraction" && this.extractionVariables) {
      value = { ...value, variables: { ...this.extractionVariables } };
    }
    const unrestrictedIntegration = fixtureKey === "model_first_integration"
      || (fixtureKey === "realization" && /evidence, not infallible conclusions/i.test(system));
    if (unrestrictedIntegration && this.unsafeIntegration) {
      value = {
        answer: "Use the blocked advanced-release intervention now.",
        next_question: "",
        realized_nodes: []
      };
    }
    assert.ok(value, `missing fixture ${this.id}:${fixtureKey}`);
    return {
      provider: this.id,
      model: this.model,
      text: JSON.stringify(value),
      requestId: `${this.id}-${metadata.stage}`,
      responseId: `${this.id}-${metadata.stage}`
    };
  }
}

async function modelFirstProviders(options = {}) {
  const fixture = JSON.parse(await fs.readFile(fixturePath, "utf8"));
  const calls = [];
  return {
    calls,
    providers: {
      renderer: new RecordingFixtureProvider({ id: "anthropic", model: "claude-sonnet-4-6", fixture, calls, ...options }),
      anthropic: new RecordingFixtureProvider({ id: "anthropic", model: "claude-opus-5", fixture, calls, ...options }),
      openai: new RecordingFixtureProvider({ id: "openai", model: "gpt-5.6-sol", fixture, calls, ...options })
    }
  };
}

test("scaffold mode defaults to current and rejects unknown values", () => {
  assert.equal(loadConfig({ mode: "mock" }).therapyScaffoldMode, "current");
  assert.throws(() => loadConfig({ mode: "mock", therapyScaffoldMode: "invented" }), /current, advisory, or model-first/);
});

test("current realization prompt is unchanged when the feature flag is absent", () => {
  const absent = realizationPrompt(promptContext(undefined), adjudication, "Claude");
  const explicit = realizationPrompt(promptContext("current"), adjudication, "Claude");
  assert.deepEqual(absent, explicit);
  assert.match(absent.system, /hard reasoning is already complete/i);
  assert.match(absent.system, /job is NOT to redo the formulation/);
});

test("advisory realization removes hard-formulation authority and mandatory node coverage", () => {
  const prompt = realizationPrompt(promptContext("advisory"), adjudication, "Claude");
  assert.doesNotMatch(prompt.system, /hard reasoning is already complete/i);
  assert.doesNotMatch(prompt.system, /NOT to redo the formulation/);
  assert.doesNotMatch(prompt.system, /Plan-realization fidelity is mandatory/);
  assert.match(prompt.system, /evidence, not infallible conclusions/i);
  assert.match(prompt.system, /Do not mechanically realize every selected node/i);
});

test("advisory node omission remains diagnostic and never triggers a rewrite", async () => {
  let calls = 0;
  const provider = { id: "anthropic", model: "claude-sonnet-4-6", async generate() {
    calls += 1;
    return { text: JSON.stringify({ answer: "One observable act can test credibility without demanding trust.", next_question: "", realized_nodes: [{ id: "IC.CREDIBILITY_REPAIR", evidence_quote: "observable act can test credibility" }] }), requestId: `r-${calls}` };
  } };
  const authority = classifyInterventionAuthority({ snapshot: { variables: plan.variables }, plan });
  const result = await realizeAdjudication({ context: { ...promptContext("advisory"), interventionAuthority: authority }, adjudication, provider });
  assert.equal(calls, 1);
  assert.equal(result.value.responseContract.realizationCoveragePassed, true);
  assert.equal(result.value.responseContract.diagnosticCoveragePassed, false);
  assert.deepEqual(result.value.responseContract.missingDiagnosticNodeIds, ["IC.BORROW_ONE_FUNCTION"]);
});

test("false realization claims remain invalid in advisory mode", () => {
  const result = enforceResponseContract({ answer: "The response does something else.", next_question: "", realized_nodes: [{ id: "IC.CREDIBILITY_REPAIR", evidence_quote: "quote not in the answer" }] }, { plan, adjudication, authorityMode: "advisory" });
  assert.deepEqual(result.responseContract.realizedNodeIds, []);
  assert.equal(result.responseContract.rejectedRealizations.length, 1);
});

test("a final integrator cannot claim a deterministically blocked intervention", () => {
  const blockedPlan = { ...plan, blockedNodes: [{ id: "SOM.ADVANCED_RELEASE_OPTIONAL", title: "Blocked" }] };
  const authority = classifyInterventionAuthority({ snapshot: { variables: plan.variables }, plan: blockedPlan });
  const enforced = enforceResponseContract({ answer: "Use the blocked intervention now.", next_question: "", realized_nodes: [{ id: "SOM.ADVANCED_RELEASE_OPTIONAL", evidence_quote: "blocked intervention now" }] }, { plan: blockedPlan, adjudication, authorityMode: "model-first", authority });
  assert.equal(enforced.responseContract.hardAuthorityPassed, false);
  assert.throws(() => assertHardAuthorityPreserved(enforced.responseContract, authority), (error) => error.code === "SCAFFOLD_HARD_AUTHORITY_VIOLATION");
});

test("model-first deep tier retains the established Opus reasoning and Codex critique roles", async () => {
  const { providers, calls } = await modelFirstProviders();
  const config = loadConfig({ mode: "mock", ledgerMode: "off", therapyProcessingMode: "deep", therapyScaffoldMode: "model-first" });
  const context = await buildContext({ userMessage: "Use deep review for this unresolved conflict.", recentTranscript: "", userFacts: [] }, config);
  const result = await runTieredTherapyPipeline({ context, providers, config, processingMode: "deep" });

  assert.equal(result.processingTier, "deep");
  assert.ok(calls.some((call) => call.stage === "semantic_formulation" && call.model === "claude-sonnet-4-6"));
  assert.ok(calls.some((call) => call.stage === "deep_analysis" && call.model === "claude-opus-5"));
  assert.ok(calls.some((call) => call.stage === "deep_critique" && call.model === "gpt-5.6-sol"));
  assert.ok(calls.some((call) => call.stage === "graph_audit" && call.model === "gpt-5.6-sol"));
  assert.ok(calls.some((call) => call.stage === "model_first_integration" && call.model === "claude-sonnet-4-6"));
  const stages = calls.map((call) => call.stage);
  assert.equal(stages[0], "semantic_formulation");
  assert.ok(stages.indexOf("deep_critique") < stages.indexOf("graph_audit"));
  assert.ok(stages.indexOf("graph_audit") < stages.indexOf("model_first_integration"));
  assert.deepEqual(
    result.scaffoldTrace.tierReasoning.providerStages.map(({ stage, provider, model }) => ({ stage, provider, model })),
    [
      { stage: "deep_analysis", provider: "anthropic", model: "claude-opus-5" },
      { stage: "deep_critique", provider: "openai", model: "gpt-5.6-sol" }
    ]
  );
});

test("model-first forensic tier retains the established adversarial council and adjudication roles", async () => {
  const { providers, calls } = await modelFirstProviders();
  const config = loadConfig({ mode: "mock", ledgerMode: "off", therapyProcessingMode: "forensic", therapyScaffoldMode: "model-first" });
  const context = await buildContext({ userMessage: "Use the full forensic council for this safety-sensitive ambiguity.", recentTranscript: "", userFacts: [] }, config);
  const result = await runTieredTherapyPipeline({ context, providers, config, processingMode: "forensic" });

  assert.equal(result.processingTier, "forensic");
  assert.equal(calls.filter((call) => call.stage === "candidate").length, 2);
  assert.ok(calls.some((call) => call.stage === "candidate" && call.model === "claude-opus-5"));
  assert.ok(calls.some((call) => call.stage === "candidate" && call.model === "gpt-5.6-sol"));
  assert.equal(calls.filter((call) => call.stage === "critique").length, 2);
  assert.ok(calls.some((call) => call.stage === "adjudication"));
  assert.ok(calls.some((call) => call.stage === "graph_audit" && call.model === "gpt-5.6-sol"));
  assert.ok(calls.some((call) => call.stage === "model_first_integration" && call.model === "claude-sonnet-4-6"));
  const stages = calls.map((call) => call.stage);
  assert.equal(stages[0], "semantic_formulation");
  assert.ok(stages.indexOf("adjudication") < stages.indexOf("graph_audit"));
  assert.ok(stages.indexOf("graph_audit") < stages.indexOf("model_first_integration"));
  assert.deepEqual(
    new Set(result.scaffoldTrace.tierReasoning.providerStages.map((item) => item.stage)),
    new Set(["candidate_openai", "candidate_anthropic", "critique_openai", "critique_anthropic", "adjudication"])
  );
});

test("real graph blocked nodes bypass advisory and model-first integration even when prose omits realized_nodes", async () => {
  const graphCase = JSON.parse(await fs.readFile(advancedReleaseCasePath, "utf8"));
  for (const therapyScaffoldMode of ["advisory", "model-first"]) {
    const { providers, calls } = await modelFirstProviders({ extractionVariables: graphCase.variables, unsafeIntegration: true });
    const config = loadConfig({ mode: "mock", ledgerMode: "off", therapyProcessingMode: "auto", therapyScaffoldMode });
    const context = await buildContext({ userMessage: "I want the advanced release even though there is a physical risk.", recentTranscript: "", userFacts: [] }, config);
    const result = await runTieredTherapyPipeline({ context, providers, config, processingMode: "auto" });

    assert.equal(result.interventionContract.primaryJob.id, "SOM.ADVANCED_RELEASE_BLOCK");
    assert.ok(result.interventionContract.blockedNodes.some((item) => item.id === "SOM.ADVANCED_RELEASE_OPTIONAL"));
    assert.equal(result.scaffoldTrace.authority.HARD.safety.length, 0);
    assert.ok(result.scaffoldTrace.finalIntegrationTrace.hardGateReasons.includes("blocked:SOM.ADVANCED_RELEASE_OPTIONAL"));
    assert.equal(calls.some((call) => call.stage === "model_first_integration"), false);
    assert.doesNotMatch(result.answer, /use the blocked advanced-release intervention now/i);
    assert.equal(result.scaffoldTrace.finalIntegrationTrace.deterministicSafetyGateActive, true);
    assert.equal("authorityMode" in result.responseContract, false);
  }
});

test("producer semantic prompt contains no benchmark insight wording", () => {
  const prompt = semanticFormulationPrompt({ userMessage: "u", recentTranscript: "r", userFacts: [], guideExcerpts: "g" }, "Claude");
  const text = `${prompt.system}\n${prompt.user}`;
  assert.doesNotMatch(text, /retaliation can itself supply more evidence/i);
  assert.doesNotMatch(text, /conditional care/i);
});

test("current, advisory, and model-first keep the same source input and canonical question", async () => {
  const input = { userMessage: "I can access love but it feels unsafe. The younger me says big fuckity whoopty doo, what are you gonna do for me, and I resent a younger version for not growing up.", recentTranscript: "Relaxation has not fixed the credibility conflict.", userFacts: [] };
  const results = {};
  for (const mode of ["current", "advisory", "model-first"]) {
    const config = loadConfig({ mode: "mock", ledgerMode: "off", therapyProcessingMode: "auto", therapyScaffoldMode: mode });
    const context = await buildContext(input, config);
    const providers = createProviders(config, { fixturePath });
    results[mode] = await runTieredTherapyPipeline({ context, providers, config, processingMode: "auto" });
  }
  assert.equal(results.current.next_question, results.advisory.next_question);
  assert.equal(results.current.next_question, results["model-first"].next_question);
  assert.equal(results["model-first"].therapyScaffoldMode, "model-first");
  assert.equal(results["model-first"].rendererModel, "mock-renderer");
  assert.equal(Object.isFrozen(results["model-first"].scaffoldTrace.rawSemanticFormulation), true);
  assert.notEqual(results["model-first"].scaffoldTrace.rawCaseExtraction, results["model-first"].caseFormulation);
  assert.equal(results["model-first"].scaffoldTrace.rawCaseExtraction.audit, undefined);
  assert.equal(results["model-first"].caseFormulation.audit.verdict, "accept");
  assert.equal(results["model-first"].scaffoldTrace.caseAuditDelta.verdict, "accept");
  assert.deepEqual(results["model-first"].scaffoldTrace.auditedVariables, results["model-first"].caseFormulation.variables);
});

test("omitting the scaffold flag preserves the explicit-current pipeline result", async () => {
  const input = { userMessage: "I can access love but it feels unsafe.", recentTranscript: "", userFacts: [] };
  const absentConfig = loadConfig({ mode: "mock", ledgerMode: "off", therapyProcessingMode: "auto" });
  const currentConfig = loadConfig({ mode: "mock", ledgerMode: "off", therapyProcessingMode: "auto", therapyScaffoldMode: "current" });
  const absentContext = await buildContext(input, absentConfig);
  const currentContext = await buildContext(input, currentConfig);
  const absent = await runTieredTherapyPipeline({ context: absentContext, providers: createProviders(absentConfig, { fixturePath }), config: absentConfig, processingMode: "auto" });
  const current = await runTieredTherapyPipeline({ context: currentContext, providers: createProviders(currentConfig, { fixturePath }), config: currentConfig, processingMode: "auto" });
  const deterministic = ({ performance, processingMs, decisionLedgerId, ...value }) => value;
  assert.deepEqual(deterministic(absent), deterministic(current));
  assert.equal("authorityMode" in absent.responseContract, false);
  assert.equal("diagnosticCoverageNodeIds" in absent.responseContract, false);
});

test("model-first cannot invoke its advisory integrator across a deterministic safety block", async () => {
  const fixture = JSON.parse(await fs.readFile(fixturePath, "utf8"));
  let calls = [];
  class InMemoryProvider {
    constructor(id, model) { this.id = id; this.model = model; }
    async generate({ metadata = {} }) {
      const key = metadata.fixtureKey ?? metadata.stage;
      calls.push(key);
      let value = fixture[this.id][key];
      if (key === "case_extraction") value = {
        ...value,
        variables: { ...value.variables, orientation: "disoriented", ability_to_stop: "no", current_intent: "deep_dialogue" }
      };
      assert.ok(value, `missing in-memory fixture ${this.id}:${key}`);
      return { provider: this.id, model: this.model, text: JSON.stringify(value), requestId: `${this.id}-${key}`, responseId: `${this.id}-${key}` };
    }
  }
  const config = loadConfig({ mode: "mock", ledgerMode: "off", therapyProcessingMode: "auto", therapyScaffoldMode: "model-first" });
  const context = await buildContext({ userMessage: "I am disoriented and cannot stop; take me deeper anyway.", recentTranscript: "", userFacts: [] }, config);
  const renderer = new InMemoryProvider("anthropic", "claude-sonnet-4-6");
  const result = await runTieredTherapyPipeline({ context, providers: { renderer, anthropic: renderer, openai: new InMemoryProvider("openai", "gpt-5.6-sol") }, config, processingMode: "auto" });
  assert.equal(result.scaffoldTrace.finalIntegrationTrace.deterministicSafetyGateActive, true);
  assert.equal(calls.includes("model_first_integration"), false);
  assert.equal(calls.includes("realization"), true);

  calls = [];
  const advisoryConfig = loadConfig({ mode: "mock", ledgerMode: "off", therapyProcessingMode: "auto", therapyScaffoldMode: "advisory" });
  const advisoryContext = await buildContext({ userMessage: "I am disoriented and cannot stop; take me deeper anyway.", recentTranscript: "", userFacts: [] }, advisoryConfig);
  const advisoryRenderer = new InMemoryProvider("anthropic", "claude-sonnet-4-6");
  const advisory = await runTieredTherapyPipeline({ context: advisoryContext, providers: { renderer: advisoryRenderer, anthropic: advisoryRenderer, openai: new InMemoryProvider("openai", "gpt-5.6-sol") }, config: advisoryConfig, processingMode: "auto" });
  assert.equal(advisory.scaffoldTrace.finalIntegrationTrace.deterministicSafetyGateActive, true);
  assert.equal("authorityMode" in advisory.responseContract, false);
});
