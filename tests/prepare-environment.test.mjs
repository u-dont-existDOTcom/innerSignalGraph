import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prepareRuntimeEnvironment } from "../src/autopilot/prepare-environment.mjs";
import { readEnvFile } from "../src/autopilot/env-file.mjs";

test("prepare environment repairs stale invalid mode before fast-start server", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-prepare-"));
  const envPath = path.join(dir, ".env");
  const defaultsPath = path.join(dir, ".env.cli.example");
  await fs.writeFile(defaultsPath, "INNER_SIGNAL_MODE=cli\nANTHROPIC_MODEL=claude-opus-5\n");
  await fs.writeFile(envPath, [
    "# preserve me",
    "INNER_SIGNAL_MODE=bootstrap",
    "ANTHROPIC_MODEL=claude-opus-5",
    "THERAPY_PROCESSING_MODE=auto",
    "PORT=8787",
    "OTHER=value",
    ""
  ].join("\n"));

  const result = await prepareRuntimeEnvironment({ envPath, defaultsPath, makeBackup: false });
  const { text, values } = await readEnvFile(envPath);
  assert.equal(result.changed, true);
  assert.ok(result.changedKeys.includes("INNER_SIGNAL_MODE"));
  assert.equal(values.INNER_SIGNAL_MODE, "cli");
  assert.equal(values.ANTHROPIC_MODEL, "claude-opus-5");
  assert.equal(values.ANTHROPIC_ESCALATION_MODEL, "claude-fable-5");
  assert.equal(values.RESPONSE_RENDERER_MODEL, "claude-sonnet-4-6");
  assert.equal(values.OTHER, "value");
  assert.match(text, /# preserve me/);
});

test("prepare environment repairs other strict bootstrap fields without overriding valid user tier", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-prepare-"));
  const envPath = path.join(dir, ".env");
  const defaultsPath = path.join(dir, ".env.cli.example");
  await fs.writeFile(defaultsPath, "INNER_SIGNAL_MODE=cli\n");
  await fs.writeFile(envPath, [
    "INNER_SIGNAL_MODE=cli",
    "THERAPY_PROCESSING_MODE=fast",
    "LEDGER_MODE=nonsense",
    "ADJUDICATOR_PROVIDER=wrong",
    "HYPNOSIS_WRITER_PROVIDER=wrong",
    "PORT=999999",
    ""
  ].join("\n"));

  await prepareRuntimeEnvironment({ envPath, defaultsPath, makeBackup: false });
  const { values } = await readEnvFile(envPath);
  assert.equal(values.INNER_SIGNAL_MODE, "cli");
  assert.equal(values.THERAPY_PROCESSING_MODE, "fast");
  assert.equal(values.LEDGER_MODE, "full");
  assert.equal(values.ADJUDICATOR_PROVIDER, "openai");
  assert.equal(values.HYPNOSIS_WRITER_PROVIDER, "anthropic");
  assert.equal(values.PORT, "8787");
});
