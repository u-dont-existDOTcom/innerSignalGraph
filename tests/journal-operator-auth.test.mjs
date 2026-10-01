import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runJournalImportCli } from "../src/cli/journal-import.mjs";
import {
  createOperatorTokenProvider,
  prepareJournalOperatorEnvironment,
  readPrivateJournalEnvFile
} from "../src/journal-import/operator-auth.mjs";

const SECRET = "SENTINEL-OPERATOR-SECRET-7Q";
const ISSUER = "https://auth.example.test/realms/synthetic";
// The hosted operator settings sign-in needs besides the client credentials (synthetic values).
const OPERATOR_SETTINGS = [
  "INNER_SIGNAL_PRIVATE_ROOT=/synthetic/private/vault",
  "INNER_SIGNAL_OAUTH_AUDIENCE=synthetic-audience",
  "INNER_SIGNAL_OPERATOR_OAUTH_JWKS_JSON={\"keys\":[]}",
  "INNER_SIGNAL_OPERATOR_CASE_ACL_JSON=[]",
  "INNER_SIGNAL_CASE_KEYS_JSON={}"
];

async function privateDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "journal-operator-auth-"));
  await fs.chmod(dir, 0o700);
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

async function envFile(dir, name, text, mode = 0o600) {
  const file = path.join(dir, name);
  await fs.writeFile(file, text, { mode });
  await fs.chmod(file, mode);
  return file;
}

function tokenServer({ lifetimes = [300], failWith = null } = {}) {
  const calls = [];
  let index = 0;
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: Object.fromEntries(new URLSearchParams(init.body)), redirect: init.redirect });
    if (failWith) return { ok: false, status: failWith, json: async () => ({ error: SECRET }) };
    const lifetime = lifetimes[Math.min(index, lifetimes.length - 1)];
    index += 1;
    return { ok: true, status: 200, json: async () => ({ access_token: `token-${index}`, token_type: "Bearer", expires_in: lifetime }) };
  };
  return { calls, fetchImpl };
}

test("private env files: KEY=VALUE, comments, first '=' split, outer quotes, first value wins", async (t) => {
  const dir = await privateDir(t);
  const file = await envFile(dir, "a.env", [
    "# comment",
    "",
    "PLAIN=value",
    "export EXPORTED=yes",
    "JSON_VALUE=[{\"subject\":\"s\",\"a\":\"b=c\"}]",
    "QUOTED=\"quoted value\"",
    "PLAIN=second"
  ].join("\n"));
  const values = await readPrivateJournalEnvFile(file);
  assert.deepEqual({ ...values }, {
    PLAIN: "value",
    EXPORTED: "yes",
    JSON_VALUE: "[{\"subject\":\"s\",\"a\":\"b=c\"}]",
    QUOTED: "quoted value"
  });
});

test("private env files must be absolute, private, regular and well formed", async (t) => {
  const dir = await privateDir(t);
  const open = await envFile(dir, "open.env", "A=1\n", 0o640);
  await assert.rejects(() => readPrivateJournalEnvFile(open), { code: "JOURNAL_ENV_FILE_MODE_INVALID" });
  await assert.rejects(() => readPrivateJournalEnvFile("relative.env"), { code: "JOURNAL_ENV_FILE_PATH_INVALID" });
  const target = await envFile(dir, "target.env", "A=1\n");
  const link = path.join(dir, "link.env");
  await fs.symlink(target, link);
  await assert.rejects(() => readPrivateJournalEnvFile(link), { code: "JOURNAL_ENV_FILE_UNREADABLE" });
  const bad = await envFile(dir, "bad.env", "lower=1\n");
  await assert.rejects(() => readPrivateJournalEnvFile(bad), { code: "JOURNAL_ENV_FILE_INVALID" });
  const inside = path.resolve("package.json");
  await assert.rejects(() => readPrivateJournalEnvFile(inside), { code: "JOURNAL_ENV_FILE_LOCATION_INVALID" });
});

test("the operator token is fetched with client credentials and renewed before it expires", async () => {
  let clock = 1_000_000;
  const server = tokenServer({ lifetimes: [300, 300] });
  const provider = createOperatorTokenProvider({ issuer: `${ISSUER}/`, clientId: "operator", clientSecret: SECRET,
    fetchImpl: server.fetchImpl, now: () => clock });
  assert.deepEqual(await provider(), { bearerToken: "token-1" });
  clock += 200_000;
  assert.deepEqual(await provider(), { bearerToken: "token-1" });
  clock += 50_000;
  assert.deepEqual(await provider(), { bearerToken: "token-2" });
  assert.equal(server.calls.length, 2);
  assert.equal(server.calls[0].url, `${ISSUER}/protocol/openid-connect/token`);
  assert.deepEqual(server.calls[0].body, { grant_type: "client_credentials", client_id: "operator", client_secret: SECRET });
  assert.equal(server.calls[0].redirect, "error");
});

test("short-lived tokens are still reused until halfway through their life", async () => {
  let clock = 0;
  const server = tokenServer({ lifetimes: [30, 30] });
  const provider = createOperatorTokenProvider({ issuer: ISSUER, clientId: "operator", clientSecret: SECRET,
    fetchImpl: server.fetchImpl, now: () => clock });
  await provider();
  clock = 14_000;
  await provider();
  assert.equal(server.calls.length, 1);
  clock = 15_000;
  assert.deepEqual(await provider(), { bearerToken: "token-2" });
  assert.equal(server.calls.length, 2);
});

test("unavailable commands are refused before any env file is read or token requested", async (t) => {
  const dir = await privateDir(t);
  const file = await envFile(dir, "operator.env", [
    `INNER_SIGNAL_OAUTH_ISSUER=${ISSUER}`,
    "INNER_SIGNAL_OPERATOR_CLIENT_ID=operator",
    `INNER_SIGNAL_OPERATOR_CLIENT_SECRET=${SECRET}`,
    ...OPERATOR_SETTINGS
  ].join("\n"));
  const server = tokenServer();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = server.fetchImpl;
  t.after(() => { globalThis.fetch = originalFetch; });
  let errors = "";
  const code = await runJournalImportCli(["export", "--config", path.join(dir, "run.json"), "--env-file", file], {
    environment: {}, stdout: { write: () => {} }, stderr: { write: (chunk) => { errors += chunk; } }
  });
  assert.equal(code, 1);
  assert.equal(JSON.parse(errors).error, "JOURNAL_COMMAND_NOT_AVAILABLE");
  assert.equal(server.calls.length, 0);
});

test("a failed early renewal keeps the still-valid token and retries on a later check", async () => {
  let clock = 0;
  let failNext = false;
  const server = tokenServer({ lifetimes: [300, 300] });
  const fetchImpl = async (url, init) => {
    if (failNext) { failNext = false; throw new Error(SECRET); }
    return server.fetchImpl(url, init);
  };
  const provider = createOperatorTokenProvider({ issuer: ISSUER, clientId: "operator", clientSecret: SECRET, fetchImpl, now: () => clock });
  assert.deepEqual(await provider(), { bearerToken: "token-1" });
  clock = 250_000;
  failNext = true;
  assert.deepEqual(await provider(), { bearerToken: "token-1" });
  assert.deepEqual(await provider(), { bearerToken: "token-2" });
  clock = 250_000 + 300_000;
  failNext = true;
  await assert.rejects(provider, { code: "OPERATOR_TOKEN_UNAVAILABLE" });
});

test("a missing or unresolved config fails before any env file is read or token requested", async (t) => {
  const dir = await privateDir(t);
  const file = await envFile(dir, "operator.env", [
    `INNER_SIGNAL_OAUTH_ISSUER=${ISSUER}`,
    "INNER_SIGNAL_OPERATOR_CLIENT_ID=operator",
    `INNER_SIGNAL_OPERATOR_CLIENT_SECRET=${SECRET}`,
    ...OPERATOR_SETTINGS
  ].join("\n"));
  const unresolved = await envFile(dir, "unresolved.json", "{}");
  const resolvedButUnrunnable = await envFile(dir, "unrunnable.json", JSON.stringify({
    schema_version: 1, target_profile: { case_id: "synthetic-case" }, private_runtime_root: path.join(dir, "vault"),
    max_external_spend_usd: 5
  }));
  const server = tokenServer();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = server.fetchImpl;
  t.after(() => { globalThis.fetch = originalFetch; });
  for (const [command, configPath, expected] of [
    ["status", path.join(dir, "missing.json"), null],
    ["doctor", unresolved, "JOURNAL_CONFIG_UNRESOLVED"],
    ["run", unresolved, "JOURNAL_CONFIG_UNRESOLVED"],
    ["run", resolvedButUnrunnable, "JOURNAL_ZERO_SPEND_REQUIRED"]
  ]) {
    let errors = "";
    const code = await runJournalImportCli([command, "--config", configPath, "--env-file", file], {
      environment: {}, stdout: { write: () => {} }, stderr: { write: (chunk) => { errors += chunk; } }
    });
    assert.equal(code, 1);
    if (expected) assert.equal(JSON.parse(errors).error, expected);
    assert.ok(!errors.includes(SECRET));
  }
  assert.equal(server.calls.length, 0);
});

test("a stalled token endpoint times out, and an early renewal falls back to the valid token", async () => {
  let clock = 0;
  let stall = false;
  let served = 0;
  const fetchImpl = (url, init) => {
    if (stall) return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error(SECRET))));
    served += 1;
    return Promise.resolve({ ok: true, json: async () => ({ access_token: `token-${served}`, token_type: "Bearer", expires_in: 300 }) });
  };
  const provider = createOperatorTokenProvider({ issuer: ISSUER, clientId: "operator", clientSecret: SECRET,
    fetchImpl, now: () => clock, requestTimeoutMs: 50 });
  assert.deepEqual(await provider(), { bearerToken: "token-1" });
  stall = true;
  clock = 250_000;
  const started = Date.now();
  assert.deepEqual(await provider(), { bearerToken: "token-1" });
  assert.ok(Date.now() - started < 2_000);
  clock = 400_000;
  await assert.rejects(provider, (error) => error.code === "OPERATOR_TOKEN_UNAVAILABLE" && !error.message.includes(SECRET));
});

test("sign-in waits until the other operator settings are present and well formed", async (t) => {
  const dir = await privateDir(t);
  for (const broken of [
    OPERATOR_SETTINGS.filter((line) => !line.startsWith("INNER_SIGNAL_OAUTH_AUDIENCE=")),
    OPERATOR_SETTINGS.map((line) => line.startsWith("INNER_SIGNAL_CASE_KEYS_JSON=") ? "INNER_SIGNAL_CASE_KEYS_JSON={not json" : line),
    OPERATOR_SETTINGS.map((line) => line.startsWith("INNER_SIGNAL_PRIVATE_ROOT=") ? "INNER_SIGNAL_PRIVATE_ROOT=relative/vault" : line)
  ]) {
    const file = await envFile(dir, `broken-${Math.random().toString(16).slice(2)}.env`, [
      `INNER_SIGNAL_OAUTH_ISSUER=${ISSUER}`,
      "INNER_SIGNAL_OPERATOR_CLIENT_ID=operator",
      `INNER_SIGNAL_OPERATOR_CLIENT_SECRET=${SECRET}`,
      ...broken
    ].join("\n"));
    const server = tokenServer();
    const environment = {};
    const prepared = await prepareJournalOperatorEnvironment(environment, { envFiles: [file], fetchImpl: server.fetchImpl });
    assert.equal(prepared.authContextProvider, null);
    assert.equal(server.calls.length, 0);
    assert.equal(Object.hasOwn(environment, "INNER_SIGNAL_PRIVATE_CASE_OPERATION_TOKEN"), false);
    assert.equal(Object.hasOwn(environment, "INNER_SIGNAL_OPERATOR_CLIENT_SECRET"), false);
  }
});

test("concurrent callers share one token request", async () => {
  const server = tokenServer();
  const provider = createOperatorTokenProvider({ issuer: ISSUER, clientId: "operator", clientSecret: SECRET, fetchImpl: server.fetchImpl });
  const results = await Promise.all([provider(), provider(), provider()]);
  assert.deepEqual(results.map((item) => item.bearerToken), ["token-1", "token-1", "token-1"]);
  assert.equal(server.calls.length, 1);
});

test("token failures carry codes only, never the secret or the response", async () => {
  const denied = createOperatorTokenProvider({ issuer: ISSUER, clientId: "operator", clientSecret: SECRET,
    fetchImpl: tokenServer({ failWith: 401 }).fetchImpl });
  await assert.rejects(denied, (error) => error.code === "OPERATOR_TOKEN_UNAVAILABLE" && !JSON.stringify({ ...error, message: error.message }).includes(SECRET));
  const thrown = createOperatorTokenProvider({ issuer: ISSUER, clientId: "operator", clientSecret: SECRET,
    fetchImpl: async () => { throw new Error(SECRET); } });
  await assert.rejects(thrown, (error) => error.code === "OPERATOR_TOKEN_UNAVAILABLE" && !error.message.includes(SECRET) && !error.cause);
  const malformed = createOperatorTokenProvider({ issuer: ISSUER, clientId: "operator", clientSecret: SECRET,
    fetchImpl: async () => ({ ok: true, json: async () => ({ access_token: "", expires_in: 300 }) }) });
  await assert.rejects(malformed, { code: "OPERATOR_TOKEN_RESPONSE_INVALID" });
  assert.throws(() => createOperatorTokenProvider({ issuer: "http://auth.example.test/realms/x", clientId: "o", clientSecret: "s" }),
    { code: "OPERATOR_ISSUER_INVALID" });
});

test("preparing the environment fills from env files in place, fetches the first token and drops the client secret", async (t) => {
  const dir = await privateDir(t);
  const file = await envFile(dir, "operator.env", [
    `INNER_SIGNAL_OAUTH_ISSUER=${ISSUER}`,
    "INNER_SIGNAL_OPERATOR_CLIENT_ID=operator",
    `INNER_SIGNAL_OPERATOR_CLIENT_SECRET=${SECRET}`,
    ...OPERATOR_SETTINGS,
    "ALREADY_SET=from-file"
  ].join("\n"));
  const environment = { ALREADY_SET: "from-process" };
  const server = tokenServer();
  const prepared = await prepareJournalOperatorEnvironment(environment, { envFiles: [file], fetchImpl: server.fetchImpl });
  assert.equal(prepared.environment, environment);
  assert.equal(environment.ALREADY_SET, "from-process");
  assert.equal(environment.INNER_SIGNAL_PRIVATE_CASE_OPERATION_TOKEN, "token-1");
  assert.equal(Object.hasOwn(environment, "INNER_SIGNAL_OPERATOR_CLIENT_SECRET"), false);
  assert.ok(!JSON.stringify(environment).includes(SECRET));
  assert.deepEqual(await prepared.authContextProvider(), { bearerToken: "token-1" });

  const plain = { A: "1" };
  const unchanged = await prepareJournalOperatorEnvironment(plain);
  assert.equal(unchanged.environment, plain);
  assert.equal(unchanged.authContextProvider, null);
  assert.deepEqual(plain, { A: "1" });
});

function runnableConfig(dir, vaultRoot) {
  return JSON.stringify({
    schema_version: 1, target_profile: { case_id: "synthetic-case" }, private_runtime_root: vaultRoot,
    max_external_spend_usd: 0, execution_root: path.join(dir, "execution"), existing_grant_ref: "synthetic-grant",
    source: { relative_path: "source.txt", bytes: 1, sha256: "0".repeat(64) }
  });
}

test("sign-in waits when the settings name a different vault from the run config", async (t) => {
  const dir = await privateDir(t);
  const configPath = await envFile(dir, "run.json", runnableConfig(dir, path.join(dir, "other-vault")));
  const file = await envFile(dir, "operator.env", [
    `INNER_SIGNAL_OAUTH_ISSUER=${ISSUER}`,
    "INNER_SIGNAL_OPERATOR_CLIENT_ID=operator",
    `INNER_SIGNAL_OPERATOR_CLIENT_SECRET=${SECRET}`,
    ...OPERATOR_SETTINGS
  ].join("\n"));
  const server = tokenServer();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = server.fetchImpl;
  t.after(() => { globalThis.fetch = originalFetch; });
  let seen = null;
  const code = await runJournalImportCli(["status", "--config", configPath, "--env-file", file], {
    environment: {}, stdout: { write: () => {} }, stderr: { write: () => {} },
    runtimeFactory: async (input) => {
      seen = input;
      return { execute: async () => ({ stage: "INTAKE" }), close: async () => {} };
    }
  });
  assert.equal(code, 0);
  assert.equal(server.calls.length, 0);
  assert.equal(Object.hasOwn(seen, "authContextProvider"), false);
  assert.equal(Object.hasOwn(seen.environment, "INNER_SIGNAL_PRIVATE_CASE_OPERATION_TOKEN"), false);
});

test("the CLI loads --env-file and hands the renewing provider to the runtime", async (t) => {
  const dir = await privateDir(t);
  const configPath = await envFile(dir, "run.json", runnableConfig(dir, "/synthetic/private/vault"));
  const file = await envFile(dir, "operator.env", [
    `INNER_SIGNAL_OAUTH_ISSUER=${ISSUER}`,
    "INNER_SIGNAL_OPERATOR_CLIENT_ID=operator",
    `INNER_SIGNAL_OPERATOR_CLIENT_SECRET=${SECRET}`,
    ...OPERATOR_SETTINGS
  ].join("\n"));
  const server = tokenServer();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = server.fetchImpl;
  t.after(() => { globalThis.fetch = originalFetch; });
  let errors = "";
  let output = "";
  let seen = null;
  const code = await runJournalImportCli(["status", "--config", configPath, "--env-file", file], {
    environment: {},
    stdout: { write: (chunk) => { output += chunk; } },
    stderr: { write: (chunk) => { errors += chunk; } },
    runtimeFactory: async (input) => {
      seen = input;
      return { execute: async () => ({ stage: "INTAKE" }), close: async () => {} };
    }
  });
  assert.equal(code, 0, errors);
  assert.equal(JSON.parse(output).stage, "INTAKE");
  assert.equal(typeof seen.authContextProvider, "function");
  assert.deepEqual(await seen.authContextProvider(), { bearerToken: "token-1" });
  assert.equal(seen.environment.INNER_SIGNAL_PRIVATE_CASE_OPERATION_TOKEN, "token-1");
  assert.ok(!JSON.stringify(seen.environment).includes(SECRET));
  assert.ok(!output.includes(SECRET) && !errors.includes(SECRET));
  assert.equal(server.calls.length, 1);
});
