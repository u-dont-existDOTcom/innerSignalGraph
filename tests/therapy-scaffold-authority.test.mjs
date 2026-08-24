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
const plan = {
  variables: { present_safety: "safe", orientation: "oriented", ability_to_stop: "yes", ability_to_return: "yes", dissociation: "none", altered_state: "sober", memory_source_risk: "absent" },
  primaryJob: { id: "IC.CREDIBILITY_REPAIR", title: "Credibility repair" },
  displayTrace: { secondaryJobs: [{ id: "IC.BORROW_ONE_FUNCTION", title: "Borrow one function" }] },
  selectedNodes: [], blockedNodes: [], deferredNodes: [], forbiddenOverclaims: [], graphTrace: { sequencingNotes: [] },
  questionContract: { question: "Canonical question?" }, nextQuestion: "Canonical question?"
};
const adjudication = { next_question: "Canonical question?" };
const promptContext = (therapyScaffoldMode) => ({ userMessage: "Exact user wording", recentTranscript: "Exact recent transcript", userFacts: [], interventionContract: plan, therapyScaffoldMode });

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
