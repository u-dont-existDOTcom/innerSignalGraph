import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

export function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

export function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

export function sha256(value) {
  const body = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === "string" ? value : stableJson(value));
  return createHash("sha256").update(body).digest("hex");
}

export async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

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

function safeName(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, "-");
}

export class StageStore {
  constructor(root, runIdentity) {
    this.root = path.resolve(root);
    this.runIdentity = runIdentity;
    this.stageRoot = path.join(this.root, "stages");
    this.manifestPath = path.join(this.root, "manifest.json");
    this.manifest = {
      schemaVersion: 1,
      runIdentity,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      stages: {}
    };
  }

  async initialize() {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    await fs.chmod(this.root, 0o700);
    try {
      const existing = await readJson(this.manifestPath);
      if (existing.runIdentity === this.runIdentity) this.manifest = existing;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await this.#persistManifest();
  }

  stagePath(id) {
    return path.join(this.stageRoot, `${safeName(id)}.json`);
  }

  async #persistManifest() {
    this.manifest.updatedAt = new Date().toISOString();
    await atomicWriteJson(this.manifestPath, this.manifest);
  }

  async run(id, input, fn) {
    const inputHash = sha256({ runIdentity: this.runIdentity, input });
    const file = this.stagePath(id);
    try {
      const prior = await readJson(file);
      if (prior.status === "complete" && prior.inputHash === inputHash) {
        this.manifest.stages[id] = {
          status: "complete",
          inputHash,
          completedAt: prior.completedAt,
          reusedAt: new Date().toISOString(),
          file
        };
        await this.#persistManifest();
        return { value: prior.value, reused: true, file };
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }

    const startedAt = new Date().toISOString();
    this.manifest.stages[id] = { status: "running", inputHash, startedAt, file };
    await this.#persistManifest();
    try {
      const value = await fn();
      const complete = {
        schemaVersion: 1,
        status: "complete",
        id,
        inputHash,
        startedAt,
        completedAt: new Date().toISOString(),
        value
      };
      await atomicWriteJson(file, complete);
      this.manifest.stages[id] = {
        status: "complete",
        inputHash,
        startedAt,
        completedAt: complete.completedAt,
        file
      };
      await this.#persistManifest();
      return { value, reused: false, file };
    } catch (error) {
      const failed = {
        status: "failed",
        inputHash,
        startedAt,
        failedAt: new Date().toISOString(),
        error: { name: error.name, code: error.code ?? null, message: error.message }
      };
      this.manifest.stages[id] = { ...failed, file };
      await this.#persistManifest();
      throw error;
    }
  }
}

export class TraceProvider {
  constructor(provider) {
    this.provider = provider;
    this.id = provider.id;
    this.model = provider.model;
    this.calls = [];
  }

  async capabilities() {
    return typeof this.provider.capabilities === "function" ? await this.provider.capabilities() : null;
  }

  async generate(request) {
    const startedAt = new Date().toISOString();
    const started = Date.now();
    try {
      const response = await this.provider.generate(request);
      this.calls.push({
        status: "complete",
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        request,
        response
      });
      return response;
    } catch (error) {
      this.calls.push({
        status: "failed",
        startedAt,
        failedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        request,
        error: { name: error.name, code: error.code ?? null, message: error.message, details: error.details ?? null }
      });
      throw error;
    }
  }
}

export function tracedProviders(providers) {
  return Object.fromEntries(Object.entries(providers).map(([key, provider]) => [key, new TraceProvider(provider)]));
}

export function providerTraces(providers) {
  return Object.fromEntries(Object.entries(providers).map(([key, provider]) => [key, provider.calls]));
}

export function parseStructured(text, label = "model response") {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} was not valid JSON: ${error.message}`);
  }
}

export async function runCommand(command, args, { cwd, timeoutMs = 120000, stdin = "", env = process.env } = {}) {
  return await new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(command, args, { cwd, env, shell: false, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.stdin.on("error", (error) => {
      if (error.code !== "EPIPE") reject(error);
    });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, durationMs: Date.now() - started });
    });
    child.stdin.end(stdin);
  });
}

function parseCodexEvents(text) {
  const events = [];
  for (const line of String(text).split(/\r?\n/)) {
    try { if (line.trim()) events.push(JSON.parse(line)); } catch { /* compatibility noise */ }
  }
  return events;
}

export class NativeDeveloperCodexProvider {
  constructor({ command = "codex", model, reasoningEffort = "high", cwd, timeoutMs = 900000 } = {}) {
    this.id = "openai";
    this.model = model;
    this.command = command;
    this.reasoningEffort = reasoningEffort;
    this.cwd = cwd;
    this.timeoutMs = timeoutMs;
    this.transport = "codex-developer-instructions-config";
  }

  async generate({ system, user, outputSchema, metadata = {} }) {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "a001-codex-developer-"));
    const schemaFile = path.join(temp, "schema.json");
    const outputFile = path.join(temp, "output.json");
    await fs.writeFile(schemaFile, `${JSON.stringify(outputSchema, null, 2)}\n`, { mode: 0o600 });
    try {
      const args = [
        "exec",
        "--ephemeral",
        "--json",
        "--sandbox", "read-only",
        "--skip-git-repo-check",
        "--model", this.model,
        "-c", `model_reasoning_effort=${JSON.stringify(this.reasoningEffort)}`,
        "-c", `developer_instructions=${JSON.stringify(system)}`,
        "--strict-config",
        "--output-schema", schemaFile,
        "--output-last-message", outputFile,
        "--ignore-user-config",
        "--ignore-rules",
        "-"
      ];
      const run = await runCommand(this.command, args, {
        cwd: this.cwd,
        timeoutMs: this.timeoutMs,
        stdin: user
      });
      if (run.code !== 0) {
        const error = new Error(`Codex developer-instruction transport exited ${run.code}: ${run.stderr.slice(-2000)}`);
        error.code = "CODEX_DEVELOPER_TRANSPORT_FAILED";
        throw error;
      }
      const text = (await fs.readFile(outputFile, "utf8")).trim();
      if (!text) throw new Error("Codex developer-instruction transport returned an empty response.");
      const events = parseCodexEvents(run.stdout);
      const thread = events.find((event) => event.type === "thread.started");
      const completed = [...events].reverse().find((event) => event.type === "turn.completed");
      return {
        provider: this.id,
        model: this.model,
        text,
        requestId: thread?.thread_id ?? `codex-native-${randomUUID()}`,
        responseId: thread?.thread_id ?? null,
        usage: completed?.usage ?? null,
        transport: this.transport,
        metadata,
        stderr: run.stderr.trim()
      };
    } finally {
      await fs.rm(temp, { recursive: true, force: true });
    }
  }
}

export function assertPrivateRoot(repoRoot, privateRoot) {
  const repo = path.resolve(repoRoot);
  const evidence = path.resolve(privateRoot);
  const relative = path.relative(repo, evidence);
  if (!relative.startsWith("..") || path.isAbsolute(relative) === false && relative === "") {
    throw new Error("Private evidence root must be outside the Git worktree.");
  }
  if (!path.basename(evidence).endsWith("-private")) {
    throw new Error("Private evidence root must end with -private.");
  }
  return evidence;
}

export function randomBlindLabel() {
  return `response-${randomBytes(6).toString("hex")}`;
}

export function publicArtifactReceipt(id, stageRecord) {
  const value = stageRecord.value;
  const calls = Object.values(value?.providerTraces ?? {}).flat();
  return {
    id,
    sha256: sha256(value),
    stageFileSha256: null,
    completedAt: stageRecord.completedAt ?? null,
    calls: calls.map((call) => ({
      stage: call.request?.metadata?.stage ?? null,
      provider: call.response?.provider ?? null,
      requestedModel: call.response?.model ?? null,
      requestId: call.response?.requestId ?? null,
      responseId: call.response?.responseId ?? null,
      durationMs: call.durationMs ?? null,
      transport: call.response?.transport ?? null
    }))
  };
}

export function conditionResultReceipt(condition, replicate, value, contract) {
  const answer = value.result?.answer ?? value.response?.answer ?? "";
  const nextQuestion = value.result?.next_question ?? value.response?.next_question ?? "";
  return {
    condition,
    replicate,
    artifactSha256: sha256(value),
    answerSha256: sha256(answer),
    nextQuestionSha256: sha256(nextQuestion),
    processingTier: value.result?.processingTier ?? value.processingTier ?? null,
    routingReason: value.result?.routingReason ?? value.routingReason ?? null,
    rendererModel: value.result?.rendererModel ?? value.rendererModel ?? null,
    contract: {
      pass: contract.ok,
      responsePass: contract.response?.ok ?? false,
      planPass: (contract.plan?.missing ?? []).length === 0,
      missingResponse: contract.response?.missingRequired ?? [],
      forbiddenResponse: contract.response?.presentForbidden ?? [],
      missingPlan: contract.plan?.missing ?? []
    }
  };
}

export function aggregatePairwise(records) {
  const table = {};
  for (const record of records) {
    const key = record.contrast;
    table[key] ??= { calls: 0, orderConsistentPairs: 0, orderDisagreements: 0, ties: 0, wins: {} };
    const row = table[key];
    row.calls += 1;
    row.wins[record.winnerCondition] = (row.wins[record.winnerCondition] ?? 0) + (record.winnerCondition === "tie" ? 0 : 1);
    if (record.winnerCondition === "tie") row.ties += 1;
  }
  for (const [key, row] of Object.entries(table)) {
    const grouped = records.filter((record) => record.contrast === key).reduce((map, record) => {
      const pair = `${record.replicate}:${record.judge}`;
      (map[pair] ??= []).push(record.winnerCondition);
      return map;
    }, {});
    for (const winners of Object.values(grouped)) {
      if (winners.length === 2 && winners[0] === winners[1]) row.orderConsistentPairs += 1;
      else if (winners.length === 2) row.orderDisagreements += 1;
    }
  }
  return table;
}
