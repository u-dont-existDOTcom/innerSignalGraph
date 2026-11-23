import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { seal, emptyReview } from "../tasks/response-evidence-eval-20261123/seal.mjs";
import { loadSealed, selfcheck } from "../tasks/response-evidence-eval-20261123/selfcheck.mjs";
import { buildSchedule, executeAudit, MockAuditor, runAudit } from "../tasks/response-evidence-eval-20261123/audit.mjs";
import { score, judge } from "../tasks/response-evidence-eval-20261123/score.mjs";
import { CORPORA, CORPUS, CORPUS_SHA256, OPT_IN_ENV, ROOT, isolation, json, sha256 } from "../tasks/response-evidence-eval-20261123/common.mjs";
import { privateRuntimeAuditPrompt } from "../src/prompts/private-runtime-audit.mjs";
import { sha256Json } from "../src/supervisor/response-evidence-contract.mjs";
import { main } from "../tasks/response-evidence-eval-20261123/cli.mjs";

let root, sealedDir, sealed, sealedSummary, holdoutDir, holdoutSealed, holdoutSummary;
before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "response-evidence-eval-test-"));
  await fs.chmod(root, 0o700);
  sealedDir = path.join(root, "sealed");
  sealedSummary = await seal({ outDir: sealedDir });
  console.log(`Sealed all ${sealedSummary.cases} cases (${sealedSummary.packets} packets) in ${sealedSummary.seconds.toFixed(3)} seconds.`);
  sealed = await loadSealed(sealedDir);
  holdoutDir = path.join(root, "holdout-sealed");
  holdoutSummary = await seal({ outDir: holdoutDir, corpus: "holdout" });
  holdoutSealed = await loadSealed(holdoutDir);
});
after(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); });

const item = (id, arm = "E") => sealed.byId.get(`${id}.${arm}`);
const source = (id, kind) => item(id).packet.response_evidence.source_items.filter((s) => s.kind === kind);
const run = (name, options = {}) => runAudit({ sealedDir, outDir: path.join(root, name), mode: "mock", ...options });
const results = async (name) => {
  const dir = path.join(root, name, "receipts");
  return Promise.all((await fs.readdir(dir)).filter((n) => n.endsWith(".result.json")).map(async (n) => JSON.parse(await fs.readFile(path.join(dir, n)))));
};

test("all frozen cases seal through the real runtime; G uses the unchanged no-evidence prompt", async () => {
  assert.equal(sealedSummary.cases, 36); assert.equal(sealedSummary.packets, 72);
  assert.equal(sha256(await fs.readFile(CORPUS)), CORPUS_SHA256);
  assert.equal(sealed.manifest.corpus_name, "main");
  assert.equal(sealed.manifest.corpus_sha256, CORPORA.main.sha256);
  assert.equal(sealed.manifest.corpus_commit, "4b543a87a");
  const corpus = JSON.parse(await fs.readFile(CORPUS));
  for (const spec of corpus.cases) {
    for (const arm of ["G", "E"]) {
      const captured = item(spec.id, arm);
      assert.equal(captured.packet.candidate_response, spec.candidate);
      assert.deepEqual(captured.packet.recent_verbatim.turns.map((t) => t.text), spec.history.filter((s) => ["client", "delivered_reply"].includes(s.step)).map((s) => s.text));
      assert.equal(captured.packet.recent_verbatim.episode_completeness.complete, true);
      if (arm === "G") {
        assert.equal(captured.packet.response_evidence, undefined);
        assert.equal(captured.prompt.system.includes("RESPONSE EVIDENCE REVIEW"), false);
        const noEvidence = structuredClone(captured.packet); delete noEvidence.response_evidence;
        assert.deepEqual(captured.prompt, privateRuntimeAuditPrompt(noEvidence));
        // As today: no journal_evidence slot at all when no journal is configured.
        if (spec.journal?.availability === "not_configured") assert.equal(captured.packet.journal_evidence, undefined);
        else if (spec.journal) assert.deepEqual(captured.packet.journal_evidence, { schema_version: 1, availability: spec.journal.availability, retrieval_status: spec.journal.retrieval_status,
          coverage: spec.journal.coverage, more_available: spec.journal.more_available, excerpts: spec.journal.items });
      } else {
        assert.ok(captured.prompt.system.includes("RESPONSE EVIDENCE REVIEW"));
        assert.ok(Object.values(captured.packet.disclosure_manifest).every((flag) => typeof flag === "boolean"));
        assert.equal(captured.packet.response_evidence.snapshot_sha256, captured.snapshot.snapshot_sha256);
      }
    }
  }
  assert.equal((await fs.stat(sealedDir)).mode & 0o777, 0o700);
  await assert.rejects(seal({ outDir: sealedDir }), /exist/i);
});

test("every held-out case seals in both arms with the exact sources, candidate and corpus identity", async () => {
  assert.equal(holdoutSummary.cases, 16); assert.equal(holdoutSummary.packets, 32);
  assert.equal(holdoutSealed.manifest.corpus_name, "holdout");
  assert.equal(holdoutSealed.manifest.corpus_sha256, CORPORA.holdout.sha256);
  assert.equal(holdoutSealed.manifest.corpus_file.sha256, CORPORA.holdout.sha256);
  assert.equal(holdoutSealed.manifest.corpus_commit, null); // no containing commit invented before Claude commits it
  assert.equal(sha256(await fs.readFile(CORPORA.holdout.file)), CORPORA.holdout.sha256);
  const corpus = JSON.parse(await fs.readFile(CORPORA.holdout.file));
  assert.equal(corpus.cases.filter((c) => c.language === "fr").length, 4);
  const pairs = new Map();
  for (const spec of corpus.cases) {
    const pair = pairs.get(spec.pair) ?? []; pair.push(spec); pairs.set(spec.pair, pair);
    assert.ok(spec.history.filter((s) => s.step === "client").length >= 2);
    assert.ok(spec.history.some((s) => s.step === "delivered_reply"));
    for (const arm of ["G", "E"]) {
      const captured = holdoutSealed.byId.get(`${spec.id}.${arm}`);
      assert.ok(captured);
      assert.equal(captured.packet.candidate_response, spec.candidate);
      assert.deepEqual(captured.packet.recent_verbatim.turns.map((t) => t.text),
        spec.history.filter((s) => ["client", "delivered_reply"].includes(s.step)).map((s) => s.text));
      assert.equal(captured.packet.recent_verbatim.episode_completeness.complete, true);
      if (arm === "G") {
        assert.equal(captured.packet.response_evidence, undefined);
        assert.deepEqual(captured.prompt, privateRuntimeAuditPrompt(captured.packet));
        if (spec.journal) assert.deepEqual(captured.packet.journal_evidence.excerpts, spec.journal.items);
      } else {
        assert.ok(captured.prompt.system.includes("RESPONSE EVIDENCE REVIEW"));
        assert.ok(Object.values(captured.packet.disclosure_manifest).every((flag) => typeof flag === "boolean"));
        assert.equal(captured.packet.response_evidence.snapshot_sha256, captured.snapshot.snapshot_sha256);
        assert.deepEqual(captured.packet.response_evidence.source_items.filter((s) => s.kind === "journal_quotation").map((s) => s.exact_excerpt),
          spec.journal?.items.map((s) => s.text) ?? []);
      }
    }
  }
  assert.equal(pairs.size, 8);
  for (const pair of pairs.values()) {
    assert.equal(pair.length, 2);
    assert.deepEqual(pair.map((c) => [c.role, c.expected]), [["planted", "block"], ["control_same_sources", "pass"]]);
    assert.deepEqual(pair[0].history, pair[1].history); assert.deepEqual(pair[0].journal, pair[1].journal);
  }
  assert.ok(holdoutSealed.byId.get("H1-en-planted.E").packet.response_evidence.source_items.some((s) => s.kind === "agent_relayed_report"));
  assert.equal((await selfcheck({ sealedDir: holdoutDir })).packets, 32);
});

test("seal refuses one changed holdout byte before creating an output folder", async () => {
  // Copy only the harness entry points, with a symlink to the real runtime imports.
  // The production corpus is never modified, even transiently. Final JSON whitespace is
  // changed to other valid whitespace so the refusal must be the frozen-byte guard.
  const fixture = path.join(root, "changed-holdout"), taskPath = "tasks/response-evidence-eval-20261123";
  const fixtureTask = path.join(fixture, taskPath);
  await fs.mkdir(path.join(fixtureTask, "corpus"), { recursive: true, mode: 0o700 });
  await fs.symlink(path.join(ROOT, "src"), path.join(fixture, "src"), "dir");
  for (const file of ["common.mjs", "seal.mjs"]) await fs.copyFile(path.join(ROOT, taskPath, file), path.join(fixtureTask, file));
  const changed = await fs.readFile(CORPORA.holdout.file);
  assert.equal(changed.at(-1), 0x0a); changed[changed.length - 1] = 0x20;
  await fs.writeFile(path.join(fixtureTask, "corpus", "holdout-cases.json"), changed);
  const fixtureSeal = await import(pathToFileURL(path.join(fixtureTask, "seal.mjs")).href);
  const refusedOut = path.join(root, "never-sealed-changed-holdout");
  await assert.rejects(fixtureSeal.seal({ outDir: refusedOut, corpus: "holdout" }), /frozen holdout corpus bytes differ/);
  await assert.rejects(fs.stat(refusedOut), { code: "ENOENT" });
  assert.equal(sha256(await fs.readFile(CORPORA.holdout.file)), CORPORA.holdout.sha256);
});

test("holdout mock audit, scorer and schedule retain both arms and all eight matched labels", async () => {
  const schedule = buildSchedule(holdoutSealed.manifest, 2);
  assert.equal(schedule.length, 64);
  assert.equal(new Set(schedule.map((s) => s.call)).size, 64);
  assert.ok(schedule.slice(0, 32).every((s) => s.sample === 1));
  assert.ok(schedule.every((s, i) => s.packet.endsWith(i % 2 ? ".E" : ".G")));
  const runDir = path.join(root, "holdout-mock");
  const summary = await runAudit({ sealedDir: holdoutDir, outDir: runDir, mode: "mock", samples: 1, concurrency: 3 });
  assert.equal(summary.started_now, 32); assert.equal(summary.this_run.ok, 32);
  const scored = await score({ runDir });
  assert.equal(scored.corpus_name, "holdout"); assert.equal(scored.corpus_sha256, CORPORA.holdout.sha256);
  assert.equal(scored.cases.length, 16);
  for (const arm of ["G", "E"]) {
    assert.equal(scored.by_arm[arm].verdicts, 16); assert.equal(scored.by_arm[arm].false_approvals, 8);
    assert.equal(scored.by_arm[arm].unnecessary_blocks, 0); assert.equal(scored.by_arm[arm].malformed, 0);
  }
});

test("selfcheck refuses a holdout manifest relabeled as main even when its manifest is rehashed", async () => {
  const manifestPath = path.join(holdoutDir, "manifest.json"), hashPath = path.join(holdoutDir, "manifest.sha256");
  const manifestBytes = await fs.readFile(manifestPath), manifestHash = await fs.readFile(hashPath);
  try {
    const changed = JSON.parse(manifestBytes); changed.corpus_name = "main";
    const bytes = json(changed);
    await fs.writeFile(manifestPath, bytes); await fs.writeFile(hashPath, `${sha256(bytes)}\n`);
    await assert.rejects(selfcheck({ sealedDir: holdoutDir }), /Invalid response-evidence sealed manifest/);
  } finally { await fs.writeFile(manifestPath, manifestBytes); await fs.writeFile(hashPath, manifestHash); }
});

test("frozen provenance distinguishes unsent, exported, app-committed, reported, owner instruction and journal sources", () => {
  const corpus = JSON.parse(sealed.manifestBytes); // labels are sealed; exact texts below come from the packets
  assert.equal(corpus.cases.length, 36);
  for (const lang of ["en", "fr"]) {
    const planted = `P1-${lang}-planted`, control = `P1-${lang}-control-candidate`;
    const draft = source(planted, "unsent_draft").find((s) => /notebook|carnet/u.test(s.exact_excerpt));
    assert.ok(draft);
    assert.equal(source(planted, "app_committed_client_outbound").some((s) => s.exact_excerpt === draft.exact_excerpt), false);
    assert.ok(source(control, "app_committed_client_outbound").some((s) => s.exact_excerpt === draft.exact_excerpt));
  }
  assert.equal(source("P2-en-control-reported", "owner_reported_client_outbound").length, 1);
  const planted = item("P2-en-planted-exported").packet.response_evidence;
  assert.equal(source("P2-en-planted-exported", "unsent_draft").length, 1);
  assert.equal(source("P2-en-planted-exported", "owner_reported_client_outbound").length, 0);
  assert.ok(JSON.stringify(planted.communication_projection).includes("export"));
  assert.equal(source("P10-en-planted", "supervisor_instruction")[0].supplied_by.actor_resolution, "owner_verified");
  assert.equal(item("P5-en-planted").snapshot.journal.availability, "not_configured");
  assert.equal(source("P7-en-planted", "journal_quotation").length, 3);
  assert.equal(item("P7-en-planted").snapshot.journal.more_available, true);
  assert.equal(item("P7-en-planted").snapshot.journal.receipts.length, 1);
  assert.equal(item("P12-en-planted").snapshot.journal.retrieval_status, "failed");
});

test("selfcheck checks every sealed file, schemas, bindings and checkout prompt reconstruction", async () => {
  assert.equal((await selfcheck({ sealedDir })).checked, true);
  const file = path.join(sealedDir, sealed.entries[0].entry.user.file), bytes = await fs.readFile(file);
  try { await fs.writeFile(file, Buffer.concat([bytes, Buffer.from("x")])); await assert.rejects(selfcheck({ sealedDir }), /hash mismatch/); }
  finally { await fs.writeFile(file, bytes); }
  // Even consistently rehashed prompt bytes are refused when this checkout rebuilds different text.
  const manifestPath = path.join(sealedDir, "manifest.json"), hashPath = path.join(sealedDir, "manifest.sha256");
  const originalManifest = await fs.readFile(manifestPath), originalHash = await fs.readFile(hashPath);
  try {
    await fs.writeFile(file, Buffer.concat([bytes, Buffer.from("x")]));
    const changed = JSON.parse(originalManifest); changed.packets[0].user.sha256 = sha256(await fs.readFile(file)); changed.packets[0].user.bytes++;
    const changedBytes = json(changed);
    await fs.writeFile(manifestPath, changedBytes); await fs.writeFile(hashPath, `${sha256(changedBytes)}\n`);
    await assert.rejects(selfcheck({ sealedDir }), /different prompt/);
  } finally { await fs.writeFile(file, bytes); await fs.writeFile(manifestPath, originalManifest); await fs.writeFile(hashPath, originalHash); }
});

test("schedule alternates arms and covers every case before sample two", () => {
  const schedule = buildSchedule(sealed.manifest, 2);
  assert.equal(schedule.length, 144); assert.equal(new Set(schedule.map((s) => s.call)).size, 144);
  assert.equal(new Set(schedule.slice(0, 72).map((s) => s.packet)).size, 72);
  assert.ok(schedule.slice(0, 72).every((s) => s.sample === 1));
  assert.ok(schedule.every((s, i) => s.packet.endsWith(i % 2 ? ".E" : ".G")));
});

test("mock audit and scorer give exact counts, total-folder limits, immutable settings and 144-call cap", async () => {
  let summary = await run("mock", { samples: 1, concurrency: 3 });
  assert.equal(summary.started_now, 72); assert.equal(summary.this_run.ok, 72);
  const runPath = path.join(root, "mock"), firstRun = await fs.readFile(path.join(runPath, "run.json"));
  let scored = await score({ runDir: runPath });
  for (const arm of ["G", "E"]) {
    assert.equal(scored.by_arm[arm].verdicts, 36); assert.equal(scored.by_arm[arm].false_approvals, 16);
    assert.equal(scored.by_arm[arm].unnecessary_blocks, 0); assert.equal(scored.by_arm[arm].malformed, 0);
  }
  assert.equal(scored.by_arm_role.find((r) => r.arm === "E" && r.role === "planted").false_approvals, 16);
  assert.equal(scored.cases.length, 36);
  summary = await run("mock", { samples: 2, limit: 80 }); assert.equal(summary.started_now, 8);
  const partial = await score({ runDir: runPath });
  assert.equal(partial.samples_scheduled, 2);
  assert.equal(partial.cases.at(-1).arms.E[1].outcome, "not_run");
  summary = await run("mock", { samples: 2, limit: 80 }); assert.equal(summary.started_now, 0);
  summary = await run("mock", { samples: 2, limit: 1000, concurrency: 3 }); assert.equal(summary.counted_total, 144);
  summary = await run("mock", { samples: 2 }); assert.equal(summary.started_now, 0);
  assert.deepEqual(await fs.readFile(path.join(runPath, "run.json")), firstRun);
  scored = await score({ runDir: runPath });
  assert.equal(scored.by_arm.E.false_approvals, 32); assert.equal(scored.by_arm.E.input_tokens, 7200);
  const report = await fs.readFile(path.join(runPath, "report.txt"), "utf8");
  assert.ok(report.includes("32 of 32")); assert.ok(report.includes(sealed.manifestSha256));
  for (const spec of sealed.manifest.cases) assert.ok(report.includes(spec.id));
  assert.equal((await fs.stat(runPath)).mode & 0o777, 0o700);
  assert.equal((await fs.stat(path.join(runPath, "receipts"))).mode & 0o777, 0o700);
  await assert.rejects(run("mock", { model: "different" }), /other settings/);
  await assert.rejects(run("mock", { effort: "different" }), /other settings/);
  await assert.rejects(run("mock", { provider: { id: "other" } }), /other settings/);
});

test("stop on usage limit, three failures, malformed reviews and interrupted calls; never retry", async () => {
  let summary = await run("usage", { faults: { usageLimitAt: 2 } });
  assert.equal(summary.started_now, 2); assert.equal(summary.counted_total, 1); assert.equal(summary.stop_reason, "usage_limit");
  summary = await run("usage", { limit: 2 }); assert.equal(summary.started_now, 1);
  const receiptNames = await fs.readdir(path.join(root, "usage", "receipts")); assert.equal(receiptNames.some((n) => n.includes(".a2.")), false);
  summary = await run("failures", { faults: { errorAt: [1, 2, 3] } }); assert.equal(summary.stop_reason, "three_failures_in_a_row"); assert.equal(summary.started_now, 3);
  summary = await run("malformed", { limit: 2, faults: { garbageAt: [1, 2] } });
  assert.equal(summary.this_run.unusable, 1); assert.equal(summary.this_run.malformed, 1);
  const scored = await score({ runDir: path.join(root, "malformed") });
  assert.equal(scored.by_arm.E.malformed, 1); assert.equal(scored.by_arm.E.verdicts, 0);
  await run("interrupted", { limit: 1 });
  const dir = path.join(root, "interrupted", "receipts"), result = (await fs.readdir(dir)).find((n) => n.endsWith(".result.json"));
  await fs.unlink(path.join(dir, result));
  summary = await run("interrupted", { limit: 1 }); assert.equal(summary.started_now, 0); assert.equal(summary.counted_total, 1);
  assert.equal((await results("interrupted"))[0].outcome, "ambiguous_not_retried");
});

test("offline audit uses runtime-derived evidence verdicts and rejects unsupported source ids or candidate quotations", async () => {
  const captured = item("P1-en-planted"), draft = source("P1-en-planted", "unsent_draft")[0];
  const review = emptyReview(); review.coverage.find((c) => c.dimension === "prior_delivery").status = "assessed";
  review.items.push({ id: "delivery", dimension: "prior_delivery", kind: "question_presupposition", candidate_quote: captured.candidateText, source_ids: [draft.id], assessment: "supported", reason: "Synthetic judgment of draft as delivery, deliberately incompatible." });
  const provider = (value) => ({ id: "scripted", model: "placeholder", async generate() { return { responseId: "synthetic", text: JSON.stringify(value) }; } });
  const value = { findings: [], repair_induced_checks: [], evidence_review: review };
  const execute = (v) => executeAudit({ auditor: provider(v), item: captured, call: "test", mode: "mock", model: "mock" });
  const outcome = await execute(value);
  assert.equal(outcome.verdict, "fail"); assert.deepEqual(outcome.codes, ["RESPONSE_EVIDENCE_SOURCE_INCOMPATIBLE"]);
  assert.equal(outcome.derived_findings[0].id, "evidence:delivery");
  assert.equal(judge("block", "E", outcome, "prior_delivery").dimension_agreement, true);
  assert.equal(judge("pass", "E", outcome, "prior_delivery").cause, "derived_evidence_finding");
  for (const mutation of [
    (v) => { v.evidence_review.items[0].source_ids = ["src:forged"]; },
    (v) => { v.evidence_review.items[0].candidate_quote = "not in the candidate"; },
    (v) => { delete v.evidence_review; }
  ]) {
    const changed = structuredClone(value); mutation(changed);
    const refused = await execute(changed); assert.equal(refused.outcome, "malformed"); assert.equal(refused.verdict, undefined);
  }
  assert.equal(judge("pass", "G", { outcome: "ok", verdict: "fail", derived_findings: [], findings: [] }).cause, "only_ordinary_findings");
});

test("scorer keeps ordinary blocks, derived evidence blocks and malformed E answers separate", async () => {
  const provider = new MockAuditor({ sealed });
  const generate = provider.generate.bind(provider);
  provider.generate = async (request) => {
    const raw = await generate(request), value = JSON.parse(raw.text), packet = JSON.parse(request.user.slice("AUTHORIZED AUDIT PACKET\n".length));
    if (request.metadata.attemptContextId === "P0-en-control.G.s1") value.findings = [{ id: "ordinary", code: "SYNTHETIC_ORDINARY_BLOCK", severity: "high", summary: "Scripted ordinary block." }];
    if (request.metadata.attemptContextId === "P0-en-control.E.s1") {
      value.evidence_review.coverage.find((c) => c.dimension === "personal_history").status = "assessed";
      value.evidence_review.items = [{ id: "history", dimension: "personal_history", kind: "claim", candidate_quote: packet.candidate_response, source_ids: [], assessment: "unsupported", reason: "Scripted unsupported item." }];
    }
    return { ...raw, text: request.metadata.attemptContextId === "P0-fr-control.E.s1" ? "A refusal instead of a review." : JSON.stringify(value) };
  };
  await run("causes", { provider, limit: 4 });
  const scored = await score({ runDir: path.join(root, "causes") });
  assert.equal(scored.by_arm.G.unnecessary_blocks, 1); assert.equal(scored.by_arm.G.only_ordinary_blocks, 1);
  assert.equal(scored.by_arm.E.unnecessary_blocks, 1); assert.equal(scored.by_arm.E.derived_evidence_blocks, 1);
  assert.equal(scored.by_arm.E.malformed, 1); assert.equal(scored.by_arm.E.verdicts, 1);
});

test("live guards and missing --live refuse before even probing the stand-in executable", async () => {
  const bin = path.join(root, "bin"), marker = path.join(root, "claude-was-run");
  await fs.mkdir(bin, { mode: 0o700 });
  await fs.writeFile(path.join(bin, "claude"), `#!/bin/sh\nprintf invoked > '${marker}'\nexit 99\n`, { mode: 0o700 });
  const baseEnv = { PATH: `${bin}:${process.env.PATH}`, CLAUDE_COMMAND: path.join(bin, "claude"), [OPT_IN_ENV]: undefined,
    ANTHROPIC_API_KEY: undefined, INNER_SIGNAL_MODE: undefined };
  const calls = [
    { name: "no-opt-in", args: ["--live"], env: baseEnv, error: /requires INNER_SIGNAL_EVAL_ALLOW_SUBSCRIPTION_CLI/ },
    { name: "api-key", args: ["--live"], env: { ...baseEnv, [OPT_IN_ENV]: "1", ANTHROPIC_API_KEY: "synthetic-not-a-key" }, error: /refuses ANTHROPIC_API_KEY/ },
    { name: "no-live", args: [], env: { ...baseEnv, [OPT_IN_ENV]: "1" }, error: /Choose --mock or --live/ },
    { name: "api-mode", args: ["--live"], env: { ...baseEnv, [OPT_IN_ENV]: "1", INNER_SIGNAL_MODE: "api" }, error: /refuses API mode/ }
  ];
  const saved = Object.fromEntries(Object.keys(baseEnv).map((key) => [key, process.env[key]]));
  try {
    for (const call of calls) {
      for (const [key, value] of Object.entries(call.env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
      await assert.rejects(main(["audit", "--sealed", sealedDir, "--out", path.join(root, call.name), ...call.args]), call.error);
      await assert.rejects(fs.stat(marker), { code: "ENOENT" });
    }
  } finally {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test("invalid options and output paths are refused without a provider call", async () => {
  for (const corpus of ["other", "__proto__"]) {
    const outDir = path.join(root, `invalid-corpus-${corpus}`);
    await assert.rejects(main(["seal", "--out", outDir, "--corpus", corpus]), /--corpus must be main or holdout/);
    await assert.rejects(fs.stat(outDir), { code: "ENOENT" });
  }
  for (const options of [{ limit: 0 }, { limit: 1.5 }, { concurrency: 4 }, { samples: 3 }]) await assert.rejects(run("invalid", options));
  await assert.rejects(runAudit({ sealedDir, outDir: path.join(ROOT, "never-create-eval"), mode: "mock" }), /outside/);
  const link = path.join(root, "checkout-link"); await fs.symlink(ROOT, link);
  await assert.rejects(runAudit({ sealedDir, outDir: path.join(link, "never-create-eval"), mode: "mock" }), /outside/);
  assert.deepEqual(new MockAuditor({ sealed }).privateInferenceIsolation, isolation);
  const locked = path.join(root, "locked"); await fs.mkdir(locked, { mode: 0o700 }); await fs.mkdir(path.join(locked, ".audit.lock"), { mode: 0o700 });
  await assert.rejects(run("locked"), /audit lock/);
});
