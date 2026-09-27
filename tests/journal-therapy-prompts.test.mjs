import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/core/config.mjs";
import { buildContext } from "../src/orchestrator/context-builder.mjs";
import { createProviders } from "../src/providers/factory.mjs";
import { runTieredTherapyPipeline } from "../src/orchestrator/run-tiered-pipeline.mjs";
import { caseExtractionPrompt } from "../src/prompts/case-extract.mjs";
import { caseAuditPrompt } from "../src/prompts/case-audit.mjs";
import { candidatePrompt } from "../src/prompts/candidate.mjs";
import { critiquePrompt } from "../src/prompts/critique.mjs";
import { adjudicationPrompt } from "../src/prompts/adjudicate.mjs";
import { realizationPrompt } from "../src/prompts/realize.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MARKER = "synthetic-journal-passage-7f3a";
// The shape the private model runtime adds to the pipeline context for a frozen journal packet.
const journal = {
  journal_evidence: { schema_version: 1, generation: "generation-1", evidence_groups: [{ ids: ["p1"], exact_spans: [{ quote: MARKER }] }], more_available: false },
  journal_evidence_sha256: "0".repeat(64)
};

test("every therapy producer prompt carries the frozen journal packet, and none gains a journal section without one", () => {
  const base = { guideManifest: { version: "synthetic" }, guideExcerpts: "", userFacts: [], userMessage: "A synthetic report.", recentTranscript: "" };
  const build = (context) => [caseExtractionPrompt(context), caseAuditPrompt(context, {}), candidatePrompt(context, "synthetic"),
    critiquePrompt(context, {}, "synthetic", "synthetic"), adjudicationPrompt(context, {}, "synthetic"), realizationPrompt(context, {}, "synthetic")];
  for (const prompt of build({ ...base, ...journal })) assert.ok(`${prompt.system}\n${prompt.user}`.includes(MARKER));
  for (const prompt of build(base)) assert.equal(`${prompt.system}\n${prompt.user}`.includes("AUTHORIZED JOURNAL EVIDENCE"), false);
});

test("the pipeline sends the journal packet to every model stage it runs", async () => {
  const cases = [
    { fixture: "tests/fixtures/fast-therapy.json", userMessage: "Give me one simple suggestion.", recentTranscript: "" },
    { fixture: "fixtures/mock-responses/A001.json",
      userMessage: "I can access love but it feels unsafe. The younger me says big fuckity whoopty doo, what are you gonna do for me, and I resent a younger version for not growing up.",
      recentTranscript: "Relaxation has not fixed the credibility conflict." }
  ];
  for (const { fixture, userMessage, recentTranscript } of cases) {
    const config = loadConfig({ mode: "mock", ledgerMode: "off", therapyProcessingMode: "auto" });
    const providers = createProviders(config, { fixturePath: path.join(root, fixture) });
    const requests = [];
    for (const provider of Object.values(providers)) {
      const generate = provider.generate.bind(provider);
      provider.generate = async (request) => { requests.push(request); return generate(request); };
    }
    const context = await buildContext({ userMessage, recentTranscript, userFacts: [] }, config);
    await runTieredTherapyPipeline({ context: { ...context, ...journal }, providers, config, processingMode: "auto" });
    assert.ok(requests.length >= 2, fixture);
    for (const request of requests) assert.ok(JSON.stringify(request).includes(MARKER), `${fixture}: ${request.metadata?.stage}`);
  }
});
