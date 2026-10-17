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
  CODEX_ISOLATION_CONFIG,
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
  --judge openai|anthropic      the family that grades: always the other one (the default)
  --answer-model NAME      override the answering model (default: OPENAI_MODEL or ANTHROPIC_MODEL)
  --judge-model NAME       override the grading model
  --samples N              replies per case (default 3)
  --case ID                only this case (repeatable)
  --git-ref REF            test the connector and protocol of this commit instead of this checkout
  --calibration-only       only check the judge on the replies whose grades are known (the answering agent isn't
                           used or checked; --answerer still picks the judge's family, the other one)
  --skip-calibration       don't check the judge first (the run is then marked unchecked)
  --fixture FILE           mock mode: the fixture of replies and judgments
  --out DIR                where the report goes (default: a new private temporary folder)

Exit status: 0 every reply passed; 1 a reply failed a rule; 2 inconclusive (a judgment or reply was unusable, the
judge misgraded a known reply, or the judge check was skipped); 3 a usage or configuration error.`;

let agentHome = null;
function fail(message) {
  if (agentHome) fs.rmSync(agentHome, { recursive: true, force: true });
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
// A judge of the same family as the answering model shares its blind spots: the grade must come from the other family.
if (judgeFamily === values.answerer) fail("--judge must be the other family from --answerer: a model doesn't grade its own family's replies here.");
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

// The cases are read before anything is created, so a bad case file or an unknown case leaves nothing behind.
let allCases;
let calibrationEntries;
try {
  allCases = loadProtocolApplicationCases();
  calibrationEntries = loadProtocolApplicationCalibration(allCases);
} catch (error) {
  fail(`The test's cases can't be read: ${error.message}`);
}
const wanted = values.case ?? [];
const unknown = wanted.filter((id) => !allCases.some((spec) => spec.id === id));
if (unknown.length) fail(`Unknown case: ${unknown.join(", ")}.`);
const cases = wanted.length ? allCases.filter((spec) => wanted.includes(spec.id)) : allCases;

// A problem with the set-up (an agent that can't be checked or isolated) is a configuration error, reported after cleanup.
class SetupError extends Error {}

function provider(family, model) {
  if (values.mode === "mock") return new MockProvider({ id: family, model: `mock-${family}`, fixturePath: path.resolve(values.fixture) });
  if (values.mode === "cli") {
    return family === "openai"
      ? new CodexCliProvider({ command: config.codexCommand, model: model ?? config.openaiModel, reasoningEffort: config.codexReasoningEffort, timeoutMs: config.requestTimeoutMs, cwd: agentHome, isolateConfig: true, configOverrides: CODEX_ISOLATION_CONFIG })
      : new ClaudeCliProvider({ command: config.claudeCommand, model: model ?? config.anthropicModel, effort: config.claudeEffort, timeoutMs: config.requestTimeoutMs, cwd: agentHome, isolateConfig: true });
  }
  return family === "openai"
    ? new OpenAIProvider({ apiKey: config.openaiApiKey, model: model ?? config.openaiModel, timeoutMs: config.requestTimeoutMs, maxOutputTokens: config.maxOutputTokens })
    : new AnthropicProvider({ apiKey: config.anthropicApiKey, model: model ?? config.anthropicModel, timeoutMs: config.requestTimeoutMs, maxOutputTokens: config.maxOutputTokens });
}

// A command-line agent that can't be kept away from the user's own configuration (its MCP servers, InnerSignal's included),
// its tools and its saved sessions isn't used: Codex in a read-only, ephemeral sandbox that ignores the user's configuration
// and any AGENTS.md rules around it, takes the settings above and reports its events as JSON (which is how its actions are
// counted); Claude with no tools, no MCP servers but an empty set, safe mode and no saved session. Each must also take the
// model and effort asked for, so a result is never a command's default presented as the requested model. An agent whose
// command can't be started or checked isn't used either.
const ISOLATION_FLAGS = new Map([
  [CodexCliProvider, ["ignoreUserConfig", "ignoreRules", "json", "sandbox", "ephemeral", "outputSchema", "outputLastMessage", "model", "config"]],
  [ClaudeCliProvider, ["print", "outputFormat", "jsonSchema", "tools", "strictMcpConfig", "safeMode", "noSessionPersistence", "model", "effort"]]
]);
async function requireIsolation(candidate) {
  const required = [...ISOLATION_FLAGS].find(([kind]) => candidate instanceof kind)?.[1];
  if (!required) return;
  const name = candidate instanceof CodexCliProvider ? "Codex" : "Claude";
  let flags;
  try {
    flags = (await candidate.capabilities())?.flags;
  } catch (error) {
    throw new SetupError(`The ${name} CLI (${candidate.command}) could not be started or checked: ${error.message}`);
  }
  const missing = required.filter((flag) => !flags?.[flag]);
  if (missing.length) throw new SetupError(`The installed ${name} CLI lacks what this test needs to isolate it: ${missing.join(", ")}.`);
}

// An empty folder for the command-line agents to start in, so nothing of this checkout is within their reach by default. It
// is removed however the run ends.
agentHome = fs.mkdtempSync(path.join(os.tmpdir(), "inner-signal-eval-agent-"));
const log = (line) => process.stderr.write(`${line}\n`);
let status = 2;
try {
  // A check of the judge alone asks nothing of the answering agent, so it isn't set up or checked (Codex on #175).
  const answerer = values["calibration-only"] ? null : provider(values.answerer, values["answer-model"]);
  const judge = provider(judgeFamily, values["judge-model"]);
  if (answerer) await requireIsolation(answerer);
  await requireIsolation(judge);
  // The connector under test is loaded before any model is called, so a wrong --git-ref costs nothing.
  let source = null;
  if (!values["calibration-only"]) {
    try {
      source = await connectorSource({ ref: values["git-ref"] ?? null });
    } catch (error) {
      throw new SetupError(`The connector to test can't be loaded${values["git-ref"] ? ` from ${values["git-ref"]}` : ""}: ${error.message.split("\n")[0]}`);
    }
  }
  const outDir = values.out ? path.resolve(values.out) : fs.mkdtempSync(path.join(os.tmpdir(), "inner-signal-protocol-application-"));
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const report = {
    version: PROTOCOL_APPLICATION_VERSION,
    started_at: new Date().toISOString(),
    mode: values.mode,
    answerer: answerer ? { family: values.answerer, model: answerer.model || "default" } : null,
    judge: { family: judgeFamily, model: judge.model || "default" },
    samples,
    cases: cases.map((spec) => spec.id),
    outcome: "inconclusive"
  };
  try {
    if (!values["skip-calibration"]) {
      // The judge is checked on every known reply, whatever cases run: a case's own replies don't fail every rule it grades.
      report.calibration = await runJudgeCalibration({ judge, cases: allCases, calibration: calibrationEntries, graded: cases, log });
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
      report.application = await runProtocolApplication({ answerer, judge, cases, samples, source, log });
      report.outcome = report.application.outcome;
      status = report.outcome === "pass" ? 0 : report.outcome === "fail" ? 1 : 2;
      // Without the check of the judge, no outcome is definite: a judge that fails every rule fails replies as surely as one
      // that passes every rule passes them.
      if (report.calibration_skipped) {
        if (report.outcome !== "inconclusive") report.outcome = `${report.outcome}_unchecked_judge`;
        status = 2;
      }
    }
  } catch (error) {
    report.error = { message: error.message, code: error.code ?? null };
    log(`error: ${error.message}`);
    status = 2;
  }
  report.finished_at = new Date().toISOString();
  const reportPath = path.join(outDir, "protocol-application-report.json");
  // Written private, and made private again when an earlier run's readable file is overwritten.
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(reportPath, 0o600);
  const summary = summarizeProtocolApplication(report);
  const summaryPath = path.join(outDir, "summary.txt");
  fs.writeFileSync(summaryPath, `${summary.join("\n")}\n`, { mode: 0o600 });
  fs.chmodSync(summaryPath, 0o600);
  process.stdout.write(`${summary.join("\n")}\nReport: ${reportPath}\n`);
} catch (error) {
  if (error instanceof SetupError) {
    process.stderr.write(`${error.message}\n\n${USAGE}\n`);
    status = 3;
  } else {
    process.stderr.write(`error: ${error.message}\n`);
    status = 2;
  }
} finally {
  fs.rmSync(agentHome, { recursive: true, force: true });
}
process.exit(status);
