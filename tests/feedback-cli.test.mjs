import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateOwnerKeyPair } from "../src/feedback/open-sealed.mjs";

// The hosted connector's real entry point with the feedback switches: off as before, on with its settings, and refused to start
// when a setting is missing or wrong (naming the setting, never its value). Synthetic data only.
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SETTINGS = ["INNER_SIGNAL_FEEDBACK", "INNER_SIGNAL_FEEDBACK_TOOL", "INNER_SIGNAL_FEEDBACK_ROOT", "INNER_SIGNAL_FEEDBACK_OWNER_PUBLIC_KEY",
  "INNER_SIGNAL_FEEDBACK_OWNER_TOKEN_SHA256", "INNER_SIGNAL_FEEDBACK_PUBLIC_URL", "INNER_SIGNAL_FEEDBACK_TRUST_FORWARDED_FOR",
  "INNER_SIGNAL_MCP_SUPERVISOR_DRAFTS", "INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT", "INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_BASE64",
  "INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_FILE", "INNER_SIGNAL_JOURNAL_WORK_CASE_ID"];

async function setup(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "feedback-cli-"));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const vaults = path.join(base, "vaults");
  const root = path.join(base, "feedback");
  await fs.mkdir(vaults, { mode: 0o700 });
  await fs.mkdir(root, { mode: 0o700 });
  const credentialsPath = path.join(base, "credentials.json");
  await fs.writeFile(credentialsPath, JSON.stringify({
    schema_version: 1,
    root_dir: vaults,
    grants: [{ token_sha256: createHash("sha256").update(`reader-${randomBytes(8).toString("hex")}`).digest("hex"), principal_id: "synthetic-reader", case_ids: ["synthetic-case"], scopes: ["case:read"] }],
    case_keys: { "synthetic-case": { routine_kek_base64: randomBytes(32).toString("base64"), recovery_secret_base64: randomBytes(32).toString("base64") } }
  }), { mode: 0o600 });
  const pair = generateOwnerKeyPair();
  const settings = {
    INNER_SIGNAL_FEEDBACK: "on",
    INNER_SIGNAL_FEEDBACK_ROOT: root,
    INNER_SIGNAL_FEEDBACK_OWNER_PUBLIC_KEY: pair.publicKey,
    INNER_SIGNAL_FEEDBACK_OWNER_TOKEN_SHA256: createHash("sha256").update(randomBytes(32).toString("base64url")).digest("hex"),
    INNER_SIGNAL_FEEDBACK_PUBLIC_URL: "https://feedback.synthetic.example/feedback"
  };
  return { base, credentialsPath, settings };
}

// Starts the connector and resolves with its ready line, or with its exit code and stderr if it stops.
function start(t, environment, settings = {}) {
  const readyPath = path.join(environment.base, `ready-${randomBytes(4).toString("hex")}.json`);
  const env = { ...process.env };
  for (const name of SETTINGS) delete env[name];
  const child = spawn(process.execPath, [path.join(repositoryRoot, "src/cli/private-case-mcp.mjs"), "--credentials", environment.credentialsPath, "--port", "0", "--ready-file", readyPath], {
    env: { ...env, ...settings },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdout.resume();
  t.after(() => { if (child.exitCode === null) child.kill("SIGTERM"); });
  return new Promise((resolve) => {
    const timer = setInterval(async () => {
      const text = await fs.readFile(readyPath, "utf8").catch(() => null);
      if (text) {
        clearInterval(timer);
        resolve({ ready: JSON.parse(text), stderr: () => stderr });
      }
    }, 50);
    child.once("exit", (code) => {
      clearInterval(timer);
      resolve({ exit: code, stderr: () => stderr });
    });
  });
}

test("off: the ready line and /feedback are as before; on: the page answers and the ready line says so", async (t) => {
  const environment = await setup(t);
  const off = await start(t, environment);
  assert.ok(off.ready, off.stderr?.());
  assert.deepEqual(Object.keys(off.ready), ["ready", "mcpUrl", "provider", "productionReady", "journalEnabled", "journalWork"]);
  const offOrigin = off.ready.mcpUrl.replace(/\/mcp$/u, "");
  assert.equal((await fetch(`${offOrigin}/feedback`)).status, 404);

  const on = await start(t, environment, environment.settings);
  assert.ok(on.ready, on.stderr?.());
  assert.deepEqual(on.ready.feedback, { page: "on", tool: "off" });
  const origin = on.ready.mcpUrl.replace(/\/mcp$/u, "");
  const page = await fetch(`${origin}/feedback`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Send InnerSignal feedback/u);
  assert.deepEqual((await (await fetch(`${origin}/health`)).json()).feedback, { page: "on", tool: "off" });
});

test("a missing or wrong setting stops startup with the setting's name and never its value", async (t) => {
  const environment = await setup(t);
  const secretLooking = "not-a-key-but-must-not-be-printed-3f9a";
  const cases = [
    [{ ...environment.settings, INNER_SIGNAL_FEEDBACK_ROOT: "" }, /INNER_SIGNAL_FEEDBACK_ROOT is required/u],
    [{ ...environment.settings, INNER_SIGNAL_FEEDBACK_OWNER_PUBLIC_KEY: secretLooking }, /INNER_SIGNAL_FEEDBACK_OWNER_PUBLIC_KEY must be an X25519 public key/u],
    [{ ...environment.settings, INNER_SIGNAL_FEEDBACK_PUBLIC_URL: "http://feedback.synthetic.example/feedback" }, /INNER_SIGNAL_FEEDBACK_PUBLIC_URL must be an https address/u],
    [{ INNER_SIGNAL_FEEDBACK_TOOL: "on" }, /INNER_SIGNAL_FEEDBACK_TOOL needs INNER_SIGNAL_FEEDBACK on/u],
    [{ INNER_SIGNAL_FEEDBACK: secretLooking }, /INNER_SIGNAL_FEEDBACK must be true or false/u],
    [{ ...environment.settings, INNER_SIGNAL_FEEDBACK_ROOT: repositoryRoot }, /INNER_SIGNAL_FEEDBACK_ROOT must be outside the repository/u]
  ];
  for (const [settings, message] of cases) {
    const run = await start(t, environment, settings);
    assert.notEqual(run.exit, 0, String(message));
    assert.match(run.stderr(), message);
    assert.equal(run.stderr().includes(secretLooking), false, "the value is never printed");
  }
});
