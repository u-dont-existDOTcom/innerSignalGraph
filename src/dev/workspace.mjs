import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

const SKIP_TOP_LEVEL = new Set([
  ".env", ".inner-signal-autopilot", ".inner-signal-dev", "ledgers", "data", "node_modules", ".git"
]);

function normalizedRelative(root, fullPath) {
  return path.relative(root, fullPath).split(path.sep).join("/");
}

export function isManagedRelative(relativePath) {
  const rel = String(relativePath || "").replace(/^\.\//, "");
  if (!rel || rel.startsWith("../")) return false;
  const top = rel.split("/")[0];
  if (SKIP_TOP_LEVEL.has(top)) return false;
  if (/\.(zip|sha256)$/i.test(rel)) return false;
  if (/^BUILD-VERIFY\.txt$/i.test(rel)) return true;
  return true;
}

async function walk(root, current = root, out = []) {
  let entries = [];
  try { entries = await fs.readdir(current, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const full = path.join(current, entry.name);
    const rel = normalizedRelative(root, full);
    if (!isManagedRelative(rel)) continue;
    if (entry.isDirectory()) await walk(root, full, out);
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

async function shaFile(filePath) {
  const hash = createHash("sha256");
  hash.update(await fs.readFile(filePath));
  return hash.digest("hex");
}

export async function sourceManifest(root) {
  const files = await walk(root);
  const manifest = {};
  for (const rel of files.sort()) manifest[rel] = await shaFile(path.join(root, rel));
  return manifest;
}


export function manifestHash(manifest = {}) {
  const hash = createHash("sha256");
  for (const [file, digest] of Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b))) {
    hash.update(file);
    hash.update("\0");
    hash.update(String(digest));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export async function sourceTreeHash(root) {
  return manifestHash(await sourceManifest(root));
}

export function compareManifests(before, after) {
  const names = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  const changes = [];
  for (const file of [...names].sort()) {
    if (!(file in (before || {}))) changes.push({ file, status: "added", before: null, after: after[file] });
    else if (!(file in (after || {}))) changes.push({ file, status: "deleted", before: before[file], after: null });
    else if (before[file] !== after[file]) changes.push({ file, status: "modified", before: before[file], after: after[file] });
  }
  return changes;
}

export function classifyChangeRisk(changes = []) {
  const highRiskPatterns = [
    /^guides\//,
    /^guide-graphs\/(?!compiled\/)/,
    /^src\/guide-graph\/(?:contract|planner|regressions)\.mjs$/,
    /^src\/hypnosis\/(?:app-owned-copy|deterministic-audit|validate-draft)\.mjs$/,
    /^src\/prompts\/hypnosis-/,
    /^corpus\/difficult-cases\//
  ];
  const highRisk = changes.filter(({ file }) => highRiskPatterns.some((pattern) => pattern.test(file)));
  return {
    level: highRisk.length ? "substantive-review-required" : "reviewer-classified",
    highRiskFiles: highRisk.map((item) => item.file),
    changedFiles: changes.map((item) => item.file)
  };
}

export async function createCandidateWorkspace({ sourceRoot, candidateRoot, jobId = randomUUID() }) {
  await fs.rm(candidateRoot, { recursive: true, force: true });
  await fs.mkdir(candidateRoot, { recursive: true });
  const baseline = await sourceManifest(sourceRoot);
  for (const rel of Object.keys(baseline)) {
    const src = path.join(sourceRoot, rel);
    const dst = path.join(candidateRoot, rel);
    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.copyFile(src, dst);
  }
  const metaDir = path.join(candidateRoot, ".inner-signal-dev");
  await fs.mkdir(metaDir, { recursive: true });
  await fs.writeFile(path.join(metaDir, "BASELINE_MANIFEST.json"), `${JSON.stringify({ jobId, createdAt: new Date().toISOString(), files: baseline }, null, 2)}\n`);
  return { jobId, candidateRoot, baseline };
}

export async function candidateChanges(candidateRoot, baseline) {
  const after = await sourceManifest(candidateRoot);
  const changes = compareManifests(baseline, after);
  const risk = classifyChangeRisk(changes);
  const metaDir = path.join(candidateRoot, ".inner-signal-dev");
  await fs.mkdir(metaDir, { recursive: true });
  await fs.writeFile(path.join(metaDir, "DEVELOPMENT_CHANGESET.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), changes, risk }, null, 2)}\n`);
  return { after, changes, risk };
}

export async function copyManagedTree(sourceRoot, targetRoot) {
  const source = await sourceManifest(sourceRoot);
  const target = await sourceManifest(targetRoot);
  for (const rel of Object.keys(target)) {
    if (!(rel in source)) await fs.rm(path.join(targetRoot, rel), { force: true, recursive: true });
  }
  for (const rel of Object.keys(source)) {
    const src = path.join(sourceRoot, rel);
    const dst = path.join(targetRoot, rel);
    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.copyFile(src, dst);
  }
  return { copied: Object.keys(source).length, removed: Object.keys(target).filter((rel) => !(rel in source)).length };
}
