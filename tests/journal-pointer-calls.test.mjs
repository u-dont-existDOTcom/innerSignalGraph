import test from "node:test";
import assert from "node:assert/strict";
import { JournalInferencePortError } from "../src/journal-import/provider-port.mjs";
import { POINTER_CALL_OUTCOMES, pointerCallCounts, pointerCallKey, runDeadlineCalls } from "../src/journal-import/pointer-calls.mjs";

// The pointer pass's calls against a saved deadline (plan 2026-10-09-journal-quote-first.md, Part 3, "Deadlines").
// A fake port stands in for the durable exchange port; all content is invented.

const START = Date.parse("2026-10-11T06:00:00Z");
const DEADLINE = "2026-10-11T09:00:00.000Z";

// Each operation key answers as scripted: an output (received at a given time), "invalid", "expired" (closed
// unanswered), "open" (no answer before the wait ends), "exhausted" or "revoked". A key reports its answer only once
// it was sent, in this run or, for the keys in `earlier`, before it.
function fakePort(script, { clock, earlier = [] }) {
  const sent = [];
  const wasSent = (operationKey) => earlier.includes(operationKey) || sent.some((item) => item.operationKey === operationKey);
  const reply = (operationKey) => {
    const answer = script[operationKey] ?? "open";
    if (answer === "invalid") throw new JournalInferencePortError("INVALID_STRUCTURED_OUTPUT", { submissionStatus: "completed_invalid" });
    if (answer === "expired") throw new JournalInferencePortError("JOURNAL_WORK_EXPIRED", { submissionStatus: "not_submitted" });
    if (answer === "open") throw new JournalInferencePortError("COMPLETION_UNKNOWN", { submissionStatus: "unknown" });
    if (answer === "exhausted") throw new JournalInferencePortError("JOURNAL_HARDEST_ATTEMPT_EXHAUSTED", { submissionStatus: "exhausted" });
    if (answer === "revoked") throw new JournalInferencePortError("GRANT_REVOKED");
    return { output: answer.output, receipt: { provider_route_receipt: { received_at: answer.at ?? new Date(clock.now).toISOString() } } };
  };
  return {
    sent,
    async invoke(request, options) {
      sent.push({ operationKey: request.operationKey, expiresAt: request.expiresAt, waitMs: options.waitMs, tier: request.tier });
      return reply(request.operationKey);
    },
    async getCompletion(operationKey) {
      const answer = script[operationKey];
      if (!wasSent(operationKey)) return { status: "not_submitted" };
      if (answer === undefined || answer === "open") return { status: "unknown" };
      if (answer === "invalid") return { status: "invalid_output" };
      if (answer === "expired") return { status: "not_submitted" };
      if (answer === "exhausted") return { status: "exhausted", code: "JOURNAL_HARDEST_ATTEMPT_EXHAUSTED" };
      return { status: "completed", output: answer.output, receipt: { provider_route_receipt: { received_at: answer.at } } };
    }
  };
}

const call = (key, tier = "standard") => ({ key, role: "pointer_tagger", tier, packet: { synthetic: true }, outputSchema: "pointer-result",
  grant: { grant_id: "grant:synthetic" } });

test("every call goes out at once, expiring at the step's deadline, and waits no longer than the time left", async () => {
  const clock = { now: START };
  const port = fakePort({ "batch:1": { output: { n: 1 } }, "batch:2": { output: { n: 2 } } }, { clock });
  const outcomes = await runDeadlineCalls({ calls: [call("batch:1"), call("batch:2")], port, deadline: DEADLINE, now: () => new Date(clock.now) });
  assert.deepEqual(outcomes.map((outcome) => [outcome.key, outcome.status, outcome.attempts, outcome.output.n]),
    [["batch:1", "answered", 1, 1], ["batch:2", "answered", 1, 2]]);
  assert.deepEqual(port.sent.map((item) => [item.operationKey, item.expiresAt, item.waitMs]),
    [["batch:1", DEADLINE, 3 * 60 * 60_000], ["batch:2", DEADLINE, 3 * 60 * 60_000]]);
  assert.ok(Object.isFrozen(outcomes) && Object.isFrozen(outcomes[0]));
  assert.deepEqual(POINTER_CALL_OUTCOMES, ["answered", "failed", "deadline"]);
});

test("an invalid answer or an item closed unanswered gets one retry under its own key, while time remains", async () => {
  const clock = { now: START };
  const port = fakePort({
    "batch:1": "invalid", [pointerCallKey("batch:1", 1)]: { output: { n: 1 } },
    "batch:2": "invalid", [pointerCallKey("batch:2", 1)]: "invalid",
    "batch:3": "expired", [pointerCallKey("batch:3", 1)]: { output: { n: 3 } },
    "batch:4": "exhausted"
  }, { clock });
  const outcomes = await runDeadlineCalls({ calls: ["batch:1", "batch:2", "batch:3", "batch:4"].map((key) => call(key)), port,
    deadline: DEADLINE, now: () => new Date(clock.now) });
  assert.deepEqual(outcomes.map((outcome) => [outcome.status, outcome.attempts, outcome.reason ?? null]), [
    ["answered", 2, null], ["failed", 2, "INVALID_STRUCTURED_OUTPUT"], ["answered", 2, null], ["failed", 1, "JOURNAL_HARDEST_ATTEMPT_EXHAUSTED"]]);
  assert.equal(pointerCallKey("batch:1", 1), "batch:1:retry:1");
  assert.equal(port.sent.filter((item) => item.operationKey.startsWith("batch:4")).length, 1, "a used-up call isn't sent again");
  // With no retry, an invalid answer fails the call at once; the caller has its own retry (the question writer's).
  const single = fakePort({ "unit:1": "invalid" }, { clock });
  const [failed] = await runDeadlineCalls({ calls: [call("unit:1")], port: single, deadline: DEADLINE, now: () => new Date(clock.now), retries: 0 });
  assert.deepEqual([failed.status, failed.attempts, single.sent.length], ["failed", 1, 1]);
  assert.deepEqual(pointerCallCounts(outcomes), { calls: 4, answered: 2, failed: 2, deadline: 0, retried: 3 });
});

test("at the deadline an open call ends as a deadline, and an answer received after it is ignored", async () => {
  const clock = { now: START };
  const port = fakePort({ "batch:1": "open", "batch:2": { output: { n: 2 }, at: "2026-10-11T09:00:05.000Z" },
    "batch:3": { output: { n: 3 }, at: "2026-10-11T08:59:59.000Z" } }, { clock });
  const outcomes = await runDeadlineCalls({ calls: [call("batch:1"), call("batch:2"), call("batch:3")], port, deadline: DEADLINE,
    now: () => new Date(clock.now) });
  assert.deepEqual(outcomes.map((outcome) => outcome.status), ["deadline", "deadline", "answered"]);
});

test("after the deadline nothing is sent, but an answer that came in time still counts", async () => {
  const clock = { now: Date.parse(DEADLINE) + 60_000 };
  const port = fakePort({
    "batch:1": { output: { n: 1 }, at: "2026-10-11T08:00:00.000Z" },
    "batch:2": "invalid", [pointerCallKey("batch:2", 1)]: { output: { n: 2 }, at: "2026-10-11T08:30:00.000Z" },
    "batch:4": "exhausted"
  }, { clock, earlier: ["batch:1", "batch:2", pointerCallKey("batch:2", 1), "batch:4"] });
  const outcomes = await runDeadlineCalls({ calls: ["batch:1", "batch:2", "batch:3", "batch:4"].map((key) => call(key)), port,
    deadline: DEADLINE, now: () => new Date(clock.now) });
  assert.deepEqual(outcomes.map((outcome) => [outcome.status, outcome.attempts]), [["answered", 1], ["answered", 2], ["deadline", 1], ["failed", 1]]);
  assert.deepEqual(port.sent, [], "nothing goes out after the deadline");
});

test("a revoked grant or an unexpected error stops the step instead of failing its calls", async () => {
  const clock = { now: START };
  await assert.rejects(runDeadlineCalls({ calls: [call("batch:1")], port: fakePort({ "batch:1": "revoked" }, { clock }), deadline: DEADLINE,
    now: () => new Date(clock.now) }), { code: "GRANT_REVOKED" });
  const broken = { async invoke() { throw new Error("disk full"); }, async getCompletion() { return { status: "not_submitted" }; } };
  await assert.rejects(runDeadlineCalls({ calls: [call("batch:1")], port: broken, deadline: DEADLINE, now: () => new Date(clock.now) }), /disk full/);
});

test("a hardest call counts its daily slot only when it has no open item, and a full day stops the step", async () => {
  const clock = { now: START };
  const port = fakePort({ "judge:1": { output: { n: 1 } } }, { clock });
  const slots = [];
  const outcomes = await runDeadlineCalls({ calls: [call("judge:1", "hardest")], port, deadline: DEADLINE, now: () => new Date(clock.now),
    beforeHardestSend: async ({ operationKey }) => { slots.push(operationKey); } });
  assert.deepEqual([outcomes[0].status, slots], ["answered", ["judge:1"]]);
  // Already sent and still open: no second slot.
  const open = fakePort({ "judge:2": "open" }, { clock, earlier: ["judge:2"] });
  const before = [];
  clock.now = Date.parse(DEADLINE) - 1_000;
  await runDeadlineCalls({ calls: [call("judge:2", "hardest")], port: open, deadline: DEADLINE, now: () => new Date(clock.now),
    beforeHardestSend: async ({ operationKey }) => { before.push(operationKey); } });
  assert.deepEqual(before, []);
  const full = Object.assign(new Error("daily limit"), { code: "HARDEST_DAILY_LIMIT" });
  await assert.rejects(runDeadlineCalls({ calls: [call("judge:3", "hardest")], port: fakePort({}, { clock }), deadline: DEADLINE,
    now: () => new Date(clock.now), beforeHardestSend: async () => { throw full; } }), { code: "HARDEST_DAILY_LIMIT" });
});

test("the calls, the deadline and the retry count are checked", async () => {
  const clock = { now: START };
  const port = fakePort({}, { clock });
  for (const [input, code] of [
    [{ calls: [call("a"), call("a")], port, deadline: DEADLINE }, "POINTER_CALL_KEY_DUPLICATE"],
    [{ calls: [{ ...call("a"), tier: "fast" }], port, deadline: DEADLINE }, "POINTER_CALLS_INVALID"],
    [{ calls: [call("a")], port, deadline: "later" }, "POINTER_CALL_DEADLINE_INVALID"],
    [{ calls: [call("a")], port, deadline: DEADLINE, retries: 2 }, "POINTER_CALL_RETRIES_INVALID"],
    [{ calls: [call("a")], port: {}, deadline: DEADLINE }, "POINTER_CALL_PORT_INVALID"]
  ]) {
    await assert.rejects(runDeadlineCalls(input), { code });
  }
  assert.throws(() => pointerCallCounts([{ status: "lost" }]), { code: "POINTER_CALL_OUTCOMES_INVALID" });
});

test("an answer that fails the step's own check uses the call's retry, before and after the deadline", async () => {
  const clock = { now: START };
  const check = (call, output) => (output.complete ? null : "SYNTHETIC_INCOMPLETE");
  const port = fakePort({
    "search:1": { output: { complete: false } }, [pointerCallKey("search:1", 1)]: { output: { complete: true } },
    "search:2": { output: { complete: false } }, [pointerCallKey("search:2", 1)]: { output: { complete: false } }
  }, { clock });
  const outcomes = await runDeadlineCalls({ calls: [call("search:1"), call("search:2")], port, deadline: DEADLINE, now: () => new Date(clock.now), check });
  assert.deepEqual(outcomes.map((outcome) => [outcome.status, outcome.attempts, outcome.reason ?? null]),
    [["answered", 2, null], ["failed", 2, "SYNTHETIC_INCOMPLETE"]]);
  // Resumed after the deadline, the same stored answers give the same outcomes and nothing is sent.
  clock.now = Date.parse(DEADLINE) + 1_000;
  const resumed = fakePort({
    "search:1": { output: { complete: false }, at: "2026-10-11T07:00:00.000Z" },
    [pointerCallKey("search:1", 1)]: { output: { complete: true }, at: "2026-10-11T07:05:00.000Z" }
  }, { clock, earlier: ["search:1", pointerCallKey("search:1", 1)] });
  const again = await runDeadlineCalls({ calls: [call("search:1")], port: resumed, deadline: DEADLINE, now: () => new Date(clock.now), check });
  assert.deepEqual([again[0].status, again[0].attempts, resumed.sent.length], ["answered", 2, 0]);
  await assert.rejects(runDeadlineCalls({ calls: [call("a")], port, deadline: DEADLINE, check: "yes" }), { code: "POINTER_CALL_CHECK_INVALID" });
});
