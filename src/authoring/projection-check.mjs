import fs from "node:fs/promises";
import path from "node:path";
import { sha256Bytes } from "./canonical-json.mjs";

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function diskRelative(logicalPath) {
  if (!logicalPath.startsWith("current/")) throw new Error(`Projection output is outside current/: ${logicalPath}`);
  return logicalPath.slice("current/".length);
}

async function listFiles(root, relative = "") {
  const absolute = path.join(root, relative);
  const entries = await fs.readdir(absolute, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => compareText(left.name, right.name))) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw Object.assign(new Error(`Generated projection contains a symlink: ${child}`), { code: "AUTHORING_SYMLINK_FORBIDDEN" });
    if (entry.isDirectory()) files.push(...await listFiles(root, child));
    else if (entry.isFile()) files.push(child);
    else throw new Error(`Generated projection contains a non-regular entry: ${child}`);
  }
  return files;
}

export async function compareProjection(output, destination) {
  let actualFiles = [];
  try {
    actualFiles = await listFiles(destination);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const expectedByDiskPath = new Map([...output.entries()].map(([logicalPath, text]) => [diskRelative(logicalPath), text]));
  const expectedFiles = [...expectedByDiskPath.keys()].sort(compareText);
  const actualSet = new Set(actualFiles);
  const expectedSet = new Set(expectedFiles);
  const missing = expectedFiles.filter((file) => !actualSet.has(file));
  const unexpected = actualFiles.filter((file) => !expectedSet.has(file));
  const differing = [];
  for (const relative of expectedFiles.filter((file) => actualSet.has(file))) {
    const actual = await fs.readFile(path.join(destination, relative));
    const expected = Buffer.from(expectedByDiskPath.get(relative), "utf8");
    if (!actual.equals(expected)) differing.push({ path: relative, expectedSha256: sha256Bytes(expected), actualSha256: sha256Bytes(actual) });
  }
  const ok = missing.length === 0 && unexpected.length === 0 && differing.length === 0;
  return { ok, missing: missing.slice(0, 50), unexpected: unexpected.slice(0, 50), differing: differing.slice(0, 50) };
}

export async function assertProjectionCurrent(output, destination) {
  const report = await compareProjection(output, destination);
  if (!report.ok) {
    const error = new Error(`Generated projection drift detected: ${JSON.stringify(report)}`);
    error.code = "GENERATED_PROJECTION_DRIFT";
    error.report = report;
    throw error;
  }
  return report;
}

export async function writeProjectionAtomically(output, destination) {
  const parent = path.dirname(destination);
  await fs.mkdir(parent, { recursive: true });
  try {
    const stat = await fs.lstat(destination);
    if (stat.isSymbolicLink()) throw Object.assign(new Error("Projection destination may not be a symlink."), { code: "AUTHORING_SYMLINK_FORBIDDEN" });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const temporary = await fs.mkdtemp(path.join(parent, ".current.tmp-"));
  const backup = path.join(parent, `.current.backup-${process.pid}`);
  let movedExisting = false;
  try {
    for (const [logicalPath, text] of output) {
      const relative = diskRelative(logicalPath);
      const file = path.join(temporary, relative);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, text, { encoding: "utf8", flag: "wx" });
    }
    try {
      await fs.rename(destination, backup);
      movedExisting = true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await fs.rename(temporary, destination);
    if (movedExisting) await fs.rm(backup, { recursive: true, force: true });
  } catch (error) {
    await fs.rm(temporary, { recursive: true, force: true });
    if (movedExisting) {
      try {
        await fs.rename(backup, destination);
      } catch (restoreError) {
        error.restoreError = restoreError;
      }
    }
    throw error;
  }
}
