import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

export function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  return value;
}

export function stableJson(value) { return JSON.stringify(stableValue(value)); }
export function sha256(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === "string" ? value : stableJson(value));
  return createHash("sha256").update(bytes).digest("hex");
}
export async function readJson(file) { return JSON.parse(await fs.readFile(file, "utf8")); }

export async function atomicWriteJson(file, value, mode = 0o600) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode });
  await fs.rename(temp, file);
}
export async function atomicWriteText(file, value, mode = 0o600) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temp, value, { mode });
  await fs.rename(temp, file);
}
function safeName(value) { return String(value).replace(/[^a-zA-Z0-9._-]+/g, "-"); }

function serializeError(error, depth = 0) {
  if (!error || depth > 4) return null;
  return {
    name: error.name ?? "Error",
    code: error.code ?? null,
    message: error.message ?? String(error),
    details: error.details ?? null,
    cause: serializeError(error.cause, depth + 1),
    benchmarkProviderTraces: error.benchmarkProviderTraces ?? null
  };
}

export class StageStore {
  constructor(root, runIdentity) {
    this.root = path.resolve(root);
    this.runIdentity = runIdentity;
    this.stageRoot = path.join(this.root, "stages");
    this.manifestPath = path.join(this.root, "manifest.json");
    this.writeQueue = Promise.resolve();
    this.manifest = { schemaVersion: 1, runIdentity, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), stages: {} };
  }
  async initialize() {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    await fs.chmod(this.root, 0o700);
    try {
      const prior = await readJson(this.manifestPath);
      if (prior.runIdentity === this.runIdentity) this.manifest = prior;
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    await this.persist();
  }
  stagePath(id) { return path.join(this.stageRoot, `${safeName(id)}.json`); }
  async persist() {
    this.manifest.updatedAt = new Date().toISOString();
    const snapshot = structuredClone(this.manifest);
    this.writeQueue = this.writeQueue.then(() => atomicWriteJson(this.manifestPath, snapshot));
    await this.writeQueue;
  }
  async run(id, input, operation) {
    const inputHash = sha256({ runIdentity: this.runIdentity, input });
    const file = this.stagePath(id);
    try {
      const prior = await readJson(file);
      if (prior.status === "complete" && prior.inputHash === inputHash) {
        this.manifest.stages[id] = { status: "complete", inputHash, completedAt: prior.completedAt, reusedAt: new Date().toISOString(), file };
        await this.persist();
        return { value: prior.value, reused: true, file };
      }
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    const startedAt = new Date().toISOString();
    this.manifest.stages[id] = { status: "running", inputHash, startedAt, file };
    await this.persist();
    try {
      const value = await operation();
      const record = { schemaVersion: 1, status: "complete", id, inputHash, startedAt, completedAt: new Date().toISOString(), value };
      await atomicWriteJson(file, record);
      this.manifest.stages[id] = { status: "complete", inputHash, startedAt, completedAt: record.completedAt, file };
      await this.persist();
      return { value, reused: false, file };
    } catch (error) {
      const failedAt = new Date().toISOString();
      const failureFile = path.join(this.root, "failures", `${safeName(id)}-${failedAt.replace(/[:.]/g, "-")}.json`);
      await atomicWriteJson(failureFile, { schemaVersion: 1, status: "failed", id, inputHash, startedAt, failedAt, error: serializeError(error) });
      this.manifest.stages[id] = { status: "failed", inputHash, startedAt, failedAt, failureFile, file };
      await this.persist();
      throw error;
    }
  }
}

export class TraceProvider {
  constructor(provider) { this.provider = provider; this.id = provider.id; this.model = provider.model; this.calls = []; }
  async capabilities() { return typeof this.provider.capabilities === "function" ? await this.provider.capabilities() : null; }
  async generate(request) {
    const startedAt = new Date().toISOString();
    const started = Date.now();
    try {
      const response = await this.provider.generate(request);
      this.calls.push({ status: "complete", startedAt, completedAt: new Date().toISOString(), durationMs: Date.now() - started, request, response });
      return response;
    } catch (error) {
      this.calls.push({ status: "failed", startedAt, failedAt: new Date().toISOString(), durationMs: Date.now() - started, request, error: { name: error.name, code: error.code ?? null, message: error.message, details: error.details ?? null } });
      throw error;
    }
  }
}

export class ResumableTraceProvider extends TraceProvider {
  constructor(provider, { cacheRoot, lane }) {
    super(provider);
    this.cacheRoot = path.resolve(cacheRoot);
    this.lane = safeName(lane);
  }
  async generate(request) {
    const inputHash = sha256({ provider: this.provider.id, model: this.provider.model, request });
    const stage = safeName(request.metadata?.stage ?? request.metadata?.fixtureKey ?? "generation");
    const file = path.join(this.cacheRoot, this.lane, `${stage}-${inputHash}.json`);
    try {
      const prior = await readJson(file);
      if (prior.status === "complete" && prior.inputHash === inputHash && prior.response) {
        this.calls.push({ status: "reused", startedAt: prior.startedAt, completedAt: prior.completedAt, durationMs: prior.durationMs, request, response: prior.response, cacheFile: file });
        return prior.response;
      }
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    const startedAt = new Date().toISOString();
    const started = Date.now();
    try {
      const response = await this.provider.generate(request);
      const record = { schemaVersion: 1, status: "complete", inputHash, startedAt, completedAt: new Date().toISOString(), durationMs: Date.now() - started, request, response };
      await atomicWriteJson(file, record);
      this.calls.push({ status: "complete", ...record, cacheFile: file });
      return response;
    } catch (error) {
      const failedAt = new Date().toISOString();
      const failureFile = path.join(this.cacheRoot, this.lane, "failures", `${stage}-${inputHash}-${failedAt.replace(/[:.]/g, "-")}.json`);
      await atomicWriteJson(failureFile, { schemaVersion: 1, status: "failed", inputHash, startedAt, failedAt, durationMs: Date.now() - started, request, error: serializeError(error) });
      this.calls.push({ status: "failed", startedAt, failedAt, durationMs: Date.now() - started, request, error: serializeError(error), failureFile });
      throw error;
    }
  }
}

export function traceProviders(providers, options = null) {
  return Object.fromEntries(Object.entries(providers).map(([key, provider]) => [key, options?.cacheRoot ? new ResumableTraceProvider(provider, { ...options, lane: `${options.lane}-${key}` }) : new TraceProvider(provider)]));
}
export function providerTraces(providers) { return Object.fromEntries(Object.entries(providers).map(([key, provider]) => [key, provider.calls])); }

export function assertPrivateRoot(repositoryRoot, privateRoot) {
  const repo = path.resolve(repositoryRoot);
  const evidence = path.resolve(privateRoot);
  const relative = path.relative(repo, evidence);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) throw new Error("Private evidence root must be outside the Git worktree.");
  if (!path.basename(evidence).endsWith("-private")) throw new Error("Private evidence root must end with -private.");
  return evidence;
}

function canonicalPrivateText(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }

export async function assertPrivateTextAbsentFromGit(repositoryRoot, privateTexts) {
  const protectedValues = privateTexts.map(canonicalPrivateText).filter((value) => value.length >= 80);
  const listed = await runCommand("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: repositoryRoot, timeoutMs: 60_000 });
  if (listed.code !== 0) throw new Error("Could not enumerate the candidate Git surface for private-text scanning.");
  for (const relative of listed.stdout.split("\0").filter(Boolean)) {
    const file = path.join(repositoryRoot, relative);
    let data;
    try { data = await fs.readFile(file); } catch (error) { if (["EISDIR", "ENOENT"].includes(error.code)) continue; throw error; }
    if (data.includes(0)) continue;
    const canonical = canonicalPrivateText(data.toString("utf8"));
    for (const value of protectedValues) {
      if (canonical.includes(value)) {
        const error = new Error(`Private transcript material was detected in the Git candidate surface at ${relative}.`);
        error.code = "PRIVATE_TRANSCRIPT_IN_GIT_SURFACE";
        error.details = { path: relative, privateTextSha256: sha256(value) };
        throw error;
      }
    }
  }
  return { checkedFiles: listed.stdout.split("\0").filter(Boolean).length, protectedTextHashes: protectedValues.map(sha256) };
}

export async function runCommand(command, args, { cwd, timeoutMs = 1_200_000, stdin = "", env = process.env } = {}) {
  return await new Promise((resolve, reject) => {
    const started = Date.now();
    let settled = false;
    let timer;
    const child = spawn(command, args, { cwd, env, shell: false, stdio: ["pipe", "pipe", "pipe"], detached: process.platform !== "win32" });
    let stdout = "";
    let stderr = "";
    function terminateTree(signal = "SIGKILL") {
      try {
        if (process.platform === "win32") child.kill(signal);
        else process.kill(-child.pid, signal);
      } catch {
        try { child.kill(signal); } catch { /* already gone */ }
      }
    }
    function cleanup() {
      if (timer) clearTimeout(timer);
      process.removeListener("SIGINT", onInterrupt);
      process.removeListener("SIGTERM", onTerminate);
    }
    function interrupt(signal) {
      if (settled) return;
      settled = true;
      terminateTree("SIGTERM");
      cleanup();
      const error = new Error(`${command} interrupted by ${signal}`);
      error.code = "SUBPROCESS_INTERRUPTED";
      reject(error);
    }
    const onInterrupt = () => interrupt("SIGINT");
    const onTerminate = () => interrupt("SIGTERM");
    process.once("SIGINT", onInterrupt);
    process.once("SIGTERM", onTerminate);
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      terminateTree("SIGKILL");
      cleanup();
      reject(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => { if (settled) return; settled = true; cleanup(); reject(error); });
    child.on("close", (code, signal) => { if (settled) return; settled = true; cleanup(); resolve({ code, signal, stdout, stderr, durationMs: Date.now() - started }); });
    child.stdin.on("error", (error) => { if (error.code !== "EPIPE") reject(error); });
    child.stdin.end(stdin);
  });
}

export async function mapWithConcurrency(items, limit, operation) {
  const results = new Array(items.length);
  let cursor = 0;
  let failure = null;
  async function worker() {
    for (;;) {
      if (failure) return;
      const index = cursor++;
      if (index >= items.length) return;
      try {
        results[index] = await operation(items[index], index);
      } catch (error) {
        failure ??= error;
        return;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  if (failure) throw failure;
  return results;
}

export function responseReceipt(value) {
  const calls = Object.values(value.providerTraces ?? {}).flat();
  return {
    artifactSha256: sha256(value),
    answerSha256: sha256(value.result?.answer ?? ""),
    nextQuestionSha256: sha256(value.result?.next_question ?? ""),
    processingTier: value.result?.processingTier ?? null,
    routingReason: value.result?.routingReason ?? null,
    rendererModel: value.result?.rendererModel ?? null,
    calls: calls.map((call) => ({ stage: call.request?.metadata?.stage ?? null, provider: call.response?.provider ?? null, model: call.response?.model ?? null, requestId: call.response?.requestId ?? null, responseId: call.response?.responseId ?? null, durationMs: call.durationMs ?? null, usage: call.response?.usage ?? null, status: call.status }))
  };
}
