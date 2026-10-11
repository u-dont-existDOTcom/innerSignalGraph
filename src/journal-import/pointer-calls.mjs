import { ValidationError } from "../core/errors.mjs";
import { JournalInferencePortError } from "./provider-port.mjs";

// The pointer pass's model calls (plan 2026-10-09-journal-quote-first.md, Part 3, "Deadlines"). A step saves its
// deadline when it starts and keeps it on resume. Every call it sends, a retry included, goes out at once as an exchange
// item that expires at that deadline, and the step waits on each until it is answered or the deadline passes, whatever
// a single wait returns. After the deadline nothing is sent, and an answer received after it is ignored, so what is
// unanswered then fails safe: the caller treats a "deadline" outcome as its step's rules say. The durable port keeps
// every call's intent and answer, so a resumed step with the same deadline sends nothing twice. Outcomes carry the
// model's output for the caller alone; nothing here logs or reports content.

/** How a call ended. */
export const POINTER_CALL_OUTCOMES = Object.freeze(["answered", "failed", "deadline"]);

// Port errors that mean the call's item was never sent or was closed unanswered: the call may be sent again, under its
// retry key, if the step's deadline hasn't passed. Any other "not submitted" error (a revoked grant, a denied role)
// stops the step instead, since sending again can't help.
const RESENDABLE = new Set(["JOURNAL_WORK_EXPIRED", "INFERENCE_NOT_SUBMITTED", "JOURNAL_EXCHANGE_UNAVAILABLE",
  "JOURNAL_STEP_DEADLINE_PASSED", "INFERENCE_RETRY_LIMIT"]);
// How long a call pauses before waiting again on an item a wait left open before the deadline.
const REWAIT_PAUSE_MS = 5000;
// How long past the deadline a call still waits on a port that doesn't end its own wait there, before letting it go.
const DEADLINE_GRACE_MS = 60_000;

function invariant(condition, code) {
  if (!condition) throw new ValidationError(code, { code });
}

// Freezes plain data all the way down.
function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** A call's operation key on each attempt: its own key first, then one key per retry. */
export const pointerCallKey = (key, attempt) => (attempt === 0 ? key : `${key}:retry:${attempt}`);

// What a failed invoke means for the call: still open, answered but invalid, never answered, used up, or a stop.
function classify(error) {
  if (!(error instanceof JournalInferencePortError)) return "stop";
  if (error.submissionStatus === "unknown") return "open";
  if (error.submissionStatus === "completed_invalid") return "invalid";
  if (error.submissionStatus === "exhausted") return "exhausted";
  if (error.submissionStatus === "not_submitted" && RESENDABLE.has(error.code)) return "unanswered";
  return "stop";
}

/**
 * Runs `calls` (each { key, role, tier, packet, outputSchema, grant }) at once against `deadline` (an ISO time saved
 * when the step started). Each call gets `retries` more attempts after an invalid answer or an item closed unanswered,
 * while time remains; `check(call, output)` may also find an answer invalid, by returning a code, and its call then
 * uses its retry the same way. `beforeHardestSend` runs before a hardest-tier call that has no open item, so the
 * runtime can count its daily slot; it may throw to stop the step. Returns one outcome per call, in order: "answered"
 * with its output and receipt, "failed" with a code, or "deadline" (its reason "deadline_unsent" when the call was never
 * sent because the deadline had passed). A wait that ends before the deadline with the item still open (a port that
 * waits less than it was asked to) is followed, after `pause`, by another wait on the same item, so a call only ends
 * open at the deadline, and a port that doesn't end its wait there (a browser route that answers when it is done) is
 * let go `deadlineGraceMs` after it. An answer counts only when it is known to have come by the deadline: by its
 * route's own time (the exchange's `received_at`, the browser route's `observed_at`) or, with none, by when the port
 * handed it over; one read after the deadline with no time fails closed. An error that is no call's outcome (a revoked
 * grant, an unreachable store) is thrown, and the step resumes later with the same deadline.
 */
export async function runDeadlineCalls({ calls, port, deadline, now = () => new Date(), retries = 1, beforeHardestSend = null,
  check = null, pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }), deadlineGraceMs = DEADLINE_GRACE_MS } = {}) {
  invariant(Array.isArray(calls) && calls.every((call) => call && typeof call.key === "string" && call.key.length > 0
    && typeof call.role === "string" && (call.tier === "standard" || call.tier === "hardest")), "POINTER_CALLS_INVALID");
  invariant(new Set(calls.map((call) => call.key)).size === calls.length, "POINTER_CALL_KEY_DUPLICATE");
  invariant(port && typeof port.invoke === "function" && typeof port.getCompletion === "function", "POINTER_CALL_PORT_INVALID");
  const end = Date.parse(deadline);
  invariant(typeof deadline === "string" && Number.isFinite(end), "POINTER_CALL_DEADLINE_INVALID");
  invariant(retries === 0 || retries === 1, "POINTER_CALL_RETRIES_INVALID");
  invariant(check === null || typeof check === "function", "POINTER_CALL_CHECK_INVALID");
  invariant(typeof pause === "function", "POINTER_CALL_PAUSE_INVALID");
  invariant(Number.isSafeInteger(deadlineGraceMs) && deadlineGraceMs >= 0, "POINTER_CALL_PAUSE_INVALID");
  // Why an answer can't be used, or null; a check that throws stops the step.
  const failedCheck = (call, output) => (check ? check(call, output) ?? null : null);
  const remaining = () => end - now().getTime();
  // When the route received an answer, by its own record, or null when the receipt holds no time.
  const receivedAt = (receipt) => {
    const route = receipt?.provider_route_receipt;
    for (const value of [route?.received_at, route?.observed_at]) {
      const time = Date.parse(typeof value === "string" ? value : "");
      if (Number.isFinite(time)) return time;
    }
    return null;
  };
  // An answer received after the deadline is ignored, as if it had never come. One with no time counts when the port
  // handed it over by the deadline (`handedAt`, on the waiting path); read later, it fails closed.
  const inTime = (receipt, handedAt = null) => {
    const received = receivedAt(receipt);
    if (received !== null) return received <= end;
    return handedAt !== null && handedAt <= end;
  };
  // Lets a wait go at the deadline (and a grace for a port that ends its own wait there), as if the item were still
  // open; the call itself may finish later, and its answer is then stored and ignored as late.
  const untilDeadline = (invocation) => {
    let timer = null;
    const expiry = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new JournalInferencePortError("COMPLETION_UNKNOWN", { submissionStatus: "unknown" })),
        Math.max(0, remaining()) + deadlineGraceMs);
      timer.unref?.();
    });
    expiry.catch(() => {});
    invocation.catch(() => {});
    return Promise.race([invocation, expiry]).finally(() => clearTimeout(timer));
  };

  const outcomeOf = async (call) => {
    let reason = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const operationKey = pointerCallKey(call.key, attempt);
      const request = { role: call.role, packet: call.packet, outputSchema: call.outputSchema, operationKey,
        grant: call.grant, tier: call.tier, expiresAt: deadline };
      if (remaining() <= 0) {
        // Nothing is sent after the deadline. An answer that came in time is still read, and an invalid one still
        // lets its retry's answer count.
        const completion = await port.getCompletion(operationKey, { tier: call.tier });
        if (completion.status === "completed" && inTime(completion.receipt)) {
          const failure = failedCheck(call, completion.output);
          if (!failure) return { key: call.key, status: "answered", attempts: attempt + 1, output: completion.output, receipt: completion.receipt };
          reason = failure;
          if (attempt < retries) continue;
          return { key: call.key, status: "failed", attempts: attempt + 1, reason };
        }
        if (completion.status === "invalid_output" && attempt < retries) { reason = "INVALID_STRUCTURED_OUTPUT"; continue; }
        if (completion.status === "exhausted") return { key: call.key, status: "failed", attempts: attempt + 1, reason: completion.code ?? "EXHAUSTED" };
        // Sent and left unanswered, or never sent at all because an earlier wait used up the step's time. A port that
        // can't tell (no wasSent) reports the first.
        const unsent = completion.status === "not_submitted" && typeof port.wasSent === "function" && !(await port.wasSent(operationKey));
        return { key: call.key, status: "deadline", attempts: attempt + 1, reason: unsent ? "deadline_unsent" : "deadline" };
      }
      if (call.tier === "hardest" && beforeHardestSend) {
        const completion = await port.getCompletion(operationKey, { tier: call.tier });
        if (completion.status === "not_submitted") await beforeHardestSend({ key: call.key, operationKey });
      }
      // Waits on the item until it is answered or the deadline passes, whatever a single wait returns.
      const wait = async () => {
        for (;;) {
          try {
            const result = await untilDeadline(Promise.resolve().then(() => port.invoke(request, { waitMs: Math.max(0, remaining()) })));
            return { result, handedAt: now().getTime() };
          } catch (error) {
            if (classify(error) !== "open" || remaining() <= 0) return { error };
          }
          await pause(Math.max(0, Math.min(remaining(), REWAIT_PAUSE_MS)));
        }
      };
      const { result, handedAt, error } = await wait();
      if (result) {
        if (!inTime(result.receipt, handedAt)) return { key: call.key, status: "deadline", attempts: attempt + 1, reason: "deadline" };
        const failure = failedCheck(call, result.output);
        if (!failure) return { key: call.key, status: "answered", attempts: attempt + 1, output: result.output, receipt: result.receipt };
        reason = failure;
      } else {
        const kind = classify(error);
        if (kind === "stop") throw error;
        // The waits reached the deadline with the item still open.
        if (kind === "open") return { key: call.key, status: "deadline", attempts: attempt + 1, reason: "deadline" };
        if (kind === "exhausted") return { key: call.key, status: "failed", attempts: attempt + 1, reason: error.code };
        reason = kind === "invalid" ? "INVALID_STRUCTURED_OUTPUT" : error.code;
        if (remaining() <= 0 && kind === "unanswered") return { key: call.key, status: "deadline", attempts: attempt + 1, reason: "deadline" };
      }
    }
    return { key: call.key, status: "failed", attempts: retries + 1, reason };
  };
  return deepFreeze(await Promise.all(calls.map(outcomeOf)));
}

/** Counts of the outcomes, content-free, for reports. */
export function pointerCallCounts(outcomes) {
  invariant(Array.isArray(outcomes), "POINTER_CALL_OUTCOMES_INVALID");
  const counts = Object.fromEntries(POINTER_CALL_OUTCOMES.map((status) => [status, 0]));
  let retried = 0;
  for (const outcome of outcomes) {
    invariant(POINTER_CALL_OUTCOMES.includes(outcome?.status), "POINTER_CALL_OUTCOMES_INVALID");
    counts[outcome.status] += 1;
    if (outcome.attempts > 1) retried += 1;
  }
  return Object.freeze({ calls: outcomes.length, ...counts, retried });
}
