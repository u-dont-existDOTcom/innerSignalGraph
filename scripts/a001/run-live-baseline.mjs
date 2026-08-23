import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runPreflight } from "../verify-active-task.mjs";
import { loadConfig } from "../../src/core/config.mjs";
import { parseModelJson } from "../../src/core/json.mjs";
import { buildContext } from "../../src/orchestrator/context-builder.mjs";
import { runTieredTherapyPipeline } from "../../src/orchestrator/run-tiered-pipeline.mjs";
import { createProviders } from "../../src/providers/factory.mjs";
import { entitlementSchema } from "../../src/schemas/json-schemas.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptPath), "../..");

function argumentValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function git(...args) {
  return execFileSync("git", args, { cwd: projectRoot, encoding: "utf8" }).trim();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function originalQuestion() {
  const sourcePath = path.join(projectRoot, "analysis/a001/independent-conception.md");
  const source = await fs.readFile(sourcePath, "utf8");
  const match = source.match(/## Original question — verbatim\n\n> (.*?)\n\n## Problem/s);
  if (!match) throw new Error("Could not locate the verbatim A001 question.");
  const quoted = match[1].replace(/^> ?/gm, "").trim();
  if (!quoted.startsWith("“") || !quoted.endsWith("”")) {
    throw new Error("The preserved A001 question lost its quotation boundary.");
  }
  return quoted.slice(1, -1);
}

function sanitizedFailure(error) {
  return {
    name: error?.name ?? "Error",
    code: error?.code ?? null,
    message: String(error?.message ?? error)
  };
}

function usageProjection(response) {
  return {
    usage: response.usage ?? null,
    modelUsage: response.modelUsage ?? null
  };
}

function tracedProvider(provider, calls) {
  return {
    id: provider.id,
    model: provider.model,
    async generate(request) {
      const startedAt = new Date().toISOString();
      const started = Date.now();
      try {
        const response = await provider.generate(request);
        calls.push({
          stage: request.metadata?.stage ?? "unknown",
          provider: provider.id,
          requestedModel: provider.model,
          returnedModel: response.model ?? provider.model,
          requestId: response.requestId ?? null,
          responseId: response.responseId ?? response.requestId ?? null,
          transport: response.transport ?? null,
          startedAt,
          completedAt: new Date().toISOString(),
          elapsedMs: Date.now() - started,
          ...usageProjection(response)
        });
        return response;
      } catch (error) {
        calls.push({
          stage: request.metadata?.stage ?? "unknown",
          provider: provider.id,
          requestedModel: provider.model,
          startedAt,
          completedAt: new Date().toISOString(),
          elapsedMs: Date.now() - started,
          ok: false,
          failure: sanitizedFailure(error)
        });
        throw error;
      }
    }
  };
}

function tracedProviders(providers, calls) {
  return {
    openai: tracedProvider(providers.openai, calls),
    anthropic: tracedProvider(providers.anthropic, calls),
    renderer: tracedProvider(providers.renderer, calls)
  };
}

async function probeProvider(label, provider) {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  try {
    const response = await provider.generate({
      system: "This is a model-entitlement and structured-output check. Return only the requested schema.",
      user: 'Return {"ok": true}.',
      outputSchema: entitlementSchema,
      metadata: { stage: `a001_entitlement_${label}` }
    });
    const value = parseModelJson(response.text, `${label} entitlement response`);
    return {
      label,
      ok: value.ok === true,
      provider: provider.id,
      requestedModel: provider.model,
      returnedModel: response.model ?? provider.model,
      requestId: response.requestId ?? null,
      responseId: response.responseId ?? response.requestId ?? null,
      transport: response.transport ?? null,
      startedAt,
      completedAt: new Date().toISOString(),
      elapsedMs: Date.now() - started,
      ...usageProjection(response)
    };
  } catch (error) {
    return {
      label,
      ok: false,
      provider: provider.id,
      requestedModel: provider.model,
      startedAt,
      completedAt: new Date().toISOString(),
      elapsedMs: Date.now() - started,
      failure: sanitizedFailure(error)
    };
  }
}

function resultProjection(result) {
  const snapshot = result.caseFormulation ?? {};
  const plan = result.interventionContract ?? {};
  return {
    answer: result.answer,
    nextQuestion: result.next_question,
    mode: result.mode,
    processingTier: result.processingTier,
    routingReason: result.routingReason,
    routingDeltaCount: result.routingDeltaCount,
    degraded: result.degraded,
    graphBundleVersion: result.graphBundleVersion,
    guidePacketVersion: result.guidePacketVersion,
    rendererProvider: result.rendererProvider ?? null,
    rendererModel: result.rendererModel ?? null,
    realizationContractVersion: result.realizationContractVersion ?? null,
    responseContract: result.responseContract ?? null,
    performance: result.performance ?? null,
    processingMs: result.processingMs ?? null,
    safetyFlags: result.safety_flags ?? [],
    caseFormulation: {
      userGoal: snapshot.user_goal ?? null,
      currentIssue: snapshot.current_issue ?? null,
      directObservations: snapshot.direct_observations ?? [],
      hypotheses: snapshot.hypotheses ?? [],
      variables: snapshot.variables ?? null,
      unknowns: snapshot.unknowns ?? [],
      audit: snapshot.audit ?? null
    },
    interventionContract: {
      primaryJob: plan.primaryJob ?? null,
      displayTrace: plan.displayTrace ?? null,
      nextQuestion: plan.nextQuestion ?? null,
      questionContract: plan.questionContract ?? null,
      requiredNuance: plan.requiredNuance ?? [],
      avoid: plan.avoid ?? [],
      forbiddenOverclaims: plan.forbiddenOverclaims ?? []
    }
  };
}

async function runMockBaseline(question) {
  const config = loadConfig({
    mode: "mock",
    ledgerMode: "off",
    devAutomationEnabled: false,
    therapyProcessingMode: "auto"
  });
  const calls = [];
  const context = await buildContext({ userMessage: question }, config);
  const result = await runTieredTherapyPipeline({
    context,
    providers: tracedProviders(createProviders(config), calls),
    config,
    processingMode: "auto"
  });
  return {
    status: "captured",
    fixture: "fixtures/mock-responses/A001.json",
    archivedCase: "corpus/difficult-cases/A001-inner-child-credibility/case.json",
    caveat: "The archived case uses a summarized transcript and keyword/plan acceptance. This exact-input mock run is a deterministic regression fixture, not outcome evidence.",
    providerCalls: calls,
    result: resultProjection(result)
  };
}

async function runLiveBaseline(question, config) {
  const rawProviders = createProviders(config);
  const modelAccess = [
    await probeProvider("codex_independent_critic", rawProviders.openai),
    await probeProvider("opus_development_judgment", rawProviders.anthropic),
    await probeProvider("sonnet_production_renderer", rawProviders.renderer)
  ];
  if (modelAccess.some((item) => !item.ok)) {
    const failed = modelAccess.filter((item) => !item.ok).map((item) => item.requestedModel).join(", ");
    const error = new Error(`Live model access verification failed for: ${failed}`);
    error.code = "A001_MODEL_ACCESS_FAILED";
    return { status: "blocked", modelAccess, failure: sanitizedFailure(error) };
  }

  const calls = [];
  const startedAt = new Date().toISOString();
  try {
    const context = await buildContext({ userMessage: question }, config);
    const result = await runTieredTherapyPipeline({
      context,
      providers: tracedProviders(rawProviders, calls),
      config,
      processingMode: "auto",
      onProgress(event) {
        process.stderr.write(`[a001-live-baseline] ${event.stage} ${event.status}${event.detail ? `: ${event.detail}` : ""}\n`);
      }
    });
    return {
      status: "captured",
      startedAt,
      completedAt: new Date().toISOString(),
      modelAccess,
      providerCalls: calls,
      result: resultProjection(result)
    };
  } catch (error) {
    return {
      status: "blocked",
      startedAt,
      completedAt: new Date().toISOString(),
      modelAccess,
      providerCalls: calls,
      failure: sanitizedFailure(error)
    };
  }
}

async function writeJson(outputPath, value) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporaryPath, outputPath);
}

async function main() {
  const outputPath = path.resolve(projectRoot, argumentValue("--output", "analysis/a001/baseline-live.json"));
  const mockOnly = process.argv.includes("--mock-only");
  const preflight = runPreflight({ cwd: projectRoot });
  if (!preflight.ok) throw new Error(`A001 task preflight failed: ${preflight.findings.join(", ")}`);

  const question = await originalQuestion();
  const caseFile = JSON.parse(await fs.readFile(path.join(projectRoot, "corpus/difficult-cases/A001-inner-child-credibility/case.json"), "utf8"));
  const statusBeforeRun = git("status", "--porcelain");
  const artifact = {
    schemaVersion: 1,
    taskId: "a001-outcome-first-v1",
    artifactRole: "production-baseline",
    generatedAt: new Date().toISOString(),
    interpretationBoundary: "This captures system behavior and reproducibility evidence. It is not evidence of therapeutic outcome or model understanding.",
    repository: {
      branch: git("branch", "--show-current"),
      commit: git("rev-parse", "HEAD"),
      tree: git("rev-parse", "HEAD^{tree}"),
      worktreeCleanBeforeRun: statusBeforeRun === "",
      statusBeforeRun
    },
    exactInput: {
      source: "analysis/a001/independent-conception.md",
      sha256: sha256(question),
      canonicalTextStoredHere: false,
      privacyNote: "The verbatim text is not duplicated in this generated artifact. Resolve the committed source and verify this hash before execution.",
      recentTranscriptPresent: false,
      userFactsPresent: false
    },
    productionPath: {
      endpoint: "POST /v1/therapy/respond",
      serverSource: "src/server/create-server.mjs",
      pipeline: "runTieredTherapyPipeline",
      processingMode: "auto",
      transport: "subscription CLI"
    },
    configuration: {
      mode: mockOnly ? "mock-only-smoke" : "cli",
      openaiModel: "gpt-5.6-sol",
      anthropicModel: "claude-opus-5",
      responseRendererModel: "claude-sonnet-4-6",
      codexReasoningEffort: "high",
      claudeEffort: "high",
      ledgerMode: "off",
      devAutomationEnabled: false,
      allowClaudeFableUsage: false,
      claudeFableStatus: "not invoked; reserved only for verified unresolved adjudication"
    },
    staticMock: await runMockBaseline(question),
    actualProduction: { status: mockOnly ? "not-run-mock-only" : "pending" },
    graderExpectations: {
      source: "corpus/difficult-cases/A001-inner-child-credibility/case.json",
      acceptanceVersion: caseFile.acceptanceVersion,
      role: "regression guard only; keyword/plan matching is not outcome evidence",
      requiredConceptIds: caseFile.acceptance.response.requiredConcepts.map((item) => item.id),
      forbiddenClaimIds: caseFile.acceptance.response.forbiddenClaims.map((item) => item.id),
      plan: caseFile.acceptance.plan
    },
    independentEvaluations: {
      status: "pending-candidate-stage",
      note: "Blind Opus and Codex evaluations are physically separated from candidate generation and from these archived grader expectations."
    }
  };

  if (!mockOnly) {
    const config = loadConfig({
      mode: "cli",
      ledgerMode: "off",
      devAutomationEnabled: false,
      therapyProcessingMode: "auto",
      openaiModel: "gpt-5.6-sol",
      anthropicModel: "claude-opus-5",
      responseRendererModel: "claude-sonnet-4-6",
      codexReasoningEffort: "high",
      claudeEffort: "high",
      allowClaudeFableUsage: false,
      cliWorkingDirectory: projectRoot
    });
    artifact.actualProduction = await runLiveBaseline(question, config);
  }

  artifact.completedAt = new Date().toISOString();
  await writeJson(outputPath, artifact);
  process.stdout.write(`${JSON.stringify({ outputPath, status: artifact.actualProduction.status, commit: artifact.repository.commit })}\n`);
  if (!mockOnly && artifact.actualProduction.status !== "captured") process.exitCode = 1;
}

await main();
