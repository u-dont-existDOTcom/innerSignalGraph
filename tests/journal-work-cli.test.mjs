import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repositoryRoot, "src/cli/private-case-mcp.mjs");
const CASE_ID = "synthetic-journal-case";

async function setup(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "journal-work-cli-"));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const credentialsPath = path.join(base, "credentials.json");
  await fs.writeFile(credentialsPath, JSON.stringify({
    schema_version: 1,
    root_dir: path.join(base, "vaults"),
    grants: [{
      token_sha256: createHash("sha256").update(randomBytes(16)).digest("hex"),
      principal_id: "synthetic-importer",
      case_ids: [CASE_ID],
      scopes: ["case:read", "journal:submit"]
    }],
    case_keys: {
      [CASE_ID]: { routine_kek_base64: randomBytes(32).toString("base64"), recovery_secret_base64: randomBytes(32).toString("base64") }
    }
  }), { mode: 0o600 });
  const exchangeRoot = path.join(base, "exchange");
  await fs.mkdir(exchangeRoot, { mode: 0o700 });
  return { base, credentialsPath, exchangeRoot };
}

function start({ base, credentialsPath }, exchangeRoot) {
  const readyPath = path.join(base, `ready-${randomBytes(4).toString("hex")}.json`);
  const child = spawn(process.execPath, [cli, "--credentials", credentialsPath, "--port", "0", "--ready-file", readyPath], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT: exchangeRoot,
      INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_BASE64: randomBytes(32).toString("base64"),
      INNER_SIGNAL_JOURNAL_WORK_CASE_ID: CASE_ID
    },
    stdio: ["ignore", "ignore", "pipe"]
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const exited = new Promise((resolve) => child.once("exit", (code) => resolve(code)));
  return { child, readyPath, exited, stderr: () => stderr };
}

async function readiness(run) {
  let stopped = false;
  void run.exited.then(() => { stopped = true; });
  for (let attempt = 0; attempt < 1_200; attempt += 1) {
    const text = await fs.readFile(run.readyPath, "utf8").catch(() => null);
    if (text != null) return JSON.parse(text);
    if (stopped) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`the connector did not become ready; stderr=${run.stderr()}`);
}

test("the connector won't start on a missing exchange root or one other users can reach", async (t) => {
  const environment = await setup(t);
  for (const [prepare, message] of [
    [async () => path.join(environment.base, "missing"), /INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT must name an existing directory/u],
    [async () => { await fs.chmod(environment.exchangeRoot, 0o755); return environment.exchangeRoot; },
      /INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT must be owned by this process's user and grant no group or other access/u]
  ]) {
    const run = start(environment, await prepare());
    t.after(() => run.child.kill("SIGTERM"));
    assert.notEqual(await run.exited, 0);
    assert.match(run.stderr(), message);
    await assert.rejects(fs.access(run.readyPath));
  }
  assert.deepEqual(await fs.readdir(environment.exchangeRoot), []);
});

test("the connector starts on a private exchange root and removes stale temporary files", async (t) => {
  const environment = await setup(t);
  const outbox = path.join(environment.exchangeRoot, "outbox");
  await fs.mkdir(outbox, { mode: 0o700 });
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
  await fs.writeFile(path.join(outbox, ".tmp-stale"), "partial", { mode: 0o600 });
  await fs.utimes(path.join(outbox, ".tmp-stale"), old, old);
  await fs.writeFile(path.join(outbox, ".tmp-recent"), "partial", { mode: 0o600 });
  const run = start(environment, environment.exchangeRoot);
  t.after(() => run.child.kill("SIGTERM"));
  const ready = await readiness(run);
  assert.equal(ready.journalWork, true);
  assert.deepEqual(await fs.readdir(outbox), [".tmp-recent"]);
});
