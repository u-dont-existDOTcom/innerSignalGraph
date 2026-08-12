import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildRemoteDiagnosticPayload,
  queueRemoteDiagnostic
} from "../src/diagnostics/remote-diagnostic.mjs";

const MACHINE_ID = "123e4567-e89b-42d3-a456-426614174000";
const INSTALLED_COMMIT = "0123456789abcdef0123456789abcdef01234567";
const CANDIDATE_COMMIT = "89abcdef0123456789abcdef0123456789abcdef";
const RUNTIME_SHA256 = "a".repeat(64);
const GRAPH_SHA256 = "b".repeat(64);

function safeInput(overrides = {}) {
  return {
    machineId: MACHINE_ID,
    createdAt: "2026-08-12T05:00:00.000Z",
    runtime: {
      version: "0.14.4",
      installedCommit: INSTALLED_COMMIT,
      nodeVersion: "v22.18.0"
    },
    update: {
      status: "validation-failed",
      candidateCommit: CANDIDATE_COMMIT
    },
    failure: {
      stage: "package-tests",
      classification: "TEST_FAILURE",
      actionCode: "KEEP_CURRENT_RUNTIME",
      retryable: false,
      exitCode: 1
    },
    tests: {
      format: "inner-signal-test-failure-v1",
      command: "npm test",
      exitCode: 1,
      counts: { tests: 193, pass: 192, fail: 1, skipped: 0 },
      failures: [{
        name: "building r02 does not rewrite the preserved r01 candidate contract or bytes",
        location: { file: "tests/guide-packet-r02.test.mjs", line: 97, column: 1 },
        errorCode: "ERR_ASSERTION",
        actual: RUNTIME_SHA256,
        expected: GRAPH_SHA256
      }]
    },
    integrity: {
      runtimeTreeSha256: RUNTIME_SHA256,
      graphBundleSha256: GRAPH_SHA256
    },
    ...overrides
  };
}

test("remote diagnostic is constructed from an exact allowlist and excludes private decoys", () => {
  const input = safeInput({
    chat: "PRIVATE_CHAT_MARKER",
    prompt: "PRIVATE_PROMPT_MARKER",
    reasoning: "PRIVATE_REASONING_MARKER",
    rawOutput: "PRIVATE_RAW_OUTPUT_MARKER",
    env: { GH_TOKEN: "PRIVATE_TOKEN_MARKER" },
    hostname: "private-hostname",
    username: "private-user",
    token: "github_pat_PRIVATE_CREDENTIAL_MARKER"
  });
  input.runtime.absolutePath = "/home/private-user/Téléchargements/inner-signal-runtime";
  input.failure.message = "PRIVATE_FAILURE_MESSAGE_MARKER";
  input.tests.failures[0].rawOutput = "PRIVATE_TEST_OUTPUT_MARKER";
  input.integrity.privateState = "PRIVATE_STATE_MARKER";

  const payload = buildRemoteDiagnosticPayload(input);

  assert.deepEqual(Object.keys(payload).sort(), [
    "createdAt", "failure", "format", "incidentId", "integrity",
    "machineId", "privacy", "runtime", "tests", "update"
  ]);
  assert.equal(payload.format, "inner-signal-remote-diagnostic-v1");
  assert.equal(payload.machineId, MACHINE_ID);
  assert.equal(payload.runtime.installedCommit, INSTALLED_COMMIT);
  assert.equal(payload.update.candidateCommit, CANDIDATE_COMMIT);
  assert.equal(payload.failure.actionCode, "KEEP_CURRENT_RUNTIME");
  assert.equal(payload.tests.failures[0].location.file, "tests/guide-packet-r02.test.mjs");
  assert.deepEqual(payload.integrity, {
    runtimeTreeSha256: RUNTIME_SHA256,
    graphBundleSha256: GRAPH_SHA256
  });
  assert.deepEqual(payload.privacy, {
    identity: "random-local-uuid",
    includesChatContent: false,
    includesCredentials: false,
    includesModelOutput: false,
    includesRawLogs: false
  });
  assert.doesNotMatch(
    JSON.stringify(payload),
    /PRIVATE_|github_pat_|private-hostname|private-user|\/home\//
  );
});

test("incident identity excludes timestamps but changes with stable safe failure fields", () => {
  const first = buildRemoteDiagnosticPayload(safeInput());
  const retried = buildRemoteDiagnosticPayload(safeInput({ createdAt: "2026-08-13T06:30:00.000Z" }));
  const differentFailure = buildRemoteDiagnosticPayload(safeInput({
    failure: {
      stage: "graph-regressions",
      classification: "TEST_FAILURE",
      actionCode: "KEEP_CURRENT_RUNTIME",
      retryable: false,
      exitCode: 1
    }
  }));

  assert.match(first.incidentId, /^[a-f0-9]{64}$/);
  assert.equal(retried.incidentId, first.incidentId);
  assert.notEqual(differentFailure.incidentId, first.incidentId);
});

test("malformed repository-derived fields, hashes, paths, and arbitrary test data are dropped", () => {
  const payload = buildRemoteDiagnosticPayload(safeInput({
    runtime: {
      version: "0.14.4 /home/private-user",
      installedCommit: "not-a-commit",
      nodeVersion: "$(PRIVATE_COMMAND)"
    },
    update: {
      status: "validation-failed; PRIVATE_COMMAND",
      candidateCommit: "f".repeat(39),
      branch: "../../PRIVATE_BRANCH"
    },
    failure: {
      stage: "/home/private-user/tests",
      classification: "PRIVATE CLASSIFICATION",
      actionCode: "PRIVATE-ACTION",
      retryable: "yes",
      exitCode: "1",
      path: "/home/private-user/private.json"
    },
    tests: {
      format: "inner-signal-test-failure-v1",
      command: "cat /home/private-user/private.json",
      exitCode: 1,
      counts: { tests: -1, pass: "192", arbitrary: 999 },
      failures: [{
        name: "PRIVATE_TEST_MARKER",
        location: { file: "/home/private-user/private.test.mjs", line: 1, column: 1 },
        errorCode: "private-error",
        actual: "PRIVATE_ACTUAL",
        expected: { secret: "PRIVATE_EXPECTED" }
      }, { arbitrary: "PRIVATE_OBJECT" }],
      arbitrary: { deep: "PRIVATE_TEST_OBJECT" }
    },
    integrity: {
      runtimeTreeSha256: "abc",
      graphBundleSha256: "/home/private-user/graph.json",
      arbitraryHash: "c".repeat(64)
    }
  }));

  assert.deepEqual(payload.runtime, {
    version: null,
    installedCommit: null,
    nodeVersion: null
  });
  assert.deepEqual(payload.update, { status: null, candidateCommit: null });
  assert.deepEqual(payload.failure, {
    stage: null,
    classification: null,
    actionCode: null,
    retryable: null,
    exitCode: null
  });
  assert.deepEqual(payload.tests, {
    format: "inner-signal-test-failure-v1",
    command: "package tests",
    exitCode: 1,
    counts: {},
    failures: []
  });
  assert.deepEqual(payload.integrity, {
    runtimeTreeSha256: null,
    graphBundleSha256: null
  });
  assert.doesNotMatch(JSON.stringify(payload), /PRIVATE_|\/home\/|arbitraryHash|arbitrary/);
});

test("queue persists a random machine identity and atomically writes a private outbox file", async (t) => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-remote-diagnostic-"));
  t.after(() => fs.rm(stateDir, { recursive: true, force: true }));
  let uuidCalls = 0;
  const randomUUID = () => {
    uuidCalls += 1;
    return MACHINE_ID;
  };

  const queued = await queueRemoteDiagnostic({
    stateDir,
    input: safeInput({ machineId: "00000000-0000-4000-8000-000000000000" }),
    now: () => new Date("2026-08-12T05:00:00.000Z"),
    randomUUID
  });
  const second = await queueRemoteDiagnostic({
    stateDir,
    input: safeInput({ machineId: "ffffffff-ffff-4fff-8fff-ffffffffffff" }),
    now: () => new Date("2026-08-13T05:00:00.000Z"),
    randomUUID
  });

  assert.equal(uuidCalls, 1);
  assert.equal(queued.payload.machineId, MACHINE_ID);
  assert.equal(second.payload.machineId, MACHINE_ID);
  assert.equal(second.incidentId, queued.incidentId);
  assert.equal(queued.path, path.join(stateDir, "diagnostic-outbox", `${queued.incidentId}.json`));
  assert.deepEqual(JSON.parse(await fs.readFile(queued.path, "utf8")), second.payload);
  assert.equal((await fs.stat(path.join(stateDir, "machine-id.txt"))).mode & 0o777, 0o600);
  assert.equal((await fs.stat(queued.path)).mode & 0o777, 0o600);
  assert.deepEqual(
    (await fs.readdir(path.join(stateDir, "diagnostic-outbox"))).sort(),
    [`${queued.incidentId}.json`]
  );
});
