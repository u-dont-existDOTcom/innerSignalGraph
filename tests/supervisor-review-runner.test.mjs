import test from "node:test";
import assert from "node:assert/strict";
import { SUPERVISOR_REVIEW_BUSY, createSupervisorReviewRunner } from "../src/supervisor/private-supervisor-review-runner.mjs";

// The background runner on its own: scheduling only, with work the tests control. Nothing here touches a case.

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

// Work that notes when it starts and finishes, and waits for its gate.
function tracked(log, name, gate = null, value = name) {
  return async () => {
    log.push(`start:${name}`);
    if (gate) await gate.promise;
    log.push(`end:${name}`);
    return value;
  };
}

test("options are bounded", () => {
  for (const options of [{ concurrency: 0 }, { concurrency: 17 }, { concurrency: 1.5 }, { queueLimit: -1 }, { budgetMs: -1 }, { budgetMs: 600_001 }, { cooldownMs: -1 }]) {
    assert.throws(() => createSupervisorReviewRunner(options), /must be from/u, JSON.stringify(options));
  }
  const runner = createSupervisorReviewRunner();
  assert.deepEqual(Object.keys(runner).sort(), ["idle", "run", "stats", "watch"]);
  assert.equal(Object.isFrozen(runner), true);
});

test("a job that finishes within the budget answers with its value", async () => {
  const runner = createSupervisorReviewRunner({ budgetMs: 1_000 });
  assert.deepEqual(await runner.run({ caseId: "c1", lineage: "l1", identity: "a", work: async () => 42 }), { state: "finished", value: 42 });
  await assert.rejects(() => runner.run({ caseId: "", identity: "a", work: async () => 1 }), /needs a case/u);
  await assert.rejects(() => runner.run({ caseId: "c1", identity: "", work: async () => 1 }), /needs a case/u);
  await assert.rejects(() => runner.run({ caseId: "c1", identity: "a", work: null }), /needs a case/u);
  assert.deepEqual(runner.stats(), { running: 0, waiting: 0, jobs: 0 });
});

test("a job still running at the budget is answered running, carries on, and can be watched to its end", async () => {
  const runner = createSupervisorReviewRunner({ budgetMs: 15 });
  const gate = deferred();
  const log = [];
  const started = await runner.run({ caseId: "c1", lineage: "l1", identity: "a", work: tracked(log, "a", gate, "done") });
  assert.deepEqual(started, { state: "running" });
  assert.deepEqual(log, ["start:a"]);
  assert.deepEqual(runner.stats(), { running: 1, waiting: 0, jobs: 1 });
  assert.equal(runner.watch({ caseId: "c1", lineage: "other" }), null);
  assert.equal(runner.watch({ caseId: "c2", lineage: "l1" }), null);
  const watching = runner.watch({ caseId: "c1", lineage: "l1" });
  assert.deepEqual(await watching, { state: "running" }, "watching waits no longer than the budget either");
  gate.resolve();
  await runner.idle();
  assert.deepEqual(log, ["start:a", "end:a"]);
  assert.equal(runner.watch({ caseId: "c1", lineage: "l1" }), null);
  assert.deepEqual(runner.stats(), { running: 0, waiting: 0, jobs: 0 });
  // A watch that starts before the end sees the value.
  const second = deferred();
  await runner.run({ caseId: "c1", lineage: "l2", identity: "b", work: tracked(log, "b", second, "value-b") });
  const joined = runner.watch({ caseId: "c1", lineage: "l2" });
  second.resolve();
  await runner.idle();
  assert.deepEqual(await joined, { state: "finished", value: "value-b" });
});

test("by default a call waits for its review for 25 seconds and not a moment longer, and the review carries on afterwards", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const settleTurns = () => new Promise((resolve) => setImmediate(resolve));
  const runner = createSupervisorReviewRunner();
  const gate = deferred();
  const answers = [];
  const call = runner.run({ caseId: "c1", lineage: "l1", identity: "a", work: () => gate.promise }).then((answer) => answers.push(answer));
  await settleTurns();
  t.mock.timers.tick(24_999);
  await settleTurns();
  assert.deepEqual(answers, [], "still waiting one millisecond before the budget");
  t.mock.timers.tick(1);
  await call;
  assert.deepEqual(answers, [{ state: "running" }], "answered at 25 seconds");
  assert.deepEqual(runner.stats(), { running: 1, waiting: 0, jobs: 1 }, "the review carries on");
  gate.resolve("finished late");
  await runner.idle();
  assert.deepEqual(runner.stats(), { running: 0, waiting: 0, jobs: 0 });
});

test("a failure inside the budget fails the call; a failure after it is only remembered, never an unhandled rejection", async () => {
  const runner = createSupervisorReviewRunner({ budgetMs: 15, cooldownMs: 0 });
  const boom = Object.assign(new Error("synthetic failure"), { code: "SYNTHETIC" });
  await assert.rejects(() => runner.run({ caseId: "c1", lineage: "l1", identity: "a", work: async () => { throw boom; } }), (error) => error === boom);
  const gate = deferred();
  const late = await runner.run({ caseId: "c1", lineage: "l2", identity: "b", work: async () => { await gate.promise; throw boom; } });
  assert.deepEqual(late, { state: "running" });
  gate.resolve();
  await runner.idle();
  await tick(20);
  assert.deepEqual(runner.stats(), { running: 0, waiting: 0, jobs: 0 });
  // The runner still works.
  assert.equal((await runner.run({ caseId: "c1", lineage: "l2", identity: "c", work: async () => "fine" })).value, "fine");
});

test("an identical request joins the review already running and never starts a second", async () => {
  const runner = createSupervisorReviewRunner({ budgetMs: 15 });
  const gate = deferred();
  let started = 0;
  const work = async () => { started += 1; await gate.promise; return "once"; };
  const first = runner.run({ caseId: "c1", lineage: "l1", identity: "same", work });
  const second = runner.run({ caseId: "c1", lineage: "l1", identity: "same", work });
  assert.deepEqual(await first, { state: "running" });
  assert.deepEqual(await second, { state: "running" });
  gate.resolve();
  await runner.idle();
  assert.equal(started, 1);
  // Once it has ended, the same identity is a new request again.
  const again = await runner.run({ caseId: "c1", lineage: "l1", identity: "same", work: async () => { started += 1; return "twice"; } });
  assert.deepEqual(again, { state: "finished", value: "twice" });
  assert.equal(started, 2);
});

test("a request that differs in any way never joins: it waits its turn behind the first for the same case", async () => {
  const runner = createSupervisorReviewRunner({ budgetMs: 15, concurrency: 4 });
  const gate = deferred();
  const log = [];
  const first = await runner.run({ caseId: "c1", lineage: "l1", identity: "request-1", work: tracked(log, "first", gate) });
  assert.deepEqual(first, { state: "running" });
  const second = await runner.run({ caseId: "c1", lineage: "l1", identity: "request-2", work: tracked(log, "second") });
  assert.deepEqual(second, { state: "running" }, "it is queued behind the first, not run beside it");
  assert.deepEqual(log, ["start:first"]);
  assert.deepEqual(runner.stats(), { running: 1, waiting: 1, jobs: 2 });
  gate.resolve();
  await runner.idle();
  assert.deepEqual(log, ["start:first", "end:first", "start:second", "end:second"]);
});

test("reviews for one case run strictly one after another, in the order asked", async () => {
  const runner = createSupervisorReviewRunner({ budgetMs: 5, concurrency: 8 });
  const log = [];
  const gates = [deferred(), deferred(), deferred()];
  let active = 0;
  let peak = 0;
  const job = (name, gate) => async () => {
    active += 1;
    peak = Math.max(peak, active);
    log.push(`start:${name}`);
    await gate.promise;
    log.push(`end:${name}`);
    active -= 1;
  };
  await Promise.all(["a", "b", "c"].map((name, index) => runner.run({ caseId: "c1", lineage: name, identity: name, work: job(name, gates[index]) })));
  await tick(10);
  assert.deepEqual(log, ["start:a"]);
  gates[2].resolve();
  gates[1].resolve();
  await tick(10);
  assert.deepEqual(log, ["start:a"], "later jobs wait for the first even when they could finish");
  gates[0].resolve();
  await runner.idle();
  assert.deepEqual(log, ["start:a", "end:a", "start:b", "end:b", "start:c", "end:c"]);
  assert.equal(peak, 1);
});

test("reviews for different cases run together, up to the concurrency limit", async () => {
  for (const concurrency of [1, 2, 3]) {
    const runner = createSupervisorReviewRunner({ budgetMs: 5, concurrency, queueLimit: 16 });
    const gate = deferred();
    let active = 0;
    let peak = 0;
    const work = async () => { active += 1; peak = Math.max(peak, active); await gate.promise; active -= 1; };
    await Promise.all(["c1", "c2", "c3", "c4", "c5"].map((caseId) => runner.run({ caseId, lineage: caseId, identity: caseId, work })));
    await tick(15);
    assert.equal(active, concurrency, `${concurrency} at once`);
    assert.deepEqual(runner.stats(), { running: concurrency, waiting: 5 - concurrency, jobs: 5 });
    gate.resolve();
    await runner.idle();
    assert.equal(peak, concurrency);
  }
});

test("past the queue limit a call is told the service is busy, and nothing is started for it", async () => {
  const runner = createSupervisorReviewRunner({ budgetMs: 5, concurrency: 1, queueLimit: 1 });
  const gate = deferred();
  const log = [];
  await runner.run({ caseId: "c1", lineage: "l1", identity: "a", work: tracked(log, "a", gate) });
  await runner.run({ caseId: "c2", lineage: "l2", identity: "b", work: tracked(log, "b") });
  assert.deepEqual(runner.stats(), { running: 1, waiting: 1, jobs: 2 });
  for (const caseId of ["c3", "c1", "c2"]) {
    await assert.rejects(
      () => runner.run({ caseId, lineage: `x-${caseId}`, identity: `x-${caseId}`, work: tracked(log, `x-${caseId}`) }),
      (error) => error.code === SUPERVISOR_REVIEW_BUSY && /Nothing was approved/u.test(error.message),
      caseId
    );
  }
  assert.deepEqual(log, ["start:a"]);
  assert.deepEqual(runner.stats(), { running: 1, waiting: 1, jobs: 2 });
  // The identical request still joins, since it adds no work.
  assert.deepEqual(await runner.run({ caseId: "c2", lineage: "l2", identity: "b", work: tracked(log, "b-again") }), { state: "running" });
  gate.resolve();
  await runner.idle();
  assert.deepEqual(log, ["start:a", "end:a", "start:b", "end:b"]);
  // Room again once the queue has drained.
  assert.equal((await runner.run({ caseId: "c3", lineage: "l3", identity: "c", work: async () => "ok" })).value, "ok");
});

test("a provider outage on a draft is not retried for the cooldown, but other drafts, other failures and later successes are unaffected", async () => {
  let clock = 1_000;
  const runner = createSupervisorReviewRunner({ budgetMs: 1_000, cooldownMs: 100, now: () => clock });
  const outage = Object.assign(new Error("Nothing was approved."), { code: "SUPERVISOR_REVIEW_UNAVAILABLE" });
  let calls = 0;
  const failing = async () => { calls += 1; throw outage; };
  await assert.rejects(() => runner.run({ caseId: "c1", lineage: "l1", identity: "a1", work: failing }), (error) => error === outage);
  assert.equal(calls, 1);
  // Within the cooldown the same draft is refused without calling the provider again, whatever the request's identity.
  await assert.rejects(() => runner.run({ caseId: "c1", lineage: "l1", identity: "a2", work: failing }), (error) => error === outage);
  assert.equal(calls, 1);
  // Another draft, or the same lineage name in another case, is not held back.
  assert.equal((await runner.run({ caseId: "c1", lineage: "l2", identity: "b", work: async () => "other" })).value, "other");
  assert.equal((await runner.run({ caseId: "c2", lineage: "l1", identity: "c", work: async () => "other case" })).value, "other case");
  // After the cooldown it is tried again, and a success clears the memory of the failure.
  clock += 101;
  assert.equal((await runner.run({ caseId: "c1", lineage: "l1", identity: "a3", work: async () => "recovered" })).value, "recovered");
  assert.equal((await runner.run({ caseId: "c1", lineage: "l1", identity: "a4", work: async () => "again" })).value, "again");
  // Other failures are not outages and never start a cooldown; neither does a job with no lineage yet.
  const other = Object.assign(new Error("synthetic"), { code: "SYNTHETIC" });
  await assert.rejects(() => runner.run({ caseId: "c1", lineage: "l3", identity: "d1", work: async () => { throw other; } }), (error) => error === other);
  assert.equal((await runner.run({ caseId: "c1", lineage: "l3", identity: "d2", work: async () => "fine" })).value, "fine");
  await assert.rejects(() => runner.run({ caseId: "c1", lineage: null, identity: "e1", work: failing }), (error) => error === outage);
  assert.equal((await runner.run({ caseId: "c1", lineage: null, identity: "e2", work: async () => "fine" })).value, "fine");
  // An isolation failure is held back like an outage.
  const isolation = Object.assign(new Error("synthetic"), { code: "PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE" });
  await assert.rejects(() => runner.run({ caseId: "c1", lineage: "l4", identity: "f1", work: async () => { throw isolation; } }), (error) => error === isolation);
  await assert.rejects(() => runner.run({ caseId: "c1", lineage: "l4", identity: "f2", work: async () => "never" }), (error) => error === isolation);
});

test("a failure after the budget starts the cooldown too, and no cooldown is kept when none is set", async () => {
  const outage = Object.assign(new Error("Nothing was approved."), { code: "SUPERVISOR_REVIEW_UNAVAILABLE" });
  const runner = createSupervisorReviewRunner({ budgetMs: 10, cooldownMs: 60_000 });
  const gate = deferred();
  assert.deepEqual(await runner.run({ caseId: "c1", lineage: "l1", identity: "a", work: async () => { await gate.promise; throw outage; } }), { state: "running" });
  gate.resolve();
  await runner.idle();
  await assert.rejects(() => runner.run({ caseId: "c1", lineage: "l1", identity: "b", work: async () => "never" }), (error) => error === outage);
  const none = createSupervisorReviewRunner({ budgetMs: 1_000, cooldownMs: 0 });
  await assert.rejects(() => none.run({ caseId: "c1", lineage: "l1", identity: "a", work: async () => { throw outage; } }), (error) => error === outage);
  assert.equal((await none.run({ caseId: "c1", lineage: "l1", identity: "b", work: async () => "tried again" })).value, "tried again");
});

test("stats name no case, draft or content", async () => {
  const runner = createSupervisorReviewRunner({ budgetMs: 5 });
  const gate = deferred();
  await runner.run({ caseId: "synthetic-private-case", lineage: "synthetic-private-draft", identity: "synthetic-private-identity", work: () => gate.promise });
  const stats = JSON.stringify(runner.stats());
  assert.equal(stats.includes("synthetic"), false);
  gate.resolve();
  await runner.idle();
});
