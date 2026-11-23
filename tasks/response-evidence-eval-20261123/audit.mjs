import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ClaudeCliProvider } from "../../src/providers/claude-cli.mjs";
import { runSubprocess } from "../../src/core/subprocess.mjs";
import { parseModelJson } from "../../src/core/json.mjs";
import { validatePrivateRuntimeAuditResult, validatePrivateRuntimeEvidenceAuditResult } from "../../src/schemas/private-runtime.mjs";
import { createCandidateAuditEvidence } from "../../src/supervisor/private-candidate-lifecycle.mjs";
import { PRIVATE_CANDIDATE_AUDIT_VERSION } from "../../src/supervisor/private-candidate-audit.mjs";
import { deriveEvidenceFindings, sha256Json } from "../../src/supervisor/response-evidence-contract.mjs";
import { DEFAULT_MODEL, DEFAULT_EFFORT, HARD_CAP, OPT_IN_ENV, RUN_SCHEMA, callId, exists, head, isolation, json, outsideRepository, packetId, privateDirectory, readJson, sha256 } from "./common.mjs";
import { emptyReview } from "./seal.mjs";
import { loadSealed } from "./selfcheck.mjs";

const STAGE = "private_candidate_audit";
const USAGE_LIMIT = /usage limit|limit reached|hit your (?:\w+ )?limit|reached your .{0,40}limit|(?:5|five)[- ]hour limit|weekly limit|rate[_ -]?limit|too many requests|\b429\b|credit balance is too low|out of (?:extra )?usage/iu;
export const RECEIPT_FILE = /^(.+)\.a(\d+)\.(started|result)\.json$/u;
const SETTINGS = ["mode", "requested_model", "effort", "provider", "sealed_manifest_sha256"];

export function buildSchedule(manifest, samples = 1) {
  if (![1, 2].includes(samples)) throw new Error("--samples must be 1 or 2.");
  const schedule = [];
  for (let sample = 1; sample <= samples; sample++) for (const spec of manifest.cases) for (const arm of ["G", "E"]) {
    const packet = packetId(spec.id, arm);
    schedule.push({ call: callId(packet, sample), packet, sample });
  }
  if (schedule.length > HARD_CAP || new Set(schedule.map((s) => s.call)).size !== schedule.length) throw new Error("Invalid call schedule.");
  return schedule;
}

export class MockAuditor {
  constructor({ sealed, faults = {} }) {
    this.id = "mock"; this.model = "deterministic-placeholder"; this.privateInferenceIsolation = isolation;
    this.sealed = sealed; this.faults = faults; this.generated = 0;
  }
  async generate(request) {
    const n = ++this.generated;
    const item = this.sealed.entries.find((i) => i.prompt.user === request.user && i.prompt.system === request.system);
    if (!item || request.sealed !== true || request.metadata.stage !== STAGE || request.metadata.freshContext !== true
        || sha256Json(request.outputSchema) !== sha256Json(item.outputSchema)) throw new Error("Mock received a request unlike the sealed runtime request.");
    const at = (name) => [].concat(this.faults[name] ?? []).includes(n);
    if (at("usageLimitAt")) throw new Error("You've hit your usage limit.");
    if (at("errorAt")) throw new Error("Synthetic provider failure.");
    const value = { findings: [], repair_induced_checks: item.packet.repair_induced_error_checks, ...(item.entry.arm === "E" ? { evidence_review: emptyReview() } : {}) };
    return { text: at("garbageAt") ? "Not a JSON review." : JSON.stringify(value), responseId: `mock:${request.metadata.attemptContextId}`,
      usage: { input_tokens: 100, output_tokens: 20 }, modelUsage: { "deterministic-placeholder": { inputTokens: 100, outputTokens: 20 } } };
  }
}

export async function executeAudit({ auditor, item, call, mode, model }) {
  const started = performance.now();
  let raw;
  try {
    raw = await auditor.generate({ ...item.prompt, outputSchema: item.outputSchema, sealed: true,
      metadata: { stage: STAGE, fixtureKey: STAGE, attemptContextId: call, freshContext: true } });
  } catch (error) {
    if (error.code === "PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE") return { outcome: "refused_before_call", error };
    return { outcome: USAGE_LIMIT.test(`${error.message} ${JSON.stringify(error.details ?? {})}`) ? "usage_limit" : "error",
      error: { name: error.name, code: error.code ?? null, message: error.message, details: error.details ?? null }, ms: performance.now() - started };
  }
  const models = Object.keys(raw.modelUsage ?? {});
  const base = { ms: performance.now() - started, provider: auditor.id, raw_text: raw.text, response_id: raw.responseId ?? raw.requestId ?? null,
    usage: raw.usage ?? null, model_usage: raw.modelUsage ?? null, effective_models: models,
    model_confirmed: mode === "mock" ? null : models.some((name) => name.startsWith(model)), stderr_tail: String(raw.stderr ?? "").slice(-1000) };
  if (USAGE_LIMIT.test(String(raw.text))) return { ...base, outcome: "usage_limit" };
  let result;
  try {
    const parsed = parseModelJson(raw.text, `private ${STAGE}`);
    const options = { reconstructed: item.packet.reconstruction_audit_required };
    // The E validator calls normalizeEvidenceReview with exactly these sealed bytes and trusted snapshot.
    result = item.entry.arm === "E"
      ? validatePrivateRuntimeEvidenceAuditResult(parsed, { ...options, candidateText: item.candidateText, snapshot: item.snapshot })
      : validatePrivateRuntimeAuditResult(parsed, options);
    if (!base.response_id) throw new Error("Private inference provider returned no response identifier.");
    const binding = item.packet.candidate_binding;
    const evidence = createCandidateAuditEvidence({ auditId: `eval:${call}`,
      candidate: { ...binding, exact_text: item.candidateText, producer_context_id: "context:sealed-external-writer" },
      auditVersion: PRIVATE_CANDIDATE_AUDIT_VERSION, auditorContext: { kind: "independent", context_id: `context:${sha256(`${auditor.id}:${auditor.model}:${base.response_id}`)}` },
      findings: result.findings, repairInducedChecks: result.repair_induced_checks, independentAuditorAvailable: true,
      ...(item.snapshot ? { responseEvidence: { snapshotId: item.snapshot.id, snapshotSha256: item.snapshot.snapshot_sha256,
        auditorInclusionSha256: sha256Json(item.packet.response_evidence), snapshot: item.snapshot, review: result.evidence_review } } : {}) });
    const derived = item.snapshot ? deriveEvidenceFindings(result.evidence_review) : [];
    const dimensions = item.snapshot ? [...new Set(result.evidence_review.items.filter((i) => derived.some((d) => d.id === `evidence:${i.id}`)).map((i) => i.dimension)
      .concat(result.evidence_review.missing_material_history.length ? ["history_dependent_advice"] : []))] : [];
    return { ...base, outcome: "ok", verdict: evidence.verdict, findings: evidence.findings, finding_ids: evidence.findings.map((f) => f.id),
      codes: evidence.findings.map((f) => f.code), derived_findings: derived, derived_dimensions: dimensions,
      evidence_review: result.evidence_review ?? null, unresolved_substantive_finding_ids: evidence.unresolved_substantive_finding_ids };
  } catch (error) {
    return { ...base, outcome: item.entry.arm === "E" ? "malformed" : "unusable", error: { name: error.name, code: error.code ?? null, message: error.message } };
  }
}

async function preflight(auditor) {
  const needed = ["print", "outputFormat", "jsonSchema", "model", "effort", "tools", "noSessionPersistence", "permissionMode", "noChrome", "safeMode", "strictMcpConfig"];
  const flags = (await auditor.capabilities())?.flags ?? {};
  const missing = needed.filter((flag) => !flags[flag]);
  if (missing.length) throw new Error(`Claude CLI lacks sealed-call flags: ${missing.join(", ")}. No model call was made.`);
  if (!flags.systemPromptFile && flags.systemPrompt && process.platform === "win32") throw new Error("This CLI cannot pass the system prompt safely on Windows.");
  const version = await runSubprocess({ command: auditor.command, args: ["--version"], timeoutMs: 30000, label: "Claude CLI version check" });
  if (version.code !== 0 || !version.stdout.trim()) throw new Error("Claude CLI version check failed.");
  return { claude_version: version.stdout.trim(), claude_command: auditor.command, flags_checked: needed,
    system_prompt_transport: flags.systemPromptFile ? "file" : flags.systemPrompt ? "argument" : "stdin" };
}

export async function readReceipts(dir) {
  const records = new Map();
  for (const name of (await fs.readdir(dir)).sort()) {
    const match = RECEIPT_FILE.exec(name);
    if (!match) throw new Error(`Unknown receipt file: ${name}`);
    const [, call, attempt, kind] = match;
    // No retry is permitted, including after a usage-limit response.
    if (Number(attempt) !== 1) throw new Error("Repeated call attempts are not admitted.");
    const record = records.get(call) ?? {};
    record[kind] = await readJson(path.join(dir, name));
    records.set(call, record);
  }
  return records;
}

async function writeResult(dir, call, value) {
  const temp = path.join(dir, `.${randomUUID()}.tmp`), final = path.join(dir, `${call}.a1.result.json`);
  if (await exists(final)) throw new Error("A result receipt already exists; never overwrite it.");
  await fs.writeFile(temp, json(value), { flag: "wx", mode: 0o600 });
  await fs.rename(temp, final);
}

export async function runAudit({ sealedDir, outDir, mode, limit = null, samples = 1, model = DEFAULT_MODEL, effort = DEFAULT_EFFORT, concurrency = 1,
  env = process.env, provider = null, faults = {}, onProgress = () => {} }) {
  // These guards precede *all* provider construction, flag probes and child processes.
  if (!["mock", "live"].includes(mode)) throw new Error("Choose --mock or --live explicitly.");
  if (mode === "live" && env[OPT_IN_ENV] !== "1") throw new Error(`Live audit requires ${OPT_IN_ENV}=1.`);
  if (mode === "live" && (Object.hasOwn(env, "ANTHROPIC_API_KEY") || Object.hasOwn(process.env, "ANTHROPIC_API_KEY"))) throw new Error("Live audit refuses ANTHROPIC_API_KEY in its environment.");
  if (mode === "live" && [env.INNER_SIGNAL_MODE, process.env.INNER_SIGNAL_MODE].some((v) => String(v).toLowerCase() === "api")) throw new Error("This evaluation refuses API mode.");
  if (mode === "live" && provider) throw new Error("Live audit uses only ClaudeCliProvider.");
  if (limit != null && (!Number.isInteger(limit) || limit < 1)) throw new Error("--limit must be a positive integer.");
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 3) throw new Error("--concurrency must be 1, 2 or 3.");
  if (![1, 2].includes(samples)) throw new Error("--samples must be 1 or 2.");
  if (typeof model !== "string" || !model.trim() || typeof effort !== "string" || !effort.trim()) throw new Error("Model and effort are required.");
  const sealed = await loadSealed(sealedDir), schedule = buildSchedule(sealed.manifest, samples);
  outDir = await outsideRepository(outDir);
  await privateDirectory(outDir);
  const lock = path.join(outDir, ".audit.lock");
  await fs.mkdir(lock, { mode: 0o700 }).catch(() => { throw new Error("This receipts folder has an active or interrupted audit lock; inspect it before another invocation."); });
  try {
    const receiptsDir = path.join(outDir, "receipts");
    await privateDirectory(receiptsDir);
    const request = { mode, requested_model: model, effort, provider: mode === "live" ? "anthropic" : provider?.id ?? "mock", sealed_manifest_sha256: sealed.manifestSha256 };
    const runFile = path.join(outDir, "run.json");
    if (await exists(runFile)) {
      const first = await readJson(runFile);
      if (first.schema !== RUN_SCHEMA || SETTINGS.some((key) => first[key] !== request[key])) throw new Error("Receipts folder was started with other settings; no call was made.");
      if (sha256(await fs.readFile(path.join(outDir, "sealed-manifest.json"))) !== sealed.manifestSha256) throw new Error("Receipts folder has a different sealed manifest.");
    } else {
      if ((await fs.readdir(receiptsDir)).length || await exists(path.join(outDir, "sealed-manifest.json"))) throw new Error("Receipts without run.json cannot be resumed.");
      await fs.writeFile(runFile, json({ schema: RUN_SCHEMA, ...request, repository_head: await head(), started_at: new Date().toISOString(), node: process.version }), { flag: "wx", mode: 0o600 });
      await fs.writeFile(path.join(outDir, "sealed-manifest.json"), sealed.manifestBytes, { flag: "wx", mode: 0o600 });
    }
    const history = await readReceipts(receiptsDir), allCalls = new Set(buildSchedule(sealed.manifest, 2).map((s) => s.call));
    for (const [call, record] of history) {
      if (!allCalls.has(call) || !record.started || record.started.call !== call || SETTINGS.some((key) => record.started[key] !== request[key])) throw new Error("Unknown or mismatched call receipt.");
      if (!record.result) {
        record.result = { ...record.started, outcome: "ambiguous_not_retried", note: "Started with no result; may have been billed, never retried." };
        await writeResult(receiptsDir, call, record.result);
      }
    }
    const counted = () => [...history.values()].filter((r) => r.result?.outcome !== "usage_limit").length;
    const effectiveLimit = Math.min(limit ?? HARD_CAP, HARD_CAP);
    let used = counted(), startedNow = 0, stop = null, failures = 0;
    const pending = schedule.filter((s) => !history.has(s.call));
    // A resumed invocation at its limit never probes the CLI.
    let auditor = provider, preflightReceipt = null;
    if (pending.length && used < effectiveLimit) {
      if (mode === "live") {
        auditor = new ClaudeCliProvider({ command: env.CLAUDE_COMMAND ?? process.env.CLAUDE_COMMAND ?? "claude", model, effort, isolateConfig: true });
        preflightReceipt = await preflight(auditor);
      } else auditor ??= new MockAuditor({ sealed, faults });
    }
    const tally = {};
    async function attempt(slot) {
      const item = sealed.byId.get(slot.packet);
      const started = { ...request, ...slot, attempt: 1, system_sha256: item.entry.system.sha256, user_sha256: item.entry.user.sha256,
        output_schema_sha256: item.entry.output_schema.sha256, started_at: new Date().toISOString() };
      await fs.writeFile(path.join(receiptsDir, `${slot.call}.a1.started.json`), json(started), { flag: "wx", mode: 0o600 });
      const outcome = await executeAudit({ auditor, item, call: slot.call, mode, model });
      if (outcome.outcome === "refused_before_call") {
        await fs.unlink(path.join(receiptsDir, `${slot.call}.a1.started.json`)); used--; stop ??= "isolation_unavailable";
        throw outcome.error;
      }
      const result = { ...started, ...outcome, finished_at: new Date().toISOString() };
      await writeResult(receiptsDir, slot.call, result);
      history.set(slot.call, { started, result });
      tally[result.outcome] = (tally[result.outcome] ?? 0) + 1;
      if (result.outcome === "usage_limit") { used--; stop ??= "usage_limit"; }
      else if (result.outcome === "ok") failures = 0;
      else if (++failures >= 3) stop ??= "three_failures_in_a_row";
      if (mode === "live" && result.outcome === "ok" && result.model_confirmed === false) stop ??= "model_not_confirmed";
      onProgress({ call: slot.call, outcome: result.outcome, verdict: result.verdict ?? null });
    }
    // A sample barrier ensures that no second sample starts while a first-sample call is still running.
    for (let sample = 1; sample <= samples && !stop; sample++) {
      const own = pending.filter((s) => s.sample === sample);
      let next = 0, firstError;
      async function worker() {
        while (!stop && next < own.length) {
          if (used >= effectiveLimit) { stop = effectiveLimit === HARD_CAP ? "hard_cap" : "limit"; return; }
          const slot = own[next++]; used++; startedNow++;
          try { await attempt(slot); } catch (error) { firstError ??= error; stop ??= "receipt_or_provider_refusal"; }
        }
      }
      await Promise.all(Array.from({ length: concurrency }, worker));
      if (firstError) throw firstError;
    }
    const summary = { stop_reason: stop ?? "completed", mode, samples, calls_scheduled: schedule.length, started_now: startedNow, counted_total: counted(),
      remaining: schedule.filter((s) => !history.has(s.call)).length, this_run: tally };
    await fs.appendFile(path.join(outDir, "invocations.jsonl"), `${JSON.stringify({ ...request, samples, concurrency, limit, preflight: preflightReceipt, summary })}\n`, { mode: 0o600 });
    await fs.writeFile(path.join(outDir, "summary.json"), json(summary), { mode: 0o600 });
    return summary;
  } finally { await fs.rmdir(lock); }
}
