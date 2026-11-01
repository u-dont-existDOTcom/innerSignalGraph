import { mkdtempSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { OPT_IN_ENV, PLANTED, HARD_CAP, buildSchedule, loadSealed, runStage1Audit, scriptedFindings } from "./stage1-audit.mjs";
import { scoreStage1 } from "./stage1-score.mjs";

// A check of the stage 1 driver's guards against a sealed folder, with the scripted stand-in and no model. It runs the driver in throwaway
// folders and looks at what was written, so a guard that does not hold shows up here before any live call. Not a test file on purpose:
// it needs a sealed folder, which comes from a stage 0 run, and the repository's test run does not have one.
const names = async (dir) => (await fs.readdir(dir).catch(() => [])).filter((name) => !name.startsWith("."));
const startedFiles = async (out) => (await names(path.join(out, "receipts"))).filter((name) => name.endsWith(".started.json"));

// A stand-in for the `claude` executable, so the live path (the repository's sealed Claude CLI provider, the flag check, the envelope parsing and
// the stop rules) can be run end to end without a model. It answers --help and --version, logs every `-p` call with its arguments and the hashes
// of its stdin and system-prompt file, and replies with a scripted audit result in the CLI's JSON envelope. It is not a model.
function fakeClaudeSource({ logFile, counterFile, known, plan }) {
  return `#!/usr/bin/env node
const fs = require("node:fs");
const crypto = require("node:crypto");
const args = process.argv.slice(2);
const plan = ${JSON.stringify(plan)};
const known = ${JSON.stringify(known)};
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
if (args.includes("--version")) { console.log("0.0.0-selfcheck (Claude Code)"); process.exit(0); }
if (args.includes("--help")) {
  const flags = ["-p, --print", "--model <model>", "--effort <level>", "--output-format <format>", "--json-schema <schema>", "--tools <tools...>", "--no-session-persistence", "--permission-mode <mode>", "--no-chrome", "--safe-mode", "--strict-mcp-config", "--system-prompt-file <file>", "--system-prompt <prompt>"].concat(plan.help === "no-max-turns" ? [] : ["--max-turns <turns>"]).filter((flag) => !(plan.help === "no-tools" && flag.startsWith("--tools ")));
  console.log("Options:\\n" + flags.map((flag) => "  " + flag).join("\\n"));
  process.exit(0);
}
let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { stdin += chunk; });
process.stdin.on("end", () => {
  const counter = ${JSON.stringify(counterFile)};
  const n = (fs.existsSync(counter) ? Number(fs.readFileSync(counter, "utf8")) : 0) + 1;
  fs.writeFileSync(counter, String(n));
  const at = args.indexOf("--system-prompt-file");
  const system = at >= 0 ? fs.readFileSync(args[at + 1], "utf8") : null;
  const findings = known[sha(stdin)];
  const shown = args.map((arg, index) => (args[index - 1] === "--json-schema" ? "<schema>" : args[index - 1] === "--system-prompt-file" ? "<file>" : arg));
  fs.appendFileSync(${JSON.stringify(logFile)}, JSON.stringify({ n, args: shown, stdin_sha256: sha(stdin), system_sha256: system == null ? null : sha(system), known: Boolean(findings), env_keys: Object.keys(process.env).sort() }) + "\\n");
  if (plan.limitAt === n) { console.log(JSON.stringify({ type: "result", subtype: "success", is_error: true, result: "You've hit your limit. It resets at 5pm." })); process.exit(1); }
  const model = plan.wrongModelAt === n ? "claude-sonnet-5-5" : "claude-opus-5-5";
  console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "", structured_output: { findings: findings || [], repair_induced_checks: [] }, session_id: "selfcheck-session-" + n, usage: { input_tokens: 1000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 200 }, modelUsage: { [model]: { inputTokens: 1000, outputTokens: 200 } } }));
});
`;
}

// Every throwaway file goes into one private folder. Without a folder from the caller it is made by mkdtemp under the temp directory (an
// unpredictable name, mode 0700) and removed at the end; nothing is ever created at a name chosen in advance in a shared directory. A folder
// the caller names must be new or empty, is made with mode 0700 and is kept as run output; a folder with something in it is refused, never emptied.
export async function runGuardSelfCheck({ sealedDir, workDir = null }) {
  const ownsWork = workDir == null;
  let folderPath = workDir;
  if (ownsWork) folderPath = mkdtempSync(path.join(os.tmpdir(), "inner-signal-guard-selfcheck-"));
  else {
    await fs.mkdir(folderPath, { recursive: true, mode: 0o700 });
    if ((await fs.readdir(folderPath)).length > 0) throw new Error(`The self-check work folder must be new or empty (${folderPath}).`);
  }
  try {
    return await checkGuards({ sealedDir, workDir: folderPath });
  } finally {
    if (ownsWork) await fs.rm(folderPath, { recursive: true, force: true });
  }
}

async function checkGuards({ sealedDir, workDir }) {
  const rows = [];
  const check = (name, ok, detail = null) => rows.push({ name, ok: Boolean(ok), detail });
  const folder = (name) => path.join(workDir, name);
  const mock = (name, options = {}) => runStage1Audit({ sealedDir, outDir: folder(name), mode: "mock", ...options });
  const refused = async (promise) => promise.then(() => null, (error) => String(error.message));

  const sealed = await loadSealed(sealedDir);
  const schedule = buildSchedule(sealed.manifest);
  const first12 = schedule.slice(0, 12);
  check("144 distinct calls are scheduled", schedule.length === HARD_CAP && new Set(schedule.map((item) => item.call)).size === HARD_CAP, schedule.length);
  check("the first 8 calls cover every decision turn and the first 12 cover both arms", new Set(schedule.slice(0, 8).map((item) => item.packet.split(".")[0])).size === sealed.manifest.decisions.length && new Set(first12.map((item) => item.packet.split(".")[1])).size === 2);

  // the hard cap, whatever else is asked
  let summary = await mock("cap", { hardCap: 10 });
  check("a hard cap of 10 sends exactly 10 calls and stops for the cap", summary.started_now === 10 && summary.stop_reason === "hard_cap" && (await startedFiles(folder("cap"))).length === 10, summary);
  check("a hard cap above 144 is refused", (await refused(mock("cap-high", { hardCap: 145 }))) !== null);
  check("a limit of 0, a fractional limit and a concurrency of 4 are refused", (await refused(mock("bad-limit", { limit: 0 }))) !== null && (await refused(mock("bad-fraction", { limit: 2.5 }))) !== null && (await refused(mock("bad-concurrency", { concurrency: 4 }))) !== null);

  // --limit counts the folder's calls in total, so repeating a command spends nothing more
  summary = await mock("limit", { limit: 12 });
  check("--limit 12 sends exactly 12 calls", summary.started_now === 12 && summary.stop_reason === "limit", summary);
  summary = await mock("limit", { limit: 12 });
  check("the same command again sends nothing", summary.started_now === 0 && summary.stop_reason === "limit" && (await startedFiles(folder("limit"))).length === 12, summary);
  summary = await mock("limit", { limit: 20 });
  check("--limit 20 afterwards sends 8 more", summary.started_now === 8 && summary.counted_total === 20, summary);
  const sent = new Map(sealed.byId);
  const receipts = await Promise.all((await startedFiles(folder("limit"))).map(async (name) => JSON.parse(await fs.readFile(path.join(folder("limit"), "receipts", name), "utf8"))));
  check("every call was made from a sealed prompt, byte for byte", receipts.every((receipt) => receipt.user_sha256 === sent.get(receipt.packet).entry.user_sha256 && receipt.system_sha256 === sealed.manifest.system_prompt.sha256));

  // the first usage-limit error stops the run; the rejected call is not counted and is tried again in a later run
  summary = await mock("usage-limit", { faults: { usageLimitAt: 4 } });
  check("the first usage-limit error stops the run after 3 answers and 1 rejection", summary.stop_reason === "usage_limit" && summary.started_now === 4 && summary.this_run.ok === 3 && summary.this_run.usage_limit === 1 && summary.counted_total === 3, summary);
  summary = await mock("usage-limit", { limit: 6 });
  const rejected = schedule[3].call;
  check("after the limit resets the rejected call is tried again (and only it, once)", summary.started_now === 3 && (await names(path.join(folder("usage-limit"), "receipts"))).filter((name) => name.startsWith(`${rejected}.a`) && name.endsWith(".result.json")).length === 2, summary);

  // nothing is retried
  const cutOff = folder("cut-off");
  await fs.mkdir(path.join(cutOff, "receipts"), { recursive: true });
  await fs.writeFile(path.join(cutOff, "receipts", `${schedule[2].call}.a1.started.json`), `${JSON.stringify({ call: schedule[2].call, attempt: 1 })}\n`);
  summary = await mock("cut-off", { limit: 5 });
  check("a call that was started and never finished is recorded as ambiguous and not repeated", summary.ambiguous_not_retried_total === 1 && !(await names(path.join(cutOff, "receipts"))).some((name) => name.startsWith(`${schedule[2].call}.a2`)) && summary.counted_total === 5, summary);
  summary = await mock("failures", { faults: { errorAt: [2, 3, 4] } });
  check("three failures in a row stop the run", summary.stop_reason === "three_failures_in_a_row" && summary.started_now === 4 && summary.this_run.error === 3, summary);
  summary = await mock("failures", { limit: 10 });
  const failedCalls = [schedule[1].call, schedule[2].call, schedule[3].call];
  const attemptsOf = async (call) => (await names(path.join(folder("failures"), "receipts"))).filter((name) => name.startsWith(`${call}.a`) && name.endsWith(".started.json")).length;
  check("failed calls are never retried, in this run or a later one", (await Promise.all(failedCalls.map(attemptsOf))).every((count) => count === 1) && summary.started_now === 6, summary);
  summary = await mock("odd-answers", { faults: { timeoutAt: [1], garbageAt: [2] }, limit: 4 });
  check("a timeout and an unusable answer are recorded as such and do not stop a run of four", summary.this_run.error === 1 && summary.this_run.unusable === 1 && summary.this_run.ok === 2 && summary.started_now === 4, summary);
  summary = await mock("parallel", { concurrency: 3, limit: 9 });
  const parallel = await startedFiles(folder("parallel"));
  check("three at a time still sends exactly 9, each once", summary.started_now === 9 && parallel.length === 9 && new Set(parallel).size === 9, summary);

  // a live run is refused unless it was asked for, and before anything is sent
  check("a live run without the opt-in is refused", String(await refused(runStage1Audit({ sealedDir, outDir: folder("live-refused"), mode: "live", env: {} }))).includes(OPT_IN_ENV));
  check("a live run in API mode is refused", String(await refused(runStage1Audit({ sealedDir, outDir: folder("live-api"), mode: "live", env: { [OPT_IN_ENV]: "1", INNER_SIGNAL_MODE: "api" } }))).includes("API"));
  check("neither refusal wrote a receipt", (await startedFiles(folder("live-refused"))).length === 0 && (await startedFiles(folder("live-api"))).length === 0);

  // the sealed bytes are checked before the first call
  const tampered = folder("tampered-sealed");
  await fs.cp(sealedDir, tampered, { recursive: true });
  const victim = path.join(tampered, sealed.manifest.packets[7].file);
  await fs.writeFile(victim, `${await fs.readFile(victim, "utf8")} `);
  const message = await refused(runStage1Audit({ sealedDir: tampered, outDir: folder("tampered-out"), mode: "mock" }));
  check("a sealed packet changed by one byte is refused before any call", message?.includes("changed after sealing") === true && (await startedFiles(folder("tampered-out"))).length === 0, message);
  const other = folder("other-sealed");
  await fs.cp(sealedDir, other, { recursive: true });
  const otherManifest = JSON.parse(await fs.readFile(path.join(other, "manifest.json"), "utf8"));
  await fs.writeFile(path.join(other, "manifest.json"), `${JSON.stringify({ ...otherManifest, sealed_at: "2000-01-01T00:00:00.000Z" }, null, 1)}\n`);
  check("a receipts folder is tied to the sealed folder it started with", String(await refused(runStage1Audit({ sealedDir: other, outDir: folder("limit"), mode: "mock" }))).includes("different sealed folder"));

  // the live path through the repository's Claude CLI provider, against a stand-in executable
  const known = Object.fromEntries(sealed.entries.map((item) => [item.entry.user_sha256, scriptedFindings(item.entry, "")]));
  const previousCommand = process.env.CLAUDE_COMMAND;
  const live = async (name, plan, options = {}) => {
    const dir = folder(`live-${name}`);
    await fs.mkdir(dir, { recursive: true });
    const command = path.join(dir, "claude");
    const logFile = path.join(dir, "fake-claude.log");
    await fs.writeFile(command, fakeClaudeSource({ logFile, counterFile: path.join(dir, "fake-claude.count"), known, plan }), { mode: 0o755 });
    process.env.CLAUDE_COMMAND = command;
    try {
      const result = await runStage1Audit({ sealedDir, outDir: path.join(dir, "out"), mode: "live", env: { [OPT_IN_ENV]: "1" }, ...options }).then((summary) => ({ summary }), (error) => ({ error: String(error.message) }));
      const log = (await fs.readFile(logFile, "utf8").catch(() => "")).split("\n").filter(Boolean).map((line) => JSON.parse(line));
      return { ...result, log };
    } finally {
      if (previousCommand === undefined) delete process.env.CLAUDE_COMMAND; else process.env.CLAUDE_COMMAND = previousCommand;
    }
  };
  let liveRun = await live("three", { help: "full" }, { limit: 3 });
  const flagsOf = (entry) => entry.args.join(" ");
  check("a live run calls `claude -p` with the requested model and effort, the sealed settings, the sealed system prompt and the sealed prompt on stdin", liveRun.summary?.started_now === 3 && liveRun.log.length === 3
    && liveRun.log.every((entry) => entry.known && entry.system_sha256 === sealed.manifest.system_prompt.sha256 && /(^| )-p( |$)/u.test(flagsOf(entry)) && flagsOf(entry).includes("--model claude-opus-5-5 --effort high --output-format json --json-schema <schema> --tools  --max-turns 1 --no-session-persistence --permission-mode dontAsk --no-chrome --safe-mode --strict-mcp-config --system-prompt-file <file>")), liveRun.error ?? liveRun.log[0]);
  check("the live call's process sees only the allowlisted environment", liveRun.log.every((entry) => entry.env_keys.every((key) => ["PATH", "HOME", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "TMPDIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "DBUS_SESSION_BUS_ADDRESS", "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS", "CLAUDE_CONFIG_DIR", "PWD", "SHLVL", "_", "OLDPWD"].includes(key))), liveRun.log[0]?.env_keys);
  const liveReceiptsDir = path.join(folder("live-three"), "out", "receipts");
  const liveReceipts = await Promise.all((await names(liveReceiptsDir)).filter((name) => name.endsWith(".result.json")).map(async (name) => JSON.parse(await fs.readFile(path.join(liveReceiptsDir, name), "utf8"))));
  check("the live receipts record the models that answered, the tokens and the verdict", liveReceipts.length === 3 && liveReceipts.every((receipt) => receipt.model_confirmed === true && receipt.effective_models.includes("claude-opus-5-5") && receipt.usage.output_tokens === 200 && ["pass", "fail"].includes(receipt.verdict)));
  liveRun = await live("limit", { help: "full", limitAt: 3 }, { limit: 12 });
  check("a usage-limit error from the CLI stops a live run at once", liveRun.summary?.stop_reason === "usage_limit" && liveRun.log.length === 3 && liveRun.summary.counted_total === 2, liveRun.error ?? liveRun.summary);
  liveRun = await live("model", { help: "full", wrongModelAt: 1 }, { limit: 12 });
  check("an answer from another model than the requested one stops a live run after that call", liveRun.summary?.stop_reason === "model_not_confirmed" && liveRun.log.length === 1, liveRun.error ?? liveRun.summary);
  liveRun = await live("flags", { help: "no-tools" }, { limit: 12 });
  check("a CLI without a flag the sealed provider needs is refused before any call", String(liveRun.error).includes("tools") && liveRun.log.length === 0, liveRun.error);
  liveRun = await live("no-max-turns", { help: "no-max-turns" }, { limit: 1 });
  check("a CLI that does not list --max-turns still runs, with no tools and without that flag", liveRun.summary?.started_now === 1 && liveRun.log.length === 1 && !flagsOf(liveRun.log[0]).includes("--max-turns") && flagsOf(liveRun.log[0]).includes("--tools "), liveRun.error ?? { summary: liveRun.summary, log0: liveRun.log[0] ?? null });


  // the whole run and the scorer, against the four planted misses
  summary = await mock("full");
  const score = await scoreStage1({ runDir: folder("full") });
  const highCalls = score.high_misses.map((found) => found.call).sort();
  const planted = Object.entries(PLANTED);
  const all = score.cells.flatMap((cell) => cell.misses);
  const bySeverity = (severity) => all.filter((found) => found.severity === severity).length;
  check("all 144 calls complete", summary.stop_reason === "completed" && summary.counted_total === HARD_CAP && score.calls.ok === HARD_CAP, summary);
  check("the scorer finds the two planted HIGH misses, the planted MEDIUM and the planted LOW, and nothing else", JSON.stringify(highCalls) === JSON.stringify(planted.filter(([, kind]) => kind.endsWith("blocking")).map(([call]) => call).sort()) && bySeverity("MEDIUM") === 1 && bySeverity("LOW") === 1 && all.length === 4, { high: highCalls, medium: bySeverity("MEDIUM"), low: bySeverity("LOW"), total: all.length });
  check("a seed G is never counted as blocked unless planted, and every U at an onset turn is blocked", score.cells.filter((cell) => cell.seed === "G").every((cell) => cell.blocked === (cell.packet === "A8-t30.T.G" ? 1 : 0)) && score.cells.filter((cell) => cell.seed === "U" && cell.expectations.blocking === "required").every((cell) => cell.blocked === (cell.packet === "A1-t11.H.U" ? 2 : 3)));
  return { passed: rows.filter((row) => row.ok).length, failed: rows.filter((row) => !row.ok).length, rows };
}
