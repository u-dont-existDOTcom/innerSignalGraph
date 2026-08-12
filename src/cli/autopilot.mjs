import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig, projectRoot } from "../core/config.mjs";
import { runSubprocess } from "../core/subprocess.mjs";
import { detectCodexCapabilities, detectClaudeCapabilities } from "../core/cli-capabilities.mjs";
import { createProgressReporter } from "../core/progress.mjs";
import { createRunState, writeJson, writeFinalStatus } from "../autopilot/status.mjs";
import { resolveCliModels, resolveAnthropicEscalation, resolveAnthropicRenderer } from "../autopilot/model-resolver.mjs";
import { setEnvValues } from "../autopilot/env-file.mjs";
import { buildContext, buildHypnosisContext } from "../orchestrator/context-builder.mjs";
import { runHypnosisAutopilot } from "../autopilot/hypnosis-autopilot.mjs";
import { runFormulatedPipeline } from "../orchestrator/run-formulated-pipeline.mjs";
import { runTieredTherapyPipeline } from "../orchestrator/run-tiered-pipeline.mjs";
import { realizeAdjudication } from "../orchestrator/run-pipeline.mjs";
import { evaluateStructuredBenchmark } from "../autopilot/benchmark-acceptance.mjs";
import { runRuntimeSmoke } from "../autopilot/runtime-smoke.mjs";
import { runWebClientSmoke } from "../autopilot/web-smoke.mjs";
import { launchRuntimeForeground } from "../autopilot/launch-runtime.mjs";
import { writeRoadmapState } from "../autopilot/roadmap-state.mjs";
import { diagnoseFailure } from "../autopilot/diagnose-failure.mjs";
import { normalizeAutopilotModelPolicy } from "../autopilot/model-policy.mjs";
import { loadGuide } from "../guide/load-guide.mjs";
import { loadCheckpointCache, loadLegacyA001BlockedRun, writeCheckpointCache, A001_PIPELINE_REVISION } from "../autopilot/resume-state.mjs";
import { compileGuideGraphs } from "../guide-graph/compiler.mjs";
import { runGraphRegressionSuite } from "../guide-graph/regressions.mjs";
import { ensureBundledGuidePacketCandidate } from "../guide-packet/autopilot.mjs";
import { looksLikeClaudeAuthFailure, hypnosisRunHasClaudeAuthFailure, resolutionHasClaudeAuthFailure } from "../autopilot/auth-recovery.mjs";
import { safeCaseStageFailure } from "../case-formulation/stage-failure.mjs";
import {
  buildA001StageFingerprint,
  createA001StageRecovery,
  decideA001FailureRoute,
  buildA001StageTerminal
} from "../autopilot/a001-stage-recovery.mjs";
import { summarizeTestFailure } from "../diagnostics/test-failure-summary.mjs";
import { finalizeRuntimeProgress, recordRuntimeProgress } from "../diagnostics/remote-progress.mjs";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const skipTests = args.has("--skip-tests");
const skipBenchmarks = args.has("--no-benchmarks");
const skipH001 = skipBenchmarks || args.has("--no-h001");
const skipA001 = skipBenchmarks || args.has("--no-a001");
const skipRuntimeSmoke = args.has("--no-runtime-smoke");
const skipWebSmoke = args.has("--no-web-smoke");
const noLaunch = args.has("--no-launch");
const externalLaunch = args.has("--external-launch");
const terminalProgress = createProgressReporter({ prefix: "autopilot" });
let progressStateDir = null;
const progress = (event) => {
  terminalProgress(event);
  if (!progressStateDir) return;
  recordRuntimeProgress({ stateDir: progressStateDir, event }).catch((error) => {
    process.stderr.write(`[autopilot] progress-state warning: ${error?.code ?? "WRITE_FAILED"}\n`);
  });
};
class AutopilotTerminal extends Error {}

function errorShape(error) {
  return {
    message: error?.message ?? String(error),
    code: error?.code,
    details: error?.details,
    cause: error?.cause?.message
  };
}

async function version(command, label) {
  try {
    const run = await runSubprocess({ command, args: ["--version"], timeoutMs: 30000, label });
    return { ok: run.code === 0, code: run.code, text: (run.stdout || run.stderr).trim() };
  } catch (error) {
    return { ok: false, error: errorShape(error) };
  }
}

async function diagnostics(config) {
  const [codexVersion, claudeVersion, codexCaps, claudeCaps] = await Promise.all([
    version(config.codexCommand, "Codex CLI version check"),
    version(config.claudeCommand, "Claude CLI version check"),
    detectCodexCapabilities(config.codexCommand).catch((error) => ({ error: errorShape(error), flags: {} })),
    detectClaudeCapabilities(config.claudeCommand).catch((error) => ({ error: errorShape(error), flags: {} }))
  ]);
  const requiredCapabilities = {
    codex: Boolean(codexCaps.flags?.outputSchema && codexCaps.flags?.outputLastMessage),
    claude: Boolean(claudeCaps.flags?.print && claudeCaps.flags?.outputFormat && claudeCaps.flags?.jsonSchema)
  };
  return {
    ok: codexVersion.ok && claudeVersion.ok && requiredCapabilities.codex && requiredCapabilities.claude,
    versions: { codex: codexVersion, claude: claudeVersion },
    requiredCapabilities,
    capabilities: { codex: codexCaps.flags ?? {}, claude: claudeCaps.flags ?? {} },
    errors: { codex: codexCaps.error, claude: claudeCaps.error }
  };
}

async function findCase(caseId) {
  const corpusRoot = path.join(projectRoot, "corpus/difficult-cases");
  const entries = await fs.readdir(corpusRoot, { withFileTypes: true });
  const matches = entries.filter((entry) => entry.isDirectory() && entry.name.startsWith(`${caseId}-`));
  if (matches.length !== 1) throw new Error(`Expected one case beginning ${caseId}-, found ${matches.length}.`);
  return JSON.parse(await fs.readFile(path.join(corpusRoot, matches[0].name, "case.json"), "utf8"));
}

async function finalize({ config, runDir, status, stage, summary, nextAction = "", doNotDo = [], details = {}, exitCode = 0 }) {
  const body = {
    status,
    stage,
    summary,
    nextAction,
    doNotDo,
    runDir,
    generatedAt: new Date().toISOString(),
    actionCode: details?.actionCode ?? null,
    details
  };
  await finalizeRuntimeProgress({ stateDir: config.autopilotStateDir, status, stage }).catch((error) => {
    process.stderr.write(`[autopilot] progress-state warning: ${error?.code ?? "WRITE_FAILED"}\n`);
  });
  await writeJson(path.join(runDir, "final-status.json"), body);
  await writeFinalStatus(config.autopilotStateDir, body);
  const printed = { status, stage, summary, nextAction, localState: config.autopilotStateDir };
  if (details?.failure) printed.failure = details.failure;
  console.log(JSON.stringify(printed, null, 2));
  process.exitCode = exitCode;
  return body;
}

function adjudicationFromResult(result) {
  if (result?.adjudicationPacket) return result.adjudicationPacket;
  return {
    answer: result?.answer ?? "",
    what_is_clear: result?.what_is_clear ?? [],
    uncertainties: result?.uncertainties ?? [],
    next_question: result?.next_question ?? "",
    accepted_insights: result?.accepted_insights ?? [],
    rejected_claims: result?.rejected_claims ?? [],
    safety_flags: result?.safety_flags ?? [],
    decision_summary: result?.decision_summary ?? "Preserved prior adjudicated reasoning for realization-only migration."
  };
}

async function rerenderA001({ result, definition, config, provider, feedback, onProgress }) {
  const base = await buildContext(definition.input, config);
  const context = {
    ...base,
    caseFormulation: result.caseFormulation,
    interventionContract: result.interventionContract,
    graphBundleVersion: result.graphBundleVersion,
    autopilotFeedback: feedback ?? null
  };
  const realized = await realizeAdjudication({
    context,
    adjudication: adjudicationFromResult(result),
    provider,
    onProgress
  });
  return {
    ...result,
    answer: realized.value.answer,
    next_question: realized.value.next_question || result.next_question || "",
    rendererProvider: provider.id,
    rendererModel: provider.model,
    realizationContractVersion: "response-realization-v4",
    adjudicationPacket: adjudicationFromResult(result)
  };
}

function priorHypnosisFeedback(run) {
  const last = run?.attempts?.at(-1)?.result;
  return {
    source: "opus-attempts",
    deterministic_issues: last?.deterministicAudit?.issues ?? [],
    final_verdict: last?.finalReview?.verdict ?? "unknown",
    remaining_issues: last?.finalReview?.remaining_issues ?? [],
    instruction: "Use the stronger Claude model to resolve only the remaining issues. Preserve the app-owned gate, route isolation, uncertainty limits, and waking return."
  };
}

if (dryRun) {
  console.log(JSON.stringify({
    ok: true,
    mode: "dry-run",
    logsRequiredFromUser: false,
    skipTests,
    skipH001,
    skipA001,
    skipRuntimeSmoke,
    skipWebSmoke,
    noLaunch,
    externalLaunch,
    modelPolicy: {
      anthropicPrimary: "claude-opus-5",
      anthropicEscalation: "claude-fable-5",
      anthropicRenderer: "claude-sonnet-4-6 (validated automatically; Opus fallback)",
      openaiReviewer: "gpt-5.6-sol"
    },
    stages: [
      "immediate-local-app",
      "prepare-environment",
      "guide-graph-compile",
      "guide-graph-regressions",
      "tests",
      "cli-capability-check",
      "interactive-Claude-auth-recovery",
      "automatic-model-resolution",
      "guide-packet-candidate",
      "H001-hypnosis-compiler",
      "conditional-Fable-escalation",
      "A001-adversarial-therapy-benchmark",
      "response-realization",
      "auto-tiered-live-therapy",
      "runtime-server-smoke",
      "web-client-smoke",
      "roadmap-state",
      "foreground-local-app",
      "autonomous-development-worker",
      "stale-development-case-requeue",
      "continuous-autonomous-roadmap",
      "isolated-repair-candidate",
      "independent-patch-review",
      "exact-case-replay",
      "automatic-restorative-promotion",
      "human-policy-decision-only-when-required",
      "local-failure-diagnosis",
      "checkpoint-resume",
      "final-status"
    ],
    terminalStates: ["PASS", "ACTION_REQUIRED", "BLOCKED"]
  }, null, 2));
  process.exit(0);
}

const modelPolicy = normalizeAutopilotModelPolicy(process.env);
const config = loadConfig({ mode: "cli" });
progressStateDir = config.autopilotStateDir;
const { runDir } = await createRunState(config.autopilotStateDir);
if (modelPolicy.changed) {
  await setEnvValues(path.join(projectRoot, ".env"), modelPolicy.updates);
  progress({
    stage: "prepare-environment",
    status: "completed",
    detail: `Standalone policy applied: ${modelPolicy.selectedModel} normally; ${modelPolicy.escalationModel} on escalation.`
  });
}

await writeJson(path.join(runDir, "run-config.json"), {
  mode: config.mode,
  configuredModels: {
    openai: config.openaiModel,
    anthropicPrimary: config.anthropicModel,
    anthropicEscalation: config.anthropicEscalationModel,
    anthropicRenderer: config.responseRendererModel
  },
  maxHypnosisAttempts: config.autopilotMaxHypnosisAttempts,
  primaryHypnosisAttempts: config.autopilotPrimaryHypnosisAttempts,
  modelPolicy,
  startedAt: new Date().toISOString()
});

try {
  progress({ stage: "guide-graph-compile", status: "started" });
  const graphBundle = await compileGuideGraphs({ root: projectRoot, write: true });
  await writeJson(path.join(runDir, "guide-graph-compile.json"), {
    ok: true,
    contractVersion: graphBundle.contractVersion,
    version: graphBundle.version,
    stats: graphBundle.stats
  });
  progress({ stage: "guide-graph-compile", status: "completed", detail: `${graphBundle.stats.nodeCount} nodes; ${graphBundle.stats.edgeCount} edges` });

  progress({ stage: "guide-graph-regressions", status: "started" });
  const graphRegressions = await runGraphRegressionSuite({ root: projectRoot });
  await writeJson(path.join(runDir, "guide-graph-regressions.json"), graphRegressions);
  if (!graphRegressions.ok) {
    await finalize({
      config,
      runDir,
      status: "BLOCKED",
      stage: "guide-graph-regressions",
      summary: "The compiled inner-child/somatic decision graph failed its deterministic branch cases and stopped safely.",
      nextAction: "The graph compiler preserved the exact failed cases locally for a corrected runtime release.",
      doNotDo: ["Do not bypass the graph regression gate.", "Do not upload logs."],
      details: { failed: graphRegressions.results.filter((item) => !item.ok).map((item) => item.id) },
      exitCode: 1
    });
    throw new AutopilotTerminal();
  }
  progress({ stage: "guide-graph-regressions", status: "completed", detail: `${graphRegressions.count}/${graphRegressions.count} cases` });

  if (!skipTests) {
    progress({ stage: "tests", status: "started" });
    const tests = await runSubprocess({ command: "npm", args: ["test"], cwd: projectRoot, timeoutMs: 900000, label: "package tests" });
    await fs.writeFile(path.join(runDir, "tests.stdout.log"), tests.stdout);
    await fs.writeFile(path.join(runDir, "tests.stderr.log"), tests.stderr);
    if (tests.code !== 0) {
      const testSummary = summarizeTestFailure({
        command: "npm test",
        exitCode: tests.code,
        stdout: tests.stdout,
        stderr: tests.stderr,
        projectRoot
      });
      await writeJson(path.join(runDir, "test-failure-summary.json"), testSummary);
      const diagnosis = config.autopilotDiagnoseFailures
        ? await diagnoseFailure({ provider: null, stage: "tests", summary: `Package tests exited with status ${tests.code}.`, evidence: `${tests.stdout}\n${tests.stderr}` })
        : null;
      await finalize({
        config,
        runDir,
        status: "BLOCKED",
        stage: "tests",
        summary: diagnosis?.summary ?? "The installed package failed its deterministic tests and stopped safely.",
        nextAction: diagnosis?.next_action ?? "Install a corrected runtime release. Local evidence is already preserved.",
        doNotDo: diagnosis?.do_not_do ?? ["Do not bypass the failed tests.", "Do not upload logs."],
        details: { testExitCode: tests.code, testSummary },
        exitCode: 1
      });
      throw new AutopilotTerminal();
    }
    progress({ stage: "tests", status: "completed" });
  }

  progress({ stage: "cli-capability-check", status: "started" });
  const diag = await diagnostics(config);
  await writeJson(path.join(runDir, "cli-diagnostics.json"), diag);
  if (!diag.ok) {
    await finalize({
      config,
      runDir,
      status: "ACTION_REQUIRED",
      stage: "cli-capability-check",
      summary: "Codex or Claude CLI is missing, not runnable, or lacks required structured-output flags.",
      nextAction: "Install or update the failing CLI and complete its normal login once, then rerun ./run-autopilot.sh.",
      doNotDo: ["Do not add API keys.", "Do not upload diagnostic logs."],
      details: diag,
      exitCode: 2
    });
    throw new AutopilotTerminal();
  }
  progress({ stage: "cli-capability-check", status: "completed" });

  progress({ stage: "automatic-model-resolution", status: "started" });
  const resolution = await resolveCliModels(config, { onProgress: progress });
  const modelResolutionRecord = {
    contractVersion: "inner-signal-model-resolution-v2",
    generatedAt: new Date().toISOString(),
    ok: resolution.ok,
    selected: {
      openai: resolution.openai?.model || "CLI default",
      anthropic: resolution.anthropic?.model || "CLI default"
    },
    evidence: {
      openai: resolution.openai?.evidence ?? null,
      anthropic: resolution.anthropic?.evidence ?? null
    },
    attempts: resolution.attempts
  };
  await writeJson(path.join(runDir, "model-resolution.json"), modelResolutionRecord);
  await writeJson(path.join(config.autopilotStateDir, "model-resolution-latest.json"), {
    ...modelResolutionRecord,
    runDir
  });
  if (!resolution.ok) {
    if (resolutionHasClaudeAuthFailure(resolution)) {
      await finalize({
        config,
        runDir,
        status: "ACTION_REQUIRED",
        stage: "automatic-model-resolution",
        summary: "The Claude CLI session expired or its OAuth refresh failed. The wrapper can repair this with one interactive Claude login and then resume automatically.",
        nextAction: "Complete the browser sign-in opened by the wrapper. No rerun command or log transfer is required.",
        doNotDo: ["Do not add API keys.", "Do not buy API credits.", "Do not upload logs."],
        details: { actionCode: "CLAUDE_REAUTH", attempts: resolution.attempts },
        exitCode: 2
      });
      throw new AutopilotTerminal();
    }
    const availableDiagnostician = resolution.openai?.provider ?? null;
    const diagnosis = config.autopilotDiagnoseFailures
      ? await diagnoseFailure({
          provider: availableDiagnostician,
          stage: "automatic-model-resolution",
          summary: "The runtime could not establish both providers after live exact-model checks.",
          evidence: resolution.attempts
        })
      : null;
    await finalize({
      config,
      runDir,
      status: "ACTION_REQUIRED",
      stage: "automatic-model-resolution",
      summary: diagnosis?.summary ?? "At least one CLI is not authenticated or no tested selector is available.",
      nextAction: diagnosis?.next_action ?? "Open the failing CLI once, complete login, and rerun ./run-autopilot.sh.",
      doNotDo: diagnosis?.do_not_do ?? ["Do not buy API credits.", "Do not upload logs."],
      details: { attempts: resolution.attempts },
      exitCode: 2
    });
    throw new AutopilotTerminal();
  }

  const selectedOpenAI = resolution.openai.model;
  const selectedAnthropic = resolution.anthropic.model;
  await setEnvValues(path.join(projectRoot, ".env"), {
    OPENAI_MODEL: selectedOpenAI,
    ANTHROPIC_MODEL: selectedAnthropic
  });
  progress({ stage: "automatic-model-resolution", status: "completed", detail: `${selectedOpenAI || "Codex default"}; ${selectedAnthropic || "Claude default"}` });

  const resolvedConfig = { ...config, openaiModel: selectedOpenAI, anthropicModel: selectedAnthropic };
  let rendererResolution = await resolveAnthropicRenderer(resolvedConfig, {
    onProgress: progress,
    excludeModels: []
  });
  await writeJson(path.join(runDir, "anthropic-renderer-resolution.json"), rendererResolution);
  const resolvedRendererModel = rendererResolution.ok ? rendererResolution.resolved.model : selectedAnthropic;
  const primaryProviders = {
    openai: resolution.openai.provider,
    anthropic: resolution.anthropic.provider,
    renderer: rendererResolution.ok ? rendererResolution.resolved.provider : resolution.anthropic.provider
  };
  if (!rendererResolution.ok) {
    progress({ stage: "model-resolution:anthropic-renderer", status: "completed", detail: `renderer fallback: ${selectedAnthropic}` });
  }
  let escalationResolution = null;

  async function ensureFable() {
    if (/fable/i.test(primaryProviders.anthropic.model)) {
      return { ok: true, resolved: { model: primaryProviders.anthropic.model, provider: primaryProviders.anthropic }, attempts: [] };
    }
    if (escalationResolution) return escalationResolution;
    escalationResolution = await resolveAnthropicEscalation(resolvedConfig, {
      onProgress: progress,
      excludeModels: [primaryProviders.anthropic.model]
    });
    await writeJson(path.join(runDir, "anthropic-escalation-resolution.json"), escalationResolution);
    return escalationResolution;
  }

  let guidePacketCandidate = null;
  try {
    guidePacketCandidate = await ensureBundledGuidePacketCandidate({
      config: { ...resolvedConfig, responseRendererModel: resolvedRendererModel },
      compiler: skipBenchmarks ? null : primaryProviders.anthropic,
      reviewer: skipBenchmarks ? null : primaryProviders.openai,
      escalationReviewerFactory: skipBenchmarks ? null : async () => {
        const fable = await ensureFable();
        return fable.ok ? fable.resolved.provider : null;
      },
      onProgress: progress
    });
    await writeJson(path.join(runDir, "guide-packet-candidate.json"), guidePacketCandidate);
    progress({
      stage: "guide-packet-candidate",
      status: "completed",
      detail: guidePacketCandidate.skipped
        ? guidePacketCandidate.reason
        : guidePacketCandidate.reviewed
          ? guidePacketCandidate.review?.status ?? "reviewed"
          : "staged deterministically"
    });
  } catch (error) {
    guidePacketCandidate = { ok: false, error: error.message };
    await writeJson(path.join(runDir, "guide-packet-candidate.json"), guidePacketCandidate);
    progress({ stage: "guide-packet-candidate", status: "failed", detail: error.message });
  }

  const guideVersion = (await loadGuide(resolvedConfig)).manifest.version;
  const a001Definition = (!skipA001 && resolvedConfig.autopilotRunA001) ? await findCase("A001") : null;
  const selectedModelsForResume = {
    openai: selectedOpenAI,
    anthropicPrimary: selectedAnthropic,
    anthropicRenderer: resolvedRendererModel
  };
  let resume = null;
  if (resolvedConfig.autopilotReuseCheckpoints && a001Definition) {
    resume = await loadCheckpointCache({
      stateDir: resolvedConfig.autopilotStateDir,
      selectedModels: selectedModelsForResume,
      guideVersion,
      a001Definition,
      graphs: graphBundle.graphs
    });
    if (!resume) {
      resume = await loadLegacyA001BlockedRun({
        stateDir: resolvedConfig.autopilotStateDir,
        selectedModels: selectedModelsForResume,
        guideVersion,
        a001Definition,
        graphs: graphBundle.graphs
      });
    }
    if (resume) {
      progress({
        stage: "checkpoint-resume",
        status: "completed",
        detail: `${resume.source}; ${resume.H001 ? "H001" : ""}${resume.H001 && resume.A001 ? "+" : ""}${resume.A001 ? "A001" : ""} revalidated`
      });
      await writeJson(path.join(runDir, "resume-source.json"), {
        source: resume.source,
        sourceRunDir: resume.sourceRunDir ?? null,
        reusedH001: Boolean(resume.H001),
        reusedA001: Boolean(resume.A001),
        revalidatedAt: new Date().toISOString()
      });
    }
  }

  let checkpointH001 = resume?.H001 ?? null;
  let checkpointA001 = resume?.A001 ?? null;
  let h001Summary = { skipped: true };
  if (!skipH001 && checkpointH001) {
    h001Summary = {
      skipped: false,
      releaseable: true,
      attempts: checkpointH001.attempts?.length ?? 0,
      escalated: Boolean(checkpointH001.escalated),
      decisionLedgerId: checkpointH001.result?.decisionLedgerId,
      reused: true
    };
    await writeJson(path.join(runDir, "H001-autopilot-result.json"), {
      ...checkpointH001,
      reused: true,
      reuseSource: resume?.source ?? "resume-cache"
    });
    progress({ stage: "H001-checkpoint", status: "completed", detail: "prior releaseable H001 result revalidated; no model calls repeated" });
  } else if (!skipH001) {
    const definition = await findCase("H001");
    const context = await buildHypnosisContext(definition.input, resolvedConfig);
    const primaryAttemptBudget = Math.min(
      resolvedConfig.autopilotPrimaryHypnosisAttempts,
      resolvedConfig.autopilotMaxHypnosisAttempts
    );
    const primaryRun = await runHypnosisAutopilot({
      context,
      providers: primaryProviders,
      config: { ...resolvedConfig, autopilotMaxHypnosisAttempts: primaryAttemptBudget },
      caseId: `${definition.id}-primary`,
      onProgress: progress
    });

    if (!primaryRun.ok && hypnosisRunHasClaudeAuthFailure(primaryRun)) {
      await writeJson(path.join(runDir, "H001-autopilot-result.json"), {
        ok: false,
        result: primaryRun.result,
        attempts: primaryRun.attempts.map((attempt) => ({ ...attempt, tier: "primary" })),
        escalated: false,
        authRecoveryRequired: true
      });
      await finalize({
        config: resolvedConfig,
        runDir,
        status: "ACTION_REQUIRED",
        stage: "H001-hypnosis-compiler",
        summary: "The hypnosis compiler stopped because the Claude CLI OAuth session expired or refresh failed. Fable escalation was intentionally not attempted because it uses the same Claude authentication.",
        nextAction: "Complete the browser sign-in opened by the wrapper. The wrapper will then rerun the interrupted validation automatically.",
        doNotDo: ["Do not switch to API billing.", "Do not upload logs.", "Do not manually rerun H001."],
        details: { actionCode: "CLAUDE_REAUTH", attempts: primaryRun.attempts },
        exitCode: 2
      });
      throw new AutopilotTerminal();
    }

    let hypnosis = {
      ok: primaryRun.ok,
      result: primaryRun.result,
      attempts: primaryRun.attempts.map((attempt) => ({ ...attempt, tier: "primary" })),
      escalated: false
    };

    const remainingAttempts = resolvedConfig.autopilotMaxHypnosisAttempts - primaryAttemptBudget;
    if (!hypnosis.ok && remainingAttempts > 0 && resolvedConfig.autopilotEscalateToFable) {
      progress({ stage: "H001-Fable-escalation", status: "started", detail: "Opus did not clear H001 within the primary attempt budget." });
      const fable = await ensureFable();
      if (fable.ok) {
        const escalatedContext = { ...context, autopilotFeedback: priorHypnosisFeedback(primaryRun) };
        const escalatedRun = await runHypnosisAutopilot({
          context: escalatedContext,
          providers: { openai: primaryProviders.openai, anthropic: fable.resolved.provider, renderer: primaryProviders.renderer },
          config: { ...resolvedConfig, anthropicModel: fable.resolved.model, autopilotMaxHypnosisAttempts: remainingAttempts },
          caseId: `${definition.id}-fable`,
          onProgress: progress
        });
        hypnosis = {
          ok: escalatedRun.ok,
          result: escalatedRun.result,
          attempts: [
            ...hypnosis.attempts,
            ...escalatedRun.attempts.map((attempt) => ({ ...attempt, tier: "fable-escalation" }))
          ],
          escalated: true
        };
        progress({ stage: "H001-Fable-escalation", status: escalatedRun.ok ? "completed" : "failed", detail: fable.resolved.model });
      } else {
        progress({ stage: "H001-Fable-escalation", status: "failed", detail: "Fable selector was unavailable." });
      }
    }

    await writeJson(path.join(runDir, "H001-autopilot-result.json"), hypnosis);
    if (!hypnosis.ok) {
      const diagnosis = config.autopilotDiagnoseFailures
        ? await diagnoseFailure({
            provider: primaryProviders.openai,
            stage: "H001-hypnosis-compiler",
            summary: `H001 remained blocked after ${hypnosis.attempts.length} adversarial attempt(s), including Fable escalation when available.`,
            evidence: hypnosis
          })
        : null;
      await finalize({
        config: resolvedConfig,
        runDir,
        status: diagnosis?.human_action_required ? "ACTION_REQUIRED" : "BLOCKED",
        stage: "H001-hypnosis-compiler",
        summary: diagnosis?.summary ?? "The hypnosis compiler could not produce a releaseable H001 session without weakening the contract.",
        nextAction: diagnosis?.next_action ?? "The runtime preserved and diagnosed the failure locally. Install a corrected release when available.",
        doNotDo: diagnosis?.do_not_do ?? ["Do not weaken the hypnosis contract.", "Do not upload logs."],
        details: { attempts: hypnosis.attempts.length, escalated: hypnosis.escalated, diagnosis },
        exitCode: 1
      });
      throw new AutopilotTerminal();
    }
    h001Summary = {
      skipped: false,
      releaseable: true,
      attempts: hypnosis.attempts.length,
      escalated: hypnosis.escalated,
      decisionLedgerId: hypnosis.result.decisionLedgerId,
      reused: false
    };
    checkpointH001 = hypnosis;
    if (resolvedConfig.autopilotReuseCheckpoints) {
      await writeCheckpointCache({
        stateDir: resolvedConfig.autopilotStateDir,
        selectedModels: selectedModelsForResume,
        guideVersion,
        H001: checkpointH001,
        A001: checkpointA001
      });
    }
  }

  if (!skipA001 && resolvedConfig.autopilotRunA001 && checkpointA001?.needsRealizationUpgrade) {
    progress({ stage: "A001-realization-upgrade", status: "started", detail: "reusing prior formulation/adjudication; no candidate or critique calls repeated" });
    const prior = checkpointA001.result;
    try {
      let upgraded = await rerenderA001({
        result: prior,
        definition: a001Definition,
        config: resolvedConfig,
        provider: primaryProviders.renderer,
        feedback: {
          instruction: "Realize the already-approved reasoning into natural user-facing prose. Preserve the live question, ask the developmental-age question, and show repeated non-defensive follow-through without generic safety boilerplate."
        },
        onProgress: progress
      });
      let upgradedAcceptance = evaluateStructuredBenchmark(upgraded, a001Definition.acceptance);

      if (!upgradedAcceptance.ok && upgradedAcceptance.plan.missing.length === 0
          && primaryProviders.renderer.model !== primaryProviders.anthropic.model) {
        progress({ stage: "A001-realization-Opus-fallback", status: "started", detail: primaryProviders.anthropic.model });
        upgraded = await rerenderA001({
          result: prior,
          definition: a001Definition,
          config: resolvedConfig,
          provider: primaryProviders.anthropic,
          feedback: {
            responseAcceptance: upgradedAcceptance.response,
            instruction: "The reasoning is already approved. Repair only the final realization; keep it concrete, use the user's live question, and do not append generic caveats."
          },
          onProgress: progress
        });
        upgradedAcceptance = evaluateStructuredBenchmark(upgraded, a001Definition.acceptance);
        progress({ stage: "A001-realization-Opus-fallback", status: upgradedAcceptance.ok ? "completed" : "failed", detail: primaryProviders.anthropic.model });
      }

      if (!upgradedAcceptance.ok && upgradedAcceptance.plan.missing.length === 0 && resolvedConfig.autopilotEscalateToFable) {
        const fable = await ensureFable();
        if (fable.ok) {
          progress({ stage: "A001-realization-Fable-escalation", status: "started", detail: fable.resolved.model });
          upgraded = await rerenderA001({
            result: prior,
            definition: a001Definition,
            config: resolvedConfig,
            provider: fable.resolved.provider,
            feedback: {
              responseAcceptance: upgradedAcceptance.response,
              instruction: "Repair only the final realization. Do not redo or broaden the formulation."
            },
            onProgress: progress
          });
          upgradedAcceptance = evaluateStructuredBenchmark(upgraded, a001Definition.acceptance);
          progress({ stage: "A001-realization-Fable-escalation", status: upgradedAcceptance.ok ? "completed" : "failed", detail: fable.resolved.model });
        }
      }

      if (upgradedAcceptance.ok) {
        checkpointA001 = {
          pipelineRevision: A001_PIPELINE_REVISION,
          acceptanceVersion: a001Definition.acceptanceVersion ?? "legacy",
          ok: true,
          result: upgraded,
          acceptance: upgradedAcceptance,
          escalated: Boolean(checkpointA001.escalated) || /fable/i.test(upgraded.rendererModel ?? ""),
          needsRealizationUpgrade: false
        };
        progress({ stage: "A001-realization-upgrade", status: "completed", detail: `re-rendered only with ${upgraded.rendererModel}; prior expensive reasoning reused` });
      } else {
        await writeJson(path.join(runDir, "A001-realization-upgrade-failed.json"), { acceptance: upgradedAcceptance, result: upgraded });
        checkpointA001 = null;
        progress({ stage: "A001-realization-upgrade", status: "failed", detail: "realization-only upgrade did not clear the new contract; full A001 will rerun" });
      }
    } catch (error) {
      await writeJson(path.join(runDir, "A001-realization-upgrade-error.json"), errorShape(error));
      checkpointA001 = null;
      progress({ stage: "A001-realization-upgrade", status: "failed", detail: "realization-only upgrade errored; full A001 will rerun" });
    }
  }

  let a001Summary = { skipped: true };
  if (!skipA001 && resolvedConfig.autopilotRunA001 && checkpointA001) {
    a001Summary = {
      skipped: false,
      ok: true,
      escalated: Boolean(checkpointA001.escalated),
      acceptance: checkpointA001.acceptance,
      result: checkpointA001.result,
      primaryError: null,
      reused: true
    };
    await writeJson(path.join(runDir, "A001-autopilot-result.json"), {
      ...a001Summary,
      reuseSource: resume?.source ?? "resume-cache"
    });
    progress({ stage: "A001-checkpoint", status: "completed", detail: "prior reasoning passed and the current realization contract is validated; no expensive reasoning calls repeated" });
  } else if (!skipA001 && resolvedConfig.autopilotRunA001) {
    progress({ stage: "A001-adversarial-therapy-benchmark", status: "started", detail: `production auto-tiered path; ${primaryProviders.renderer.model} renderer` });
    const definition = a001Definition;
    const context = await buildContext(definition.input, resolvedConfig);
    let result = null;
    let acceptance = null;
    let primaryError = null;
    let primaryStageFailure = null;
    let fableCaseRecovery = null;
    const primaryExtractor = primaryProviders.renderer ?? primaryProviders.anthropic;
    const primaryCaseRecovery = createA001StageRecovery({
      stateDir: resolvedConfig.autopilotStateDir,
      lane: "primary",
      fingerprint: buildA001StageFingerprint({
        caseId: definition.id,
        acceptanceVersion: definition.acceptanceVersion ?? "legacy",
        pipelineRevision: A001_PIPELINE_REVISION,
        guideVersion,
        lane: "primary",
        extractorProvider: primaryExtractor.id,
        extractorModel: primaryExtractor.model,
        auditorProvider: primaryProviders.openai.id,
        auditorModel: primaryProviders.openai.model,
        rendererModel: primaryProviders.renderer.model
      }),
      maxAuditAttempts: 2
    });
    try {
      result = await runTieredTherapyPipeline({
        context,
        providers: primaryProviders,
        config: resolvedConfig,
        processingMode: "auto",
        onProgress: progress,
        caseRecovery: primaryCaseRecovery
      });
      acceptance = evaluateStructuredBenchmark(result, definition.acceptance);
    } catch (error) {
      primaryStageFailure = safeCaseStageFailure(error);
      primaryError = primaryStageFailure ?? errorShape(error);
      if (primaryStageFailure?.actionCode === "CLAUDE_REAUTH" || looksLikeClaudeAuthFailure(primaryError)) {
        await finalize({
          config: resolvedConfig,
          runDir,
          status: "ACTION_REQUIRED",
          stage: "A001-adversarial-therapy-benchmark",
          summary: "The Claude CLI OAuth session expired during the therapy benchmark. Escalation was skipped because all Claude tiers share the same authentication session.",
          nextAction: "Complete the browser sign-in opened by the wrapper. The wrapper will resume validation automatically.",
          doNotDo: ["Do not add API keys.", "Do not upload logs."],
          details: { actionCode: "CLAUDE_REAUTH", primaryError },
          exitCode: 2
        });
        throw new AutopilotTerminal();
      }
    }

    const initialFailureRoute = decideA001FailureRoute({
      failure: primaryStageFailure,
      result,
      acceptance,
      fableEnabled: resolvedConfig.autopilotEscalateToFable,
      primaryAnthropicModel: primaryProviders.anthropic.model
    });
    if (initialFailureRoute.kind === "TERMINAL_STAGE_FAILURE") {
      const terminal = buildA001StageTerminal(initialFailureRoute.failure, { checkpointAvailable: initialFailureRoute.failure.stage === "case_audit" });
      await writeJson(path.join(runDir, "A001-stage-failure.json"), terminal.details);
      await finalize({ config: resolvedConfig, runDir, ...terminal });
      throw new AutopilotTerminal();
    }

    let escalated = false;
    if (result && acceptance && !acceptance.ok && acceptance.plan.missing.length === 0
        && primaryProviders.renderer.model !== primaryProviders.anthropic.model) {
      progress({ stage: "A001-realization-Opus-fallback", status: "started", detail: "Sonnet realization missed the prose contract; reasoning stays frozen" });
      result = await rerenderA001({
        result,
        definition,
        config: resolvedConfig,
        provider: primaryProviders.anthropic,
        feedback: {
          responseAcceptance: acceptance.response,
          instruction: "Repair only the final prose. Do not redo the formulation or plan."
        },
        onProgress: progress
      });
      acceptance = evaluateStructuredBenchmark(result, definition.acceptance);
      progress({ stage: "A001-realization-Opus-fallback", status: acceptance.ok ? "completed" : "failed", detail: primaryProviders.anthropic.model });
    }

    if (result && acceptance && !acceptance.ok && acceptance.plan.missing.length === 0 && resolvedConfig.autopilotEscalateToFable && !/fable/i.test(primaryProviders.anthropic.model)) {
      const fable = await ensureFable();
      if (fable.ok) {
        escalated = true;
        progress({ stage: "A001-realization-Fable-escalation", status: "started", detail: "plan passed; re-rendering only" });
        result = await rerenderA001({
          result,
          definition,
          config: resolvedConfig,
          provider: fable.resolved.provider,
          feedback: {
            responseAcceptance: acceptance.response,
            instruction: "The reasoning plan already passed. Repair only the user-facing realization; preserve the user's live language, the discriminating age question, and repeated non-defensive follow-through."
          },
          onProgress: progress
        });
        acceptance = evaluateStructuredBenchmark(result, definition.acceptance);
        progress({ stage: "A001-realization-Fable-escalation", status: acceptance.ok ? "completed" : "failed", detail: fable.resolved.model });
      }
    }

    const fullEscalationRoute = decideA001FailureRoute({
      failure: primaryStageFailure,
      result,
      acceptance,
      fableEnabled: resolvedConfig.autopilotEscalateToFable,
      primaryAnthropicModel: primaryProviders.anthropic.model
    });
    if (fullEscalationRoute.kind === "FABLE_REASONING_ESCALATION") {
      const fable = await ensureFable();
      if (fable.ok) {
        escalated = true;
        progress({ stage: "A001-Fable-escalation", status: "started", detail: "reasoning/plan still failed; rerunning full pipeline" });
        fableCaseRecovery = createA001StageRecovery({
          stateDir: resolvedConfig.autopilotStateDir,
          lane: "fable",
          fingerprint: buildA001StageFingerprint({
            caseId: definition.id,
            acceptanceVersion: definition.acceptanceVersion ?? "legacy",
            pipelineRevision: A001_PIPELINE_REVISION,
            guideVersion,
            lane: "fable",
            extractorProvider: fable.resolved.provider.id,
            extractorModel: fable.resolved.model,
            auditorProvider: primaryProviders.openai.id,
            auditorModel: primaryProviders.openai.model,
            rendererModel: primaryProviders.renderer.model,
            primaryFailureClass: primaryStageFailure?.classification ?? "acceptance-failure"
          }),
          maxAuditAttempts: 2
        });
        try {
          result = await runFormulatedPipeline({
            context: {
              ...context,
              autopilotFeedback: {
                primaryError,
                primaryAcceptance: acceptance,
                instruction: "Resolve the reasoning or planning gaps without making categorical assignments unsupported by the transcript."
              }
            },
            providers: { openai: primaryProviders.openai, anthropic: fable.resolved.provider, renderer: primaryProviders.renderer },
            config: { ...resolvedConfig, anthropicModel: fable.resolved.model },
            caseId: `${definition.id}-fable`,
            onProgress: progress,
            caseRecovery: fableCaseRecovery
          });
          acceptance = evaluateStructuredBenchmark(result, definition.acceptance);
          progress({ stage: "A001-Fable-escalation", status: acceptance.ok ? "completed" : "failed", detail: fable.resolved.model });
        } catch (error) {
          const fableStageFailure = safeCaseStageFailure(error);
          if (fableStageFailure) {
            const terminal = buildA001StageTerminal(fableStageFailure, { checkpointAvailable: fableStageFailure.stage === "case_audit" });
            await writeJson(path.join(runDir, "A001-stage-failure.json"), terminal.details);
            await finalize({ config: resolvedConfig, runDir, ...terminal });
            throw new AutopilotTerminal();
          }
          primaryError = { primary: primaryError, fable: errorShape(error) };
          result = null;
          acceptance = null;
          progress({ stage: "A001-Fable-escalation", status: "failed", detail: error?.message ?? "unclassified Fable pipeline failure" });
        }
      }
    }

    a001Summary = {
      skipped: false,
      ok: Boolean(result && acceptance?.ok),
      escalated,
      acceptance,
      result,
      primaryError
    };
    await writeJson(path.join(runDir, "A001-autopilot-result.json"), a001Summary);
    if (!a001Summary.ok) {
      const diagnosis = config.autopilotDiagnoseFailures
        ? await diagnoseFailure({
            provider: primaryProviders.openai,
            stage: "A001-adversarial-therapy-benchmark",
            summary: "A001 did not preserve all required insights or retained a forbidden categorical overclaim after escalation.",
            evidence: a001Summary
          })
        : null;
      await finalize({
        config: resolvedConfig,
        runDir,
        status: "BLOCKED",
        stage: "A001-adversarial-therapy-benchmark",
        summary: diagnosis?.summary ?? "The adversarial therapy pipeline failed its first live difficult-case acceptance gate.",
        nextAction: diagnosis?.next_action ?? "The failure is preserved locally for the next runtime repair release.",
        doNotDo: diagnosis?.do_not_do ?? ["Do not weaken the benchmark to force a pass.", "Do not upload logs."],
        details: { acceptance, escalated, diagnosis },
        exitCode: 1
      });
      throw new AutopilotTerminal();
    }
    await primaryCaseRecovery.clearExtraction();
    await fableCaseRecovery?.clearExtraction();
    checkpointA001 = {
      ...a001Summary,
      acceptanceVersion: definition.acceptanceVersion ?? "legacy"
    };
    if (resolvedConfig.autopilotReuseCheckpoints) {
      await writeCheckpointCache({
        stateDir: resolvedConfig.autopilotStateDir,
        selectedModels: selectedModelsForResume,
        guideVersion,
        H001: checkpointH001,
        A001: checkpointA001
      });
    }
    progress({
      stage: "A001-adversarial-therapy-benchmark",
      status: "completed",
      detail: escalated
        ? "passed after Fable escalation"
        : `passed via ${result.processingTier ?? result.mode ?? "validated"} production path`
    });
  }

  if (a001Summary.reused && resolvedConfig.autopilotReuseCheckpoints) {
    checkpointA001 = {
      ...a001Summary,
      acceptanceVersion: a001Definition?.acceptanceVersion ?? "legacy"
    };
    await writeCheckpointCache({
      stateDir: resolvedConfig.autopilotStateDir,
      selectedModels: selectedModelsForResume,
      guideVersion,
      H001: checkpointH001,
      A001: checkpointA001
    });
  }

  let runtimeSmoke = { skipped: true };
  if (!skipRuntimeSmoke && resolvedConfig.autopilotRunRuntimeSmoke) {
    progress({ stage: "runtime-server-smoke", status: "started" });
    runtimeSmoke = await runRuntimeSmoke({ config: resolvedConfig, providers: primaryProviders });
    await writeJson(path.join(runDir, "runtime-smoke.json"), runtimeSmoke);
    if (!runtimeSmoke.ok) {
      await finalize({
        config: resolvedConfig,
        runDir,
        status: "BLOCKED",
        stage: "runtime-server-smoke",
        summary: "The headless pipelines passed, but the local HTTP runtime failed its health smoke test.",
        nextAction: "The package retained the failure locally for a corrected release.",
        doNotDo: ["Do not bypass the server smoke test.", "Do not upload logs."],
        details: runtimeSmoke,
        exitCode: 1
      });
      throw new AutopilotTerminal();
    }
    progress({ stage: "runtime-server-smoke", status: "completed", detail: "health endpoint passed" });
  }

  let webSmoke = { skipped: true };
  if (!skipWebSmoke && resolvedConfig.autopilotRunWebSmoke) {
    progress({ stage: "web-client-smoke", status: "started" });
    webSmoke = await runWebClientSmoke({ config: resolvedConfig, providers: primaryProviders });
    await writeJson(path.join(runDir, "web-client-smoke.json"), webSmoke);
    if (!webSmoke.ok) {
      await finalize({
        config: resolvedConfig,
        runDir,
        status: "BLOCKED",
        stage: "web-client-smoke",
        summary: "The reasoning kernel passed, but the local web client failed its deterministic serving or app-owned-route smoke checks.",
        nextAction: "The failure is preserved locally for a corrected release.",
        doNotDo: ["Do not bypass the app-owned gate or waking-return checks.", "Do not upload logs."],
        details: webSmoke,
        exitCode: 1
      });
      throw new AutopilotTerminal();
    }
    progress({ stage: "web-client-smoke", status: "completed", detail: "therapy, hypnosis, local data, and static assets passed" });
  }

  const roadmapState = await writeRoadmapState(resolvedConfig.autopilotStateDir, {
    selectedModels: {
      openai: selectedOpenAI || "CLI default",
      anthropicPrimary: selectedAnthropic || "CLI default",
      anthropicEscalation: escalationResolution?.resolved?.model ?? resolvedConfig.anthropicEscalationModel,
      anthropicRenderer: primaryProviders.renderer.model
    },
    guideGraph: { version: graphBundle.version, stats: graphBundle.stats, regressions: graphRegressions.count },
    caseFormulation: { version: "case-formulation-v1", planner: "case-plan-v1" },
    webClient: { available: webSmoke.ok === true, url: `http://127.0.0.1:${resolvedConfig.port}` }
  });
  progress({ stage: "roadmap-state", status: "completed", detail: "guide-graph reasoning milestone recorded" });

  await finalize({
    config: resolvedConfig,
    runDir,
    status: "PASS",
    stage: "complete",
    summary: `The source-pinned inner-child/somatic graph compiled, every branch case passed, Opus/Codex reasoning passed, ${primaryProviders.renderer.model} passed the separated response-realization gate, H001 passed, and the local runtime and web client passed.`,
    nextAction: externalLaunch ? `The wrapper will restart the already-visible local app with the validated model configuration at http://127.0.0.1:${resolvedConfig.port}.` : (noLaunch || !resolvedConfig.autopilotLaunchApp ? "Run ./run-autopilot.sh to revalidate and launch, or npm run serve:cli to start the app directly." : `The local app starts automatically now at http://127.0.0.1:${resolvedConfig.port}.`),
    details: {
      selectedModels: {
        openai: selectedOpenAI || "CLI default",
        anthropicPrimary: selectedAnthropic || "CLI default",
        anthropicEscalation: escalationResolution?.resolved?.model ?? resolvedConfig.anthropicEscalationModel,
        anthropicRenderer: primaryProviders.renderer.model
      },
      H001: h001Summary,
      A001: {
        skipped: a001Summary.skipped,
        ok: a001Summary.ok,
        escalated: a001Summary.escalated,
        decisionLedgerId: a001Summary.result?.decisionLedgerId
      },
      runtimeSmoke,
      webSmoke,
      graphBundle: { version: graphBundle.version, stats: graphBundle.stats },
      graphRegressions: { count: graphRegressions.count, ok: graphRegressions.ok },
      roadmapState
    },
    exitCode: 0
  });

  if (!noLaunch && !externalLaunch && resolvedConfig.autopilotLaunchApp) {
    await launchRuntimeForeground({ config: resolvedConfig, providers: primaryProviders, onProgress: progress });
  }
} catch (error) {
  if (error instanceof AutopilotTerminal) {
    // A terminal status was already written and printed.
  } else {
    const shape = errorShape(error);
    await writeJson(path.join(runDir, "uncaught-error.json"), shape);
    if (looksLikeClaudeAuthFailure(shape)) {
      await finalize({
        config,
        runDir,
        status: "ACTION_REQUIRED",
        stage: "claude-auth-recovery",
        summary: "A Claude CLI call failed because the local Claude authentication session expired or refresh failed.",
        nextAction: "Complete the browser sign-in opened by the wrapper. The interrupted workflow will resume automatically.",
        doNotDo: ["Do not add API keys.", "Do not upload logs.", "Do not restart the workflow manually."],
        details: { actionCode: "CLAUDE_REAUTH", error: shape },
        exitCode: 2
      });
    } else {
      await finalize({
        config,
        runDir,
        status: "BLOCKED",
        stage: "uncaught-error",
        summary: "The autopilot encountered an unexpected package-level error and stopped safely.",
        nextAction: "Keep the installation intact for a corrected runtime release. No log upload is required.",
        doNotDo: ["Do not bypass the failed stage.", "Do not add API credentials."],
        details: shape,
        exitCode: 1
      });
    }
  }
}
