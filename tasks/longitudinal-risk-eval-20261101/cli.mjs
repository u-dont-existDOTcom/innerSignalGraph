#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// npm run eval:longitudinal-risk -- <command> [options]. See PROTOCOL.md. Exploratory; never a release gate. Run output always goes outside
// the repository.
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const USAGE = `Commands:
  stage0 [--out DIR] [--only A1/main,A3/control] [--settings off,on] [--no-probes]   run stage 0 end to end and score it (no model call)
  stage0-pass --setting off|on --out DIR [--only ...] [--no-probes]                   one pass under one setting (stage0 starts one per setting)
  score --run DIR                                                                      score a stage 0 run folder again
  stage1-seal --from DIR --out DIR                                                     seal the 48 stage 1 packets from a stage 0 run (no model call)
  stage1-sizes --sealed DIR                                                            recompute the sizes of what will be sent from the sealed bytes
  stage1-audit --sealed DIR --out DIR --mock | --live [--limit N] [--concurrency 1-3]  send the sealed prompts to the auditor; 144 calls at most (--live needs the opt-in below)
  stage1-score --run DIR                                                               score a stage 1 receipts folder
  stage1-selfcheck --sealed DIR [--work DIR]                                           check the driver's guards with the scripted stand-in (no model call)
Live runs also need INNER_SIGNAL_EVAL_ALLOW_SUBSCRIPTION_CLI=1 and the Claude CLI signed in to the subscription that is meant to pay for them.`;

function parse(argv) {
  const options = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) { options._.push(arg); continue; }
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) options[key] = true;
    else { options[key] = next; index += 1; }
  }
  return options;
}

export function defaultRunRoot() {
  return process.env.INNER_SIGNAL_EVAL_RUNS ?? path.join(os.homedir(), "inner-signal-eval-runs");
}

export function assertOutsideRepository(dir) {
  const resolved = path.resolve(dir);
  if (resolved === repoRoot || resolved.startsWith(`${repoRoot}${path.sep}`)) throw new Error(`Run output must stay outside the repository (${resolved}).`);
  return resolved;
}

const stamp = () => new Date().toISOString().replace(/[-:]/gu, "").replace(/\.\d+Z$/u, "Z");
const list = (value) => (typeof value === "string" ? value.split(",").map((item) => item.trim()).filter(Boolean) : null);

function child(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [fileURLToPath(import.meta.url), ...args], { stdio: ["ignore", "inherit", "inherit"] });
    proc.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`pass failed with exit ${code}`))));
  });
}

async function main() {
  const options = parse(process.argv.slice(2));
  const command = options._[0];
  if (!command || options.help) { console.log(USAGE); return; }

  if (command === "stage0-pass") {
    const { runPass } = await import("./arc-runner.mjs");
    const out = assertOutsideRepository(options.out);
    await runPass({ setting: options.setting, outDir: out, only: list(options.only), probes: options["no-probes"] !== true, log: (line) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${line}`) });
    return;
  }

  if (command === "stage0") {
    const started = Date.now();
    const out = assertOutsideRepository(options.out ?? path.join(defaultRunRoot(), `stage0-${stamp()}`));
    await fs.mkdir(out, { recursive: true });
    const settings = list(options.settings) ?? ["off", "on"];
    const passArgs = (setting) => ["stage0-pass", "--setting", setting, "--out", out, ...(options.only ? ["--only", options.only] : []), ...(options["no-probes"] ? ["--no-probes"] : [])];
    console.log(`stage 0 run folder: ${out}`);
    await Promise.all(settings.map((setting) => child(passArgs(setting))));
    const { runImmediateProtection } = await import("./immediate-protection.mjs");
    await fs.writeFile(path.join(out, "immediate-protection.json"), `${JSON.stringify(await runImmediateProtection(), null, 1)}\n`);
    const seconds = Math.round((Date.now() - started) / 1000);
    const sha = async (url) => createHash("sha256").update(await fs.readFile(url)).digest("hex");
    const head = (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim(); } catch { return null; } })();
    await fs.writeFile(path.join(out, "run.json"), `${JSON.stringify({ command: process.argv.slice(2), settings, node: process.version, git_head: head, corpus_sha256: await sha(new URL("./corpus/longitudinal-risk-arcs.json", import.meta.url)), seeds_sha256: await sha(new URL("./corpus/stage1-seeds.json", import.meta.url)), seconds, finished_at: new Date().toISOString() }, null, 1)}\n`);
    await scoreAndPrint(out, seconds);
    return;
  }

  if (command === "score") {
    const run = assertOutsideRepository(options.run);
    const seconds = await fs.readFile(path.join(run, "run.json"), "utf8").then((text) => JSON.parse(text).seconds ?? null, () => null);
    await scoreAndPrint(run, seconds);
    return;
  }

  if (command === "stage1-seal") {
    const { sealStage1 } = await import("./stage1-seal.mjs");
    const summary = await sealStage1({ fromDir: assertOutsideRepository(options.from), outDir: assertOutsideRepository(options.out) });
    console.log(JSON.stringify(summary, null, 1));
    return;
  }

  if (command === "stage1-sizes") {
    const { sealedSizes } = await import("./stage1-audit.mjs");
    console.log(JSON.stringify(await sealedSizes(assertOutsideRepository(options.sealed)), null, 1));
    return;
  }

  if (command === "stage1-audit") {
    if (options.live && options.mock) throw new Error("Choose --mock or --live, not both.");
    const { runStage1Audit } = await import("./stage1-audit.mjs");
    const summary = await runStage1Audit({
      sealedDir: assertOutsideRepository(options.sealed),
      outDir: assertOutsideRepository(options.out),
      mode: options.live ? "live" : options.mock ? "mock" : null,
      limit: options.limit === undefined ? null : Number(options.limit),
      concurrency: options.concurrency === undefined ? 1 : Number(options.concurrency),
      model: typeof options.model === "string" ? options.model : "claude-opus-5-5",
      effort: typeof options.effort === "string" ? options.effort : "high",
      onProgress: (event) => console.error(`[${new Date().toISOString().slice(11, 19)}] ${event.call} ${event.outcome}${event.blocked == null ? "" : event.blocked ? " (blocked)" : " (passed)"} ${Math.round((event.ms ?? 0) / 1000)} s; ${event.counted} counted${event.stop ? `; stopping: ${event.stop}` : ""}`)
    });
    console.log(JSON.stringify(summary, null, 1));
    return;
  }

  if (command === "stage1-selfcheck") {
    const { runGuardSelfCheck } = await import("./guard-selfcheck.mjs");
    const report = await runGuardSelfCheck({ sealedDir: assertOutsideRepository(options.sealed), workDir: assertOutsideRepository(options.work ?? path.join(os.tmpdir(), `inner-signal-guard-selfcheck-${stamp()}`)) });
    for (const row of report.rows) console.log(`${row.ok ? "PASS" : "FAIL"} ${row.name}${row.ok || row.detail == null ? "" : `\n     ${JSON.stringify(row.detail)}`}`);
    console.log(`${report.passed} passed, ${report.failed} failed`);
    if (report.failed) process.exitCode = 1;
    return;
  }

  if (command === "stage1-score") {
    const { scoreStage1, renderStage1 } = await import("./stage1-score.mjs");
    const run = assertOutsideRepository(options.run);
    const score = await scoreStage1({ runDir: run });
    const report = renderStage1(score);
    await fs.writeFile(path.join(run, "score.json"), `${JSON.stringify(score, null, 1)}\n`);
    await fs.writeFile(path.join(run, "report.txt"), `${report}\n`);
    console.log(report);
    return;
  }

  console.error(USAGE);
  process.exitCode = 2;
}

async function scoreAndPrint(runDir, seconds = null) {
  const { scoreRun, renderTable } = await import("./stage0-scorer.mjs");
  const score = await scoreRun({ runDir, root: repoRoot });
  await fs.writeFile(path.join(runDir, "score.json"), `${JSON.stringify(score, null, 1)}\n`);
  const fails = score.findings.filter((finding) => finding.severity === "FAIL");
  const lines = [renderTable(score), "", `caps (off): ${JSON.stringify(score.caps.off?.checks)}`, `caps (on):  ${JSON.stringify(score.caps.on?.checks)}`,
    `immediate protection: ${score.protection ? `${score.protection.rows - score.protection.failed} of ${score.protection.rows} rows pass` : "not run"}`, "",
    `findings: ${fails.length} FAIL, ${score.findings.length - fails.length} INFO${seconds == null ? "" : `; run time ${Math.floor(seconds / 60)} min ${seconds % 60} s`}`,
    ...score.findings.map((finding) => `${finding.severity} [${finding.kind}] ${finding.arc ?? ""}${finding.arm ? `/${finding.arm}` : ""}${finding.turn != null ? ` turn ${finding.turn}` : ""} (${finding.setting ?? ""}, layer ${finding.layer}): ${finding.summary} @ ${finding.where}`)];
  await fs.writeFile(path.join(runDir, "report.txt"), `${lines.join("\n")}\n`);
  console.log(lines.join("\n"));
}

main().catch((error) => { console.error(error.stack ?? error); process.exitCode = 1; });
