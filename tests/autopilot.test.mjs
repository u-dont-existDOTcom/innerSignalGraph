import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setEnvValues, readEnvFile } from "../src/autopilot/env-file.mjs";
import { normalizeAutopilotModelPolicy } from "../src/autopilot/model-policy.mjs";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("autopilot dry-run exposes the complete autonomous runtime stages", async () => {
  const { stdout } = await execFileAsync("bash", [path.join(root, "run-autopilot.sh"), "--dry-run"], { cwd: root });
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.logsRequiredFromUser, false);
  assert.equal(parsed.modelPolicy.anthropicPrimary, "claude-opus-5");
  assert.equal(parsed.modelPolicy.anthropicEscalation, "claude-fable-5");
  assert.match(parsed.modelPolicy.anthropicRenderer, /claude-sonnet-4-6/);
  assert.deepEqual(parsed.stages, [
    "immediate-local-app",
    "prepare-environment",
    "guide-graph-compile",
    "guide-graph-regressions",
    "tests",
    "cli-capability-check",
    "interactive-Claude-auth-recovery",
    "automatic-model-resolution",
    "guide-packet-candidate",
    "H001-hypnosis-compiler",
    "conditional-Fable-escalation",
    "A001-adversarial-therapy-benchmark",
    "response-realization",
    "auto-tiered-live-therapy",
    "runtime-server-smoke",
    "web-client-smoke",
    "roadmap-state",
    "foreground-local-app",
    "autonomous-development-worker",
    "stale-development-case-requeue",
    "continuous-autonomous-roadmap",
    "isolated-repair-candidate",
    "independent-patch-review",
    "exact-case-replay",
    "automatic-restorative-promotion",
    "human-policy-decision-only-when-required",
    "local-failure-diagnosis",
    "checkpoint-resume",
    "final-status"
  ]);
  assert.deepEqual(parsed.terminalStates, ["PASS", "ACTION_REQUIRED", "BLOCKED"]);
});

test("environment updater changes only selected keys and can select CLI default", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-env-"));
  const file = path.join(dir, ".env");
  await fs.writeFile(file, "# keep\nOPENAI_MODEL=old\nOTHER=value\n");
  await setEnvValues(file, { OPENAI_MODEL: "gpt-new", ANTHROPIC_MODEL: "" });
  const { text, values } = await readEnvFile(file);
  assert.match(text, /# keep/);
  assert.match(text, /OTHER=value/);
  assert.equal(values.OPENAI_MODEL, "gpt-new");
  assert.equal(values.ANTHROPIC_MODEL, "");
});

test("autopilot migrates Artifact-era Sonnet to Opus and enables authorized Fable escalation", () => {
  const env = {
    ANTHROPIC_MODEL: "claude-sonnet-4-6",
    ANTHROPIC_MODEL_FALLBACKS: "claude-sonnet-4-6,sonnet",
    ALLOW_CLAUDE_FABLE_USAGE: "false",
    AUTOPILOT_ESCALATE_TO_FABLE: "false"
  };
  const result = normalizeAutopilotModelPolicy(env);
  assert.equal(result.changed, true);
  assert.equal(env.ANTHROPIC_MODEL, "claude-opus-5");
  assert.equal(env.ANTHROPIC_ESCALATION_MODEL, "claude-fable-5");
  assert.equal(env.RESPONSE_RENDERER_MODEL, "claude-sonnet-4-6");
  assert.equal(env.ALLOW_CLAUDE_FABLE_USAGE, "true");
  assert.equal(env.AUTOPILOT_ESCALATE_TO_FABLE, "true");
  assert.match(env.ANTHROPIC_MODEL_FALLBACKS, /claude-opus-5/);
  assert.doesNotMatch(env.ANTHROPIC_MODEL_FALLBACKS, /claude-fable-5/);
  assert.doesNotMatch(env.ANTHROPIC_MODEL_FALLBACKS, /sonnet/i);
});

test("autopilot keeps Opus primary even when an older file selected Fable directly", () => {
  const env = {
    ANTHROPIC_MODEL: "claude-fable-5",
    ANTHROPIC_ESCALATION_MODEL: "claude-fable-5",
    ANTHROPIC_MODEL_FALLBACKS: "claude-fable-5",
    ALLOW_CLAUDE_FABLE_USAGE: "true",
    AUTOPILOT_ESCALATE_TO_FABLE: "true"
  };
  const result = normalizeAutopilotModelPolicy(env);
  assert.equal(result.changed, true);
  assert.equal(env.ANTHROPIC_MODEL, "claude-opus-5");
  assert.equal(env.ANTHROPIC_ESCALATION_MODEL, "claude-fable-5");
});


test("autopilot wrapper owns Claude interactive reauthentication and resumes automatically", async () => {
  const text = await fs.readFile(path.join(root, "run-autopilot.sh"), "utf8");
  assert.match(text, /claude.*auth login|\"\$claude_cmd\" auth login/s);
  assert.match(text, /claude.*auth status|\"\$claude_cmd\" auth status/s);
  assert.match(text, /INNER_SIGNAL_CLAUDE_REAUTH_ATTEMPTED/);
  assert.match(text, /exec \.\/run-autopilot\.sh --force-validation/);
});
