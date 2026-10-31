import test from "node:test";
import assert from "node:assert/strict";
import { CASE_ID, OTHER_CASE_ID, makeReplyEnvironment } from "./fixtures/supervisor-reply-environment.mjs";

// Reviews take minutes in life, so a call is answered within a bounded time and the review carries on in the background, one
// at a time per case, with a bounded number at once. Everything a review has done is stored, so a restart loses nothing. The
// reviewing model here waits for gates the tests open. Synthetic cases only.

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(condition, what, timeoutMs = 4_000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}`);
    await sleep(5);
  }
}
// A reviewing model that holds the Nth audit until its gate is opened.
function gated(gates) {
  return { beforeAudit: async ({ index }) => { await gates[index]?.promise; } };
}
const FAST = { budgetMs: 40, cooldownMs: 0 };

test("a long review is answered 'reviewing' within the budget, then finishes in the background", async (t) => {
  const gates = { 1: deferred() };
  const env = await makeReplyEnvironment(t, { runnerOptions: FAST, hooks: gated(gates) });
  t.after(() => gates[1].resolve());
  const started = Date.now();
  const reviewing = await env.submit({ text: "Synthetic outside reply.", idempotency_key: "key-slow" });
  assert.ok(Date.now() - started < 3_000, "the call came back although the review was held");
  assert.equal(reviewing.status, "reviewing");
  assert.equal(reviewing.exportable, false);
  assert.equal(reviewing.idempotency_key, "key-slow");
  assert.equal(reviewing.artifact.status, "pending_audit");
  assert.equal(reviewing.artifact.approved, false);
  assert.match(reviewing.notice, /Nothing is approved yet/u);

  // While it runs: nothing is approved, nothing can be exported, and asking again joins the review instead of starting another.
  const artifactId = reviewing.artifact.artifact_id;
  assert.equal((await env.refused("export_approved_reply", { case_id: CASE_ID, artifact_id: artifactId })).code, "SUPERVISOR_ARTIFACT_NOT_APPROVED");
  const record = await env.reload();
  assert.equal(record.candidate_responses[0].status, "pending_audit");
  assert.deepEqual(record.candidate_responses[0].audit_history, []);
  assert.equal((await env.ok("get_reply_draft_status", { case_id: CASE_ID, idempotency_key: "key-slow" })).status, "reviewing");
  assert.equal((await env.ok("get_reply_draft_status", { case_id: CASE_ID, artifact_id: artifactId })).status, "reviewing");
  assert.equal(env.provider.counts.audit, 1);
  assert.deepEqual(env.runner.stats(), { running: 1, waiting: 0, jobs: 1 });

  gates[1].resolve();
  await env.runner.idle();
  const done = await env.ok("get_reply_draft_status", { case_id: CASE_ID, idempotency_key: "key-slow" });
  assert.equal(done.status, "approved");
  assert.equal(done.exportable, true);
  assert.equal(env.provider.counts.audit, 1);
  const exported = await env.call("export_approved_reply", { case_id: CASE_ID, artifact_id: artifactId });
  assert.equal(exported.structured.client_text, "Synthetic outside reply.");
});

test("an identical request while a review runs joins it: one draft, one audit", async (t) => {
  const gates = { 1: deferred() };
  const env = await makeReplyEnvironment(t, { runnerOptions: FAST, hooks: gated(gates) });
  t.after(() => gates[1].resolve());
  const first = await env.submit({ text: "Synthetic outside reply.", idempotency_key: "key-join" });
  const second = await env.submit({ text: "Synthetic outside reply.", idempotency_key: "key-join" });
  assert.equal(first.status, "reviewing");
  assert.equal(second.status, "reviewing");
  assert.equal(env.runner.stats().jobs, 1);
  gates[1].resolve();
  await env.runner.idle();
  assert.equal(env.provider.counts.audit, 1);
  const record = await env.reload();
  assert.equal(record.candidate_responses.length, 1);
  assert.equal(record.candidate_responses[0].audit_history.length, 1);
  assert.equal((await env.submit({ text: "Synthetic outside reply.", idempotency_key: "key-join" })).status, "approved");
  assert.equal(env.provider.counts.audit, 1);
});

test("a review interrupted by a restart is resumed by a status call from the step the stored draft reached", async (t) => {
  const zombie = deferred();
  const first = await makeReplyEnvironment(t, { runnerOptions: FAST, hooks: { beforeAudit: async () => { await zombie.promise; } } });
  t.after(() => zombie.resolve());
  const reviewing = await first.submit({ text: "Synthetic outside reply.", idempotency_key: "key-restart" });
  assert.equal(reviewing.status, "reviewing");

  // A new process on the same storage, with a new connector, runner and reviewing model. The old one never finishes.
  const second = await makeReplyEnvironment(t, { rootDir: first.rootDir, runnerOptions: FAST });
  const before = await second.reload();
  assert.equal(before.candidate_responses[0].status, "pending_audit");
  const resumed = await second.ok("get_reply_draft_status", { case_id: CASE_ID, idempotency_key: "key-restart" });
  assert.equal(resumed.status, "approved");
  assert.equal(resumed.artifact.artifact_id, reviewing.artifact.artifact_id);
  assert.equal(second.provider.counts.audit, 1);
  const exported = await second.call("export_approved_reply", { case_id: CASE_ID, artifact_id: reviewing.artifact.artifact_id });
  assert.equal(exported.structured.client_text, "Synthetic outside reply.");

  // The old process wakes up and finishes its audit. It cannot undo, repeat or replace what the new one stored.
  const settled = JSON.stringify(await second.reload());
  zombie.resolve();
  await first.runner.idle();
  assert.equal(JSON.stringify(await second.reload()), settled);
  const record = await second.reload();
  assert.equal(record.candidate_responses[0].audit_history.length, 1);
  assert.equal(record.supervisor_artifacts.filter((entry) => entry.kind === "review_receipt").length, 1);
  assert.equal(record.candidate_responses[0].status, "approved_for_delivery");
});

test("after a restart the same submission resumes the review rather than starting another draft", async (t) => {
  const zombie = deferred();
  const first = await makeReplyEnvironment(t, { runnerOptions: FAST, hooks: { beforeAudit: async () => { await zombie.promise; } } });
  t.after(() => zombie.resolve());
  assert.equal((await first.submit({ text: "Synthetic outside reply.", idempotency_key: "key-restart-2" })).status, "reviewing");
  const second = await makeReplyEnvironment(t, { rootDir: first.rootDir, runnerOptions: FAST });
  const again = await second.submit({ text: "Synthetic outside reply.", idempotency_key: "key-restart-2" });
  assert.equal(again.status, "approved");
  assert.equal(again.replayed, true);
  assert.equal((await second.reload()).candidate_responses.length, 1);
  assert.equal(second.provider.counts.audit, 1);
  zombie.resolve();
  await first.runner.idle();
});

test("a review that failed on the model service is stored pending and a later status call finishes it", async (t) => {
  const outage = { down: true };
  const env = await makeReplyEnvironment(t, { runnerOptions: FAST, hooks: { beforeAudit: async () => { if (outage.down) throw Object.assign(new Error("synthetic provider outage"), { code: "SYNTHETIC_OUTAGE" }); } } });
  const failed = await env.refused("submit_reply_draft", { case_id: CASE_ID, source: "external_draft", text: "Synthetic outside reply.", idempotency_key: "key-outage" });
  assert.equal(failed.code, "SUPERVISOR_REVIEW_UNAVAILABLE");
  const stored = await env.reload();
  assert.equal(stored.candidate_responses.length, 1);
  assert.equal(stored.candidate_responses[0].status, "pending_audit");
  assert.equal(stored.candidate_responses[0].exact_text, "Synthetic outside reply.");
  outage.down = false;
  const finished = await env.ok("get_reply_draft_status", { case_id: CASE_ID, idempotency_key: "key-outage" });
  assert.equal(finished.status, "approved");
  assert.equal((await env.reload()).candidate_responses.length, 1);
});

test("while the model service is failing the same draft is not tried again for the cooldown", async (t) => {
  const outage = { down: true };
  const env = await makeReplyEnvironment(t, {
    runnerOptions: { budgetMs: 1_000, cooldownMs: 60_000 },
    hooks: { beforeAudit: async () => { if (outage.down) throw Object.assign(new Error("synthetic provider outage"), { code: "SYNTHETIC_OUTAGE" }); } }
  });
  const args = { case_id: CASE_ID, source: "external_draft", text: "Synthetic outside reply.", idempotency_key: "key-cooldown" };
  assert.equal((await env.refused("submit_reply_draft", args)).code, "SUPERVISOR_REVIEW_UNAVAILABLE");
  const attempts = env.provider.counts.audit;
  assert.ok(attempts >= 1);
  // Polling, or sending it again, does not repeat the failing provider call.
  assert.equal((await env.refused("submit_reply_draft", args)).code, "SUPERVISOR_REVIEW_UNAVAILABLE");
  assert.equal((await env.refused("get_reply_draft_status", { case_id: CASE_ID, idempotency_key: "key-cooldown" })).code, "SUPERVISOR_REVIEW_UNAVAILABLE");
  assert.equal(env.provider.counts.audit, attempts);
  // Another draft is a different matter.
  outage.down = false;
  assert.equal((await env.submit({ text: "Synthetic different reply.", idempotency_key: "key-other" })).status, "approved");
});

test("two drafts for one case are reviewed one after another, in order, even though the runner has room", async (t) => {
  const gates = { 1: deferred() };
  const env = await makeReplyEnvironment(t, { runnerOptions: { ...FAST, concurrency: 4 }, hooks: gated(gates) });
  t.after(() => gates[1].resolve());
  const a = await env.submit({ text: "Synthetic reply A.", idempotency_key: "key-a" });
  const b = await env.submit({ text: "Synthetic reply B.", idempotency_key: "key-b" });
  assert.equal(a.status, "reviewing");
  assert.equal(b.status, "reviewing");
  await sleep(60);
  assert.equal(env.provider.counts.audit, 1, "the second draft's review has not begun");
  assert.deepEqual((await env.reload()).candidate_responses.map((candidate) => candidate.exact_text), ["Synthetic reply A."], "the second draft is not stored until its turn");
  gates[1].resolve();
  await env.runner.idle();
  assert.equal(env.provider.counts.audit, 2);
  assert.equal(env.provider.peak.audits, 1);
  assert.deepEqual(env.provider.calls.filter((call) => call.stage === "private_candidate_audit").map((call) => call.candidateText), ["Synthetic reply A.", "Synthetic reply B."]);
  const statusB = await env.ok("get_reply_draft_status", { case_id: CASE_ID, idempotency_key: "key-b" });
  assert.equal(statusB.status, "approved");
  assert.equal(statusB.exportable, true);
  assert.equal((await env.refused("export_approved_reply", { case_id: CASE_ID, artifact_id: a.artifact.artifact_id })).code, "SUPERVISOR_ARTIFACT_STALE");
});

test("two cases are reviewed together up to the concurrency limit, and the rest wait", async (t) => {
  for (const concurrency of [2, 1]) {
    const gates = { 1: deferred(), 2: deferred() };
    const env = await makeReplyEnvironment(t, { runnerOptions: { ...FAST, concurrency }, hooks: gated(gates) });
    const release = () => { gates[1].resolve(); gates[2].resolve(); };
    t.after(release);
    const a = await env.submit({ case_id: CASE_ID, text: "Synthetic reply for the first case.", idempotency_key: "key-one" });
    const b = await env.submit({ case_id: OTHER_CASE_ID, text: "Synthetic reply for the second case.", idempotency_key: "key-two" });
    assert.equal(a.status, "reviewing");
    assert.equal(b.status, "reviewing");
    if (concurrency === 2) {
      await until(() => env.provider.counts.audit === 2, "both cases to be under review at once");
      assert.equal(env.provider.peak.audits, 2);
    } else {
      await sleep(60);
      assert.equal(env.provider.counts.audit, 1, "with room for one, the second case waits");
      assert.deepEqual(env.runner.stats(), { running: 1, waiting: 1, jobs: 2 });
    }
    release();
    await env.runner.idle();
    assert.equal(env.provider.counts.audit, 2);
    assert.equal(env.provider.peak.audits, concurrency);
    assert.equal((await env.ok("get_reply_draft_status", { case_id: CASE_ID, idempotency_key: "key-one" })).status, "approved");
    assert.equal((await env.ok("get_reply_draft_status", { case_id: OTHER_CASE_ID, idempotency_key: "key-two" })).status, "approved");
    // Each case's draft was reviewed with that case's own record: neither draft is in the other case.
    assert.deepEqual((await env.reload(CASE_ID)).candidate_responses.map((candidate) => candidate.exact_text), ["Synthetic reply for the first case."]);
    assert.deepEqual((await env.reload(OTHER_CASE_ID)).candidate_responses.map((candidate) => candidate.exact_text), ["Synthetic reply for the second case."]);
  }
});

test("past the queue limit a submission is told InnerSignal is busy and stores nothing", async (t) => {
  const gates = { 1: deferred() };
  const env = await makeReplyEnvironment(t, { runnerOptions: { ...FAST, concurrency: 1, queueLimit: 0 }, hooks: gated(gates) });
  t.after(() => gates[1].resolve());
  assert.equal((await env.submit({ case_id: CASE_ID, text: "Synthetic reply.", idempotency_key: "key-busy-1" })).status, "reviewing");
  const before = JSON.stringify(await env.reload(OTHER_CASE_ID));
  const busy = await env.refused("submit_reply_draft", { case_id: OTHER_CASE_ID, source: "external_draft", text: "Synthetic reply.", idempotency_key: "key-busy-2" });
  assert.equal(busy.code, "SUPERVISOR_REVIEW_BUSY");
  assert.equal(JSON.stringify(await env.reload(OTHER_CASE_ID)), before);
  gates[1].resolve();
  await env.runner.idle();
  assert.equal((await env.submit({ case_id: OTHER_CASE_ID, text: "Synthetic reply.", idempotency_key: "key-busy-2" })).status, "approved");
});

test("revoking access while a review runs lets the review finish but releases nothing", async (t) => {
  const gates = { 1: deferred() };
  const env = await makeReplyEnvironment(t, { runnerOptions: FAST, hooks: gated(gates) });
  t.after(() => gates[1].resolve());
  const reviewing = await env.submit({ text: "Synthetic outside reply.", idempotency_key: "key-revoked" });
  env.revoked.add("token-reply-only");
  gates[1].resolve();
  await env.runner.idle();
  const record = await env.reload();
  assert.equal(record.candidate_responses[0].status, "approved_for_delivery", "the backend's own review ran to its end");
  for (const [name, args] of [
    ["export_approved_reply", { case_id: CASE_ID, artifact_id: reviewing.artifact.artifact_id }],
    ["get_reply_draft_status", { case_id: CASE_ID, idempotency_key: "key-revoked" }],
    ["report_reply_sent", { case_id: CASE_ID, artifact_id: reviewing.artifact.artifact_id }]
  ]) {
    assert.equal((await env.call(name, args)).status, 401, name);
  }
  assert.deepEqual((await env.reload()).communication_events, []);
  env.revoked.delete("token-reply-only");
  assert.equal((await env.call("export_approved_reply", { case_id: CASE_ID, artifact_id: reviewing.artifact.artifact_id })).isError, false);
});
