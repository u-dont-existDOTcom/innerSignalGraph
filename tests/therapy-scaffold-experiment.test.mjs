import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { aggregatePairwise, probeCapabilityFingerprint, selectArchitecture, validateExactModelProbe } from "../scripts/experiments/therapy-scaffold-benchmark.mjs";
import { pairwisePrompt } from "../scripts/experiments/therapy-scaffold-evaluation.mjs";
import { ResumableTraceProvider, StageStore, assertPrivateTextAbsentFromGit, mapWithConcurrency, runCommand } from "../scripts/experiments/therapy-scaffold-lib.mjs";
import { runSemanticFormulation } from "../src/orchestrator/model-first-scaffold.mjs";

function record({ family, contrast, winnerCondition, rawWinnerCondition = winnerCondition, orderName = "forward", judge = "gpt-5.6-sol", replicate = 1, evidenceClass = "SYNTHETIC_ENGINEERING" }) {
  const conditions = contrast.split("-");
  return {
    family,
    evidenceClass,
    caseId: `${family}-case`,
    replicate,
    judge,
    contrast,
    orderName,
    conditions,
    winnerCondition,
    rawWinnerCondition,
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

test("exact-model probes fail closed on an absent or mismatched returned selector", () => {
  assert.throws(() => validateExactModelProbe({ ok: true, returnedModel: null }, "claude-opus-5"), /no model selector/);
  assert.throws(() => validateExactModelProbe({ ok: true, returnedModel: "claude-sonnet-4-6" }, "claude-opus-5"), /requested claude-opus-5, returned claude-sonnet-4-6/);
  assert.equal(validateExactModelProbe({ ok: true, returnedModel: "claude-opus-5" }, "claude-opus-5").returnedModel, "claude-opus-5");
});

test("valid exact-model probes remain reusable when only capability-probe duration changes", () => {
  const environment = (durationMs) => ({ capabilities: {
    claudeVersion: { exitCode: 0, durationMs, stdoutSha256: "version-out", stderrSha256: "empty", firstLine: "2.1.241 (Claude Code)" },
    claudeHelp: { exitCode: 0, durationMs: durationMs + 1, stdoutSha256: "help-out", stderrSha256: "empty", firstLine: "Usage: claude" }
  } });
  assert.equal(probeCapabilityFingerprint(environment(10), "renderer"), probeCapabilityFingerprint(environment(10_000), "renderer"));
});

test("structured-output failures invalidate the provider cache and rerun the failed exact stage", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "therapy-scaffold-structured-retry-"));
  let calls = 0;
  const valid = {
    direct_observations: ["observation"],
    important_relationships: ["relationship"],
    central_live_knot: "live knot",
    potentially_useful_implications: ["implication"],
    unresolved_alternatives: ["alternative"],
    uncertainty: ["uncertainty"],
    proportionate_next_move: "next move"
  };
  const provider = { id: "anthropic", model: "claude-sonnet-4-6", async generate() { calls += 1; return { provider: "anthropic", model: "claude-sonnet-4-6", text: calls === 1 ? "not json" : JSON.stringify(valid), responseId: `response-${calls}` }; } };
  const context = { userMessage: "synthetic input", recentTranscript: "", userFacts: [], guideExcerpts: "synthetic guide" };
  try {
    const first = new ResumableTraceProvider(provider, { cacheRoot: root, lane: "structured" });
    await assert.rejects(runSemanticFormulation({ context, provider: first }), /valid JSON/);
    const second = new ResumableTraceProvider(provider, { cacheRoot: root, lane: "structured" });
    const recovered = await runSemanticFormulation({ context, provider: second });
    assert.equal(recovered.value.central_live_knot, "live knot");
    assert.equal(calls, 2);
    assert.equal(second.calls[0].status, "complete");
    assert.equal(second.calls[0].priorFailureCount, 1);
    assert.deepEqual(second.calls[0].priorFailures.map((item) => item.code), ["STRUCTURED_OUTPUT_INVALID"]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("a concurrent-stage failure waits for active peers and starts no new work", async () => {
  const started = [];
  const beganAt = Date.now();
  await assert.rejects(mapWithConcurrency(["fail", "active-peer", "must-not-start"], 2, async (value) => {
    started.push(value);
    if (value === "fail") { await new Promise((resolve) => setTimeout(resolve, 10)); throw new Error("expected failure"); }
    await new Promise((resolve) => setTimeout(resolve, 60));
    return value;
  }));
  assert.ok(Date.now() - beganAt >= 50);
  assert.deepEqual(started.sort(), ["active-peer", "fail"]);
});

test("interrupting a harness command terminates its detached subprocess", { timeout: 10_000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "therapy-scaffold-interrupt-"));
  const pidFile = path.join(root, "child.pid");
  const grandchildPidFile = path.join(root, "grandchild.pid");
  try {
    const libraryUrl = pathToFileURL(path.resolve("scripts/experiments/therapy-scaffold-lib.mjs")).href;
    const grandchildProgram = `process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(${JSON.stringify(grandchildPidFile)}, String(process.pid)); setInterval(() => {}, 1000);`;
    const childProgram = `process.on('SIGTERM', () => {}); const {spawn}=require('node:child_process'); spawn(process.execPath, ['--eval', ${JSON.stringify(grandchildProgram)}], {stdio:'ignore'}); require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`;
    const helperProgram = `import { runCommand } from ${JSON.stringify(libraryUrl)}; await runCommand(process.execPath, ['--eval', ${JSON.stringify(childProgram)}], { timeoutMs: 30000 }).catch(() => {});`;
    const helper = spawn(process.execPath, ["--input-type=module", "--eval", helperProgram], { stdio: "ignore" });
    let subprocessPid = null;
    let grandchildPid = null;
    for (let attempt = 0; attempt < 150 && (subprocessPid === null || grandchildPid === null); attempt += 1) {
      try { subprocessPid = Number(await fs.readFile(pidFile, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
      try { grandchildPid = Number(await fs.readFile(grandchildPidFile, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
      if (subprocessPid === null || grandchildPid === null) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(Number.isInteger(subprocessPid));
    assert.ok(Number.isInteger(grandchildPid));
    helper.kill("SIGINT");
    await new Promise((resolve, reject) => { helper.once("close", resolve); helper.once("error", reject); });
    for (const pid of [subprocessPid, grandchildPid]) {
      let alive = true;
      for (let attempt = 0; attempt < 150 && alive; attempt += 1) {
        try { process.kill(pid, 0); await new Promise((resolve) => setTimeout(resolve, 20)); } catch (error) { if (error.code === "ESRCH") alive = false; else throw error; }
      }
      assert.equal(alive, false);
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("benchmark provider supervisor kills resistant child and grandchild when the benchmark parent exits", { timeout: 15_000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "therapy-provider-supervisor-"));
  const pidFile = path.join(root, "child.pid");
  const grandchildPidFile = path.join(root, "grandchild.pid");
  let parent;
  let supervisor;
  try {
    parent = spawn(process.execPath, ["--eval", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    const grandchildProgram = `process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(${JSON.stringify(grandchildPidFile)}, String(process.pid)); setInterval(() => {}, 1000);`;
    const childProgram = `process.on('SIGTERM', () => {}); const {spawn}=require('node:child_process'); spawn(process.execPath, ['--eval', ${JSON.stringify(grandchildProgram)}], {stdio:'ignore'}); require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`;
    supervisor = spawn(process.execPath, [path.resolve("scripts/experiments/therapy-scaffold-provider-supervisor.mjs"), String(parent.pid), process.execPath, "--eval", childProgram], { stdio: "ignore", detached: true });
    let subprocessPid = null;
    let grandchildPid = null;
    for (let attempt = 0; attempt < 150 && (subprocessPid === null || grandchildPid === null); attempt += 1) {
      try { subprocessPid = Number(await fs.readFile(pidFile, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
      try { grandchildPid = Number(await fs.readFile(grandchildPidFile, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
      if (subprocessPid === null || grandchildPid === null) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(Number.isInteger(subprocessPid));
    assert.ok(Number.isInteger(grandchildPid));
    parent.kill("SIGKILL");
    await new Promise((resolve, reject) => { supervisor.once("close", resolve); supervisor.once("error", reject); });
    for (const pid of [subprocessPid, grandchildPid]) {
      let alive = true;
      for (let attempt = 0; attempt < 150 && alive; attempt += 1) {
        try { process.kill(pid, 0); await new Promise((resolve) => setTimeout(resolve, 20)); } catch (error) { if (error.code === "ESRCH") alive = false; else throw error; }
      }
      assert.equal(alive, false);
    }
  } finally {
    try { parent?.kill("SIGKILL"); } catch { /* already gone */ }
    try { supervisor?.kill("SIGKILL"); } catch { /* already gone */ }
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
    const leakedWindow = syntheticPrivateText.split(" ").slice(0, 16).join("  ");
    await fs.writeFile(path.join(root, "untracked.txt"), `prefix ${leakedWindow} suffix\n`);
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

test("raw winners, hard-failure-adjusted winners, judge disagreement, and order agreement remain separate", () => {
  const records = [
    record({ family: "observed", evidenceClass: "OBSERVED_OWNER", contrast: "A-C", judge: "gpt-5.6-sol", orderName: "forward", rawWinnerCondition: "C", winnerCondition: "A" }),
    record({ family: "observed", evidenceClass: "OBSERVED_OWNER", contrast: "A-C", judge: "gpt-5.6-sol", orderName: "reverse", rawWinnerCondition: "C", winnerCondition: "A" }),
    record({ family: "observed", evidenceClass: "OBSERVED_OWNER", contrast: "A-C", judge: "claude-opus-5", orderName: "forward", rawWinnerCondition: "C", winnerCondition: "C" }),
    record({ family: "observed", evidenceClass: "OBSERVED_OWNER", contrast: "A-C", judge: "claude-opus-5", orderName: "reverse", rawWinnerCondition: "C", winnerCondition: "C" })
  ];
  const adjusted = aggregatePairwise(records);
  const raw = aggregatePairwise(records.map((item) => ({ ...item, winnerCondition: item.rawWinnerCondition })));
  assert.deepEqual(adjusted["contrast:A-C"].wins, { A: 2, C: 2 });
  assert.deepEqual(raw["contrast:A-C"].wins, { C: 4 });
  assert.equal(adjusted["contrast:A-C"].orderConsistentPairs, 2);
  assert.equal(adjusted["contrast:A-C"].orderDisagreements, 0);
  assert.equal(adjusted["contrast:A-C"].judgeDisagreements, 2);
});

test("selection prefers the simpler advisory repair when D does not clear its incremental threshold", () => {
  const records = [];
  for (const family of ["f1", "f2"]) {
    for (const [contrast, winner] of [["A-C", "C"], ["A-D", "D"], ["C-D", "C"]]) {
      const evidenceClass = family === "f1" ? "OBSERVED_OWNER" : "SYNTHETIC_ENGINEERING";
      records.push(record({ family, evidenceClass, contrast, winnerCondition: winner, orderName: "forward" }));
      records.push(record({ family, evidenceClass, contrast, winnerCondition: winner, orderName: "reverse" }));
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

test("selection admits D only with observed non-regression, two incremental engineering families, and preserved roles", () => {
  const records = [];
  const families = [
    ["observed", "OBSERVED_OWNER"],
    ["counterfactual", "COUNTERFACTUAL_OWNER"],
    ["synthetic", "SYNTHETIC_ENGINEERING"]
  ];
  for (const [family, evidenceClass] of families) {
    const winners = family === "observed"
      ? [["A-C", "C"], ["A-D", "D"], ["C-D", "D"]]
      : [["A-C", "C"], ["A-D", "D"], ["C-D", "D"]];
    for (const [contrast, winner] of winners) {
      records.push(record({ family, evidenceClass, contrast, winnerCondition: winner, orderName: "forward" }));
      records.push(record({ family, evidenceClass, contrast, winnerCondition: winner, orderName: "reverse" }));
    }
  }
  const input = {
    records,
    families: families.map(([family]) => family),
    hardFailures: { C: { presentationsWithHardFailure: 0 }, D: { presentationsWithHardFailure: 0 } },
    latency: { C: { meanTotalMs: 100, callsPerResponse: 4 }, D: { meanTotalMs: 150, callsPerResponse: 7 } },
    diagnostics: { C: { unsupported_inference: 1 }, D: { unsupported_inference: 1 } },
    routingSafety: { pass: true }
  };
  assert.equal(selectArchitecture({ ...input, rolePreservation: { deep: true, forensic: true, renderer: true } }).selected, "model-first");
  assert.equal(selectArchitecture({ ...input, rolePreservation: { deep: false, forensic: true, renderer: true } }).selected, "advisory");
});

test("selection rejects D when observed A001 regresses despite synthetic wins", () => {
  const records = [];
  for (const [family, evidenceClass] of [["observed", "OBSERVED_OWNER"], ["synthetic-one", "SYNTHETIC_ENGINEERING"], ["synthetic-two", "SYNTHETIC_ENGINEERING"]]) {
    const winners = family === "observed"
      ? [["A-C", "C"], ["A-D", "A"], ["C-D", "C"]]
      : [["A-C", "C"], ["A-D", "D"], ["C-D", "D"]];
    for (const [contrast, winner] of winners) {
      records.push(record({ family, evidenceClass, contrast, winnerCondition: winner, orderName: "forward" }));
      records.push(record({ family, evidenceClass, contrast, winnerCondition: winner, orderName: "reverse" }));
    }
  }
  const result = selectArchitecture({
    records,
    hardFailures: { C: { presentationsWithHardFailure: 0 }, D: { presentationsWithHardFailure: 0 } },
    latency: { C: { meanTotalMs: 100, callsPerResponse: 4 }, D: { meanTotalMs: 150, callsPerResponse: 7 } },
    diagnostics: { C: { unsupported_inference: 1 }, D: { unsupported_inference: 1 } },
    rolePreservation: { deep: true, forensic: true, renderer: true },
    routingSafety: { pass: true }
  });
  assert.equal(result.selected, "advisory");
  assert.equal(result.checks.dObservedNonRegression, false);
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

test("synthetic-only wins cannot be called observed or real-world generalization", () => {
  const records = [];
  for (const family of ["synthetic-one", "synthetic-two"]) {
    for (const [contrast, winner] of [["A-C", "C"], ["A-D", "D"], ["C-D", "C"]]) {
      records.push(record({ family, contrast, winnerCondition: winner, orderName: "forward" }));
      records.push(record({ family, contrast, winnerCondition: winner, orderName: "reverse" }));
    }
  }
  const result = selectArchitecture({
    records,
    families: ["synthetic-one", "synthetic-two"],
    hardFailures: { C: { presentationsWithHardFailure: 0 }, D: { presentationsWithHardFailure: 0 } },
    latency: { C: { meanTotalMs: 100, callsPerResponse: 4 }, D: { meanTotalMs: 120, callsPerResponse: 6 } },
    diagnostics: { C: { unsupported_inference: 1 }, D: { unsupported_inference: 1 } }
  });
  assert.equal(result.selected, "no-change");
  assert.equal(result.evidenceBoundary.observedOwnerFamilyCount, 0);
  assert.equal(result.evidenceBoundary.realWorldGeneralizationEstablished, false);
  assert.doesNotMatch(result.reason, /real-world generalization (?:was|is) established|observed-user generalization (?:was|is) established|generalized beyond control/i);
  assert.match(result.reason, /cannot be established/i);
});

test("CLI and general environment examples expose the same unchanged scaffold default", async () => {
  const [general, cli] = await Promise.all([
    fs.readFile(path.resolve(".env.example"), "utf8"),
    fs.readFile(path.resolve(".env.cli.example"), "utf8")
  ]);
  for (const content of [general, cli]) assert.match(content, /^THERAPY_SCAFFOLD_MODE=current$/m);
});
