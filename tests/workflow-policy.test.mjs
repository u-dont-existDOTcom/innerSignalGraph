import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const auditScript = path.join(projectRoot, "scripts", "audit-workflows.mjs");
const pinnedCheckout = "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683";

async function fixture(t, workflow) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-workflow-policy-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, ".github", "workflows");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, "fixture.yml"), workflow);
  return root;
}

async function runAudit(root) {
  try {
    const result = await execFileAsync(process.execPath, [auditScript, "--root", root], {
      cwd: projectRoot
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      code: Number(error.code),
      stdout: String(error.stdout ?? ""),
      stderr: String(error.stderr ?? "")
    };
  }
}

function parseResult(result) {
  assert.notEqual(result.stdout.trim(), "", result.stderr);
  return JSON.parse(result.stdout);
}

test("a pull_request_target token inside a block script is not an event", async (t) => {
  const root = await fixture(t, `name: Policy
on:
  pull_request:
permissions:
  contents: read
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: ${pinnedCheckout}
      - run: |
          if "pull_request_target" in text and "actions/checkout@" in text:
              raise SystemExit(1)
`);

  const result = await runAudit(root);
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(parseResult(result).findings, []);
});

test("a real pull_request_target workflow that checks out code is rejected", async (t) => {
  const root = await fixture(t, `name: Unsafe
on:
  pull_request_target:
permissions:
  contents: read
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: ${pinnedCheckout}
`);

  const result = await runAudit(root);
  assert.equal(result.code, 1, `${result.stdout}\n${result.stderr}`);
  assert.ok(parseResult(result).findings.some(({ code }) => code === "pull-request-target-checkout"));
});

test("a flow-mapping pull_request_target workflow that checks out code is rejected", async (t) => {
  const root = await fixture(t, `name: Unsafe flow mapping
on: {push: {}, pull_request_target: {}}
permissions:
  contents: read
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: ${pinnedCheckout}
`);

  const result = await runAudit(root);
  assert.equal(result.code, 1, `${result.stdout}\n${result.stderr}`);
  assert.ok(parseResult(result).findings.some(({ code }) => code === "pull-request-target-checkout"));
});

test("a flow-style steps mapping cannot hide an unpinned privileged checkout", async (t) => {
  const root = await fixture(t, `name: Unsafe flow steps
on: {pull_request_target: {}}
permissions:
  contents: read
jobs:
  audit:
    runs-on: ubuntu-latest
    steps: [{uses: actions/checkout@v4}]
`);

  const result = await runAudit(root);
  assert.equal(result.code, 1, `${result.stdout}\n${result.stderr}`);
  const codes = new Set(parseResult(result).findings.map(({ code }) => code));
  assert.ok(codes.has("flow-steps-unsupported"));
  assert.ok(codes.has("action-ref-unpinned"));
  assert.ok(codes.has("pull-request-target-checkout"));
});

test("a flow-style step item inside a block steps sequence fails closed", async (t) => {
  const root = await fixture(t, `name: Unsafe flow step item
on: push
permissions:
  contents: read
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - {uses: actions/checkout@v4}
`);

  const result = await runAudit(root);
  assert.equal(result.code, 1, `${result.stdout}\n${result.stderr}`);
  assert.ok(parseResult(result).findings.some(({ code }) => code === "flow-steps-unsupported"));
});

test("multiline flow-style steps fail closed before an Action can hide", async (t) => {
  const root = await fixture(t, `name: Unsafe multiline flow steps
on: {pull_request_target: {}}
permissions:
  contents: read
jobs:
  audit:
    runs-on: ubuntu-latest
    steps: [{uses:
      actions/checkout@v4}]
`);

  const result = await runAudit(root);
  assert.equal(result.code, 1, `${result.stdout}\n${result.stderr}`);
  assert.ok(parseResult(result).findings.some(({ code }) => code === "flow-steps-unsupported"));
});

test("a flow-style steps collection beginning after the key fails closed", async (t) => {
  const root = await fixture(t, `name: Unsafe split flow steps
on: {pull_request_target: {}}
permissions:
  contents: read
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      [{uses:
          actions/checkout@v4}]
`);

  const result = await runAudit(root);
  assert.equal(result.code, 1, `${result.stdout}\n${result.stderr}`);
  assert.ok(parseResult(result).findings.some(({ code }) => code === "flow-steps-unsupported"));
});

test("a flow-style jobs collection beginning after the key fails closed", async (t) => {
  const root = await fixture(t, `name: Unsafe split flow jobs
on: push
permissions:
  contents: read
jobs:
  {audit: {runs-on: ubuntu-latest, steps:
    [{uses: actions/checkout@v4}]}}
`);

  const result = await runAudit(root);
  assert.equal(result.code, 1, `${result.stdout}\n${result.stderr}`);
  assert.ok(parseResult(result).findings.some(({ code }) => code === "flow-jobs-unsupported"));
});

test("a non-job steps scalar that resembles a flow collection remains valid", async (t) => {
  const root = await fixture(t, `name: Valid non-job steps scalar
on: push
permissions:
  contents: read
env:
  steps: "[literal text]"
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - run: echo ok
`);

  const result = await runAudit(root);
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(parseResult(result).findings, []);
});

test("a nested job environment key named steps remains valid", async (t) => {
  const root = await fixture(t, `name: Valid nested steps scalar
on: push
permissions:
  contents: read
jobs:
  audit:
    runs-on: ubuntu-latest
    env:
      steps: "[literal text]"
    steps:
      - run: echo ok
`);

  const result = await runAudit(root);
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(parseResult(result).findings, []);
});

test("plain-scalar apostrophes cannot hide a later flow-style Action", async (t) => {
  const root = await fixture(t, `name: Unsafe apostrophe flow step
on: {pull_request_target: {}}
permissions:
  contents: read
jobs:
  audit:
    runs-on: ubuntu-latest
    steps: [{name: don't pin me, uses: actions/checkout@v4}]
`);

  const result = await runAudit(root);
  assert.equal(result.code, 1, `${result.stdout}\n${result.stderr}`);
  assert.ok(parseResult(result).findings.some(({ code }) => code === "flow-steps-unsupported"));
});

test("unpinned remote Actions and write-all permissions are rejected", async (t) => {
  const root = await fixture(t, `name: Unsafe
on: [push]
permissions: write-all
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ./local-action
      - uses: docker://alpine:3.21
`);

  const result = await runAudit(root);
  assert.equal(result.code, 1, `${result.stdout}\n${result.stderr}`);
  const codes = new Set(parseResult(result).findings.map(({ code }) => code));
  assert.ok(codes.has("permissions-write-all"));
  assert.ok(codes.has("action-ref-unpinned"));
});

test("missing top-level permissions are rejected", async (t) => {
  const root = await fixture(t, `name: Missing permissions
on: push
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: ${pinnedCheckout}
`);

  const result = await runAudit(root);
  assert.equal(result.code, 1, `${result.stdout}\n${result.stderr}`);
  assert.ok(parseResult(result).findings.some(({ code }) => code === "permissions-missing"));
});

test("metadata-only pull_request_target without checkout is allowed", async (t) => {
  const root = await fixture(t, `name: Metadata only
on: pull_request_target
permissions:
  pull-requests: read
jobs:
  inspect:
    runs-on: ubuntu-latest
    steps:
      - run: echo metadata
`);

  const result = await runAudit(root);
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(parseResult(result).ok, true);
});

test("key-shaped text inside a list-form run block is not an Action reference", async (t) => {
  const root = await fixture(t, `name: Harmless block
on: push
permissions:
  contents: read
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - run: |
          uses: example/action@v1
`);

  const result = await runAudit(root);
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(parseResult(result).findings, []);
});

test("key-shaped text inside a quoted inline command is not an Action reference", async (t) => {
  const root = await fixture(t, `name: Harmless quoted command
on: push
permissions:
  contents: read
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - run: "echo '{uses: example/action@v1}'"
`);

  const result = await runAudit(root);
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(parseResult(result).findings, []);
});
