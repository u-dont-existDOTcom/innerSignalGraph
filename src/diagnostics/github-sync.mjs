import fs from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { runSubprocess } from "../core/subprocess.mjs";
import { buildRemoteDiagnosticPayload } from "./remote-diagnostic.mjs";

const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BRANCH = /^[A-Za-z0-9._/-]+$/;
const GIT_SHA = /^[a-f0-9]{40}$/i;
const INCIDENT_ID = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AUTH_FAILURE = /(?:HTTP\s+401\b|bad credentials|authentication (?:failed|required)|not logged (?:in|into)|gh auth login|token[^\n]{0,80}\binvalid\b)/i;
const DEFAULT_MAX_INCIDENTS = 3;
const DEFAULT_TOTAL_TIMEOUT_MS = 10_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 3_000;
const TOP_LEVEL_KEYS = [
  "createdAt", "failure", "format", "incidentId", "integrity",
  "machineId", "privacy", "runtime", "tests", "update"
];

function validateRepository(value) {
  if (typeof value !== "string" || !REPOSITORY.test(value)) {
    throw new TypeError("Invalid GitHub repository");
  }
  return value;
}

function validateBranch(value) {
  if (typeof value !== "string"
      || !BRANCH.test(value)
      || value.includes("..")
      || value.includes("//")
      || value.startsWith("/")
      || value.endsWith("/")) {
    throw new TypeError("Invalid Git branch");
  }
  return value;
}

function nowIso(now) {
  const value = typeof now === "function" ? now() : now;
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.valueOf())) throw new TypeError("Invalid sync timestamp");
  return instant.toISOString();
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} must be a positive integer`);
  return value;
}

function clockValue(clock) {
  if (typeof clock !== "function") throw new TypeError("clock must be a function");
  const value = clock();
  if (!Number.isFinite(value)) throw new TypeError("clock must return a finite number");
  return value;
}

async function atomicJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temporary, file);
    await fs.chmod(file, 0o600);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

function endpointPath(remotePath) {
  return remotePath.split("/").map(encodeURIComponent).join("/");
}

async function ghJson({
  ghCommand,
  ghBaseArgs,
  env,
  runner,
  args,
  label,
  timeoutMs
}) {
  let run;
  try {
    run = await runner({
      command: ghCommand,
      args: [...ghBaseArgs, "api", ...args],
      env,
      timeoutMs,
      label
    });
  } catch {
    return { ok: false, value: null, failure: "unavailable" };
  }
  if (run.code !== 0) {
    const diagnostic = `${run.stdout ?? ""}\n${run.stderr ?? ""}`.slice(0, 4096);
    return {
      ok: false,
      value: null,
      failure: AUTH_FAILURE.test(diagnostic) ? "authentication-required" : "unavailable"
    };
  }
  try {
    return { ok: true, value: JSON.parse(run.stdout), failure: null };
  } catch {
    return { ok: false, value: null, failure: "unavailable" };
  }
}

function validateOutboxPayload(value, filename) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (!isDeepStrictEqual(Object.keys(value).sort(), TOP_LEVEL_KEYS)) return null;
  if (value.format !== "inner-signal-remote-diagnostic-v1") return null;
  if (!INCIDENT_ID.test(value.incidentId ?? "") || filename !== `${value.incidentId}.json`) return null;
  if (!UUID.test(value.machineId ?? "")) return null;
  const rebuilt = buildRemoteDiagnosticPayload(value);
  return isDeepStrictEqual(rebuilt, value) ? value : null;
}

function sameStableIncident(left, right) {
  const { createdAt: _leftCreatedAt, ...leftStable } = left;
  const { createdAt: _rightCreatedAt, ...rightStable } = right;
  return isDeepStrictEqual(leftStable, rightStable);
}

async function outboxFiles(stateDir) {
  const outbox = path.join(stateDir, "diagnostic-outbox");
  try {
    return (await fs.readdir(outbox, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && INCIDENT_ID.test(entry.name.replace(/\.json$/, "")) && entry.name.endsWith(".json"))
      .map((entry) => path.join(outbox, entry.name))
      .sort();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function readBranch({ repository, branch, gh }) {
  const response = await gh([`repos/${repository}/git/ref/heads/${encodeURIComponent(branch)}`], `GitHub ${branch} branch check`);
  const sha = response.value?.object?.sha;
  return {
    sha: response.ok && GIT_SHA.test(sha ?? "") ? sha : null,
    failure: response.failure
  };
}

async function ensureDiagnosticsBranch({ repository, stableBranch, diagnosticsBranch, gh }) {
  const existing = await readBranch({ repository, branch: diagnosticsBranch, gh });
  if (existing.sha) return existing;
  if (existing.failure === "authentication-required") return existing;
  const stableSha = await readBranch({ repository, branch: stableBranch, gh });
  if (!stableSha.sha) return stableSha;
  const created = await gh([
    "--method", "POST",
    `repos/${repository}/git/refs`,
    "-f", `ref=refs/heads/${diagnosticsBranch}`,
    "-f", `sha=${stableSha.sha}`
  ], "GitHub diagnostics branch creation");
  const createdSha = created.value?.object?.sha;
  return {
    sha: created.ok && GIT_SHA.test(createdSha ?? "") ? createdSha : null,
    failure: created.failure
  };
}

async function writeReceipt({ stateDir, payload, repository, branch, remotePath, contentSha, commitSha, syncedAt, idempotent }) {
  const receipt = {
    format: "inner-signal-diagnostic-receipt-v1",
    incidentId: payload.incidentId,
    machineId: payload.machineId,
    syncedAt,
    repository,
    branch,
    path: remotePath,
    contentSha,
    commitSha,
    idempotent
  };
  await atomicJson(path.join(stateDir, "diagnostic-receipts", `${payload.incidentId}.json`), receipt);
}

async function writeSyncStatus({ stateDir, status, synced, pending, branch, paths, updatedAt }) {
  await atomicJson(path.join(stateDir, "diagnostic-sync-status.json"), {
    format: "inner-signal-diagnostic-sync-status-v1",
    status,
    updatedAt,
    synced,
    pending,
    branch,
    paths
  });
}

export async function syncDiagnosticOutbox({
  stateDir,
  repository,
  stableBranch = "stable",
  diagnosticsBranch = "runtime-diagnostics",
  ghCommand = "gh",
  ghBaseArgs = [],
  env = process.env,
  now = () => new Date(),
  runner = runSubprocess,
  enabled = true,
  maxIncidents = DEFAULT_MAX_INCIDENTS,
  totalTimeoutMs = DEFAULT_TOTAL_TIMEOUT_MS,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  clock = Date.now
}) {
  if (typeof stateDir !== "string" || stateDir.length === 0) throw new TypeError("stateDir is required");
  validateRepository(repository);
  validateBranch(stableBranch);
  validateBranch(diagnosticsBranch);
  if (!Array.isArray(ghBaseArgs) || !ghBaseArgs.every((value) => typeof value === "string")) {
    throw new TypeError("ghBaseArgs must be an array of strings");
  }
  positiveInteger(maxIncidents, "maxIncidents");
  positiveInteger(totalTimeoutMs, "totalTimeoutMs");
  positiveInteger(requestTimeoutMs, "requestTimeoutMs");

  const pendingFiles = await outboxFiles(stateDir);
  const updatedAt = nowIso(now);
  const paths = [];
  let synced = 0;
  const deadline = clockValue(clock) + totalTimeoutMs;
  const gh = (args, label) => {
    const remainingMs = Math.floor(deadline - clockValue(clock));
    if (remainingMs < 1) return Promise.resolve({ ok: false, value: null, failure: "unavailable" });
    return ghJson({
      ghCommand,
      ghBaseArgs,
      env,
      runner,
      args,
      label,
      timeoutMs: Math.min(requestTimeoutMs, remainingMs)
    });
  };

  if (!enabled) {
    const result = {
      status: "disabled",
      synced,
      pending: pendingFiles.length,
      branch: diagnosticsBranch,
      paths
    };
    await writeSyncStatus({ stateDir, ...result, updatedAt });
    return result;
  }

  if (pendingFiles.length === 0) {
    const result = { status: "synced", synced, pending: 0, branch: diagnosticsBranch, paths };
    await writeSyncStatus({ stateDir, ...result, updatedAt });
    return result;
  }

  const access = await gh([`repos/${repository}`], "GitHub repository access check");
  if (!access.ok) {
    const result = {
      status: access.failure === "authentication-required" ? "authentication-required" : "queued-for-retry",
      synced,
      pending: pendingFiles.length,
      branch: diagnosticsBranch,
      paths
    };
    await writeSyncStatus({ stateDir, ...result, updatedAt });
    return result;
  }
  if (access.value?.permissions?.push !== true) {
    const result = { status: "authentication-required", synced, pending: pendingFiles.length, branch: diagnosticsBranch, paths };
    await writeSyncStatus({ stateDir, ...result, updatedAt });
    return result;
  }

  const diagnosticsBranchResult = await ensureDiagnosticsBranch({ repository, stableBranch, diagnosticsBranch, gh });
  let branchSha = diagnosticsBranchResult.sha;
  if (!branchSha) {
    const result = {
      status: diagnosticsBranchResult.failure === "authentication-required" ? "authentication-required" : "queued-for-retry",
      synced,
      pending: pendingFiles.length,
      branch: diagnosticsBranch,
      paths
    };
    await writeSyncStatus({ stateDir, ...result, updatedAt });
    return result;
  }

  let processed = 0;
  let authenticationRequired = false;
  for (const localPath of pendingFiles) {
    if (processed >= maxIncidents) break;
    const filename = path.basename(localPath);
    let bytes;
    let payload;
    try {
      bytes = await fs.readFile(localPath);
      payload = validateOutboxPayload(JSON.parse(bytes.toString("utf8")), filename);
    } catch {
      payload = null;
    }
    if (!payload) continue;
    processed += 1;

    const remotePath = `diagnostics/${payload.machineId}/${payload.incidentId}.json`;
    const contentEndpoint = `repos/${repository}/contents/${endpointPath(remotePath)}`;
    const existing = await gh([
      `${contentEndpoint}?ref=${encodeURIComponent(diagnosticsBranch)}`
    ], "GitHub diagnostic existence check");

    let contentSha;
    let commitSha;
    let idempotent = false;
    if (existing.ok) {
      const remoteBytes = existing.value?.encoding === "base64" && typeof existing.value?.content === "string"
        ? Buffer.from(existing.value.content.replace(/\s/g, ""), "base64")
        : null;
      let remotePayload = null;
      try {
        remotePayload = remoteBytes
          ? validateOutboxPayload(JSON.parse(remoteBytes.toString("utf8")), filename)
          : null;
      } catch {
        remotePayload = null;
      }
      if (!remotePayload || !sameStableIncident(remotePayload, payload) || !GIT_SHA.test(existing.value?.sha ?? "")) continue;
      contentSha = existing.value.sha;
      commitSha = branchSha;
      idempotent = true;
    } else {
      if (existing.failure === "authentication-required") {
        authenticationRequired = true;
        break;
      }
      const uploaded = await gh([
        "--method", "PUT",
        contentEndpoint,
        "-f", `message=Record Inner Signal diagnostic ${payload.incidentId.slice(0, 12)}`,
        "-f", `content=${bytes.toString("base64")}`,
        "-f", `branch=${diagnosticsBranch}`
      ], "GitHub diagnostic upload");
      contentSha = uploaded.value?.content?.sha;
      commitSha = uploaded.value?.commit?.sha;
      if (!uploaded.ok || !GIT_SHA.test(contentSha ?? "") || !GIT_SHA.test(commitSha ?? "")) {
        if (uploaded.failure === "authentication-required") authenticationRequired = true;
        if (authenticationRequired) break;
        continue;
      }
      branchSha = commitSha;
    }

    try {
      await writeReceipt({
        stateDir,
        payload,
        repository,
        branch: diagnosticsBranch,
        remotePath,
        contentSha,
        commitSha,
        syncedAt: updatedAt,
        idempotent
      });
      await fs.rm(localPath);
      synced += 1;
      paths.push(remotePath);
    } catch {
      // The outbox remains the source of truth until a receipt and removal both succeed.
    }
  }

  const pending = (await outboxFiles(stateDir)).length;
  const result = {
    status: authenticationRequired ? "authentication-required" : pending === 0 ? "synced" : "queued-for-retry",
    synced,
    pending,
    branch: diagnosticsBranch,
    paths
  };
  await writeSyncStatus({ stateDir, ...result, updatedAt });
  return result;
}
