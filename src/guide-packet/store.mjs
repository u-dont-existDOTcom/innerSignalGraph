import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { createStoredZip, readZipEntries } from "../core/zip.mjs";
import { canonicalJson, safePacketId } from "./contract.mjs";
import { verifyGuidePacket } from "./verifier.mjs";
import { writeGuidePacketProcessingStatus } from "./stage-lifecycle.mjs";

function rootFor(config) {
  return config.guidePacketRoot ?? path.join(config.autopilotStateDir, "guide-packets");
}

function sha256(data) { return createHash("sha256").update(data).digest("hex"); }

async function atomicWrite(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  const body = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === "string" ? value : canonicalJson(value));
  await fs.writeFile(tmp, body);
  await fs.rename(tmp, file);
}

async function readJson(file, fallback = null) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); } catch (error) { if (error.code === "ENOENT") return fallback; throw error; }
}

async function installedManifest(config) {
  return readJson(path.join(rootFor(config), "installed/current/contents/manifest.json"), null);
}


async function buildSourceDiff(config, candidateManifest, installed, candidateSourceMaps = {}) {
  let baselineType = "installed-packet";
  let baselineGuides = installed?.guides ?? [];
  if (!installed) {
    baselineType = "bundled-guides";
    const bundled = await readJson(config.guideManifestPath, { sources: [] });
    baselineGuides = (bundled.sources ?? []).map((item) => ({
      id: item.id === "inner-child-guide" ? "inner-child" : item.id === "somatic-sequencing-guide" ? "somatic" : item.id,
      revision: item.version ?? "bundled",
      sourceSha256: item.sha256 ?? null
    }));
  }
  const baselineBundle = await installedBundle(config);
  const normalizeGuideId = (id) => id === "inner-child-guide" ? "inner-child" : id === "somatic-sequencing-guide" ? "somatic" : id;
  const baselineMaps = new Map((baselineBundle?.sourceMaps ?? []).map((item) => [normalizeGuideId(item.guideId), item]));
  const priorById = new Map(baselineGuides.map((item) => [item.id, item]));
  const normalizeExcerpt = (value) => String(value ?? "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().slice(0, 280);
  const sectionDiff = (guideId) => {
    const current = baselineMaps.get(guideId) ?? null;
    const candidate = candidateSourceMaps[guideId] ?? null;
    if (!candidate) return { comparisonMode: "unavailable", added: [], removed: [], changed: [], unchangedCount: 0 };
    const exact = Boolean(current?.sourceSha256 && current?.sections?.some((item) => item.rawHtmlSha256 || item.textSha256));
    const currentById = new Map((current?.sections ?? []).map((item) => [item.id, item]));
    const candidateById = new Map((candidate.sections ?? []).map((item) => [item.id, item]));
    const added = [];
    const changed = [];
    let unchangedCount = 0;
    for (const item of candidate.sections ?? []) {
      const prior = currentById.get(item.id);
      if (!prior) { added.push({ id: item.id, heading: item.heading }); continue; }
      const differs = exact
        ? (item.rawHtmlSha256 ?? item.textSha256 ?? "") !== (prior.rawHtmlSha256 ?? prior.textSha256 ?? prior.sha256 ?? "")
        : normalizeExcerpt(item.excerpt) !== normalizeExcerpt(prior.excerpt);
      if (differs) changed.push({ id: item.id, heading: item.heading, currentHeading: prior.heading ?? item.heading });
      else unchangedCount += 1;
    }
    const removed = [...currentById.values()].filter((item) => !candidateById.has(item.id)).map((item) => ({ id: item.id, heading: item.heading }));
    return { comparisonMode: exact ? "exact-source-map" : "cross-format-section-summary", added, removed, changed, unchangedCount };
  };
  return {
    contractVersion: "guide-source-diff-v2",
    baselineType,
    guides: (candidateManifest.guides ?? []).map((guide) => {
      const prior = priorById.get(guide.id) ?? null;
      return {
        id: guide.id,
        currentRevision: prior?.revision ?? "none",
        currentSourceSha256: prior?.sourceSha256 ?? null,
        candidateRevision: guide.revision,
        candidateSourceSha256: guide.sourceSha256,
        candidateEditorBodySha256: guide.editorBodySha256,
        changed: !prior || prior.sourceSha256 !== guide.sourceSha256 || prior.revision !== guide.revision,
        sectionDiff: sectionDiff(guide.id)
      };
    })
  };
}

async function installedBundle(config) {
  const active = path.join(rootFor(config), "installed/current/contents/graphs/bundle.json");
  try { return JSON.parse(await fs.readFile(active, "utf8")); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    try { return JSON.parse(await fs.readFile(config.guideGraphBundlePath, "utf8")); }
    catch { return null; }
  }
}

function packetWithDecisions(original, state, { approved = false } = {}) {
  const entries = readZipEntries(original);
  const manifest = JSON.parse(entries.get("manifest.json").toString("utf8"));
  const decisions = JSON.parse(entries.get("audit/owner-decisions.json").toString("utf8"));
  decisions.cards = state.decisionCards;
  decisions.allApproved = approved;
  decisions.status = approved ? "approved" : "awaiting-owner";
  decisions.decidedAt = state.updatedAt;
  manifest.status = approved ? "approved" : "candidate";
  manifest.candidateOnly = !approved;
  manifest.approvalRequired = !approved;
  if (approved) {
    manifest.approvedAt = state.updatedAt;
    manifest.approvalDecisionHash = sha256(Buffer.from(canonicalJson(decisions)));
  }
  entries.set("manifest.json", Buffer.from(canonicalJson(manifest)));
  entries.set("audit/owner-decisions.json", Buffer.from(canonicalJson(decisions)));
  if (state.compilation) entries.set("audit/source-role-compilation.json", Buffer.from(canonicalJson(state.compilation)));
  if (state.independentReview) entries.set("audit/independent-review.json", Buffer.from(canonicalJson(state.independentReview)));
  entries.delete("SHA256SUMS.txt");
  const lines = [...entries.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, data]) => `${sha256(data)}  ${name}`).join("\n") + "\n";
  entries.set("SHA256SUMS.txt", Buffer.from(lines));
  return createStoredZip([...entries.entries()].map(([name, data]) => ({ name, data })), new Date(state.updatedAt));
}

export async function updateGuidePacketProcessingStatus(config, patch = {}) {
  return await writeGuidePacketProcessingStatus(config, patch);
}

export async function stageGuidePacket(config, buffer, { updateProcessingStatus = true } = {}) {
  const storeRoot = rootFor(config);
  await fs.mkdir(storeRoot, { recursive: true });
  const installed = await installedManifest(config);
  const result = verifyGuidePacket(buffer, { installedRevision: installed?.packetRevision ?? 0, installedBundle: await installedBundle(config) });
  if (!result.ok) throw new Error(`Guide packet verification failed: ${result.errors.join("; ")}`);
  const packetId = safePacketId(result.manifest.packetId);
  const candidateDir = path.join(storeRoot, "candidates", packetId);
  await fs.rm(candidateDir, { recursive: true, force: true });
  await fs.mkdir(candidateDir, { recursive: true });
  await fs.writeFile(path.join(candidateDir, "original.zip"), buffer);
  const now = new Date().toISOString();
  const state = {
    packetId,
    packetVersion: result.manifest.packetVersion,
    packetRevision: result.manifest.packetRevision,
    packetSha256: result.packetSha256,
    status: result.decisionCards.some((card) => card.requiresHumanDecision) ? "awaiting-owner" : "staged",
    stagedAt: now,
    updatedAt: now,
    verification: { ok: true, warnings: result.warnings, qualityCounts: result.qualityAudit.counts, regressionCounts: { total: result.regressionStatus.count, passed: result.regressionStatus.passed, failed: result.regressionStatus.failed } },
    regressionStatus: result.regressionStatus,
    decisionCards: result.decisionCards.map((card) => ({ ...card, status: "pending", ownerNote: "" })),
    allApproved: false,
    affectedCases: result.behavioralDiff.affectedCases,
    behavioralDiff: result.behavioralDiff,
    qualityAudit: result.qualityAudit,
    sourceDiff: await buildSourceDiff(config, result.manifest, installed, result.sourceMapsByGuide)
  };
  await atomicWrite(path.join(candidateDir, "state.json"), state);
  await atomicWrite(path.join(storeRoot, "active-candidate.json"), { packetId });
  if (updateProcessingStatus) {
    await updateGuidePacketProcessingStatus(config, {
      active: false,
      lifecycle: state.status === "awaiting-owner" ? "waiting_for_owner" : "completed",
      overall: state.status === "awaiting-owner" ? "WAITING_FOR_HUMAN" : "COMPLETE",
      stageId: "candidate-staged",
      packetId,
      model: "none-deterministic",
      blocker: state.status === "awaiting-owner" ? "Substantive guide decisions require owner approval." : "",
      failureClass: state.status === "awaiting-owner" ? "OWNER_DECISION_REQUIRED" : null,
      recoveryAction: "",
      expectedNextStage: state.status === "awaiting-owner" ? "owner-decision" : null,
      nextExpectedGate: state.status === "awaiting-owner" ? "owner-decision" : null,
      nextAutomaticAction: state.status === "awaiting-owner" ? "ASK_HUMAN" : "AUTO_STAGE",
      humanActionRequired: state.status === "awaiting-owner",
      updatedAt: now
    });
  }
  return state;
}

function decisionContract(card) {
  const { status, ownerNote, decidedAt, ...contract } = card ?? {};
  return canonicalJson(contract);
}

export async function carryForwardGuidePacketDecisions(config, { fromCandidateId, toCandidateId }) {
  const storeRoot = rootFor(config);
  const fromId = safePacketId(fromCandidateId);
  const toId = safePacketId(toCandidateId);
  if (fromId === toId) return await readJson(path.join(storeRoot, "candidates", toId, "state.json"), null);
  const source = await readJson(path.join(storeRoot, "candidates", fromId, "state.json"), null);
  const targetFile = path.join(storeRoot, "candidates", toId, "state.json");
  const target = await readJson(targetFile, null);
  if (!source || !target) throw new Error("Guide packet decision carry-forward requires both source and target candidates.");

  const sourceById = new Map((source.decisionCards ?? []).map((card) => [card.id, card]));
  let carried = 0;
  for (const card of target.decisionCards ?? []) {
    const prior = sourceById.get(card.id);
    if (!prior || !["approve", "keep-current", "edit"].includes(prior.status)) continue;
    if (decisionContract(prior) !== decisionContract(card)) continue;
    card.status = prior.status;
    card.ownerNote = prior.ownerNote ?? "";
    if (prior.decidedAt) card.decidedAt = prior.decidedAt;
    carried += 1;
  }
  target.allApproved = target.decisionCards.length > 0 && target.decisionCards.every((card) => card.status === "approve");
  target.status = target.allApproved
    ? "approved"
    : target.decisionCards.some((card) => card.status === "pending" || card.status === "edit")
      ? "awaiting-owner"
      : "kept-current";
  target.decisionCarryForward = {
    fromPacketId: fromId,
    carriedCount: carried,
    preservedSourceCandidate: true,
    carriedAt: new Date().toISOString()
  };
  await atomicWrite(targetFile, target);
  return target;
}

export async function readGuidePacketStatus(config) {
  const storeRoot = rootFor(config);
  const active = await readJson(path.join(storeRoot, "active-candidate.json"), null);
  const candidate = active?.packetId ? await readJson(path.join(storeRoot, "candidates", active.packetId, "state.json"), null) : null;
  const installed = await installedManifest(config);
  const history = await readJson(path.join(storeRoot, "history.json"), []);
  const process = await readJson(path.join(storeRoot, "processing-status.json"), { active: false, overall: "IDLE", stage: "none", humanActionRequired: false });
  return { installed, candidate, history, process };
}

export async function applyGuidePacketCompilation(config, candidateId, compilation, { updateProcessingStatus = true } = {}) {
  const storeRoot = rootFor(config);
  const packetId = safePacketId(candidateId);
  const stateFile = path.join(storeRoot, "candidates", packetId, "state.json");
  const state = await readJson(stateFile, null);
  if (!state) throw new Error("Guide packet candidate was not found.");
  state.compilation = compilation;
  state.updatedAt = compilation.compiledAt ?? new Date().toISOString();
  state.status = compilation.status === "blocked" ? "compilation-blocked" : "compilation-complete";
  await atomicWrite(stateFile, state);
  if (updateProcessingStatus) {
    await updateGuidePacketProcessingStatus(config, {
      active: false,
      lifecycle: compilation.status === "blocked" ? "blocked" : "completed",
      overall: compilation.status === "blocked" ? "BLOCKED_AUTO_RECOVERY" : "COMPLETE",
      stageId: compilation.status === "blocked" ? "opus-compilation-blocked" : "opus-compilation-complete",
      packetId,
      model: compilation.compiler?.model ?? "claude-opus-5",
      blocker: compilation.status === "blocked" ? compilation.report?.summary ?? "Opus compilation blocked the candidate." : "",
      failureClass: compilation.status === "blocked" ? "REVIEW_REJECTION" : null,
      recoveryAction: compilation.status === "blocked" ? "repair-compilation-from-staged-candidate" : "",
      expectedNextStage: compilation.status === "blocked" ? "opus-source-role-compilation" : "codex-independent-audit",
      nextExpectedGate: compilation.status === "blocked" ? "opus-source-role-compilation" : "codex-independent-audit",
      nextAutomaticAction: compilation.status === "blocked" ? "AUTO_REPAIR" : "AUTO_CONTINUE",
      humanActionRequired: false,
      updatedAt: state.updatedAt
    });
  }
  return state;
}

export async function applyGuidePacketReviewProgress(config, candidateId, stage, progress) {
  const storeRoot = rootFor(config);
  const packetId = safePacketId(candidateId);
  const stateFile = path.join(storeRoot, "candidates", packetId, "state.json");
  const state = await readJson(stateFile, null);
  if (!state) throw new Error("Guide packet candidate was not found.");
  const key = stage === "fable-adjudication" ? "fable" : "codex";
  state.reviewProgress = {
    ...(state.reviewProgress ?? {}),
    [key]: progress
  };
  state.status = "review-in-progress";
  state.updatedAt = progress.completedAt ?? new Date().toISOString();
  await atomicWrite(stateFile, state);
  return state;
}

export async function applyGuidePacketReview(config, candidateId, review, { updateProcessingStatus = true } = {}) {
  const storeRoot = rootFor(config);
  const packetId = safePacketId(candidateId);
  const stateFile = path.join(storeRoot, "candidates", packetId, "state.json");
  const state = await readJson(stateFile, null);
  if (!state) throw new Error("Guide packet candidate was not found.");
  state.independentReview = review;
  state.updatedAt = review.reviewedAt ?? new Date().toISOString();
  if (review.status === "rejected") state.status = "review-rejected";
  else if (review.status === "review-pending") state.status = "review-pending";
  else state.status = state.decisionCards.some((card) => card.requiresHumanDecision) ? "awaiting-owner" : "staged";
  await atomicWrite(stateFile, state);
  const waiting = state.status === "awaiting-owner";
  const rejected = state.status === "review-rejected";
  if (updateProcessingStatus) {
    await updateGuidePacketProcessingStatus(config, {
      active: false,
      lifecycle: rejected || state.status === "review-pending" ? "blocked" : waiting ? "waiting_for_owner" : "completed",
      overall: rejected || state.status === "review-pending" ? "BLOCKED_AUTO_RECOVERY" : waiting ? "WAITING_FOR_HUMAN" : "COMPLETE",
      stageId: rejected ? "independent-review-rejected" : state.status === "review-pending" ? "independent-review-pending" : "independent-review-complete",
      packetId,
      model: review.escalation?.model ?? review.reviewer?.model ?? "gpt-5.6-sol",
      blocker: rejected ? (review.finalAudit?.summary ?? "Independent review rejected the packet.") : state.status === "review-pending" ? "Independent review needs unresolved adjudication." : waiting ? "Substantive guide decisions require owner approval." : "",
      failureClass: rejected ? "REVIEW_REJECTION" : state.status === "review-pending" ? "MODEL_UNAVAILABLE" : waiting ? "OWNER_DECISION_REQUIRED" : null,
      recoveryAction: rejected ? "repair-reviewed-candidate" : state.status === "review-pending" ? "resume-independent-review" : "",
      expectedNextStage: rejected || state.status === "review-pending" ? "codex-independent-audit" : waiting ? "owner-decision" : null,
      nextExpectedGate: rejected || state.status === "review-pending" ? "codex-independent-audit" : waiting ? "owner-decision" : null,
      nextAutomaticAction: rejected || state.status === "review-pending" ? "AUTO_REPAIR" : waiting ? "ASK_HUMAN" : "AUTO_STAGE",
      humanActionRequired: waiting,
      updatedAt: state.updatedAt
    });
  }
  return state;
}

export async function recordGuidePacketDecision(config, { candidateId, cardId, decision, note = "" }) {
  if (!['approve', 'keep-current', 'edit'].includes(decision)) throw new Error("Guide decision must be approve, keep-current, or edit.");
  const storeRoot = rootFor(config);
  const packetId = safePacketId(candidateId);
  const stateFile = path.join(storeRoot, "candidates", packetId, "state.json");
  const state = await readJson(stateFile, null);
  if (!state) throw new Error("Guide packet candidate was not found.");
  if (state.independentReview && state.independentReview.status !== "reviewed") {
    throw new Error("Guide packet independent review is not complete or rejected; owner approval is blocked.");
  }
  if (["cli", "api"].includes(config.mode) && !state.independentReview) {
    throw new Error("Guide packet independent review must complete before owner approval in live mode.");
  }
  const card = state.decisionCards.find((item) => item.id === cardId);
  if (!card) throw new Error("Guide decision card was not found.");
  card.status = decision;
  card.ownerNote = String(note ?? "").trim();
  card.decidedAt = new Date().toISOString();
  state.updatedAt = card.decidedAt;
  state.allApproved = state.decisionCards.length > 0 && state.decisionCards.every((item) => item.status === "approve");
  state.status = state.allApproved ? "approved" : state.decisionCards.some((item) => item.status === "pending" || item.status === "edit") ? "awaiting-owner" : "kept-current";
  if (state.allApproved) {
    const original = await fs.readFile(path.join(storeRoot, "candidates", packetId, "original.zip"));
    const approved = packetWithDecisions(original, state, { approved: true });
    await fs.writeFile(path.join(storeRoot, "candidates", packetId, "approved.zip"), approved);
    state.approvedPacketSha256 = sha256(approved);
  }
  await atomicWrite(stateFile, state);
  await updateGuidePacketProcessingStatus(config, {
    active: false,
    lifecycle: state.allApproved ? "completed" : "waiting_for_owner",
    overall: state.allApproved ? "COMPLETE" : "WAITING_FOR_HUMAN",
    stageId: state.allApproved ? "owner-approved" : "owner-decision",
    packetId,
    model: "none-deterministic",
    blocker: state.allApproved ? "" : "Owner decisions remain unresolved.",
    failureClass: state.allApproved ? null : "OWNER_DECISION_REQUIRED",
    recoveryAction: "",
    expectedNextStage: state.allApproved ? "atomic-install" : "owner-decision",
    nextExpectedGate: state.allApproved ? "atomic-install" : "owner-decision",
    nextAutomaticAction: state.allApproved ? "INSTALL_READY" : "ASK_HUMAN",
    humanActionRequired: !state.allApproved,
    updatedAt: state.updatedAt
  });
  return state;
}

async function materializePacketDirectory(buffer, target) {
  const entries = readZipEntries(buffer);
  await fs.mkdir(path.join(target, "contents"), { recursive: true });
  await fs.writeFile(path.join(target, "packet.zip"), buffer);
  for (const [name, data] of entries) {
    const file = path.join(target, "contents", name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, data);
  }
}

export async function installApprovedGuidePacket(config, candidateId) {
  const storeRoot = rootFor(config);
  const packetId = safePacketId(candidateId);
  const candidateDir = path.join(storeRoot, "candidates", packetId);
  const state = await readJson(path.join(candidateDir, "state.json"), null);
  if (!state?.allApproved) throw new Error("Guide packet is not owner-approved; pending decision cards must be resolved first.");
  if (["cli", "api"].includes(config.mode) && state.independentReview?.status !== "reviewed") {
    throw new Error("Guide packet independent review must pass before installation in live mode.");
  }
  const approvedFile = path.join(candidateDir, "approved.zip");
  const buffer = await fs.readFile(approvedFile);
  const installed = await installedManifest(config);
  const verified = verifyGuidePacket(buffer, { installedRevision: installed?.packetRevision ?? 0, installedBundle: await installedBundle(config), mode: "install" });
  if (!verified.ok || !verified.installable) throw new Error(`Approved guide packet cannot install: ${verified.errors.join("; ") || "same or older packet is not newer"}`);

  const installedRoot = path.join(storeRoot, "installed");
  const current = path.join(installedRoot, "current");
  const temp = path.join(installedRoot, `.install-${randomUUID()}`);
  const rollbackRoot = path.join(storeRoot, "rollback");
  await fs.mkdir(installedRoot, { recursive: true });
  await fs.mkdir(rollbackRoot, { recursive: true });
  await materializePacketDirectory(buffer, temp);
  let rollbackPath = null;
  try {
    try {
      await fs.access(current);
      rollbackPath = path.join(rollbackRoot, `${new Date().toISOString().replace(/[:.]/g, "-")}-${installed?.packetId ?? "legacy"}`);
      await fs.rename(current, rollbackPath);
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    await fs.rename(temp, current);
  } catch (error) {
    await fs.rm(temp, { recursive: true, force: true });
    if (rollbackPath) {
      try { await fs.rename(rollbackPath, current); } catch {}
    }
    throw error;
  }

  const history = await readJson(path.join(storeRoot, "history.json"), []);
  history.unshift({ action: "install", packetId, packetVersion: verified.manifest.packetVersion, packetRevision: verified.manifest.packetRevision, packetSha256: sha256(buffer), installedAt: new Date().toISOString(), rollbackPath: rollbackPath ? path.basename(rollbackPath) : null });
  await atomicWrite(path.join(storeRoot, "history.json"), history.slice(0, 100));
  state.status = "installed";
  state.installedAt = history[0].installedAt;
  await atomicWrite(path.join(candidateDir, "state.json"), state);
  await updateGuidePacketProcessingStatus(config, { active: false, lifecycle: "completed", overall: "COMPLETE", stageId: "installed", packetId, model: "none-deterministic", blocker: "", failureClass: null, recoveryAction: "", expectedNextStage: null, nextExpectedGate: null, nextAutomaticAction: "NONE", humanActionRequired: false, updatedAt: history[0].installedAt });
  return { manifest: verified.manifest, packetBuffer: buffer, historyEntry: history[0] };
}

export async function rollbackGuidePacket(config) {
  const storeRoot = rootFor(config);
  const rollbackRoot = path.join(storeRoot, "rollback");
  let names;
  try { names = (await fs.readdir(rollbackRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse(); }
  catch (error) { if (error.code === "ENOENT") names = []; else throw error; }
  if (!names.length) throw new Error("No validated guide packet rollback is available.");
  const current = path.join(storeRoot, "installed/current");
  const selected = path.join(rollbackRoot, names[0]);
  const displaced = path.join(rollbackRoot, `${new Date().toISOString().replace(/[:.]/g, "-")}-displaced-current`);
  await fs.rename(current, displaced);
  try { await fs.rename(selected, current); }
  catch (error) { await fs.rename(displaced, current); throw error; }
  const manifest = await readJson(path.join(current, "contents/manifest.json"));
  const history = await readJson(path.join(storeRoot, "history.json"), []);
  history.unshift({ action: "rollback", packetId: manifest.packetId, packetVersion: manifest.packetVersion, packetRevision: manifest.packetRevision, rolledBackAt: new Date().toISOString(), displacedPath: path.basename(displaced) });
  await atomicWrite(path.join(storeRoot, "history.json"), history.slice(0, 100));
  return { manifest, packetBuffer: await fs.readFile(path.join(current, "packet.zip")), historyEntry: history[0] };
}

export async function exportInstalledGuidePacket(config) {
  return fs.readFile(path.join(rootFor(config), "installed/current/packet.zip"));
}

export async function readActiveGuidePacketEntry(configOrRoot, name) {
  const root = typeof configOrRoot === "string" ? configOrRoot : rootFor(configOrRoot);
  try { return await fs.readFile(path.join(root, "installed/current/contents", name)); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
