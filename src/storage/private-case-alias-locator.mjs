import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ValidationError } from "../core/errors.mjs";
import { withOpenedRegularFile } from "../core/opened-regular-file.mjs";

const CASE_ID = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const MAX_ALIAS_LENGTH = 160;
const KIND = "inner-signal-private-case-alias-locator";

export function normalizePrivateCaseAlias(value) {
  if (typeof value !== "string") throw new ValidationError("Private case alias must be text.");
  const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
  if (!normalized || normalized.length > MAX_ALIAS_LENGTH) throw new ValidationError("Private case alias must be bounded non-empty text.");
  if (/[\u0000-\u001f\u007f]/u.test(normalized)) throw new ValidationError("Private case alias contains control characters.");
  return normalized;
}

function aliasDigest(alias) {
  return createHash("sha256")
    .update("inner-signal-private-case-alias-v1\0", "utf8")
    .update(normalizePrivateCaseAlias(alias), "utf8")
    .digest("hex");
}

function validateRoot(rootDir) {
  if (typeof rootDir !== "string" || !path.isAbsolute(rootDir)) throw new ValidationError("Private alias rootDir must be absolute.");
}

function validateCaseId(caseId) {
  if (typeof caseId !== "string" || !CASE_ID.test(caseId)) throw new ValidationError("Private alias caseId is invalid.");
}

function locatorPath(rootDir, alias) {
  const digest = aliasDigest(alias);
  return { digest, file: path.join(rootDir, ".case-alias-locators", `case-${digest}.json`) };
}

export async function writePrivateCaseAliasLocator({ rootDir, alias, caseId }) {
  validateRoot(rootDir);
  validateCaseId(caseId);
  const directory = path.join(rootDir, ".case-alias-locators");
  const { digest, file } = locatorPath(rootDir, alias);
  const value = { schema_version: 1, kind: KIND, alias_sha256: digest, case_id: caseId };
  const body = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700);
  const existing = await fs.readFile(file, "utf8").catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (existing != null) {
    if (existing !== body.toString("utf8")) throw new ValidationError("Private case alias already resolves to a different case.");
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

export async function resolvePrivateCaseAliasCaseId({ rootDir, alias }) {
  validateRoot(rootDir);
  const { digest, file } = locatorPath(rootDir, alias);
  return withOpenedRegularFile(file, async (handle, info) => {
    if ((info.mode & 0o077) !== 0) throw new ValidationError("Private case alias locator must have mode 0600 or stricter.");
    const value = JSON.parse(await handle.readFile("utf8"));
    validateCaseId(value?.case_id);
    if (value.schema_version !== 1 || value.kind !== KIND || value.alias_sha256 !== digest) {
      throw new ValidationError("Private case alias locator identity is invalid.");
    }
    return value.case_id;
  });
}

// The alias locator files that name one case, for deleting the case: regular files of this kind and shape, for exactly this case,
// each at the path its own alias digest gives. Another case's locator, another shape or a link is never listed.
export async function listPrivateCaseAliasLocatorsForCase({ rootDir, caseId }) {
  validateRoot(rootDir);
  validateCaseId(caseId);
  const directory = path.join(rootDir, ".case-alias-locators");
  let names;
  try { names = await fs.readdir(directory); }
  catch (error) { if (error?.code === "ENOENT") return []; throw error; }
  const found = [];
  for (const name of names.sort()) {
    const match = /^case-([a-f0-9]{64})\.json$/u.exec(name);
    if (!match) continue;
    const file = path.join(directory, name);
    const info = await fs.lstat(file).catch(() => null);
    if (!info?.isFile()) continue;
    let value;
    try { value = JSON.parse(await fs.readFile(file, "utf8")); } catch { continue; }
    if (value?.schema_version !== 1 || value.kind !== KIND || value.case_id !== caseId || value.alias_sha256 !== match[1]) continue;
    found.push(Object.freeze({ file }));
  }
  return found;
}
