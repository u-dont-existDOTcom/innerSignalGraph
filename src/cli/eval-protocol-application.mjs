#!/usr/bin/env node
// The protocol application test (issue #172, change C), run by hand: it calls models and is not part of CI.
// See docs/PROTOCOL-APPLICATION-EVAL.md.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadConfig } from "../core/config.mjs";
import { AnthropicProvider } from "../providers/anthropic.mjs";
import { ClaudeCliProvider } from "../providers/claude-cli.mjs";
import { CodexCliProvider } from "../providers/codex-cli.mjs";
import { MockProvider } from "../providers/mock.mjs";
import { OpenAIProvider } from "../providers/openai.mjs";
import {
  PROTOCOL_APPLICATION_VERSION,
  connectorSource,
  loadProtocolApplicationCalibration,
  loadProtocolApplicationCases,
  runJudgeCalibration,
  runProtocolApplication,
  summarizeProtocolApplication
} from "../evals/protocol-application.mjs";

const USAGE = `Usage: npm run eval:protocol-application -- --mode cli|api|mock [options]

  --mode cli|api|mock      required: cli uses the codex and claude commands, api the provider APIs, mock a fixture
  --answerer openai|anthropic   the model family that answers (default openai, as in ChatGPT)
  --judge openai|anthropic      the family that grades (default: the other one)
  --answer-model NAME      override the answering model (default: OPENAI_MODEL or ANTHROPIC_MODEL)
  --judge-model NAME       override the grading model
  --samples N              replies per case (default 3)
  --case ID                only this case (repeatable)
  --git-ref REF            test the connector and protocol of this commit instead of this checkout
  --calibration-only       only check the judge on the replies whose grades are known
  --skip-calibration       don't check the judge first (the run is then marked unchecked)
  --fixture FILE           mock mode: the fixture of replies and judgments
  --out DIR                where the report goes (default: a new private temporary folder)

Exit status: 0 every reply passed; 1 a reply failed a rule; 2 inconclusive (a judgment or reply was unusable, or the
judge misgraded a known reply); 3 a usage or configuration error.`;

function fail(message) {
  process.stderr.write(`${message}\n\n${USAGE}\n`);
  process.exit(3);
}

const { values } = (() => {
  try {
    return parseArgs({
      options: {
        mode: { type: "string" },
        answerer: { type: "string", default: "openai" },
        judge: { type: "string" },
        "answer-model": { type: "string" },
        "judge-model": { type: "string" },
        samples: { type: "string", default: "3" },
        case: { type: "string", multiple: true },
        "git-ref": { type: "string" },
        "calibration-only": { type: "boolean", default: false },
        "skip-calibration": { type: "boolean", default: false },
        fixture: { type: "string" },
        out: { type: "string" },
        help: { type: "boolean", default: false }
      },
      strict: true
    });
  } catch (error) {
    fail(error.message);
  }
})();

if (values.help) {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}
if (!["cli", "api", "mock"].includes(values.mode)) fail("--mode is required: cli, api or mock. A live run uses your model usage, so it is never the default.");
const families = ["openai", "anthropic"];
if (!families.includes(values.answerer)) fail("--answerer must be openai or anthropic.");
const judgeFamily = values.judge ?? families.find((family) => family !== values.answerer);
if (!families.includes(judgeFamily)) fail("--judge must be openai or anthropic.");
const samples = Number(values.samples);
if (!Number.isSafeInteger(samples) || samples < 1 || samples > 20) fail("--samples must be a whole number from 1 to 20.");
if (values["calibration-only"] && values["skip-calibration"]) fail("--calibration-only and --skip-calibration contradict each other.");
if (values.mode === "mock" && !values.fixture) fail("--fixture is required in mock mode.");

let config;
try {
  config = loadConfig({ mode: values.mode });
} catch (error) {
  fail(error.message);
}

// An empty folder for the command-line agents to start in, so nothing of this checkout is within their reach by default.
const agentHome = fs.mkdtempSync(path.join(os.tmpdir(), "inner-signal-eval-agent-"));

function provider(family, model) {
  if (values.mode === "mock") return new MockProvider({ id: family, model: `mock-${family}`, fixturePath: path.resolve(values.fixture) });
  if (values.mode === "cli") {
    return family === "openai"
      ? new CodexCliProvider({ command: config.codexCommand, model: model ?? config.openaiModel, reasoningEffort: config.codexReasoningEffort, timeoutMs: config.requestTimeoutMs, cwd: agentHome, isolateConfig: true })
      : new ClaudeCliProvider({ command: config.claudeCommand, model: model ?? config.anthropicModel, effort: config.claudeEffort, timeoutMs: config.requestTimeoutMs, cwd: agentHome, isolateConfig: true });
  }
  return family === "openai"
    ? new OpenAIProvider({ apiKey: config.openaiApiKey, model: model ?? config.openaiModel, timeoutMs: config.requestTimeoutMs, maxOutputTokens: config.maxOutputTokens })
    : new AnthropicProvider({ apiKey: config.anthropicApiKey, model: model ?? config.anthropicModel, timeoutMs: config.requestTimeoutMs, maxOutputTokens: config.maxOutputTokens });
}

// A Codex agent that can't be kept away from the user's own configuration (its MCP servers, including InnerSignal's) or
// out of a read-only sandbox isn't used.
async function requireIsolation(candidate) {
  if (!(candidate instanceof CodexCliProvider)) return;
  const flags = (await candidate.capabilities())?.flags;
  const missing = ["ignoreUserConfig", "sandbox", "ephemeral", "outputSchema", "outputLastMessage"].filter((flag) => !flags?.[flag]);
  if (missing.length) fail(`The installed Codex CLI lacks what this test needs to isolate it: ${missing.join(", ")}.`);
}

const allCases = loadProtocolApplicationCases();
const wanted = values.case ?? [];
const unknown = wanted.filter((id) => !allCases.some((spec) => spec.id === id));
if (unknown.length) fail(`Unknown case: ${unknown.join(", ")}.`);
const cases = wanted.length ? allCases.filter((spec) => wanted.includes(spec.id)) : allCases;
const calibration = loadProtocolApplicationCalibration(allCases).filter((entry) => cases.some((spec) => spec.id === entry.case_id));

const answerer = provider(values.answerer, values["answer-model"]);
const judge = provider(judgeFamily, values["judge-model"]);
const outDir = values.out ? path.resolve(values.out) : fs.mkdtempSync(path.join(os.tmpdir(), "inner-signal-protocol-application-"));
fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
const log = (line) => process.stderr.write(`${line}\n`);

const report = {
  version: PROTOCOL_APPLICATION_VERSION,
  started_at: new Date().toISOString(),
  mode: values.mode,
  answerer: { family: values.answerer, model: answerer.model || "default" },
  judge: { family: judgeFamily, model: judge.model || "default" },
  samples,
  cases: cases.map((spec) => spec.id),
  outcome: "inconclusive"
};
let status = 2;
try {
  await requireIsolation(answerer);
  await requireIsolation(judge);
  if (!values["skip-calibration"]) {
    report.calibration = await runJudgeCalibration({ judge, cases, calibration, log });
  } else {
    report.calibration_skipped = true;
  }
  if (values["calibration-only"]) {
    report.outcome = report.calibration.trusted ? "judge_trusted" : "judge_not_trusted";
    status = report.calibration.trusted ? 0 : 2;
  } else if (report.calibration && !report.calibration.trusted) {
    report.outcome = "inconclusive";
    status = 2;
  } else {
    const source = await connectorSource({ ref: values["git-ref"] ?? null });
    report.application = await runProtocolApplication({ answerer, judge, cases, samples, source, log });
    report.outcome = report.application.outcome;
    status = report.outcome === "pass" ? (report.calibration_skipped ? 2 : 0) : report.outcome === "fail" ? 1 : 2;
    if (report.calibration_skipped && report.outcome === "pass") report.outcome = "pass_unchecked_judge";
  }
} catch (error) {
  report.error = { message: error.message, code: error.code ?? null };
  log(`error: ${error.message}`);
  status = 2;
} finally {
  report.finished_at = new Date().toISOString();
  const reportPath = path.join(outDir, "protocol-application-report.json");
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  const summary = summarizeProtocolApplication(report);
  fs.writeFileSync(path.join(outDir, "summary.txt"), `${summary.join("\n")}\n`, { mode: 0o600 });
  process.stdout.write(`${summary.join("\n")}\nReport: ${reportPath}\n`);
  fs.rmSync(agentHome, { recursive: true, force: true });
}
process.exit(status);
