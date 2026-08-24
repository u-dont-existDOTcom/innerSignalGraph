import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadBenchmarkCaseSet } from "./therapy-scaffold-cases.mjs";
import { EVALUATION_PROMPT_VERSION, pairwiseJudgeSchema, pairwisePrompt, traceJudgeSchema, tracePrompt } from "./therapy-scaffold-evaluation.mjs";
import {
  StageStore,
  TraceProvider,
  assertPrivateRoot,
  assertPrivateTextAbsentFromGit,
  atomicWriteJson,
  atomicWriteText,
  mapWithConcurrency,
  providerTraces,
  readJson,
  responseReceipt,
  runCommand,
  sha256,
  traceProviders
} from "./therapy-scaffold-lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = path.resolve(here, "../..");
export const analysisRoot = path.join(repositoryRoot, "analysis/therapy-scaffold-authority-repair");
export const BENCHMARK_VERSION = "therapy-scaffold-authority-repair-bakeoff-v1";
export const CONDITIONS = Object.freeze(["A", "C", "D"]);
export const REPLICATES = Object.freeze([1, 2, 3]);
export const CONTRASTS = Object.freeze([["A", "C"], ["A", "D"], ["C", "D"]]);

const entitlementSchema = { type: "object", additionalProperties: false, properties: { ok: { type: "boolean" } }, required: ["ok"] };

function moduleUrl(root, relative) { return pathToFileURL(path.join(root, relative)).href; }
async function loadModules(root) {
  const [config, factory, contextBuilder, pipeline, benchmark] = await Promise.all([
    import(moduleUrl(root, "src/core/config.mjs")),
    import(moduleUrl(root, "src/providers/factory.mjs")),
    import(moduleUrl(root, "src/orchestrator/context-builder.mjs")),
    import(moduleUrl(root, "src/orchestrator/run-tiered-pipeline.mjs")),
    import(moduleUrl(root, "src/autopilot/benchmark-acceptance.mjs"))
  ]);
  return { ...config, ...factory, ...contextBuilder, ...pipeline, ...benchmark };
}

function progress(prefix, event) {
  const detail = event.detail ? ` — ${event.detail}` : "";
  process.stdout.write(`[${new Date().toISOString()}] ${prefix} ${event.stage}: ${event.status}${detail}\n`);
}

function publicConfig(config) {
  return {
    mode: config.mode,
    openaiModel: config.openaiModel,
    anthropicModel: config.anthropicModel,
    responseRendererModel: config.responseRendererModel,
    therapyProcessingMode: config.therapyProcessingMode,
    therapyScaffoldMode: config.therapyScaffoldMode,
    codexReasoningEffort: config.codexReasoningEffort,
    claudeEffort: config.claudeEffort,
    cliIsolateConfig: config.cliIsolateConfig,
    ledgerMode: config.ledgerMode
  };
}

function baseConfig(modules, { runtimeRoot, privateRoot, scaffoldMode }) {
  return modules.loadConfig({
    mode: "cli",
    ledgerMode: "off",
    ledgerDir: path.join(privateRoot, "disabled-ledgers"),
    autopilotStateDir: path.join(privateRoot, "runtime-state"),
    guidePacketRoot: path.join(runtimeRoot, ".inner-signal-autopilot/guide-packets"),
    guidePath: path.join(runtimeRoot, "guides/inner-child-guide.txt"),
    somaticGuidePath: path.join(runtimeRoot, "guides/somatic-sequencing-guide.txt"),
    guideManifestPath: path.join(runtimeRoot, "guides/manifest.json"),
    guideGraphBundlePath: path.join(runtimeRoot, "guide-graphs/compiled/bundle.json"),
    cliWorkingDirectory: runtimeRoot,
    openaiModel: "gpt-5.6-sol",
    anthropicModel: "claude-opus-5",
    responseRendererModel: "claude-sonnet-4-6",
    therapyProcessingMode: "auto",
    therapyScaffoldMode: scaffoldMode,
    codexReasoningEffort: "high",
    claudeEffort: "high",
    requestTimeoutMs: 1_200_000
  });
}

function sourceFingerprint(context) {
  return sha256({ userMessage: context.userMessage, recentTranscript: context.recentTranscript, userFacts: context.userFacts, guideExcerpts: context.guideExcerpts });
}

async function frozenInputForCase({ caseDefinition, candidateModules, runtimeRoot, privateRoot }) {
  const config = baseConfig(candidateModules, { runtimeRoot, privateRoot, scaffoldMode: "current" });
  const context = await candidateModules.buildContext(caseDefinition.input, config);
  return { ...caseDefinition.input, guideExcerpts: context.guideExcerpts };
}

function modulesForCondition(condition, installedModules, candidateModules) {
  return condition === "A" ? installedModules : candidateModules;
}
function modeForCondition(condition) { return condition === "A" ? "current" : condition === "C" ? "advisory" : "model-first"; }

async function runCondition({ condition, caseDefinition, replicate, frozenInput, installedModules, candidateModules, runtimeRoot, privateRoot, providerCacheRoot }) {
  const modules = modulesForCondition(condition, installedModules, candidateModules);
  const scaffoldMode = modeForCondition(condition);
  const config = baseConfig(modules, { runtimeRoot, privateRoot, scaffoldMode });
  const context = await modules.buildContext(frozenInput, config);
  const providers = traceProviders(modules.createProviders(config), { cacheRoot: providerCacheRoot, lane: `primary-${caseDefinition.id}-r${replicate}-${condition}` });
  try {
    const result = await modules.runTieredTherapyPipeline({
      context,
      providers,
      config,
      processingMode: "auto",
      onProgress: (event) => progress(`${caseDefinition.id}/${condition}`, event)
    });
    return { condition, caseId: caseDefinition.id, sourceFingerprint: sourceFingerprint(context), context, result, providerTraces: providerTraces(providers), config: publicConfig(config) };
  } catch (error) {
    error.benchmarkProviderTraces = providerTraces(providers);
    throw error;
  }
}

async function runTrajectoryBranch({ condition, replicate, baseOutput, branch, originalMessage, guideExcerpts, installedModules, candidateModules, runtimeRoot, privateRoot, providerCacheRoot }) {
  const modules = modulesForCondition(condition, installedModules, candidateModules);
  const config = baseConfig(modules, { runtimeRoot, privateRoot, scaffoldMode: modeForCondition(condition) });
  const input = {
    userMessage: branch.followUp,
    recentTranscript: `User: ${originalMessage}\n\nAssistant: ${baseOutput.result.answer}`,
    userFacts: [],
    guideExcerpts,
    priorCaseSnapshot: baseOutput.result.caseFormulation,
    priorInterventionContract: baseOutput.result.interventionContract,
    priorProcessingTier: baseOutput.result.processingTier
  };
  const context = await modules.buildContext(input, config);
  const providers = traceProviders(modules.createProviders(config), { cacheRoot: providerCacheRoot, lane: `trajectory-${branch.id}-r${replicate}-${condition}` });
  const result = await modules.runTieredTherapyPipeline({ context, providers, config, processingMode: "auto", onProgress: (event) => progress(`${branch.id}/${condition}`, event) });
  return { condition, trajectoryId: branch.id, sourceUserTurnFingerprint: sha256({ originalMessage, followUp: branch.followUp, guideExcerpts }), context, result, providerTraces: providerTraces(providers), config: publicConfig(config) };
}

async function structuredJudgeCall(provider, prompt, schema, stage) {
  const started = Date.now();
  const raw = await provider.generate({ ...prompt, outputSchema: schema, metadata: { stage } });
  let value;
  try { value = JSON.parse(raw.text); } catch (error) { throw new Error(`${stage} returned invalid JSON: ${error.message}`); }
  return { value, raw, durationMs: Date.now() - started };
}

async function liveProbe(provider, requestedModel) {
  const generated = await structuredJudgeCall(provider, { system: "This is an exact-model structured-output probe. Return only the requested schema.", user: 'Return {"ok":true}.' }, entitlementSchema, "therapy_scaffold_exact_model_probe");
  if (generated.value.ok !== true) throw new Error(`${requestedModel} failed its live exact-model probe.`);
  return { requestedModel, returnedModel: generated.raw.model ?? null, responseId: generated.raw.responseId ?? generated.raw.requestId ?? null, usage: generated.raw.usage ?? null, transport: generated.raw.transport ?? null };
}

export function aggregatePairwise(records) {
  const result = {};
  for (const record of records) {
    const keys = ["overall", `family:${record.family}`, `judge:${record.judge}`, `contrast:${record.contrast}`, `family-contrast:${record.family}:${record.contrast}`];
    for (const key of keys) {
      const row = result[key] ??= { presentations: 0, wins: {}, ties: 0, orderConsistentPairs: 0, orderDisagreements: 0 };
      row.presentations += 1;
      if (record.winnerCondition === "tie") row.ties += 1;
      else row.wins[record.winnerCondition] = (row.wins[record.winnerCondition] ?? 0) + 1;
    }
  }
  for (const [key, row] of Object.entries(result)) {
    const relevant = key === "overall" ? records
      : key.startsWith("family-contrast:") ? records.filter((record) => `${record.family}:${record.contrast}` === key.slice("family-contrast:".length))
      : key.startsWith("family:") ? records.filter((record) => record.family === key.slice("family:".length))
      : key.startsWith("judge:") ? records.filter((record) => record.judge === key.slice("judge:".length))
      : records.filter((record) => record.contrast === key.slice("contrast:".length));
    const pairs = new Map();
    for (const record of relevant) {
      const id = `${record.family}:${record.caseId}:${record.replicate}:${record.judge}:${record.contrast}`;
      const values = pairs.get(id) ?? [];
      values.push(record.winnerCondition);
      pairs.set(id, values);
    }
    for (const values of pairs.values()) {
      if (values.length === 2 && values[0] === values[1]) row.orderConsistentPairs += 1;
      else if (values.length === 2) row.orderDisagreements += 1;
    }
  }
  return result;
}

function summarizeHardFailures(records) {
  const summary = {};
  for (const condition of CONDITIONS) summary[condition] = { presentations: 0, presentationsWithHardFailure: 0, totalHardFailures: 0, winsWhileHardFailed: 0 };
  for (const record of records) {
    for (const condition of record.conditions) {
      const row = summary[condition];
      const count = record.hardFailureCounts[condition] ?? 0;
      row.presentations += 1;
      if (count) row.presentationsWithHardFailure += 1;
      row.totalHardFailures += count;
      if (count && record.winnerCondition === condition) row.winsWhileHardFailed += 1;
    }
  }
  return summary;
}

function latencySummary(receipts) {
  const result = {};
  for (const condition of CONDITIONS) {
    const items = receipts.filter((item) => item.condition === condition);
    const totals = items.map((item) => item.totalMs).filter(Number.isFinite).sort((a, b) => a - b);
    const observedWalls = items.map((item) => item.observedWallClockMs).filter(Number.isFinite);
    const calls = items.reduce((sum, item) => sum + item.calls, 0);
    const stageCells = {};
    const usageTotals = {};
    for (const call of items.flatMap((item) => item.receipt.calls)) {
      const key = `${call.stage ?? "unknown"}:${call.model ?? "unknown"}`;
      const cell = stageCells[key] ??= { stage: call.stage ?? "unknown", model: call.model ?? "unknown", calls: 0, durationsMs: [] };
      cell.calls += 1;
      if (Number.isFinite(call.durationMs)) cell.durationsMs.push(call.durationMs);
      for (const [usageKey, usageValue] of Object.entries(call.usage ?? {})) {
        if (typeof usageValue === "number" && Number.isFinite(usageValue)) usageTotals[usageKey] = (usageTotals[usageKey] ?? 0) + usageValue;
      }
    }
    result[condition] = {
      responses: items.length,
      modelCalls: calls,
      callsPerResponse: items.length ? calls / items.length : null,
      medianTotalMs: totals.length ? totals[Math.floor(totals.length / 2)] : null,
      meanTotalMs: totals.length ? Math.round(totals.reduce((sum, value) => sum + value, 0) / totals.length) : null,
      meanObservedWallClockMs: observedWalls.length ? Math.round(observedWalls.reduce((sum, value) => sum + value, 0) / observedWalls.length) : null,
      resumedProviderStages: items.reduce((sum, item) => sum + item.resumedProviderStages, 0),
      retries: items.reduce((sum, item) => sum + item.retries, 0),
      structuredOutputFailures: 0,
      usageTotals,
      stages: Object.values(stageCells).map(({ durationsMs, ...cell }) => ({ ...cell, meanMs: durationsMs.length ? Math.round(durationsMs.reduce((sum, value) => sum + value, 0) / durationsMs.length) : null, medianMs: durationsMs.length ? [...durationsMs].sort((a, b) => a - b)[Math.floor(durationsMs.length / 2)] : null })).sort((left, right) => `${left.stage}:${left.model}`.localeCompare(`${right.stage}:${right.model}`))
    };
  }
  return result;
}

function meanDiagnostics(records) {
  const sums = {};
  for (const condition of CONDITIONS) sums[condition] = {};
  for (const record of records) {
    for (const condition of record.conditions) {
      const scores = record.scores[condition];
      for (const [dimension, value] of Object.entries(scores ?? {})) {
        const cell = sums[condition][dimension] ??= { total: 0, count: 0 };
        cell.total += value;
        cell.count += 1;
      }
    }
  }
  return Object.fromEntries(Object.entries(sums).map(([condition, dimensions]) => [condition, Object.fromEntries(Object.entries(dimensions).map(([dimension, cell]) => [dimension, Number((cell.total / cell.count).toFixed(3))]))]));
}

function stablePairWins(records, family, contrast) {
  const grouped = new Map();
  for (const record of records.filter((item) => item.family === family && item.contrast === contrast)) {
    const key = `${record.caseId}:${record.replicate}:${record.judge}`;
    const values = grouped.get(key) ?? [];
    values.push(record.winnerCondition);
    grouped.set(key, values);
  }
  const wins = {};
  for (const values of grouped.values()) {
    if (values.length !== 2 || values[0] !== values[1]) continue;
    wins[values[0]] = (wins[values[0]] ?? 0) + 1;
  }
  return wins;
}

export function selectArchitecture({ records, hardFailures, latency, diagnostics, families }) {
  const comparison = { byFamily: {}, controlLiftFamilies: { C: 0, D: 0 }, cVersusD: { C: 0, D: 0, tie: 0 } };
  for (const family of families) {
    const ac = stablePairWins(records, family, "A-C");
    const ad = stablePairWins(records, family, "A-D");
    const cd = stablePairWins(records, family, "C-D");
    comparison.byFamily[family] = { "A-C": ac, "A-D": ad, "C-D": cd };
    if ((ac.C ?? 0) > (ac.A ?? 0)) comparison.controlLiftFamilies.C += 1;
    if ((ad.D ?? 0) > (ad.A ?? 0)) comparison.controlLiftFamilies.D += 1;
    if ((cd.D ?? 0) > (cd.C ?? 0)) comparison.cVersusD.D += 1;
    else if ((cd.C ?? 0) > (cd.D ?? 0)) comparison.cVersusD.C += 1;
    else comparison.cVersusD.tie += 1;
  }
  const cGeneralizes = comparison.controlLiftFamilies.C >= 2;
  const dGeneralizes = comparison.controlLiftFamilies.D >= 2;
  const dIncrementalAcrossFamilies = comparison.cVersusD.D >= 2 && comparison.cVersusD.D > comparison.cVersusD.C;
  const dHardFailureRegression = hardFailures.D.presentationsWithHardFailure > hardFailures.C.presentationsWithHardFailure;
  const dUnsupportedRegression = (diagnostics.D.unsupported_inference ?? 0) > (diagnostics.C.unsupported_inference ?? 0) + 0.25;
  const latencyRatio = latency.C.meanTotalMs ? latency.D.meanTotalMs / latency.C.meanTotalMs : null;
  const callRatio = latency.C.callsPerResponse ? latency.D.callsPerResponse / latency.C.callsPerResponse : null;
  const dResourceRegression = (latencyRatio ?? Infinity) > 1.75 || (callRatio ?? Infinity) > 2;
  const dEligible = dGeneralizes && dIncrementalAcrossFamilies && !dHardFailureRegression && !dUnsupportedRegression && !dResourceRegression;
  let selected = "no-change";
  let reason = "Neither candidate demonstrated robust improvement over current behavior across at least two case families.";
  if (dEligible) {
    selected = "model-first";
    reason = "D showed material incremental advantage over C across multiple families without the predefined hard-failure, unsupported-inference, latency, or call-budget regressions.";
  } else if (cGeneralizes) {
    selected = "advisory";
    reason = "The advisory repair generalized beyond control, and D did not clear the higher complexity threshold; ties and uncertainty resolve to C."
  }
  return {
    selected,
    reason,
    presumptiveCandidate: "advisory",
    thresholds: { controlLiftFamiliesRequired: 2, modelFirstIncrementalFamiliesRequired: 2, maxUnsupportedInferenceIncrease: 0.25, maxLatencyRatio: 1.75, maxCallRatio: 2 },
    comparison,
    checks: { cGeneralizes, dGeneralizes, dIncrementalAcrossFamilies, dHardFailureRegression, dUnsupportedRegression, dResourceRegression, latencyRatio, callRatio, dEligible }
  };
}

function answerBundle(items) {
  return items.map((item) => `FOLLOW-UP ${item.trajectoryId}:\n${item.result.answer}`).join("\n\n");
}

function publicProbe(value) {
  return { requestedModel: value.requestedModel, returnedModel: value.returnedModel, responseId: value.responseId, usage: value.usage, transport: value.transport };
}

function publicPairwiseRecord(record) {
  return {
    family: record.family,
    caseId: record.caseId,
    replicate: record.replicate,
    contrast: record.contrast,
    judge: record.judge,
    order: record.orderName,
    winnerCondition: record.winnerCondition,
    rawWinnerCondition: record.rawWinnerCondition,
    hardFailureCounts: record.hardFailureCounts,
    judgmentSha256: sha256(record.raw)
  };
}

function modelCallReceipt(output, condition, caseId, replicate) {
  const receipt = responseReceipt(output);
  const calls = receipt.calls.length;
  const durations = receipt.calls.map((call) => ({ stage: call.stage, durationMs: Number.isFinite(call.durationMs) ? call.durationMs : 0 }));
  const modelStageEstimateMs = durations.reduce((sum, call) => sum + call.durationMs, 0);
  return {
    condition,
    caseId,
    replicate,
    totalMs: modelStageEstimateMs || output.result?.performance?.totalMs || output.result?.processingMs || null,
    observedWallClockMs: output.result?.performance?.totalMs ?? output.result?.processingMs ?? null,
    resumedProviderStages: receipt.calls.filter((call) => call.status === "reused").length,
    calls,
    retries: receipt.calls.filter((call) => call.stage === "realization_retry").length,
    receipt
  };
}

async function capabilitySnapshot(runtimeRoot) {
  const commands = {};
  for (const [id, command, args] of [["codexVersion", "codex", ["--version"]], ["codexHelp", "codex", ["exec", "--help"]], ["claudeVersion", "claude", ["--version"]], ["claudeHelp", "claude", ["--help"]]]) {
    const run = await runCommand(command, args, { cwd: runtimeRoot });
    commands[id] = { exitCode: run.code, durationMs: run.durationMs, stdoutSha256: sha256(run.stdout), stderrSha256: sha256(run.stderr), firstLine: run.stdout.trim().split(/\r?\n/)[0] || run.stderr.trim().split(/\r?\n/)[0] || "" };
  }
  return commands;
}

function traceStages(output) {
  const calls = Object.values(output.providerTraces ?? {}).flat();
  const responseText = (stage) => calls.find((call) => call.request?.metadata?.stage === stage)?.response?.text ?? "(stage not present)";
  const stages = [];
  if (output.condition === "D") stages.push({ name: "raw_semantic_formulation", content: responseText("semantic_formulation") });
  stages.push(
    { name: "raw_case_extraction", content: responseText("case_extraction") },
    { name: "case_audit_delta", content: responseText("case_audit") },
    { name: "audited_case_formulation", content: JSON.stringify(output.result.caseFormulation) },
    { name: "deterministic_plan", content: JSON.stringify(output.result.interventionContract) }
  );
  if (output.condition === "D") stages.push({ name: "graph_audit", content: responseText("graph_audit") });
  const finalStage = output.condition === "D" && !output.result.scaffoldTrace?.finalIntegrationTrace?.deterministicSafetyGateActive ? "model_first_integration" : "realization";
  stages.push({ name: "final_realization", content: responseText(finalStage) }, { name: "user_visible_response", content: output.result.answer });
  return stages;
}

function deterministicPermutation(values, seed) {
  return [...values].sort((left, right) => sha256(`${seed}:${left}`).localeCompare(sha256(`${seed}:${right}`)));
}

function normalizeWinner(winner, leftCondition, rightCondition) {
  if (winner === "left") return leftCondition;
  if (winner === "right") return rightCondition;
  return "tie";
}

function applyHardFailureGate(rawWinner, leftCondition, rightCondition, leftFailures, rightFailures) {
  const counts = { [leftCondition]: leftFailures.length, [rightCondition]: rightFailures.length };
  if (rawWinner === "tie") return "tie";
  const other = rawWinner === leftCondition ? rightCondition : leftCondition;
  if (counts[rawWinner] === 0) return rawWinner;
  return counts[other] === 0 ? other : "tie";
}

async function exactRef(root, ref = "HEAD") {
  const result = await runCommand("git", ["rev-parse", ref], { cwd: root });
  if (result.code !== 0) throw new Error(`Could not resolve ${ref} in ${root}: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

async function environmentSnapshot({ runtimeRoot, experimentSha }) {
  const markerPath = path.join(runtimeRoot, ".inner-signal-autopilot/git-install.json");
  let installedMarker = null;
  try { installedMarker = await readJson(markerPath); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const packageDocument = await readJson(path.join(runtimeRoot, "package.json"));
  return {
    capturedAt: new Date().toISOString(),
    candidateHead: await exactRef(repositoryRoot),
    candidateTree: await exactRef(repositoryRoot, "HEAD^{tree}"),
    sourceOriginMain: await exactRef(repositoryRoot, "origin/main"),
    protectedOriginStable: await exactRef(repositoryRoot, "origin/stable"),
    installedHead: installedMarker?.commit ?? null,
    installedPackageVersion: packageDocument.version,
    installedMarker,
    referenceExperimentSha: experimentSha,
    nodeVersion: process.version,
    platform: `${process.platform}-${process.arch}`,
    capabilities: await capabilitySnapshot(runtimeRoot)
  };
}

function publicEnvironment(snapshot) {
  return {
    ...snapshot,
    installedMarker: snapshot.installedMarker ? {
      packageVersion: snapshot.installedMarker.packageVersion ?? snapshot.installedMarker.version ?? null,
      commit: snapshot.installedMarker.commit ?? snapshot.installedMarker.gitCommit ?? snapshot.installedMarker.sourceCommit ?? null,
      stableCommit: snapshot.installedMarker.stableCommit ?? null,
      guidePacketVersion: snapshot.installedMarker.guidePacketVersion ?? null,
      graphBundleVersion: snapshot.installedMarker.graphBundleVersion ?? null
    } : null
  };
}

async function createJudgeProvider(candidateModules, config, judge) {
  const providers = candidateModules.createProviders(config);
  return judge === "gpt-5.6-sol" ? providers.openai : providers.anthropic;
}

async function runPairwiseJudgment({ store, candidateModules, judgeConfig, judge, family, caseId, replicate, contrast, orderName, caseText, casePurpose, hardFailureFocus, leftCondition, rightCondition, leftResponse, rightResponse, trajectory = false }) {
  const blindSeed = `${BENCHMARK_VERSION}:${family}:${caseId}:${replicate}:${contrast}:${judge}:${orderName}`;
  const labels = deterministicPermutation(["Response Lumen", "Response Vale"], blindSeed);
  const prompt = pairwisePrompt({ caseText, casePurpose, hardFailureFocus, leftLabel: labels[0], leftResponse, rightLabel: labels[1], rightResponse, trajectory });
  const stageId = `judge-${family}-${caseId}-r${replicate}-${contrast}-${judge}-${orderName}`;
  const stage = await store.run(stageId, { evaluationVersion: EVALUATION_PROMPT_VERSION, judge, family, caseId, replicate, contrast, orderName, responseHashes: [sha256(leftResponse), sha256(rightResponse)], promptHash: sha256(prompt) }, async () => {
    const provider = await createJudgeProvider(candidateModules, judgeConfig, judge);
    return await structuredJudgeCall(provider, prompt, pairwiseJudgeSchema, "therapy_scaffold_blind_pairwise_judgment");
  });
  const value = stage.value.value;
  const rawWinnerCondition = normalizeWinner(value.winner, leftCondition, rightCondition);
  const leftFailures = value.left_hard_failures ?? [];
  const rightFailures = value.right_hard_failures ?? [];
  const winnerCondition = applyHardFailureGate(rawWinnerCondition, leftCondition, rightCondition, leftFailures, rightFailures);
  return {
    family, caseId, replicate, contrast, judge, orderName,
    conditions: [leftCondition, rightCondition],
    winnerCondition, rawWinnerCondition,
    hardFailureCounts: { [leftCondition]: leftFailures.length, [rightCondition]: rightFailures.length },
    scores: { [leftCondition]: value.left_scores, [rightCondition]: value.right_scores },
    raw: stage.value,
    reused: stage.reused
  };
}

function traceAggregate(records) {
  const cells = {};
  for (const record of records) {
    for (const finding of record.findings) {
      const condition = record.labelMap[finding.condition_label];
      if (!condition) continue;
      const key = `${condition}:${finding.stage}`;
      const row = cells[key] ??= { condition, stage: finding.stage, absent: 0, partial: 0, present: 0, not_applicable: 0, independentlyReconstructed: 0, observations: 0 };
      row[finding.status] += 1;
      if (finding.independently_reconstructed) row.independentlyReconstructed += 1;
      row.observations += 1;
    }
  }
  return Object.values(cells).sort((left, right) => `${left.condition}:${left.stage}`.localeCompare(`${right.condition}:${right.stage}`));
}

async function runTraceJudgment({ store, candidateModules, judgeConfig, judge, replicate, originalMessage, outputs }) {
  const order = deterministicPermutation(CONDITIONS, `${BENCHMARK_VERSION}:trace:${judge}:${replicate}`);
  const labelMap = {};
  const anonymizedConditions = order.map((condition, index) => {
    const label = `Path ${index + 1}`;
    labelMap[label] = condition;
    return { label, stages: traceStages(outputs[condition]) };
  });
  const prompt = tracePrompt({ originalMessage, anonymizedConditions });
  const stage = await store.run(`trace-r${replicate}-${judge}`, { evaluationVersion: EVALUATION_PROMPT_VERSION, judge, replicate, labelMapHash: sha256(labelMap), stageHashes: anonymizedConditions.map((item) => sha256(item)), promptHash: sha256(prompt) }, async () => {
    const provider = await createJudgeProvider(candidateModules, judgeConfig, judge);
    return await structuredJudgeCall(provider, prompt, traceJudgeSchema, "therapy_scaffold_information_flow_audit");
  });
  return { replicate, judge, labelMap, findings: stage.value.value.findings, raw: stage.value, reused: stage.reused };
}

function legacyContractSummary(items) {
  return items.map(({ condition, replicate, evaluation }) => ({
    condition,
    replicate,
    ok: evaluation.ok,
    responseMissing: evaluation.response?.missing ?? [],
    responseForbidden: evaluation.response?.forbidden ?? [],
    planMissing: evaluation.plan?.missing ?? []
  }));
}

function paritySummary(primaryOutputs) {
  const rows = [];
  for (const caseId of [...new Set(primaryOutputs.map((item) => item.caseId))]) {
    for (const replicate of REPLICATES) {
      const items = primaryOutputs.filter((item) => item.caseId === caseId && item.replicate === replicate);
      const sourceHashes = [...new Set(items.map((item) => item.output.sourceFingerprint))];
      const questionHashes = [...new Set(items.map((item) => sha256(item.output.result.next_question ?? "")))];
      const rendererModels = Object.fromEntries(items.map((item) => [item.condition, item.output.config.responseRendererModel]));
      const canonicalQuestionPolicyPreserved = items.every((item) => (item.output.result.next_question ?? "") === (item.output.result.interventionContract?.nextQuestion ?? ""));
      const rendererQuestionProposals = Object.fromEntries(items.map((item) => {
        const contract = item.output.result.responseContract ?? {};
        return [item.condition, {
          matchedCanonical: contract.rendererQuestionMatched ?? null,
          proposalSha256: sha256(contract.rendererQuestion ?? ""),
          canonicalSha256: sha256(contract.canonicalQuestion ?? item.output.result.next_question ?? ""),
          routeReasonSha256: sha256(item.output.result.routingReason ?? ""),
          handling: contract.rendererQuestionMatched === false ? "Renderer proposed a different question; runtime retained the deterministic plan question to keep canonical-question authority unchanged." : "Renderer proposal matched the deterministic plan question."
        }];
      }));
      rows.push({ caseId, replicate, identicalSourceAndGuideInput: sourceHashes.length === 1, canonicalQuestionPolicyPreserved, identicalCanonicalQuestionAcrossStochasticConditions: questionHashes.length === 1, sourceFingerprint: sourceHashes[0] ?? null, canonicalQuestionHashes: questionHashes, rendererModels, rendererQuestionProposals });
    }
  }
  return rows;
}

function markdownReport({ environment, probes, caseInventory, aggregate, diagnostics, hardFailures, latency, selection, legacyContract, parity, traces, outputPaths }) {
  const familyRows = Object.entries(aggregate).filter(([key]) => key.startsWith("family-contrast:"));
  const table = familyRows.map(([key, row]) => `| ${key.slice("family-contrast:".length)} | ${row.wins.A ?? 0} | ${row.wins.C ?? 0} | ${row.wins.D ?? 0} | ${row.ties} | ${row.orderDisagreements} |`).join("\n");
  return `# Therapy scaffold authority repair — controlled bakeoff\n\n` +
    `Generated: ${new Date().toISOString()}\n\n` +
    `## Evidence boundary\n\nThe benchmark contains one observed owner-authored therapy family, ten owner-authored counterfactual engineering trajectories, and explicitly synthetic stress cases. It is an engineering quality comparison, not clinical validation or outcome evidence. Raw private transcripts and model outputs remain outside Git.\n\n` +
    `## Exact environment\n\n- Source origin/main: \`${environment.sourceOriginMain}\`\n- Protected origin/stable: \`${environment.protectedOriginStable}\`\n- Installed runtime: \`${environment.installedHead}\` (${environment.installedPackageVersion})\n- Candidate evidence SHA: \`${environment.candidateHead}\`\n- Reference ablation: \`${environment.referenceExperimentSha}\`\n- Models: renderer \`${probes.renderer.requestedModel}\`, Anthropic judge \`${probes.anthropic.requestedModel}\`, Codex judge \`${probes.openai.requestedModel}\`\n- Codex transport: unchanged current CLI stdin transport; native developer-instruction parity is outside this comparison.\n\n` +
    `## Blinded pairwise results\n\nPrimary result is pairwise preference. Diagnostic scores, legacy contracts, and hard failures remain separate.\n\n| Family and contrast | A wins | C wins | D wins | Ties | Order disagreements |\n|---|---:|---:|---:|---:|---:|\n${table}\n\n` +
    `Overall aggregate: \`${JSON.stringify(aggregate.overall)}\`\n\nJudge aggregates: \`${JSON.stringify(Object.fromEntries(Object.entries(aggregate).filter(([key]) => key.startsWith("judge:"))))}\`\n\n` +
    `## Safety and diagnostics\n\n- Hard failures: \`${JSON.stringify(hardFailures)}\`\n- Diagnostic means (not a master score): \`${JSON.stringify(diagnostics)}\`\n- Legacy A001 contract (unchanged, secondary): ${legacyContract.filter((item) => item.ok).length}/${legacyContract.length} pass.\n- Input/guide parity: ${parity.every((item) => item.identicalSourceAndGuideInput) ? "PASS" : "FAIL"}.\n- Canonical-question policy: ${parity.every((item) => item.canonicalQuestionPolicyPreserved) ? "PASS" : "FAIL"}; cross-condition stochastic question identity is reported separately and is not a policy change.\n\n` +
    `## Information flow\n\nSanitized stage-status aggregate: \`${JSON.stringify(traces)}\`. This identifies where the A001 relational mechanism weakened or was independently recovered without committing raw trace content.\n\n` +
    `## Latency and call budget\n\n\`${JSON.stringify(latency)}\`\n\n` +
    `## Decision\n\nSelected architecture: **${selection.selected}**. ${selection.reason}\n\nThe decision rule presumed C because it is the smaller repair and required D to show incremental cross-family value without hard-failure, unsupported-inference, latency, or call-budget regressions.\n\n` +
    `## Evidence paths\n\n- Sanitized aggregate: \`${outputPaths.aggregate}\`\n- Case inventory: \`${outputPaths.inventory}\`\n- Private evidence root: \`${outputPaths.privateRoot}\` (outside Git, mode 0700)\n\n` +
    `## Stop boundary\n\nNo merge, protected-ref movement, runtime installation, Guide Packet activation, hypnosis change, safety-routing change, or production promotion was performed.\n`;
}

async function implementationFingerprint() {
  const files = [
    "src/core/config.mjs",
    "src/case-formulation/run.mjs",
    "src/orchestrator/model-first-scaffold.mjs",
    "src/orchestrator/response-contract.mjs",
    "src/orchestrator/run-formulated-pipeline.mjs",
    "src/orchestrator/run-pipeline.mjs",
    "src/orchestrator/run-tiered-pipeline.mjs",
    "src/orchestrator/scaffold-authority.mjs",
    "src/prompts/realize.mjs",
    "src/prompts/semantic-formulation.mjs",
    "scripts/experiments/therapy-scaffold-benchmark.mjs",
    "scripts/experiments/therapy-scaffold-cases.mjs",
    "scripts/experiments/therapy-scaffold-evaluation.mjs",
    "scripts/experiments/therapy-scaffold-lib.mjs"
  ];
  const hashes = {};
  for (const relative of files) hashes[relative] = sha256(await fs.readFile(path.join(repositoryRoot, relative)));
  return { sha256: sha256(hashes), files: hashes };
}

function outputLookup(primaryOutputs) {
  return new Map(primaryOutputs.map((item) => [`${item.caseId}:${item.replicate}:${item.condition}`, item.output]));
}

function trajectoryLookup(trajectoryOutputs) {
  return new Map(trajectoryOutputs.map((item) => [`${item.trajectoryId}:${item.replicate}:${item.condition}`, item.output]));
}

function orderedContrast(left, right, orderName) {
  return orderName === "forward" ? [left, right] : [right, left];
}

export async function runTherapyScaffoldBenchmark({ runtimeRoot, privateRoot, experimentSha = "92377a2461ebd44a28d1a6a44d0348ef849d5d20", concurrency = 2 } = {}) {
  if (!runtimeRoot) throw new Error("runtimeRoot is required.");
  const resolvedRuntimeRoot = path.resolve(runtimeRoot);
  const resolvedPrivateRoot = assertPrivateRoot(repositoryRoot, privateRoot);
  const [candidateModules, installedModules, cases, environment, implementation] = await Promise.all([
    loadModules(repositoryRoot),
    loadModules(resolvedRuntimeRoot),
    loadBenchmarkCaseSet({ repositoryRoot, runtimeRoot: resolvedRuntimeRoot }),
    environmentSnapshot({ runtimeRoot: resolvedRuntimeRoot, experimentSha }),
    implementationFingerprint()
  ]);
  const guideBundle = await readJson(path.join(resolvedRuntimeRoot, "guide-graphs/compiled/bundle.json"));
  const privacyPreflight = await assertPrivateTextAbsentFromGit(repositoryRoot, [cases.private.originalMessage]);
  const stableCaseInventory = { ...cases.public, inventoryCapturedAt: null };
  const runIdentityInput = {
    benchmarkVersion: BENCHMARK_VERSION,
    implementation: implementation.sha256,
    sourceOriginMain: environment.sourceOriginMain,
    protectedOriginStable: environment.protectedOriginStable,
    installedHead: environment.installedHead,
    experimentSha,
    graphBundleSha256: sha256(guideBundle),
    caseInventorySha256: sha256(stableCaseInventory),
    conditions: CONDITIONS,
    replicates: REPLICATES,
    models: { openai: "gpt-5.6-sol", anthropic: "claude-opus-5", renderer: "claude-sonnet-4-6" }
  };
  const runIdentity = sha256(runIdentityInput);
  const privateRunRoot = path.join(resolvedPrivateRoot, `run-${runIdentity.slice(0, 16)}`);
  const store = new StageStore(privateRunRoot, runIdentity);
  await store.initialize();
  await atomicWriteJson(path.join(privateRunRoot, "run-identity.json"), { runIdentity, runIdentityInput, implementation, environment });

  const judgeConfig = baseConfig(candidateModules, { runtimeRoot: resolvedRuntimeRoot, privateRoot: resolvedPrivateRoot, scaffoldMode: "current" });
  const probeSpecs = [
    ["renderer", "claude-sonnet-4-6"],
    ["anthropic", "claude-opus-5"],
    ["openai", "gpt-5.6-sol"]
  ];
  const probes = {};
  for (const [providerKey, requestedModel] of probeSpecs) {
    const stage = await store.run(`probe-${providerKey}`, { requestedModel, config: publicConfig(judgeConfig) }, async () => {
      const provider = candidateModules.createProviders(judgeConfig)[providerKey];
      return await liveProbe(provider, requestedModel);
    });
    probes[providerKey] = stage.value;
  }

  const frozenInputs = {};
  for (const caseDefinition of cases.private.primaryCases) {
    const stage = await store.run(`frozen-input-${caseDefinition.id}`, { caseId: caseDefinition.id, inputHash: sha256(caseDefinition.input), graphBundleSha256: runIdentityInput.graphBundleSha256 }, async () => await frozenInputForCase({ caseDefinition, candidateModules, runtimeRoot: resolvedRuntimeRoot, privateRoot: resolvedPrivateRoot }));
    frozenInputs[caseDefinition.id] = stage.value;
  }

  const producerTasks = cases.private.primaryCases.flatMap((caseDefinition) => REPLICATES.flatMap((replicate) => CONDITIONS.map((condition) => ({ caseDefinition, replicate, condition }))));
  const primaryOutputs = await mapWithConcurrency(producerTasks, concurrency, async ({ caseDefinition, replicate, condition }) => {
    const frozenInput = frozenInputs[caseDefinition.id];
    const stage = await store.run(`produce-${caseDefinition.id}-r${replicate}-${condition}`, { condition, mode: modeForCondition(condition), caseId: caseDefinition.id, replicate, frozenInputHash: sha256(frozenInput), config: publicConfig(baseConfig(modulesForCondition(condition, installedModules, candidateModules), { runtimeRoot: resolvedRuntimeRoot, privateRoot: resolvedPrivateRoot, scaffoldMode: modeForCondition(condition) })) }, async () => await runCondition({ condition, caseDefinition, replicate, frozenInput, installedModules, candidateModules, runtimeRoot: resolvedRuntimeRoot, privateRoot: resolvedPrivateRoot, providerCacheRoot: path.join(privateRunRoot, "provider-cache") }));
    return { caseId: caseDefinition.id, family: caseDefinition.family, replicate, condition, output: stage.value, reused: stage.reused };
  });
  const primaryByKey = outputLookup(primaryOutputs);

  const a001Case = cases.private.primaryCases.find((item) => item.id === "A001-observed-original");
  const trajectoryTasks = cases.private.trajectoryCases.flatMap((branch) => REPLICATES.flatMap((replicate) => CONDITIONS.map((condition) => ({ branch, replicate, condition }))));
  const trajectoryOutputs = await mapWithConcurrency(trajectoryTasks, concurrency, async ({ branch, replicate, condition }) => {
    const baseOutput = primaryByKey.get(`${a001Case.id}:${replicate}:${condition}`);
    const stage = await store.run(`trajectory-${branch.id}-r${replicate}-${condition}`, { condition, branchId: branch.id, replicate, baseAnswerSha256: sha256(baseOutput.result.answer), followUpSha256: sha256(branch.followUp), guideExcerptsSha256: sha256(frozenInputs[a001Case.id].guideExcerpts) }, async () => await runTrajectoryBranch({ condition, replicate, baseOutput, branch, originalMessage: a001Case.input.userMessage, guideExcerpts: frozenInputs[a001Case.id].guideExcerpts, installedModules, candidateModules, runtimeRoot: resolvedRuntimeRoot, privateRoot: resolvedPrivateRoot, providerCacheRoot: path.join(privateRunRoot, "provider-cache") }));
    return { trajectoryId: branch.id, replicate, condition, output: stage.value, reused: stage.reused };
  });
  const trajectoryByKey = trajectoryLookup(trajectoryOutputs);

  const pairwiseTasks = [];
  for (const caseDefinition of cases.private.primaryCases) {
    for (const replicate of REPLICATES) for (const [first, second] of CONTRASTS) for (const judge of ["gpt-5.6-sol", "claude-opus-5"]) for (const orderName of ["forward", "reverse"]) {
      const [leftCondition, rightCondition] = orderedContrast(first, second, orderName);
      pairwiseTasks.push({ family: caseDefinition.family, caseId: caseDefinition.id, replicate, contrast: `${first}-${second}`, judge, orderName, caseText: caseDefinition.input.userMessage, casePurpose: caseDefinition.purpose, hardFailureFocus: caseDefinition.hardFailureFocus, leftCondition, rightCondition, leftResponse: primaryByKey.get(`${caseDefinition.id}:${replicate}:${leftCondition}`).result.answer, rightResponse: primaryByKey.get(`${caseDefinition.id}:${replicate}:${rightCondition}`).result.answer, trajectory: false });
    }
  }
  for (const replicate of REPLICATES) for (const [first, second] of CONTRASTS) for (const judge of ["gpt-5.6-sol", "claude-opus-5"]) for (const orderName of ["forward", "reverse"]) {
    const [leftCondition, rightCondition] = orderedContrast(first, second, orderName);
    const leftItems = cases.private.trajectoryCases.map((branch) => trajectoryByKey.get(`${branch.id}:${replicate}:${leftCondition}`));
    const rightItems = cases.private.trajectoryCases.map((branch) => trajectoryByKey.get(`${branch.id}:${replicate}:${rightCondition}`));
    pairwiseTasks.push({ family: "A001-counterfactual-multi-turn-branches", caseId: "A001-counterfactual-bundle", replicate, contrast: `${first}-${second}`, judge, orderName, caseText: `${a001Case.input.userMessage}\n\nCOUNTERFACTUAL FOLLOW-UPS:\n${cases.private.trajectoryCases.map((item) => `- ${item.followUp}`).join("\n")}`, casePurpose: "Continuity across the ten owner-authored counterfactual engineering trajectories; these are not observed conversations.", hardFailureFocus: ["temporary calm or one completed action treated as full repair", "punitive care arrears", "lost continuity with the original concern"], leftCondition, rightCondition, leftResponse: answerBundle(leftItems), rightResponse: answerBundle(rightItems), trajectory: true });
  }
  const pairwiseRecords = await mapWithConcurrency(pairwiseTasks, concurrency, async (task) => await runPairwiseJudgment({ store, candidateModules, judgeConfig, ...task }));

  const traceRecords = [];
  for (const replicate of REPLICATES) {
    const outputs = Object.fromEntries(CONDITIONS.map((condition) => [condition, primaryByKey.get(`${a001Case.id}:${replicate}:${condition}`)]));
    for (const judge of ["gpt-5.6-sol", "claude-opus-5"]) traceRecords.push(await runTraceJudgment({ store, candidateModules, judgeConfig, judge, replicate, originalMessage: a001Case.input.userMessage, outputs }));
  }

  const a001Fixture = await readJson(path.join(repositoryRoot, "corpus/difficult-cases/A001-inner-child-credibility/case.json"));
  const legacyEvaluations = [];
  for (const condition of CONDITIONS) for (const replicate of REPLICATES) {
    const output = primaryByKey.get(`${a001Case.id}:${replicate}:${condition}`);
    legacyEvaluations.push({ condition, replicate, evaluation: candidateModules.evaluateStructuredBenchmark(output.result, a001Fixture.acceptance) });
  }
  const legacyContract = legacyContractSummary(legacyEvaluations);
  const parity = paritySummary(primaryOutputs);
  if (!parity.every((row) => row.identicalSourceAndGuideInput)) throw new Error("C and D did not receive identical source/guide inputs.");
  if (!parity.every((row) => row.canonicalQuestionPolicyPreserved)) throw new Error("Canonical-question authority changed during the primary scaffold comparison.");

  const aggregate = aggregatePairwise(pairwiseRecords);
  const diagnostics = meanDiagnostics(pairwiseRecords);
  const hardFailures = summarizeHardFailures(pairwiseRecords);
  const receipts = primaryOutputs.map((item) => modelCallReceipt(item.output, item.condition, item.caseId, item.replicate)).concat(trajectoryOutputs.map((item) => modelCallReceipt(item.output, item.condition, item.trajectoryId, item.replicate)));
  const latency = latencySummary(receipts);
  const families = [...new Set(pairwiseRecords.map((item) => item.family))];
  const selection = selectArchitecture({ records: pairwiseRecords, hardFailures, latency, diagnostics, families });
  const traces = traceAggregate(traceRecords);
  const outputPaths = {
    aggregate: path.relative(repositoryRoot, path.join(analysisRoot, "benchmark-results.json")),
    inventory: path.relative(repositoryRoot, path.join(analysisRoot, "case-provenance-inventory.json")),
    privateRoot: `<owner-private-root>/run-${runIdentity.slice(0, 16)}`
  };
  const publicResult = {
    schemaVersion: 1,
    benchmarkVersion: BENCHMARK_VERSION,
    runIdentity,
    generatedAt: new Date().toISOString(),
    environment: publicEnvironment(environment),
    models: Object.fromEntries(Object.entries(probes).map(([key, value]) => [key, publicProbe(value)])),
    caseInventorySha256: sha256(stableCaseInventory),
    pairwise: { aggregate, diagnosticMeans: diagnostics, hardFailures, presentations: pairwiseRecords.map(publicPairwiseRecord) },
    legacyA001Contract: legacyContract,
    inputGuideAndQuestionParity: parity,
    informationFlow: traces,
    latency,
    selection,
    resumability: { stageCount: Object.keys(store.manifest.stages).length, completedStages: Object.values(store.manifest.stages).filter((item) => item.status === "complete").length, manifest: `${outputPaths.privateRoot}/manifest.json` },
    privacy: { rawEvidenceCommitted: false, privateRoot: outputPaths.privateRoot, privateRootSha256: sha256(privateRunRoot), gitSurfacePreflight: privacyPreflight },
    limitations: cases.public.limitation
  };
  await atomicWriteJson(path.join(analysisRoot, "case-provenance-inventory.json"), cases.public, 0o644);
  await atomicWriteJson(path.join(analysisRoot, "benchmark-results.json"), publicResult, 0o644);
  await atomicWriteJson(path.join(analysisRoot, "environment-and-models.json"), { environment: publicEnvironment(environment), models: publicResult.models, implementationFingerprint: implementation.sha256, runIdentity }, 0o644);
  await atomicWriteJson(path.join(privateRunRoot, "final-private-index.json"), { runIdentity, primaryOutputs: primaryOutputs.map((item) => ({ ...item, outputFileSha256: sha256(item.output) })), trajectoryOutputs: trajectoryOutputs.map((item) => ({ ...item, outputFileSha256: sha256(item.output) })), pairwiseRecordHashes: pairwiseRecords.map((item) => sha256(item.raw)), traceRecordHashes: traceRecords.map((item) => sha256(item.raw)) });
  await atomicWriteText(path.join(analysisRoot, "REPORT.md"), markdownReport({ environment: publicEnvironment(environment), probes: publicResult.models, caseInventory: cases.public, aggregate, diagnostics, hardFailures, latency, selection, legacyContract, parity, traces, outputPaths }), 0o644);
  await assertPrivateTextAbsentFromGit(repositoryRoot, [cases.private.originalMessage]);
  return { publicResult, privateRunRoot, caseInventory: cases.public };
}
