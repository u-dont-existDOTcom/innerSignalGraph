import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID as nodeRandomUUID } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GIT_SHA = /^[a-f0-9]{40}$/i;
const SHA256 = /^[a-f0-9]{64}$/i;
const VERSION = /^v?\d+(?:\.\d+){1,3}(?:-[A-Za-z0-9.-]+)?$/;
const SLUG = /^[a-z][a-z0-9-]{0,63}$/;
const CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const TEST_FILE = /^tests\/[A-Za-z0-9._/-]+\.(?:test|spec)\.(?:mjs|cjs|js|ts)$/;
const ERROR_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const TEST_NAME = /^[\p{L}\p{N}][\p{L}\p{N} .,:;'"()_+\/-]{0,239}$/u;
const SAFE_VALUE = /^(?:[a-f0-9]{40}|[a-f0-9]{64}|v?\d+(?:\.\d+){1,3}(?:-[A-Za-z0-9.-]+)?|-?\d+(?:\.\d+)?|true|false|null|undefined)$/i;
const COUNT_KEYS = ["tests", "suites", "pass", "fail", "cancelled", "skipped", "todo"];
const PRIVATE_TEXT = /(?:PRIVATE_|github_pat_|ghp_|sk-[A-Za-z0-9_-]{8,}|\/home\/|\\Users\\|therapy\.json)/i;

function safeMatch(value, expression) {
  return typeof value === "string" && expression.test(value) ? value : null;
}

function safeInteger(value, { maximum = Number.MAX_SAFE_INTEGER } = {}) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum ? value : null;
}

function safeBoolean(value) {
  return typeof value === "boolean" ? value : null;
}

function safeTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value ? null : value;
}

function safeTestName(value) {
  if (typeof value !== "string" || !TEST_NAME.test(value) || PRIVATE_TEXT.test(value)) return null;
  return value;
}

function safeTestLocation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const file = safeMatch(value.file, TEST_FILE);
  const line = safeInteger(value.line, { maximum: 10_000_000 });
  const column = safeInteger(value.column, { maximum: 1_000_000 });
  if (!file || file.includes("..") || line === null || line === 0 || column === null || column === 0) return null;
  return { file, line, column };
}

function safeScalar(value) {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return null;
  const candidate = String(value);
  return candidate.length <= 128 && SAFE_VALUE.test(candidate) ? candidate : null;
}

function safeTests(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const counts = {};
  if (source.counts && typeof source.counts === "object" && !Array.isArray(source.counts)) {
    for (const key of COUNT_KEYS) {
      const count = safeInteger(source.counts[key], { maximum: 10_000_000 });
      if (count !== null) counts[key] = count;
    }
  }

  const failures = [];
  if (Array.isArray(source.failures)) {
    for (const candidate of source.failures.slice(0, 20)) {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
      const name = safeTestName(candidate.name);
      if (!name) continue;
      const failure = { name };
      const location = safeTestLocation(candidate.location);
      const errorCode = safeMatch(candidate.errorCode, ERROR_CODE);
      const actual = safeScalar(candidate.actual);
      const expected = safeScalar(candidate.expected);
      if (location) failure.location = location;
      if (errorCode) failure.errorCode = errorCode;
      if (actual !== null) failure.actual = actual;
      if (expected !== null) failure.expected = expected;
      failures.push(failure);
    }
  }

  return {
    format: "inner-signal-test-failure-v1",
    command: source.command === "npm test" ? "npm test" : "package tests",
    exitCode: safeInteger(source.exitCode, { maximum: 255 }),
    counts,
    failures
  };
}

export function buildRemoteSafeTestSummary(value) {
  return safeTests(value);
}

function safeRuntime(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    version: safeMatch(source.version, VERSION),
    installedCommit: safeMatch(source.installedCommit, GIT_SHA),
    nodeVersion: safeMatch(source.nodeVersion, VERSION)
  };
}

function safeUpdate(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    status: safeMatch(source.status, SLUG),
    candidateCommit: safeMatch(source.candidateCommit, GIT_SHA)
  };
}

function safeFailure(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    stage: safeMatch(source.stage, SLUG),
    classification: safeMatch(source.classification, CODE),
    actionCode: safeMatch(source.actionCode, CODE),
    retryable: safeBoolean(source.retryable),
    exitCode: safeInteger(source.exitCode, { maximum: 255 })
  };
}

function safeIntegrity(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    runtimeTreeSha256: safeMatch(source.runtimeTreeSha256, SHA256),
    graphBundleSha256: safeMatch(source.graphBundleSha256, SHA256)
  };
}

function incidentIdentity(payload) {
  return createHash("sha256").update(JSON.stringify({
    machineId: payload.machineId,
    runtime: payload.runtime,
    update: payload.update,
    failure: payload.failure,
    tests: payload.tests,
    integrity: payload.integrity
  })).digest("hex");
}

export function buildRemoteDiagnosticPayload(input = {}) {
  const payload = {
    format: "inner-signal-remote-diagnostic-v1",
    incidentId: null,
    machineId: safeMatch(input.machineId, UUID),
    createdAt: safeTimestamp(input.createdAt),
    runtime: safeRuntime(input.runtime),
    update: safeUpdate(input.update),
    failure: safeFailure(input.failure),
    tests: safeTests(input.tests),
    integrity: safeIntegrity(input.integrity),
    privacy: {
      identity: "random-local-uuid",
      includesChatContent: false,
      includesCredentials: false,
      includesModelOutput: false,
      includesRawLogs: false
    }
  };
  payload.incidentId = incidentIdentity(payload);
  return payload;
}

async function readOrCreateMachineId(stateDir, randomUUID) {
  const machineIdPath = path.join(stateDir, "machine-id.txt");
  await fs.mkdir(stateDir, { recursive: true, mode: 0o700 });
  try {
    const existing = (await fs.readFile(machineIdPath, "utf8")).trim();
    if (!UUID.test(existing)) throw new Error("Persisted diagnostic machine ID is invalid");
    await fs.chmod(machineIdPath, 0o600);
    return existing;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const created = randomUUID();
  if (!UUID.test(created)) throw new Error("Generated diagnostic machine ID is invalid");
  try {
    await fs.writeFile(machineIdPath, `${created}\n`, { flag: "wx", mode: 0o600 });
    return created;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = (await fs.readFile(machineIdPath, "utf8")).trim();
    if (!UUID.test(existing)) throw new Error("Persisted diagnostic machine ID is invalid");
    await fs.chmod(machineIdPath, 0o600);
    return existing;
  }
}

export async function queueRemoteDiagnostic({
  stateDir,
  input = {},
  now = () => new Date(),
  randomUUID = nodeRandomUUID
}) {
  if (typeof stateDir !== "string" || stateDir.length === 0) throw new TypeError("stateDir is required");
  const machineId = await readOrCreateMachineId(stateDir, randomUUID);
  const instant = typeof now === "function" ? now() : now;
  const createdAt = instant instanceof Date ? instant.toISOString() : new Date(instant).toISOString();
  const payload = buildRemoteDiagnosticPayload({ ...input, machineId, createdAt });
  const outbox = path.join(stateDir, "diagnostic-outbox");
  const target = path.join(outbox, `${payload.incidentId}.json`);
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.mkdir(outbox, { recursive: true, mode: 0o700 });
  try {
    await fs.writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temporary, target);
    await fs.chmod(target, 0o600);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  return { incidentId: payload.incidentId, path: target, payload };
}
