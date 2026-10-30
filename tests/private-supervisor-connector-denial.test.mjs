import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listenPrivateCaseMcp } from "../src/server/private-case-mcp.mjs";
import { createPrivateCaseAccessService } from "../src/storage/private-case-access.mjs";
import { createEncryptedPrivateCaseStore } from "../src/storage/private-case-store.mjs";
import { REPAIR_INDUCED_ERROR_CHECKS } from "../src/supervisor/private-candidate-lifecycle.mjs";
import { createPrivateSupervisorDraftService } from "../src/supervisor/private-supervisor-draft.mjs";

// Part A leaves the private connector read-only. The supervisor's four operations (prepare a response context, submit a candidate,
// get an approved artifact, record a reported delivery) are internal: no tool advertises them, no tool call reaches them, and a
// read of a case that holds a supervisor draft changes nothing on disk. Synthetic cases only.

const CASE_ID = "synthetic-connector-case";
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const START = Date.parse("2026-10-02T12:00:00.000Z");

const OPERATIONS = ["prepareResponseContext", "submitCandidateForReview", "getApprovedResponseArtifact", "recordReportedDelivery"];
const snake = (name) => name.replace(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`);
const STORE_MUTATORS = ["recordSupervisorInputs", "submitSupervisorDraft", "recordSupervisorAudit", "reconstructSupervisorDraft", "exportSupervisorArtifact", "recordSupervisorReport"];

const scriptedRuntime = () => ({
  async produceCandidate() { throw new Error("unused"); },
  async auditCandidate({ candidate }) {
    return {
      contextId: `context:auditor:${candidate.id}`,
      value: { findings: [], repair_induced_checks: candidate.parent_candidate_id == null ? [] : [...REPAIR_INDUCED_ERROR_CHECKS] },
      disclosureManifest: { exact_candidate_included: true, producer_hidden_reasoning_included: false }
    };
  },
  async repairCandidate() { throw new Error("unused"); }
});

// The access service is frozen, so a recording copy is built key by key: every method the connector reaches is noted by name.
function recordingCopy(access, calls) {
  return Object.freeze(Object.fromEntries(Object.entries(access).map(([key, value]) => [
    key,
    typeof value === "function" ? (...args) => { calls.push(key); return value.apply(access, args); } : value
  ])));
}

async function fingerprint(rootDir) {
  const hash = createHash("sha256");
  const walk = async (directory) => {
    for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) hash.update(path.relative(rootDir, full)).update("\0").update(await fs.readFile(full)).update("\0");
    }
  };
  await walk(rootDir);
  return hash.digest("hex");
}

async function setup(t) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-supervisor-connector-"));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  let tick = 0;
  const now = () => new Date(START + (tick += 1) * 1000).toISOString();
  const authorizationProvider = {
    async authorize({ authContext }) {
      return authContext?.bearerToken === "synthetic-token"
        ? { allowed: true, principalId: "principal:synthetic", scopes: ["case:read", "case:write", "case:audit"], purposes: [] }
        : { allowed: false };
    }
  };
  const keyProvider = {
    async getCaseKeyMaterial() {
      return { routineKek: Buffer.alloc(32, 61), recoverySecretBytes: Buffer.alloc(32, 62), accessAssurance: "development_external_file", provider: "development-file-provider" };
    }
  };
  const access = createPrivateCaseAccessService({ rootDir, authorizationProvider, keyProvider, allowDevelopmentFileProvider: true, now });
  const store = createEncryptedPrivateCaseStore({ rootDir, routineKek: Buffer.alloc(32, 61), recoverySecretBytes: Buffer.alloc(32, 62), developmentExternalCredentialAuthorized: true, now });
  t.after(() => store.close());
  await store.appendTranscriptTurn(CASE_ID, { id: "E1-user", exchange_id: "E1", role: "user", text: "Synthetic client message.", at: "2026-09-01T12:00:00.000Z", episode_id: "episode:synthetic" });
  // A draft that went through review, was exported, and was reported as sent: the richest supervisor state a read could meet.
  const service = createPrivateSupervisorDraftService({ privateCaseSource: access, modelRuntime: scriptedRuntime() });
  const owner = { bearerToken: "synthetic-token" };
  const submitted = await service.submitCandidateForReview({ caseId: CASE_ID, source: "external_draft", text: "Synthetic approved draft.", idempotencyKey: "connector-1", authContext: owner, channel: "owner_ui" });
  assert.equal(submitted.status, "approved");
  return { rootDir, store, access, service, artifactId: submitted.artifact.artifact_id, owner };
}

async function rpc(url, method, params = {}, token = "synthetic-token") {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  });
  return { status: response.status, body: await response.json() };
}

test("the connector advertises only read-only tools and none of the supervisor's operations", async (t) => {
  const { access } = await setup(t);
  const listener = await listenPrivateCaseMcp({ caseAccessService: access, therapyProtocol: null, port: 0 });
  t.after(() => listener.close());
  const { body } = await rpc(listener.url, "tools/list");
  const tools = body.result.tools;
  assert.ok(tools.length > 0);
  for (const tool of tools) {
    assert.equal(tool.annotations.readOnlyHint, true, `${tool.name} is read-only`);
    assert.equal(tool.annotations.destructiveHint, false, tool.name);
  }
  const advertised = new Set(tools.map((tool) => tool.name));
  for (const operation of OPERATIONS) {
    assert.equal(advertised.has(operation), false, operation);
    assert.equal(advertised.has(snake(operation)), false, snake(operation));
  }
  const text = JSON.stringify(body);
  for (const operation of OPERATIONS) assert.equal(text.includes(operation) || text.includes(snake(operation)), false, `${operation} appears nowhere in the tool list or its descriptions`);
});

test("calling a supervisor operation through the connector is refused and changes nothing", async (t) => {
  const { access, rootDir, artifactId } = await setup(t);
  const calls = [];
  // Every method the connector reaches on the access service is recorded, so a mutator that was called is seen even if it failed.
  const recording = recordingCopy(access, calls);
  const listener = await listenPrivateCaseMcp({ caseAccessService: recording, therapyProtocol: null, port: 0 });
  t.after(() => listener.close());
  const before = await fingerprint(rootDir);

  const attempts = [];
  for (const operation of OPERATIONS) {
    for (const name of [operation, snake(operation)]) {
      attempts.push([name, { case_id: CASE_ID, caseId: CASE_ID, artifact_id: artifactId, artifactId, text: "Synthetic bytes a connector must not submit.", source: "external_draft", idempotency_key: "connector-attempt" }]);
    }
  }
  for (const [name, args] of attempts) {
    const { status, body } = await rpc(listener.url, "tools/call", { name, arguments: args });
    assert.equal(status, 422, name);
    assert.equal(body.error.data.code, "MCP_TOOL_NOT_FOUND", name);
    assert.equal(JSON.stringify(body).includes("Synthetic bytes a connector must not submit."), false, `${name} echoes nothing it was given`);
  }
  // No bearer token is no better.
  assert.equal((await rpc(listener.url, "tools/call", { name: "submitCandidateForReview", arguments: { case_id: CASE_ID } }, null)).status, 422);

  assert.equal(await fingerprint(rootDir), before, "no byte of the case changed");
  for (const mutator of STORE_MUTATORS) assert.equal(calls.includes(mutator), false, `${mutator} was never reached`);
  assert.deepEqual(calls, [], "a refused tool call does not even read the case");
});

test("reading a case that holds an approved, exported and reported supervisor draft through every read tool changes nothing", async (t) => {
  const { access, rootDir, store, service, artifactId, owner } = await setup(t);
  await service.getApprovedResponseArtifact({ caseId: CASE_ID, artifactId, authContext: owner, channel: "owner_ui" });
  await service.recordReportedDelivery({ caseId: CASE_ID, artifactId, idempotencyKey: "connector-report", authContext: owner, channel: "owner_ui" });
  const recordBefore = await store.load(CASE_ID);
  assert.deepEqual(recordBefore.communication_events.map((event) => event.kind), ["exported", "reported_sent"]);
  assert.equal(recordBefore.communication_events[1].provenance.actor_resolution, "owner_verified", "the fixture is the richest state: an owner-verified report");

  const calls = [];
  const recording = recordingCopy(access, calls);
  const listener = await listenPrivateCaseMcp({ caseAccessService: recording, therapyProtocol: null, port: 0 });
  t.after(() => listener.close());
  const listed = (await rpc(listener.url, "tools/list")).body.result.tools;
  const before = await fingerprint(rootDir);

  const candidateId = recordBefore.candidate_responses.at(-1).id;
  const generic = { case_id: CASE_ID, candidate_id: candidateId, case_alias: "synthetic", query: "synthetic", points: ["Synthetic point"], variables: [], source_artifact_id: "source:none", limit: 5 };
  const outcomes = {};
  for (const tool of listed) {
    // A tool that needs data this synthetic case lacks fails safely; what matters is that none of them writes.
    const properties = Object.keys(tool.inputSchema?.properties ?? {});
    const args = Object.fromEntries(properties.filter((key) => Object.hasOwn(generic, key)).map((key) => [key, generic[key]]));
    const { status } = await rpc(listener.url, "tools/call", { name: tool.name, arguments: args });
    outcomes[tool.name] = status;
  }
  assert.ok(Object.keys(outcomes).length >= 10, "the sweep covered the connector's tools");
  assert.equal(await fingerprint(rootDir), before, "no read tool wrote anything");
  for (const mutator of STORE_MUTATORS) assert.equal(calls.includes(mutator), false, `${mutator} was never reached by a read tool`);
  const recordAfter = await store.load(CASE_ID);
  assert.deepEqual(recordAfter.communication_events, recordBefore.communication_events);
  assert.deepEqual(recordAfter.candidate_responses.map((candidate) => [candidate.id, candidate.status]), recordBefore.candidate_responses.map((candidate) => [candidate.id, candidate.status]));
  assert.equal(recordAfter.supervisor_artifacts.length, recordBefore.supervisor_artifacts.length);
});

test("the connector's source holds no path to the supervisor's operations", async () => {
  const source = await fs.readFile(path.join(repositoryRoot, "src/server/private-case-mcp.mjs"), "utf8");
  for (const operation of OPERATIONS) {
    assert.equal(source.includes(operation), false, operation);
    assert.equal(source.includes(snake(operation)), false, snake(operation));
  }
  for (const mutator of STORE_MUTATORS) assert.equal(source.includes(mutator), false, mutator);
  assert.equal(/private-supervisor-draft|supervisor-draft/u.test(source), false, "the connector does not import the draft service");
});
