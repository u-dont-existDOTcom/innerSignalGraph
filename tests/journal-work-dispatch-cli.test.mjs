import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJournalWorkExchange, journalWorkFileKey } from "../src/journal-import/work-exchange.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repositoryRoot, "src/cli/journal-work.mjs");
const SENTINEL = "PRIVATE_PACKET_SENTINEL_DO_NOT_PRINT";

async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "journal-work-dispatch-cli-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const exchange = createJournalWorkExchange({ root, secret: randomBytes(32) });
  return { root, exchange };
}

function work(workId, { expiresAt = "2099-01-02T00:00:00.000Z", tier = "standard" } = {}) {
  return {
    schema_version: 1,
    work_id: workId,
    case_id: "synthetic-journal-case",
    role: "extractor",
    tier,
    instruction: "Synthetic instruction.",
    packet: { text: SENTINEL },
    output_schema_name: "synthetic-result",
    output_schema: { type: "object" },
    expected_generation: null,
    issued_at: expiresAt.startsWith("2099") ? "2099-01-01T00:00:00.000Z" : "2000-01-01T00:00:00.000Z",
    expires_at: expiresAt
  };
}

async function publish(exchange, entry) {
  await exchange.publishWork(entry);
  await exchange.publishDispatch({
    schema_version: 1,
    work_id: entry.work_id,
    ...(entry.tier === "hardest" ? { attempt_identity: "a".repeat(48) } : {}),
    role: entry.role,
    tier: entry.tier,
    output_schema_name: entry.output_schema_name,
    model: "GPT-5.6 Sol",
    effort: "Pro",
    route_ref: "mission-control",
    issued_at: entry.issued_at,
    expires_at: entry.expires_at
  });
}

async function dispatch(root, json = false) {
  return execFileAsync(process.execPath, [cli, "dispatch", ...(json ? ["--json"] : [])], {
    cwd: repositoryRoot,
    env: { ...process.env, INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT: root }
  });
}

test("dispatch lists a published item as unanswered and then answered without packet content", async (t) => {
  const { root, exchange } = await setup(t);
  const entry = work("job:dispatch-cli-synthetic-0001");
  await publish(exchange, entry);

  const first = await dispatch(root, true);
  assert.equal(first.stderr, "");
  assert.ok(!first.stdout.includes(SENTINEL));
  assert.deepEqual(JSON.parse(first.stdout), {
    work_id: entry.work_id,
    role: "extractor",
    output_schema_name: "synthetic-result",
    model: "GPT-5.6 Sol",
    effort: "Pro",
    tier: "standard",
    issued_at: entry.issued_at,
    expires_at: entry.expires_at,
    answered: false
  });

  await exchange.submitResult({ workId: entry.work_id, output: { items: [] }, subject: "synthetic" });
  assert.equal(JSON.parse((await dispatch(root)).stdout).answered, true);
});

test("dispatch reports the persisted hardest tier to the worker", async (t) => {
  const { root, exchange } = await setup(t);
  const entry = work("job:dispatch-cli-hardest-0004", { tier: "hardest" });
  await publish(exchange, entry);
  const result = await dispatch(root, true);
  assert.equal(result.stderr, "");
  assert.equal(JSON.parse(result.stdout).tier, "hardest");
  assert.equal(JSON.parse(result.stdout).attempt_identity, "a".repeat(48));
});

test("dispatch skips bad records and counts them without printing their contents", async t => {
  const { root, exchange } = await setup(t);
  const entry = work("job:synthetic-valid-dispatch");
  await publish(exchange, entry);
  const badId = "job:synthetic-missing-identity";
  const original = (await exchange.listDispatch())[0];
  const { answered, ...fields } = original;
  await fs.writeFile(path.join(root, "dispatch", `${journalWorkFileKey(badId)}.json`),
    JSON.stringify({ ...fields, work_id: badId, tier: "hardest" }), { mode: 0o600 });
  await fs.writeFile(path.join(root, "dispatch", `${"b".repeat(64)}.json`), SENTINEL, { mode: 0o600 });
  const records = await exchange.listDispatch();
  assert.deepEqual(records.map(record => record.work_id), [entry.work_id]);
  assert.equal(exchange.invalidDispatchCount(), 2);
  const result = await dispatch(root, true);
  assert.equal(JSON.parse(result.stdout).work_id, entry.work_id);
  assert.equal(result.stderr, "");
  assert.ok(!result.stdout.includes(SENTINEL));
});

test("dispatch omits expired and retired items and is silent when none remain", async (t) => {
  const { root, exchange } = await setup(t);
  await publish(exchange, work("job:dispatch-cli-expired-0002", { expiresAt: "2000-01-02T00:00:00.000Z" }));
  const retired = work("job:dispatch-cli-retired-0003");
  await publish(exchange, retired);
  await exchange.retireWork(retired.work_id);

  const result = await dispatch(root);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});

test("dispatch rejects missing and unsafe roots with only a content-free error code", async (t) => {
  const { root } = await setup(t);
  await assert.rejects(dispatch(path.join(path.dirname(root), "missing-exchange")), (error) => {
    assert.equal(error.stdout, "");
    assert.equal(error.stderr, "JOURNAL_WORK_EXCHANGE_ROOT_MISSING\n");
    return true;
  });
  await fs.chmod(root, 0o755);
  await assert.rejects(dispatch(root), (error) => {
    assert.equal(error.stdout, "");
    assert.equal(error.stderr, "JOURNAL_WORK_EXCHANGE_ROOT_INSECURE\n");
    return true;
  });
});

test("session-reserve records every session context and reports one owned by another item", async (t) => {
  const { root } = await setup(t);
  const run = (args) => execFileAsync(process.execPath, [cli, "session-reserve", ...args], {
    cwd: repositoryRoot, env: { ...process.env, INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT: root } });
  const reserve = async (workId, ...sessions) => JSON.parse((await run(["--work-id", workId,
    ...sessions.flatMap((session) => ["--session-context", `claude-session:${session}`])])).stdout);
  assert.deepEqual(await reserve("job:synthetic-first", "aaaaaaaa"), { reserved: true });
  assert.deepEqual(await reserve("job:synthetic-first", "aaaaaaaa"), { reserved: true }, "idempotent for the same item");
  assert.deepEqual(await reserve("job:synthetic-second", "aaaaaaaa", "bbbbbbbb"), { reserved: false, session_reused: true });
  // The context not owned elsewhere was still reserved for the second item.
  assert.deepEqual(await reserve("job:synthetic-third", "bbbbbbbb"), { reserved: false, session_reused: true });
  assert.deepEqual(await reserve("job:synthetic-second", "bbbbbbbb"), { reserved: true });
  assert.equal((await fs.readdir(path.join(root, "claude-sessions"))).length, 2);
  for (const bad of [[], ["--work-id", "job:synthetic-first"], ["--work-id", "job:synthetic-first", "--session-context", "not-a-context"],
    ["--work-id", "job:synthetic-first", "--work-id", "job:synthetic-other", "--session-context", "claude-session:cccccccc"]]) {
    await assert.rejects(run(bad), (error) => error.stderr.trim() === "JOURNAL_WORK_COMMAND_INVALID");
  }
});
