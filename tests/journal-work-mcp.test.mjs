import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJournalWorkExchange } from "../src/journal-import/work-exchange.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repositoryRoot, "src/cli/journal-work-mcp.mjs");
const sentinel = "SYNTHETIC_PRIVATE_SENTINEL_DO_NOT_LOG";

function work(workId, tier) {
  return { schema_version: 1, work_id: workId, case_id: "synthetic-case", role: "reference_reader", tier,
    instruction: "Use only the synthetic packet.", packet: { text: sentinel }, output_schema_name: "synthetic",
    output_schema: { type: "object", additionalProperties: false, required: ["ok"], properties: { ok: { type: "boolean" } } },
    expected_generation: "generation:synthetic", issued_at: "2026-09-28T00:00:00.000Z",
    expires_at: "2099-09-29T00:00:00.000Z", input_sha256: "a".repeat(64), grant_id: "grant:synthetic",
    grant_purpose: "organize_search", route_ref: "route:synthetic" };
}

test("the local stdio server completes hardest work, records its principal, filters standard work and keeps content off stderr", async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "journal-work-mcp-"));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, "exchange");
  await fs.mkdir(root, { mode: 0o700 });
  const secret = randomBytes(32).toString("base64");
  const exchange = createJournalWorkExchange({ root, secret });
  await exchange.publishWork(work("journal-work:hardest-synthetic", "hardest"));
  await exchange.publishWork(work("journal-work:standard-synthetic", "standard"));
  const config = path.join(base, "run.json");
  await fs.writeFile(config, JSON.stringify({ schema_version: 1, target_profile: { case_id: "synthetic-case" } }), { mode: 0o600 });
  const child = spawn(process.execPath, [cli, "--config", config, "--principal", "opus-worker", "--tier", "hardest"], {
    cwd: repositoryRoot, env: { ...process.env, INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT: root,
      INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_BASE64: secret }, stdio: ["pipe", "pipe", "pipe"]
  });
  let stdout = "", stderr = "";
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const requests = [
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_journal_work_packet", arguments: { work_id: "journal-work:hardest-synthetic" } } },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "submit_journal_work_result", arguments: { work_id: "journal-work:hardest-synthetic", output: { ok: true } } } },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_journal_work_packet", arguments: { work_id: "journal-work:standard-synthetic" } } }
  ];
  child.stdin.end(`${requests.map(JSON.stringify).join("\n")}\n`);
  const code = await new Promise((resolve) => child.once("exit", resolve));
  assert.equal(code, 0, stderr);
  const messages = stdout.trim().split("\n").map(JSON.parse);
  assert.equal(messages[0].result.structuredContent.status, "ready");
  assert.equal(messages[1].result.structuredContent.stored, true);
  assert.equal(messages[2].result.structuredContent.code, "JOURNAL_WORK_NOT_FOUND");
  const stored = await exchange.readResult("journal-work:hardest-synthetic");
  assert.equal(stored.receipt.subject, "local:opus-worker");
  assert.equal(stderr.includes(sentinel), false);
  assert.equal(stderr, "");
});
