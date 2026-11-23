import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const CORPUS = new URL("./corpus/cases.json", import.meta.url);
export const CORPUS_COMMIT = "4b543a87a";
export const CORPUS_SHA256 = "bbd1a40cdab2bf4964edbd234505a0b3779398ce3842b1985e0c443ede366a21";
export const MANIFEST_SCHEMA = "response-evidence-sealed-v1";
export const RUN_SCHEMA = "response-evidence-run-v1";
export const HARD_CAP = 144;
export const DEFAULT_MODEL = "claude-opus-5-5";
export const DEFAULT_EFFORT = "high";
export const OPT_IN_ENV = "INNER_SIGNAL_EVAL_ALLOW_SUBSCRIPTION_CLI";
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
export const readJson = async (file) => JSON.parse(await fs.readFile(file, "utf8"));
export const exists = async (file) => fs.lstat(file).then(() => true, (e) => { if (e.code === "ENOENT") return false; throw e; });
// Read Git metadata directly so even --mock has no subprocess dependency.
export async function head() {
  let gitDir = path.join(ROOT, ".git");
  if ((await fs.stat(gitDir)).isFile()) {
    const pointer = (await fs.readFile(gitDir, "utf8")).trim();
    if (!pointer.startsWith("gitdir: ")) throw new Error("Invalid Git directory pointer.");
    gitDir = path.resolve(ROOT, pointer.slice(8));
  }
  const value = (await fs.readFile(path.join(gitDir, "HEAD"), "utf8")).trim();
  if (/^[a-f0-9]{40,64}$/u.test(value)) return value;
  if (!/^ref: refs\/[A-Za-z0-9_./-]+$/u.test(value) || value.includes("..")) throw new Error("Invalid Git HEAD.");
  const ref = value.slice(5);
  const commonFile = path.join(gitDir, "commondir");
  const commonDir = await exists(commonFile) ? path.resolve(gitDir, (await fs.readFile(commonFile, "utf8")).trim()) : gitDir;
  for (const dir of new Set([gitDir, commonDir])) {
    const loose = path.join(dir, ref);
    if (await exists(loose)) {
      const commit = (await fs.readFile(loose, "utf8")).trim();
      if (/^[a-f0-9]{40,64}$/u.test(commit)) return commit;
    }
    const packed = path.join(dir, "packed-refs");
    if (await exists(packed)) {
      const row = (await fs.readFile(packed, "utf8")).split("\n").find((line) => line.endsWith(` ${ref}`));
      if (row && /^[a-f0-9]{40,64} /u.test(row)) return row.split(" ")[0];
    }
  }
  throw new Error("Could not resolve this checkout's Git HEAD.");
}
export const packetId = (caseId, arm) => `${caseId}.${arm}`;
export const callId = (packet, sample) => `${packet}.s${sample}`;
export const isolation = Object.freeze({ packetOnly: true, freshContextPerGenerate: true, tools: false, filesystem: false, sessionPersistence: false });

// Resolve existing ancestors too: a symlink cannot redirect output into this or another checkout.
export async function outsideRepository(dir) {
  if (typeof dir !== "string" || !dir) throw new Error("An output/input folder is required.");
  let ancestor = path.resolve(dir), suffix = [];
  while (!(await exists(ancestor))) { suffix.unshift(path.basename(ancestor)); ancestor = path.dirname(ancestor); }
  const resolved = path.join(await fs.realpath(ancestor), ...suffix);
  const root = await fs.realpath(ROOT);
  if (resolved === root || resolved.startsWith(`${root}${path.sep}`)) throw new Error("Evaluation output must stay outside the repository.");
  for (let at = resolved;; at = path.dirname(at)) {
    const git = path.join(at, ".git");
    // Some sandboxes put an empty, read-only .git placeholder in /tmp. A real checkout has
    // a gitdir pointer file or a HEAD inside its Git directory; the placeholder is neither.
    if (await exists(git)) {
      const stat = await fs.lstat(git);
      if (stat.isFile() || stat.isSymbolicLink() || await exists(path.join(git, "HEAD"))) throw new Error("Evaluation output must stay outside Git checkouts.");
    }
    if (at === path.dirname(at)) break;
  }
  return resolved;
}

export async function privateDirectory(dir) {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Expected a private directory.");
  await fs.chmod(dir, 0o700);
}

export async function loadCorpus() {
  const bytes = await fs.readFile(CORPUS);
  // This digest is of the exact committed bytes at CORPUS_COMMIT, verified with git show when the harness was built.
  if (sha256(bytes) !== CORPUS_SHA256) throw new Error("The frozen corpus bytes differ from the corpus commit; leave the corpus alone.");
  const corpus = JSON.parse(bytes);
  if (corpus.cases.length !== 36 || new Set(corpus.cases.map((c) => c.id)).size !== 36) throw new Error("Expected 36 distinct frozen cases.");
  return { corpus, bytes };
}
