import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import { lockWorkerDirectory, removeStaleRuns } from "../src/journal-import/codex-worker.mjs";
import path from "node:path";
import { PassThrough } from "node:stream";
import { createJournalWorkExchange } from "../src/journal-import/work-exchange.mjs";
import { createExchangeJournalInferencePort, journalExchangeAttemptIdentity } from "../src/journal-import/exchange-port.mjs";
import { claudeMcpConfiguration, claudePrintArgs, claudeResultReader, parseJournalClaudeWorkerArgs,
  runJournalClaudeWorker, assertClaudeRunPath, claudeRunSlug, cleanClaudePersistence,
  sweepClaudePersistence, CLAUDE_PROVIDER_BACKOFF_MS, CLAUDE_PAUSED_EXIT_CODE, CLAUDE_SETUP_REFUSED_EXIT_CODE, CLAUDE_CLEANUP_FAILED_EXIT_CODE } from "../src/journal-import/claude-worker.mjs";
import { journalAttemptIdentity, journalAttemptMarkerKey, runJournalWork, releaseAttemptMarker, writeAttemptMarker } from "../src/cli/journal-work.mjs";
import { runJournalWorkMcp } from "../src/cli/journal-work-mcp.mjs";
import { createJournalWorkTools, JOURNAL_WORK_TOOL_DEFINITIONS, MAX_JOURNAL_TOOL_RESULT_CHARS } from "../src/server/journal-work-tools.mjs";

const SENTINEL = "SYNTHETIC_CLAUDE_PRIVATE_SENTINEL_DO_NOT_LOG";
const ANSWER = { schema_version: "1.0", source_only_first_pass: true, reference_items: [], questions: [], unassessed_unit_ids: [] };
const GRANT = { grant_id: "grant:synthetic", principal_id: "synthetic-operator", purpose: "organize_search",
  allowed_roles: ["reference_reader"], revoked: false, expires_at: null };

function call(operationKey) {
  return { role: "reference_reader", outputSchema: "reference-result", operationKey, grant: GRANT,
    packet: { protocol_version: "1.0", output_schema_id: "reference-result", assigned_core_ids: ["u1"],
      source_locators: [{ representation_id: "r1", page: null, start_byte: 0, end_byte: Buffer.byteLength(SENTINEL) }],
      expected_generation: "generation:synthetic", controller_provenance_tag: "job:synthetic",
      grant_purpose: "organize_search", source_windows: [{ unit_id: "u1", text: SENTINEL }],
      adjacent_context: { by_unit: [] }, visual_context: [], neutral_reading_instructions: [] } };
}

async function fixture(t, scenario = "ok", { workName = "work" } = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "journal-claude-test-"));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const host = path.join(base, "host"), laptop = path.join(base, "laptop");
  const root = path.join(host, "exchange"), workDir = path.join(laptop, workName);
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  await fs.mkdir(workDir, { recursive: true, mode: 0o700 });
  const secret = randomBytes(32).toString("base64");
  const secretFile = path.join(host, "secret");
  await fs.writeFile(secretFile, secret, { mode: 0o600 });
  const config = path.join(host, "run.json");
  await fs.writeFile(config, JSON.stringify({ target_profile: { case_id: "synthetic-case" } }), { mode: 0o600 });
  const trace = path.join(laptop, "trace.json");
  const log = path.join(laptop, "log.jsonl");
  const ssh = path.join(laptop, "ssh-fake.mjs");
  const sshTrace = path.join(laptop, "ssh-trace.jsonl");
  const claude = path.join(laptop, "claude-fake.mjs");
  const checkout = path.resolve(new URL("..", import.meta.url).pathname);
  await fs.writeFile(ssh, `#!${process.execPath}
import fs from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(sshTrace)}, JSON.stringify({ args, env: Object.keys(process.env).sort() }) + "\\n");
if (${JSON.stringify(scenario)} === "stage_remove_failure" && args.at(-1).includes("stage-remove")) process.exit(34);
if (${JSON.stringify(scenario)} === "oversize_packet" && args.at(-1).includes("packet-check")) {
  console.log('{"allowed":false,"packet_length":500000,"reason":"too_large"}'); process.exit(0);
}
if (${JSON.stringify(scenario)} === "expired_packet" && args.at(-1).includes("packet-check")) {
  console.log('{"allowed":false,"packet_length":null,"reason":"expired"}'); process.exit(0);
}
const failFirst = (name, count, code) => {
  const marker = path.join(${JSON.stringify(laptop)}, name + "-count");
  const seen = fs.existsSync(marker) ? Number(fs.readFileSync(marker, "utf8")) : 0;
  fs.writeFileSync(marker, String(seen + 1));
  if (seen < count) process.exit(code);
};
if (${JSON.stringify(scenario)} === "session_reserve_failure" && args.at(-1).includes("'session-reserve'")) failFirst("session-reserve", 1, 39);
if (${JSON.stringify(scenario)} === "refuse_failure" && args.at(-1).includes("'attempt-refuse'")) failFirst("attempt-refuse", 1, 42);
if (${JSON.stringify(scenario)} === "mark_failure" && args.at(-1).includes("'attempt-mark'")) failFirst("attempt-mark", 2, 43);
if (${JSON.stringify(scenario)} === "mark_failure" && args.at(-1).includes("'close-unanswered'")) failFirst("close-unanswered", 1, 44);
if (${JSON.stringify(scenario)} === "unstaged_close_failure" && args.at(-1).includes("'close-unanswered'")) failFirst("close-unanswered", 1, 44);
if (["mark_reply_lost", "stale_close_failure"].includes(${JSON.stringify(scenario)}) && args.at(-1).includes("'close-unanswered'")) failFirst("close-unanswered", 1, 44);
if (${JSON.stringify(scenario)} === "refuse_unsaved_slow" && args.at(-1).includes("'attempt-refuse'")) {
  // Three refusals fail, slowly after the first; the first also makes the hold unsavable and the third restores that.
  const pending = path.join(${JSON.stringify(workDir)}, "pending-refusals"), moved = pending + ".moved";
  const marker = path.join(${JSON.stringify(laptop)}, "refuse-slow-count");
  const seen = fs.existsSync(marker) ? Number(fs.readFileSync(marker, "utf8")) : 0;
  fs.writeFileSync(marker, String(seen + 1));
  if (seen > 0 && seen < 3) await new Promise((resolve) => setTimeout(resolve, 700));
  if (seen === 0) { fs.renameSync(pending, moved); fs.writeFileSync(pending, ""); }
  if (seen === 2) { fs.rmSync(pending); fs.renameSync(moved, pending); }
  if (seen < 3) process.exit(42);
}
if (${JSON.stringify(scenario)} === "refuse_unsaved" && args.at(-1).includes("'attempt-refuse'")) {
  // The first failed refusal also leaves the laptop unable to save the hold; the second restores that.
  const pending = path.join(${JSON.stringify(workDir)}, "pending-refusals"), moved = pending + ".moved";
  const marker = path.join(${JSON.stringify(laptop)}, "refuse-unsaved-count");
  const seen = fs.existsSync(marker) ? Number(fs.readFileSync(marker, "utf8")) : 0;
  fs.writeFileSync(marker, String(seen + 1));
  if (seen === 0) { fs.renameSync(pending, moved); fs.writeFileSync(pending, ""); process.exit(42); }
  if (seen === 1) { fs.rmSync(pending); fs.renameSync(moved, pending); process.exit(42); }
}
if (${JSON.stringify(scenario)} === "slow_preflight" && /'(?:stage-create|session-reserve)'/.test(args.at(-1))) {
  await new Promise((resolve) => setTimeout(resolve, 1500)); // each within the host-call timeout, together past the preflight limit
}
if (${JSON.stringify(scenario)} === "session_stolen" && args.at(-1).includes("'promote'")) {
  // Another item takes this run's session reservation between Claude's run and promotion.
  const directory = path.join(${JSON.stringify(root)}, "claude-sessions");
  for (const name of fs.readdirSync(directory)) fs.writeFileSync(path.join(directory, name), JSON.stringify({ work_id: "job:synthetic-other-item" }));
}
if (${JSON.stringify(scenario)} === "release_unsaved" && args.at(-1).includes("'attempt-release'")) {
  // The first failed release also leaves the laptop unable to save its claim; the second restores that.
  const pending = path.join(${JSON.stringify(workDir)}, "pending-releases"), moved = pending + ".moved";
  const marker = path.join(${JSON.stringify(laptop)}, "release-unsaved-count");
  const seen = fs.existsSync(marker) ? Number(fs.readFileSync(marker, "utf8")) : 0;
  fs.writeFileSync(marker, String(seen + 1));
  if (seen === 0) { fs.renameSync(pending, moved); fs.writeFileSync(pending, ""); process.exit(40); }
  if (seen === 1) { fs.rmSync(pending); fs.renameSync(moved, pending); process.exit(40); }
}
if (${JSON.stringify(scenario)} === "release_failure_restart" && args.at(-1).includes("'attempt-release'")) failFirst("attempt-release", 2, 40);
if (["release_failure", "no_init_release_failure"].includes(${JSON.stringify(scenario)}) && args.at(-1).includes("attempt-release")) {
  const marker = ${JSON.stringify(path.join(laptop, "release-fail-count"))};
  if (!fs.existsSync(marker)) { fs.writeFileSync(marker, "1"); process.exit(37); }
}
if (${JSON.stringify(scenario)} === "already_answered" && args.at(-1).includes("'promote'")) {
  const { createJournalWorkExchange } = await import(${JSON.stringify(path.join(checkout, "src/journal-import/work-exchange.mjs"))});
  const workId = args.at(-1).match(/'--work-id' '([^']+)'/)[1];
  const exchange = createJournalWorkExchange({ root: ${JSON.stringify(root)},
    secret: fs.readFileSync(path.join(path.dirname(${JSON.stringify(config)}), "secret"), "utf8") });
  await exchange.submitResult({ workId, output: ${JSON.stringify(ANSWER)}, subject: "local:synthetic-first" });
}
if (${JSON.stringify(scenario)} === "ssh_prestart_retry" && args.at(-1).includes("stage-create")) {
  const marker = ${JSON.stringify(path.join(laptop, "ssh-prestart-count"))};
  if (!fs.existsSync(marker)) { fs.writeFileSync(marker, "1"); process.exit(35); }
}
if (args.slice(0, 9).join("|") !== ["-o", "BatchMode=yes", "-o", "ClearAllForwardings=yes",
  "-o", "ForwardAgent=no", "-o", "ForwardX11=no", "-T"].join("|")) process.exit(31);
const result = spawnSync("/bin/sh", ["-c", args.at(-1)], { encoding: "utf8", input: fs.readFileSync(0),
  env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG,
    INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT: ${JSON.stringify(root)},
    INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_FILE: path.join(path.dirname(${JSON.stringify(config)}), "secret") } });
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
if (${JSON.stringify(scenario)} === "mark_reply_lost" && args.at(-1).includes("'attempt-mark'")) {
  // The host applies the first mark, but its reply is lost on the way back.
  const marker = path.join(${JSON.stringify(laptop)}, "mark-reply-lost");
  if (!fs.existsSync(marker)) { fs.writeFileSync(marker, "1"); process.exit(45); }
}
process.exit(result.status ?? 1);
`, { mode: 0o700 });
  await fs.writeFile(claude, `#!${process.execPath}
import fs from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
const args = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(args[args.indexOf("--mcp-config") + 1], "utf8"));
const workId = args[args.indexOf("-p") + 1].match(/item ([^ .]+)/)[1];
fs.writeFileSync(${JSON.stringify(trace)}, JSON.stringify({ args, env: Object.keys(process.env).sort(), config }));
let scenario = ${JSON.stringify(scenario)};
if (scenario === "unstaged_close_failure") scenario = "nothing_staged";
if (scenario === "isolation_then_success") {
  const marker = ${JSON.stringify(path.join(laptop, "isolation-count"))};
  if (!fs.existsSync(marker)) { fs.writeFileSync(marker, "1"); scenario = "tools_extra"; }
  else scenario = "ok";
}
const limitScenarios = ["limit_then_success", "assistant_limit", "http429", "rate_event_seconds", "rate_event_ms", "release_failure",
  "release_failure_restart", "release_unsaved"];
// Claude Code reports the session the worker requested in every event; "foreign_session" simulates one that doesn't.
fs.appendFileSync(${JSON.stringify(path.join(laptop, "claude-starts"))}, "x");
const requested = args[args.indexOf("--session-id") + 1];
const sessionId = scenario === "foreign_session" ? "12345678" : requested;
const { createHash } = await import("node:crypto");
const reservation = path.join(${JSON.stringify(root)}, "claude-sessions",
  createHash("sha256").update("inner-signal:claude-session:claude-session:" + requested).digest("hex") + ".json");
if (!fs.existsSync(reservation)) process.exit(41); // the session must be reserved on the host before Claude starts
const slug = process.cwd().replace(/[^A-Za-z0-9]/g, "-");
const project = path.join(process.env.HOME, ".claude", "projects", slug);
fs.mkdirSync(project, { recursive: true });
const cache = path.join(process.env.XDG_CACHE_HOME, "claude-cli-nodejs", slug, "mcp-logs-journal");
fs.mkdirSync(cache, { recursive: true });
fs.writeFileSync(path.join(cache, "synthetic.jsonl"), "synthetic metadata");
if (["project_file", "fallback_cache"].includes(scenario)) {
  const target = scenario === "project_file" ? path.join(project, "session", "tool-results")
    : path.join(process.env.HOME, ".cache", "claude-cli-nodejs", slug, "mcp-logs-journal");
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, "synthetic.txt"), ["SYNTHETIC", "CLAUDE", "PRIVATE", "SENTINEL", "DO", "NOT", "LOG"].join("_"));
}
if (scenario === "cleanup_unreadable") {
  // A fallback-cache root that is a file makes the post-run cleanup unable to inspect it.
  fs.mkdirSync(path.join(process.env.HOME, ".cache"), { recursive: true });
  fs.writeFileSync(path.join(process.env.HOME, ".cache", "claude-cli-nodejs"), "not a directory");
}
if (["no_init_then_success", "no_init_release_failure"].includes(scenario)) {
  const marker = ${JSON.stringify(path.join(laptop, "no-init-count"))};
  if (!fs.existsSync(marker)) { fs.writeFileSync(marker, "1"); process.exit(36); }
}
const init = { type: "system", subtype: "init", mcp_servers: [{ name: "journal", status: "connected" }],
  tools: ["mcp__journal__get_journal_work_packet", "mcp__journal__submit_journal_work_result"],
  skills: [], slash_commands: [], plugins: [{ name: "synthetic" }], agents: [{ name: "synthetic" }],
  claude_code_version: "2.1.287", ...(scenario === "init_without_session" ? {} : { session_id: sessionId }) };
if (scenario === "ui_invalidate") console.log(JSON.stringify({ type: "system", subtype: "ui_invalidate" }));
if (scenario === "init_missing") { console.log(JSON.stringify({ type: "result", is_error: false, subtype: "success" })); process.exit(0); }
if (scenario === "server_extra") init.mcp_servers.push({ name: "other", status: "connected" });
if (scenario === "server_disconnected") init.mcp_servers[0].status = "disconnected";
if (["tools_extra", "refuse_failure", "refuse_unsaved", "refuse_unsaved_slow"].includes(scenario)) init.tools.push("Bash");
if (scenario === "skills_present") init.skills.push("synthetic");
if (scenario === "slashes_present") init.slash_commands.push("synthetic");
console.log(JSON.stringify(init));
if (["ECONNREFUSED", "ENOTFOUND"].includes(scenario)) {
  console.log(JSON.stringify({ type: "result", is_error: true, error: { code: scenario },
    usage: { input_tokens: 0, output_tokens: 0 }, modelUsage: {} }));
  process.exit(1);
}
if (/^http(?:401|403|500|503|529)$/.test(scenario)) {
  const status = Number(scenario.slice(4));
  console.log(JSON.stringify({ type: "assistant", error: status < 500 ? "authentication_failed" : "api_error",
    message: { model: "<synthetic>", usage: { input_tokens: 0, output_tokens: 0 },
      content: [{ type: "text", text: "API Error: " + status + " SYNTHETIC_PROVIDER_SENTINEL" }] } }));
  console.log(JSON.stringify({ type: "result", subtype: "success", is_error: true,
    api_error_status: status, usage: { input_tokens: 0, output_tokens: 0 }, modelUsage: {},
    errors: ["API Error: " + status + " SYNTHETIC_PROVIDER_SENTINEL"] }));
  process.exit(1);
}
if (scenario === "reach_then_hang") {
  console.log(JSON.stringify({ type: "assistant", message: { model: "claude-opus-5-5",
    usage: { input_tokens: 1, output_tokens: 0 }, content: [{ type: "text", text: "SYNTHETIC_MODEL_SENTINEL" }] } }));
  setInterval(() => {}, 1000);
  await new Promise(() => {});
}
if (scenario === "hook_event") console.log(JSON.stringify({ type: "hook_started", hook_name: "synthetic" }));
// Give the parent a chance to kill the process group before any packet tool call.
if (["server_extra", "server_disconnected", "tools_extra", "skills_present", "slashes_present", "hook_event", "foreign_session",
  "init_without_session", "refuse_failure", "refuse_unsaved", "refuse_unsaved_slow"].includes(scenario)) {
  await new Promise(resolve => setTimeout(resolve, 250));
  fs.writeFileSync(${JSON.stringify(path.join(laptop, "packet-called-after-refusal"))}, "bad");
}
if (scenario === "large_user_line") console.log(JSON.stringify({ type: "user", message: { content: "x".repeat(1_500_000) } }));
if (limitScenarios.includes(scenario)) {
  const counter = ${JSON.stringify(path.join(laptop, "limit-count"))};
  if (!fs.existsSync(counter)) {
    fs.writeFileSync(counter, "1");
    if (["assistant_limit", "release_failure", "release_failure_restart", "release_unsaved"].includes(scenario)) console.log(JSON.stringify({ type: "assistant", error: "rate_limit" }));
    if (scenario.startsWith("rate_event")) console.log(JSON.stringify({ type: "rate_limit_event", status: "limited",
      resetsAt: scenario === "rate_event_seconds" ? (Date.now() + 100) / 1000 : Date.now() + 100 }));
    console.log(JSON.stringify({ type: "result", is_error: true,
      subtype: scenario === "http429" ? "success" : "error_during_execution",
      api_error_status: scenario === "http429" ? 429 : undefined,
      error: scenario === "limit_then_success" ? { code: "usage_limit", message: "usage limit reset in 1 seconds" } : undefined,
      session_id: sessionId, modelUsage: {}, result: "synthetic reply" }));
    process.exit(1);
  }
}

if (${JSON.stringify(scenario)} === "timeout") setInterval(() => {}, 1000);
else {
  const server = config.mcpServers.journal;
  // "other_item" names the other open item's work_id, which the run's scoped server must refuse.
  const requestId = scenario === "other_item"
    ? JSON.parse(fs.readFileSync(${JSON.stringify(path.join(laptop, "work-ids.json"))}, "utf8")).find((id) => id !== workId) : workId;
  const names = scenario === "packet_free" ? ["submit_journal_work_result"]
    : scenario === "submit_before_fetch" ? ["submit_journal_work_result", "get_journal_work_packet"]
    : scenario === "nothing_staged" ? ["get_journal_work_packet"]
    : ["get_journal_work_packet", "submit_journal_work_result"];
  const requests = names.map((name, index) => ({ jsonrpc: "2.0", id: index + 1, method: "tools/call",
    params: { name, arguments: name === "submit_journal_work_result"
      ? { work_id: workId, output: ${JSON.stringify(ANSWER)} } : { work_id: requestId } } }));
  const result = spawnSync(server.command, server.args, { encoding: "utf8",
    input: requests.map(JSON.stringify).join("\\n") + "\\n", env: process.env });
  if (result.status !== 0) process.exit(32);
  const replies = result.stdout.trim().split("\\n").map(JSON.parse);
  if (scenario === "other_item") fs.writeFileSync(${JSON.stringify(path.join(laptop, "other-item-reply"))},
    String(replies[0].result.structuredContent?.code));
  for (const [index, name] of (scenario === "nothing_staged" ? [...names, "submit_journal_work_result"] : names).entries()) {
    console.log(JSON.stringify({ type: "assistant", message: { model: "claude-opus-5-5", content: [
      { type: "tool_use", id: "tool-" + index, name: "mcp__journal__" + name,
        input: { work_id: name === "get_journal_work_packet" ? requestId : workId } }] } }));
    if (scenario === "late_hook" && index === 0) console.log(JSON.stringify({ type: "hook_started", hook_name: "synthetic" }));
    if (replies[index]) {
      const content = name === "get_journal_work_packet" && scenario === "packet_truncated"
        ? "SYNTHETIC_PREVIEW" : replies[index].result.content;
      console.log(JSON.stringify({ type: "user", message: { content: [
        { type: "tool_result", tool_use_id: "tool-" + index, content }] } }));
    }
  }
  if (scenario === "packet_free"
    && replies[0].result.structuredContent.code !== "JOURNAL_WORK_PACKET_NOT_FETCHED") process.exit(33);
  const usage = { "claude-opus-5-5": { inputTokens: 2, cacheReadInputTokens: 1, outputTokens: 3 } };
  if (${JSON.stringify(scenario)} === "second_model") usage["other-model"] = { outputTokens: 1 };
  if (scenario === "zero_output") usage["claude-opus-5-5"].outputTokens = 0;
  if (scenario === "helper_zero") usage["helper-model"] = { outputTokens: 0 };
  console.log(JSON.stringify({ type: "result", is_error: scenario === "is_error",
    subtype: "success", ...(scenario === "missing_session" ? {} : { session_id: sessionId }),
    modelUsage: usage, total_cost_usd: 0.25, result: scenario === "reply_limit_words" ? "usage limit rate limit 429"
      : ["SYNTHETIC", "CLAUDE", "PRIVATE", "SENTINEL", "DO", "NOT", "LOG"].join("_") }));
}
`, { mode: 0o700 });
  const exchange = createJournalWorkExchange({ root, secret });
  const port = createExchangeJournalInferencePort({ exchange, caseId: "synthetic-case", receiptKey: randomBytes(32),
    routeRef: "route:synthetic", allowanceEvidence: { authorization_ref: "allowance:synthetic", maximum_incremental_cost_usd: 0 },
    model: "gpt-6-sol", effort: "medium", executionAttestation: "codex_exec", waitMs: 0,
    hardestLane: { model: "claude-opus-5-5", effort: "max" } });
  const environment = { PATH: `${path.dirname(process.execPath)}:${process.env.PATH}`,
    HOME: laptop, LANG: "C" };
  const args = ["--agent", "claude", "--remote", "synthetic-host", "--remote-checkout", checkout,
    "--remote-config", config, "--remote-node", process.execPath, "--work-dir", workDir, "--ssh-bin", ssh, "--claude-bin", claude,
    "--log", log, "--once", "--max-items", "1", "--poll-ms", "10", "--timeout-ms", "2500"];
  return { base, host, laptop, root, workDir, secret, secretFile, config, trace, sshTrace, log, exchange, port, environment, args };
}

// The work dir keeps only the worker's pending-action directories, empty once the host confirmed everything.
const PENDING_DIRECTORIES = ["pending-refusals", "pending-releases", "pending-spends", "setup-refusals"];
async function assertWorkDirClean(workDir, extra = []) {
  assert.deepEqual((await fs.readdir(workDir)).sort(), [...extra, ...PENDING_DIRECTORIES].sort());
  for (const name of PENDING_DIRECTORIES) assert.deepEqual(await fs.readdir(path.join(workDir, name)), []);
}

async function scanFiles(directory) {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const name = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await scanFiles(name));
    else if (entry.isFile()) result.push(await fs.readFile(name));
  }
  return result;
}

test("synthetic SSH and Claude executables parse without private text", async (t) => {
  const f = await fixture(t);
  for (const program of [path.join(f.laptop, "ssh-fake.mjs"), path.join(f.laptop, "claude-fake.mjs")]) {
    const checked = spawnSync(process.execPath, ["--check", program], { encoding: "utf8" });
    assert.equal(checked.status, 0, checked.stderr);
    const bytes = await fs.readFile(program);
    assert.ok(!bytes.includes(Buffer.from(SENTINEL)));
    assert.ok(!bytes.includes(Buffer.from(f.secretFile)));
  }
});

test("Claude arguments map only the pinned hardest profile and remote MCP holds no secret", () => {
  const record = { attempt_identity: "a".repeat(48), work_id: "job:synthetic", tier: "hardest", model: "claude-opus-5-5", effort: "max" };
  const sessionId = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const args = claudePrintArgs({ record, mcpConfig: "/tmp/mcp.json", sessionId });
  assert.deepEqual(args.slice(args.indexOf("--session-id"), args.indexOf("--session-id") + 2), ["--session-id", sessionId]);
  for (const bad of [undefined, "12345678", "0F8FAD5B-D9CB-469F-A165-70867728950E"]) {
    assert.throws(() => claudePrintArgs({ record, mcpConfig: "/tmp/mcp.json", sessionId: bad }), { code: "JOURNAL_CLAUDE_SESSION_INVALID" });
  }
  assert.deepEqual(args.slice(args.indexOf("--model"), args.indexOf("--model") + 4), ["--model", "opus", "--effort", "max"]);
  assert.ok(args.includes("--strict-mcp-config") && args.includes("--no-session-persistence"));
  for (const flag of ["--verbose", "--disable-slash-commands", "--include-hook-events"]) assert.ok(args.includes(flag));
  assert.deepEqual(args.slice(args.indexOf("--output-format"), args.indexOf("--output-format") + 2), ["--output-format", "stream-json"]);
  assert.deepEqual(args.slice(args.indexOf("--setting-sources"), args.indexOf("--setting-sources") + 4),
    ["--setting-sources", "", "--settings", '{"disableAllHooks":true}']);
  assert.deepEqual(args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 2), ["--tools", ""]);
  assert.throws(() => claudePrintArgs({ record: { ...record, model: "claude-unmapped" }, mcpConfig: "/tmp/mcp.json", sessionId }),
    { code: "JOURNAL_CLAUDE_PROFILE_INVALID" });
  const remoteArgs = ["--agent", "claude", "--remote", "host",
    "--remote-checkout", "/host/repo", "--remote-config", "/host/config", "--work-dir", "/tmp/work"];
  for (const extra of [[], ["--remote-node", "node"], ["--remote-node", "/host/node bin"]]) {
    assert.throws(() => parseJournalClaudeWorkerArgs([...remoteArgs, ...extra]), { code: "JOURNAL_CLAUDE_OPTION_INVALID" });
  }
  assert.throws(() => parseJournalClaudeWorkerArgs(["--agent", "claude", "--config", "/laptop/config", "--work-dir", "/tmp/work",
    "--remote-node", "/host/node"]), { code: "JOURNAL_CLAUDE_OPTION_INVALID" });
  const options = parseJournalClaudeWorkerArgs([...remoteArgs, "--remote-node", "/host/node-journal"]);
  assert.equal(options.limitBackoffMs, 30 * 60_000);
  assert.throws(() => claudeMcpConfiguration(options, "/host/stage", {}), { code: "JOURNAL_CLAUDE_OPTION_INVALID" });
  const mcp = JSON.stringify(claudeMcpConfiguration(options, "/host/stage", {}, "job:synthetic-scoped"));
  assert.ok(mcp.includes("'--work-id' 'job:synthetic-scoped'"), "the work server is scoped to the run's item");
  assert.ok(mcp.includes("'/host/node-journal' '/host/repo/src/cli/journal-work-mcp.mjs'"));
  assert.ok(mcp.includes("BatchMode=yes") && mcp.includes("ClearAllForwardings=yes")
    && mcp.includes("ForwardAgent=no") && mcp.includes("ForwardX11=no"));
  assert.ok(!mcp.includes("INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET"));
});

test("Claude result admission strips response text and rejects unverified profiles", () => {
  const record = { model: "claude-opus-5-5", work_id: "job:synthetic" };
  for (const [scenario, change, expected] of [
    ["error", { is_error: true }, "RESULT_UNSUCCESSFUL"],
    ["session", { session_id: null }, "SESSION_INVALID"],
    ["model", { modelUsage: { "claude-opus-5-5": { outputTokens: 1 }, other: { outputTokens: 1 } } }, "MODEL_USAGE_INVALID"]
  ]) {
    const reader = claudeResultReader(record);
    reader.accept(JSON.stringify({ type: "system", subtype: "init", mcp_servers: [{ name: "journal", status: "connected" }],
      tools: ["mcp__journal__get_journal_work_packet", "mcp__journal__submit_journal_work_result"],
      skills: [], slash_commands: [], plugins: [], agents: [] }));
    reader.accept(JSON.stringify({ type: "result", is_error: false, subtype: "success", session_id: "12345678",
      modelUsage: { "claude-opus-5-5": { outputTokens: 1 } }, result: SENTINEL, ...change }));
    assert.equal(reader.state.bad, expected, scenario);
    assert.ok(!JSON.stringify(reader.state).includes(SENTINEL));
  }
});

test("usage-limit admission reads structured errors and ignores reply text", () => {
  const record = { model: "claude-opus-5-5", work_id: "job:synthetic" };
  const init = { type: "system", subtype: "init", mcp_servers: [{ name: "journal", status: "connected" }],
    tools: ["mcp__journal__get_journal_work_packet", "mcp__journal__submit_journal_work_result"],
    skills: [], slash_commands: [], plugins: [], agents: [] };
  const limited = claudeResultReader(record);
  limited.accept(JSON.stringify(init));
  limited.accept(JSON.stringify({ type: "result", is_error: true, subtype: "error_during_execution",
    error: { code: "usage_limit" }, result: "private answer" }));
  assert.equal(limited.state.limitSeen, true);
  assert.equal(limited.state.limitReset, null);
  const success = claudeResultReader(record);
  success.accept(JSON.stringify(init));
  success.accept(JSON.stringify({ type: "result", is_error: false, subtype: "success", session_id: "12345678",
    modelUsage: { "claude-opus-5-5": { outputTokens: 1 }, helper: { outputTokens: 0 } },
    result: "usage limit rate limit 429" }));
  assert.equal(success.state.limitSeen, false);
  assert.equal(success.state.bad, null);
});

test("remote fake Claude answers hardest work; host keeps secret, laptop output stays content free", async (t) => {
  const f = await fixture(t);
  const operationKey = "job:synthetic-claude-hardest";
  await assert.rejects(f.port.invoke({ ...call(operationKey), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
  let stderr = "";
  assert.equal(await runJournalClaudeWorker(f.args, { environment: f.environment,
    stderr: { write: (value) => { stderr += value; } } }), 0);
  const completed = await f.port.getCompletion(operationKey);
  assert.equal(completed.status, "completed");
  assert.deepEqual(completed.output, ANSWER);
  assert.equal(completed.receipt.execution_profile_evidence, "claude_code_model_usage_reported");
  const trace = JSON.parse(await fs.readFile(f.trace, "utf8"));
  assert.deepEqual(trace.env, ["HOME", "LANG", "PATH", "XDG_CACHE_HOME"]);
  assert.equal(trace.args[trace.args.indexOf("--model") + 1], "opus");
  const log = await fs.readFile(f.log, "utf8");
  assert.equal(stderr, "");
  assert.ok(log.includes('"total_cost_usd":0.25'));
  assert.ok(log.includes("subscription_cost_equivalent_not_charged"));
  assert.equal(JSON.parse(log.trim()).claude_code_version, "2.1.287");
  await assertWorkDirClean(path.join(f.laptop, "work"));
  const sshTrace = await fs.readFile(f.sshTrace, "utf8");
  // Worker-run ssh gets PATH, HOME and LANG only; the MCP ssh that Claude starts also inherits the run-local XDG_CACHE_HOME.
  assert.ok(sshTrace.trim().split("\n").map(JSON.parse).every((entry) =>
    ["HOME,LANG,PATH", "HOME,LANG,PATH,XDG_CACHE_HOME"].includes(entry.env.join(","))));
  // Every host command and the MCP server run under the named host Node executable, never a bare `node`.
  assert.ok(sshTrace.trim().split("\n").map(JSON.parse).every((entry) => entry.args.at(-1).startsWith(`'${process.execPath}' '`)));
  for (const channel of [JSON.stringify(f.args), JSON.stringify(trace), sshTrace, log, stderr,
    await fs.readFile(path.join(f.laptop, "ssh-fake.mjs"), "utf8")]) {
    assert.ok(!channel.includes(f.secret));
    assert.ok(!channel.includes(f.secretFile));
    assert.ok(!channel.includes(SENTINEL));
  }
  for (const bytes of await scanFiles(f.laptop)) {
    assert.ok(!bytes.includes(Buffer.from(SENTINEL)));
    assert.ok(!bytes.includes(Buffer.from(f.secretFile)));
  }
  assert.deepEqual(await fs.readdir(path.join(f.root, "stage")), []);
});

for (const scenario of ["reply_limit_words", "helper_zero", "ui_invalidate", "large_user_line"]) {
  test(`Claude ${scenario} is admitted`, async (t) => {
    const f = await fixture(t, scenario);
    const operationKey = `job:synthetic-${scenario}`;
    await assert.rejects(f.port.invoke({ ...call(operationKey), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
    await runJournalClaudeWorker(f.args, { environment: f.environment });
    assert.equal((await f.port.getCompletion(operationKey)).status, "completed");
    assert.equal(JSON.parse((await fs.readFile(f.log, "utf8")).trim()).outcome, "answered");
  });
}

for (const scenario of ["no_init_then_success", "ssh_prestart_retry", "no_init_release_failure"]) {
  test(`${scenario} retries before a model attempt`, async (t) => {
    const f = await fixture(t, scenario);
    const operationKey = `job:synthetic-${scenario}`;
    await assert.rejects(f.port.invoke({ ...call(operationKey), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
    await runJournalClaudeWorker(f.args, { environment: f.environment });
    assert.equal((await f.port.getCompletion(operationKey)).status, "completed");
    const outcomes = (await fs.readFile(f.log, "utf8")).trim().split("\n").map((line) => JSON.parse(line).outcome);
    // A release that fails after a pre-model failure is retried by the main loop, so the item is run again.
    assert.deepEqual(outcomes, { no_init_then_success: ["rejected:ISOLATION", "answered"], ssh_prestart_retry: ["error", "answered"],
      no_init_release_failure: ["attempt_release_failed", "rejected:ISOLATION", "answered"] }[scenario]);
  });
}

test("packet-free and failed Claude admissions never promote staged answers", async (t) => {
  const outcomes = { packet_free: "rejected:PACKET_NOT_FETCHED", submit_before_fetch: "rejected:PACKET_NOT_FETCHED",
    packet_truncated: "rejected:PACKET_TRUNCATED", nothing_staged: "rejected:STAGE_MISSING", is_error: "rejected:RESULT_UNSUCCESSFUL",
    second_model: "rejected:MODEL_USAGE_INVALID", zero_output: "rejected:MODEL_USAGE_INVALID",
    missing_session: "rejected:SESSION_INVALID", timeout: "timeout",
    init_missing: "rejected:ISOLATION", server_extra: "isolation_refused",
    server_disconnected: "isolation_refused", tools_extra: "isolation_refused",
    skills_present: "isolation_refused", slashes_present: "isolation_refused", hook_event: "isolation_refused",
    foreign_session: "isolation_refused", init_without_session: "isolation_refused",
    project_file: "rejected:LOCAL_PERSISTENCE", fallback_cache: "rejected:LOCAL_PERSISTENCE" };
  for (const [scenario, expected] of Object.entries(outcomes)) {
    await t.test(scenario, async (child) => {
      const f = await fixture(child, scenario);
      const operationKey = `job:synthetic-${scenario}`;
      await assert.rejects(f.port.invoke({ ...call(operationKey), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
      const exitCode = await runJournalClaudeWorker(f.args, { environment: f.environment });
      // A run refused at init before the model keeps the item open behind a clearable hold and stops the worker.
      const beforeModel = expected === "isolation_refused";
      assert.equal((await f.port.getCompletion(operationKey)).status,
        ["timeout", "init_missing"].includes(scenario) || beforeModel ? "unknown" : "exhausted");
      if (beforeModel) assert.equal(exitCode, CLAUDE_SETUP_REFUSED_EXIT_CODE);
      const log = await fs.readFile(f.log, "utf8");
      assert.equal(JSON.parse(log.trim().split("\n").at(-1)).outcome, expected);
      assert.ok(!log.includes(SENTINEL) && !log.includes(f.secret));
      assert.deepEqual(await fs.readdir(path.join(f.root, "stage")), []);
      await assert.rejects(fs.access(path.join(f.laptop, "packet-called-after-refusal")));
      for (const bytes of await scanFiles(f.laptop)) assert.ok(!bytes.includes(Buffer.from(SENTINEL)));
      if (expected === "isolation_refused") {
        assert.equal(JSON.parse(log.trim().split("\n").at(-1)).model_reached, false);
        const before = await fs.readFile(f.trace, "utf8");
        assert.equal(await runJournalClaudeWorker(f.args, { environment: f.environment }), CLAUDE_SETUP_REFUSED_EXIT_CODE);
        assert.equal(await fs.readFile(f.trace, "utf8"), before);
      }
    });
  }
});

test("Claude usage limit waits for the reset without spending an item attempt", async (t) => {
  const f = await fixture(t, "limit_then_success");
  const operationKey = "job:synthetic-claude-limit";
  await assert.rejects(f.port.invoke({ ...call(operationKey), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
  await runJournalClaudeWorker([...f.args.filter(value => value !== "--once"), "--limit-backoff-ms", "1000"], { environment: f.environment });
  assert.equal((await f.port.getCompletion(operationKey)).status, "completed");
  const logs = (await fs.readFile(f.log, "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(logs.map(({ outcome }) => outcome), ["limited", "answered"]);
  assert.ok(logs.every((record) => record.cost_kind === "subscription_cost_equivalent_not_charged"));
});

test("attempt marker survives a worker restart and prevents a second model run", async (t) => {
  const f = await fixture(t, "nothing_staged");
  const operationKey = "job:synthetic-restart-marker";
  await assert.rejects(f.port.invoke({ ...call(operationKey), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
  await runJournalClaudeWorker(f.args, { environment: f.environment });
  const before = await fs.readFile(f.trace, "utf8");
  await runJournalClaudeWorker(f.args, { environment: f.environment });
  assert.equal(await fs.readFile(f.trace, "utf8"), before);
  assert.equal((await f.port.getCompletion(operationKey)).status, "exhausted");
});

test("each run uses a fresh session that the host reserved before Claude started", async (t) => {
  const f = await fixture(t);
  const keys = ["job:synthetic-session-first", "job:synthetic-session-second"];
  for (const operationKey of keys) {
    await assert.rejects(f.port.invoke({ ...call(operationKey), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
  }
  // The synthetic Claude exits 41 unless its requested session is already reserved on the host.
  await runJournalClaudeWorker(f.args.map((value) => value === "1" ? "2" : value), { environment: f.environment });
  const logs = (await fs.readFile(f.log, "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(logs.map((item) => item.outcome), ["answered", "answered"]);
  const contexts = await Promise.all(keys.map(async (operationKey) =>
    (await f.port.getCompletion(operationKey)).receipt.request_context_id));
  assert.ok(contexts.every((context) => /^claude-session:[0-9a-f-]{36}$/u.test(context)));
  assert.notEqual(contexts[0], contexts[1]);
  assert.equal((await fs.readdir(path.join(f.root, "claude-sessions"))).length, 2);
});

test("an isolation hold the host didn't record is applied by the next start before any item runs", async (t) => {
  const f = await fixture(t, "refuse_failure");
  for (const operationKey of ["job:synthetic-refuse-first", "job:synthetic-refuse-second"]) {
    await assert.rejects(f.port.invoke({ ...call(operationKey), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
  }
  const pending = path.join(f.workDir, "pending-refusals");
  // Refused at init, but the host's attempt-refuse fails: the hold is kept on disk and the worker stops.
  assert.equal(await runJournalClaudeWorker(f.args, { environment: f.environment }), CLAUDE_SETUP_REFUSED_EXIT_CODE);
  assert.equal((await fs.readdir(pending)).length, 1);
  // The next start records the hold on the host and stops again without starting Claude for any item.
  assert.equal(await runJournalClaudeWorker(f.args, { environment: f.environment }), CLAUDE_SETUP_REFUSED_EXIT_CODE);
  assert.deepEqual(await fs.readdir(pending), []);
  assert.equal(await fs.readFile(path.join(f.laptop, "claude-starts"), "utf8"), "x");
  const logs = (await fs.readFile(f.log, "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(logs.map((item) => item.outcome), ["attempt_refuse_failed", "isolation_refused", "isolation_refusal_pending"]);
  const held = logs[1].work_id;
  let status = "";
  await runJournalWork(["attempt-status", "--work-id", held], { environment: { INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT: f.root },
    stdout: { write: (value) => { status += value; } } });
  assert.equal(JSON.parse(status).status, "isolation_refused");
});

test("a hold that neither the host nor the disk took is retried before the worker stops", async (t) => {
  const f = await fixture(t, "refuse_unsaved");
  for (const operationKey of ["job:synthetic-refuse-unsaved-first", "job:synthetic-refuse-unsaved-second"]) {
    await assert.rejects(f.port.invoke({ ...call(operationKey), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
  }
  const pending = path.join(f.workDir, "pending-refusals");
  // The refusal fails and the hold can't be saved; the worker retries both and saves it before stopping.
  assert.equal(await runJournalClaudeWorker(f.args, { environment: f.environment }), CLAUDE_SETUP_REFUSED_EXIT_CODE);
  assert.equal((await fs.readdir(pending)).length, 1);
  // The next start records it on the host and stops without starting Claude for any item.
  assert.equal(await runJournalClaudeWorker(f.args, { environment: f.environment }), CLAUDE_SETUP_REFUSED_EXIT_CODE);
  assert.deepEqual(await fs.readdir(pending), []);
  assert.equal(await fs.readFile(path.join(f.laptop, "claude-starts"), "utf8"), "x");
  const logs = (await fs.readFile(f.log, "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(logs.map((item) => item.outcome),
    ["attempt_refuse_failed", "isolation_refusal_unsaved", "isolation_refused", "isolation_refusal_pending"]);
});

test("a model reach the host didn't record is kept and recorded before any further item", async (t) => {
  const f = await fixture(t, "mark_failure");
  const operationKey = "job:synthetic-mark-failure";
  await assert.rejects(f.port.invoke({ ...call(operationKey), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
  const pending = path.join(f.workDir, "pending-spends");
  // The mark fails at model reach (the run is killed) and so does the close: the spend is kept on disk, its retry
  // fails too, and the --once worker exits paused instead of leaving an apparently unspent reservation.
  assert.equal(await runJournalClaudeWorker(f.args, { environment: f.environment }), CLAUDE_PAUSED_EXIT_CODE);
  assert.equal((await fs.readdir(pending)).length, 1);
  // The next start records the spent attempt on the host and closes the item; Claude never runs again.
  assert.equal(await runJournalClaudeWorker(f.args, { environment: f.environment }), 0);
  assert.deepEqual(await fs.readdir(pending), []);
  assert.equal(await fs.readFile(path.join(f.laptop, "claude-starts"), "utf8"), "x");
  assert.equal((await f.port.getCompletion(operationKey)).status, "exhausted");
  const logs = (await fs.readFile(f.log, "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(logs.map((item) => item.outcome), ["item_close_failed", "rejected:EVENT_HANDLER_FAILED"]);
  assert.equal(logs[1].model_reached, true);
});

test("a project folder Claude creates under a work dir with a character outside the BMP is still found", async (t) => {
  const f = await fixture(t, "project_file", { workName: "work-\u{1F600}" });
  const operationKey = "job:synthetic-emoji-work-dir";
  await assert.rejects(f.port.invoke({ ...call(operationKey), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
  await runJournalClaudeWorker(f.args, { environment: f.environment });
  const logs = (await fs.readFile(f.log, "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(logs.map((item) => item.outcome), ["rejected:LOCAL_PERSISTENCE"]);
  assert.notEqual((await f.port.getCompletion(operationKey)).status, "completed");
  for (const bytes of await scanFiles(f.laptop)) assert.ok(!bytes.includes(Buffer.from(SENTINEL)));
});

test("a run that names another item is stopped, and its scoped server reads nothing of that item", async (t) => {
  const f = await fixture(t, "other_item");
  for (const operationKey of ["job:synthetic-own-item", "job:synthetic-other-open-item"]) {
    await assert.rejects(f.port.invoke({ ...call(operationKey), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
  }
  const records = await f.exchange.listDispatch();
  await fs.writeFile(path.join(f.laptop, "work-ids.json"), JSON.stringify(records.map((record) => record.work_id)));
  await runJournalClaudeWorker(f.args, { environment: f.environment });
  const logs = (await fs.readFile(f.log, "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(logs.map((item) => item.outcome), ["rejected:WORK_ID_MISMATCH"]);
  assert.equal(logs[0].model_reached, true);
  assert.equal(await fs.readFile(path.join(f.laptop, "other-item-reply"), "utf8"), "JOURNAL_WORK_SCOPE_MISMATCH");
  // The other item was never fetched: no attempt marker exists for it, and it stays open.
  const other = records.find((record) => record.work_id !== logs[0].work_id);
  let status = "";
  await runJournalWork(["attempt-status", "--work-id", other.work_id], { environment: { INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT: f.root },
    stdout: { write: (value) => { status += value; } } });
  assert.equal(JSON.parse(status).status, "none");
});

test("an isolation violation after model reach closes the item and stops the worker", async (t) => {
  const f = await fixture(t, "late_hook");
  for (const operationKey of ["job:synthetic-late-hook-first", "job:synthetic-late-hook-second"]) {
    await assert.rejects(f.port.invoke({ ...call(operationKey), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
  }
  assert.equal(await runJournalClaudeWorker(f.args.map((value) => value === "1" ? "2" : value), { environment: f.environment }),
    CLAUDE_SETUP_REFUSED_EXIT_CODE);
  const logs = (await fs.readFile(f.log, "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(logs.map((item) => item.outcome), ["isolation_refused"]);
  assert.equal(logs[0].model_reached, true);
  assert.equal(await fs.readFile(path.join(f.laptop, "claude-starts"), "utf8"), "x", "no further item ran under the bad setup");
  const statuses = await Promise.all(["job:synthetic-late-hook-first", "job:synthetic-late-hook-second"]
    .map(async (operationKey) => (await f.port.getCompletion(operationKey)).status));
  assert.deepEqual(statuses.sort(), ["exhausted", "unknown"]);
  // A restart refuses at once while the setup refusal is kept, and runs again only once an operator removes it.
  const refusals = path.join(f.workDir, "setup-refusals");
  assert.equal((await fs.readdir(refusals)).length, 1);
  assert.equal(await runJournalClaudeWorker(f.args, { environment: f.environment }), CLAUDE_SETUP_REFUSED_EXIT_CODE);
  assert.equal(JSON.parse((await fs.readFile(f.log, "utf8")).trim().split("\n").at(-1)).outcome, "setup_refused");
  assert.equal(await fs.readFile(path.join(f.laptop, "claude-starts"), "utf8"), "x");
  for (const name of await fs.readdir(refusals)) await fs.rm(path.join(refusals, name));
  assert.equal(await runJournalClaudeWorker(f.args, { environment: f.environment }), CLAUDE_SETUP_REFUSED_EXIT_CODE);
  assert.equal(await fs.readFile(path.join(f.laptop, "claude-starts"), "utf8"), "xx", "cleared, the next item ran (and was refused again)");
});

test("a failed close of a spent item is retried before the worker takes another item", async (t) => {
  const f = await fixture(t, "unstaged_close_failure");
  const operationKey = "job:synthetic-close-retry";
  await assert.rejects(f.port.invoke({ ...call(operationKey), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
  assert.equal(await runJournalClaudeWorker(f.args, { environment: f.environment }), 0);
  const logs = (await fs.readFile(f.log, "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(logs.map((item) => item.outcome), ["item_close_failed", "rejected:STAGE_MISSING"]);
  assert.equal((await f.port.getCompletion(operationKey)).status, "exhausted", "the retried close wrote the tombstone");
  await assertWorkDirClean(f.workDir);
});

test("a graceful stop waits until an unsaved hold is saved", async (t) => {
  const f = await fixture(t, "refuse_unsaved_slow");
  await assert.rejects(f.port.invoke({ ...call("job:synthetic-stop-unsaved"), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
  const running = runJournalClaudeWorker(f.args, { environment: f.environment });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && !(await fs.readFile(f.log, "utf8").catch(() => "")).includes("isolation_refusal_unsaved")) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  process.emit("SIGINT");
  assert.equal(await running, 130);
  // The stop didn't drop the hold: the worker kept retrying until the disk took it.
  assert.equal((await fs.readdir(path.join(f.workDir, "pending-refusals"))).length, 1);
});

test("a close that fails after a mark whose reply was lost is still retried", async (t) => {
  const f = await fixture(t, "mark_reply_lost");
  const operationKey = "job:synthetic-mark-reply-lost";
  await assert.rejects(f.port.invoke({ ...call(operationKey), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
  assert.equal(await runJournalClaudeWorker(f.args, { environment: f.environment }), 0);
  const logs = (await fs.readFile(f.log, "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(logs.map((item) => item.outcome), ["item_close_failed", "rejected:EVENT_HANDLER_FAILED"]);
  assert.equal((await f.port.getCompletion(operationKey)).status, "exhausted", "the kept close was retried");
  await assertWorkDirClean(f.workDir);
});

test("a failed close of a stale attempted item is retried after the next poll", async (t) => {
  const f = await fixture(t, "stale_close_failure");
  const operationKey = "job:synthetic-stale-close";
  await assert.rejects(f.port.invoke({ ...call(operationKey), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
  const [record] = await f.exchange.listDispatch();
  // A dead worker's attempt: model reached, never closed, and past the sibling-run window.
  const marker = path.join(f.root, "claude-attempts", journalAttemptMarkerKey(journalAttemptIdentity(record)) + ".json");
  await fs.mkdir(path.dirname(marker), { recursive: true, mode: 0o700 });
  await writeAttemptMarker(marker, { work_id: record.work_id, attempt_identity: journalAttemptIdentity(record), status: "attempted",
    claim: "55555555-5555-4555-8555-555555555555", timeout_ms: 2500, model_reached: true });
  const old = new Date(Date.now() - 11 * 60_000);
  await fs.utimes(marker, old, old);
  assert.equal(await runJournalClaudeWorker(f.args, { environment: f.environment }), 0);
  const logs = (await fs.readFile(f.log, "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(logs.map((item) => item.outcome), ["item_close_failed", "already_attempted", "already_attempted"]);
  assert.equal((await f.port.getCompletion(operationKey)).status, "exhausted");
  await assert.rejects(fs.access(path.join(f.laptop, "claude-starts")), "Claude never ran");
});

test("a run whose preflight outlasts its limit releases the reservation without starting Claude", async (t) => {
  const f = await fixture(t, "slow_preflight");
  const operationKey = "job:synthetic-slow-preflight";
  await assert.rejects(f.port.invoke({ ...call(operationKey), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
  // The fixture's 2.5 s run timeout bounds the preflight; two 1.5 s host calls exceed it every attempt.
  await runJournalClaudeWorker(f.args, { environment: f.environment });
  const logs = (await fs.readFile(f.log, "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(logs.map((item) => item.outcome), ["preflight_expired", "preflight_expired", "preflight_expired"]);
  assert.ok(logs.every((item) => item.model_reached === false));
  await assert.rejects(fs.access(path.join(f.laptop, "claude-starts")), "Claude never started");
  assert.equal((await f.port.getCompletion(operationKey)).status, "unknown");
  await assertWorkDirClean(f.workDir);
});

test("a failed session reservation stops the item before Claude starts", async (t) => {
  const f = await fixture(t, "session_reserve_failure");
  const operationKey = "job:synthetic-session-reserve-failure";
  await assert.rejects(f.port.invoke({ ...call(operationKey), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
  // The first attempt fails at the reservation, before Claude starts, and releases its unspent claim; the retry
  // reserves a fresh session and answers.
  await runJournalClaudeWorker(f.args, { environment: f.environment });
  const logs = (await fs.readFile(f.log, "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(logs.map((item) => item.outcome), ["error", "answered"]);
  assert.equal(logs[0].model_reached, false);
  assert.equal(await fs.readFile(path.join(f.laptop, "claude-starts"), "utf8"), "x", "Claude started once, for the retry");
  assert.equal((await f.port.getCompletion(operationKey)).status, "completed");
});

test("a release that still failed when a paused worker exited is finished by the next worker", async (t) => {
  const f = await fixture(t, "release_failure_restart");
  const operationKey = "job:synthetic-release-restart";
  await assert.rejects(f.port.invoke({ ...call(operationKey), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
  const pending = path.join(f.workDir, "pending-releases");
  // Limited, and both the release and its retry fail before --once exits paused: the claim is kept on disk.
  assert.equal(await runJournalClaudeWorker(f.args, { environment: f.environment }), 75);
  assert.equal((await fs.readdir(pending)).length, 1);
  // The next worker releases it with the saved claim, so the item is taken at once rather than left as a
  // live sibling's reservation, and answered.
  assert.equal(await runJournalClaudeWorker(f.args, { environment: f.environment }), 0);
  assert.deepEqual(await fs.readdir(pending), []);
  assert.equal((await f.port.getCompletion(operationKey)).status, "completed");
  const logs = (await fs.readFile(f.log, "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(logs.map((item) => item.outcome), ["attempt_release_failed", "limited", "answered"]);
});

test("promotion is refused when another item owns the run's session", async (t) => {
  const f = await fixture(t, "session_stolen");
  const operationKey = "job:synthetic-session-stolen";
  await assert.rejects(f.port.invoke({ ...call(operationKey), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
  await runJournalClaudeWorker(f.args, { environment: f.environment });
  const logs = (await fs.readFile(f.log, "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(logs.map((item) => item.outcome), ["rejected:SESSION_REUSED"]);
  assert.notEqual((await f.port.getCompletion(operationKey)).status, "completed");
  const sessions = await fs.readdir(path.join(f.root, "claude-sessions"));
  assert.equal(sessions.length, 1);
  assert.match(sessions[0], /^[0-9a-f]{64}\.json$/u);
});

test("a worker that can't save a failed release's claim retries before exiting", async (t) => {
  const f = await fixture(t, "release_unsaved");
  const operationKey = "job:synthetic-release-unsaved";
  await assert.rejects(f.port.invoke({ ...call(operationKey), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
  // Limited; the release fails and its claim can't be saved. The paused --once worker retries until the claim is
  // saved and released instead of exiting with it only in memory.
  assert.equal(await runJournalClaudeWorker(f.args, { environment: f.environment }), 75);
  await assertWorkDirClean(f.workDir);
  // Nothing was stranded, so the next worker takes the item at once and answers it.
  assert.equal(await runJournalClaudeWorker(f.args, { environment: f.environment }), 0);
  assert.equal((await f.port.getCompletion(operationKey)).status, "completed");
  const logs = (await fs.readFile(f.log, "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(logs.map((item) => item.outcome), ["pending_release_unsaved", "attempt_release_failed", "limited", "answered"]);
});

test("stale worker directories are swept and opening the log cleans the new parent", async (t) => {
  const f = await fixture(t);
  const stale = path.join(f.workDir, "inner-signal-claude-AAAAAA");
  await fs.mkdir(path.join(stale, "run-leftover"), { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(stale, "worker.lock"), "", { mode: 0o600 });
  const old = new Date(Date.now() - 2 * 3_600_000);
  await fs.utimes(stale, old, old);
  const badLog = path.join(f.laptop, "missing", "log.jsonl");
  await assert.rejects(runJournalClaudeWorker(f.args.map((value) => value === f.log ? badLog : value),
    { environment: f.environment }));
  await assertWorkDirClean(f.workDir, ["inner-signal-claude-AAAAAA"]);
  await runJournalClaudeWorker(f.args, { environment: f.environment });
  await assert.rejects(fs.access(stale));
  await assertWorkDirClean(f.workDir);
});

test("stage removal failure is logged without packet content", async (t) => {
  const f = await fixture(t, "stage_remove_failure");
  const operationKey = "job:synthetic-stage-remove-failure";
  await assert.rejects(f.port.invoke({ ...call(operationKey), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
  await runJournalClaudeWorker(f.args, { environment: f.environment });
  const logs = (await fs.readFile(f.log, "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(logs.map((item) => item.outcome), ["stage_remove_failed", "answered"]);
  assert.ok(!JSON.stringify(logs).includes(SENTINEL));
});

test("an already answered promotion has its own content-free worker outcome", async (t) => {
  const f = await fixture(t, "already_answered");
  const operationKey = "job:synthetic-already-log";
  await assert.rejects(f.port.invoke({ ...call(operationKey), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
  await runJournalClaudeWorker(f.args, { environment: f.environment });
  const logs = (await fs.readFile(f.log, "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(logs.at(-1).outcome, "already_answered");
  assert.ok(!JSON.stringify(logs).includes(SENTINEL));
});

test("a live sibling reservation is skipped until it is released, then answered by the same worker", async (t) => {
  const f = await fixture(t);
  const key = "job:synthetic-live-sibling";
  await assert.rejects(f.port.invoke({ ...call(key), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
  const [record] = await f.exchange.listDispatch();
  const claim = "33333333-3333-4333-8333-333333333333";
  const environment = { INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT: f.root };
  const identity = ["--attempt-identity", record.attempt_identity];
  await runJournalWork(["attempt-reserve", "--work-id", record.work_id, ...identity, "--claim", claim], { environment, stdout: { write() {} } });
  const args = f.args.filter(value => value !== "--once");
  args.splice(args.indexOf("--poll-ms") + 1, 1, "100");
  const pending = runJournalClaudeWorker(args, { environment: f.environment });
  // The sibling releases its reservation after a pre-model outage; this worker must take the item.
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && !(await fs.readFile(f.log, "utf8").catch(() => "")).includes('"outcome":"reserved"')) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  await new Promise(resolve => setTimeout(resolve, 250));
  await runJournalWork(["attempt-release", "--work-id", record.work_id, ...identity, "--claim", claim], { environment, stdout: { write() {} } });
  assert.equal(await pending, 0);
  const logs = (await fs.readFile(f.log, "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(logs[0].outcome, "reserved");
  assert.equal(logs.at(-1).outcome, "answered");
  assert.equal((await f.port.getCompletion(key)).status, "completed");
});

test("a stale unspent reservation left by a dead worker is reclaimed and the item answered", async (t) => {
  const f = await fixture(t);
  const key = "job:synthetic-stale-unspent";
  await assert.rejects(f.port.invoke({ ...call(key), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
  const [record] = await f.exchange.listDispatch();
  const environment = { INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT: f.root };
  await runJournalWork(["attempt-reserve", "--work-id", record.work_id, "--attempt-identity", record.attempt_identity,
    "--claim", "44444444-4444-4444-8444-444444444444", "--timeout-ms", "60000"], { environment, stdout: { write() {} } });
  // Older than twice the 60 s run timeout plus ten minutes, with no packet served and no model reached.
  const marker = path.join(f.root, "claude-attempts", journalAttemptMarkerKey(journalAttemptIdentity(record)) + ".json");
  const old = new Date(Date.now() - 13 * 60_000);
  await fs.utimes(marker, old, old);
  assert.equal(await runJournalClaudeWorker(f.args, { environment: f.environment }), 0);
  const logs = (await fs.readFile(f.log, "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(logs.map(item => item.outcome), ["stale_reservation_reclaimed", "answered"]);
  assert.equal((await f.port.getCompletion(key)).status, "completed");
});

test("a recent unspent reservation is left to its owner", async (t) => {
  const f = await fixture(t);
  const key = "job:synthetic-recent-unspent";
  await assert.rejects(f.port.invoke({ ...call(key), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
  const [record] = await f.exchange.listDispatch();
  await runJournalWork(["attempt-reserve", "--work-id", record.work_id, "--attempt-identity", record.attempt_identity,
    "--claim", "55555555-5555-4555-8555-555555555555", "--timeout-ms", "60000"],
  { environment: { INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT: f.root }, stdout: { write() {} } });
  await runJournalClaudeWorker(f.args, { environment: f.environment });
  const logs = (await fs.readFile(f.log, "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(logs.map(item => item.outcome), ["reserved"]);
  assert.notEqual((await f.port.getCompletion(key)).status, "completed");
});

test("a persistence cleanup that fails refuses the result and stops the worker", async (t) => {
  const f = await fixture(t, "cleanup_unreadable");
  const keys = ["job:synthetic-cleanup-first", "job:synthetic-cleanup-second"];
  for (const operationKey of keys) {
    await assert.rejects(f.port.invoke({ ...call(operationKey), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
  }
  assert.equal(await runJournalClaudeWorker(f.args.map((value) => value === "1" ? "2" : value), { environment: f.environment }),
    CLAUDE_CLEANUP_FAILED_EXIT_CODE);
  const logs = (await fs.readFile(f.log, "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(logs.map((item) => item.outcome), ["rejected:LOCAL_PERSISTENCE"], "the second item is not started");
  for (const key of keys) assert.notEqual((await f.port.getCompletion(key)).status, "completed");
});

test("SIGINT wakes the poll sleep and returns exit code 130", async (t) => {
  const f = await fixture(t);
  const args = f.args.filter((value) => value !== "--once");
  args.splice(args.indexOf("--poll-ms") + 1, 1, "60000");
  const started = Date.now();
  const pending = runJournalClaudeWorker(args, { environment: f.environment });
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const trace = await fs.readFile(f.sshTrace, "utf8").catch(() => "");
    if (trace.includes("dispatch")) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
  process.emit("SIGINT");
  assert.equal(await pending, 130);
  assert.ok(Date.now() - started < 5_000);
});

test("host stage commands reject arbitrary paths and refuse packet-free promotion", async (t) => {
  const f = await fixture(t);
  const env = { INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT: f.root,
    INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_FILE: f.secretFile };
  let output = "";
  await runJournalWork(["stage-create"], { environment: env, stdout: { write: (value) => { output += value; } } });
  const stageDir = JSON.parse(output).stage_dir;
  let status = "";
  await runJournalWork(["stage-check", "--work-id", "job:synthetic", "--stage-dir", stageDir],
    { environment: env, stdout: { write: (value) => { status += value; } } });
  assert.deepEqual(JSON.parse(status), { staged: false, packet_fetched: false });
  await assert.rejects(runJournalWork(["stage-remove", "--stage-dir", f.laptop], { environment: env }),
    { code: "JOURNAL_WORK_STAGE_DIR_INVALID" });
  await runJournalWork(["stage-remove", "--stage-dir", stageDir], { environment: env, stdout: { write() {} } });
});

test("host sweeps only stages older than the dispatch TTL", async (t) => {
  const f = await fixture(t);
  const env = { INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT: f.root,
    INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_FILE: f.secretFile };
  const create = async () => {
    let value = "";
    await runJournalWork(["stage-create"], { environment: env, stdout: { write: (text) => { value += text; } } });
    return JSON.parse(value).stage_dir;
  };
  const stale = await create();
  const fresh = await create();
  const old = new Date(Date.now() - 25 * 3_600_000);
  await fs.utimes(stale, old, old);
  await runJournalWork(["stage-sweep"], { environment: env, stdout: { write() {} } });
  await assert.rejects(fs.access(stale));
  await fs.access(fresh);
});

test("stage sweep tolerates a concurrent stage-remove after its directory listing", async (t) => {
  const f = await fixture(t);
  const environment = { INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT: f.root };
  let output = "";
  await runJournalWork(["stage-create"], { environment, stdout: { write: value => { output += value; } } });
  const stageDir = JSON.parse(output).stage_dir;
  const lstat = fs.lstat.bind(fs);
  let removed = false;
  t.mock.method(fs, "lstat", async (target, ...args) => {
    if (target === stageDir && !removed) {
      removed = true;
      await fs.rm(stageDir, { recursive: true });
    }
    return lstat(target, ...args);
  });
  await runJournalWork(["stage-sweep"], { environment, stdout: { write() {} } });
  assert.equal(removed, true);
});

test("host promotion reports an already answered hardest item", async (t) => {
  const f = await fixture(t);
  const operationKey = "job:synthetic-already-answered";
  await assert.rejects(f.port.invoke({ ...call(operationKey), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
  const [dispatch] = await f.exchange.listDispatch();
  const env = { INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT: f.root,
    INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_FILE: f.secretFile };
  let created = "";
  await runJournalWork(["stage-create"], { environment: env, stdout: { write: (value) => { created += value; } } });
  const stageDir = JSON.parse(created).stage_dir;
  await f.exchange.markPacketFetched({ stageDir, workId: dispatch.work_id });
  await f.exchange.stageResult({ stageDir, workId: dispatch.work_id, output: ANSWER });
  await f.exchange.submitResult({ workId: dispatch.work_id, output: ANSWER, subject: "local:synthetic-first",
    execution: { profile_evidence: "claude_code_model_usage_reported", effective_model_profile: dispatch.model,
      effective_effort: dispatch.effort, request_context_id: "claude-session:first12345" } });
  let output = "";
  await runJournalWork(["promote", "--work-id", dispatch.work_id, "--stage-dir", stageDir,
    "--execution-json", JSON.stringify({ profile_evidence: "claude_code_model_usage_reported",
      effective_model_profile: dispatch.model, effective_effort: dispatch.effort,
      request_context_id: "claude-session:second12345" }), "--subject", "local:claude-hardest"],
  { environment: env, stdout: { write: (value) => { output += value; } } });
  assert.deepEqual(JSON.parse(output), { answered: false, already: true });
});

test("stdio tools/list adds the Claude limit without changing the tools' schemas or results", async (t) => {
  const f = await fixture(t);
  const stdin = new PassThrough();
  stdin.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) + "\n");
  let output = "";
  await runJournalWorkMcp(["--config", f.config, "--principal", "synthetic"], { stdin,
    stdout: { write: value => { output += value; } }, environment: {
      INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT: f.root, INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_FILE: f.secretFile } });
  const tools = JSON.parse(output).result.tools;
  for (const tool of tools) assert.equal(tool._meta["anthropic/maxResultSizeChars"], MAX_JOURNAL_TOOL_RESULT_CHARS);
  assert.deepEqual(tools.map(({ _meta, ...tool }) => tool), JOURNAL_WORK_TOOL_DEFINITIONS);
});

for (const scenario of ["assistant_limit", "http429", "rate_event_seconds", "rate_event_ms", "release_failure"]) {
  test(`${scenario} releases a limit reservation and retries without an attempted marker`, async (t) => {
    const f = await fixture(t, scenario);
    const operationKey = `job:synthetic-${scenario}`;
    await assert.rejects(f.port.invoke({ ...call(operationKey), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
    await runJournalClaudeWorker([...f.args.filter(value => value !== "--once"), "--limit-backoff-ms", "100"], { environment: f.environment });
    assert.equal((await f.port.getCompletion(operationKey)).status, "completed");
    const logs = (await fs.readFile(f.log, "utf8")).trim().split("\n").map(JSON.parse);
    assert.deepEqual(logs.filter(item => item.cost_kind).map(item => item.outcome), ["limited", "answered"]);
    if (scenario === "release_failure") {
      assert.equal(logs[0].outcome, "attempt_release_failed");
      // The next loop retries the release before launching the next Claude run.
      const commands = (await fs.readFile(f.sshTrace, "utf8")).trim().split("\n").map(JSON.parse)
        .map(entry => entry.args.at(-1));
      const releases = commands.map((command, index) => command.includes("'attempt-release'") ? index : -1)
        .filter(index => index >= 0);
      assert.equal(releases.length, 2);
      assert.ok(commands.slice(releases[0] + 1, releases[1]).every(command => !command.includes("'attempt-mark'")));
    }
    assert.ok(!JSON.stringify(logs).includes(SENTINEL));
  });
}

test("packet preflight refuses before the Claude executable starts", async (t) => {
  const f = await fixture(t, "oversize_packet");
  await assert.rejects(f.port.invoke({ ...call("job:synthetic-oversize"), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
  await runJournalClaudeWorker(f.args, { environment: f.environment });
  await assert.rejects(fs.access(f.trace));
  const logs = (await fs.readFile(f.log, "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(logs.length, 1, "packet refusal is terminal on its first preflight");
  assert.ok(logs.every(item => item.outcome === "rejected:PACKET_TOO_LARGE" && item.model_reached === false));
  assert.equal((await f.port.getCompletion("job:synthetic-oversize")).status, "exhausted");
  assert.deepEqual(await f.exchange.listDispatch(), []);
});

test("an item that expires before Claude starts is released, not recorded as oversize", async (t) => {
  const f = await fixture(t, "expired_packet");
  const key = "job:synthetic-expired-before-start";
  await assert.rejects(f.port.invoke({ ...call(key), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
  await runJournalClaudeWorker(f.args, { environment: f.environment });
  await assert.rejects(fs.access(f.trace));
  const logs = (await fs.readFile(f.log, "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(logs.map(item => item.outcome), ["rejected:PACKET_UNAVAILABLE"]);
  // Not closed: the runtime follows its normal expired-item path.
  assert.notEqual((await f.port.getCompletion(key)).status, "exhausted");
  const [record] = await f.exchange.listDispatch();
  let status = "";
  await runJournalWork(["attempt-status", "--work-id", record.work_id], { environment: { INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT: f.root },
    stdout: { write: value => { status += value; } } });
  assert.equal(JSON.parse(status).status, "none", "the reservation is released");
});

test("startup cleanup keeps parents named as unresolved", async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "journal-stale-keep-"));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const old = new Date(Date.now() - 2 * 3_600_000);
  for (const name of ["inner-signal-claude-KEEPME", "inner-signal-claude-DROPME"]) {
    const directory = path.join(base, name);
    await fs.mkdir(directory, { mode: 0o700 });
    await fs.writeFile(path.join(directory, "worker.lock"), "", { mode: 0o600 });
    await fs.utimes(directory, old, old);
  }
  await removeStaleRuns(base, "inner-signal-claude-", { keep: new Set(["inner-signal-claude-KEEPME"]) });
  await fs.access(path.join(base, "inner-signal-claude-KEEPME"));
  await assert.rejects(fs.access(path.join(base, "inner-signal-claude-DROPME")));
});

for (const code of ["ECONNREFUSED", "ENOTFOUND"]) {
  test(`structured ${code} pauses without burning an attempt`, async t => {
    const f = await fixture(t, code);
    const key = `job:synthetic-${code}`;
    await assert.rejects(f.port.invoke({ ...call(key), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
    assert.equal(await runJournalClaudeWorker(f.args, { environment: f.environment }), CLAUDE_PAUSED_EXIT_CODE);
    assert.deepEqual(await fs.readdir(path.join(f.root, "claude-attempts")), []);
    assert.equal((await f.port.getCompletion(key)).status, "unknown");
    assert.equal(JSON.parse((await fs.readFile(f.log, "utf8")).trim()).outcome, "provider_unavailable");
  });
}

test("provider status comes only from status fields and connection codes", () => {
  const record = { work_id: "job:synthetic-status", model: "claude-opus-5-5" };
  const reader = claudeResultReader(record);
  for (const event of [
    { type: "assistant", error: "api_error", message: { model: "<synthetic>", content: [{ type: "text", text: "500 SYNTHETIC_SENTINEL" }] } },
    { type: "result", is_error: true, error: { message: "401 529 ECONNREFUSED SYNTHETIC_SENTINEL" } }
  ]) reader.accept(JSON.stringify(event));
  assert.equal(reader.state.providerStatus, null);
  assert.equal(reader.state.providerConnectionFailed, false);
  const structured = claudeResultReader(record);
  structured.accept(JSON.stringify({ type: "result", is_error: true, error: { status: 503 } }));
  assert.equal(structured.state.providerStatus, 503);
  // Claude Code 2.1.287 reports a refused connection only as a synthetic assistant error label.
  for (const [label, connection, status] of [["server_error", true, null], ["unknown", true, null], ["authentication_failed", false, 401]]) {
    const synthetic = claudeResultReader(record);
    synthetic.accept(JSON.stringify({ type: "assistant", error: label, message: { model: "<synthetic>", content: [] } }));
    assert.equal(synthetic.state.providerConnectionFailed, connection, label);
    assert.equal(synthetic.state.providerStatus, status, label);
    assert.equal(synthetic.state.reachedModel, false, label);
  }
  // The same label on a real (non-synthetic) model event is not a provider outage.
  const real = claudeResultReader(record);
  real.accept(JSON.stringify({ type: "assistant", error: "server_error", message: { model: record.model, content: [] } }));
  assert.equal(real.state.providerConnectionFailed, false);
});

test("a crash after hardest packet fetch leaves a reservation that cannot be cleared", async t => {
  const f = await fixture(t);
  const key = "job:synthetic-crash-after-fetch";
  await assert.rejects(f.port.invoke({ ...call(key), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
  const [record] = await f.exchange.listDispatch();
  const claim = "11111111-1111-4111-8111-111111111111";
  const environment = { INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT: f.root };
  const command = name => runJournalWork([name, "--work-id", record.work_id,
    ...(name === "attempt-clear" ? [] : ["--claim", claim])], { environment, stdout: { write() {} } });
  await command("attempt-reserve");
  const tools = createJournalWorkTools({ exchange: f.exchange, caseId: "synthetic-case", tier: "hardest",
    authorizeCase: async () => ({ principalId: "synthetic" }) });
  const fetched = await tools.call("get_journal_work_packet", { work_id: record.work_id }, {});
  assert.equal(fetched.value.status, "ready");
  const marker = path.join(f.root, "claude-attempts", journalAttemptMarkerKey(record.attempt_identity) + ".json");
  let held = JSON.parse(await fs.readFile(marker, "utf8"));
  assert.equal(held.status, "reserved");
  assert.equal(held.packet_fetched, true);
  assert.equal(held.model_reached, undefined, "worker crashed before stream reach");
  const old = new Date(Date.now() - 71 * 60_000);
  await fs.utimes(marker, old, old);
  await assert.rejects(command("attempt-clear"), { code: "JOURNAL_WORK_ATTEMPT_CLEAR_REFUSED" });
  await command("attempt-refuse");
  await assert.rejects(command("attempt-clear"), { code: "JOURNAL_WORK_ATTEMPT_CLEAR_REFUSED" });
  await command("attempt-mark");
  held = JSON.parse(await fs.readFile(marker, "utf8"));
  assert.equal(held.status, "isolation_refused");
  assert.equal(held.packet_fetched, true);
  assert.equal(held.model_reached, true);
  await assert.rejects(command("attempt-clear"), { code: "JOURNAL_WORK_ATTEMPT_CLEAR_REFUSED" });
});

test("model reach still cannot be cleared after attempted becomes isolation_refused", async t => {
  const f = await fixture(t);
  await assert.rejects(f.port.invoke({ ...call("job:synthetic-model-reach-clear"), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
  const [record] = await f.exchange.listDispatch();
  const environment = { INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT: f.root };
  const claim = "11111111-1111-4111-8111-111111111111";
  for (const command of ["attempt-reserve", "attempt-mark", "attempt-refuse"]) {
    await runJournalWork([command, "--work-id", record.work_id, "--claim", claim], { environment, stdout: { write() {} } });
  }
  const held = JSON.parse(await fs.readFile(path.join(f.root, "claude-attempts",
    journalAttemptMarkerKey(record.attempt_identity) + ".json"), "utf8"));
  assert.equal(held.model_reached, true);
  assert.equal(held.packet_fetched, undefined);
  assert.equal(held.status, "isolation_refused");
  await assert.rejects(runJournalWork(["attempt-clear", "--work-id", record.work_id],
    { environment, stdout: { write() {} } }), { code: "JOURNAL_WORK_ATTEMPT_CLEAR_REFUSED" });
});

test("attempt commands use the worker's identity once the runtime removed the dispatch record", async (t) => {
  const f = await fixture(t);
  const environment = { INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT: f.root };
  await assert.rejects(f.port.invoke({ ...call("job:synthetic-gone"), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
  const [record] = await f.exchange.listDispatch();
  const claim = "22222222-2222-4222-8222-222222222222";
  const command = async (name, args = []) => {
    let output = "";
    await runJournalWork([name, "--work-id", record.work_id, ...args], { environment,
      stdout: { write: value => { output += value; } } });
    return JSON.parse(output);
  };
  const identity = ["--attempt-identity", record.attempt_identity];
  assert.equal((await command("attempt-reserve", [...identity, "--claim", claim])).claimed, true);
  await command("attempt-mark", [...identity, "--claim", claim]);
  await f.exchange.removeDispatch(record.work_id);
  assert.equal((await f.exchange.listDispatch()).length, 0);
  await assert.rejects(command("attempt-status"), { code: "JOURNAL_WORK_ATTEMPT_IDENTITY_REQUIRED" });
  assert.equal((await command("attempt-status", identity)).status, "attempted");
  // A new reservation still needs the live dispatch record.
  await assert.rejects(command("attempt-reserve", [...identity, "--claim", claim]),
    { code: "JOURNAL_WORK_ATTEMPT_IDENTITY_REQUIRED" });
});

test("attempt status, exclusive reservations, corrupt markers, stale temps and operator clearing", async (t) => {
  const f = await fixture(t);
  const environment = { INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT: f.root };
  await assert.rejects(f.port.invoke({ ...call("job:synthetic-marker"), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
  const [record] = await f.exchange.listDispatch();
  const workId = record.work_id;
  const claim = "11111111-1111-4111-8111-111111111111";
  const command = async (name, args = []) => {
    let output = "";
    await runJournalWork([name, "--work-id", workId, ...args], { environment,
      stdout: { write: value => { output += value; } } });
    return JSON.parse(output);
  };
  assert.equal((await command("attempt-status")).status, "none");
  const results = await Promise.all([command("attempt-reserve", ["--claim", claim, "--timeout-ms", "60000"]),
    command("attempt-reserve", ["--claim", claim, "--timeout-ms", "60000"])]);
  assert.deepEqual(results.map(item => item.claimed).sort(), [false, true]);
  assert.equal((await command("attempt-status")).status, "reserved");
  const directory = path.join(f.root, "claude-attempts");
  const marker = path.join(directory, journalAttemptMarkerKey(journalAttemptIdentity(record)) + ".json");
  const { attempt_identity: _identity, ...legacy } = JSON.parse(await fs.readFile(marker, "utf8"));
  await fs.writeFile(marker, JSON.stringify(legacy));
  assert.equal((await command("attempt-status")).status, "reserved");
  // While the dispatch record exists, a supplied identity must match it.
  await assert.rejects(command("attempt-status", ["--attempt-identity", "b".repeat(48)]), { code: "JOURNAL_WORK_ATTEMPT_INVALID" });
  assert.equal((await command("attempt-status", ["--attempt-identity", record.attempt_identity])).status, "reserved");
  // A reference-audit resend changes the work ID, while dispatch identity stays fixed.
  await assert.rejects(f.port.invoke({ ...call("job:synthetic-marker:resend:1"), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
  const resendRecord = (await f.exchange.listDispatch()).find(item => item.work_id !== workId);
  let resend = "";
  await runJournalWork(["attempt-status", "--work-id", resendRecord.work_id], { environment,
    stdout: { write: value => { resend += value; } } });
  assert.equal(JSON.parse(resend).status, "reserved");
  await assert.rejects(command("attempt-clear"), { code: "JOURNAL_WORK_ATTEMPT_CLEAR_REFUSED" });
  const nearlyClearable = new Date(Date.now() - 2 * 60000 - 600000 + 5000);
  await fs.utimes(marker, nearlyClearable, nearlyClearable);
  await assert.rejects(command("attempt-clear"), { code: "JOURNAL_WORK_ATTEMPT_CLEAR_REFUSED" });
  const old = new Date(Date.now() - 3_601_000);
  await fs.utimes(marker, old, old);
  assert.ok((await command("attempt-status")).age_seconds > 3600);
  assert.equal((await command("attempt-clear")).cleared, true);
  await command("attempt-reserve", ["--claim", claim]);
  await command("attempt-refuse", ["--claim", claim]);
  assert.equal((await command("attempt-status")).status, "isolation_refused");
  await command("attempt-clear");
  await command("attempt-reserve", ["--claim", claim]);
  await command("attempt-mark", ["--claim", claim]);
  await assert.rejects(command("attempt-clear"), { code: "JOURNAL_WORK_ATTEMPT_CLEAR_REFUSED" });
  await command("attempt-refuse", ["--claim", claim]);
  assert.equal((await command("attempt-status")).status, "isolation_refused");
  await fs.writeFile(marker, JSON.stringify({ work_id: workId, claim, status: "reserved", timeout_ms: -1 }));
  assert.equal((await command("attempt-status")).status, "attempted");
  await assert.rejects(command("attempt-clear"), { code: "JOURNAL_WORK_ATTEMPT_CLEAR_REFUSED" });
  await fs.writeFile(marker, "{");
  assert.equal((await command("attempt-status")).status, "attempted");
  await assert.rejects(command("attempt-clear"), { code: "JOURNAL_WORK_ATTEMPT_CLEAR_REFUSED" });
  const staleTemp = marker + "." + claim + ".tmp";
  await fs.writeFile(staleTemp, "synthetic");
  await fs.utimes(staleTemp, old, old);
  await command("attempt-status");
  await assert.rejects(fs.access(staleTemp));
  assert.deepEqual(await fs.readdir(directory), [path.basename(marker)]);
});

test("already attempted, corrupt and isolation-refused items do not consume max-items", async (t) => {
  const f = await fixture(t);
  const keys = ["job:synthetic-already", "job:synthetic-corrupt", "job:synthetic-isolation", "job:synthetic-next"];
  const claim = "11111111-1111-4111-8111-111111111111";
  for (const operationKey of keys) {
    await assert.rejects(f.port.invoke({ ...call(operationKey), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
  }
  const records = await f.exchange.listDispatch();
  const environment = { INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT: f.root };
  for (const record of records.slice(0, 3)) {
    await runJournalWork(["attempt-reserve", "--work-id", record.work_id, "--claim", claim],
      { environment, stdout: { write() {} } });
  }
  await runJournalWork(["attempt-mark", "--work-id", records[0].work_id, "--claim", claim],
    { environment, stdout: { write() {} } });
  await fs.writeFile(path.join(f.root, "claude-attempts",
    journalAttemptMarkerKey(journalAttemptIdentity(records[1])) + ".json"), "{");
  await runJournalWork(["attempt-refuse", "--work-id", records[2].work_id, "--claim", claim],
    { environment, stdout: { write() {} } });
  // The attempted and corrupt markers belong to runs long past their timeout (dead workers).
  const stale = new Date(Date.now() - 2 * 3_600_000);
  for (const record of records.slice(0, 2)) {
    await fs.utimes(path.join(f.root, "claude-attempts", journalAttemptMarkerKey(journalAttemptIdentity(record)) + ".json"), stale, stale);
  }
  // The unspent isolation hold stops the worker (exit 78) before it tries the next item.
  assert.equal(await runJournalClaudeWorker(f.args, { environment: f.environment }), CLAUDE_SETUP_REFUSED_EXIT_CODE);
  let logs = (await fs.readFile(f.log, "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(logs.map(item => item.outcome), ["already_attempted", "already_attempted", "isolation_refused"]);
  // Once the operator clears the hold, the next worker answers that item (the skipped ones were closed
  // on the first pass and didn't use up the single allowed item).
  await runJournalWork(["attempt-clear", "--work-id", records[2].work_id], { environment, stdout: { write() {} } });
  assert.equal(await runJournalClaudeWorker(f.args, { environment: f.environment }), 0);
  logs = (await fs.readFile(f.log, "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(logs.slice(3).map(item => [item.work_id, item.outcome]), [[records[2].work_id, "answered"]]);
});

test("a fresh isolation refusal before the model stops the worker and leaves the item open", async (t) => {
  const f = await fixture(t, "isolation_then_success");
  for (const operationKey of ["job:synthetic-isolation-first", "job:synthetic-isolation-second"]) {
    await assert.rejects(f.port.invoke({ ...call(operationKey), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
  }
  assert.equal(await runJournalClaudeWorker(f.args, { environment: f.environment }), CLAUDE_SETUP_REFUSED_EXIT_CODE);
  const logs = (await fs.readFile(f.log, "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(logs.map(item => item.outcome), ["isolation_refused"]);
  assert.equal(logs[0].model_reached, false);
  // Neither item is closed: the refused one waits behind a clearable hold, the other was never started.
  for (const operationKey of ["job:synthetic-isolation-first", "job:synthetic-isolation-second"]) {
    assert.equal((await f.port.getCompletion(operationKey)).status, "unknown");
  }
  const [refused] = (await f.exchange.listDispatch()).filter(record => record.work_id === logs[0].work_id);
  let cleared = "";
  await runJournalWork(["attempt-clear", "--work-id", refused.work_id], { environment: { INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT: f.root },
    stdout: { write: value => { cleared += value; } } });
  assert.equal(JSON.parse(cleared).cleared, true);
});

test("leftover project and fallback cache files for this worker prefix are swept", async (t) => {
  const f = await fixture(t);
  const slug = path.join(f.workDir, "inner-signal-claude-AAAAAA", "run-BBBBBB").replace(/[^A-Za-z0-9]/g, "-");
  for (const root of [path.join(f.laptop, ".claude", "projects"), path.join(f.laptop, ".cache", "claude-cli-nodejs")]) {
    await fs.mkdir(path.join(root, slug), { recursive: true });
    await fs.writeFile(path.join(root, slug, "synthetic.txt"), SENTINEL);
    await fs.mkdir(path.join(root, "unrelated"), { recursive: true });
    await fs.writeFile(path.join(root, "unrelated", "keep.txt"), "keep");
  }
  await runJournalClaudeWorker(f.args, { environment: f.environment });
  for (const root of [path.join(f.laptop, ".claude", "projects"), path.join(f.laptop, ".cache", "claude-cli-nodejs")]) {
    await assert.rejects(fs.access(path.join(root, slug)));
    assert.equal(await fs.readFile(path.join(root, "unrelated", "keep.txt"), "utf8"), "keep");
  }
});

for (const status of [401, 403, 500, 503, 529]) {
  test(`HTTP ${status} releases its reservation and pauses/stops before burning sibling items`, async t => {
    const f = await fixture(t, `http${status}`);
    for (const index of [1, 2, 3]) {
      await assert.rejects(f.port.invoke({ ...call(`job:synthetic-http${status}-${index}`), tier: "hardest" }),
        { code: "COMPLETION_UNKNOWN" });
    }
    const started = Date.now();
    const result = await runJournalClaudeWorker(f.args.map(value => value === "1" ? "3" : value), { environment: f.environment });
    assert.equal(result, status < 500 ? 77 : CLAUDE_PAUSED_EXIT_CODE);
    assert.ok(Date.now() - started < 10_000, "--once waited out a provider pause");
    assert.equal(CLAUDE_PROVIDER_BACKOFF_MS, 300_000);
    const logs = (await fs.readFile(f.log, "utf8")).trim().split("\n").map(JSON.parse);
    assert.deepEqual(logs.map(item => item.outcome), [status < 500 ? "sign_in_needed" : "provider_unavailable"]);
    assert.equal(logs[0].model_reached, false);
    assert.deepEqual(await fs.readdir(path.join(f.root, "claude-attempts")), []);
    const commands = await fs.readFile(f.sshTrace, "utf8");
    assert.ok(commands.includes("attempt-release"));
    assert.ok(!commands.includes("attempt-mark"));
    assert.ok(!JSON.stringify(logs).includes("SYNTHETIC_PROVIDER_SENTINEL"));
  });
}

test("an attempt is marked while Claude is still running and killed-run session files are removed", async t => {
  const f = await fixture(t, "reach_then_hang");
  await assert.rejects(f.port.invoke({ ...call("job:synthetic-reach-hang"), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
  const [record] = await f.exchange.listDispatch();
  const pending = runJournalClaudeWorker(f.args, { environment: f.environment });
  let status;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    status = await fs.readFile(path.join(f.root, "claude-attempts", journalAttemptMarkerKey(record.attempt_identity) + ".json"), "utf8")
      .then(JSON.parse).catch(() => null);
    if (status?.status === "attempted") break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(status?.status, "attempted");
  assert.ok((await fs.readdir(f.workDir)).some((name) => name.startsWith("inner-signal-claude-")),
    "Claude already exited before the mark was observed");
  process.emit("SIGINT");
  assert.equal(await pending, 130);
  await assertWorkDirClean(f.workDir);
  assert.ok(!JSON.stringify(status).includes("SYNTHETIC_MODEL_SENTINEL"));
});

test("startup kills the recorded Claude group left by a SIGKILLed worker", async t => {
  const f = await fixture(t, "reach_then_hang");
  const key = "job:synthetic-worker-sigkill";
  await assert.rejects(f.port.invoke({ ...call(key), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
  const [dispatch] = await f.exchange.listDispatch();
  const cli = path.resolve(new URL("../src/cli/journal-codex-worker.mjs", import.meta.url).pathname);
  const worker = spawn(process.execPath, [cli, ...f.args.map(value => value === "2500" ? "15000" : value)],
    { env: f.environment, stdio: "ignore" });
  let group = null;
  t.after(() => {
    worker.kill("SIGKILL");
    if (group) { try { process.kill(-group, "SIGKILL"); } catch { /* already swept */ } }
  });
  let runDir;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    for (const parent of await fs.readdir(f.workDir)) {
      for (const run of await fs.readdir(path.join(f.workDir, parent))) {
        if (!run.startsWith("run-")) continue;
        runDir = path.join(f.workDir, parent, run);
        const record = await fs.readFile(path.join(runDir, "process-group.json"), "utf8").then(JSON.parse).catch(() => null);
        if (record) group = record.child.pid;
      }
    }
    const marker = await fs.readFile(path.join(f.root, "claude-attempts",
      journalAttemptMarkerKey(dispatch.attempt_identity) + ".json"), "utf8").then(JSON.parse).catch(() => null);
    if (group && marker?.model_reached) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.ok(group, "worker did not record its Claude process");
  const closed = new Promise(resolve => worker.once("close", resolve));
  worker.kill("SIGKILL");
  await closed;
  assert.doesNotThrow(() => process.kill(group, 0), "fixture did not leave a Claude process for the sweep");
  assert.equal(await runJournalClaudeWorker(f.args, { environment: f.environment }), 0);
  await assert.rejects(fs.access(runDir));
  const proc = await fs.readFile(`/proc/${group}/stat`, "utf8").catch(error => error.code === "ENOENT" ? null : Promise.reject(error));
  assert.ok(proc === null || proc.slice(proc.lastIndexOf(")") + 2).startsWith("Z "), "leftover Claude survived startup");
  // The attempted marker is young, so the item is treated as possibly in progress and left open.
  assert.equal((await f.port.getCompletion(key)).status, "unknown");
  let logs = (await fs.readFile(f.log, "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(logs.at(-1).outcome, "attempt_in_progress");
  // Once it is older than the run timeout plus ten minutes, the next worker closes it as spent.
  const marker = path.join(f.root, "claude-attempts", journalAttemptMarkerKey(dispatch.attempt_identity) + ".json");
  const stale = new Date(Date.now() - 2 * 3_600_000);
  await fs.utimes(marker, stale, stale);
  assert.equal(await runJournalClaudeWorker(f.args, { environment: f.environment }), 0);
  logs = (await fs.readFile(f.log, "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(logs.at(-1).outcome, "already_attempted");
  assert.equal((await f.port.getCompletion(key)).status, "exhausted");
});

for (const scenario of ["nothing_staged", "tools_extra"]) {
  test(`reference-audit resends retain the ${scenario === "tools_extra" ? "isolation" : "attempt"} hold`, async t => {
    const f = await fixture(t, scenario);
    const baseKey = `job:synthetic-resend-${scenario}`;
    await assert.rejects(f.port.invoke({ ...call(baseKey), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
    await runJournalClaudeWorker(f.args, { environment: f.environment });
    const before = await fs.readFile(f.trace, "utf8");
    const baseWorkId = JSON.parse((await fs.readFile(f.log, "utf8")).trim().split("\n")[0]).work_id;
    for (const resend of [1, 2]) {
      await assert.rejects(f.port.invoke({ ...call(`${baseKey}:resend:${resend}`), tier: "hardest" }),
        { code: "JOURNAL_HARDEST_ATTEMPT_EXHAUSTED", submissionStatus: "exhausted" });
      assert.deepEqual(await f.port.getCompletion(`${baseKey}:resend:${resend}`, { tier: "hardest" }),
        { status: "exhausted", code: "JOURNAL_HARDEST_ATTEMPT_EXHAUSTED" });
    }
    // Resends of a held identity are never published. An isolation refusal before the model keeps the
    // base item open behind its clearable hold; an attempted item was closed.
    assert.deepEqual((await f.exchange.listDispatch()).map(record => record.work_id),
      scenario === "tools_extra" ? [baseWorkId] : [], "consumed identities never publish a resend");
    await runJournalClaudeWorker(f.args, { environment: f.environment });
    assert.equal(await fs.readFile(f.trace, "utf8"), before);
    const logs = (await fs.readFile(f.log, "utf8")).trim().split("\n").map(JSON.parse);
    // After an isolation refusal the next start stops at once on the kept setup refusal.
    assert.equal(logs.at(-1).outcome, scenario === "tools_extra" ? "setup_refused" : "rejected:STAGE_MISSING");
  });
}

test("startup refuses non-Linux platforms and paths whose longest real run slug exceeds 200", async t => {
  for (const platform of ["darwin", "win32", "freebsd"]) {
    await assert.rejects(runJournalClaudeWorker([], { platform }), { code: "JOURNAL_CLAUDE_LINUX_REQUIRED" });
  }
  const suffix = path.join("inner-signal-claude-XXXXXX", "run-XXXXXX");
  assert.doesNotThrow(() => assertClaudeRunPath("/" + "x".repeat(200 - suffix.length - 2)));
  assert.throws(() => assertClaudeRunPath("/" + "x".repeat(201 - suffix.length - 2)),
    { code: "JOURNAL_CLAUDE_RUN_PATH_TOO_LONG" });
  const f = await fixture(t);
  const long = path.join(f.workDir, "x".repeat(150));
  await fs.mkdir(long, { mode: 0o700 });
  const alias = path.join(f.workDir, "short");
  await fs.symlink(long, alias);
  // Startup's directory contract deliberately refuses symlink work dirs. Test
  // the realpath bound on the physical directory and its canonical projection.
  const realDir = await fs.realpath(alias);
  assert.throws(() => assertClaudeRunPath(realDir), { code: "JOURNAL_CLAUDE_RUN_PATH_TOO_LONG" });
  await assert.rejects(runJournalClaudeWorker(f.args.map(value => value === f.workDir ? long : value),
    { environment: f.environment }), { code: "JOURNAL_CLAUDE_RUN_PATH_TOO_LONG" });
  await assert.rejects(fs.access(f.trace));
});

test("persistence cleanup recognizes exact and truncated-plus-hash slugs", async t => {
  const f = await fixture(t);
  const runDir = path.join(f.workDir, "x".repeat(150), "inner-signal-claude-AAAAAA", "run-BBBBBB");
  const slug = claudeRunSlug(runDir);
  assert.ok(slug.length > 200);
  const root = path.join(f.laptop, ".claude", "projects");
  for (const name of [slug, slug.slice(0, 200) + "-1234abcd"]) {
    await fs.mkdir(path.join(root, name), { recursive: true });
    await fs.writeFile(path.join(root, name, "synthetic.txt"), SENTINEL);
  }
  assert.equal(await cleanClaudePersistence(f.laptop, runDir), true);
  assert.deepEqual(await fs.readdir(root), []);
});

test("startup persistence sweep preserves a live sibling's project and fallback cache evidence", async t => {
  const f = await fixture(t);
  const runDir = path.join(f.workDir, "inner-signal-claude-AAAAAA", "run-BBBBBB");
  await fs.mkdir(runDir, { recursive: true, mode: 0o700 });
  const roots = [path.join(f.laptop, ".claude", "projects"), path.join(f.laptop, ".cache", "claude-cli-nodejs")];
  for (const root of roots) {
    await fs.mkdir(path.join(root, claudeRunSlug(runDir)), { recursive: true });
    await fs.writeFile(path.join(root, claudeRunSlug(runDir), "synthetic.txt"), SENTINEL);
  }
  await sweepClaudePersistence(f.laptop, f.workDir);
  for (const root of roots) assert.equal(await fs.readFile(path.join(root, claudeRunSlug(runDir), "synthetic.txt"), "utf8"), SENTINEL);
  await fs.rm(runDir, { recursive: true });
  await sweepClaudePersistence(f.laptop, f.workDir);
  for (const root of roots) await assert.rejects(fs.access(path.join(root, claudeRunSlug(runDir))));
});

test("release cannot erase a concurrent mark, either before or after its rename", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "journal-release-race-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const marker = path.join(directory, "marker.json"), claim = "11111111-1111-4111-8111-111111111111";
  const reserved = { claim, status: "reserved" };
  const rename = fs.rename.bind(fs);
  for (const phase of ["before", "after"]) {
    await writeAttemptMarker(marker, reserved);
    const mock = t.mock.method(fs, "rename", async (source, target) => {
      if (source === marker) {
        if (phase === "before") await writeAttemptMarker(marker, { ...reserved, status: "attempted" });
        await rename(source, target);
        if (phase === "after") await writeAttemptMarker(marker, { ...reserved, status: "attempted" });
      } else await rename(source, target);
    });
    if (phase === "before") await assert.rejects(releaseAttemptMarker(marker, claim), { code: "JOURNAL_WORK_ATTEMPT_INVALID" });
    else await releaseAttemptMarker(marker, claim);
    mock.mock.restore();
    assert.equal(JSON.parse(await fs.readFile(marker, "utf8")).status, "attempted");
    assert.deepEqual(await fs.readdir(directory), ["marker.json"]);
  }
});

test("startup leaves a live sibling's parent older than an hour, with its run, untouched", async (t) => {
  const f = await fixture(t);
  // A long-running sibling: its parent is more than an hour old, it holds the worker lock and has a run in flight.
  const sibling = path.join(f.workDir, "inner-signal-claude-LIVESB");
  const run = path.join(sibling, "run-INFLGT");
  await fs.mkdir(run, { recursive: true, mode: 0o700 });
  await fs.chmod(sibling, 0o700);
  await fs.writeFile(path.join(run, "process-group.json"), JSON.stringify({
    owner: { pid: process.pid, start: (await fs.readFile("/proc/self/stat", "utf8")).split(") ")[1].split(" ")[19] },
    child: { pid: process.pid, start: "0" } }), { mode: 0o600 });
  const unlock = await lockWorkerDirectory(sibling);
  t.after(() => unlock());
  const old = new Date(Date.now() - 2 * 3_600_000);
  await fs.utimes(sibling, old, old);
  assert.equal(await runJournalClaudeWorker(f.args, { environment: f.environment }), 0);
  await fs.access(path.join(run, "process-group.json"));
  assert.ok((await fs.readdir(f.workDir)).includes("inner-signal-claude-LIVESB"));
});
