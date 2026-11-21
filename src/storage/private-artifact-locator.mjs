import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ValidationError } from "../core/errors.mjs";
import { withOpenedRegularFile } from "../core/opened-regular-file.mjs";

const CASE_ID = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const ARTIFACT_ID = /^[A-Za-z0-9:_-]{1,160}$/;
const KINDS = Object.freeze(["handoff", "candidate"]);

function validateInput({ rootDir, kind, artifactId, caseId = null }) {
  if (typeof rootDir !== "string" || !path.isAbsolute(rootDir)) throw new ValidationError("Private locator rootDir must be absolute.");
  if (!KINDS.includes(kind)) throw new ValidationError("Private locator kind is invalid.");
  if (typeof artifactId !== "string" || !ARTIFACT_ID.test(artifactId)) throw new ValidationError("Private locator artifactId is invalid.");
  if (caseId != null && (typeof caseId !== "string" || !CASE_ID.test(caseId))) throw new ValidationError("Private locator caseId is invalid.");
}

function locatorPath(rootDir, kind, artifactId) {
  const digest = createHash("sha256").update(`${kind}\0${artifactId}`).digest("hex");
  return path.join(rootDir, ".artifact-locators", `${kind}-${digest}.json`);
}

export async function writePrivateArtifactLocator({ rootDir, kind, artifactId, caseId }) {
  validateInput({ rootDir, kind, artifactId, caseId });
  const directory = path.join(rootDir, ".artifact-locators");
  const file = locatorPath(rootDir, kind, artifactId);
  const value = { schema_version: 1, kind: `inner-signal-private-${kind}-locator`, artifact_id: artifactId, case_id: caseId };
  const body = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700);
  const existing = await fs.readFile(file, "utf8").catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (existing != null) {
    if (existing !== body.toString("utf8")) throw new ValidationError("Private artifact locator is immutable and conflicts with an existing identifier.");
    body.fill(0);
    return file;
  }
  let handle;
  const temporary = `${file}.tmp`;
  try {
    handle = await fs.open(temporary, "wx", 0o600);
    await handle.writeFile(body);
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporary, file);
    const directoryHandle = await fs.open(directory, "r");
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
  } finally {
    body.fill(0);
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(temporary).catch(() => {});
  }
  return file;
}

export async function resolvePrivateArtifactCaseId({ rootDir, kind, artifactId }) {
  validateInput({ rootDir, kind, artifactId });
  const file = locatorPath(rootDir, kind, artifactId);
  return withOpenedRegularFile(file, async (handle, info) => {
    if ((info.mode & 0o077) !== 0) throw new ValidationError("Private artifact locator must have mode 0600 or stricter.");
    const value = JSON.parse(await handle.readFile("utf8"));
    validateInput({ rootDir, kind, artifactId: value?.artifact_id, caseId: value?.case_id });
    if (value.schema_version !== 1 || value.kind !== `inner-signal-private-${kind}-locator` || value.artifact_id !== artifactId) {
      throw new ValidationError("Private artifact locator identity is invalid.");
    }
    return value.case_id;
  });
}

// The locator files that name one case, for deleting the case: every file in the locator folder that is a regular file, holds a
// locator of a known kind for exactly this case, and sits at the very path that kind and artifact id give. Anything else (another
// case's locator, a file of another shape, a link, a half-written temporary file) is not listed, so it is never deleted as this
// case's.
export async function listPrivateArtifactLocatorsForCase({ rootDir, caseId }) {
  if (typeof rootDir !== "string" || !path.isAbsolute(rootDir)) throw new ValidationError("Private locator rootDir must be absolute.");
  if (typeof caseId !== "string" || !CASE_ID.test(caseId)) throw new ValidationError("Private locator caseId is invalid.");
  const directory = path.join(rootDir, ".artifact-locators");
  let names;
  try { names = await fs.readdir(directory); }
  catch (error) { if (error?.code === "ENOENT") return []; throw error; }
  const found = [];
  for (const name of names.sort()) {
    if (!/^(?:handoff|candidate)-[a-f0-9]{64}\.json$/u.test(name)) continue;
    const file = path.join(directory, name);
    const info = await fs.lstat(file).catch(() => null);
    if (!info?.isFile()) continue;
    let value;
    try { value = JSON.parse(await fs.readFile(file, "utf8")); } catch { continue; }
    const kind = KINDS.find((entry) => value?.kind === `inner-signal-private-${entry}-locator`);
    if (!kind || value.schema_version !== 1 || value.case_id !== caseId || typeof value.artifact_id !== "string" || !ARTIFACT_ID.test(value.artifact_id)) continue;
    if (locatorPath(rootDir, kind, value.artifact_id) !== file) continue;
    found.push(Object.freeze({ file, kind, artifactId: value.artifact_id }));
  }
  return found;
}
