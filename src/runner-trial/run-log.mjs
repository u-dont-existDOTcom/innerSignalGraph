import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

// This is a projection, never a redacted copy. No stored object (including a receipt) is spread or serialized here.
// Timestamps are parsed and re-emitted; names have bounded alphabets; model prose has no output field.
const ROLES = new Set(["R1", "R2", "R3", "W", "W-repair", "C1", "C2", "C3", "C4", "C5", "CW"]);
const LEVELS = new Set(["none", "unclear", "thoughts_no_intent", "wants_to_die", "acted_or_about_to"]);
const FAILURES = new Set(["TIMEOUT", "PLAN_LIMIT", "SIGN_IN_NEEDED", "REFUSED", "PROVIDER_FAILED", "PROVIDER_MALFORMED", "CODEX_RECEIPT_INCOMPLETE", "CODEX_ACTION_TAKEN", "RUNNER_SETTINGS_INVALID", "PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE", "REPAIR_UNCHANGED", "PRIVATE_INFERENCE_CONTEXT_REUSED"]);
const REASONS = new Set(["checks_failed", "plan_limit", "sign_in_needed", "timeout", "refused", "provider_failed", "interrupted"]);
// Fixed protocol/program codes only. Checkers can invent codes; those are counted as UNSPECIFIED_FINDING, never copied as prose.
const FINDINGS = new Set(`ACCIDENTAL_EXPOSURE_MISFRAMED AGE_RESPONSIBILITY_CLARIFICATION ALTERED_SOURCE_AS_FACT ATTRACTION_ACTION_CONFLATION CHILD_CONTACT_WHILE_RESTRICTED CLAIM_SCOPE_SUBSTITUTION CORRECTION_OR_ACCOUNTABILITY_ERASURE CRISIS_FIRST_REPLY_SHAPE CRISIS_FIRST_STEP_MISSING CRISIS_LEVEL_MISREAD CRISIS_NEVER_LIST CURRENT_DANGER_CONCEALED DELIVERED_ADVICE_AS_NEW DISCLOSURE_MET_WITH_ALARM DISCLOSURE_PRESSED_OR_UNGRADED EARLY_HARM_OPTION_MISHANDLED EDITORIAL_AFTERCARE_OVERCOMPLETION EPISTEMIC_PROVENANCE_LAUNDERING FALSE_ASSISTANT_IDENTITY HARMFUL_BELIEF_ENDORSEMENT HISTORY_FREE_CESSATION_ADVICE HYPOTHETICAL_ENACTMENT_CONFLATION IPV_COUNSELING_SCOPE_COLLAPSE KNOWN_PRESENTED_AS_NEW LEGAL_CLINICAL_CONSENT_COLLAPSE LIMIT_UNNAMED_OR_AS_VERDICT LONGITUDINAL_CONTEXT_MISSING LOW_VALUE_REPEAT_REFERRAL MATERIAL_KIND_BLURRED MISSED_VALUED_STATE_FUNCTION MISSING_MIDDLE_INTERPRETATION NON_SEQUITUR_QUALIFICATION ORNAMENTAL_FAITH_REFERENCE PREMATURE_RECEPTION_INQUIRY PROGRAM_CHILD_CONTACT_PATTERN PROGRAM_DETOX_WORD PROGRAM_EMPTY_REPLY PROGRAM_FIRST_CRISIS_REPLY_SHAPE PROGRAM_NO_EMERGENCY_NUMBER PROGRAM_NUMBER_WITHOUT_CRISIS PROGRAM_OWNER_LINK_NOT_ALLOWED PROGRAM_QUOTE_NOT_EXACT QUESTION_WITHOUT_STEP_VALUE QUOTE_NOT_EXACT REFRACTORY_PEAK_REASK RELAPSE_CHANGE_MISSED RELIEF_SCOPE_OVERCLAIM REPARENTING_EXERCISE_CONFLATION REPARENTING_FALSE_CHOICE REPRIMANDING_OPENING RESPONSE_DUPLICATION ROLE_REVERSAL_OR_DEPENDENCY ROOT_CAUSE_HARDENING SELF_DIRECTED_RISK_OVERREACTION SELF_DIRECTED_RISK_UNDERREACTION SENSITIVE_REFERRAL_FIT_MISSING SEXUAL_CARE_SCOPE_ERROR SHAME_RESPONSIBILITY_FALSE_CHOICE STORAGE_DESCRIBED SUPERVISOR_PURPOSE_OMITTED TABOO_MATERIAL_OUTSIDE_REVIEW TRANSLATION_SCOPE_LOSS UNCHOSEN_FIRST_AGENDA UNGATED_SCRIPTURE UNMADE_CLAIM_REBUTTAL UNREQUESTED_CLAIM_ADJUDICATION UNSENT_ADVICE_AS_DELIVERED UNSUPPORTED_PROTOCOL_STATE_ADVANCE UNSUPPORTED_SEXUAL_CAUSE UNTESTED_ACCESS_FRICTION`.split(" "));
const number = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
const name = (v) => typeof v === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,95}$/u.test(v) ? v : null;
const stamp = (v) => typeof v === "string" && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
const elapsed = (start, end) => start && end ? Math.max(0, Date.parse(end) - Date.parse(start)) : null;
const array = (v) => Array.isArray(v) ? v : [];
const failure = (v) => v == null ? null : FAILURES.has(v) ? v : "PROVIDER_FAILED";
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
    for (const event of array(turn.events)) {
      let receipts = [];
      if (event.event_type === "INVOCATION_COMPLETED") {
        const output = event.details?.output;
        receipts = event.stage === "candidate" ? array(output?.result?.receipts).filter((r) => !String(r?.role).startsWith("R"))
          : event.stage === "audit" ? array(output?.providerReceipt?.receipts)
          : event.stage === "repair" ? array(output?.result?.receipts) : [];
        if (event.stage === "audit") for (const item of array(output?.value?.findings)) findings.push({ code: FINDINGS.has(item?.code) ? item.code : "UNSPECIFIED_FINDING", severity: ["low", "medium", "substantive", "high"].includes(item?.severity) ? item.severity : "high" });
      } else if (event.event_type === "INVOCATION_FAILED") receipts = array(event.details?.raw_private_evidence?.receipts);
      const legacyParts = event.stage === "candidate" ? event.details?.output?.result?.rules?.parts : [];
      for (const receipt of receipts) { const call = worker(receipt, legacyParts); if (call) calls.push(call); }
    }
    const tokens = emptyTokens();
    for (const call of calls) addTokens(tokens, call);
    turns.push({
      turn: index + 1, started_at: started, ended_at: ended,
      duration_ms: elapsed(started, ended), first_words_ms: elapsed(started, first),
      outcome: turn.state === "DELIVERED" ? { status: "delivered", kind: null, reason_code: null } : { status: "closed", kind: ["runner_unavailable", "owner_fallback"].includes(turn.closure?.kind) ? turn.closure.kind : "runner_unavailable", reason_code: REASONS.has(turn.closure?.reason_code) ? turn.closure.reason_code : "provider_failed" },
      crisis_level: LEVELS.has(turn.runner_reading?.readers?.crisis?.level) ? turn.runner_reading.readers.crisis.level : null,
      repair_rounds: Math.max(number(turn.repair_cycle) ?? 0, array(turn.events).filter((event) => event.to_state === "RECONSTRUCTING").length), workers: calls, tokens, findings
    });
  }
  const findingCounts = new Map();
  const failureCounts = new Map();
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
export function createRunnerLogWriter({ directory, runnerRules, arrangement, loadRecord }) {
  let tail = Promise.resolve();
  const file = directory ? path.join(directory, "runner-log.jsonl") : null;
  const header = { schema_version: 1, type: "header", runnerRules: { version: name(runnerRules.version), sha256: /^[a-f0-9]{64}$/u.test(runnerRules.sha256) ? runnerRules.sha256 : null, source: /^stable [a-f0-9]{7,40}$/u.test(runnerRules.source) ? runnerRules.source : "checkout" }, arrangement: { writerMode: ["whole", "focused"].includes(arrangement?.writerMode) ? arrangement.writerMode : null, checkerMode: ["whole", "split"].includes(arrangement?.checkerMode) ? arrangement.checkerMode : null, readers: array(arrangement?.readers).map(name).filter(Boolean), writer: array(arrangement?.writer).map(name).filter(Boolean), checkers: array(arrangement?.checkers).map(name).filter(Boolean) } };
  const enqueue = (work) => { tail = tail.then(work).catch(() => {}); return tail; };
  return {
    schedule(caseId, authContext) {
      if (!file) return;
      // Let the response return before projection, reads or filesystem work begin.
      setImmediate(() => enqueue(async () => {
        const record = await loadRecord(caseId, authContext);
        const log = runnerLogFromRecord(record);
        const handle = await fs.open(file, constants.O_RDWR | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
        try {
          await handle.chmod(0o600);
          const existing = await handle.readFile();
          // Truncate only the incomplete tail, using byte offsets on the same no-follow handle used to append.
          const completeLength = existing.length === 0 || existing.at(-1) === 10 ? existing.length : existing.lastIndexOf(10) + 1;
          if (completeLength < existing.length) await handle.truncate(completeLength);
          const seen = new Set();
          let lastHeader = null;
          for (const line of existing.subarray(0, completeLength).toString("utf8").split("\n")) {
            try {
              const row = JSON.parse(line);
              if (row?.type === "header") lastHeader = row;
              else if (row?.turn != null) seen.add(row.turn);
            } catch { /* leave earlier complete lines unchanged */ }
          }
          const lines = isDeepStrictEqual(lastHeader, header) ? [] : [header];
          for (const turn of log.turns) if (!seen.has(turn.turn)) lines.push(turn);
          if (lines.length) await handle.writeFile(lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
        } finally { await handle.close(); }
      }));
    },
    async remove() {
      // Drain scheduled callbacks too, so a queued write cannot recreate a deleted case's log.
      await new Promise((resolve) => setImmediate(resolve));
      const deletion = tail.then(async () => { if (file) await fs.rm(file, { force: true }); });
      tail = deletion.catch(() => {});
      await deletion;
    },
    async flush() { await new Promise((resolve) => setImmediate(resolve)); await tail; }
  };
}
