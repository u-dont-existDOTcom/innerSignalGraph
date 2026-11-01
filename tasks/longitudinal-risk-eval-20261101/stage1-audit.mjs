import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../../src/core/config.mjs";
import { ProviderError } from "../../src/core/errors.mjs";
import { parseModelJson } from "../../src/core/json.mjs";
import { runSubprocess } from "../../src/core/subprocess.mjs";
import { createProviders } from "../../src/providers/factory.mjs";
import { privateRuntimeAuditPrompt } from "../../src/prompts/private-runtime-audit.mjs";
import { privateRuntimeAuditResultSchema, validatePrivateRuntimeAuditResult } from "../../src/schemas/private-runtime.mjs";
import { PRIVATE_CANDIDATE_AUDIT_VERSION } from "../../src/supervisor/private-candidate-audit.mjs";
import { createCandidateAuditEvidence } from "../../src/supervisor/private-candidate-lifecycle.mjs";
import { sha256 } from "./corpus.mjs";
import { CHARS_PER_TOKEN, MANIFEST_SCHEMA, PLAN_CHARS, STAGE1, callId, packetId } from "./stage1-seal.mjs";

// Stage 1, step 2: send each sealed prompt to the auditor and keep what comes back. The prompt is exactly privateRuntimeAuditPrompt(packet);
// the runtime's own createCandidateAuditEvidence decides block or pass. Everything this file writes goes to the receipts folder, outside
// Git. The live path calls `claude -p` through the repository's own sealed Claude CLI provider; the mock path calls no model.
//
// Guards, all of which hold before the first byte is sent:
//  - a hard cap of 144 calls that may have been billed, whatever the options say (a rejection by the usage limit is not billed and is not counted);
//  - --limit N stops after N such calls in the receipts folder in total, counting earlier runs, so repeating a command spends nothing more;
//  - the first usage-limit error stops the run, and no call is retried: a call that failed, timed out or was cut off is recorded and left alone;
//  - three failures in a row stop the run; the first live call must name the requested model among the models that answered;
//  - a live run needs --live and INNER_SIGNAL_EVAL_ALLOW_SUBSCRIPTION_CLI=1, refuses API mode, and checks the Claude CLI's flags and version first;
//  - every sealed byte and every prompt is checked against its SHA-256 before the first call.
export const HARD_CAP = 144;
export const OPT_IN_ENV = "INNER_SIGNAL_EVAL_ALLOW_SUBSCRIPTION_CLI";
export const CONSECUTIVE_FAILURES_STOP = 3;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// What the Claude CLI says when a subscription limit is reached, in the forms seen so far. It errs towards stopping: a message that merely
// looks like a limit ends the run, and the run can be repeated once the cause is understood.
const USAGE_LIMIT = /usage limit|limit reached|hit your (?:\w+ )?limit|reached your .{0,40}limit|(?:5|five)[- ]hour limit|weekly limit|rate[_ -]?limit|too many requests|\b429\b|credit balance is too low|out of (?:extra )?usage/iu;
const STAGE = "private_candidate_audit";
const json = (value) => `${JSON.stringify(value, null, 1)}\n`;
const exists = (file) => fs.stat(file).then(() => true, () => false);

// ---- the sealed folder -----------------------------------------------------------------------------------------------------------------

export async function loadSealed(sealedDir) {
  const manifestBytes = await fs.readFile(path.join(sealedDir, "manifest.json"));
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (manifest.schema !== MANIFEST_SCHEMA) throw new Error("This is not a sealed stage 1 folder.");
  const systemPrompt = await fs.readFile(path.join(sealedDir, manifest.system_prompt.file), "utf8");
  if (sha256(systemPrompt) !== manifest.system_prompt.sha256) throw new Error("The sealed system prompt was changed after sealing.");
  const entries = [];
  for (const entry of manifest.packets) {
    const bytes = await fs.readFile(path.join(sealedDir, entry.file));
    if (sha256(bytes) !== entry.packet_sha256 || bytes.length !== entry.packet_bytes) throw new Error(`${entry.id}: the sealed packet was changed after sealing.`);
    const userText = await fs.readFile(path.join(sealedDir, entry.user_file), "utf8");
    if (sha256(userText) !== entry.user_sha256) throw new Error(`${entry.id}: the sealed prompt text was changed after sealing.`);
    const packet = JSON.parse(bytes.toString("utf8"));
    const prompt = privateRuntimeAuditPrompt(packet);
    if (prompt.system !== systemPrompt || prompt.user !== userText) throw new Error(`${entry.id}: this checkout builds a different prompt from the sealed packet. Seal again with this checkout, or use the checkout that sealed it.`);
    entries.push({ entry, packet, prompt });
  }
  return { manifest, manifestSha256: sha256(manifestBytes), systemPrompt, entries, byId: new Map(entries.map((item) => [item.entry.id, item])) };
}

// Sample by sample; inside a sample the unseeded-reply packets first (arm T, then H, for U, then G, then O), one decision turn after another, so
// the first 8 calls cover every decision turn and the first 12 cover both arms. The order has no other meaning.
const WITHIN_SAMPLE = Object.freeze(["T.U", "H.U", "T.G", "H.G", "T.O", "H.O"]);
export function buildSchedule(manifest) {
  const schedule = [];
  for (let sample = 1; sample <= manifest.design.samples; sample += 1) {
    for (const slot of WITHIN_SAMPLE) {
      const [arm, seed] = slot.split(".");
      for (const decision of manifest.decisions) {
        const packet = packetId(decision.id, arm, seed);
        schedule.push({ call: callId(packet, sample), packet, sample });
      }
    }
  }
  const known = new Set(manifest.packets.map((entry) => entry.id));
  if (schedule.length !== HARD_CAP || schedule.some((item) => !known.has(item.packet)) || new Set(schedule.map((item) => item.call)).size !== schedule.length) {
    throw new Error(`The sealed folder does not describe exactly ${HARD_CAP} distinct calls.`);
  }
  return schedule;
}

// The sizes of what will be sent, recomputed from the sealed bytes (not from the manifest's own figures) and set beside the plan's.
export async function sealedSizes(sealedDir) {
  const sealed = await loadSealed(sealedDir);
  const system = sealed.systemPrompt.length;
  const rows = sealed.manifest.decisions.map((decision) => {
    const own = (arm) => sealed.byId.get(packetId(decision.id, arm, "G"));
    const T = own("T").prompt.user.length;
    const H = own("H").prompt.user.length;
    const plan = PLAN_CHARS[decision.id] ?? null;
    return { decision: decision.id, T_prompt_user_chars: T, H_prompt_user_chars: H, H_removed_chars: T - H, T_total_chars_with_system: T + system, T_est_input_tokens: Math.round((T + system) / CHARS_PER_TOKEN), plan_chars: plan, T_vs_plan: plan ? Math.round((T / plan) * 100) / 100 : null };
  });
  const totalChars = sealed.entries.reduce((sum, item) => sum + (item.prompt.user.length + system) * sealed.manifest.design.samples, 0);
  const recorded = sealed.manifest.sizes.total_input_chars_all_calls;
  return { system_prompt_chars: system, plan_system_prompt_chars: sealed.manifest.sizes.plan.system_prompt_chars, rows, calls: sealed.manifest.design.calls, total_input_chars_all_calls: totalChars, matches_manifest: totalChars === recorded,
    est_input_tokens_all_calls: Math.round(totalChars / CHARS_PER_TOKEN), est_output_tokens_all_calls_at_2000_each: sealed.manifest.design.calls * 2000, plan: { input_tokens: sealed.manifest.sizes.plan.input_tokens, output_tokens: sealed.manifest.sizes.plan.output_tokens } };
}

// ---- receipts ----------------------------------------------------------------------------------------------------------------------------

async function readReceipts(dir) {
  await fs.mkdir(dir, { recursive: true });
  const history = new Map();
  for (const name of (await fs.readdir(dir)).sort()) {
    const match = /^(.+)\.a(\d+)\.(started|result)\.json$/u.exec(name);
    if (!match) continue;
    const [, call, attempt, kind] = match;
    const record = history.get(call) ?? { attempts: new Map() };
    const slot = record.attempts.get(Number(attempt)) ?? {};
    slot[kind] = JSON.parse(await fs.readFile(path.join(dir, name), "utf8"));
    record.attempts.set(Number(attempt), slot);
    history.set(call, record);
  }
  return history;
}

async function writeResult(dir, base, result) {
  const temporary = path.join(dir, `.${base}.result.tmp`);
  await fs.writeFile(temporary, json(result));
  await fs.rename(temporary, path.join(dir, `${base}.result.json`));
}

// A call is finished unless every attempt so far was a clean rejection by the usage limit. A started attempt with no result (the process was
// stopped, or the machine slept, mid-call) is ambiguous: it is recorded as such and never repeated.
async function settle(dir, history) {
  let ambiguous = 0;
  for (const [call, record] of history) {
    for (const [attempt, slot] of record.attempts) {
      if (slot.result) continue;
      slot.result = { call, attempt, outcome: "ambiguous_not_retried", note: "Started, never finished: the call may have been billed, so it is not repeated.", settled_at: new Date().toISOString() };
      await writeResult(dir, `${call}.a${attempt}`, slot.result);
      ambiguous += 1;
    }
  }
  return ambiguous;
}

const finished = (record) => record != null && [...record.attempts.values()].some((slot) => slot.result.outcome !== "usage_limit");
const counted = (history) => [...history.values()].reduce((sum, record) => sum + [...record.attempts.values()].filter((slot) => slot.result?.outcome !== "usage_limit").length, 0);

// ---- the auditor -------------------------------------------------------------------------------------------------------------------------

// A scripted stand-in for the auditor, used only to prove the pipeline end to end. It finds what the labels in the sealed manifest say a good
// auditor would, with four planted misses so that every miss path of the scorer is exercised. It says nothing about the real auditor.
export const PLANTED = Object.freeze({
  "A1-t11.H.U.s2": "drop_blocking",
  "A8-t30.T.G.s3": "add_blocking",
  "A5v-t8.T.U.s1": "drop_underreaction",
  "A7-t28.H.G.s2": "add_overreaction"
});

export function scriptedFindings(entry, call) {
  const expected = entry.expectations;
  const planted = PLANTED[call] ?? null;
  const findings = [];
  const add = (code, severity, summary) => findings.push({ id: `scripted-${findings.length + 1}`, code, severity, summary, evidence_turn_ids: [] });
  if ((expected.blocking === "required" && planted !== "drop_blocking") || planted === "add_blocking") add("SCRIPTED_REPLY_IGNORES_DISCLOSURE", "high", "Scripted stand-in finding.");
  if (expected.underreaction === "expected" && planted !== "drop_underreaction") add("SELF_DIRECTED_RISK_UNDERREACTION", "high", "Scripted stand-in finding.");
  if (expected.overreaction === "expected" || planted === "add_overreaction") add("SELF_DIRECTED_RISK_OVERREACTION", "medium", "Scripted stand-in finding.");
  if (expected.context_missing === "expected") add("LONGITUDINAL_CONTEXT_MISSING", "low", "Scripted stand-in finding.");
  return findings;
}

export class MockAuditor {
  constructor({ sealed, faults = {} }) {
    this.id = "anthropic";
    this.model = "mock-auditor";
    this.privateInferenceIsolation = Object.freeze({ packetOnly: true, freshContextPerGenerate: true, tools: false, filesystem: false, sessionPersistence: false });
    this.byUserHash = new Map(sealed.entries.map((item) => [item.entry.user_sha256, item.entry]));
    this.systemSha256 = sealed.manifest.system_prompt.sha256;
    this.faults = faults;
    this.generated = 0;
  }

  async capabilities() { return null; }

  async generate({ system, user, outputSchema, metadata, sealed }) {
    this.generated += 1;
    const n = this.generated;
    if (sealed !== true || metadata?.stage !== STAGE || metadata?.freshContext !== true || outputSchema !== privateRuntimeAuditResultSchema) throw new Error("The mock auditor was not called the way the runtime calls its auditor.");
    const entry = this.byUserHash.get(sha256(user));
    if (!entry || sha256(system) !== this.systemSha256) throw new Error("The mock auditor was sent a prompt that is not a sealed one.");
    const at = (name) => [].concat(this.faults[name] ?? []).includes(n);
    if (at("usageLimitAt")) throw new ProviderError("Claude CLI exited with status 1.", { details: { stage: STAGE, stderr: "", stdout: JSON.stringify({ type: "result", is_error: true, result: "You've hit your limit. It resets at 5pm." }) } });
    if (at("errorAt")) throw new ProviderError("Claude CLI exited with status 1.", { details: { stage: STAGE, stderr: "Simulated failure.", stdout: "" } });
    if (at("timeoutAt")) throw new ProviderError("Claude CLI private_candidate_audit timed out after 900000 ms.");
    const call = metadata.attemptContextId;
    const findings = scriptedFindings(entry, call);
    const text = at("garbageAt") ? "This is not JSON." : JSON.stringify({ findings, repair_induced_checks: [] });
    const input = Math.round((system.length + user.length) / 3.3);
    return {
      provider: this.id, model: this.model, text, requestId: `mock-${n}`, responseId: `mock-session-${sha256(call).slice(0, 16)}`,
      usage: { input_tokens: input, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 300 + 80 * findings.length },
      modelUsage: { "mock-auditor": { inputTokens: input, outputTokens: 300 + 80 * findings.length } }, transport: "mock", stderr: ""
    };
  }
}

async function preflightLive(auditor, config) {
  const needed = ["print", "outputFormat", "jsonSchema", "model", "effort", "tools", "maxTurns", "noSessionPersistence", "permissionMode", "noChrome", "safeMode", "strictMcpConfig"];
  const flags = (await auditor.capabilities())?.flags ?? {};
  const missing = needed.filter((name) => !flags[name]);
  if (missing.length) throw new Error(`The installed Claude CLI lacks the flags the sealed provider needs: ${missing.join(", ")}. No call was made.`);
  // The provider passes the 91 KB system prompt as a file when the CLI has --system-prompt-file, else as an argument, else on stdin.
  const systemPromptTransport = flags.systemPromptFile ? "file" : flags.systemPrompt ? "argument" : "stdin";
  if (systemPromptTransport === "argument" && process.platform === "win32") throw new Error("This CLI has no --system-prompt-file, and Windows cannot pass the 91 KB system prompt as an argument. No call was made.");
  const version = await runSubprocess({ command: config.claudeCommand, args: ["--version"], timeoutMs: 30000, label: "Claude CLI version check" });
  return { claude_command: config.claudeCommand, claude_version: version.stdout.trim(), flags_checked: needed, system_prompt_transport: systemPromptTransport, request_timeout_ms: config.requestTimeoutMs, isolate_config: config.cliIsolateConfig, platform: process.platform };
}

const textOf = (error) => `${error?.message ?? ""} ${JSON.stringify(error?.details ?? {})}`;
const sum = (...values) => values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
const tokensIn = (usage) => sum(usage?.input_tokens, usage?.cache_creation_input_tokens, usage?.cache_read_input_tokens);

// One call: send, classify, and (when the answer is usable) let the runtime's own function decide block or pass.
async function execute({ auditor, item, call, mode, requestedModel }) {
  const started = Date.now();
  const { entry, packet, prompt } = item;
  let raw;
  try {
    raw = await auditor.generate({ ...prompt, outputSchema: privateRuntimeAuditResultSchema, metadata: { stage: STAGE, fixtureKey: STAGE, attemptContextId: call, freshContext: true }, sealed: true });
  } catch (error) {
    return { outcome: USAGE_LIMIT.test(textOf(error)) ? "usage_limit" : "error", error: { name: error?.name, code: error?.code ?? null, message: String(error?.message).slice(0, 400), details: JSON.stringify(error?.details ?? {}).slice(0, 2500) }, ms: Date.now() - started };
  }
  const base = { ms: Date.now() - started, provider: auditor.id, requested_model: requestedModel, response_id: raw.responseId ?? raw.requestId ?? null, usage: raw.usage ?? null, model_usage: raw.modelUsage ?? null, raw_text: raw.text, stderr_tail: String(raw.stderr ?? "").slice(-500) };
  let result;
  try {
    result = validatePrivateRuntimeAuditResult(parseModelJson(raw.text, `private ${STAGE}`), { reconstructed: false });
  } catch (error) {
    return { ...base, outcome: USAGE_LIMIT.test(String(raw.text).slice(0, 2000)) ? "usage_limit" : "unusable", error: { name: error?.name, message: String(error?.message).slice(0, 400) } };
  }
  const responseId = raw.responseId ?? raw.requestId;
  let evidence;
  try {
    const binding = packet.candidate_binding;
    evidence = createCandidateAuditEvidence({
      auditId: `stage1-audit:${call}`,
      candidate: { id: binding.id, version: binding.version, status: binding.status, exact_text: packet.candidate_response, parent_candidate_id: binding.parent_candidate_id ?? null, producer_context_id: "context:stage1-seeded-reply" },
      auditVersion: PRIVATE_CANDIDATE_AUDIT_VERSION,
      auditorContext: { kind: "independent", context_id: `context:${sha256(`${auditor.id}:${auditor.model}:${responseId}`)}` },
      findings: result.findings,
      repairInducedChecks: result.repair_induced_checks,
      independentAuditorAvailable: true
    });
  } catch (error) {
    return { ...base, outcome: "unusable", result, error: { name: error?.name, message: String(error?.message).slice(0, 400) } };
  }
  const models = Object.keys(raw.modelUsage ?? {});
  return {
    ...base, outcome: "ok", packet: entry.id,
    effective_models: models, model_confirmed: mode === "mock" ? null : models.some((name) => name.startsWith(requestedModel)),
    verdict: evidence.verdict, blocked: evidence.verdict === "fail",
    findings: evidence.findings.map(({ id, code, severity, reported_severity: reported, record_only: recordOnly, unresolved, summary, evidence_turn_ids: turnIds }) => ({ id, code, severity, reported_severity: reported ?? null, record_only: recordOnly === true, unresolved: unresolved !== false, summary, evidence_turn_ids: turnIds ?? [] })),
    unresolved_substantive_finding_ids: evidence.unresolved_substantive_finding_ids
  };
}

// ---- the run -----------------------------------------------------------------------------------------------------------------------------

export async function runStage1Audit({ sealedDir, outDir, mode, limit = null, model = STAGE1.model, effort = STAGE1.effort, concurrency = 1, hardCap = HARD_CAP, provider = null, faults = {}, onProgress = () => {}, env = process.env }) {
  if (mode !== "mock" && mode !== "live") throw new Error("Choose --mock or --live.");
  if (!Number.isInteger(hardCap) || hardCap < 1 || hardCap > HARD_CAP) throw new Error(`The hard cap cannot be above ${HARD_CAP}.`);
  if (limit != null && (!Number.isInteger(limit) || limit < 1)) throw new Error("--limit must be a whole number of at least 1.");
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 3) throw new Error("--concurrency must be 1, 2 or 3.");
  if (mode === "live" && env[OPT_IN_ENV] !== "1") throw new Error(`A live run spends the subscription's usage. Set ${OPT_IN_ENV}=1 to confirm that this machine's Claude CLI is signed in to the subscription meant to pay for it.`);
  if (mode === "live" && String(env.INNER_SIGNAL_MODE ?? "").toLowerCase() === "api") throw new Error("This harness does not run through the paid API.");
  if (mode === "live" && provider) throw new Error("A live run uses the repository's Claude CLI provider only.");

  const sealed = await loadSealed(sealedDir);
  const schedule = buildSchedule(sealed.manifest);
  const receiptsDir = path.join(outDir, "receipts");
  await fs.mkdir(receiptsDir, { recursive: true });
  const manifestCopy = path.join(outDir, "sealed-manifest.json");
  if (await exists(manifestCopy)) {
    if (sha256(await fs.readFile(manifestCopy)) !== sealed.manifestSha256) throw new Error("This receipts folder belongs to a different sealed folder. Use a new folder.");
  } else {
    await fs.copyFile(path.join(sealedDir, "manifest.json"), manifestCopy);
  }

  let auditor = provider;
  let preflight = null;
  if (mode === "live") {
    const config = loadConfig({ mode: "cli", anthropicModel: model, claudeEffort: effort }, { providers: ["anthropic"] });
    auditor = createProviders(config, { providers: ["anthropic"] }).anthropic;
    preflight = await preflightLive(auditor, config);
  } else {
    auditor ??= new MockAuditor({ sealed, faults });
  }

  const history = await readReceipts(receiptsDir);
  const ambiguousSettled = await settle(receiptsDir, history);
  const effectiveLimit = Math.min(limit ?? hardCap, hardCap);
  const pending = schedule.filter((item) => !finished(history.get(item.call)));
  const invocation = {
    started_at: new Date().toISOString(), mode, requested_model: model, effort, limit, effective_limit: effectiveLimit, hard_cap: hardCap, concurrency,
    sealed_manifest_sha256: sealed.manifestSha256, node: process.version, repository_head: (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim(); } catch { return null; } })(),
    preflight, counted_before: counted(history), finished_before: schedule.length - pending.length, ambiguous_settled_now: ambiguousSettled
  };
  if (!(await exists(path.join(outDir, "run.json")))) await fs.writeFile(path.join(outDir, "run.json"), json({ schema: "longitudinal-risk-stage1-run-v1", ...invocation }));

  const state = { counted: counted(history), next: 0, stop: null, failuresInARow: 0 };
  const tally = { ok: 0, usage_limit: 0, error: 0, unusable: 0, blocked: 0, passed: 0, ms: 0, input_tokens: 0, output_tokens: 0 };
  async function attempt(item) {
    const attemptNumber = (history.get(item.call)?.attempts.size ?? 0) + 1;
    const base = `${item.call}.a${attemptNumber}`;
    const entry = sealed.byId.get(item.packet);
    const started = { call: item.call, packet: item.packet, sample: item.sample, attempt: attemptNumber, mode, requested_model: model, effort, system_sha256: sealed.manifest.system_prompt.sha256, user_sha256: entry.entry.user_sha256, started_at: new Date().toISOString() };
    await fs.writeFile(path.join(receiptsDir, `${base}.started.json`), json(started), { flag: "wx" });
    const outcome = await execute({ auditor, item: entry, call: item.call, mode, requestedModel: model });
    const result = { ...started, finished_at: new Date().toISOString(), ...outcome };
    await writeResult(receiptsDir, base, result);
    await fs.appendFile(path.join(outDir, "calls.jsonl"), `${JSON.stringify({ call: item.call, attempt: attemptNumber, outcome: result.outcome, blocked: result.blocked ?? null, codes: (result.findings ?? []).map((finding) => finding.code), ms: result.ms })}\n`);
    return result;
  }
  async function worker() {
    for (;;) {
      if (state.stop) return;
      const item = pending[state.next];
      if (!item) return;
      if (state.counted >= effectiveLimit) { state.stop = effectiveLimit >= hardCap ? "hard_cap" : "limit"; return; }
      state.next += 1;
      state.counted += 1;
      const result = await attempt(item);
      tally[result.outcome] = (tally[result.outcome] ?? 0) + 1;
      tally.ms += result.ms ?? 0;
      tally.input_tokens += tokensIn(result.usage);
      tally.output_tokens += sum(result.usage?.output_tokens);
      if (result.outcome === "ok") { tally[result.blocked ? "blocked" : "passed"] += 1; }
      if (result.outcome === "usage_limit") { state.counted -= 1; state.stop ??= "usage_limit"; }
      if (result.outcome === "ok") state.failuresInARow = 0;
      else if (result.outcome !== "usage_limit" && (state.failuresInARow += 1) >= CONSECUTIVE_FAILURES_STOP) state.stop ??= "three_failures_in_a_row";
      if (mode === "live" && result.outcome === "ok" && result.model_confirmed === false) state.stop ??= "model_not_confirmed";
      onProgress({ call: result.call, outcome: result.outcome, blocked: result.blocked ?? null, ms: result.ms, counted: state.counted, stop: state.stop });
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));

  const stopReason = state.stop ?? (state.next >= pending.length ? "completed" : "stopped");
  const after = await readReceipts(receiptsDir);
  const summary = {
    stop_reason: stopReason, mode, requested_model: model, calls_scheduled: schedule.length, started_now: state.next, counted_total: counted(after),
    finished_total: schedule.filter((item) => finished(after.get(item.call))).length, remaining: schedule.filter((item) => !finished(after.get(item.call))).length,
    this_run: tally, ambiguous_not_retried_total: [...after.values()].flatMap((record) => [...record.attempts.values()]).filter((slot) => slot.result.outcome === "ambiguous_not_retried").length,
    receipts: path.resolve(receiptsDir)
  };
  await fs.appendFile(path.join(outDir, "invocations.jsonl"), `${JSON.stringify({ ...invocation, finished_at: new Date().toISOString(), summary })}\n`);
  await fs.writeFile(path.join(outDir, "summary.json"), json(summary));
  return summary;
}
