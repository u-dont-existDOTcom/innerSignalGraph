import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const REQUIRED_TRAJECTORY_IDS = Object.freeze([
  "SAFETY-DISAPPEARS",
  "RESOURCE-REPEATEDLY-UNAVAILABLE",
  "COPING-IMPROVES-NEED-REMAINS",
  "FRAME-REJECTED",
  "NOT-NOW-SUBJECT-CHANGE",
  "SUPPORTER-OVERRESPONSIBILITY",
  "MEMORY-CONFIDENCE-DRIFT",
  "BOT-AUTHORITY-CONCENTRATION",
  "BROKEN-TRUST-CHECKING-LOOP",
  "CAPACITY-FLUCTUATION",
  "RELIEF-WITHOUT-FULL-CHANGE",
  "MISSED-PROMISE-ARREARS",
  "DEPTH-BEFORE-INTEGRATION"
]);

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function read(file) {
  const bytes = fs.readFileSync(file);
  return { bytes, value: JSON.parse(bytes.toString("utf8")) };
}

function resolve(root, rel, prefix) {
  if (!rel.startsWith(prefix) || rel.split("/").includes("..")) throw new Error(`Invalid trajectory member path ${rel}.`);
  const file = path.resolve(root, rel);
  const corpus = path.resolve(root, "corpus/therapy-protocol-trajectories");
  if (!file.startsWith(`${corpus}${path.sep}`)) throw new Error(`Trajectory member ${rel} resolves outside the corpus.`);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Trajectory member ${rel} must be a regular file.`);
  return file;
}

function manifest(root) {
  const file = path.join(root, "corpus/therapy-protocol-trajectories/manifest.json");
  const loaded = read(file);
  const value = loaded.value;
  if (value.schemaVersion !== 1 || value.trajectoryCount !== REQUIRED_TRAJECTORY_IDS.length || value.trajectories?.length !== REQUIRED_TRAJECTORY_IDS.length) {
    throw new Error("Trajectory manifest count/schema mismatch.");
  }
  const ids = value.trajectories.map((item) => item.id);
  if (new Set(ids).size !== ids.length || JSON.stringify([...ids].sort()) !== JSON.stringify([...REQUIRED_TRAJECTORY_IDS].sort())) {
    throw new Error("Trajectory manifest does not contain the exact required IDs.");
  }
  return { value, sha256: hash(loaded.bytes) };
}

// Executor-side loader: never opens grader paths.
export function loadTrajectoryInputs(root = process.cwd()) {
  const loaded = manifest(root);
  const inputs = loaded.value.trajectories.map((item) => {
    const file = resolve(root, item.inputPath, "corpus/therapy-protocol-trajectories/inputs/");
    const input = read(file);
    if (hash(input.bytes) !== item.inputFileSha256) throw new Error(`Trajectory input hash mismatch for ${item.id}.`);
    if (input.value.id !== item.id || input.value.turns?.length !== item.turnCount) throw new Error(`Trajectory input identity/count mismatch for ${item.id}.`);
    for (const turn of input.value.turns) {
      if (Object.keys(turn).sort().join(",") !== "index,message" || typeof turn.message !== "string" || !turn.message.trim()) {
        throw new Error(`Trajectory ${item.id} input contains non-allowlisted or empty turn data.`);
      }
    }
    return input.value;
  });
  return { manifest: loaded.value, manifestSha256: loaded.sha256, inputs };
}

// Grader-side loader: call only after the executor has completed/checkpointed outputs.
export function loadTrajectoryGraders(root = process.cwd()) {
  const loaded = manifest(root);
  const graders = new Map();
  for (const item of loaded.value.trajectories) {
    const file = resolve(root, item.graderPath, "corpus/therapy-protocol-trajectories/graders/");
    const grader = read(file);
    if (hash(grader.bytes) !== item.graderFileSha256) throw new Error(`Trajectory grader hash mismatch for ${item.id}.`);
    if (grader.value.id !== item.id || grader.value.turns?.length !== item.turnCount) throw new Error(`Trajectory grader identity/count mismatch for ${item.id}.`);
    graders.set(item.id, grader.value);
  }
  return { manifest: loaded.value, manifestSha256: loaded.sha256, graders };
}
