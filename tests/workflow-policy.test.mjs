import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";
import { auditRepository } from "../scripts/audit-repository.mjs";
import { auditWorkflows } from "../scripts/audit-workflows.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pinnedCheckout = "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683";
const codeqlCheckout = "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1";
const codeqlAction = "ff2f1c621b7f889edc0d3c761ac2e6a3f8cdb0dd";
const exactCodeqlWorkflow = `name: CodeQL

on:
  pull_request:
  push:
    branches: [main, stable]
  schedule:
    - cron: "23 5 * * 3"
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: \${{ github.event_name == 'pull_request' }}

jobs:
  analyze:
    if: github.event.repository.private == false
    name: codeql-javascript
    runs-on: ubuntu-latest
    timeout-minutes: 30
    permissions:
      contents: read
      security-events: write
    steps:
      - name: Check out repository
        uses: ${codeqlCheckout}
        with:
          persist-credentials: false
      - name: Initialize CodeQL
        uses: github/codeql-action/init@${codeqlAction}
        with:
          languages: javascript-typescript
          queries: security-extended
      - name: Analyze
        uses: github/codeql-action/analyze@${codeqlAction}
`;

async function fixture(t, workflow) {
  return workflowFixture(t, { "fixture.yml": workflow });
}

async function workflowFixture(t, workflows) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-workflow-policy-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, ".github", "workflows");
  await fs.mkdir(directory, { recursive: true });
  for (const [name, workflow] of Object.entries(workflows)) {
    await fs.writeFile(path.join(directory, name), workflow);
  }
  return root;
}

async function safeWorkflowFile(root, name = "safe.yml") {
  const file = path.join(root, name);
  await fs.writeFile(file, `name: Safe
on: pull_request
permissions:
  contents: read
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - run: true
`);
  return file;
}

async function repositoryFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-codeql-policy-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const excluded = new Set([".git", ".superpowers", "node_modules"]);
  await fs.cp(projectRoot, root, {
    recursive: true,
    filter: (source) => source === projectRoot || !excluded.has(path.basename(source))
  });
  return root;
}

async function runAudit(root) {
  const result = auditWorkflows(root);
  return { code: result.ok ? 0 : 1, stdout: `${JSON.stringify(result, null, 2)}\n`, stderr: "" };
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

test("workflow audit rejects a workflow file symlink that escapes the checkout", async (t) => {
  const root = await workflowFixture(t, {});
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-workflow-outside-"));
  t.after(() => fs.rm(outsideRoot, { recursive: true, force: true }));
  const outside = await safeWorkflowFile(outsideRoot);
  await fs.symlink(outside, path.join(root, ".github", "workflows", "escape.yml"));

  const result = auditWorkflows(root);
  assert.equal(result.ok, false);
  assert.deepEqual(result.checked, []);
  assert.deepEqual(result.findings.map(({ code, path: findingPath }) => ({ code, path: findingPath })), [
    { code: "workflow-file-unsafe", path: ".github/workflows/escape.yml" }
  ]);
});

test("workflow audit rejects a workflow-directory symlink that escapes the checkout", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-workflow-root-link-"));
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-workflow-root-outside-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  t.after(() => fs.rm(outsideRoot, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, ".github"), { recursive: true });
  await safeWorkflowFile(outsideRoot);
  await fs.symlink(outsideRoot, path.join(root, ".github", "workflows"));

  const result = auditWorkflows(root);
  assert.equal(result.ok, false);
  assert.deepEqual(result.checked, []);
  assert.deepEqual(result.findings.map(({ code, path: findingPath }) => ({ code, path: findingPath })), [
    { code: "workflow-directory-unsafe", path: ".github/workflows" }
  ]);
});

test("workflow audit rejects a .github ancestor symlink that escapes the checkout", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-workflow-ancestor-link-"));
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-workflow-ancestor-outside-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  t.after(() => fs.rm(outsideRoot, { recursive: true, force: true }));
  await fs.mkdir(path.join(outsideRoot, "workflows"));
  await safeWorkflowFile(path.join(outsideRoot, "workflows"));
  await fs.symlink(outsideRoot, path.join(root, ".github"));

  const result = auditWorkflows(root);
  assert.equal(result.ok, false);
  assert.deepEqual(result.checked, []);
  assert.deepEqual(result.findings.map(({ code, path: findingPath }) => ({ code, path: findingPath })), [
    { code: "workflow-directory-unsafe", path: ".github/workflows" }
  ]);
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

test("case variants cannot disguise checkout in a pull_request_target workflow", async (t) => {
  const root = await fixture(t, `name: Unsafe case variant
on: pull_request_target
permissions:
  contents: read
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: Actions/Checkout@11bd71901bbe5b1630ceea73d27597364c9af683
`);

  const result = await runAudit(root);
  assert.equal(result.code, 1, `${result.stdout}\n${result.stderr}`);
  assert.ok(parseResult(result).findings.some(({ code }) => code === "pull-request-target-checkout"));
});

test("pull_request_target cannot delegate execution to local or remote reusable workflows", async (t) => {
  for (const [name, reference, additionalWorkflows] of [
    [
      "local",
      "./.github/workflows/called.yml",
      {
        "called.yml": `name: Called
on: workflow_call
permissions:
  contents: read
jobs:
  execute:
    runs-on: ubuntu-latest
    steps:
      - uses: ${pinnedCheckout}
`
      }
    ],
    [
      "remote",
      "owner/repository/.github/workflows/called.yml@0123456789abcdef0123456789abcdef01234567",
      {}
    ]
  ]) {
    const root = await workflowFixture(t, {
      "caller.yml": `name: Unsafe ${name} delegation
on: pull_request_target
permissions:
  contents: read
jobs:
  delegated:
    uses: ${reference}
`,
      ...additionalWorkflows
    });

    const result = await runAudit(root);
    assert.equal(result.code, 1, `${name}\n${result.stdout}\n${result.stderr}`);
    assert.ok(
      parseResult(result).findings.some(({ code, path: findingPath }) =>
        code === "pull-request-target-reusable-workflow" && findingPath.endsWith("caller.yml")
      ),
      name
    );
  }
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

test("an alias cannot hide a flow-style mapping used as a workflow step", async (t) => {
  const root = await fixture(t, `name: Unsafe aliased flow step
on: push
permissions:
  contents: read
jobs:
  audit:
    strategy:
      matrix:
        include:
          - &shared {uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020}
    runs-on: ubuntu-latest
    steps:
      - *shared
`);

  const result = await runAudit(root);
  assert.equal(result.code, 1, `${result.stdout}\n${result.stderr}`);
  assert.ok(parseResult(result).findings.some(({ code }) => code === "flow-steps-unsupported"));
});

test("alias keys cannot hide flow-style jobs or steps", async (t) => {
  for (const [name, workflow, expectedCode] of [
    [
      "job key",
      `name: &job_id audit
on: push
permissions:
  contents: read
jobs:
  *job_id : {runs-on: ubuntu-latest, steps: [{run: echo ok}]}
`,
      "flow-jobs-unsupported"
    ],
    [
      "steps key",
      `name: &steps_key steps
on: push
permissions:
  contents: read
jobs:
  audit:
    runs-on: ubuntu-latest
    *steps_key : [{run: echo ok}]
`,
      "flow-steps-unsupported"
    ]
  ]) {
    const root = await fixture(t, workflow);
    const result = await runAudit(root);
    assert.equal(result.code, 1, `${name}\n${result.stdout}\n${result.stderr}`);
    assert.ok(parseResult(result).findings.some(({ code }) => code === expectedCode), name);
  }
});

test("an indentationless flow-style step item fails closed", async (t) => {
  const root = await fixture(t, `name: Unsafe indentationless flow step
on: pull_request_target
permissions:
  contents: read
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
    - {uses:
        actions/checkout@v4}
`);

  const result = await runAudit(root);
  assert.equal(result.code, 1, `${result.stdout}\n${result.stderr}`);
  const codes = new Set(parseResult(result).findings.map(({ code }) => code));
  assert.ok(codes.has("flow-steps-unsupported"));
  assert.ok(codes.has("action-ref-unpinned"));
  assert.ok(codes.has("pull-request-target-checkout"));
});

test("a flow-style individual job value fails closed", async (t) => {
  const root = await fixture(t, `name: Unsafe flow job value
on: pull_request_target
permissions:
  contents: read
jobs:
  audit:
    {runs-on: ubuntu-latest, steps:
      [{uses: actions/checkout@v4}]}
`);

  const result = await runAudit(root);
  assert.equal(result.code, 1, `${result.stdout}\n${result.stderr}`);
  assert.ok(parseResult(result).findings.some(({ code }) => code === "flow-jobs-unsupported"));
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

test("quoted and multiline uses keys retain Action and privileged-checkout semantics", async (t) => {
  for (const [name, uses] of [
    ["quoted", `      - "uses": actions/checkout@v4`],
    ["multiline", `      - uses:\n          actions/checkout@v4`]
  ]) {
    const root = await fixture(t, `name: Unsafe ${name} uses
on: pull_request_target
permissions:
  contents: read
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
${uses}
`);
    const result = await runAudit(root);
    assert.equal(result.code, 1, `${name}\n${result.stdout}\n${result.stderr}`);
    const codes = new Set(parseResult(result).findings.map(({ code }) => code));
    assert.ok(codes.has("action-ref-unpinned"), name);
    assert.ok(codes.has("pull-request-target-checkout"), name);
  }
});

test("split scalar, block sequence, and split flow on values retain privileged-event semantics", async (t) => {
  for (const [name, event] of [
    ["scalar", `on:\n  pull_request_target`],
    ["block sequence", `on:\n  - pull_request_target`],
    ["flow sequence", `on:\n  [pull_request_target]`]
  ]) {
    const root = await fixture(t, `name: Unsafe ${name} event
${event}
permissions:
  contents: read
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: ${pinnedCheckout}
`);
    const result = await runAudit(root);
    assert.equal(result.code, 1, `${name}\n${result.stdout}\n${result.stderr}`);
    assert.ok(parseResult(result).findings.some(({ code }) => code === "pull-request-target-checkout"), name);
  }
});

test("uses-shaped data outside actual jobs and steps remains valid", async (t) => {
  const root = await fixture(t, `name: Valid uses-shaped data
on: push
permissions:
  contents: read
env:
  uses: literal-value
jobs:
  audit:
    strategy:
      matrix:
        include: [{uses: literal-data}]
    runs-on: ubuntu-latest
    steps:
      - run: echo ok
`);

  const result = await runAudit(root);
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(parseResult(result).findings, []);
});

test("folded Action values and multiline quoted commands are parsed semantically", async (t) => {
  const root = await fixture(t, `name: Valid multiline scalars
on: push
permissions:
  contents: read
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: >-
          ${pinnedCheckout}
      - run: "echo
          [literal text]"
`);

  const result = await runAudit(root);
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(parseResult(result).findings, []);
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

test("unpinned remote reusable workflows are rejected at the job boundary", async (t) => {
  const root = await fixture(t, `name: Unsafe reusable workflow
on: push
permissions:
  contents: read
jobs:
  reuse:
    uses: example/repository/.github/workflows/reusable.yml@main
`);

  const result = await runAudit(root);
  assert.equal(result.code, 1, `${result.stdout}\n${result.stderr}`);
  assert.ok(parseResult(result).findings.some(({ code }) => code === "action-ref-unpinned"));
});

test("malformed or duplicate-key YAML fails closed", async (t) => {
  const root = await fixture(t, `name: Duplicate key
on: push
permissions:
  contents: read
permissions:
  contents: write
jobs: {}
`);

  const result = await runAudit(root);
  assert.equal(result.code, 1, `${result.stdout}\n${result.stderr}`);
  assert.ok(parseResult(result).findings.some(({ code }) => code === "yaml-invalid"));
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

test("CodeQL workflow is visibility-gated, immutable, least-privilege, and complete", async () => {
  const relative = ".github/workflows/codeql.yml";
  const text = await fs.readFile(path.join(projectRoot, relative), "utf8");
  const document = parseDocument(text, { strict: true, uniqueKeys: true });
  assert.deepEqual(document.errors.map(({ message }) => message), [], relative);
  const workflow = document.toJS({ maxAliasCount: 0 });

  assert.deepEqual(Object.keys(workflow).sort(), ["concurrency", "jobs", "name", "on", "permissions"].sort());
  assert.equal(workflow.name, "CodeQL");
  assert.deepEqual(workflow.on, {
    pull_request: null,
    push: { branches: ["main", "stable"] },
    schedule: [{ cron: "23 5 * * 3" }],
    workflow_dispatch: null
  });
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.deepEqual(workflow.concurrency, {
    group: "${{ github.workflow }}-${{ github.ref }}",
    "cancel-in-progress": "${{ github.event_name == 'pull_request' }}"
  });
  assert.deepEqual(Object.keys(workflow.jobs), ["analyze"]);

  const analyze = workflow.jobs.analyze;
  assert.deepEqual(
    Object.keys(analyze).sort(),
    ["if", "name", "permissions", "runs-on", "steps", "timeout-minutes"].sort()
  );
  assert.equal(analyze.if, "github.event.repository.private == false");
  assert.equal(analyze.name, "codeql-javascript");
  assert.equal(analyze["runs-on"], "ubuntu-latest");
  assert.equal(analyze["timeout-minutes"], 30);
  assert.deepEqual(analyze.permissions, { contents: "read", "security-events": "write" });
  assert.deepEqual(analyze.steps, [
    {
      name: "Check out repository",
      uses: codeqlCheckout,
      with: { "persist-credentials": false }
    },
    {
      name: "Initialize CodeQL",
      uses: `github/codeql-action/init@${codeqlAction}`,
      with: { languages: "javascript-typescript", queries: "security-extended" }
    },
    {
      name: "Analyze",
      uses: `github/codeql-action/analyze@${codeqlAction}`
    }
  ]);
  assert.doesNotMatch(
    text,
    /pull_request_target|write-all|packages:\s*read|OPENAI|ANTHROPIC|CLAUDE|FABLE|secrets\./i
  );
  assert.deepEqual(auditWorkflows(projectRoot).findings, []);
});

test("repository CodeQL audit rejects guard pin permission trigger and credential mutations", async (t) => {
  const root = await repositoryFixture(t);
  const relative = path.join(root, ".github", "workflows", "codeql.yml");
  await fs.writeFile(relative, exactCodeqlWorkflow);
  assert.equal(
    auditRepository(root).findings.some(({ code }) => code === "ci-codeql"),
    false,
    "the exact workflow must satisfy the repository CodeQL contract"
  );

  const mutations = [
    ["missing private guard", (text) => text.replace("    if: github.event.repository.private == false\n", "")],
    ["inverted private guard", (text) => text.replace("private == false", "private == true")],
    ["checkout tag", (text) => text.replace(codeqlCheckout, "actions/checkout@v7")],
    [
      "wrong checkout full SHA",
      (text) => text.replace(codeqlCheckout, "actions/checkout@0000000000000000000000000000000000000000")
    ],
    [
      "CodeQL tag",
      (text) => text.replace(`github/codeql-action/init@${codeqlAction}`, "github/codeql-action/init@v4")
    ],
    ["wrong CodeQL full SHA", (text) => text.replaceAll(codeqlAction, "0000000000000000000000000000000000000000")],
    ["top-level write", (text) => text.replace("permissions:\n  contents: read", "permissions:\n  contents: write")],
    [
      "job permission broadening",
      (text) => text.replace("      security-events: write", "      security-events: write\n      packages: read")
    ],
    ["missing pull request", (text) => text.replace("  pull_request:\n", "")],
    ["missing stable push", (text) => text.replace("branches: [main, stable]", "branches: [main]")],
    ["missing weekly schedule", (text) => text.replace("  schedule:\n    - cron: \"23 5 * * 3\"\n", "")],
    ["missing manual dispatch", (text) => text.replace("  workflow_dispatch:\n", "")],
    ["privileged PR trigger", (text) => text.replace("  pull_request:\n", "  pull_request_target:\n")],
    ["missing timeout", (text) => text.replace("    timeout-minutes: 30\n", "")],
    ["unbounded timeout", (text) => text.replace("timeout-minutes: 30", "timeout-minutes: 60")],
    [
      "wrong concurrency group",
      (text) => text.replace("group: ${{ github.workflow }}-${{ github.ref }}", "group: codeql")
    ],
    [
      "broad cancellation",
      (text) => text.replace("cancel-in-progress: ${{ github.event_name == 'pull_request' }}", "cancel-in-progress: true")
    ],
    ["persisted credentials", (text) => text.replace("persist-credentials: false", "persist-credentials: true")],
    ["wrong language", (text) => text.replace("languages: javascript-typescript", "languages: javascript")],
    ["weaker query suite", (text) => text.replace("queries: security-extended", "queries: security-and-quality")],
    ["wrong check name", (text) => text.replace("name: codeql-javascript", "name: CodeQL")],
    [
      "live provider secret",
      (text) => text.replace(
        "permissions:\n  contents: read\n",
        "permissions:\n  contents: read\nenv:\n  OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}\n"
      )
    ]
  ];

  for (const [name, mutate] of mutations) {
    const mutated = mutate(exactCodeqlWorkflow);
    assert.notEqual(mutated, exactCodeqlWorkflow, name);
    await fs.writeFile(relative, mutated);
    const result = auditRepository(root);
    assert.ok(
      result.findings.some(({ code, path: findingPath }) => code === "ci-codeql" && findingPath === ".github/workflows/codeql.yml"),
      `${name}: ${JSON.stringify(result.findings)}`
    );
  }
});
