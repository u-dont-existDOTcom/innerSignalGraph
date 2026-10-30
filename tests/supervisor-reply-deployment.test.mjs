import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createEncryptedPrivateCaseStore } from "../src/storage/private-case-store.mjs";
import { createSupervisorReplyConnector, supervisorRepliesEnabled } from "../src/server/supervisor-reply-setup.mjs";
import { CASE_ID, NEW_SCOPE, REPLY_TOOLS, fingerprintOf, makeReplyEnvironment, rpc, scriptedProvider, seedReplyCase } from "./fixtures/supervisor-reply-environment.mjs";

// How the reply-draft tools are switched on and what they need: the setting, the model settings, and the hosted image's files.
// The first tests drive the setup code directly; the rest start the hosted connector as it is deployed (the real command-line
// entry point, as a child process on a synthetic credentials file) and talk to it over HTTP. The review itself is covered in
// supervisor-reply-connector.test.mjs and supervisor-reply-async.test.mjs. Synthetic data only.

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SETTING = "INNER_SIGNAL_MCP_SUPERVISOR_DRAFTS";
const API_SETTINGS = Object.freeze({
  INNER_SIGNAL_MODE: "api",
  OPENAI_API_KEY: "synthetic-openai-key-not-real",
  ANTHROPIC_API_KEY: "synthetic-anthropic-key-not-real",
  ACKNOWLEDGE_PROVIDER_RETENTION: "true"
});
// Settings the tests control; anything else in the developer's shell is passed through untouched.
const CONTROLLED = ["INNER_SIGNAL_MODE", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "ACKNOWLEDGE_PROVIDER_RETENTION", "PRIVATE_RUNTIME_INVOCATION_ATTEMPTS", SETTING,
  "INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT", "INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_BASE64", "INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_FILE", "INNER_SIGNAL_JOURNAL_WORK_CASE_ID"];
const sha256Hex = (value) => createHash("sha256").update(value).digest("hex");
const INITIALIZE = { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "synthetic", version: "1" } };

// A synthetic credentials file with two bearer tokens on one case, and that case seeded in a store on disk.
async function setup(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "supervisor-reply-cli-"));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const vaults = path.join(base, "vaults");
  await fs.mkdir(vaults, { mode: 0o700 });
  const routineKek = randomBytes(32);
  const recoverySecret = randomBytes(32);
  const tokens = { scoped: `scoped-${randomBytes(12).toString("hex")}`, reader: `reader-${randomBytes(12).toString("hex")}` };
  const credentialsPath = path.join(base, "credentials.json");
  await fs.writeFile(credentialsPath, JSON.stringify({
    schema_version: 1,
    root_dir: vaults,
    grants: [
      { token_sha256: sha256Hex(tokens.scoped), principal_id: "synthetic-reply-agent", case_ids: [CASE_ID], scopes: [NEW_SCOPE] },
      { token_sha256: sha256Hex(tokens.reader), principal_id: "synthetic-reader", case_ids: [CASE_ID], scopes: ["case:read"] }
    ],
    case_keys: { [CASE_ID]: { routine_kek_base64: routineKek.toString("base64"), recovery_secret_base64: recoverySecret.toString("base64") } }
  }), { mode: 0o600 });
  const store = createEncryptedPrivateCaseStore({ rootDir: vaults, routineKek, recoverySecretBytes: recoverySecret, developmentExternalCredentialAuthorized: true });
  await seedReplyCase(store, CASE_ID);
  store.close();
  return { base, vaults, credentialsPath, tokens, secrets: [routineKek.toString("base64"), recoverySecret.toString("base64")] };
}

// Starts the connector from `entry` (the repository's, or a copy laid out like the hosted image) and waits until it is ready.
async function start(t, environment, { entry = path.join(repositoryRoot, "src/cli/private-case-mcp.mjs"), cwd = repositoryRoot, settings = {} } = {}) {
  const env = { ...process.env };
  for (const key of CONTROLLED) delete env[key];
  Object.assign(env, settings);
  const readyPath = path.join(environment.base, `ready-${randomBytes(4).toString("hex")}.json`);
  const child = spawn(process.execPath, [entry, "--credentials", environment.credentialsPath, "--port", "0", "--ready-file", readyPath], {
    cwd,
    env,
    stdio: ["ignore", "ignore", "pipe"]
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const exited = new Promise((resolve) => child.once("exit", (code) => resolve(code)));
  t.after(() => child.kill("SIGTERM"));
  let stopped = false;
  void exited.then(() => { stopped = true; });
  let ready = null;
  for (let attempt = 0; attempt < 1_200 && ready === null; attempt += 1) {
    const text = await fs.readFile(readyPath, "utf8").catch(() => null);
    if (text != null) ready = JSON.parse(text);
    else if (stopped) break;
    else await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.ok(ready, `the connector did not become ready; stderr=${stderr}`);
  return {
    ready,
    url: ready.mcpUrl,
    stderr: () => stderr,
    stop: async () => { child.kill("SIGTERM"); await exited; },
    toolNames: async (token = null) => (await rpc(ready.mcpUrl, "tools/list", {}, token)).body.result.tools.map((tool) => tool.name),
    instructions: async () => (await rpc(ready.mcpUrl, "initialize", INITIALIZE)).body.result.instructions,
    call: async (name, args, token) => {
      const { status, body } = await rpc(ready.mcpUrl, "tools/call", { name, arguments: args }, token);
      return { status, body, structured: body.result?.structuredContent ?? null, isError: body.result?.isError === true };
    }
  };
}

const reviewEvents = (run) => run.stderr().split("\n").filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter((event) => event?.event === "supervisor_review");

// The final stage of Dockerfile.private-case-mcp, as the list of files it copies into the image.
async function imageCopies() {
  const text = await fs.readFile(path.join(repositoryRoot, "Dockerfile.private-case-mcp"), "utf8");
  const finalStage = text.split(/^FROM /mu).at(-1);
  return finalStage.split("\n").map((line) => line.trim()).filter((line) => line.startsWith("COPY ")).map((line) => {
    const parts = line.slice("COPY ".length).trim().split(/\s+/u);
    const from = parts[0].startsWith("--from=") ? parts.shift().slice("--from=".length) : null;
    const destination = parts.pop();
    return { from, sources: parts, destination };
  });
}

// A directory holding exactly what the hosted image holds: the Dockerfile's own COPY lines, nothing else. Dependencies are the
// repository's installed ones, linked in where the image would carry its own copy. Nothing is a link into the repository's source,
// so a file the image does not carry is a file the code cannot find.
async function imageLayout(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "supervisor-reply-image-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const copy of await imageCopies()) {
    if (copy.from) {
      await fs.symlink(path.join(repositoryRoot, "node_modules"), path.join(root, copy.destination));
      continue;
    }
    for (const source of copy.sources) {
      const inDirectory = copy.sources.length > 1 || copy.destination.endsWith("/");
      const target = inDirectory ? path.join(root, copy.destination, path.basename(source)) : path.join(root, copy.destination);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.cp(path.join(repositoryRoot, source), target, { recursive: true });
    }
  }
  return root;
}

test("the setting reads true or false, and anything else is an error rather than a guess", () => {
  for (const off of [undefined, "", "  ", "false", "FALSE", "0", "no", "off"]) assert.equal(supervisorRepliesEnabled({ [SETTING]: off }), false, `${JSON.stringify(off)} is off`);
  for (const on of ["true", "TRUE", " true ", "1", "yes", "on"]) assert.equal(supervisorRepliesEnabled({ [SETTING]: on }), true, `${JSON.stringify(on)} is on`);
  for (const bad of ["maybe", "2", "enabled", "tru"]) assert.throws(() => supervisorRepliesEnabled({ [SETTING]: bad }), /must be true or false/u);
  assert.equal(supervisorRepliesEnabled({}), false, "unset is off");
});

// A throwing stand-in that proves the model settings and provider code are not touched.
const untouched = (name) => () => { throw new Error(`${name} must not be called`); };

test("the setting off builds nothing, and on without a model mode builds no provider", async (t) => {
  const { access } = await makeReplyEnvironment(t, { withTools: false });
  const events = [];
  const options = { access, loadConfigFn: untouched("loadConfig"), createProvidersFn: untouched("createProviders"), log: (event) => events.push(event) };
  assert.equal(await createSupervisorReplyConnector({ ...options, environment: {} }), null);
  assert.equal(await createSupervisorReplyConnector({ ...options, environment: { [SETTING]: "false", INNER_SIGNAL_MODE: "api" } }), null);
  assert.deepEqual(events, [], "nothing is logged while the feature is off");
  for (const mode of [undefined, "mock", "", "API", "something"]) {
    const connector = await createSupervisorReplyConnector({ ...options, environment: { [SETTING]: "true", ...(mode === undefined ? {} : { INNER_SIGNAL_MODE: mode }) } });
    assert.equal(connector.reviewAvailable, false, `mode ${JSON.stringify(mode)} gives no review`);
  }
  assert.deepEqual(events, Array(5).fill({ event: "supervisor_review", available: false, reason: "NO_PROVIDER_MODE" }));
});

test("model settings that fail to load leave the tools offered but review unavailable, for a stated reason that carries no detail", async (t) => {
  const { access } = await makeReplyEnvironment(t, { withTools: false });
  const environment = { [SETTING]: "true", INNER_SIGNAL_MODE: "api" };
  const failures = [
    [Object.assign(new Error("OPENAI_API_KEY=sk-synthetic-detail is required"), { code: "BAD_CONFIG" }), "BAD_CONFIG"],
    [new Error("sk-synthetic-secret-detail"), "PROVIDER_SETUP_FAILED"],
    [Object.assign(new Error("sk-synthetic-secret-detail"), { code: "not a fixed word, with sk-synthetic-secret-detail" }), "PROVIDER_SETUP_FAILED"]
  ];
  for (const [error, reason] of failures) {
    for (const where of ["loadConfigFn", "createProvidersFn"]) {
      const events = [];
      const options = { access, environment, log: (event) => events.push(event), loadConfigFn: () => ({}), createProvidersFn: () => ({}), [where]: () => { throw error; } };
      const connector = await createSupervisorReplyConnector(options);
      assert.equal(connector.reviewAvailable, false);
      assert.deepEqual(events, [{ event: "supervisor_review", available: false, reason }]);
      assert.ok(!JSON.stringify(events).includes("synthetic"), "no setting or key value reaches the log");
    }
  }
});

test("model settings that load give an available review, and a log sink that fails cannot stop startup", async (t) => {
  const { access } = await makeReplyEnvironment(t, { withTools: false });
  const provider = scriptedProvider();
  const loaded = [];
  const connector = await createSupervisorReplyConnector({
    access,
    environment: { [SETTING]: "true", INNER_SIGNAL_MODE: "cli" },
    loadConfigFn: () => { loaded.push("config"); return { privateRuntimeInvocationAttempts: 3 }; },
    createProvidersFn: (config) => { loaded.push(config); return { anthropic: provider, renderer: provider }; },
    log: () => { throw new Error("log sink is down"); }
  });
  assert.equal(connector.reviewAvailable, true);
  assert.deepEqual(loaded, ["config", { privateRuntimeInvocationAttempts: 3 }]);
  assert.deepEqual([...connector.names].sort(), [...REPLY_TOOLS].sort());
});

test("a host can supply its own review runtime, or none, and the setup needs an access service that has the reply-draft path", async (t) => {
  const { access } = await makeReplyEnvironment(t, { withTools: false });
  const environment = { [SETTING]: "true" };
  assert.equal((await createSupervisorReplyConnector({ access, environment, modelRuntime: null })).reviewAvailable, false);
  const runtime = { async auditCandidate() {}, async repairCandidate() {}, async produceCandidate() {} };
  assert.equal((await createSupervisorReplyConnector({ access, environment, modelRuntime: runtime })).reviewAvailable, true);
  await assert.rejects(createSupervisorReplyConnector({ access: {}, environment }), TypeError);
  await assert.rejects(createSupervisorReplyConnector({ access: { supervisorDraftAccess: {} }, environment }), TypeError);
  assert.equal(await createSupervisorReplyConnector({ access: {}, environment: {} }), null, "off needs no access service at all");
});

test("with the setting off the connector starts and advertises exactly what it did before", async (t) => {
  const environment = await setup(t);
  const unset = await start(t, environment);
  const disabled = await start(t, environment, { settings: { [SETTING]: "false" } });
  for (const run of [unset, disabled]) {
    assert.deepEqual(Object.keys(run.ready), ["ready", "mcpUrl", "provider", "productionReady", "journalEnabled", "journalWork"], "the ready line gains no field");
    const names = await run.toolNames();
    for (const tool of REPLY_TOOLS) assert.ok(!names.includes(tool), `${tool} is not offered`);
    assert.ok(names.includes("load_case_context"), "the existing tools are still there");
    assert.doesNotMatch(await run.instructions(), /reply[- ]draft/iu);
    assert.deepEqual(reviewEvents(run), [], "nothing about the review is logged");
    const refused = await run.call("submit_reply_draft", { case_id: CASE_ID, source: "external_draft", text: "Synthetic reply.", idempotency_key: "key-1" }, environment.tokens.scoped);
    assert.equal(refused.status, 422);
    assert.equal(refused.body.error.data.code, "MCP_TOOL_NOT_FOUND", "the tool does not exist");
  }
  assert.deepEqual(await unset.toolNames(), await disabled.toolNames());
});

test("a setting that is neither true nor false stops the connector from starting", async (t) => {
  const environment = await setup(t);
  const run = spawn(process.execPath, [path.join(repositoryRoot, "src/cli/private-case-mcp.mjs"), "--credentials", environment.credentialsPath, "--port", "0"], {
    cwd: repositoryRoot,
    env: { ...process.env, [SETTING]: "maybe" },
    stdio: ["ignore", "ignore", "pipe"]
  });
  t.after(() => run.kill("SIGTERM"));
  let stderr = "";
  run.stderr.setEncoding("utf8");
  run.stderr.on("data", (chunk) => { stderr += chunk; });
  const code = await new Promise((resolve) => run.once("exit", resolve));
  assert.notEqual(code, 0);
  assert.match(stderr, /INNER_SIGNAL_MCP_SUPERVISOR_DRAFTS must be true or false/u);
});

test("with the setting on and no model configured the tools are offered, say review is unavailable, and approve nothing", async (t) => {
  const environment = await setup(t);
  const before = await fingerprintOf(environment.vaults);
  const run = await start(t, environment, { settings: { [SETTING]: "true" } });
  assert.equal(run.ready.supervisorDrafts, true);
  assert.equal(run.ready.supervisorReview, "unavailable");
  assert.deepEqual(reviewEvents(run), [{ event: "supervisor_review", available: false, reason: "NO_PROVIDER_MODE" }]);
  const names = await run.toolNames();
  for (const tool of REPLY_TOOLS) assert.ok(names.includes(tool), `${tool} is offered`);
  assert.match(await run.instructions(), /reply-draft/iu);

  const snapshot = await run.call("get_reply_draft_context", { case_id: CASE_ID }, environment.tokens.scoped);
  assert.equal(snapshot.isError, false, JSON.stringify(snapshot.body).slice(0, 300));
  const submitted = await run.call("submit_reply_draft", { case_id: CASE_ID, source: "external_draft", text: "Synthetic reply.", idempotency_key: "key-1" }, environment.tokens.scoped);
  assert.equal(submitted.isError, true);
  assert.equal(submitted.structured.code, "SUPERVISOR_REVIEW_UNAVAILABLE");

  // The permission is the whole gate: a token that can read the case cannot use the new tools, and one that holds only the new
  // permission cannot use the existing read tools.
  const readerRefused = await run.call("get_reply_draft_context", { case_id: CASE_ID }, environment.tokens.reader);
  assert.equal(readerRefused.status, 401, "a read-only token cannot use the reply-draft tools");
  const scopedRead = await run.call("load_case_context", { case_id: CASE_ID }, environment.tokens.scoped);
  assert.equal(scopedRead.status, 401, "the new permission opens nothing else");
  const anonymous = await run.call("get_reply_draft_context", { case_id: CASE_ID }, null);
  assert.equal(anonymous.status, 401);

  await run.stop();
  const log = run.stderr();
  for (const secret of [...Object.values(environment.tokens), ...environment.secrets]) assert.ok(!log.includes(secret), "no token or key reaches the log");
  assert.equal(await fingerprintOf(environment.vaults), before, "the stored case is exactly as it was: no draft, no candidate, no event");
});

test("with the setting on and the model settings incomplete, review is unavailable for a stated reason and the connector still starts", async (t) => {
  const environment = await setup(t);
  const run = await start(t, environment, { settings: { [SETTING]: "true", INNER_SIGNAL_MODE: "api" } });
  assert.equal(run.ready.supervisorDrafts, true);
  assert.equal(run.ready.supervisorReview, "unavailable");
  assert.deepEqual(reviewEvents(run), [{ event: "supervisor_review", available: false, reason: "BAD_CONFIG" }]);
  const submitted = await run.call("submit_reply_draft", { case_id: CASE_ID, source: "external_draft", text: "Synthetic reply.", idempotency_key: "key-1" }, environment.tokens.scoped);
  assert.equal(submitted.structured.code, "SUPERVISOR_REVIEW_UNAVAILABLE");
});

test("with the setting on and the model configured the review is available, and starting makes no model call", async (t) => {
  const environment = await setup(t);
  const run = await start(t, environment, { settings: { [SETTING]: "true", ...API_SETTINGS } });
  assert.equal(run.ready.supervisorDrafts, true);
  assert.equal(run.ready.supervisorReview, "available");
  assert.deepEqual(reviewEvents(run), [{ event: "supervisor_review", available: true, reason: null }]);
  const snapshot = await run.call("get_reply_draft_context", { case_id: CASE_ID }, environment.tokens.scoped);
  assert.equal(snapshot.isError, false);
  await run.stop();
  for (const secret of [API_SETTINGS.OPENAI_API_KEY, API_SETTINGS.ANTHROPIC_API_KEY]) assert.ok(!run.stderr().includes(secret), "no provider key reaches the log");
});

test("in the hosted image's file layout the connector starts whether the setting is off, or on with a model", async (t) => {
  const environment = await setup(t);
  const layout = await imageLayout(t);
  const entry = path.join(layout, "src/cli/private-case-mcp.mjs");
  const off = await start(t, environment, { entry, cwd: layout });
  assert.equal(off.ready.supervisorDrafts, undefined);
  assert.ok(!(await off.toolNames()).includes("submit_reply_draft"));
  const on = await start(t, environment, { entry, cwd: layout, settings: { [SETTING]: "true", ...API_SETTINGS } });
  assert.equal(on.ready.supervisorReview, "available");
  assert.ok((await on.toolNames()).includes("submit_reply_draft"));
});

// A draft the backend writes needs the guide texts, the compiled guide graph and the romance-guide files, none of which the
// hosted image carried before. This runs the real model runtime's drafting step out of the image's file layout, with the
// repository's mock provider in place of a model service: it is the files that are being proved, not the model.
const PRODUCTION_PROBE = `
import path from "node:path";
import { pathToFileURL } from "node:url";
const [layout, vaults, caseId, fixturePath] = process.argv.slice(2);
const load = (relative) => import(pathToFileURL(path.join(layout, relative)).href);
try {
  const { loadConfig } = await load("src/core/config.mjs");
  const { createProviders } = await load("src/providers/factory.mjs");
  const { createPrivateTherapyModelRuntime } = await load("src/supervisor/private-therapy-model-runtime.mjs");
  const { createPrivateCaseAccessService } = await load("src/storage/private-case-access.mjs");
  const routineKek = Buffer.from(process.env.PROBE_ROUTINE_KEK, "base64");
  const recoverySecretBytes = Buffer.from(process.env.PROBE_RECOVERY_SECRET, "base64");
  const access = createPrivateCaseAccessService({
    rootDir: vaults,
    authorizationProvider: { async authorize() { return { allowed: true, principalId: "synthetic-probe", scopes: ["case:supervisor_draft"], purposes: [] }; } },
    keyProvider: { async getCaseKeyMaterial() { return { routineKek, recoverySecretBytes, accessAssurance: "development_external_file", provider: "development-file-provider" }; } },
    allowDevelopmentFileProvider: true
  });
  const ticket = await access.supervisorDraftAccess.authorize(caseId, { bearerToken: "synthetic-probe" });
  const config = loadConfig();
  const runtime = createPrivateTherapyModelRuntime({ privateCaseSource: access.supervisorDraftAccess.source, providers: createProviders(config, { fixturePath }), config });
  const produced = await runtime.produceCandidate({
    caseId,
    runtimeTurn: { id: "supervisor:probe", user_turn_id: "E2-user", inbound: { exact_text: "Synthetic newest client message waiting for a reply.", received_at: "2026-09-02T12:00:00.000Z" } },
    userInput: {},
    journalEvidence: null,
    authContext: ticket,
    attemptContextId: "attempt:probe",
    inboundAlreadyRecorded: true
  });
  console.log(JSON.stringify({ produced: typeof produced.exactText === "string" && produced.exactText.length > 0 }));
} catch (error) {
  console.log(JSON.stringify({ produced: false, code: error?.code ?? null, name: error?.name ?? null, message: String(error?.message ?? error).slice(0, 300) }));
}
`;

async function produceFrom(t, layout, environment, routineKek, recoverySecret) {
  const script = path.join(environment.base, `probe-${randomBytes(4).toString("hex")}.mjs`);
  await fs.writeFile(script, PRODUCTION_PROBE);
  const child = spawn(process.execPath, [script, layout, environment.vaults, CASE_ID, path.join(repositoryRoot, "fixtures/mock-responses/A001.json")], {
    cwd: layout,
    env: { ...process.env, INNER_SIGNAL_MODE: "mock", PROBE_ROUTINE_KEK: routineKek, PROBE_RECOVERY_SECRET: recoverySecret },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  t.after(() => child.kill("SIGTERM"));
  const code = await new Promise((resolve) => child.once("exit", resolve));
  const line = stdout.trim().split("\n").at(-1);
  assert.ok(line, `the probe printed nothing (exit ${code}); stderr=${stderr.slice(0, 300)}`);
  return JSON.parse(line);
}

test("every file a backend-written draft reads is in the hosted image's file layout", async (t) => {
  const environment = await setup(t);
  const layout = await imageLayout(t);
  const [routineKek, recoverySecret] = environment.secrets;
  const outcome = await produceFrom(t, layout, environment, routineKek, recoverySecret);
  assert.deepEqual(outcome, { produced: true });
});
