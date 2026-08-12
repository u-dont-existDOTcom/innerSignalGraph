import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { projectRoot } from "../core/config.mjs";
import { RUNTIME_VERSION } from "../core/runtime-version.mjs";
import { createStoredZip, readZipEntries } from "../core/zip.mjs";
import { loadCompiledGuideGraphBundle } from "../guide-graph/compiler.mjs";
import { safePacketId } from "../guide-packet/contract.mjs";

const RUN_EVIDENCE_FILES = Object.freeze([
  "model-resolution.json",
  "anthropic-escalation-resolution.json",
  "anthropic-renderer-resolution.json",
  "guide-graph-compile.json",
  "guide-graph-regressions.json",
  "cli-diagnostics.json",
  "guide-packet-candidate.json",
  "runtime-smoke.json",
  "web-smoke.json",
  "roadmap-state.json",
  "A001-stage-failure.json",
  "final-status.json"
]);
const SENSITIVE_KEY = /(?:api.?key|access.?token|refresh.?token|password|secret|credential|authorization|cookie)/i;

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function redactString(value) {
  return String(value)
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED]")
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+\/-]{12,}=*\b/gi, "[REDACTED]");
}

function sanitize(value, key = "") {
  if (SENSITIVE_KEY.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => sanitize(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, sanitize(childValue, childKey)]));
  }
  return typeof value === "string" ? redactString(value) : value;
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function addSanitizedJson(entries, name, filePath) {
  const value = await readJsonIfExists(filePath);
  if (value == null) return false;
  entries.push({ name, data: json(sanitize(value)) });
  return true;
}

async function latestRunDirectory(root) {
  try {
    const candidates = (await fs.readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^run-/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    return candidates.length ? path.join(root, candidates.at(-1)) : null;
  } catch {
    return null;
  }
}

async function addLatestRunEvidence(entries, config) {
  const stable = path.join(config.autopilotStateDir, "model-resolution-latest.json");
  const stableAdded = await addSanitizedJson(entries, "runtime/model-resolution-latest.json", stable);
  await addSanitizedJson(
    entries,
    "runtime/a001-stage-attempts.json",
    path.join(config.autopilotStateDir, "a001-stage-attempts.json")
  );
  const runDir = await latestRunDirectory(config.autopilotStateDir);
  if (!runDir) return;
  for (const filename of RUN_EVIDENCE_FILES) {
    if (filename === "model-resolution.json" && stableAdded) continue;
    await addSanitizedJson(entries, `runtime/latest-run/${filename}`, path.join(runDir, filename));
  }
}

async function addCandidateEvidence(entries, guidePacketRoot, activeCandidate) {
  if (!activeCandidate?.packetId) return null;
  let packetId;
  try {
    packetId = safePacketId(activeCandidate.packetId);
  } catch {
    return null;
  }
  const candidateRoot = path.join(guidePacketRoot, "candidates", packetId);
  const state = await readJsonIfExists(path.join(candidateRoot, "state.json"));
  if (state) entries.push({ name: "guide-packets/candidate-state.json", data: json(sanitize(state)) });

  try {
    const packet = await fs.readFile(path.join(candidateRoot, "original.zip"));
    const packetEntries = readZipEntries(packet);
    const candidateManifest = JSON.parse(packetEntries.get("manifest.json").toString("utf8"));
    const originalZipSha256 = sha256(packet);
    entries.push({ name: "guide-packets/candidate-manifest.json", data: json(sanitize(candidateManifest)) });
    entries.push({
      name: "guide-packets/candidate-integrity.json",
      data: json({
        packetId,
        originalZipSha256,
        statePacketSha256: state?.packetSha256 ?? null,
        stateHashMatchesOriginalZip: state?.packetSha256 ? state.packetSha256 === originalZipSha256 : null,
        zipBodyIncluded: false
      })
    });
    return { packetId, originalZipSha256, manifest: candidateManifest };
  } catch {
    return state ? { packetId, originalZipSha256: null, manifest: null } : null;
  }
}

export async function buildDiagnosticBundle({ config, providers, browserState = {} }) {
  const graphBundle = await loadCompiledGuideGraphBundle({ packetRoot: config.guidePacketRoot });
  const guidePacketRoot = config.guidePacketRoot ?? path.join(config.autopilotStateDir, "guide-packets");
  const entries = [];

  const health = {
    ok: true,
    version: RUNTIME_VERSION,
    mode: config.mode,
    models: {
      openai: providers.openai?.model ?? null,
      anthropic: providers.anthropic?.model ?? null,
      renderer: providers.renderer?.model ?? providers.anthropic?.model ?? null
    },
    graphBundleVersion: graphBundle.version,
    guidePacketRootConfigured: Boolean(config.guidePacketRoot)
  };
  entries.push(
    { name: "runtime/health.json", data: json(health) },
    { name: "runtime/package.json", data: json(sanitize(JSON.parse(await fs.readFile(path.join(projectRoot, "package.json"), "utf8")))) },
    { name: "graph/bundle.json", data: json(sanitize(graphBundle)) }
  );

  for (const [name, filePath] of [
    ["development/development-supervisor.json", path.join(config.autopilotStateDir, "development-supervisor.json")],
    ["development/autonomous-roadmap-state.json", path.join(config.autopilotStateDir, "autonomous-roadmap-state.json")],
    ["development/promotion-ready.json", config.devPromotionMarker],
    ["development/local-repair-revision.json", path.join(config.autopilotStateDir, "local-repair-revision.json")],
    ["development/autonomous-development-roadmap.json", path.join(projectRoot, "roadmap/autonomous-development.json")],
    ["runtime/runtime-fingerprint.json", path.join(config.autopilotStateDir, "runtime-fingerprint.json")],
    ["guides/manifest.json", config.guideManifestPath]
  ]) {
    if (filePath) await addSanitizedJson(entries, name, filePath);
  }

  for (const [name, filePath] of [
    ["guide-packets/processing-status.json", path.join(guidePacketRoot, "processing-status.json")],
    ["guide-packets/stage-attempts.json", path.join(guidePacketRoot, "stage-attempts.json")],
    ["guide-packets/active-candidate.json", path.join(guidePacketRoot, "active-candidate.json")],
    ["guide-packets/history.json", path.join(guidePacketRoot, "history.json")],
    ["guide-packets/installed-manifest.json", path.join(guidePacketRoot, "installed/current/contents/manifest.json")]
  ]) {
    await addSanitizedJson(entries, name, filePath);
  }

  const activeCandidate = await readJsonIfExists(path.join(guidePacketRoot, "active-candidate.json"));
  const candidateEvidence = await addCandidateEvidence(entries, guidePacketRoot, activeCandidate);
  await addLatestRunEvidence(entries, config);

  const manifest = {
    format: "inner-signal-diagnostic-bundle-v2",
    exportedAt: new Date().toISOString(),
    runtimeVersion: RUNTIME_VERSION,
    graphBundleVersion: graphBundle.version,
    candidate: candidateEvidence ? {
      packetId: candidateEvidence.packetId,
      originalZipSha256: candidateEvidence.originalZipSha256
    } : null,
    includedFiles: entries.map((entry) => entry.name).sort(),
    privacy: {
      includesChatContent: false,
      includesReasoningLedgers: false,
      includesDevelopmentCasePayloads: false,
      includesGuidePacketZipBodies: false,
      excludesEnvAndCredentials: true,
      browserStateIgnored: browserState != null,
      note: "This recovery bundle contains deterministic runtime, model-entitlement, supervisor, gate, manifest, hash, and Guide Packet state evidence only."
    }
  };
  entries.unshift({ name: "manifest.json", data: json(manifest) });
  return { buffer: createStoredZip(entries), manifest };
}
