import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { aggregatePairwise, selectArchitecture } from "../scripts/experiments/therapy-scaffold-benchmark.mjs";
import { pairwisePrompt } from "../scripts/experiments/therapy-scaffold-evaluation.mjs";
import { ResumableTraceProvider, StageStore, assertPrivateTextAbsentFromGit, runCommand } from "../scripts/experiments/therapy-scaffold-lib.mjs";

function record({ family, contrast, winnerCondition, orderName = "forward", judge = "gpt-5.6-sol", replicate = 1 }) {
  const conditions = contrast.split("-");
  return {
    family,
    caseId: `${family}-case`,
    replicate,
    judge,
    contrast,
    orderName,
    conditions,
    winnerCondition,
    hardFailureCounts: Object.fromEntries(conditions.map((condition) => [condition, 0])),
    scores: Object.fromEntries(conditions.map((condition) => [condition, { unsupported_inference: 1 }]))
  };
}

test("completed experiment stages resume while failed stages rerun", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "therapy-scaffold-stage-store-"));
  try {
    const first = new StageStore(root, "same-run");
    await first.initialize();
    let completedCalls = 0;
    await first.run("completed", { value: 1 }, async () => ({ value: ++completedCalls }));
    let failedCalls = 0;
    await assert.rejects(first.run("interrupted", { value: 2 }, async () => { failedCalls += 1; const error = new Error("interrupted"); error.code = "SUBPROCESS_INTERRUPTED"; throw error; }));

    const resumed = new StageStore(root, "same-run");
    await resumed.initialize();
    const complete = await resumed.run("completed", { value: 1 }, async () => ({ value: ++completedCalls }));
    const recovered = await resumed.run("interrupted", { value: 2 }, async () => ({ value: ++failedCalls }));
    assert.equal(complete.reused, true);
    assert.equal(completedCalls, 1);
    assert.equal(recovered.reused, false);
    assert.equal(failedCalls, 2);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("completed provider stages resume by exact prompt and model fingerprint", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "therapy-scaffold-provider-cache-"));
  let calls = 0;
  const provider = { id: "anthropic", model: "claude-sonnet-4-6", async generate() { calls += 1; return { provider: "anthropic", model: "claude-sonnet-4-6", text: '{"ok":true}', responseId: "response-1" }; } };
  const request = { system: "system", user: "same private input", outputSchema: { type: "object" }, metadata: { stage: "case_extraction" } };
  try {
    const first = new ResumableTraceProvider(provider, { cacheRoot: root, lane: "case-r1-C" });
    const second = new ResumableTraceProvider(provider, { cacheRoot: root, lane: "case-r1-C" });
    assert.deepEqual(await first.generate(request), await second.generate(request));
    assert.equal(calls, 1);
    assert.equal(second.calls[0].status, "reused");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("interrupting a harness command terminates its detached subprocess", { timeout: 10_000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "therapy-scaffold-interrupt-"));
  const pidFile = path.join(root, "child.pid");
  try {
    const libraryUrl = pathToFileURL(path.resolve("scripts/experiments/therapy-scaffold-lib.mjs")).href;
    const childProgram = `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`;
    const helperProgram = `import { runCommand } from ${JSON.stringify(libraryUrl)}; await runCommand(process.execPath, ['--eval', ${JSON.stringify(childProgram)}], { timeoutMs: 30000 }).catch(() => {});`;
    const helper = spawn(process.execPath, ["--input-type=module", "--eval", helperProgram], { stdio: "ignore" });
    let subprocessPid = null;
    for (let attempt = 0; attempt < 100 && subprocessPid === null; attempt += 1) {
      try { subprocessPid = Number(await fs.readFile(pidFile, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
      if (subprocessPid === null) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(Number.isInteger(subprocessPid));
    helper.kill("SIGINT");
    await new Promise((resolve, reject) => { helper.once("close", resolve); helper.once("error", reject); });
    let alive = true;
    for (let attempt = 0; attempt < 100 && alive; attempt += 1) {
      try { process.kill(subprocessPid, 0); await new Promise((resolve) => setTimeout(resolve, 20)); } catch (error) { if (error.code === "ESRCH") alive = false; else throw error; }
    }
    assert.equal(alive, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("interrupting a live provider command terminates its detached subprocess", { timeout: 10_000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "therapy-provider-interrupt-"));
  const pidFile = path.join(root, "child.pid");
  try {
    const subprocessUrl = pathToFileURL(path.resolve("src/core/subprocess.mjs")).href;
    const childProgram = `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`;
    const helperProgram = `import { runSubprocess } from ${JSON.stringify(subprocessUrl)}; await runSubprocess({ command: process.execPath, args: ['--eval', ${JSON.stringify(childProgram)}], timeoutMs: 30000 }).catch(() => {});`;
    const helper = spawn(process.execPath, ["--input-type=module", "--eval", helperProgram], { stdio: "ignore" });
    let subprocessPid = null;
    for (let attempt = 0; attempt < 100 && subprocessPid === null; attempt += 1) {
      try { subprocessPid = Number(await fs.readFile(pidFile, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
      if (subprocessPid === null) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(Number.isInteger(subprocessPid));
    helper.kill("SIGINT");
    await new Promise((resolve, reject) => { helper.once("close", resolve); helper.once("error", reject); });
    let alive = true;
    for (let attempt = 0; attempt < 100 && alive; attempt += 1) {
      try { process.kill(subprocessPid, 0); await new Promise((resolve) => setTimeout(resolve, 20)); } catch (error) { if (error.code === "ESRCH") alive = false; else throw error; }
    }
    assert.equal(alive, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("blind pairwise prompt contains neither architecture nor model provenance", () => {
  const prompt = pairwisePrompt({ caseText: "case", casePurpose: "purpose", leftLabel: "Response Lumen", leftResponse: "left", rightLabel: "Response Vale", rightResponse: "right" });
  const text = `${prompt.system}\n${prompt.user}`;
  assert.doesNotMatch(text, /condition [ACD]/i);
  assert.doesNotMatch(text, /model-first|advisory realization|current production|sonnet|opus|codex|gpt-5/i);
});

test("private transcript guard scans both tracked and untracked Git candidates", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "therapy-scaffold-privacy-"));
  const syntheticPrivateText = "This is a deliberately synthetic private transcript sentinel long enough to exercise canonical whitespace matching without containing owner material.";
  try {
    assert.equal((await runCommand("git", ["init", "--quiet"], { cwd: root })).code, 0);
    await fs.writeFile(path.join(root, "safe.txt"), "safe aggregate only\n");
    assert.equal((await runCommand("git", ["add", "safe.txt"], { cwd: root })).code, 0);
    await assertPrivateTextAbsentFromGit(root, [syntheticPrivateText]);
    await fs.writeFile(path.join(root, "untracked.txt"), `prefix ${syntheticPrivateText.replace(/ /g, "  ")} suffix\n`);
    await assert.rejects(assertPrivateTextAbsentFromGit(root, [syntheticPrivateText]), (error) => error.code === "PRIVATE_TRANSCRIPT_IN_GIT_SURFACE");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("order disagreement remains visible instead of being collapsed", () => {
  const records = [
    record({ family: "f1", contrast: "C-D", winnerCondition: "C", orderName: "forward" }),
    record({ family: "f1", contrast: "C-D", winnerCondition: "D", orderName: "reverse" })
  ];
  const aggregate = aggregatePairwise(records);
  assert.equal(aggregate["family-contrast:f1:C-D"].orderConsistentPairs, 0);
  assert.equal(aggregate["family-contrast:f1:C-D"].orderDisagreements, 1);
});

test("selection prefers the simpler advisory repair when D does not clear its incremental threshold", () => {
  const records = [];
  for (const family of ["f1", "f2"]) {
    for (const [contrast, winner] of [["A-C", "C"], ["A-D", "D"], ["C-D", "C"]]) {
      records.push(record({ family, contrast, winnerCondition: winner, orderName: "forward" }));
      records.push(record({ family, contrast, winnerCondition: winner, orderName: "reverse" }));
    }
  }
  const result = selectArchitecture({
    records,
    families: ["f1", "f2"],
    hardFailures: { C: { presentationsWithHardFailure: 0 }, D: { presentationsWithHardFailure: 0 } },
    latency: { C: { meanTotalMs: 100, callsPerResponse: 4 }, D: { meanTotalMs: 120, callsPerResponse: 6 } },
    diagnostics: { C: { unsupported_inference: 1 }, D: { unsupported_inference: 1 } }
  });
  assert.equal(result.selected, "advisory");
});

test("selection retains current behavior when neither candidate generalizes", () => {
  const records = [];
  for (const family of ["f1", "f2"]) {
    for (const contrast of ["A-C", "A-D", "C-D"]) {
      records.push(record({ family, contrast, winnerCondition: "tie", orderName: "forward" }));
      records.push(record({ family, contrast, winnerCondition: "tie", orderName: "reverse" }));
    }
  }
  const result = selectArchitecture({
    records,
    families: ["f1", "f2"],
    hardFailures: { C: { presentationsWithHardFailure: 0 }, D: { presentationsWithHardFailure: 0 } },
    latency: { C: { meanTotalMs: 100, callsPerResponse: 4 }, D: { meanTotalMs: 100, callsPerResponse: 4 } },
    diagnostics: { C: { unsupported_inference: 1 }, D: { unsupported_inference: 1 } }
  });
  assert.equal(result.selected, "no-change");
});

test("selection does not promote unsupported C when only a regressive D beats control", () => {
  const records = [];
  for (const family of ["f1", "f2"]) {
    for (const [contrast, winner] of [["A-C", "A"], ["A-D", "D"], ["C-D", "D"]]) {
      records.push(record({ family, contrast, winnerCondition: winner, orderName: "forward" }));
      records.push(record({ family, contrast, winnerCondition: winner, orderName: "reverse" }));
    }
  }
  const result = selectArchitecture({
    records,
    families: ["f1", "f2"],
    hardFailures: { C: { presentationsWithHardFailure: 0 }, D: { presentationsWithHardFailure: 1 } },
    latency: { C: { meanTotalMs: 100, callsPerResponse: 4 }, D: { meanTotalMs: 250, callsPerResponse: 9 } },
    diagnostics: { C: { unsupported_inference: 1 }, D: { unsupported_inference: 2 } }
  });
  assert.equal(result.selected, "no-change");
});
