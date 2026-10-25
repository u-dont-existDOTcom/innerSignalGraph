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
