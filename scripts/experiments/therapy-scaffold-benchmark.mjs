import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { EVIDENCE_CLASSES, loadBenchmarkCaseSet } from "./therapy-scaffold-cases.mjs";
import { EVALUATION_PROMPT_VERSION, pairwiseJudgeSchema, pairwisePrompt, traceJudgeSchema, tracePrompt } from "./therapy-scaffold-evaluation.mjs";
import {
  StageStore,
  ResumableTraceProvider,
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
const providerSupervisorPath = path.join(here, "therapy-scaffold-provider-supervisor.mjs");
export const BENCHMARK_VERSION = "therapy-scaffold-authority-repair-bakeoff-v2";
export const CONDITIONS = Object.freeze(["A", "C", "D"]);
export const REPLICATES = Object.freeze([1, 2, 3]);
export const CONTRASTS = Object.freeze([["A", "C"], ["A", "D"], ["C", "D"]]);

const entitlementSchema = { type: "object", additionalProperties: false, properties: { ok: { type: "boolean" } }, required: ["ok"] };

function moduleUrl(root, relative) { return pathToFileURL(path.join(root, relative)).href; }
async function loadModules(root) {
  const [config, factory, contextBuilder, pipeline, benchmark, regressions] = await Promise.all([
    import(moduleUrl(root, "src/core/config.mjs")),
    import(moduleUrl(root, "src/providers/factory.mjs")),
    import(moduleUrl(root, "src/orchestrator/context-builder.mjs")),
    import(moduleUrl(root, "src/orchestrator/run-tiered-pipeline.mjs")),
    import(moduleUrl(root, "src/autopilot/benchmark-acceptance.mjs")),
    import(moduleUrl(root, "src/guide-graph/regressions.mjs"))
  ]);
  return { ...config, ...factory, ...contextBuilder, ...pipeline, ...benchmark, ...regressions };
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

function createBenchmarkProviders(modules, config) {
  const providers = modules.createProviders(config);
  for (const provider of new Set(Object.values(providers))) {
    if (typeof provider?.command !== "string" || !Array.isArray(provider.baseArgs)) continue;
    const originalCommand = provider.command;
    const originalBaseArgs = [...provider.baseArgs];
    provider.command = process.execPath;
    provider.baseArgs = [providerSupervisorPath, String(process.pid), originalCommand, ...originalBaseArgs];
  }
  return providers;
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
  const providers = traceProviders(createBenchmarkProviders(modules, config), { cacheRoot: providerCacheRoot, lane: `primary-${caseDefinition.id}-r${replicate}-${condition}` });
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
    error.benchmarkContext = { phase: "producer", condition, caseId: caseDefinition.id, replicate };
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
  const providers = traceProviders(createBenchmarkProviders(modules, config), { cacheRoot: providerCacheRoot, lane: `trajectory-${branch.id}-r${replicate}-${condition}` });
  try {
    const result = await modules.runTieredTherapyPipeline({ context, providers, config, processingMode: "auto", onProgress: (event) => progress(`${branch.id}/${condition}`, event) });
    return { condition, trajectoryId: branch.id, sourceUserTurnFingerprint: sha256({ originalMessage, followUp: branch.followUp, guideExcerpts }), context, result, providerTraces: providerTraces(providers), config: publicConfig(config) };
  } catch (error) {
    error.benchmarkProviderTraces = providerTraces(providers);
    error.benchmarkContext = { phase: "trajectory", condition, trajectoryId: branch.id, replicate };
    throw error;
  }
}

async function structuredJudgeCall(provider, prompt, schema, stage) {
  const started = Date.now();
  const request = { ...prompt, outputSchema: schema, metadata: { stage } };
  const raw = await provider.generate(request);
  let value;
  try { value = JSON.parse(raw.text); } catch (error) {
    await provider.recordConsumerFailure?.({ request, error });
    throw new Error(`${stage} returned invalid JSON: ${error.message}`);
  }
  const tracedCall = provider.calls?.at(-1) ?? null;
  return {
    value,
    raw,
    durationMs: Date.now() - started,
    callReceipt: tracedCall ? {
      status: tracedCall.status,
      priorFailureCount: tracedCall.priorFailureCount ?? 0,
      priorFailureCodes: [...new Set((tracedCall.priorFailures ?? []).map((item) => item.code).filter(Boolean))]
    } : null
  };
}

export function validateExactModelProbe(probe, requestedModel) {
  if (probe?.ok !== true) throw new Error(`${requestedModel} failed its live exact-model probe.`);
  if (!probe.returnedModel || probe.returnedModel !== requestedModel) {
    throw new Error(`Exact-model probe mismatch: requested ${requestedModel}, returned ${probe.returnedModel ?? "no model selector"}.`);
  }
  return probe;
}

async function liveProbe(provider, requestedModel) {
  const generated = await structuredJudgeCall(provider, { system: "This is an exact-model structured-output probe. Return only the requested schema.", user: 'Return {"ok":true}.' }, entitlementSchema, "therapy_scaffold_exact_model_probe");
  return validateExactModelProbe({ ok: generated.value.ok, requestedModel, returnedModel: generated.raw.model ?? null, responseId: generated.raw.responseId ?? generated.raw.requestId ?? null, usage: generated.raw.usage ?? null, transport: generated.raw.transport ?? null }, requestedModel);
}

export function aggregatePairwise(records) {
  const result = {};
  for (const record of records) {
    const keys = ["overall", `evidence-class:${record.evidenceClass}`, `family:${record.family}`, `judge:${record.judge}`, `contrast:${record.contrast}`, `family-contrast:${record.family}:${record.contrast}`];
    for (const key of keys) {
      const row = result[key] ??= { presentations: 0, wins: {}, ties: 0, orderConsistentPairs: 0, orderDisagreements: 0, judgeConsistentPairs: 0, judgeDisagreements: 0 };
      row.presentations += 1;
      if (record.winnerCondition === "tie") row.ties += 1;
      else row.wins[record.winnerCondition] = (row.wins[record.winnerCondition] ?? 0) + 1;
    }
  }
  for (const [key, row] of Object.entries(result)) {
    const relevant = key === "overall" ? records
      : key.startsWith("family-contrast:") ? records.filter((record) => `${record.family}:${record.contrast}` === key.slice("family-contrast:".length))
      : key.startsWith("evidence-class:") ? records.filter((record) => record.evidenceClass === key.slice("evidence-class:".length))
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
    const judgePairs = new Map();
    for (const record of relevant) {
      const id = `${record.family}:${record.caseId}:${record.replicate}:${record.contrast}:${record.orderName}`;
      const values = judgePairs.get(id) ?? [];
      values.push(record.winnerCondition);
      judgePairs.set(id, values);
    }
    for (const values of judgePairs.values()) {
      if (values.length === 2 && values[0] === values[1]) row.judgeConsistentPairs += 1;
      else if (values.length === 2) row.judgeDisagreements += 1;
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
      const cell = stageCells[key] ??= { stage: call.stage ?? "unknown", model: call.model ?? "unknown", logicalCalls: 0, liveCalls: 0, cacheReuses: 0, priorFailedAttempts: 0, durationsMs: [] };
      cell.logicalCalls += 1;
      if (call.status === "reused") cell.cacheReuses += 1;
      else if (call.status === "complete") cell.liveCalls += 1;
      cell.priorFailedAttempts += call.priorFailureCount ?? 0;
      if (Number.isFinite(call.durationMs)) cell.durationsMs.push(call.durationMs);
      for (const [usageKey, usageValue] of Object.entries(call.usage ?? {})) {
        if (typeof usageValue === "number" && Number.isFinite(usageValue)) usageTotals[usageKey] = (usageTotals[usageKey] ?? 0) + usageValue;
      }
    }
    result[condition] = {
      responses: items.length,
      logicalProviderCalls: calls,
      liveModelCalls: items.reduce((sum, item) => sum + item.receipt.calls.filter((call) => call.status === "complete").length, 0),
      providerCacheReuses: items.reduce((sum, item) => sum + item.receipt.calls.filter((call) => call.status === "reused").length, 0),
      priorFailedAttempts: items.reduce((sum, item) => sum + item.receipt.calls.reduce((callSum, call) => callSum + (call.priorFailureCount ?? 0), 0), 0),
      callsPerResponse: items.length ? calls / items.length : null,
      medianTotalMs: totals.length ? totals[Math.floor(totals.length / 2)] : null,
      meanTotalMs: totals.length ? Math.round(totals.reduce((sum, value) => sum + value, 0) / totals.length) : null,
      meanObservedWallClockMs: observedWalls.length ? Math.round(observedWalls.reduce((sum, value) => sum + value, 0) / observedWalls.length) : null,
      resumedProviderStages: items.reduce((sum, item) => sum + item.resumedProviderStages, 0),
      retries: items.reduce((sum, item) => sum + item.retries, 0) + items.reduce((sum, item) => sum + item.receipt.calls.reduce((callSum, call) => callSum + (call.priorFailureCount ?? 0), 0), 0),
      structuredOutputFailures: items.reduce((sum, item) => sum + item.receipt.calls.reduce((callSum, call) => callSum + (call.priorFailureCodes ?? []).filter((code) => code === "STRUCTURED_OUTPUT_INVALID").length, 0), 0),
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

export function selectArchitecture({ records, hardFailures, latency, diagnostics, families = null, rolePreservation = { deep: true, forensic: true, renderer: true }, routingSafety = { pass: true } }) {
  const familyClasses = new Map();
  for (const record of records) {
    const prior = familyClasses.get(record.family);
    if (prior && prior !== record.evidenceClass) throw new Error(`Evidence class drift for family ${record.family}: ${prior} versus ${record.evidenceClass}.`);
    familyClasses.set(record.family, record.evidenceClass ?? EVIDENCE_CLASSES.SYNTHETIC_ENGINEERING);
  }
  for (const family of families ?? []) if (!familyClasses.has(family)) familyClasses.set(family, EVIDENCE_CLASSES.SYNTHETIC_ENGINEERING);
  const comparison = {
    byFamily: {},
    observedQuality: { COverA: 0, DOverA: 0, AOverC: 0, AOverD: 0, DOverC: 0, COverD: 0, ties: 0 },
    counterfactualContinuity: { COverA: 0, DOverA: 0, DOverC: 0, COverD: 0, ties: 0 },
    syntheticRobustness: { COverA: 0, DOverA: 0, DOverC: 0, COverD: 0, ties: 0 },
    engineering: { COverA: 0, DOverA: 0, DOverC: 0, COverD: 0, ties: 0 }
  };
  for (const [family, evidenceClass] of familyClasses) {
    const ac = stablePairWins(records, family, "A-C");
    const ad = stablePairWins(records, family, "A-D");
    const cd = stablePairWins(records, family, "C-D");
    comparison.byFamily[family] = { evidenceClass, "A-C": ac, "A-D": ad, "C-D": cd };
    const observed = evidenceClass === EVIDENCE_CLASSES.OBSERVED_OWNER;
    const engineering = [EVIDENCE_CLASSES.COUNTERFACTUAL_OWNER, EVIDENCE_CLASSES.SYNTHETIC_ENGINEERING].includes(evidenceClass);
    const classCell = evidenceClass === EVIDENCE_CLASSES.COUNTERFACTUAL_OWNER
      ? comparison.counterfactualContinuity
      : evidenceClass === EVIDENCE_CLASSES.SYNTHETIC_ENGINEERING
        ? comparison.syntheticRobustness
        : observed ? comparison.observedQuality : null;
    for (const cell of [classCell, engineering ? comparison.engineering : null].filter(Boolean)) {
      if ((ac.C ?? 0) > (ac.A ?? 0)) cell.COverA += 1;
      if ((ad.D ?? 0) > (ad.A ?? 0)) cell.DOverA += 1;
      if ((cd.D ?? 0) > (cd.C ?? 0)) cell.DOverC += 1;
      else if ((cd.C ?? 0) > (cd.D ?? 0)) cell.COverD += 1;
      else cell.ties += 1;
    }
    if (observed) {
      if ((ac.A ?? 0) > (ac.C ?? 0)) comparison.observedQuality.AOverC += 1;
      if ((ad.A ?? 0) > (ad.D ?? 0)) comparison.observedQuality.AOverD += 1;
    }
  }
  const observedOwnerFamilyCount = [...familyClasses.values()].filter((value) => value === EVIDENCE_CLASSES.OBSERVED_OWNER).length;
  const counterfactualOwnerFamilyCount = [...familyClasses.values()].filter((value) => value === EVIDENCE_CLASSES.COUNTERFACTUAL_OWNER).length;
  const syntheticEngineeringFamilyCount = [...familyClasses.values()].filter((value) => value === EVIDENCE_CLASSES.SYNTHETIC_ENGINEERING).length;
  const routingRegressionFamilyCount = [...familyClasses.values()].filter((value) => value === EVIDENCE_CLASSES.ROUTING_REGRESSION).length;
  const cObservedSupport = observedOwnerFamilyCount > 0
    && comparison.observedQuality.COverA > comparison.observedQuality.AOverC;
  const cEngineeringSupport = comparison.engineering.COverA >= 1;
  const dObservedNonRegression = observedOwnerFamilyCount > 0
    && comparison.observedQuality.AOverD === 0
    && comparison.observedQuality.COverD === 0;
  const dObservedAnchored = comparison.observedQuality.DOverA > 0 || cObservedSupport;
  const dIncrementalAcrossEngineeringFamilies = comparison.engineering.DOverC >= 2
    && comparison.engineering.DOverC > comparison.engineering.COverD;
  const dHardFailureRegression = hardFailures.D.presentationsWithHardFailure > hardFailures.C.presentationsWithHardFailure;
  const dUnsupportedRegression = (diagnostics.D.unsupported_inference ?? 0) > (diagnostics.C.unsupported_inference ?? 0) + 0.25;
  const latencyRatio = latency.C.meanTotalMs ? latency.D.meanTotalMs / latency.C.meanTotalMs : null;
  const callRatio = latency.C.callsPerResponse ? latency.D.callsPerResponse / latency.C.callsPerResponse : null;
  const dResourceRegression = (latencyRatio ?? Infinity) > 1.75 || (callRatio ?? Infinity) > 2;
  const rolePreservationPassed = rolePreservation.deep === true && rolePreservation.forensic === true && rolePreservation.renderer !== false;
  const routingSafetyPassed = routingSafety.pass === true;
  const cEligible = cObservedSupport && cEngineeringSupport && routingSafetyPassed;
  const dEligible = dObservedNonRegression && dObservedAnchored && dIncrementalAcrossEngineeringFamilies
    && rolePreservationPassed && routingSafetyPassed
    && !dHardFailureRegression && !dUnsupportedRegression && !dResourceRegression;
  let selected = "no-change";
  let reason = "Neither candidate demonstrated reliable observed-A001 improvement plus the required engineering support; broader observed-user generalization cannot be established from one observed family.";
  if (dEligible) {
    selected = "model-first";
    reason = "D is the best-supported experimental production candidate: it preserved observed A001, added material value over C across multiple counterfactual or synthetic engineering families, retained deep/forensic roles, and passed the predefined safety, inference, latency, and call-budget checks. This is not evidence of real-world therapeutic effectiveness or broader observed-user generalization.";
  } else if (cEligible) {
    selected = "advisory";
    reason = "C is the best-supported experimental production candidate on observed A001 plus counterfactual or synthetic engineering robustness evidence; D did not clear the higher complexity threshold. Broader observed-user generalization and therapeutic effectiveness remain unestablished."
  }
  return {
    selected,
    reason,
    presumptiveCandidate: "advisory",
    evidenceBoundary: {
      observedOwnerFamilyCount,
      counterfactualOwnerFamilyCount,
      syntheticEngineeringFamilyCount,
      routingRegressionFamilyCount,
      realWorldGeneralizationEstablished: false,
      observedUserGeneralizationEstablished: false,
      therapeuticEffectivenessEstablished: false
    },
    thresholds: { observedOwnerLiftRequired: 1, engineeringSupportFamiliesRequiredForC: 1, modelFirstIncrementalEngineeringFamiliesRequired: 2, maxUnsupportedInferenceIncrease: 0.25, maxLatencyRatio: 1.75, maxCallRatio: 2 },
    comparison,
    checks: { cObservedSupport, cEngineeringSupport, cEligible, dObservedNonRegression, dObservedAnchored, dIncrementalAcrossEngineeringFamilies, rolePreservationPassed, routingSafetyPassed, dHardFailureRegression, dUnsupportedRegression, dResourceRegression, latencyRatio, callRatio, dEligible }
  };
}

function answerBundle(items) {
  return items.map((item) => `FOLLOW-UP ${item.trajectoryId}:\n${item.result.answer}`).join("\n\n");
}

function privateModelTexts({ primaryOutputs, trajectoryOutputs, pairwiseRecords, traceRecords }) {
  const texts = [];
  for (const item of [...primaryOutputs, ...trajectoryOutputs]) {
    for (const call of Object.values(item.output.providerTraces ?? {}).flat()) {
      if (typeof call.response?.text === "string") texts.push(call.response.text);
    }
  }
  for (const record of [...pairwiseRecords, ...traceRecords]) {
    if (typeof record.raw?.raw?.text === "string") texts.push(record.raw.raw.text);
  }
  return texts;
}

function publicProbe(value) {
  return { requestedModel: value.requestedModel, returnedModel: value.returnedModel, responseId: value.responseId, usage: value.usage, transport: value.transport, probedAt: value.probedAt ?? null, reused: value.reused === true, reusedFromRun: value.reusedFromRun ?? null };
}

function probeCapabilityFingerprint(environment, providerKey) {
  return sha256(providerKey === "openai"
    ? { version: environment.capabilities.codexVersion, help: environment.capabilities.codexHelp }
    : { version: environment.capabilities.claudeVersion, help: environment.capabilities.claudeHelp });
}

async function reusableProbeReceipt(privateRoot, { providerKey, requestedModel, capabilityFingerprint, maxAgeMs = 24 * 60 * 60 * 1000 }) {
  let entries = [];
  try { entries = await fs.readdir(privateRoot, { withFileTypes: true }); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("run-")) continue;
    try {
      const [identity, stage] = await Promise.all([
        readJson(path.join(privateRoot, entry.name, "run-identity.json")),
        readJson(path.join(privateRoot, entry.name, "stages", `probe-${providerKey}.json`))
      ]);
      const value = stage.value;
      const completedAt = Date.parse(stage.completedAt ?? "");
      if (stage.status !== "complete" || !Number.isFinite(completedAt) || Date.now() - completedAt > maxAgeMs) continue;
      if (value?.requestedModel !== requestedModel || value?.returnedModel !== requestedModel || value?.transport !== "cli") continue;
      const priorFingerprint = probeCapabilityFingerprint(identity.environment, providerKey);
      if (priorFingerprint !== capabilityFingerprint) continue;
      candidates.push({ ...value, ok: true, probedAt: stage.completedAt, reused: true, reusedFromRun: entry.name });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return candidates.sort((left, right) => Date.parse(right.probedAt) - Date.parse(left.probedAt))[0] ?? null;
}

function publicPairwiseRecord(record) {
  return {
    family: record.family,
    evidenceClass: record.evidenceClass,
    caseId: record.caseId,
    replicate: record.replicate,
    contrast: record.contrast,
    judge: record.judge,
    order: record.orderName,
    winnerCondition: record.winnerCondition,
    rawWinnerCondition: record.rawWinnerCondition,
    hardFailureCounts: record.hardFailureCounts,
    judgeCall: {
      provider: record.raw.raw?.provider ?? null,
      model: record.raw.raw?.model ?? null,
      durationMs: record.raw.durationMs ?? null,
      usage: record.raw.raw?.usage ?? null,
      transport: record.raw.raw?.transport ?? null,
      stageReused: record.reused === true,
      providerCacheStatus: record.raw.callReceipt?.status ?? null,
      priorFailureCount: record.raw.callReceipt?.priorFailureCount ?? 0,
      priorFailureCodes: record.raw.callReceipt?.priorFailureCodes ?? []
    },
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
    priorFailedAttempts: receipt.calls.reduce((sum, call) => sum + (call.priorFailureCount ?? 0), 0),
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
  const providers = createBenchmarkProviders(candidateModules, config);
  return judge === "gpt-5.6-sol" ? providers.openai : providers.anthropic;
}

async function runPairwiseJudgment({ store, candidateModules, judgeConfig, providerCacheRoot, judge, family, evidenceClass, caseId, replicate, contrast, orderName, caseText, casePurpose, hardFailureFocus, leftCondition, rightCondition, leftResponse, rightResponse, trajectory = false }) {
  const blindSeed = `${BENCHMARK_VERSION}:${family}:${caseId}:${replicate}:${contrast}:${judge}:${orderName}`;
  const labels = deterministicPermutation(["Response Lumen", "Response Vale"], blindSeed);
  const prompt = pairwisePrompt({ caseText, casePurpose, hardFailureFocus, leftLabel: labels[0], leftResponse, rightLabel: labels[1], rightResponse, trajectory });
  const stageId = `judge-${family}-${caseId}-r${replicate}-${contrast}-${judge}-${orderName}`;
  const stage = await store.run(stageId, { evaluationVersion: EVALUATION_PROMPT_VERSION, judge, family, evidenceClass, caseId, replicate, contrast, orderName, responseHashes: [sha256(leftResponse), sha256(rightResponse)], promptHash: sha256(prompt) }, async () => {
    const rawProvider = await createJudgeProvider(candidateModules, judgeConfig, judge);
    const provider = new ResumableTraceProvider(rawProvider, { cacheRoot: providerCacheRoot, lane: `judge-${family}-${caseId}-r${replicate}-${contrast}-${judge}-${orderName}` });
    try {
      return await structuredJudgeCall(provider, prompt, pairwiseJudgeSchema, "therapy_scaffold_blind_pairwise_judgment");
    } catch (error) {
      error.benchmarkProviderTraces = { judge: provider.calls };
      error.benchmarkContext = { phase: "pairwise-judge", family, caseId, replicate, contrast, judge, orderName };
      throw error;
    }
  });
  const value = stage.value.value;
  const rawWinnerCondition = normalizeWinner(value.winner, leftCondition, rightCondition);
  const leftFailures = value.left_hard_failures ?? [];
  const rightFailures = value.right_hard_failures ?? [];
  const winnerCondition = applyHardFailureGate(rawWinnerCondition, leftCondition, rightCondition, leftFailures, rightFailures);
  return {
    family, evidenceClass, caseId, replicate, contrast, judge, orderName,
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

function publicTraceJudgment(record) {
  return {
    replicate: record.replicate,
    judge: record.judge,
    returnedModel: record.raw.raw?.model ?? null,
    durationMs: record.raw.durationMs ?? null,
    usage: record.raw.raw?.usage ?? null,
    transport: record.raw.raw?.transport ?? null,
    stageReused: record.reused === true,
    providerCacheStatus: record.raw.callReceipt?.status ?? null,
    priorFailureCount: record.raw.callReceipt?.priorFailureCount ?? 0,
    priorFailureCodes: record.raw.callReceipt?.priorFailureCodes ?? [],
    judgmentSha256: sha256(record.raw)
  };
}

async function runTraceJudgment({ store, candidateModules, judgeConfig, providerCacheRoot, judge, replicate, originalMessage, outputs }) {
  const order = deterministicPermutation(CONDITIONS, `${BENCHMARK_VERSION}:trace:${judge}:${replicate}`);
  const labelMap = {};
  const anonymizedConditions = order.map((condition, index) => {
    const label = `Path ${index + 1}`;
    labelMap[label] = condition;
    return { label, stages: traceStages(outputs[condition]) };
  });
  const prompt = tracePrompt({ originalMessage, anonymizedConditions });
  const stage = await store.run(`trace-r${replicate}-${judge}`, { evaluationVersion: EVALUATION_PROMPT_VERSION, judge, replicate, labelMapHash: sha256(labelMap), stageHashes: anonymizedConditions.map((item) => sha256(item)), promptHash: sha256(prompt) }, async () => {
    const rawProvider = await createJudgeProvider(candidateModules, judgeConfig, judge);
    const provider = new ResumableTraceProvider(rawProvider, { cacheRoot: providerCacheRoot, lane: `trace-r${replicate}-${judge}` });
    try {
      return await structuredJudgeCall(provider, prompt, traceJudgeSchema, "therapy_scaffold_information_flow_audit");
    } catch (error) {
      error.benchmarkProviderTraces = { judge: provider.calls };
      error.benchmarkContext = { phase: "trace-judge", replicate, judge };
      throw error;
    }
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

function actualFinalRendererModel(output) {
  const calls = Object.values(output.providerTraces ?? {}).flat();
  const final = [...calls].reverse().find((call) => ["model_first_integration", "realization", "realization_retry"].includes(call.request?.metadata?.stage));
  return final?.response?.model ?? null;
}

function modelFirstRolePreservation(primaryOutputs) {
  const dOutputs = primaryOutputs.filter((item) => item.condition === "D");
  function callsFor(item) { return responseReceipt(item.output).calls; }
  const deep = dOutputs.filter((item) => item.output.result.processingTier === "deep");
  const forensic = dOutputs.filter((item) => item.output.result.processingTier === "forensic");
  const deepPass = deep.length > 0 && deep.every((item) => {
    const calls = callsFor(item);
    return calls.some((call) => call.stage === "deep_analysis" && call.model === "claude-opus-5")
      && calls.some((call) => call.stage === "deep_critique" && call.model === "gpt-5.6-sol");
  });
  const forensicPass = forensic.length > 0 && forensic.every((item) => {
    const calls = callsFor(item);
    const candidates = calls.filter((call) => call.stage === "candidate");
    const critiques = calls.filter((call) => call.stage === "critique");
    return candidates.some((call) => call.model === "claude-opus-5")
      && candidates.some((call) => call.model === "gpt-5.6-sol")
      && critiques.some((call) => call.model === "claude-opus-5")
      && critiques.some((call) => call.model === "gpt-5.6-sol")
      && calls.some((call) => call.stage === "adjudication");
  });
  const rendererPass = dOutputs.length > 0 && dOutputs.every((item) => actualFinalRendererModel(item.output) === "claude-sonnet-4-6");
  return {
    deep: deepPass,
    forensic: forensicPass,
    renderer: rendererPass,
    deepResponseCount: deep.length,
    forensicResponseCount: forensic.length,
    checkedDResponseCount: dOutputs.length
  };
}

function paritySummary(primaryOutputs) {
  const rows = [];
  for (const caseId of [...new Set(primaryOutputs.map((item) => item.caseId))]) {
    for (const replicate of REPLICATES) {
      const items = primaryOutputs.filter((item) => item.caseId === caseId && item.replicate === replicate);
      const sourceHashes = [...new Set(items.map((item) => item.output.sourceFingerprint))];
      const questionHashes = [...new Set(items.map((item) => sha256(item.output.result.next_question ?? "")))];
      const rendererModels = Object.fromEntries(items.map((item) => [item.condition, item.output.config.responseRendererModel]));
      const actualRendererModels = Object.fromEntries(items.map((item) => [item.condition, actualFinalRendererModel(item.output)]));
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
      rows.push({ caseId, replicate, identicalSourceAndGuideInput: sourceHashes.length === 1, canonicalQuestionPolicyPreserved, identicalCanonicalQuestionAcrossStochasticConditions: questionHashes.length === 1, sourceFingerprint: sourceHashes[0] ?? null, canonicalQuestionHashes: questionHashes, rendererModels, actualRendererModels, exactConfiguredRendererUsed: items.every((item) => actualFinalRendererModel(item.output) === item.output.config.responseRendererModel), rendererQuestionProposals });
    }
  }
  return rows;
}

function trajectoryParitySummary(trajectoryOutputs) {
  const rows = [];
  for (const trajectoryId of [...new Set(trajectoryOutputs.map((item) => item.trajectoryId))]) {
    for (const replicate of REPLICATES) {
      const items = trajectoryOutputs.filter((item) => item.trajectoryId === trajectoryId && item.replicate === replicate);
      const sourceHashes = [...new Set(items.map((item) => item.output.sourceUserTurnFingerprint))];
      rows.push({
        trajectoryId,
        replicate,
        identicalSourceAndGuideInput: sourceHashes.length === 1,
        canonicalQuestionPolicyPreserved: items.every((item) => (item.output.result.next_question ?? "") === (item.output.result.interventionContract?.nextQuestion ?? "")),
        exactConfiguredRendererUsed: items.every((item) => actualFinalRendererModel(item.output) === item.output.config.responseRendererModel),
        sourceFingerprint: sourceHashes[0] ?? null
      });
    }
  }
  return rows;
}

function markdownReport({ environment, probes, caseInventory, aggregate, rawAggregate, diagnostics, hardFailures, latency, selection, legacyContract, parity, trajectoryParity, rolePreservation, routingSafety, traces, outputPaths }) {
  const familyRows = Object.entries(aggregate).filter(([key]) => key.startsWith("family-contrast:"));
  const table = familyRows.map(([key, row]) => `| ${key.slice("family-contrast:".length)} | ${row.wins.A ?? 0} | ${row.wins.C ?? 0} | ${row.wins.D ?? 0} | ${row.ties} | ${row.orderDisagreements} |`).join("\n");
  const evidenceRows = Object.values(EVIDENCE_CLASSES).map((evidenceClass) => {
    const adjusted = aggregate[`evidence-class:${evidenceClass}`] ?? { presentations: 0, wins: {}, ties: 0, orderDisagreements: 0, judgeDisagreements: 0 };
    const raw = rawAggregate[`evidence-class:${evidenceClass}`] ?? { wins: {}, ties: 0 };
    return `| ${evidenceClass} | ${adjusted.presentations} | ${JSON.stringify(adjusted.wins)} | ${adjusted.ties} | ${JSON.stringify(raw.wins)} | ${raw.ties} | ${adjusted.orderDisagreements} | ${adjusted.judgeDisagreements} |`;
  }).join("\n");
  const directAdjusted = aggregate["contrast:C-D"] ?? null;
  const directRaw = rawAggregate["contrast:C-D"] ?? null;
  return `# Therapy scaffold authority repair — controlled bakeoff\n\n` +
    `Generated: ${new Date().toISOString()}\n\n` +
    `## Evidence boundary\n\nThe benchmark contains one observed owner-authored therapy family, ten owner-authored counterfactual engineering trajectories, and explicitly synthetic stress cases. It is an engineering quality comparison, not clinical validation or outcome evidence. Raw private transcripts and model outputs remain outside Git.\n\n` +
    `## Exact environment\n\n- Source origin/main: \`${environment.sourceOriginMain}\`\n- Protected origin/stable: \`${environment.protectedOriginStable}\`\n- Installed runtime: \`${environment.installedHead}\` (${environment.installedPackageVersion})\n- Candidate evidence SHA: \`${environment.candidateHead}\`\n- Reference ablation: \`${environment.referenceExperimentSha}\`\n- Models: renderer \`${probes.renderer.requestedModel}\`, Anthropic judge \`${probes.anthropic.requestedModel}\`, Codex judge \`${probes.openai.requestedModel}\`\n- Codex transport: unchanged current CLI stdin transport; native developer-instruction parity is outside this comparison.\n\n` +
    `## Blinded pairwise results\n\nPrimary result is pairwise preference. Diagnostic scores, legacy contracts, and hard failures remain separate.\n\n| Family and contrast | A wins | C wins | D wins | Ties | Order disagreements |\n|---|---:|---:|---:|---:|---:|\n${table}\n\n` +
    `Overall hard-failure-adjusted aggregate: \`${JSON.stringify(aggregate.overall)}\`\n\nOverall raw aggregate: \`${JSON.stringify(rawAggregate.overall)}\`\n\nDirect C-vs-D, hard-failure-adjusted: \`${JSON.stringify(directAdjusted)}\`\n\nDirect C-vs-D, raw: \`${JSON.stringify(directRaw)}\`\n\nJudge aggregates: \`${JSON.stringify(Object.fromEntries(Object.entries(aggregate).filter(([key]) => key.startsWith("judge:"))))}\`\n\n` +
    `### Evidence-class separation\n\nWins from counterfactual or synthetic material are engineering evidence only. They are not labeled observed-user generalization, therapeutic effectiveness, or clinical evidence.\n\n| Evidence class | Presentations | Adjusted wins | Adjusted ties | Raw wins | Raw ties | Order disagreements | Judge disagreements |\n|---|---:|---|---:|---|---:|---:|---:|\n${evidenceRows}\n\n` +
    `## Safety and diagnostics\n\n- Hard failures: \`${JSON.stringify(hardFailures)}\`\n- Diagnostic means (not a master score): \`${JSON.stringify(diagnostics)}\`\n- Legacy A001 contract (unchanged, secondary): ${legacyContract.filter((item) => item.ok).length}/${legacyContract.length} pass.\n- Input/guide parity: ${parity.every((item) => item.identicalSourceAndGuideInput) ? "PASS" : "FAIL"}.\n- Canonical-question policy: ${parity.every((item) => item.canonicalQuestionPolicyPreserved) ? "PASS" : "FAIL"}; cross-condition stochastic question identity is reported separately and is not a policy change.\n\n` +
    `- Counterfactual input/guide parity: ${trajectoryParity.every((item) => item.identicalSourceAndGuideInput) ? "PASS" : "FAIL"}.\n- Model-first deep/forensic role preservation: ${rolePreservation.deep && rolePreservation.forensic ? "PASS" : "FAIL"} (deep=${rolePreservation.deep}, forensic=${rolePreservation.forensic}, renderer=${rolePreservation.renderer}).\n- Deterministic routing/safety regressions: ${routingSafety.pass ? "PASS" : "FAIL"} (${routingSafety.passed}/${routingSafety.total}).\n\n` +
    `## Information flow\n\nSanitized stage-status aggregate: \`${JSON.stringify(traces)}\`. This identifies where the A001 relational mechanism weakened or was independently recovered without committing raw trace content.\n\n` +
    `## Latency and call budget\n\n\`${JSON.stringify(latency)}\`\n\n` +
    `## Decision\n\nSelected architecture: **${selection.selected}**. ${selection.reason}\n\nThe decision rule presumed C because it is the smaller repair and required D to show incremental cross-family value without hard-failure, unsupported-inference, latency, or call-budget regressions.\n\n` +
    `## Evidence paths\n\n- Sanitized aggregate: \`${outputPaths.aggregate}\`\n- Case inventory: \`${outputPaths.inventory}\`\n- Private evidence root: \`${outputPaths.privateRoot}\` (outside Git, mode 0700)\n\n` +
    `## Stop boundary\n\nNo merge, protected-ref movement, runtime installation, Guide Packet activation, hypnosis change, safety-routing change, or production promotion was performed.\n`;
}

async function filesUnder(root, relative) {
  const target = path.join(root, relative);
  const entries = await fs.readdir(target, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(root, child));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

async function fingerprintFiles(root, files) {
  const hashes = {};
  for (const relative of [...new Set(files)].sort()) {
    try { hashes[relative] = sha256(await fs.readFile(path.join(root, relative))); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return { sha256: sha256(hashes), files: hashes };
}

async function implementationFingerprint() {
  const srcFiles = await filesUnder(repositoryRoot, "src");
  const experimentFiles = (await filesUnder(repositoryRoot, "scripts/experiments")).filter((file) => /therapy-scaffold.*\.mjs$/.test(file));
  return await fingerprintFiles(repositoryRoot, [
    ...srcFiles,
    ...experimentFiles,
    "package.json",
    "package-lock.json",
    ".env.example",
    ".env.cli.example",
    "corpus/difficult-cases/A001-inner-child-credibility/case.json",
    "guide-graphs/compiled/bundle.json"
  ]);
}

async function installedRuntimeFingerprint(runtimeRoot) {
  return await fingerprintFiles(runtimeRoot, [
    ...await filesUnder(runtimeRoot, "src"),
    ...await filesUnder(runtimeRoot, "guides"),
    "guide-graphs/compiled/bundle.json",
    "package.json",
    "package-lock.json"
  ]);
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
  const [candidateModules, installedModules, cases, environment, implementation, installedRuntime] = await Promise.all([
    loadModules(repositoryRoot),
    loadModules(resolvedRuntimeRoot),
    loadBenchmarkCaseSet({ repositoryRoot, runtimeRoot: resolvedRuntimeRoot }),
    environmentSnapshot({ runtimeRoot: resolvedRuntimeRoot, experimentSha }),
    implementationFingerprint(),
    installedRuntimeFingerprint(resolvedRuntimeRoot)
  ]);
  const guideBundle = await readJson(path.join(resolvedRuntimeRoot, "guide-graphs/compiled/bundle.json"));
  const routingRegressionResult = await candidateModules.runGraphRegressionSuite();
  const routingSafety = {
    pass: routingRegressionResult.ok === true && routingRegressionResult.count === 12,
    passed: routingRegressionResult.results?.filter((item) => item.ok).length ?? 0,
    total: routingRegressionResult.count ?? 0
  };
  if (!routingSafety.pass) throw new Error("Deterministic routing/safety regression suite failed before the live scaffold comparison.");
  const ownerPrivateTexts = [cases.private.originalMessage, ...cases.private.trajectoryCases.map((item) => item.followUp)];
  const privacyPreflight = await assertPrivateTextAbsentFromGit(repositoryRoot, ownerPrivateTexts);
  const stableCaseInventory = { ...cases.public, inventoryCapturedAt: null };
  const runIdentityInput = {
    benchmarkVersion: BENCHMARK_VERSION,
    implementation: implementation.sha256,
    installedRuntime: installedRuntime.sha256,
    sourceOriginMain: environment.sourceOriginMain,
    protectedOriginStable: environment.protectedOriginStable,
    installedHead: environment.installedHead,
    experimentSha,
    graphBundleSha256: sha256(guideBundle),
    caseInventorySha256: sha256(stableCaseInventory),
    capabilityFingerprint: sha256(environment.capabilities),
    conditions: CONDITIONS,
    replicates: REPLICATES,
    models: { openai: "gpt-5.6-sol", anthropic: "claude-opus-5", renderer: "claude-sonnet-4-6" }
  };
  const runIdentity = sha256(runIdentityInput);
  const privateRunRoot = path.join(resolvedPrivateRoot, `run-${runIdentity.slice(0, 16)}`);
  const store = new StageStore(privateRunRoot, runIdentity);
  await store.initialize();
  await atomicWriteJson(path.join(privateRunRoot, "run-identity.json"), { runIdentity, runIdentityInput, implementation, installedRuntime, environment });

  const judgeConfig = baseConfig(candidateModules, { runtimeRoot: resolvedRuntimeRoot, privateRoot: resolvedPrivateRoot, scaffoldMode: "current" });
  const probeSpecs = [
    ["renderer", "claude-sonnet-4-6"],
    ["anthropic", "claude-opus-5"],
    ["openai", "gpt-5.6-sol"]
  ];
  const probes = {};
  for (const [providerKey, requestedModel] of probeSpecs) {
    const capabilityFingerprint = probeCapabilityFingerprint(environment, providerKey);
    const reusable = await reusableProbeReceipt(resolvedPrivateRoot, { providerKey, requestedModel, capabilityFingerprint });
    const stage = await store.run(`probe-${providerKey}`, { requestedModel, capabilityFingerprint, config: publicConfig(judgeConfig), reuseReceiptSha256: reusable ? sha256(reusable) : null }, async () => {
      if (reusable) return validateExactModelProbe(reusable, requestedModel);
      const provider = createBenchmarkProviders(candidateModules, judgeConfig)[providerKey];
      return { ...await liveProbe(provider, requestedModel), probedAt: new Date().toISOString(), reused: false, reusedFromRun: null };
    });
    probes[providerKey] = stage.value;
  }

  const frozenInputs = {};
  for (const caseDefinition of cases.private.primaryCases) {
    const stage = await store.run(`frozen-input-${caseDefinition.id}`, { caseId: caseDefinition.id, inputHash: sha256(caseDefinition.input), graphBundleSha256: runIdentityInput.graphBundleSha256 }, async () => await frozenInputForCase({ caseDefinition, candidateModules, runtimeRoot: resolvedRuntimeRoot, privateRoot: resolvedPrivateRoot }));
    frozenInputs[caseDefinition.id] = stage.value;
  }

  const producerTasks = cases.private.primaryCases.flatMap((caseDefinition) => REPLICATES.flatMap((replicate) => CONDITIONS.map((condition) => ({ caseDefinition, replicate, condition }))));
  const primaryOutputs = await mapWithConcurrency(producerTasks, 1, async ({ caseDefinition, replicate, condition }) => {
    const frozenInput = frozenInputs[caseDefinition.id];
    const stage = await store.run(`produce-${caseDefinition.id}-r${replicate}-${condition}`, { condition, mode: modeForCondition(condition), caseId: caseDefinition.id, replicate, frozenInputHash: sha256(frozenInput), config: publicConfig(baseConfig(modulesForCondition(condition, installedModules, candidateModules), { runtimeRoot: resolvedRuntimeRoot, privateRoot: resolvedPrivateRoot, scaffoldMode: modeForCondition(condition) })) }, async () => await runCondition({ condition, caseDefinition, replicate, frozenInput, installedModules, candidateModules, runtimeRoot: resolvedRuntimeRoot, privateRoot: resolvedPrivateRoot, providerCacheRoot: path.join(resolvedPrivateRoot, "provider-cache") }));
    return { caseId: caseDefinition.id, family: caseDefinition.family, replicate, condition, output: stage.value, reused: stage.reused };
  });
  const primaryByKey = outputLookup(primaryOutputs);

  const a001Case = cases.private.primaryCases.find((item) => item.id === "A001-observed-original");
  const trajectoryTasks = cases.private.trajectoryCases.flatMap((branch) => REPLICATES.flatMap((replicate) => CONDITIONS.map((condition) => ({ branch, replicate, condition }))));
  const trajectoryOutputs = await mapWithConcurrency(trajectoryTasks, 1, async ({ branch, replicate, condition }) => {
    const baseOutput = primaryByKey.get(`${a001Case.id}:${replicate}:${condition}`);
    const stage = await store.run(`trajectory-${branch.id}-r${replicate}-${condition}`, { condition, branchId: branch.id, replicate, baseAnswerSha256: sha256(baseOutput.result.answer), followUpSha256: sha256(branch.followUp), guideExcerptsSha256: sha256(frozenInputs[a001Case.id].guideExcerpts) }, async () => await runTrajectoryBranch({ condition, replicate, baseOutput, branch, originalMessage: a001Case.input.userMessage, guideExcerpts: frozenInputs[a001Case.id].guideExcerpts, installedModules, candidateModules, runtimeRoot: resolvedRuntimeRoot, privateRoot: resolvedPrivateRoot, providerCacheRoot: path.join(resolvedPrivateRoot, "provider-cache") }));
    return { trajectoryId: branch.id, replicate, condition, output: stage.value, reused: stage.reused };
  });
  const trajectoryByKey = trajectoryLookup(trajectoryOutputs);

  const pairwiseTasks = [];
  for (const caseDefinition of cases.private.primaryCases) {
    for (const replicate of REPLICATES) for (const [first, second] of CONTRASTS) for (const orderName of ["forward", "reverse"]) for (const judge of ["gpt-5.6-sol", "claude-opus-5"]) {
      const [leftCondition, rightCondition] = orderedContrast(first, second, orderName);
      pairwiseTasks.push({ family: caseDefinition.family, evidenceClass: caseDefinition.evidenceClass, caseId: caseDefinition.id, replicate, contrast: `${first}-${second}`, judge, orderName, caseText: caseDefinition.input.userMessage, casePurpose: caseDefinition.purpose, hardFailureFocus: caseDefinition.hardFailureFocus, leftCondition, rightCondition, leftResponse: primaryByKey.get(`${caseDefinition.id}:${replicate}:${leftCondition}`).result.answer, rightResponse: primaryByKey.get(`${caseDefinition.id}:${replicate}:${rightCondition}`).result.answer, trajectory: false });
    }
  }
  for (const replicate of REPLICATES) for (const [first, second] of CONTRASTS) for (const orderName of ["forward", "reverse"]) for (const judge of ["gpt-5.6-sol", "claude-opus-5"]) {
    const [leftCondition, rightCondition] = orderedContrast(first, second, orderName);
    const leftItems = cases.private.trajectoryCases.map((branch) => trajectoryByKey.get(`${branch.id}:${replicate}:${leftCondition}`));
    const rightItems = cases.private.trajectoryCases.map((branch) => trajectoryByKey.get(`${branch.id}:${replicate}:${rightCondition}`));
    pairwiseTasks.push({ family: "A001-counterfactual-multi-turn-branches", evidenceClass: EVIDENCE_CLASSES.COUNTERFACTUAL_OWNER, caseId: "A001-counterfactual-bundle", replicate, contrast: `${first}-${second}`, judge, orderName, caseText: `${a001Case.input.userMessage}\n\nCOUNTERFACTUAL FOLLOW-UPS:\n${cases.private.trajectoryCases.map((item) => `- ${item.followUp}`).join("\n")}`, casePurpose: "Continuity across the ten owner-authored counterfactual engineering trajectories; these are not observed conversations.", hardFailureFocus: ["temporary calm or one completed action treated as full repair", "punitive care arrears", "lost continuity with the original concern"], leftCondition, rightCondition, leftResponse: answerBundle(leftItems), rightResponse: answerBundle(rightItems), trajectory: true });
  }
  const providerCacheRoot = path.join(resolvedPrivateRoot, "provider-cache");
  const pairwiseRecords = await mapWithConcurrency(pairwiseTasks, Math.min(2, concurrency), async (task) => await runPairwiseJudgment({ store, candidateModules, judgeConfig, providerCacheRoot, ...task }));

  const traceTasks = REPLICATES.flatMap((replicate) => ["gpt-5.6-sol", "claude-opus-5"].map((judge) => ({ replicate, judge })));
  const traceRecords = await mapWithConcurrency(traceTasks, Math.min(2, concurrency), async ({ replicate, judge }) => {
    const outputs = Object.fromEntries(CONDITIONS.map((condition) => [condition, primaryByKey.get(`${a001Case.id}:${replicate}:${condition}`)]));
    return await runTraceJudgment({ store, candidateModules, judgeConfig, providerCacheRoot, judge, replicate, originalMessage: a001Case.input.userMessage, outputs });
  });

  const a001Fixture = await readJson(path.join(repositoryRoot, "corpus/difficult-cases/A001-inner-child-credibility/case.json"));
  const legacyEvaluations = [];
  for (const condition of CONDITIONS) for (const replicate of REPLICATES) {
    const output = primaryByKey.get(`${a001Case.id}:${replicate}:${condition}`);
    legacyEvaluations.push({ condition, replicate, evaluation: candidateModules.evaluateStructuredBenchmark(output.result, a001Fixture.acceptance) });
  }
  const legacyContract = legacyContractSummary(legacyEvaluations);
  const parity = paritySummary(primaryOutputs);
  const trajectoryParity = trajectoryParitySummary(trajectoryOutputs);
  if (!parity.every((row) => row.identicalSourceAndGuideInput)) throw new Error("C and D did not receive identical source/guide inputs.");
  if (!parity.every((row) => row.canonicalQuestionPolicyPreserved)) throw new Error("Canonical-question authority changed during the primary scaffold comparison.");
  if (!parity.every((row) => row.exactConfiguredRendererUsed)) throw new Error("A primary response did not use its exact configured Sonnet renderer.");
  if (!trajectoryParity.every((row) => row.identicalSourceAndGuideInput)) throw new Error("A/C/D trajectory turns did not receive identical source/guide inputs.");
  if (!trajectoryParity.every((row) => row.canonicalQuestionPolicyPreserved)) throw new Error("Canonical-question authority changed during a trajectory comparison.");
  if (!trajectoryParity.every((row) => row.exactConfiguredRendererUsed)) throw new Error("A trajectory response did not use its exact configured Sonnet renderer.");

  const aggregate = aggregatePairwise(pairwiseRecords);
  const rawAggregate = aggregatePairwise(pairwiseRecords.map((record) => ({ ...record, winnerCondition: record.rawWinnerCondition })));
  const diagnostics = meanDiagnostics(pairwiseRecords);
  const hardFailures = summarizeHardFailures(pairwiseRecords);
  const receipts = primaryOutputs.map((item) => modelCallReceipt(item.output, item.condition, item.caseId, item.replicate)).concat(trajectoryOutputs.map((item) => modelCallReceipt(item.output, item.condition, item.trajectoryId, item.replicate)));
  const latency = latencySummary(receipts);
  const families = [...new Set(pairwiseRecords.map((item) => item.family))];
  const rolePreservation = modelFirstRolePreservation(primaryOutputs);
  const selection = selectArchitecture({ records: pairwiseRecords, hardFailures, latency, diagnostics, families, rolePreservation, routingSafety });
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
    pairwise: { hardFailureAdjustedAggregate: aggregate, rawAggregate, diagnosticMeans: diagnostics, hardFailures, directCvsD: { hardFailureAdjusted: aggregate["contrast:C-D"], raw: rawAggregate["contrast:C-D"] }, presentations: pairwiseRecords.map(publicPairwiseRecord) },
    legacyA001Contract: legacyContract,
    inputGuideAndQuestionParity: { primary: parity, trajectories: trajectoryParity },
    rolePreservation,
    routingSafety,
    informationFlow: { aggregate: traces, judgments: traceRecords.map(publicTraceJudgment) },
    latency,
    providerCallReceipts: receipts,
    selection,
    resumability: { stageCount: Object.keys(store.manifest.stages).length, completedStages: Object.values(store.manifest.stages).filter((item) => item.status === "complete").length, manifest: `${outputPaths.privateRoot}/manifest.json` },
    privacy: { rawEvidenceCommitted: false, privateRoot: outputPaths.privateRoot, privateRootSha256: sha256(privateRunRoot), gitSurfacePreflight: privacyPreflight },
    limitations: cases.public.limitation
  };
  await atomicWriteJson(path.join(analysisRoot, "case-provenance-inventory.json"), cases.public, 0o644);
  await atomicWriteJson(path.join(analysisRoot, "benchmark-results.json"), publicResult, 0o644);
  await atomicWriteJson(path.join(analysisRoot, "environment-and-models.json"), { environment: publicEnvironment(environment), models: publicResult.models, implementationFingerprint: implementation.sha256, runIdentity }, 0o644);
  await atomicWriteJson(path.join(privateRunRoot, "final-private-index.json"), { runIdentity, primaryOutputs: primaryOutputs.map((item) => ({ ...item, outputFileSha256: sha256(item.output) })), trajectoryOutputs: trajectoryOutputs.map((item) => ({ ...item, outputFileSha256: sha256(item.output) })), pairwiseRecordHashes: pairwiseRecords.map((item) => sha256(item.raw)), traceRecordHashes: traceRecords.map((item) => sha256(item.raw)) });
  await atomicWriteText(path.join(analysisRoot, "REPORT.md"), markdownReport({ environment: publicEnvironment(environment), probes: publicResult.models, caseInventory: cases.public, aggregate, rawAggregate, diagnostics, hardFailures, latency, selection, legacyContract, parity, trajectoryParity, rolePreservation, routingSafety, traces, outputPaths }), 0o644);
  await assertPrivateTextAbsentFromGit(repositoryRoot, [
    ...ownerPrivateTexts,
    ...privateModelTexts({ primaryOutputs, trajectoryOutputs, pairwiseRecords, traceRecords })
  ]);
  return { publicResult, privateRunRoot, caseInventory: cases.public };
}
