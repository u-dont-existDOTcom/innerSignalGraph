import fs from "node:fs/promises";
import path from "node:path";
import { createCandidateWorkspace, candidateChanges, manifestHash, sourceManifest, sourceTreeHash } from "./workspace.mjs";
import { DEV_ENGINE_REVISION } from "./engine.mjs";
import { DEV_FAILURE } from "./failure-classification.mjs";

async function readJson(filePath) {
  try { return JSON.parse(await fs.readFile(filePath, "utf8")); } catch { return null; }
}

async function exists(filePath) {
  try { await fs.access(filePath); return true; } catch { return false; }
}

function safeRevision(value) {
  return String(value || "engine").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80);
}

function timeoutLikeState(state = {}) {
  const text = `${state.blocker || ""}\n${state.lastFailure?.message || ""}`;
  return state.failureClass === DEV_FAILURE.REVIEW_TIMEOUT || /review.*timed out|timed out.*review|Codex.*timed out/i.test(text);
}

async function loadCycleArtifacts(config, jobId, cycle) {
  const jobDir = path.join(config.devJobRoot, jobId);
  return {
    gates: await readJson(path.join(jobDir, `cycle-${cycle}-gates.json`)),
    review: await readJson(path.join(jobDir, `cycle-${cycle}-review.json`)),
    implementer: await readJson(path.join(jobDir, `cycle-${cycle}-implementer.json`)),
    liveRegression: await readJson(path.join(jobDir, `cycle-${cycle}-live-regression.json`))
  };
}

async function currentCandidateValid({ sourceRoot, candidateRoot, state }) {
  if (!(await exists(candidateRoot))) return false;
  const baselineMeta = await readJson(path.join(candidateRoot, ".inner-signal-dev", "BASELINE_MANIFEST.json"));
  if (!baselineMeta?.files) return false;
  const currentHash = await sourceTreeHash(sourceRoot);
  const baselineHash = manifestHash(baselineMeta.files);
  if (state?.baselineHash && state.baselineHash !== baselineHash) return false;
  if (currentHash !== baselineHash) return false;
  if (state?.candidateHash) {
    const actualCandidateHash = await sourceTreeHash(candidateRoot);
    if (actualCandidateHash !== state.candidateHash) return false;
  }
  return true;
}

async function rebaseOlderCandidate({ config, sourceRoot, jobId, cycle, oldCandidateRoot, implementer }) {
  if (!(await exists(oldCandidateRoot))) return null;
  const oldBaselineMeta = await readJson(path.join(oldCandidateRoot, ".inner-signal-dev", "BASELINE_MANIFEST.json"));
  const changedFiles = Array.isArray(implementer?.changed_files) ? implementer.changed_files : [];
  if (!oldBaselineMeta?.files || !changedFiles.length) return null;
  const currentManifest = await sourceManifest(sourceRoot);
  for (const file of changedFiles) {
    const oldBase = oldBaselineMeta.files[file] ?? null;
    const current = currentManifest[file] ?? null;
    if (oldBase !== current) return null;
  }
  const candidateRoot = path.join(config.devCandidateRoot, `${jobId}-recovered-${safeRevision(DEV_ENGINE_REVISION)}`);
  const workspace = await createCandidateWorkspace({ sourceRoot, candidateRoot, jobId });
  for (const file of changedFiles) {
    const src = path.join(oldCandidateRoot, file);
    const dst = path.join(candidateRoot, file);
    if (await exists(src)) {
      await fs.mkdir(path.dirname(dst), { recursive: true });
      await fs.copyFile(src, dst);
    } else {
      await fs.rm(dst, { recursive: true, force: true });
    }
  }
  const changeInfo = await candidateChanges(candidateRoot, workspace.baseline);
  return {
    recovered: true,
    rebasedFrom: oldCandidateRoot,
    candidateRoot,
    workspace,
    changeInfo,
    baselineHash: manifestHash(workspace.baseline),
    candidateHash: manifestHash(changeInfo.after),
    cycle
  };
}

export async function loadResumableRoadmapCandidate({ config, sourceRoot, taskId, priorTaskState }) {
  if (!priorTaskState?.candidateRoot) return null;
  const jobId = priorTaskState.jobId || `roadmap-${taskId}`;
  const cycle = Number(priorTaskState.cycle || 1);
  const artifacts = await loadCycleArtifacts(config, jobId, cycle);
  const gates = priorTaskState.gates ?? artifacts.gates;
  const review = priorTaskState.review ?? artifacts.review;
  const implementer = artifacts.implementer;
  let phase = priorTaskState.status === "live-regression-pending"
    ? "LIVE_REGRESSION"
    : (priorTaskState.status === "review-pending" || timeoutLikeState(priorTaskState))
      ? "INDEPENDENT_REVIEW"
      : null;
  if (!phase && gates?.ok && review?.verdict === "approve" && review?.promotion_safe !== false) phase = "LIVE_REGRESSION";
  else if (!phase && gates?.ok && ["verifying", "reviewing"].includes(priorTaskState.status)) phase = "INDEPENDENT_REVIEW";
  if (!phase || !gates?.ok) return null;

  if (priorTaskState.engineRevision === DEV_ENGINE_REVISION && await currentCandidateValid({ sourceRoot, candidateRoot: priorTaskState.candidateRoot, state: priorTaskState })) {
    const changeInfo = await candidateChanges(priorTaskState.candidateRoot, (await readJson(path.join(priorTaskState.candidateRoot, ".inner-signal-dev", "BASELINE_MANIFEST.json"))).files);
    return {
      recovered: true,
      rebasedFrom: null,
      phase,
      candidateRoot: priorTaskState.candidateRoot,
      gates,
      review,
      changeInfo,
      baselineHash: priorTaskState.baselineHash ?? null,
      candidateHash: priorTaskState.candidateHash ?? manifestHash(changeInfo.after),
      cycle
    };
  }

  if (priorTaskState.engineRevision !== DEV_ENGINE_REVISION) {
    const rebased = await rebaseOlderCandidate({ config, sourceRoot, jobId, cycle, oldCandidateRoot: priorTaskState.candidateRoot, implementer });
    if (!rebased) return null;
    return { ...rebased, phase: "DETERMINISTIC_VERIFY", gates: null, review: null };
  }
  return null;
}
