import fs from "node:fs/promises";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { longitudinalClinicalRules } from "../prompts/common.mjs";

// This is a projection, never a redacted copy. No stored object (including a receipt) is spread or serialized here.
// Timestamps are parsed and re-emitted; names have bounded alphabets; model prose has no output field.
const ROLES = new Set(["R1", "R2", "R3", "W", "W-repair", "C1", "C2", "C3", "C4", "C5", "CW"]);
const LEVELS = new Set(["none", "unclear", "thoughts_no_intent", "wants_to_die", "acted_or_about_to"]);
const FAILURES = new Set(["TIMEOUT", "PLAN_LIMIT", "SIGN_IN_NEEDED", "REFUSED", "PROVIDER_FAILED", "PROVIDER_MALFORMED", "CODEX_RECEIPT_INCOMPLETE", "CODEX_ACTION_TAKEN", "RUNNER_SETTINGS_INVALID", "PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE", "REPAIR_UNCHANGED", "PRIVATE_INFERENCE_CONTEXT_REUSED"]);
const REASONS = new Set(["checks_failed", "plan_limit", "sign_in_needed", "timeout", "refused", "provider_failed", "interrupted"]);
// Fixed codes only: the rules' own failure codes (each a "- CODE: " line in them, so a rule's code needs no copy here that could go
// stale), and those of the trial's checkers (worker-prompts.mjs), its program checks (program-checks.mjs) and the evidence review.
// Checkers can invent codes; those are counted as UNSPECIFIED_FINDING, never copied as prose.
const RULE_FINDINGS = Array.from(longitudinalClinicalRules.matchAll(/^- ([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+): /gmu), ([, code]) => code);
const TRIAL_FINDINGS = `
  CHILD_CONTACT_WHILE_RESTRICTED CRISIS_FIRST_REPLY_SHAPE CRISIS_FIRST_STEP_MISSING CRISIS_LEVEL_MISREAD CRISIS_NEVER_LIST
  LONGITUDINAL_CONTEXT_MISSING PROGRAM_CHILD_CONTACT_PATTERN PROGRAM_DETOX_WORD PROGRAM_EMPTY_REPLY
  PROGRAM_FIRST_CRISIS_REPLY_SHAPE PROGRAM_JOURNAL_IN_CRISIS PROGRAM_NO_EMERGENCY_NUMBER PROGRAM_NUMBER_WITHOUT_CRISIS
  PROGRAM_OWNER_LINK_NOT_ALLOWED PROGRAM_QUOTE_NOT_EXACT QUOTE_NOT_EXACT RESPONSE_EVIDENCE_CONTRADICTED
  RESPONSE_EVIDENCE_MISSING_HISTORY RESPONSE_EVIDENCE_SOURCE_INCOMPATIBLE RESPONSE_EVIDENCE_UNSUPPORTED
  SELF_DIRECTED_RISK_OVERREACTION SELF_DIRECTED_RISK_UNDERREACTION STORAGE_DESCRIBED
`.trim().split(/\s+/u);
const FINDINGS = new Set([...RULE_FINDINGS, ...TRIAL_FINDINGS]);
/** A finding's code when it is one of the fixed ones, else UNSPECIFIED_FINDING: never a name a model made up. */
export const fixedFindingCode = (code) => (FINDINGS.has(code) ? code : "UNSPECIFIED_FINDING");
const number = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
const name = (v) => typeof v === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,95}$/u.test(v) ? v : null;
const stamp = (v) => typeof v === "string" && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
const elapsed = (start, end) => start && end ? Math.max(0, Date.parse(end) - Date.parse(start)) : null;
const array = (v) => Array.isArray(v) ? v : [];
const failure = (v) => v == null ? null : FAILURES.has(v) ? v : "PROVIDER_FAILED";
const provider = (v) => ["claude", "codex"].includes(v) ? v : null;
const rules = (v) => ({ version: typeof v?.version === "string" && /^\d+\.\d+\.\d+$/u.test(v.version) ? v.version : null, sha256: /^[a-f0-9]{64}$/u.test(v?.sha256) ? v.sha256 : null, source: /^stable [a-f0-9]{7,40}$/u.test(v?.source) ? v.source : "checkout" });
const arrangement = (v) => ({ writerMode: ["whole", "focused"].includes(v?.writerMode) ? v.writerMode : null, checkerMode: ["whole", "split"].includes(v?.checkerMode) ? v.checkerMode : null, readers: array(v?.readers).map(provider), writer: array(v?.writer).map(provider), checkers: array(v?.checkers).map(provider) });
export const RUNNER_LOG_TOKEN_FIELDS = Object.freeze(["input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens", "output_tokens", "reasoning_output_tokens"]);
const emptyTokens = () => ({ input_tokens: null, cache_read_input_tokens: null, cache_creation_input_tokens: null, output_tokens: null, reasoning_output_tokens: null });
function addTokens(into, call) {
  for (const field of RUNNER_LOG_TOKEN_FIELDS) if (call[field] !== null) into[field] = (into[field] ?? 0) + call[field];
}
function worker(receipt, legacyParts = []) {
  if (!ROLES.has(receipt?.role)) return null;
  const out = {
    role: receipt.role, attempt: number(receipt.attempt), provider: name(receipt.provider), model: receipt.model === "codex default" ? "codex default" : name(receipt.model), effort: ["low", "medium", "high", "xhigh", "max"].includes(receipt.effort) ? receipt.effort : null, duration_ms: number(receipt.duration_ms), failure_code: failure(receipt.failed)
  };
  for (const field of RUNNER_LOG_TOKEN_FIELDS) out[field] = number(receipt[field]);
  const parts = Array.isArray(receipt.rule_parts) ? receipt.rule_parts : array(legacyParts);
  out.rule_parts = parts.flatMap((part) => name(part?.id) ? [{ name: part.id, bytes: number(part.bytes) }] : []);
  return out;
}
function distribution(values) {
  const sorted = values.filter((v) => v !== null).sort((a, b) => a - b);
  const middle = sorted.length / 2;
  return { count: sorted.length, median: sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(middle)]) / 2 : null, p90: sorted.length ? sorted[Math.ceil(sorted.length * .9) - 1] : null };
}
const counts = (map, field) => [...map].map(([code, count]) => ({ [field]: code, count })).sort((a, b) => b.count - a.count || a[field].localeCompare(b[field]));

export function runnerLogFromRecord(record) {
  const turns = [];
  const failureCounts = new Map();
  for (const [index, turn] of array(record?.runtime_turns).entries()) {
    if (!["DELIVERED", "UNANSWERED"].includes(turn.state)) continue;
    const started = stamp(turn.created_at);
    const ended = stamp(turn.delivery?.delivered_at ?? turn.closure?.closed_at);
    const first = [stamp(turn.provisional?.shown_at), stamp(turn.emergency_line_shown_at), ended].filter(Boolean).sort()[0] ?? null;
    const calls = [];
    // Readers are also copied into a successful candidate event. Read them here once, even if writing failed.
    for (const key of ["crisis", "boxes", "protection"]) for (const receipt of array(turn.runner_reading?.readers?.[key]?.receipts)) {
      const call = worker(receipt); if (call) calls.push(call);
    }
    const findings = [];
    const failures = [];
    for (const event of array(turn.events)) {
      let receipts = [];
      if (event.event_type === "INVOCATION_COMPLETED") {
        const output = event.details?.output;
        receipts = event.stage === "candidate" ? array(output?.result?.receipts).filter((r) => !String(r?.role).startsWith("R"))
          : event.stage === "audit" ? array(output?.providerReceipt?.receipts)
          : event.stage === "repair" ? array(output?.result?.receipts) : [];
        if (event.stage === "audit") for (const item of array(output?.value?.findings)) findings.push({ code: fixedFindingCode(item?.code), severity: ["low", "medium", "substantive", "high"].includes(item?.severity) ? item.severity : "high" });
      } else if (event.event_type === "INVOCATION_FAILED") receipts = array(event.details?.raw_private_evidence?.receipts);
      const legacyParts = event.stage === "candidate" ? event.details?.output?.result?.rules?.parts : [];
      const eventCalls = receipts.map((receipt) => worker(receipt, legacyParts)).filter(Boolean);
      calls.push(...eventCalls);
      if (event.event_type === "INVOCATION_FAILED") {
        const code = failure(event.details?.error_code) ?? "PROVIDER_FAILED";
        failures.push(code);
        // Only a worker's terminal attempt can account for the invocation's failure. A successful retry supersedes its earlier failure.
        const terminalCalls = new Map(eventCalls.map((call) => [call.role, call]));
        if (![...terminalCalls.values()].some((call) => call.failure_code === code)) failureCounts.set(code, (failureCounts.get(code) ?? 0) + 1);
      }
    }
    const tokens = emptyTokens();
    for (const call of calls) addTokens(tokens, call);
    turns.push({
      schema_version: 1, turn: index + 1, started_at: started, ended_at: ended,
      rules: turn.runner_config ? rules(turn.runner_config.rules) : null,
      arrangement: turn.runner_config ? arrangement(turn.runner_config.arrangement) : null,
      duration_ms: elapsed(started, ended), first_words_ms: elapsed(started, first),
      outcome: turn.state === "DELIVERED" ? { status: "delivered", kind: null, reason_code: null } : { status: "closed", kind: ["runner_unavailable", "owner_fallback"].includes(turn.closure?.kind) ? turn.closure.kind : "runner_unavailable", reason_code: REASONS.has(turn.closure?.reason_code) ? turn.closure.reason_code : "provider_failed" },
      crisis_level: LEVELS.has(turn.runner_reading?.readers?.crisis?.level) ? turn.runner_reading.readers.crisis.level : null,
      repair_rounds: Math.max(number(turn.repair_cycle) ?? 0, array(turn.events).filter((event) => event.to_state === "RECONSTRUCTING").length), workers: calls, tokens, findings, failures
    });
  }
  const findingCounts = new Map();
  const models = new Map();
  for (const turn of turns) {
    for (const finding of turn.findings) findingCounts.set(finding.code, (findingCounts.get(finding.code) ?? 0) + 1);
    for (const call of turn.workers) {
      if (call.failure_code) failureCounts.set(call.failure_code, (failureCounts.get(call.failure_code) ?? 0) + 1);
      const key = JSON.stringify([call.provider, call.model]);
      if (!models.has(key)) models.set(key, { provider: call.provider, model: call.model, calls: 0, tokens: emptyTokens() });
      const group = models.get(key); group.calls += 1; addTokens(group.tokens, call);
    }
  }
  return {
    schema_version: 1,
    summary: {
      turns: turns.length, total_time_ms: distribution(turns.map((turn) => turn.duration_ms)),
      first_words_ms: distribution(turns.map((turn) => turn.first_words_ms)),
      workers_per_turn: turns.length ? turns.reduce((sum, turn) => sum + turn.workers.length, 0) / turns.length : 0,
      repairs_per_turn: turns.length ? turns.reduce((sum, turn) => sum + turn.repair_rounds, 0) / turns.length : 0,
      tokens_by_provider_model: [...models.values()], finding_codes: counts(findingCounts, "code"), failures_by_code: counts(failureCounts, "code")
    },
    turns
  };
}

// One queue per controller (shared by both loopback listeners). Work is deferred and errors are dropped; a response never awaits it.
// A rename or a deletion is durable only once its folder is synced (Codex review 4): without it, a power cut could bring back a stale
// log or a deleted case's log. Best effort: a filesystem that refuses a directory sync changes nothing else.
async function syncDirectory(directory) {
  let handle = null;
  try { handle = await fs.open(directory, constants.O_RDONLY | constants.O_DIRECTORY); await handle.sync(); }
  catch { /* best effort */ }
  finally { try { await handle?.close(); } catch { /* best effort */ } }
}

// One writer per log file: the owner's own case writes runner-log.jsonl, as before; each client's case its own file (the design for
// clients, point 3), named by the case's id, never its label, and written and deleted only with that case.
export const RUNNER_LOG_FILE = "runner-log.jsonl";
export const runnerClientLogFile = (caseId) => `runner-log-${caseId}.jsonl`;

export function createRunnerLogWriter({ directory, fileName = RUNNER_LOG_FILE, runnerRules, arrangement: runnerArrangement, loadRecord }) {
  let tail = Promise.resolve();
  let generation = 0;
  if (fileName !== RUNNER_LOG_FILE && !/^runner-log-case-[0-9a-f-]{36}\.jsonl$/u.test(fileName)) throw new Error("A runner log file name is the owner's or a client case's.");
  const file = directory ? path.join(directory, fileName) : null;
  const header = { schema_version: 1, type: "header", runnerRules: rules(runnerRules), arrangement: arrangement(runnerArrangement) };
  const enqueue = (work) => { tail = tail.then(work).catch(() => {}); return tail; };
  return {
    schedule(caseId, authContext) {
      if (!file) return;
      const scheduledGeneration = generation;
      // Let the response return before projection, reads or filesystem work begin.
      setImmediate(() => enqueue(async () => {
        if (scheduledGeneration !== generation) return;
        const record = await loadRecord(caseId, authContext);
        if (scheduledGeneration !== generation) return;
        // The case is gone (deleted, or never made): no log may outlive it, including one a power cut brought back.
        if (!record) { await fs.rm(file, { force: true }); await syncDirectory(directory); return; }
        const log = runnerLogFromRecord(record);
        const temporary = path.join(directory, `.runner-log-${randomUUID()}.tmp`);
        let handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        try {
          await handle.writeFile([header, ...log.turns].map((line) => JSON.stringify(line)).join("\n") + "\n");
          await handle.sync();
          await handle.close();
          handle = null;
          if (scheduledGeneration === generation) { await fs.rename(temporary, file); await syncDirectory(directory); }
        } finally {
          try { await handle?.close(); }
          finally { await fs.rm(temporary, { force: true }); }
        }
      }));
    },
    async remove() {
      // Invalidate deferred and in-flight snapshots before queuing deletion behind any active write.
      generation += 1;
      const deletion = tail.then(async () => { if (file) { await fs.rm(file, { force: true }); await syncDirectory(directory); } });
      tail = deletion.catch(() => {});
      await deletion;
    },
    async flush() { await new Promise((resolve) => setImmediate(resolve)); await tail; }
  };
}
