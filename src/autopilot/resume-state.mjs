import fs from "node:fs/promises";
import path from "node:path";
import { evaluateStructuredBenchmark } from "./benchmark-acceptance.mjs";
import { planFromGraphs } from "../guide-graph/planner.mjs";

export const CHECKPOINT_VERSION = "inner-signal-checkpoints-v6";
export const H001_PIPELINE_REVISION = "hypnosis-compiler-v1";
export const A001_PIPELINE_REVISION = "tiered-therapy-v6-realization-v4";
export const PRIOR_A001_PIPELINE_REVISION = "formulated-therapy-v5-realization-v3";

// Compatible prior bundles use the same byte-pinned guide sources and hypnosis
// compiler. H001 may therefore be reused, while pre-realization A001 reasoning
// is migrated by running only the new response-realization stage.
const COMPATIBLE_PRIOR_GUIDE_VERSIONS = new Set([
  "inner-child-somatic-pilot-2026-08-06-r1",
  "inner-child-somatic-pilot-2026-08-09-r2",
  "inner-child-somatic-pilot-2026-08-09-r4"
]);

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

function sameModel(a, b) {
  return String(a ?? "").trim() === String(b ?? "").trim();
}

function modelsMatch(selectedModels, expectedModels) {
  const base = sameModel(selectedModels?.openai, expectedModels?.openai)
    && sameModel(selectedModels?.anthropicPrimary, expectedModels?.anthropicPrimary);
  if (!base) return false;
  // Pre-realization checkpoints did not record a renderer. They may be imported
  // once for a realization-only upgrade. New checkpoints pin the exact renderer.
  if (!selectedModels?.anthropicRenderer) return true;
  return sameModel(selectedModels.anthropicRenderer, expectedModels?.anthropicRenderer);
}

function guideVersionCompatible(resultVersion, currentVersion) {
  return resultVersion === currentVersion || COMPATIBLE_PRIOR_GUIDE_VERSIONS.has(resultVersion);
}

function validH001Result(wrapper, guideVersion) {
  const result = wrapper?.result ?? wrapper;
  return Boolean(
    (wrapper?.ok ?? result?.releaseable)
    && result?.releaseable === true
    && result?.status === "releaseable"
    && result?.contractVersion === "hypnosis-components-v1"
    && guideVersionCompatible(result?.guideVersion, guideVersion)
  );
}

function replanA001Result(result, graphs, guideVersion) {
  if (!result?.caseFormulation?.variables || !Array.isArray(graphs) || graphs.length === 0) return result;
  const plan = planFromGraphs({
    variables: result.caseFormulation.variables,
    unknowns: result.caseFormulation.unknowns ?? [],
    graphs
  });
  return {
    ...result,
    migratedFromGuideVersion: result.guideVersion === guideVersion ? null : result.guideVersion,
    guideVersion,
    graphBundleVersion: plan.graphBundleVersion,
    interventionContract: plan
  };
}

function validA001Result(wrapper, definition, guideVersion, graphs) {
  const raw = wrapper?.result ?? wrapper;
  if (!raw || !guideVersionCompatible(raw.guideVersion, guideVersion)) return null;
  const result = replanA001Result(raw, graphs, guideVersion);
  const acceptance = evaluateStructuredBenchmark(result, definition.acceptance);
  if (!acceptance.ok) return null;
  return { result, acceptance, escalated: Boolean(wrapper?.escalated) };
}

export async function loadCheckpointCache({ stateDir, selectedModels, guideVersion, a001Definition, graphs = [] }) {
  const cache = await readJson(path.join(stateDir, "resume-cache.json"));
  if (!cache || ![CHECKPOINT_VERSION, "inner-signal-checkpoints-v5", "inner-signal-checkpoints-v4", "inner-signal-checkpoints-v3", "inner-signal-checkpoints-v2"].includes(cache.version)) return null;
  if (!modelsMatch(cache.selectedModels, selectedModels)) return null;
  if (!guideVersionCompatible(cache.guideVersion, guideVersion)) return null;

  const H001 = cache.H001?.pipelineRevision === H001_PIPELINE_REVISION
    && validH001Result(cache.H001, guideVersion)
    ? cache.H001
    : null;

  const currentAcceptanceVersion = a001Definition.acceptanceVersion ?? "legacy";
  const a001Valid = cache.A001?.pipelineRevision === A001_PIPELINE_REVISION
    && cache.A001?.acceptanceVersion === currentAcceptanceVersion
    ? validA001Result(cache.A001, a001Definition, guideVersion, graphs)
    : null;
  let A001 = a001Valid ? { ...cache.A001, ...a001Valid } : null;

  // v0.9.2 can preserve compatible prior formulation/adversarial reasoning
  // and run only the new realization stage. The old final prose is NOT accepted
  // as the new benchmark result; it is carried forward only as an adjudication
  // packet to be re-rendered under response-realization-v4.
  if (!A001 && cache.A001?.pipelineRevision === PRIOR_A001_PIPELINE_REVISION) {
    const raw = cache.A001?.result ?? cache.A001;
    if (raw?.caseFormulation?.variables && guideVersionCompatible(raw.guideVersion, guideVersion)) {
      const migrated = replanA001Result(raw, graphs, guideVersion);
      A001 = {
        ...cache.A001,
        result: migrated,
        needsRealizationUpgrade: true,
        priorPipelineRevision: PRIOR_A001_PIPELINE_REVISION
      };
    }
  }

  if (!H001 && !A001) return null;
  return { source: "resume-cache", H001, A001 };
}

/**
 * Imports the immediately preceding blocked A001 run and replays only the
 * deterministic planning layer against the current graph.  This is deliberately
 * bounded to a compatible source-pinned guide version and exact model pair.
 * It lets a substantively cautious prior answer survive a benchmark-contract fix
 * without repeating expensive model calls.
 */
export async function loadLegacyA001BlockedRun({ stateDir, selectedModels, guideVersion, a001Definition, graphs = [] }) {
  const latest = await readJson(path.join(stateDir, "latest.json"));
  if (!latest || latest.stage !== "A001-adversarial-therapy-benchmark" || !latest.runDir) return null;

  const resolution = await readJson(path.join(latest.runDir, "model-resolution.json"));
  const priorModels = {
    openai: resolution?.selected?.openai,
    anthropicPrimary: resolution?.selected?.anthropic
  };
  if (!modelsMatch(priorModels, selectedModels)) return null;

  const h001Wrapper = await readJson(path.join(latest.runDir, "H001-autopilot-result.json"));
  const a001Wrapper = await readJson(path.join(latest.runDir, "A001-autopilot-result.json"));
  if (!validH001Result(h001Wrapper, guideVersion)) return null;
  const a001Valid = validA001Result(a001Wrapper, a001Definition, guideVersion, graphs);

  return {
    source: "legacy-a001-blocked-run-replanned",
    sourceRunDir: latest.runDir,
    H001: {
      pipelineRevision: H001_PIPELINE_REVISION,
      ok: true,
      result: h001Wrapper.result,
      attempts: h001Wrapper.attempts ?? [],
      escalated: Boolean(h001Wrapper.escalated)
    },
    A001: a001Wrapper?.result?.caseFormulation?.variables ? {
      pipelineRevision: PRIOR_A001_PIPELINE_REVISION,
      acceptanceVersion: a001Wrapper.acceptanceVersion ?? "legacy",
      ok: true,
      result: replanA001Result(a001Wrapper.result, graphs, guideVersion),
      acceptance: a001Wrapper.acceptance ?? null,
      escalated: Boolean(a001Wrapper.escalated),
      needsRealizationUpgrade: true
    } : null
  };
}

export async function writeCheckpointCache({ stateDir, selectedModels, guideVersion, H001, A001 }) {
  const body = {
    version: CHECKPOINT_VERSION,
    updatedAt: new Date().toISOString(),
    selectedModels,
    guideVersion,
    H001: H001 ? {
      pipelineRevision: H001_PIPELINE_REVISION,
      ok: true,
      result: H001.result ?? H001,
      attempts: H001.attempts ?? [],
      escalated: Boolean(H001.escalated)
    } : null,
    A001: A001 ? {
      pipelineRevision: A001_PIPELINE_REVISION,
      acceptanceVersion: A001.acceptanceVersion ?? "legacy",
      ok: true,
      result: A001.result ?? A001,
      acceptance: A001.acceptance,
      escalated: Boolean(A001.escalated)
    } : null
  };
  await fs.mkdir(stateDir, { recursive: true });
  const tmp = path.join(stateDir, `.resume-cache-${process.pid}.tmp`);
  const target = path.join(stateDir, "resume-cache.json");
  await fs.writeFile(tmp, `${JSON.stringify(body, null, 2)}\n`);
  await fs.rename(tmp, target);
  return target;
}
