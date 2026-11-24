import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// Each digest freezes the exact authored bytes, independently of the selected corpus.
export const CORPORA = Object.freeze({
  main: Object.freeze({ file: new URL("./corpus/cases.json", import.meta.url), sha256: "bbd1a40cdab2bf4964edbd234505a0b3779398ce3842b1985e0c443ede366a21", commit: "4b543a87a", caseCount: 36 }),
  // Claude must commit and verify these bytes before any live holdout run; no containing commit is claimed here.
  holdout: Object.freeze({ file: new URL("./corpus/holdout-cases.json", import.meta.url), sha256: "457ce1c0d92caf5f25972480fe6a12a27268cbbe122e9ed1c7850a6e487fe8f6", commit: null, caseCount: 16 })
});
export function corpusEntry(name = "main") {
  if (!Object.hasOwn(CORPORA, name)) throw new Error("--corpus must be main or holdout.");
  return CORPORA[name];
}
// Keep the original main-corpus exports for existing consumers.
export const CORPUS = CORPORA.main.file;
export const CORPUS_COMMIT = CORPORA.main.commit;
export const CORPUS_SHA256 = CORPORA.main.sha256;
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
  // Read .git once instead of checking its type first (no check-then-use race): a worktree's .git is a pointer file.
  const pointerText = await fs.readFile(gitDir, "utf8").catch((error) => { if (error.code === "EISDIR") return null; throw error; });
  if (pointerText !== null) {
    const pointer = pointerText.trim();
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

export async function loadCorpus(name = "main") {
  const entry = corpusEntry(name);
  const bytes = await fs.readFile(entry.file);
  if (sha256(bytes) !== entry.sha256) throw new Error(`The frozen ${name} corpus bytes differ from its registered SHA-256; leave the corpus alone.`);
  const corpus = JSON.parse(bytes);
  if (corpus.cases.length !== entry.caseCount || new Set(corpus.cases.map((c) => c.id)).size !== entry.caseCount) throw new Error(`Expected ${entry.caseCount} distinct frozen ${name} cases.`);
  return { corpus, bytes, name, entry };
}
