import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { projectRoot } from "../../src/core/config.mjs";
import { ProviderError } from "../../src/core/errors.mjs";
import { ClaudeCliProvider } from "../../src/providers/claude-cli.mjs";
import { privateRuntimeAuditResultSchema } from "../../src/schemas/private-runtime.mjs";
import { sha256 } from "./corpus.mjs";
import { ISOLATION_UNAVAILABLE, OPT_IN_ENV, PLANTED, PROVIDER_FIX_BRANCH, HARD_CAP, MockAuditor, buildSchedule, loadSealed, runStage1Audit, scriptedFindings } from "./stage1-audit.mjs";
import { renderStage1, scoreStage1 } from "./stage1-score.mjs";

// A check of the stage 1 driver's guards against a sealed folder, with the scripted stand-in and no model. It runs the driver in throwaway
// folders and looks at what was written, so a guard that does not hold shows up here before any live call. Not a test file on purpose:
// it needs a sealed folder, which comes from a stage 0 run, and the repository's test run does not have one.
const names = async (dir) => (await fs.readdir(dir).catch(() => [])).filter((name) => !name.startsWith("."));
const startedFiles = async (out) => (await names(path.join(out, "receipts"))).filter((name) => name.endsWith(".started.json"));
const exists = (file) => fs.stat(file).then(() => true, () => false);

// Every file under a folder with a hash of its bytes: a refused run must leave the folder exactly as it found it.
async function snapshot(dir) {
  const files = (await fs.readdir(dir, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => path.join(entry.parentPath, entry.name)).sort();
  return JSON.stringify(await Promise.all(files.map(async (file) => [path.relative(dir, file), sha256(await fs.readFile(file))])));
}

// Environment changes for the length of one run, put back afterwards however it ends.
async function withEnvironment(changes, run) {
  const previous = Object.fromEntries(Object.keys(changes).map((key) => [key, process.env[key]]));
  Object.assign(process.env, changes);
  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
}

// Records the `sealed` argument of every ClaudeCliProvider.generate call made while `run` is going. With `refuse` the provider is replaced by one
// that refuses the way this checkout's provider does on a CLI without --max-turns (before it starts anything), whatever the real provider says.
async function recordingSealedArgument({ refuse = false }, run) {
  const original = ClaudeCliProvider.prototype.generate;
  const sealedArguments = [];
  ClaudeCliProvider.prototype.generate = function recordingGenerate(request) {
    sealedArguments.push(request?.sealed);
    if (refuse) return Promise.reject(new ProviderError("Installed Claude CLI cannot guarantee packet-only private inference isolation.", { code: ISOLATION_UNAVAILABLE, details: { missingIsolationFlags: ["maxTurns"] } }));
    return original.call(this, request);
  };
  try {
    return { ...(await run()), sealedArguments };
  } finally {
    ClaudeCliProvider.prototype.generate = original;
  }
}

// An unrelated variable put in this process's environment while a live run is going. A sealed call must not carry it: the provider passes its
// allowlisted environment only. CLI_ISOLATE_CONFIG=false is set with it, so that only a sealed call carries --safe-mode and --strict-mcp-config.
const MARKER = Object.freeze({ name: "INNER_SIGNAL_SELFCHECK_UNRELATED_MARKER", value: randomUUID() });

// What a call that was not sealed shows in the fake CLI's log: the checkout (or this process's folder) as its working folder, the marker in its
// environment, or an isolation flag missing. No signs means the call was sealed.
const toolsOff = (args) => { const at = args.indexOf("--tools"); return at >= 0 && args[at + 1] === ""; };
const unsealedSigns = (entry, checkout) => [
  ...(entry.cwd === checkout || entry.cwd.startsWith(`${checkout}${path.sep}`) || entry.cwd === process.cwd() ? [`its working folder was ${entry.cwd}`] : []),
  ...(entry.env_keys.includes(MARKER.name) ? ["the unrelated marker was in its environment"] : []),
  ...(toolsOff(entry.args) ? [] : ['no --tools ""']),
  ...["--safe-mode", "--strict-mcp-config"].filter((flag) => !entry.args.includes(flag)).map((flag) => `no ${flag}`)
];

// A stand-in for the `claude` executable, so the live path (the repository's sealed Claude CLI provider, the flag check, the envelope parsing and
// the stop rules) can be run end to end without a model. It answers --help and --version, logs every `-p` call with its arguments and the hashes
// of its stdin and system-prompt file, the folder it was started in and the names of the environment variables it was given, and replies with a
// scripted audit result in the CLI's JSON envelope. Its help text and version come from the plan. It is not a model.
function fakeClaudeSource({ logFile, counterFile, known, plan }) {
  return `#!/usr/bin/env node
const fs = require("node:fs");
const crypto = require("node:crypto");
const args = process.argv.slice(2);
const plan = ${JSON.stringify(plan)};
const known = ${JSON.stringify(known)};
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
if (args.includes("--version")) { console.log((plan.version || "0.0.0-selfcheck") + " (Claude Code)"); process.exit(0); }
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
  fs.appendFileSync(${JSON.stringify(logFile)}, JSON.stringify({ n, args: shown, cwd: process.cwd(), stdin_sha256: sha(stdin), system_sha256: system == null ? null : sha(system), known: Boolean(findings), env_keys: Object.keys(process.env).sort() }) + "\\n");
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
  await mock("cut-off", { limit: 1 });
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

  // the live path through the repository's Claude CLI provider, against a stand-in executable. Every live run has the unrelated marker in this
  // process's environment and CLI_ISOLATE_CONFIG=false, so that nothing but the provider's sealed mode keeps a call isolated. `out` is the
  // run's receipts folder (its own unless the caller names one); `refuse` makes the provider refuse as it does on a CLI without --max-turns.
  const known = Object.fromEntries(sealed.entries.map((item) => [item.entry.user_sha256, scriptedFindings(item.entry, "")]));
  const liveRuns = [];
  const live = async (name, plan, { outDir = null, refuse = false, ...options } = {}) => {
    const dir = folder(`live-${name}`);
    await fs.mkdir(dir, { recursive: true });
    const command = path.join(dir, "claude");
    const logFile = path.join(dir, "fake-claude.log");
    await fs.writeFile(command, fakeClaudeSource({ logFile, counterFile: path.join(dir, "fake-claude.count"), known, plan }), { mode: 0o755 });
    const out = outDir ?? path.join(dir, "out");
    const observed = await withEnvironment({ CLAUDE_COMMAND: command, CLI_ISOLATE_CONFIG: "false", [MARKER.name]: MARKER.value }, () => recordingSealedArgument({ refuse }, () => runStage1Audit({ sealedDir, outDir: out, mode: "live", env: { [OPT_IN_ENV]: "1" }, ...options }).then((summary) => ({ summary }), (error) => ({ error: String(error.message) }))));
    const log = (await fs.readFile(logFile, "utf8").catch(() => "")).split("\n").filter(Boolean).map((line) => JSON.parse(line));
    const run = { ...observed, log, out };
    liveRuns.push(run);
    return run;
  };
  const checkout = await fs.realpath(projectRoot);
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

  // Isolation does not depend on the CLI listing --max-turns. The live path always asks for the provider's sealed mode and the provider decides
  // what that needs, so a CLI without the flag is either refused before any call or run sealed; it must never run unsealed. Sealed means: a
  // working folder that is not the checkout, none of this process's unrelated variables, and --tools "", --safe-mode and --strict-mcp-config.
  const brief = (run) => ({ error: run.error ?? null, summary: run.summary ?? null, calls: run.log.length, first: run.log[0] ?? null });
  const refusedBeforeAnyCall = async (run) => run.summary === undefined && String(run.error).includes(ISOLATION_UNAVAILABLE) && run.log.length === 0
    && (await names(path.join(run.out, "receipts"))).length === 0 && !(await exists(path.join(run.out, "invocations.jsonl")));
  const ranSealed = (run) => run.summary?.started_now === 1 && run.log.length === 1 && unsealedSigns(run.log[0], checkout).length === 0;
  const withoutFlag = await live("no-max-turns", { help: "no-max-turns" }, { limit: 1 });
  const withFlag = await live("with-max-turns", { help: "full" }, { limit: 1 });
  check("a CLI that does not list --max-turns is never run unsealed: the run is refused before any call (PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE), or the call ran sealed", (await refusedBeforeAnyCall(withoutFlag)) || ranSealed(withoutFlag), brief(withoutFlag));
  check("a CLI that lists --max-turns runs sealed", ranSealed(withFlag), brief(withFlag));

  // The instrument itself: the same evidence, taken from a call made unsealed straight through the provider, must show every sign looked for above.
  const controlDir = folder("live-unsealed-control");
  await fs.mkdir(controlDir, { recursive: true });
  const controlCommand = path.join(controlDir, "claude");
  const controlLog = path.join(controlDir, "fake-claude.log");
  await fs.writeFile(controlCommand, fakeClaudeSource({ logFile: controlLog, counterFile: path.join(controlDir, "fake-claude.count"), known, plan: { help: "full" } }), { mode: 0o755 });
  await withEnvironment({ [MARKER.name]: MARKER.value }, () => new ClaudeCliProvider({ command: controlCommand, model: "claude-opus-5-5", effort: "high", cwd: checkout, isolateConfig: false })
    .generate({ system: "control", user: "control", outputSchema: privateRuntimeAuditResultSchema, sealed: false }).catch(() => null));
  const controlEntry = (await fs.readFile(controlLog, "utf8").catch(() => "")).split("\n").filter(Boolean).map((line) => JSON.parse(line))[0];
  const controlSigns = controlEntry ? unsealedSigns(controlEntry, checkout) : ["the control call never reached the CLI"];
  check("the evidence tells an unsealed call from a sealed one: made unsealed through the provider, a call shows the checkout, the marker, and neither --safe-mode nor --strict-mcp-config", controlSigns.length === 4, controlSigns);

  // A refusal by the provider before any call is a stop, not a failed call. It is simulated here, so that this holds whichever provider this checkout has.
  const refusal = await live("refusal", { help: "full" }, { limit: 12, concurrency: 3, refuse: true });
  check("when the provider refuses a sealed call before any call, the run stops with a plain message, and nothing is sent, counted or kept", (await refusedBeforeAnyCall(refusal)) && refusal.error.includes("--max-turns") && refusal.error.includes(PROVIDER_FIX_BRANCH), brief(refusal));
  liveRun = await live("after-refusal", { help: "full" }, { limit: 2, outDir: refusal.out });
  check("after such a refusal the same folder runs normally: the refused calls were neither counted nor settled as ambiguous", liveRun.summary?.started_now === 2 && liveRun.summary.counted_total === 2 && liveRun.summary.ambiguous_not_retried_total === 0 && liveRun.log.length === 2, liveRun.error ?? liveRun.summary);

  // A receipts folder keeps the settings of its first invocation (run.json). A run that asks for others is refused before any call and leaves the
  // folder as it was; a resume with the same settings still works, and a new Claude CLI version is not a reason to refuse.
  const tied = folder("tied");
  await mock("tied", { limit: 2 });
  let before = await snapshot(tied);
  liveRun = await live("tied-mode", { help: "full" }, { limit: 12, outDir: tied });
  check("a live run in a folder that a mock run started is refused before any call, and the folder is left as it was", String(liveRun.error).includes('mode: started with "mock", asked for "live"') && liveRun.log.length === 0 && (await snapshot(tied)) === before, brief(liveRun));
  const otherProvider = Object.assign(new MockAuditor({ sealed }), { id: "other-provider" });
  const changes = [["model", { model: "claude-sonnet-5-5" }], ["effort", { effort: "low" }], ["provider", { provider: otherProvider }]];
  const messages = [];
  for (const [label, change] of changes) messages.push([label, await refused(mock("tied", change))]);
  check("in a mock folder, a different model, effort and provider are each refused before any call, and the folder is left as it was", messages.every(([label, message]) => message?.includes(`${label}: started with`)) && (await snapshot(tied)) === before, messages);
  const tiedLive = folder("tied-live-out");
  const firstRun = await live("tied-live-1", { help: "full", version: "1.0.0-selfcheck" }, { limit: 2, outDir: tiedLive });
  const resumed = await live("tied-live-2", { help: "full", version: "2.0.0-selfcheck" }, { limit: 4, outDir: tiedLive });
  check("a live resume with the same settings still works, after the Claude CLI was updated", firstRun.summary?.started_now === 2 && resumed.summary?.started_now === 2 && resumed.summary.counted_total === 4 && resumed.log.length === 2, { first: firstRun.error ?? firstRun.summary, resumed: resumed.error ?? resumed.summary });
  before = await snapshot(tiedLive);
  const otherModel = await live("tied-live-model", { help: "full" }, { limit: 12, outDir: tiedLive, model: "claude-sonnet-5-5" });
  const otherEffort = await live("tied-live-effort", { help: "full" }, { limit: 12, outDir: tiedLive, effort: "low" });
  const backToMock = await refused(mock("tied-live-out"));
  check("in a live folder, a different model, a different effort and a mock run are each refused before any call, and the folder is left as it was", String(otherModel.error).includes("model: started with") && String(otherEffort.error).includes("effort: started with") && String(backToMock).includes('mode: started with "live"')
    && otherModel.log.length === 0 && otherEffort.log.length === 0 && (await snapshot(tiedLive)) === before, { otherModel: brief(otherModel), otherEffort: brief(otherEffort), backToMock });

  // The scorer lists every Claude CLI version seen, and refuses a folder whose invocations (or receipts) disagree on mode, model or effort,
  // such as one made before the driver tied a folder to its first settings.
  const tiedScoring = await scoreStage1({ runDir: tiedLive }).then((score) => ({ score, report: renderStage1(score) }), (error) => ({ error: String(error.message) }));
  check("the score report lists every Claude CLI version seen", tiedScoring.score?.mode === "live" && tiedScoring.score.requested_model === "claude-opus-5-5" && tiedScoring.score.effort === "high" && tiedScoring.score.cli_versions.length === 2
    && ["1.0.0-selfcheck (Claude Code)", "2.0.0-selfcheck (Claude Code)"].every((version) => tiedScoring.report.includes(version)), tiedScoring.error ?? { versions: tiedScoring.score.cli_versions });
  const mixedFolder = async (name, edit) => {
    const dir = folder(name);
    await fs.cp(tiedLive, dir, { recursive: true });
    await edit(dir);
    return refused(scoreStage1({ runDir: dir }));
  };
  const addInvocation = (change) => async (dir) => {
    const file = path.join(dir, "invocations.jsonl");
    const lines = (await fs.readFile(file, "utf8")).split("\n").filter(Boolean);
    await fs.writeFile(file, `${[...lines, JSON.stringify({ ...JSON.parse(lines[0]), ...change })].join("\n")}\n`);
  };
  const changeReceipt = (change) => async (dir) => {
    const file = path.join(dir, "receipts", (await names(path.join(dir, "receipts"))).find((name) => name.endsWith(".result.json")));
    await fs.writeFile(file, `${JSON.stringify({ ...JSON.parse(await fs.readFile(file, "utf8")), ...change }, null, 1)}\n`);
  };
  const mixes = [await mixedFolder("mixed-mode", addInvocation({ mode: "mock" })), await mixedFolder("mixed-model", addInvocation({ requested_model: "claude-sonnet-5-5" })),
    await mixedFolder("mixed-effort", addInvocation({ effort: "low" })), await mixedFolder("mixed-receipt", changeReceipt({ mode: "mock" }))];
  check("the scorer refuses a receipts folder whose invocations (or receipts) disagree on mode, model or effort", mixes.every((message) => message?.includes("different settings")), mixes);

  // Whatever the CLI listed, every call the live path made to the provider asked for sealed mode.
  const sealedArguments = liveRuns.flatMap((run) => run.sealedArguments);
  check("the live path always calls generate with sealed: true", sealedArguments.length > 0 && withFlag.sealedArguments.length === 1 && sealedArguments.every((value) => value === true), { calls: sealedArguments.length, values: [...new Set(sealedArguments)] });

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
