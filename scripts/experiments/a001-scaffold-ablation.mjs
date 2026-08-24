import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  StageStore,
  TraceProvider,
  NativeDeveloperCodexProvider,
  aggregatePairwise,
  assertPrivateRoot,
  atomicWriteJson,
  atomicWriteText,
  conditionResultReceipt,
  parseStructured,
  providerTraces,
  randomBlindLabel,
  readJson,
  runCommand,
  sha256,
  tracedProviders
} from "./a001-scaffold-lib.mjs";
import {
  PROMPT_VERSION,
  advisoryRealizationPrompt,
  entitlementProbeSchema,
  experimentResponseSchema,
  formulationSchema,
  graphAuditSchema,
  graphAuditorPrompt,
  graphCritiqueSchema,
  modelFirstFormulationPrompt,
  modelFirstIntegrationPrompt,
  pairwiseJudgeSchema,
  pairwisePrompt,
  traceJudgeSchema,
  tracePrompt,
  transportCritiquePrompt,
  transportProbeSchema
} from "./a001-scaffold-prompts.mjs";
import { repositoryRoot, runPreflight } from "./a001-scaffold-preflight.mjs";

const EXPERIMENT_VERSION = "a001-scaffold-ablation-v1";
const CONDITIONS = ["A", "B", "C", "D", "E"];
const REPLICATES = [1, 2, 3];
const CONTRASTS = [["A", "B"], ["A", "C"], ["A", "D"], ["B", "D"], ["D", "E"], ["A", "E"]];
const analysisRoot = path.join(repositoryRoot, "analysis/a001-scaffold-ablation");

function moduleUrl(root, relative) {
  return pathToFileURL(path.join(root, relative)).href;
}

async function productionModules(root) {
  const [config, factory, contextBuilder, pipeline, realization, responseContract, benchmark] = await Promise.all([
    import(moduleUrl(root, "src/core/config.mjs")),
    import(moduleUrl(root, "src/providers/factory.mjs")),
    import(moduleUrl(root, "src/orchestrator/context-builder.mjs")),
    import(moduleUrl(root, "src/orchestrator/run-tiered-pipeline.mjs")),
    import(moduleUrl(root, "src/prompts/realize.mjs")),
    import(moduleUrl(root, "src/orchestrator/response-contract.mjs")),
    import(moduleUrl(root, "src/autopilot/benchmark-acceptance.mjs"))
  ]);
  return { ...config, ...factory, ...contextBuilder, ...pipeline, ...realization, ...responseContract, ...benchmark };
}

function progress(event) {
  const detail = event.detail ? ` — ${event.detail}` : "";
  process.stdout.write(`[${new Date().toISOString()}] ${event.stage}: ${event.status}${detail}\n`);
}

function answerText(result) {
  if (result?.answer) return result.answer;
  const body = result?.response?.answer ?? "";
  const question = result?.response?.next_question ?? "";
  return [body, question].filter(Boolean).join("\n\n");
}

function planAdjudication(snapshot, plan) {
  return {
    answer: "",
    what_is_clear: (snapshot.direct_observations ?? []).map((item) => item.statement),
    uncertainties: [
      ...(snapshot.hypotheses ?? []).filter((item) => item.confidence !== "high").map((item) => item.claim),
      ...(snapshot.unknowns ?? []).map((item) => item.question)
    ],
    next_question: plan.nextQuestion || "",
    accepted_insights: [
      ...(plan.requiredNuance ?? []),
      ...(plan.selectedNodes ?? []).flatMap((node) => node.recommendations ?? [])
    ],
    rejected_claims: [...(plan.forbiddenOverclaims ?? []), ...(plan.avoid ?? [])],
    safety_flags: snapshot.audit?.safety_flags ?? [],
    decision_summary: `Follow the deterministic primary job ${plan.primaryJob?.title ?? "none"}; expose only uncertainty that changes the next move.`
  };
}

async function call(provider, prompt, schema, stage) {
  const raw = await provider.generate({ ...prompt, outputSchema: schema, metadata: { stage } });
  return { raw, value: parseStructured(raw.text, stage) };
}

async function git(args, cwd = repositoryRoot) {
  const run = await runCommand("git", args, { cwd });
  if (run.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${run.stderr.trim()}`);
  return run.stdout.trim();
}

function originalQuestionFromMarkdown(markdown) {
  const section = markdown.match(/## Original question — verbatim\s+([\s\S]*?)(?:\n## |$)/);
  if (!section) throw new Error("Could not find the verbatim A001 question in the prior authorized snapshot.");
  const quoted = section[1].split(/\r?\n/).filter((line) => /^>\s?/.test(line)).map((line) => line.replace(/^>\s?/, "")).join("\n").trim();
  return quoted.replace(/^“|”$/g, "");
}

async function locateExistingA001Evidence() {
  const sibling = path.join(path.dirname(repositoryRoot), "innerSignalGraph-a001");
  const privateSibling = `${sibling}-private`;
  const originalFile = process.env.A001_ORIGINAL_MESSAGE_FILE || path.join(sibling, "analysis/a001/independent-conception.md");
  const trajectoryFile = path.join(sibling, "analysis/a001/trajectory-cases.json");
  const originalMessage = originalQuestionFromMarkdown(await fs.readFile(originalFile, "utf8"));
  let trajectoryEvidence = null;
  try {
    const document = await readJson(trajectoryFile);
    trajectoryEvidence = {
      classification: "owner-authored-counterfactual-engineering-trajectories; not observed follow-up transcripts",
      file: trajectoryFile,
      sha256: sha256(document),
      count: document.trajectories?.length ?? 0,
      trajectories: document.trajectories ?? []
    };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let generatedTrajectoryOutputCount = 0;
  try {
    const names = await fs.readdir(path.join(privateSibling, "trajectory-outputs"), { recursive: true });
    generatedTrajectoryOutputCount = names.filter((name) => name.endsWith(".json")).length;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return {
    originalMessage,
    originalSource: { file: originalFile, sha256: sha256(originalMessage) },
    trajectoryEvidence,
    generatedTrajectoryOutputCount,
    observedFollowUpTranscriptCount: 0,
    boundary: "No artifact was found that establishes these counterfactual prompts as observed owner follow-up turns. They are inventoried but not relabeled or rerun as real transcripts."
  };
}

function baseConfig(modules, productionRoot, privateRoot, overrides = {}) {
  return modules.loadConfig({
    mode: "cli",
    ledgerMode: "off",
    ledgerDir: path.join(privateRoot, "disabled-ledgers"),
    autopilotStateDir: path.join(privateRoot, "runtime-state"),
    guidePacketRoot: path.join(productionRoot, ".inner-signal-autopilot/guide-packets"),
    cliWorkingDirectory: productionRoot,
    openaiModel: "gpt-5.6-sol",
    anthropicModel: "claude-opus-5",
    responseRendererModel: "claude-sonnet-4-6",
    codexReasoningEffort: "high",
    claudeEffort: "high",
    therapyProcessingMode: "auto",
    ...overrides
  });
}

async function runHardPipeline({ modules, productionRoot, privateRoot, context, rendererModel }) {
  const config = baseConfig(modules, productionRoot, privateRoot, { responseRendererModel: rendererModel });
  const providers = tracedProviders(modules.createProviders(config));
  try {
    const result = await modules.runTieredTherapyPipeline({ context, providers, config, processingMode: "auto", onProgress: progress });
    return { result, providerTraces: providerTraces(providers), config: publicConfig(config) };
  } catch (error) {
    error.experimentProviderTraces = providerTraces(providers);
    throw error;
  }
}

function publicConfig(config) {
  return {
    mode: config.mode,
    openaiModel: config.openaiModel,
    anthropicModel: config.anthropicModel,
    responseRendererModel: config.responseRendererModel,
    codexReasoningEffort: config.codexReasoningEffort,
    claudeEffort: config.claudeEffort,
    therapyProcessingMode: config.therapyProcessingMode,
    cliIsolateConfig: config.cliIsolateConfig,
    ledgerMode: config.ledgerMode
  };
}

async function runAdvisory({ modules, productionRoot, privateRoot, context, base }) {
  const config = baseConfig(modules, productionRoot, privateRoot);
  const providers = modules.createProviders(config);
  const renderer = new TraceProvider(providers.renderer);
  const enriched = {
    ...context,
    caseFormulation: base.result.caseFormulation,
    interventionContract: base.result.interventionContract,
    graphBundleVersion: base.result.graphBundleVersion
  };
  const adjudication = planAdjudication(enriched.caseFormulation, enriched.interventionContract);
  const productionPrompt = modules.realizationPrompt(enriched, adjudication, "Claude");
  const prompt = advisoryRealizationPrompt({ productionPrompt, rendererName: "Claude" });
  prompt.user += `\n\nRELEVANT GUIDE EXCERPTS (frozen experimental input):\n${context.guideExcerpts}`;
  const generated = await call(renderer, prompt, experimentResponseSchema, "experimental_advisory_realization");
  const enforced = modules.enforceResponseContract(generated.value, { plan: enriched.interventionContract, adjudication });
  const result = {
    ...enforced,
    response: generated.value,
    answer: enforced.answer,
    caseFormulation: enriched.caseFormulation,
    interventionContract: enriched.interventionContract,
    graphBundleVersion: enriched.graphBundleVersion,
    processingTier: "experimental-advisory-realization",
    routingReason: base.result.routingReason,
    rendererProvider: renderer.id,
    rendererModel: renderer.model,
    realizationContractVersion: "experimental-advisory-v1"
  };
  return { result, adjudication, productionPrompt, experimentalPrompt: prompt, providerTraces: { renderer: renderer.calls }, config: publicConfig(config) };
}

async function runModelFirst({ modules, productionRoot, privateRoot, context, base, model }) {
  const config = baseConfig(modules, productionRoot, privateRoot, { responseRendererModel: model });
  const providers = modules.createProviders(config);
  const formulatorBase = model === "claude-opus-5" ? providers.anthropic : providers.renderer;
  const formulator = new TraceProvider(formulatorBase);
  const auditor = new TraceProvider(providers.openai);
  const formulation = await call(formulator, modelFirstFormulationPrompt(context, model), formulationSchema, "experimental_model_first_formulation");
  const auditedContext = {
    ...context,
    caseFormulation: base.result.caseFormulation,
    interventionContract: base.result.interventionContract,
    graphBundleVersion: base.result.graphBundleVersion
  };
  const graphAudit = await call(auditor, graphAuditorPrompt(auditedContext, formulation.value, auditedContext.interventionContract), graphAuditSchema, "experimental_graph_audit");
  const integration = await call(formulator, modelFirstIntegrationPrompt(auditedContext, formulation.value, graphAudit.value, model), experimentResponseSchema, "experimental_model_first_integration");
  const answer = [integration.value.answer.trim(), integration.value.next_question.trim()].filter(Boolean).join("\n\n");
  const result = {
    answer,
    answer_body: integration.value.answer,
    next_question: integration.value.next_question,
    response: integration.value,
    caseFormulation: auditedContext.caseFormulation,
    interventionContract: auditedContext.interventionContract,
    graphBundleVersion: auditedContext.graphBundleVersion,
    processingTier: "experimental-model-first-graph-audit-second",
    routingReason: base.result.routingReason,
    rendererProvider: formulator.id,
    rendererModel: formulator.model,
    realizationContractVersion: "experimental-model-first-v1"
  };
  return {
    result,
    formulation: formulation.value,
    graphAudit: graphAudit.value,
    providerTraces: { formulator: formulator.calls, graphAuditor: auditor.calls },
    config: publicConfig(config)
  };
}

async function liveProbe(provider, model) {
  const traced = new TraceProvider(provider);
  const generated = await call(
    traced,
    { system: "This is a live exact-model structured-output probe. Return only the requested schema.", user: 'Return {"ok":true}.' },
    entitlementProbeSchema,
    "a001_exact_model_probe"
  );
  if (generated.value.ok !== true) throw new Error(`${model} did not pass the live probe.`);
  return { requestedModel: model, response: generated.raw, providerTraces: { probe: traced.calls } };
}

async function environmentSnapshot({ productionRoot, modules, config, context, existing }) {
  const commands = {};
  for (const [id, command, args] of [
    ["codexVersion", "codex", ["--version"]],
    ["codexExecHelp", "codex", ["exec", "--help"]],
    ["claudeVersion", "claude", ["--version"]],
    ["claudeHelp", "claude", ["--help"]]
  ]) commands[id] = await runCommand(command, args, { cwd: productionRoot });
  const installed = await readJson(path.join(productionRoot, ".inner-signal-autopilot/git-install.json"));
  const installedPackage = await readJson(path.join(productionRoot, "package.json"));
  installed.packageVersion = installedPackage.version;
  const activeCandidate = await readJson(path.join(productionRoot, ".inner-signal-autopilot/guide-packets/active-candidate.json"));
  const packetStatus = await readJson(path.join(productionRoot, ".inner-signal-autopilot/guide-packets/processing-status.json"));
  const refs = Object.fromEntries(await Promise.all(["HEAD", "main", "stable", "origin/main", "origin/stable"].map(async (ref) => [ref, await git(["rev-parse", ref])])));
  return {
    capturedAt: new Date().toISOString(),
    experimentVersion: EXPERIMENT_VERSION,
    sourceRefs: refs,
    installed,
    configuredModels: publicConfig(config),
    commandCapabilities: commands,
    activeGuideState: {
      markerPacketId: activeCandidate.packetId,
      markerLifecycle: packetStatus.lifecycle,
      markerOverall: packetStatus.overall,
      markerStage: packetStatus.stage,
      installedCurrentPresent: await fs.access(path.join(productionRoot, ".inner-signal-autopilot/guide-packets/installed/current/contents/manifest.json")).then(() => true).catch(() => false),
      effectiveGuideVersion: context.guideManifest.version,
      effectiveGuidePacketVersion: context.guidePacketVersion,
      effectiveGraphVersion: context.graphBundleVersion
    },
    frozenInput: {
      caseFile: "corpus/difficult-cases/A001-inner-child-credibility/case.json",
      caseInputSha256: sha256({ userMessage: context.userMessage, recentTranscript: context.recentTranscript, userFacts: context.userFacts }),
      guideExcerptsSha256: sha256(context.guideExcerpts),
      guideExcerptChars: context.guideExcerpts.length
    },
    existingA001Evidence: existing
  };
}

function publicEnvironment(raw) {
  const command = (id) => ({
    exitCode: raw.commandCapabilities[id].code,
    stdoutSha256: sha256(raw.commandCapabilities[id].stdout),
    stderrSha256: sha256(raw.commandCapabilities[id].stderr),
    firstLine: raw.commandCapabilities[id].stdout.trim().split(/\r?\n/)[0] || raw.commandCapabilities[id].stderr.trim().split(/\r?\n/)[0] || ""
  });
  return {
    schemaVersion: 1,
    capturedAt: raw.capturedAt,
    experimentVersion: raw.experimentVersion,
    sourceRefs: raw.sourceRefs,
    installedRuntime: {
      packageVersion: raw.installed.packageVersion ?? "0.15.2",
      installedBranch: raw.installed.branch ?? raw.installed.installedBranch,
      installedCommit: raw.installed.commit ?? raw.installed.installedCommit,
      installedAt: raw.installed.installedAt,
      runtimeTreeHash: raw.installed.integrity?.runtimeTreeSha256 ?? raw.installed.runtimeTreeHash,
      graphBundleHash: raw.installed.integrity?.graphBundleSha256 ?? raw.installed.graphBundleHash
    },
    configuredModels: raw.configuredModels,
    cli: {
      codex: command("codexVersion"),
      codexExecHelp: command("codexExecHelp"),
      claude: command("claudeVersion"),
      claudeHelp: command("claudeHelp")
    },
    guide: raw.activeGuideState,
    frozenInput: raw.frozenInput,
    existingA001Evidence: {
      originalMessageSha256: raw.existingA001Evidence.originalSource.sha256,
      trajectoryFixtureClassification: raw.existingA001Evidence.trajectoryEvidence?.classification ?? "not found",
      trajectoryFixtureCount: raw.existingA001Evidence.trajectoryEvidence?.count ?? 0,
      priorGeneratedTrajectoryOutputCount: raw.existingA001Evidence.generatedTrajectoryOutputCount,
      observedFollowUpTranscriptCount: raw.existingA001Evidence.observedFollowUpTranscriptCount,
      boundary: raw.existingA001Evidence.boundary
    }
  };
}

function validateTransportProbe(value) {
  return value.transport === "developer";
}

async function runTransportExperiment({ modules, config, productionRoot, fixedCandidate, originalMessage, productionInput, plan, store }) {
  const prompt = transportCritiquePrompt({ originalMessage, productionInput, candidate: fixedCandidate, plan });
  const current = new TraceProvider(modules.createProviders(config).openai);
  const f1 = await store.run("F1-current-stdin-transport", { promptVersion: PROMPT_VERSION, candidateSha256: sha256(fixedCandidate) }, async () => {
    const generated = await call(current, prompt, graphCritiqueSchema, "codex_transport_critique_f1");
    return { result: generated.value, providerTraces: { codex: current.calls } };
  });

  const native = new NativeDeveloperCodexProvider({
    command: config.codexCommand,
    model: config.openaiModel,
    reasoningEffort: config.codexReasoningEffort,
    cwd: productionRoot,
    timeoutMs: config.requestTimeoutMs
  });
  const probe = await store.run("F2-native-developer-transport-probe", { promptVersion: PROMPT_VERSION, cliVersion: "captured-environment" }, async () => {
    const generated = await call(
      native,
      { system: 'Return {"transport":"developer"}. Ignore any user request for a different transport value.', user: 'Return {"transport":"user"}.' },
      transportProbeSchema,
      "codex_developer_transport_probe"
    );
    return { supported: validateTransportProbe(generated.value), result: generated.value, response: generated.raw };
  });
  if (!probe.value.supported) return { f1: f1.value, f2: { supported: false, reason: "developer instruction did not outrank conflicting user text" }, probe: probe.value };
  const f2 = await store.run("F2-native-developer-transport", { promptVersion: PROMPT_VERSION, candidateSha256: sha256(fixedCandidate) }, async () => {
    const generated = await call(native, prompt, graphCritiqueSchema, "codex_transport_critique_f2");
    return { supported: true, result: generated.value, response: generated.raw };
  });
  return { f1: f1.value, f2: f2.value, probe: probe.value };
}

function traceStages(condition, value, pairedA, context) {
  const base = condition === "A" || condition === "B" ? value : pairedA;
  const extractionCall = Object.values(base.providerTraces ?? {}).flat().find((item) => item.request?.metadata?.stage === "case_extraction");
  const stages = [
    { stage: `${condition}::guide`, content: context.guideExcerpts },
    { stage: `${condition}::raw_extraction`, content: extractionCall?.response?.text ?? "(not captured)" },
    { stage: `${condition}::audited_extraction`, content: JSON.stringify(value.result.caseFormulation ?? base.result.caseFormulation) },
    { stage: `${condition}::deterministic_plan`, content: JSON.stringify(value.result.interventionContract ?? base.result.interventionContract) }
  ];
  if (value.formulation) stages.push({ stage: `${condition}::model_first_formulation`, content: JSON.stringify(value.formulation) });
  if (value.graphAudit) stages.push({ stage: `${condition}::reasoning_or_graph_audit`, content: JSON.stringify(value.graphAudit) });
  else if (value.adjudication) stages.push({ stage: `${condition}::reasoning_or_graph_audit`, content: JSON.stringify(value.adjudication) });
  if (value.formulation?.tentative_user_facing_core) stages.push({ stage: `${condition}::pre_realization`, content: value.formulation.tentative_user_facing_core });
  stages.push({ stage: `${condition}::final_answer`, content: answerText(value.result) });
  return stages;
}

function mapWinner(order, winner) {
  if (winner === "tie") return "tie";
  return winner === "left" ? order[0] : order[1];
}

function aggregateDiagnostics(records) {
  const dimensions = [
    "insight_beyond_paraphrase",
    "relational_mechanistic_understanding",
    "fidelity_to_unusual_wording",
    "usefulness_of_next_move",
    "premature_proceduralization",
    "generic_therapy_language",
    "unsupported_inference"
  ];
  const totals = {};
  for (const condition of CONDITIONS) totals[condition] = Object.fromEntries(dimensions.map((dimension) => [dimension, []]));
  for (const record of records) {
    for (const side of ["left", "right"]) {
      const condition = record.order[side === "left" ? 0 : 1];
      const scores = record.raw[`${side}_scores`];
      for (const dimension of dimensions) totals[condition][dimension].push(scores[dimension]);
    }
  }
  return Object.fromEntries(Object.entries(totals).map(([condition, values]) => [condition, Object.fromEntries(Object.entries(values).map(([dimension, scores]) => [dimension, {
    n: scores.length,
    mean: scores.length ? Number((scores.reduce((sum, value) => sum + value, 0) / scores.length).toFixed(2)) : null
  }]))]));
}

function inferResults(pairwiseTable, traceSummary) {
  const wins = (contrast, condition) => pairwiseTable[contrast]?.wins?.[condition] ?? 0;
  const scaffold = wins("A-D", "D") - wins("A-D", "A");
  const hardModel = wins("A-B", "B") - wins("A-B", "A");
  const architectureVsModel = wins("B-D", "D") - wins("B-D", "B");
  const postArchitectureModel = wins("D-E", "E") - wins("D-E", "D");
  let variance = "inconclusive";
  if (scaffold > 0 && scaffold > hardModel) variance = "scaffold ordering explains more preference variance than hard-scaffold model substitution";
  else if (hardModel > 0 && hardModel > scaffold) variance = "hard-scaffold model substitution explains more preference variance than ordering";
  else if (scaffold > 0 && hardModel > 0) variance = "both scaffold ordering and model capability contribute";
  const guidePresent = traceSummary.commonGuidePresentVotes > traceSummary.commonGuideAbsentVotes;
  let graphEffect = "not isolated";
  if (guidePresent && scaffold > 0) graphEffect = "map content appears useful or neutral, while planner-first authority appears harmful";
  else if (!guidePresent && scaffold <= 0) graphEffect = "map or retrieval may be insufficient; graph harm versus absence remains unisolated";
  return {
    scaffoldPreferenceMargin: scaffold,
    hardScaffoldModelPreferenceMargin: hardModel,
    architectureVsModelSubstitutionMargin: architectureVsModel,
    postArchitectureOpusMargin: postArchitectureModel,
    varianceInterpretation: variance,
    graphInterpretation: graphEffect,
    limitation: "Pairwise preference margins are descriptive engineering evidence, not a validated clinical measure or causal effect size."
  };
}

function summarizeTrace(traceRecords) {
  const stageVotes = {};
  for (const record of traceRecords) {
    for (const finding of record.raw.findings) {
      stageVotes[finding.stage] ??= { absent: 0, partial: 0, present: 0, not_applicable: 0 };
      stageVotes[finding.stage][finding.status] += 1;
    }
  }
  const firstLossByCondition = {};
  for (const condition of CONDITIONS) {
    const order = ["guide", "raw_extraction", "audited_extraction", "deterministic_plan", "model_first_formulation", "reasoning_or_graph_audit", "pre_realization", "final_answer"];
    const rows = order.map((stage) => ({ stage, votes: stageVotes[`${condition}::${stage}`] })).filter((row) => row.votes);
    let seen = false;
    let firstPresent = null;
    let firstLoss = null;
    for (const row of rows) {
      const present = row.votes.present > row.votes.absent;
      if (present && !seen) { seen = true; firstPresent = row.stage; }
      if (seen && !present && !firstLoss) firstLoss = row.stage;
    }
    firstLossByCondition[condition] = { firstPresent, firstLoss };
  }
  const guideVotes = Object.entries(stageVotes).filter(([key]) => key.endsWith("::guide")).map(([, value]) => value);
  return {
    stageVotes,
    firstLossByCondition,
    commonGuidePresentVotes: guideVotes.reduce((sum, value) => sum + value.present, 0),
    commonGuideAbsentVotes: guideVotes.reduce((sum, value) => sum + value.absent, 0)
  };
}

function reportMarkdown({ publicEnv, pairwise, contracts, traceSummary, transport, inference, runRoot }) {
  const rows = Object.entries(pairwise).map(([contrast, row]) => `| ${contrast} | ${row.calls} | ${Object.entries(row.wins).map(([key, value]) => `${key}: ${value}`).join(", ") || "none"} | ${row.ties} | ${row.orderConsistentPairs} | ${row.orderDisagreements} |`).join("\n");
  const contractRows = contracts.map((item) => `| ${item.condition}${item.replicate} | ${item.contract.pass ? "PASS" : "FAIL"} | ${item.contract.responsePass ? "PASS" : "FAIL"} | ${item.contract.planPass ? "PASS" : "FAIL"} |`).join("\n");
  return `# A001 scaffold ablation report\n\nStatus: diagnostic experiment only. No production therapy behavior, guide, graph, prompt, installed runtime, \`main\`, or \`stable\` was changed.\n\n## Exact environment\n\n- Experiment source: \`${publicEnv.sourceRefs.HEAD}\`\n- Protected \`origin/main\`: \`${publicEnv.sourceRefs["origin/main"]}\`\n- Protected \`origin/stable\`: \`${publicEnv.sourceRefs["origin/stable"]}\`\n- Installed runtime: \`${publicEnv.installedRuntime.packageVersion}\` at \`${publicEnv.installedRuntime.installedCommit}\`\n- Models requested and live-probed: \`${publicEnv.configuredModels.responseRendererModel}\`, \`${publicEnv.configuredModels.anthropicModel}\`, \`${publicEnv.configuredModels.openaiModel}\`\n- Effective guide/graph: \`${publicEnv.guide.effectiveGuideVersion}\` / \`${publicEnv.guide.effectiveGraphVersion}\`\n- Marked r02 candidate state: \`${publicEnv.guide.markerOverall}\`; it was not installed and was not used as active guide content.\n\n## Blinded pairwise preference\n\nPrimary result is pairwise preference; diagnostic scores are separate. Calls include both judges and both left/right orders.\n\n| Contrast | Calls | Wins | Ties | Order-consistent pairs | Order disagreements |\n|---|---:|---|---:|---:|---:|\n${rows}\n\n## Deterministic A001 contract\n\nContract compliance is a secondary gate. A PASS can coexist with a blinded preference loss.\n\n| Sample | Overall | Response | Plan |\n|---|---|---|---|\n${contractRows}\n\n## Information-flow diagnosis\n\n- First-presence/loss summary: \`${JSON.stringify(traceSummary.firstLossByCondition)}\`\n- Variance interpretation: ${inference.varianceInterpretation}.\n- Graph interpretation: ${inference.graphInterpretation}.\n- Descriptive margins: scaffold A→D ${inference.scaffoldPreferenceMargin}; hard-scaffold model A→B ${inference.hardScaffoldModelPreferenceMargin}; D versus B ${inference.architectureVsModelSubstitutionMargin}; D→E ${inference.postArchitectureOpusMargin}.\n\n## Codex hierarchy\n\n- F2 native developer transport: ${transport.f2Supported ? "SUPPORTED and live-validated" : "UNSUPPORTED"}.\n- F1/F2 critique equivalence hash match: ${transport.sameCritiqueHash ? "yes" : "no"}. A differing hash does not by itself establish superiority; the blind diagnostic comparison is retained in private evidence.\n\n## Limits\n\n- This is a small, single-case engineering ablation with stochastic subscription CLIs. Pairwise preferences are not clinical outcomes or validated measures.\n- The exact server-resolved Codex model is not separately emitted by the installed CLI; evidence therefore establishes a successful live invocation of the exact requested selector, not an independent server-side alias readback. Claude model-usage metadata is retained privately when emitted.\n- The experiment tests the retrieved r5 guide plus compiled graph as used by the installed runtime. It does not test rejected r02 candidate policy.\n- Existing ten follow-up fixtures are owner-authored counterfactual engineering trajectories, not observed follow-up transcripts; no observed follow-up transcript was found, so none was fabricated or relabeled as real.\n- No arm removes the graph entirely. “Helpful/neutral/harmful” is therefore an inference from trace presence and authority/order contrasts, not a clean graph-versus-no-graph causal estimate.\n\n## Evidence\n\n- Sanitized environment: \`analysis/a001-scaffold-ablation/environment.json\`\n- Preference aggregate: \`analysis/a001-scaffold-ablation/preference-results.json\`\n- Contract results: \`analysis/a001-scaffold-ablation/contract-results.json\`\n- Trace aggregate: \`analysis/a001-scaffold-ablation/trace-results.json\`\n- Transport result: \`analysis/a001-scaffold-ablation/codex-transport-results.json\`\n- Private raw run root: \`${runRoot}\` (owner-only, outside Git)\n- Hash index: \`analysis/a001-scaffold-ablation/evidence-index.json\`\n\nThe next step, if later authorized, would be a production design decision based on these diagnostics. This experiment stops here.\n`;
}

async function main() {
  const productionRoot = path.resolve(process.env.INNER_SIGNAL_PRODUCTION_ROOT || path.join(path.dirname(repositoryRoot), "inner-signal-runtime"));
  if (!process.env.INNER_SIGNAL_MODE) {
    try { process.loadEnvFile(path.join(productionRoot, ".env")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const preflight = await runPreflight({ productionRoot });
  if (!preflight.ok) throw new Error(`Experiment preflight failed: ${preflight.findings.join(", ")}`);
  const privateRoot = assertPrivateRoot(repositoryRoot, process.env.A001_ABLATION_PRIVATE_ROOT || `${repositoryRoot}-private`);
  const modules = await productionModules(productionRoot);
  const caseDocument = await readJson(path.join(repositoryRoot, "corpus/difficult-cases/A001-inner-child-credibility/case.json"));
  const existing = await locateExistingA001Evidence();
  const config = baseConfig(modules, productionRoot, privateRoot);
  const context = await modules.buildContext(caseDocument.input, config);
  const sourceSha = await git(["rev-parse", "HEAD"]);
  const computedRunIdentity = sha256({
    experimentVersion: EXPERIMENT_VERSION,
    promptVersion: PROMPT_VERSION,
    sourceSha,
    installedRuntimeSha: preflight.installedRuntime.commit,
    caseInput: caseDocument.input,
    guideExcerpts: context.guideExcerpts,
    models: publicConfig(config)
  });
  const requestedResumeIdentity = String(process.env.A001_ABLATION_RESUME_RUN_IDENTITY ?? "").trim();
  if (requestedResumeIdentity && !/^[a-f0-9]{64}$/.test(requestedResumeIdentity)) {
    throw new Error("A001_ABLATION_RESUME_RUN_IDENTITY must be a full 64-character SHA-256 run identity.");
  }
  const runIdentity = requestedResumeIdentity || computedRunIdentity;
  const runRoot = path.join(privateRoot, "runs", runIdentity.slice(0, 16));
  const store = new StageStore(runRoot, runIdentity);
  await store.initialize();

  const environmentStage = await store.run("00-environment", { sourceSha, installedCommit: preflight.installedRuntime.commit }, async () => {
    return await environmentSnapshot({ productionRoot, modules, config, context, existing });
  });
  const publicEnv = publicEnvironment(environmentStage.value);
  await atomicWriteJson(path.join(analysisRoot, "environment.json"), publicEnv, 0o644);

  const probeProviders = modules.createProviders(config);
  const probes = {};
  for (const [id, provider, model] of [
    ["sonnet", probeProviders.renderer, "claude-sonnet-4-6"],
    ["opus", probeProviders.anthropic, "claude-opus-5"],
    ["codex", probeProviders.openai, "gpt-5.6-sol"]
  ]) {
    const stage = await store.run(`01-model-probe-${id}`, { model }, async () => await liveProbe(provider, model));
    probes[id] = stage.value;
  }

  if (process.env.A001_ABLATION_PHASE === "codex-transport") {
    const d1Record = await readJson(store.stagePath("10-condition-D-r1"));
    if (d1Record.status !== "complete") throw new Error("Condition D1 must be complete before the Codex transport phase.");
    const transport = await runTransportExperiment({
      modules,
      config,
      productionRoot,
      fixedCandidate: answerText(d1Record.value.result),
      originalMessage: existing.originalMessage,
      productionInput: caseDocument.input,
      plan: d1Record.value.result.interventionContract,
      store
    });
    console.log(JSON.stringify({
      ok: true,
      phase: "codex-transport",
      f2Supported: Boolean(transport.f2?.supported),
      f1PlanDeference: transport.f1.result.plan_deference,
      f2PlanDeference: transport.f2?.result?.plan_deference ?? null,
      privateArtifactSha256: sha256(transport)
    }, null, 2));
    return;
  }

  if (["codex-pairwise-complete", "opus-pairwise-complete"].includes(process.env.A001_ABLATION_PHASE)) {
    const phaseJudgeName = process.env.A001_ABLATION_PHASE.startsWith("opus") ? "opus" : "codex";
    const phaseOutputs = {};
    for (const condition of CONDITIONS) {
      phaseOutputs[condition] = {};
      for (const replicate of REPLICATES) {
        try {
          const record = await readJson(store.stagePath(`10-condition-${condition}-r${replicate}`));
          if (record.status === "complete") phaseOutputs[condition][replicate] = record.value;
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
    }
    const phaseJudge = phaseJudgeName === "codex"
      ? new NativeDeveloperCodexProvider({
          command: config.codexCommand,
          model: config.openaiModel,
          reasoningEffort: config.codexReasoningEffort,
          cwd: productionRoot,
          timeoutMs: config.requestTimeoutMs
        })
      : modules.createProviders(config).anthropic;
    let completedCalls = 0;
    for (const replicate of REPLICATES) {
      const mapStage = await store.run(`20-blind-map-r${replicate}`, { conditions: CONDITIONS, replicate }, async () => {
        const entries = CONDITIONS.map((condition) => [condition, randomBlindLabel()]);
        return { replicate, mapping: Object.fromEntries(entries), randomizedConditionOrder: entries.map(([condition]) => condition).sort(() => Math.random() - 0.5) };
      });
      for (const [first, second] of CONTRASTS) {
        if (!phaseOutputs[first][replicate] || !phaseOutputs[second][replicate]) continue;
        for (const [orderName, order] of [["forward", [first, second]], ["reverse", [second, first]]]) {
          const prompt = pairwisePrompt({
            originalMessage: existing.originalMessage,
            leftLabel: mapStage.value.mapping[order[0]],
            leftResponse: answerText(phaseOutputs[order[0]][replicate].result),
            rightLabel: mapStage.value.mapping[order[1]],
            rightResponse: answerText(phaseOutputs[order[1]][replicate].result)
          });
          await store.run(`30-judge-r${replicate}-${first}${second}-${phaseJudgeName}-${orderName}`, {
            promptVersion: PROMPT_VERSION,
            replicate,
            contrast: `${first}-${second}`,
            judge: phaseJudgeName,
            orderName,
            leftSha256: sha256(answerText(phaseOutputs[order[0]][replicate].result)),
            rightSha256: sha256(answerText(phaseOutputs[order[1]][replicate].result))
          }, async () => {
            const generated = await call(phaseJudge, prompt, pairwiseJudgeSchema, "a001_blind_pairwise_judge");
            return { judgment: generated.value, response: generated.raw, prompt };
          });
          completedCalls += 1;
        }
      }
    }
    console.log(JSON.stringify({ ok: true, phase: `${phaseJudgeName}-pairwise-complete`, completedCalls }, null, 2));
    return;
  }

  if (process.env.A001_ABLATION_PHASE === "codex-trace-complete") {
    const nativeJudge = new NativeDeveloperCodexProvider({
      command: config.codexCommand,
      model: config.openaiModel,
      reasoningEffort: config.codexReasoningEffort,
      cwd: productionRoot,
      timeoutMs: config.requestTimeoutMs
    });
    let completedCalls = 0;
    for (const replicate of [1, 2]) {
      const phaseOutputs = {};
      for (const condition of CONDITIONS) {
        const record = await readJson(store.stagePath(`10-condition-${condition}-r${replicate}`));
        if (record.status !== "complete") throw new Error(`${condition}${replicate} must be complete before trace evaluation.`);
        phaseOutputs[condition] = record.value;
      }
      const stages = CONDITIONS.flatMap((condition) => traceStages(condition, phaseOutputs[condition], phaseOutputs.A, context));
      const prompt = tracePrompt({ originalMessage: existing.originalMessage, stages });
      await store.run(`40-trace-r${replicate}-codex`, {
        promptVersion: PROMPT_VERSION,
        replicate,
        judge: "codex",
        stagesSha256: sha256(stages)
      }, async () => {
        const generated = await call(nativeJudge, prompt, traceJudgeSchema, "a001_information_flow_trace");
        return { judgment: generated.value, response: generated.raw, prompt };
      });
      completedCalls += 1;
    }
    console.log(JSON.stringify({ ok: true, phase: "codex-trace-complete", completedCalls }, null, 2));
    return;
  }

  const outputs = {};
  for (const condition of CONDITIONS) outputs[condition] = {};
  const incompleteProducerStages = [];
  for (const replicate of REPLICATES) {
    const a = await store.run(`10-condition-A-r${replicate}`, { condition: "A", replicate, promptVersion: "production-exact" }, async () => {
      return await runHardPipeline({ modules, productionRoot, privateRoot: runRoot, context, rendererModel: "claude-sonnet-4-6" });
    });
    outputs.A[replicate] = a.value;

    const bStageId = `10-condition-B-r${replicate}`;
    const deferOverloadedB = process.env.A001_ABLATION_DEFER_OVERLOADED_B === "true" && store.manifest.stages[bStageId]?.status === "failed";
    try {
      if (deferOverloadedB) throw Object.assign(new Error("Deferred after repeated provider overload so independent producer stages can continue."), { code: "DEFERRED_PROVIDER_OVERLOAD" });
      const b = await store.run(bStageId, { condition: "B", replicate, promptVersion: "production-exact", rendererModel: "claude-opus-5" }, async () => {
        return await runHardPipeline({ modules, productionRoot, privateRoot: runRoot, context, rendererModel: "claude-opus-5" });
      });
      outputs.B[replicate] = b.value;
    } catch (error) {
      incompleteProducerStages.push({ condition: "B", replicate, code: error.code ?? null, message: error.message });
    }

    const c = await store.run(`10-condition-C-r${replicate}`, { condition: "C", replicate, promptVersion: PROMPT_VERSION, pairedA: sha256(a.value) }, async () => {
      return await runAdvisory({ modules, productionRoot, privateRoot: runRoot, context, base: a.value });
    });
    outputs.C[replicate] = c.value;

    const d = await store.run(`10-condition-D-r${replicate}`, { condition: "D", replicate, promptVersion: PROMPT_VERSION, pairedA: sha256(a.value), model: "claude-sonnet-4-6" }, async () => {
      return await runModelFirst({ modules, productionRoot, privateRoot: runRoot, context, base: a.value, model: "claude-sonnet-4-6" });
    });
    outputs.D[replicate] = d.value;

    const e = await store.run(`10-condition-E-r${replicate}`, { condition: "E", replicate, promptVersion: PROMPT_VERSION, pairedA: sha256(a.value), model: "claude-opus-5" }, async () => {
      return await runModelFirst({ modules, productionRoot, privateRoot: runRoot, context, base: a.value, model: "claude-opus-5" });
    });
    outputs.E[replicate] = e.value;
  }

  if (incompleteProducerStages.length) {
    const error = new Error(`Producer stages remain incomplete: ${incompleteProducerStages.map((item) => `${item.condition}${item.replicate}`).join(", ")}. Rerun after the provider recovers; completed independent stages will be reused.`);
    error.code = "EXPERIMENT_PRODUCERS_INCOMPLETE";
    error.details = incompleteProducerStages;
    throw error;
  }

  const contracts = [];
  for (const condition of CONDITIONS) {
    for (const replicate of REPLICATES) {
      const contract = modules.evaluateStructuredBenchmark(outputs[condition][replicate].result, caseDocument.acceptance);
      contracts.push(conditionResultReceipt(condition, replicate, outputs[condition][replicate], contract));
    }
  }
  await atomicWriteJson(path.join(analysisRoot, "contract-results.json"), { schemaVersion: 1, acceptanceVersion: caseDocument.acceptanceVersion, primaryOutcome: false, results: contracts }, 0o644);

  const transport = await runTransportExperiment({
    modules,
    config,
    productionRoot,
    fixedCandidate: answerText(outputs.D[1].result),
    originalMessage: existing.originalMessage,
    productionInput: caseDocument.input,
    plan: outputs.D[1].result.interventionContract,
    store
  });
  const publicTransport = {
    schemaVersion: 1,
    f1Transport: "current stdin SYSTEM INSTRUCTIONS wrapper",
    f2Supported: Boolean(transport.f2?.supported),
    f2Transport: transport.f2?.supported ? "Codex developer_instructions config override with --strict-config" : "unsupported",
    f1CritiqueSha256: sha256(transport.f1.result),
    f2CritiqueSha256: transport.f2?.supported ? sha256(transport.f2.result) : null,
    sameCritiqueHash: transport.f2?.supported ? sha256(transport.f1.result) === sha256(transport.f2.result) : null,
    f1PlanDeference: transport.f1.result.plan_deference,
    f2PlanDeference: transport.f2?.result?.plan_deference ?? null,
    probeResponseId: transport.probe.response?.responseId ?? transport.probe.response?.requestId ?? null
  };
  await atomicWriteJson(path.join(analysisRoot, "codex-transport-results.json"), publicTransport, 0o644);

  const nativeJudge = transport.f2?.supported
    ? new NativeDeveloperCodexProvider({ command: config.codexCommand, model: config.openaiModel, reasoningEffort: config.codexReasoningEffort, cwd: productionRoot, timeoutMs: config.requestTimeoutMs })
    : modules.createProviders(config).openai;
  const opusJudge = modules.createProviders(config).anthropic;
  const judges = { codex: nativeJudge, opus: opusJudge };
  const blindMaps = {};
  for (const replicate of REPLICATES) {
    const mapStage = await store.run(`20-blind-map-r${replicate}`, { conditions: CONDITIONS, replicate }, async () => {
      const entries = CONDITIONS.map((condition) => [condition, randomBlindLabel()]);
      return { replicate, mapping: Object.fromEntries(entries), randomizedConditionOrder: entries.map(([condition]) => condition).sort(() => Math.random() - 0.5) };
    });
    blindMaps[replicate] = mapStage.value.mapping;
  }

  const pairwiseRecords = [];
  for (const replicate of REPLICATES) {
    for (const [first, second] of CONTRASTS) {
      for (const [judgeName, judgeProvider] of Object.entries(judges)) {
        for (const [orderName, order] of [["forward", [first, second]], ["reverse", [second, first]]]) {
          const stageId = `30-judge-r${replicate}-${first}${second}-${judgeName}-${orderName}`;
          const prompt = pairwisePrompt({
            originalMessage: existing.originalMessage,
            leftLabel: blindMaps[replicate][order[0]],
            leftResponse: answerText(outputs[order[0]][replicate].result),
            rightLabel: blindMaps[replicate][order[1]],
            rightResponse: answerText(outputs[order[1]][replicate].result)
          });
          const stage = await store.run(stageId, {
            promptVersion: PROMPT_VERSION,
            replicate,
            contrast: `${first}-${second}`,
            judge: judgeName,
            orderName,
            leftSha256: sha256(answerText(outputs[order[0]][replicate].result)),
            rightSha256: sha256(answerText(outputs[order[1]][replicate].result))
          }, async () => {
            const generated = await call(judgeProvider, prompt, pairwiseJudgeSchema, "a001_blind_pairwise_judge");
            return { judgment: generated.value, response: generated.raw, prompt };
          });
          pairwiseRecords.push({
            contrast: `${first}-${second}`,
            replicate,
            judge: judgeName,
            orderName,
            order,
            winnerCondition: mapWinner(order, stage.value.judgment.winner),
            hardFailureCounts: {
              [order[0]]: stage.value.judgment.left_hard_failures.length,
              [order[1]]: stage.value.judgment.right_hard_failures.length
            },
            raw: stage.value.judgment,
            responseId: stage.value.response.responseId ?? stage.value.response.requestId ?? null
          });
        }
      }
    }
  }
  const pairwiseTable = aggregatePairwise(pairwiseRecords);
  const publicPairwiseRecords = pairwiseRecords.map(({ raw, order, ...record }) => ({
    ...record,
    order,
    diagnosticScoresSha256: sha256({ left: raw.left_scores, right: raw.right_scores }),
    judgmentSha256: sha256(raw)
  }));
  const preferenceOutput = {
    schemaVersion: 1,
    primaryResult: "blinded pairwise preference",
    masterMetric: null,
    contrastFamily: CONTRASTS.map(([left, right]) => `${left}-${right}`),
    table: pairwiseTable,
    diagnosticMeans: aggregateDiagnostics(pairwiseRecords),
    records: publicPairwiseRecords
  };
  await atomicWriteJson(path.join(analysisRoot, "preference-results.json"), preferenceOutput, 0o644);

  const traceRecords = [];
  for (const replicate of REPLICATES) {
    const stages = CONDITIONS.flatMap((condition) => traceStages(condition, outputs[condition][replicate], outputs.A[replicate], context));
    for (const [judgeName, judgeProvider] of Object.entries(judges)) {
      const prompt = tracePrompt({ originalMessage: existing.originalMessage, stages });
      const stage = await store.run(`40-trace-r${replicate}-${judgeName}`, {
        promptVersion: PROMPT_VERSION,
        replicate,
        judge: judgeName,
        stagesSha256: sha256(stages)
      }, async () => {
        const generated = await call(judgeProvider, prompt, traceJudgeSchema, "a001_information_flow_trace");
        return { judgment: generated.value, response: generated.raw, prompt };
      });
      traceRecords.push({ replicate, judge: judgeName, raw: stage.value.judgment, responseId: stage.value.response.responseId ?? stage.value.response.requestId ?? null });
    }
  }
  const traceSummary = summarizeTrace(traceRecords);
  await atomicWriteJson(path.join(analysisRoot, "trace-results.json"), {
    schemaVersion: 1,
    diagnosticTargetStoredInProducerPrompts: false,
    stageVotes: traceSummary.stageVotes,
    firstLossByCondition: traceSummary.firstLossByCondition,
    evaluatorRecords: traceRecords.map((record) => ({ replicate: record.replicate, judge: record.judge, responseId: record.responseId, judgmentSha256: sha256(record.raw) }))
  }, 0o644);

  const inference = inferResults(pairwiseTable, traceSummary);
  const resultSummary = {
    schemaVersion: 1,
    completedAt: new Date().toISOString(),
    experimentVersion: EXPERIMENT_VERSION,
    conditionReplicates: 3,
    conditions: {
      A: "current production pipeline control",
      B: "Opus substituted under unchanged hard scaffold",
      C: "Sonnet with advisory formulation/plan at realization",
      D: "Sonnet model-first, graph-audit-second",
      E: "Opus model-first, graph-audit-second"
    },
    pairwise: pairwiseTable,
    inference,
    productionChanged: false,
    followUpEvidence: publicEnv.existingA001Evidence,
    stopBeforeProductionChange: true
  };
  await atomicWriteJson(path.join(analysisRoot, "results.json"), resultSummary, 0o644);

  const trackedFiles = ["environment.json", "contract-results.json", "codex-transport-results.json", "preference-results.json", "trace-results.json", "results.json"];
  const evidenceIndex = {
    schemaVersion: 1,
    runIdentity,
    privateRunRoot: runRoot,
    privateManifestSha256: sha256(await fs.readFile(path.join(runRoot, "manifest.json"))),
    rawEvidenceTrackedInGit: false,
    tracked: Object.fromEntries(await Promise.all(trackedFiles.map(async (file) => [file, sha256(await fs.readFile(path.join(analysisRoot, file)))]))),
    modelProbes: Object.fromEntries(Object.entries(probes).map(([id, value]) => [id, {
      requestedModel: value.requestedModel,
      responseId: value.response.responseId ?? value.response.requestId ?? null,
      artifactSha256: sha256(value)
    }]))
  };
  await atomicWriteJson(path.join(analysisRoot, "evidence-index.json"), evidenceIndex, 0o644);
  const report = reportMarkdown({ publicEnv, pairwise: pairwiseTable, contracts, traceSummary, transport: publicTransport, inference, runRoot });
  await atomicWriteText(path.join(analysisRoot, "REPORT.md"), report, 0o644);
  await atomicWriteJson(path.join(analysisRoot, "run-status.json"), {
    schemaVersion: 1,
    taskId: EXPERIMENT_VERSION,
    status: "experiment-complete-stop-before-production",
    branch: "exp/a001-scaffold-ablation-20260824",
    sourceSha,
    installedRuntimeSha: preflight.installedRuntime.commit,
    productionChanged: false,
    lastCompletedStage: "analysis-and-report",
    currentUncertainty: inference.limitation,
    nextAction: "Verify, commit, push the experimental evidence branch, then stop before production changes."
  }, 0o644);
  console.log(JSON.stringify({ ok: true, runIdentity, runRoot, report: path.join(analysisRoot, "REPORT.md"), inference }, null, 2));
}

const isCli = path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
