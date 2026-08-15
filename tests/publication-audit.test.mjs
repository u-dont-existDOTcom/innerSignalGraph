import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, open, readFile, readdir, rename as fsRename, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import {
  auditGitPublication,
  collectHostedPublicationRecords,
  mergePublicationResults,
  runGitleaks,
  scanPublicationRecords
} from "../src/compliance/publication-audit.mjs";
import { withOpenedRegularFile } from "../src/core/opened-regular-file.mjs";

const execFileAsync = promisify(execFile);

async function git(root, ...args) {
  return await execFileAsync("git", args, { cwd: root });
}

async function makeGitRepository() {
  const root = await mkdtemp(path.join(os.tmpdir(), "inner-signal-publication-audit-"));
  await git(root, "init", "-b", "main");
  await git(root, "config", "user.email", "publication-test@example.invalid");
  await git(root, "config", "user.name", "Publication Test");
  return root;
}

async function writeExecutable(filePath, body) {
  await writeFile(filePath, body, { mode: 0o700 });
  await chmod(filePath, 0o700);
}

function hostedAuditResult({ ok = true, findings = [] } = {}) {
  return {
    schemaVersion: 1,
    ok,
    scannedRecords: 8,
    findings,
    counts: {
      refs: 1,
      commits: 1,
      objects: 3,
      blobs: 1,
      branches: 1,
      issues: 0,
      pullRequests: 0,
      issueComments: 0,
      reviewComments: 0,
      reviews: 0,
      actionRuns: 0,
      actionLogs: 0,
      artifacts: 0
    }
  };
}

async function makeHostedWrapperHarness(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), "inner-signal-gitleaks-wrapper-contract-test-"));
  context.after(async () => await rm(root, { recursive: true, force: true }));
  const fakeBin = path.join(root, "bin");
  await mkdir(fakeBin);
  const invocationLog = path.join(root, "invocation.log");
  const outputModeLog = path.join(root, "output-mode.log");

  await writeExecutable(
    path.join(fakeBin, "uname"),
    "#!/usr/bin/env bash\nif [[ \"$1\" == \"-s\" ]]; then printf 'Linux\\n'; else printf 'x86_64\\n'; fi\n"
  );
  await writeExecutable(
    path.join(fakeBin, "curl"),
    "#!/usr/bin/env bash\nwhile (( $# )); do if [[ \"$1\" == \"--output\" ]]; then shift; : > \"$1\"; exit 0; fi; shift; done\nexit 2\n"
  );
  await writeExecutable(path.join(fakeBin, "sha256sum"), "#!/usr/bin/env bash\nexit 0\n");
  await writeExecutable(
    path.join(fakeBin, "tar"),
    "#!/usr/bin/env bash\nwhile (( $# )); do if [[ \"$1\" == \"-C\" ]]; then shift; tool_root=\"$1\"; fi; shift; done\nprintf '#!/usr/bin/env bash\\nexit 0\\n' > \"$tool_root/gitleaks\"\nchmod 700 \"$tool_root/gitleaks\"\n"
  );
  await writeExecutable(
    path.join(fakeBin, "node"),
    `#!/usr/bin/env bash
if [[ "$1" == "scripts/validate-publication-audit-result.mjs" ]]; then
  if [[ "\${FAKE_VALIDATOR_NOOP:-0}" == "1" ]]; then exit 0; fi
  exec "$REAL_NODE" "$@"
fi
printf '%s\n' "$*" > "$FAKE_INVOCATION_LOG"
output_target="$(readlink "/proc/$$/fd/1")"
if [[ "$output_target" == /* ]]; then
  printf '%s %s\n' "$(stat -c '%a' "$output_target")" "$(stat -c '%a' "$(dirname "$output_target")")" > "$FAKE_OUTPUT_MODE_LOG"
else
  printf '%s\n' "$output_target" > "$FAKE_OUTPUT_MODE_LOG"
fi
printf '%s' "$FAKE_AUDIT_OUTPUT"
exit "$FAKE_AUDIT_EXIT"
`
  );

  return {
    invocationLog,
    outputModeLog,
    env: {
      ...process.env,
      PATH: `${fakeBin}:/usr/bin:/bin`,
      REAL_NODE: process.execPath,
      FAKE_INVOCATION_LOG: invocationLog,
      FAKE_OUTPUT_MODE_LOG: outputModeLog
    }
  };
}

const EXPECTED_REPOSITORY = "u-dont-existDOTcom/innerSignalGraph";

function hostedApiPages(value) {
  return `${JSON.stringify(value)}\n`;
}

function makeHostedRunCommand({ logFailure = false, artifactFailure = false, artifactWriter } = {}) {
  const sentinel = `ghp_${"z".repeat(36)}`;
  const endpoints = new Map([
    [
      `repos/${EXPECTED_REPOSITORY}`,
      JSON.stringify({ full_name: EXPECTED_REPOSITORY, visibility: "private", default_branch: "main" })
    ],
    [
      `repos/${EXPECTED_REPOSITORY}/branches?per_page=100`,
      hostedApiPages([
        { name: "main", commit: { sha: "1".repeat(40) }, protected: false },
        { name: "stable", commit: { sha: "2".repeat(40) }, protected: false }
      ])
    ],
    [
      `repos/${EXPECTED_REPOSITORY}/issues?state=all&per_page=100`,
      hostedApiPages([
        { number: 7, title: "Issue", body: "safe issue", state: "open" },
        { number: 8, title: "PR-shaped issue", body: "safe", state: "closed", pull_request: { url: "synthetic" } }
      ])
    ],
    [
      `repos/${EXPECTED_REPOSITORY}/issues/comments?per_page=100`,
      hostedApiPages([{ id: 11, body: "safe issue comment" }])
    ],
    [
      `repos/${EXPECTED_REPOSITORY}/pulls?state=all&per_page=100`,
      hostedApiPages([{ number: 8, title: "Pull request", body: "safe pull request", state: "closed" }])
    ],
    [
      `repos/${EXPECTED_REPOSITORY}/pulls/comments?per_page=100`,
      hostedApiPages([{ id: 12, body: "safe review comment" }])
    ],
    [
      `repos/${EXPECTED_REPOSITORY}/pulls/8/reviews?per_page=100`,
      hostedApiPages([{ id: 13, body: "safe review", state: "APPROVED" }])
    ],
    [
      `repos/${EXPECTED_REPOSITORY}/actions/runs?per_page=100`,
      hostedApiPages({
        total_count: 2,
        workflow_runs: [
          { id: 101, name: "deterministic-package", status: "completed" },
          { id: 102, name: "workflow-policy", status: "completed" }
        ]
      })
    ],
    [
      `repos/${EXPECTED_REPOSITORY}/actions/artifacts?per_page=100`,
      hostedApiPages(
        artifactWriter || artifactFailure
          ? {
              total_count: 1,
              artifacts: [
                { id: 201, name: "publication-evidence", expired: false, workflow_run: { id: 101 } }
              ]
            }
          : { total_count: 0, artifacts: [] }
      )
    ]
  ]);

  return {
    sentinel,
    runCommand: async (command, args) => {
      assert.equal(command, "gh");
      if (args[0] === "api") {
        const endpoint = args.at(-1);
        if (!endpoints.has(endpoint)) throw new Error("unexpected hosted API fixture");
        return { stdout: endpoints.get(endpoint), stderr: "" };
      }
      if (args[0] === "run" && args[1] === "view") {
        if (logFailure && args[2] === "102") throw new Error("synthetic log unavailable");
        return { stdout: args[2] === "101" ? `token=${sentinel}\n` : "safe log\n", stderr: "" };
      }
      if (args[0] === "run" && args[1] === "download") {
        if (artifactFailure) throw new Error("synthetic artifact unavailable");
        const artifactRoot = args[args.indexOf("--dir") + 1];
        await artifactWriter(artifactRoot);
        return { stdout: "", stderr: "" };
      }
      throw new Error("unexpected hosted command fixture");
    }
  };
}

test("publication findings never expose matched values", () => {
  const secret = `ghp_${"a".repeat(36)}`;
  const result = scanPublicationRecords([
    { surface: "issue", identifier: "issue:7", path: "body.md", text: `token=${secret}` },
    { surface: "git", identifier: "blob:clean", path: ".env.example", text: "TOKEN=replace-me" }
  ]);

  assert.equal(result.ok, false);
  assert.deepEqual(result.findings.map(({ code }) => code), ["credential-pattern"]);
  assert.deepEqual(Object.keys(result.findings[0]), ["severity", "code", "surface", "identifier"]);
  assert.equal(JSON.stringify(result).includes(secret), false, "result must omit matched input");
});

test("publication metadata redaction removes matched input from every projected field", () => {
  const sentinel = `ghp_${"m".repeat(36)}`;
  const result = scanPublicationRecords([
    {
      surface: `surface:${sentinel}`,
      identifier: `identifier:${sentinel}`,
      path: `archive/${sentinel}.txt`,
      text: `token=${sentinel}`
    }
  ]);

  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(result).includes(sentinel), false, "result must redact every projected metadata field");
  assert.equal(result.findings.length, 1);
  assert.deepEqual(result.findings[0], {
    severity: "error",
    code: "credential-pattern",
    surface: "surface:[REDACTED]",
    identifier: "identifier:[REDACTED]"
  });
});

test("filename-only credential patterns are findings without exposing the filename", () => {
  const sentinel = `ghp_${"f".repeat(36)}`;
  const result = scanPublicationRecords([
    { surface: "git", identifier: `commit:${sentinel}`, path: `archive/${sentinel}`, text: "safe body" }
  ]);

  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(result).includes(sentinel), false, "result must omit the matched filename");
  assert.deepEqual(result.findings, [
    { severity: "error", code: "credential-pattern", surface: "git", identifier: "commit:[REDACTED]" }
  ]);
});

test("overlapping credential patterns yield one finding per record and code", () => {
  const sentinel = `sk-ant-${"a".repeat(24)}`;
  const result = scanPublicationRecords([
    { surface: "git", identifier: "anthropic", path: "fixture.txt", text: `token=${sentinel}` }
  ]);

  assert.deepEqual(result.findings.map(({ code }) => code), ["credential-pattern"]);
  assert.equal(JSON.stringify(result).includes(sentinel), false, "result must omit the matched credential");
});

test("publication path policy rejects private files and accepts safe examples", () => {
  const rejected = [
    { record: { surface: "git", identifier: "env", path: ".env", text: "PLACEHOLDER=true" }, code: "secret-file" },
    {
      record: {
        surface: "git",
        identifier: "pem",
        path: "fixtures/key.txt",
        text: `${["-----BEGIN", "PRIVATE KEY-----"].join(" ")}\nsynthetic\n-----END PRIVATE KEY-----`
      },
      code: "private-key"
    },
    { record: { surface: "git", identifier: "cookies", path: "browser/Cookies", text: "" }, code: "private-file" },
    {
      record: {
        surface: "git",
        identifier: "therapy",
        path: "notes/private-therapy-session-transcript.md",
        text: "synthetic fixture only"
      },
      code: "private-session-material"
    }
  ];

  for (const { record, code } of rejected) {
    const result = scanPublicationRecords([record]);
    assert.equal(result.ok, false, code);
    assert.deepEqual(result.findings.map((finding) => finding.code), [code]);
  }

  const safe = scanPublicationRecords([
    { surface: "git", identifier: "example-env", path: ".env.example", text: "TOKEN=replace-me" },
    {
      surface: "git",
      identifier: "synthetic-fixture",
      path: "tests/fixtures/synthetic-token.txt",
      text: "ghp_<synthetic>"
    },
    { surface: "docs", identifier: "policy", path: "SECURITY.md", text: "Enable secret scanning before publication." },
    {
      surface: "docs",
      identifier: "redacted",
      path: "docs/example.md",
      text: "Never commit credentials. Example: sk-[REDACTED]."
    }
  ]);

  assert.deepEqual(safe, { schemaVersion: 1, ok: true, scannedRecords: 4, findings: [] });
});

test("historical commit and non-default ref credentials remain detectable", async (context) => {
  const root = await makeGitRepository();
  context.after(async () => await rm(root, { recursive: true, force: true }));

  const historicalSecret = `ghp_${"h".repeat(36)}`;
  await writeFile(path.join(root, "historical.txt"), `token=${historicalSecret}\n`);
  await git(root, "add", "historical.txt");
  await git(root, "commit", "-m", "add historical fixture");
  const historicalCommit = (await git(root, "rev-parse", "HEAD")).stdout.trim();

  await writeFile(path.join(root, "historical.txt"), "credential removed\n");
  await git(root, "commit", "-am", "remove historical fixture");

  await git(root, "switch", "-c", "diagnostics-test");
  const refOnlySecret = `sk-proj-${"r".repeat(24)}`;
  await writeFile(path.join(root, "ref-only.txt"), `token=${refOnlySecret}\n`);
  await git(root, "add", "ref-only.txt");
  await git(root, "commit", "-m", "add non-default ref fixture");
  const refOnlyCommit = (await git(root, "rev-parse", "HEAD")).stdout.trim();
  await git(root, "switch", "main");

  const result = await auditGitPublication({ root });

  assert.equal(result.ok, false);
  assert.deepEqual(result.counts.refs, 2);
  assert.deepEqual(result.counts.commits, 3);
  assert.deepEqual(
    result.findings.map(({ code, identifier }) => ({ code, identifier })),
    [
      { code: "credential-pattern", identifier: `${historicalCommit}:historical.txt` },
      { code: "credential-pattern", identifier: `${refOnlyCommit}:ref-only.txt` }
    ].sort((left, right) => left.identifier.localeCompare(right.identifier))
  );
  assert.equal(JSON.stringify(result).includes(historicalSecret), false, "result must omit historical matched input");
  assert.equal(JSON.stringify(result).includes(refOnlySecret), false, "result must omit non-default-ref matched input");
});

test("safe example history passes the Git publication audit", async (context) => {
  const root = await makeGitRepository();
  context.after(async () => await rm(root, { recursive: true, force: true }));

  await writeFile(path.join(root, ".env.example"), "TOKEN=replace-me\n");
  await git(root, "add", ".env.example");
  await git(root, "commit", "-m", "add safe example");

  const result = await auditGitPublication({ root });

  assert.equal(result.ok, true);
  assert.equal(result.scannedRecords, 1);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.counts.refs, 1);
  assert.deepEqual(result.counts.commits, 1);
});

test("long tracked paths retain private basename policy after display truncation", async (context) => {
  const root = await makeGitRepository();
  context.after(async () => await rm(root, { recursive: true, force: true }));
  const deepDirectory = Array.from({ length: 55 }, (_, index) => `segment-${String(index).padStart(2, "0")}`).join("/");
  assert.ok(deepDirectory.length > 440);
  await mkdir(path.join(root, deepDirectory), { recursive: true });

  await writeFile(path.join(root, deepDirectory, ".env"), "PLACEHOLDER=true\n");
  await writeFile(path.join(root, deepDirectory, "Cookies"), "synthetic browser fixture\n");
  await writeFile(
    path.join(root, deepDirectory, "private-therapy-session-transcript.md"),
    "synthetic therapy fixture\n"
  );
  await git(root, "add", ".");
  await git(root, "commit", "-m", "add deep private path fixtures");

  const result = await auditGitPublication({ root });

  assert.equal(result.ok, false);
  assert.deepEqual(result.findings.map(({ code }) => code), [
    "private-file",
    "private-session-material",
    "secret-file"
  ]);
  assert.equal(result.findings.every(({ identifier }) => identifier.length <= 400), true);
});

test("historical commit audit marks oversized and unreadable objects incomplete", async () => {
  const oversizedObject = "a".repeat(40);
  const unreadableObject = "b".repeat(40);
  const runCommand = async (command, args) => {
    assert.equal(command, "git");
    const invocation = args.join(" ");
    if (invocation.startsWith("for-each-ref ")) return { stdout: "refs/heads/main\n", stderr: "" };
    if (invocation === "rev-list --objects --all") {
      return { stdout: `${oversizedObject} oversized.bin\n${unreadableObject} unreadable.bin\n`, stderr: "" };
    }
    if (invocation === `cat-file -t ${oversizedObject}`) return { stdout: "blob\n", stderr: "" };
    if (invocation === `cat-file -s ${oversizedObject}`) return { stdout: `${20 * 1024 * 1024 + 1}\n`, stderr: "" };
    if (invocation === `cat-file -t ${unreadableObject}`) throw new Error("synthetic unreadable object");
    throw new Error(`unexpected command: ${invocation}`);
  };

  const result = await auditGitPublication({ root: "/synthetic/root", runCommand });

  assert.equal(result.ok, false);
  assert.deepEqual(result.findings, [
    { severity: "error", code: "audit-incomplete", surface: "git", identifier: `blob:${oversizedObject}:size-limit` },
    { severity: "error", code: "audit-incomplete", surface: "git", identifier: `object:${unreadableObject}:type` }
  ]);
});

test("standalone blank rev-list record fails closed", async () => {
  const runCommand = async (command, args) => {
    assert.equal(command, "git");
    const invocation = args.join(" ");
    if (invocation.startsWith("for-each-ref ")) return { stdout: "refs/heads/main\n", stderr: "" };
    if (invocation === "rev-list --objects --all") return { stdout: "\n", stderr: "" };
    throw new Error(`unexpected command: ${invocation}`);
  };

  const result = await auditGitPublication({ root: "/synthetic/root", runCommand });

  assert.equal(result.ok, false);
  assert.deepEqual(result.findings, [
    { severity: "error", code: "audit-incomplete", surface: "git", identifier: "rev-list:record:1" }
  ]);
});

test("internal blank rev-list record fails closed", async () => {
  const treeId = "3".repeat(40);
  const runCommand = async (command, args) => {
    assert.equal(command, "git");
    const invocation = args.join(" ");
    if (invocation.startsWith("for-each-ref ")) return { stdout: "refs/heads/main\n", stderr: "" };
    if (invocation === "rev-list --objects --all") return { stdout: `${treeId}\n\n`, stderr: "" };
    if (invocation === `cat-file -t ${treeId}`) return { stdout: "tree\n", stderr: "" };
    throw new Error(`unexpected command: ${invocation}`);
  };

  const result = await auditGitPublication({ root: "/synthetic/root", runCommand });

  assert.equal(result.ok, false);
  assert.deepEqual(result.findings, [
    { severity: "error", code: "audit-incomplete", surface: "git", identifier: "rev-list:record:2" }
  ]);
});

test("standalone blank tree record fails closed", async () => {
  const commitId = "4".repeat(40);
  const runCommand = async (command, args) => {
    assert.equal(command, "git");
    const invocation = args.join(" ");
    if (invocation.startsWith("for-each-ref ")) return { stdout: "refs/heads/main\n", stderr: "" };
    if (invocation === "rev-list --objects --all") return { stdout: `${commitId}\n`, stderr: "" };
    if (invocation === `cat-file -t ${commitId}`) return { stdout: "commit\n", stderr: "" };
    if (invocation === `ls-tree -r -z --full-tree ${commitId}`) return { stdout: "\0", stderr: "" };
    throw new Error(`unexpected command: ${invocation}`);
  };

  const result = await auditGitPublication({ root: "/synthetic/root", runCommand });

  assert.equal(result.ok, false);
  assert.deepEqual(result.findings, [
    {
      severity: "error",
      code: "audit-incomplete",
      surface: "git",
      identifier: `commit:${commitId}:tree-record:1`
    }
  ]);
});

test("internal blank tree record fails closed", async () => {
  const commitId = "5".repeat(40);
  const gitlinkId = "6".repeat(40);
  const runCommand = async (command, args) => {
    assert.equal(command, "git");
    const invocation = args.join(" ");
    if (invocation.startsWith("for-each-ref ")) return { stdout: "refs/heads/main\n", stderr: "" };
    if (invocation === "rev-list --objects --all") return { stdout: `${commitId}\n`, stderr: "" };
    if (invocation === `cat-file -t ${commitId}`) return { stdout: "commit\n", stderr: "" };
    if (invocation === `ls-tree -r -z --full-tree ${commitId}`) {
      return { stdout: `160000 commit ${gitlinkId}\tvendor/example\0\0`, stderr: "" };
    }
    throw new Error(`unexpected command: ${invocation}`);
  };

  const result = await auditGitPublication({ root: "/synthetic/root", runCommand });

  assert.equal(result.ok, false);
  assert.deepEqual(result.findings, [
    {
      severity: "error",
      code: "audit-incomplete",
      surface: "git",
      identifier: `commit:${commitId}:tree-record:2`
    }
  ]);
});

test("invalid successful object type response fails closed", async () => {
  const objectId = "7".repeat(40);
  const runCommand = async (command, args) => {
    assert.equal(command, "git");
    const invocation = args.join(" ");
    if (invocation.startsWith("for-each-ref ")) return { stdout: "refs/heads/main\n", stderr: "" };
    if (invocation === "rev-list --objects --all") return { stdout: `${objectId} fixture.txt\n`, stderr: "" };
    if (invocation === `cat-file -t ${objectId}`) return { stdout: "unknown\n", stderr: "" };
    throw new Error(`unexpected command: ${invocation}`);
  };

  const result = await auditGitPublication({ root: "/synthetic/root", runCommand });

  assert.equal(result.ok, false);
  assert.deepEqual(result.findings, [
    { severity: "error", code: "audit-incomplete", surface: "git", identifier: `object:${objectId}:type` }
  ]);
});

test("malformed object size response fails closed", async () => {
  const objectId = "8".repeat(40);
  const runCommand = async (command, args) => {
    assert.equal(command, "git");
    const invocation = args.join(" ");
    if (invocation.startsWith("for-each-ref ")) return { stdout: "refs/heads/main\n", stderr: "" };
    if (invocation === "rev-list --objects --all") return { stdout: `${objectId} fixture.txt\n`, stderr: "" };
    if (invocation === `cat-file -t ${objectId}`) return { stdout: "blob\n", stderr: "" };
    if (invocation === `cat-file -s ${objectId}`) return { stdout: "1junk\n", stderr: "" };
    if (invocation === `cat-file blob ${objectId}`) return { stdout: "x", stderr: "" };
    throw new Error(`unexpected command: ${invocation}`);
  };

  const result = await auditGitPublication({ root: "/synthetic/root", runCommand });

  assert.equal(result.ok, false);
  assert.deepEqual(result.findings, [
    { severity: "error", code: "audit-incomplete", surface: "git", identifier: `blob:${objectId}:size` }
  ]);
});

test("declared blob size must match returned binary bytes", async () => {
  const objectId = "9".repeat(40);
  const runCommand = async (command, args) => {
    assert.equal(command, "git");
    const invocation = args.join(" ");
    if (invocation.startsWith("for-each-ref ")) return { stdout: "refs/heads/main\n", stderr: "" };
    if (invocation === "rev-list --objects --all") return { stdout: `${objectId} fixture.txt\n`, stderr: "" };
    if (invocation === `cat-file -t ${objectId}`) return { stdout: "blob\n", stderr: "" };
    if (invocation === `cat-file -s ${objectId}`) return { stdout: "1\n", stderr: "" };
    if (invocation === `cat-file blob ${objectId}`) return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    throw new Error(`unexpected command: ${invocation}`);
  };

  const result = await auditGitPublication({ root: "/synthetic/root", runCommand });

  assert.equal(result.ok, false);
  assert.deepEqual(result.findings, [
    {
      severity: "error",
      code: "audit-incomplete",
      surface: "git",
      identifier: `blob:${objectId}:size-mismatch`
    }
  ]);
});

test("completely empty Git outputs and a zero-byte blob remain valid", async () => {
  const emptyResult = await auditGitPublication({
    root: "/synthetic/root",
    runCommand: async (command, args) => {
      assert.equal(command, "git");
      const invocation = args.join(" ");
      if (invocation.startsWith("for-each-ref ")) return { stdout: "", stderr: "" };
      if (invocation === "rev-list --objects --all") return { stdout: "", stderr: "" };
      throw new Error(`unexpected command: ${invocation}`);
    }
  });
  assert.equal(emptyResult.ok, true);
  assert.deepEqual(emptyResult.findings, []);

  const objectId = "a".repeat(40);
  const zeroByteResult = await auditGitPublication({
    root: "/synthetic/root",
    runCommand: async (command, args) => {
      assert.equal(command, "git");
      const invocation = args.join(" ");
      if (invocation.startsWith("for-each-ref ")) return { stdout: "refs/heads/main\n", stderr: "" };
      if (invocation === "rev-list --objects --all") return { stdout: `${objectId} empty.txt\n`, stderr: "" };
      if (invocation === `cat-file -t ${objectId}`) return { stdout: "blob\n", stderr: "" };
      if (invocation === `cat-file -s ${objectId}`) return { stdout: "0\n", stderr: "" };
      if (invocation === `cat-file blob ${objectId}`) return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
      throw new Error(`unexpected command: ${invocation}`);
    }
  });
  assert.equal(zeroByteResult.ok, true);
  assert.equal(zeroByteResult.scannedRecords, 1);
  assert.deepEqual(zeroByteResult.findings, []);
});

test("malformed rev-list records and a truncated final record fail closed", async () => {
  const runCommand = async (command, args) => {
    assert.equal(command, "git");
    const invocation = args.join(" ");
    if (invocation.startsWith("for-each-ref ")) return { stdout: "refs/heads/main\n", stderr: "" };
    if (invocation === "rev-list --objects --all") {
      return {
        stdout: `malformed object record\n${"b".repeat(41)} invalid-length.txt\n${"a".repeat(39)} truncated.txt`,
        stderr: ""
      };
    }
    throw new Error(`unexpected command: ${invocation}`);
  };

  const result = await auditGitPublication({ root: "/synthetic/root", runCommand });

  assert.equal(result.ok, false);
  assert.deepEqual(result.findings, [
    { severity: "error", code: "audit-incomplete", surface: "git", identifier: "rev-list:record:1" },
    { severity: "error", code: "audit-incomplete", surface: "git", identifier: "rev-list:record:2" },
    { severity: "error", code: "audit-incomplete", surface: "git", identifier: "rev-list:record:3" }
  ]);
});

test("rev-list accepts a valid object record with an empty advertised path", async () => {
  const treeId = "e".repeat(40);
  const runCommand = async (command, args) => {
    assert.equal(command, "git");
    const invocation = args.join(" ");
    if (invocation.startsWith("for-each-ref ")) return { stdout: "refs/heads/main\n", stderr: "" };
    if (invocation === "rev-list --objects --all") return { stdout: `${treeId} \n`, stderr: "" };
    if (invocation === `cat-file -t ${treeId}`) return { stdout: "tree\n", stderr: "" };
    throw new Error(`unexpected command: ${invocation}`);
  };

  const result = await auditGitPublication({ root: "/synthetic/root", runCommand });

  assert.equal(result.ok, true);
  assert.deepEqual(result.findings, []);
  assert.equal(result.counts.objects, 1);
});

test("malformed tree records and a truncated final record fail closed", async () => {
  const commitId = "c".repeat(40);
  const unlistedBlobId = "d".repeat(40);
  const runCommand = async (command, args) => {
    assert.equal(command, "git");
    const invocation = args.join(" ");
    if (invocation.startsWith("for-each-ref ")) return { stdout: "refs/heads/main\n", stderr: "" };
    if (invocation === "rev-list --objects --all") return { stdout: `${commitId}\n`, stderr: "" };
    if (invocation === `cat-file -t ${commitId}`) return { stdout: "commit\n", stderr: "" };
    if (invocation === `ls-tree -r -z --full-tree ${commitId}`) {
      return {
        stdout:
          `malformed tree record\0` +
          `1 blob ${unlistedBlobId}\tinvalid-mode.txt\0` +
          `100644 blob ${unlistedBlobId}\ttruncated.txt`,
        stderr: ""
      };
    }
    throw new Error(`unexpected command: ${invocation}`);
  };

  const result = await auditGitPublication({ root: "/synthetic/root", runCommand });

  assert.equal(result.ok, false);
  assert.deepEqual(result.findings, [
    {
      severity: "error",
      code: "audit-incomplete",
      surface: "git",
      identifier: `commit:${commitId}:tree-record:1`
    },
    {
      severity: "error",
      code: "audit-incomplete",
      surface: "git",
      identifier: `commit:${commitId}:tree-record:2`
    },
    {
      severity: "error",
      code: "audit-incomplete",
      surface: "git",
      identifier: `commit:${commitId}:tree-record:3`
    }
  ]);
});

test("tree parser accepts a valid non-blob Gitlink record without reading it", async () => {
  const commitId = "1".repeat(40);
  const gitlinkId = "2".repeat(40);
  const runCommand = async (command, args) => {
    assert.equal(command, "git");
    const invocation = args.join(" ");
    if (invocation.startsWith("for-each-ref ")) return { stdout: "refs/heads/main\n", stderr: "" };
    if (invocation === "rev-list --objects --all") return { stdout: `${commitId}\n`, stderr: "" };
    if (invocation === `cat-file -t ${commitId}`) return { stdout: "commit\n", stderr: "" };
    if (invocation === `ls-tree -r -z --full-tree ${commitId}`) {
      return { stdout: `160000 commit ${gitlinkId}\tvendor/example\0`, stderr: "" };
    }
    throw new Error(`unexpected command: ${invocation}`);
  };

  const result = await auditGitPublication({ root: "/synthetic/root", runCommand });

  assert.equal(result.ok, true);
  assert.deepEqual(result.findings, []);
  assert.equal(result.scannedRecords, 0);
});

test("hosted coverage enumerates every required surface and safely scans action logs", async (context) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "inner-signal-hosted-audit-test-"));
  context.after(async () => await rm(tempRoot, { recursive: true, force: true }));
  const fixture = makeHostedRunCommand();

  const result = await collectHostedPublicationRecords({
    repository: EXPECTED_REPOSITORY,
    runCommand: fixture.runCommand,
    tempRoot
  });
  const scanned = scanPublicationRecords(result.records);

  assert.deepEqual(result.counts, {
    branches: 2,
    issues: 1,
    pullRequests: 1,
    issueComments: 1,
    reviewComments: 1,
    reviews: 1,
    actionRuns: 2,
    actionLogs: 2,
    artifacts: 0
  });
  assert.equal(scanned.ok, false);
  assert.deepEqual(scanned.findings.map(({ code }) => code), ["credential-pattern"]);
  assert.equal(JSON.stringify(scanned).includes(fixture.sentinel), false, "scan result must omit hosted matched input");
  assert.equal((await stat(tempRoot)).mode & 0o777, 0o700);
  const rawNames = (await readdir(tempRoot)).filter((name) => name.endsWith(".raw"));
  assert.equal(rawNames.length > 0, true);
  for (const rawName of rawNames) assert.equal((await stat(path.join(tempRoot, rawName))).mode & 0o777, 0o600);
  assert.deepEqual([...result.hostedFileIdentifiers.values()], [
    "repository:field:default_branch",
    "repository:field:full_name",
    "repository:field:visibility",
    `branch:commit:${"1".repeat(40)}`,
    `branch:commit:${"2".repeat(40)}`,
    "issue:7",
    "issue-comment:11",
    "pull:8",
    "review-comment:12",
    "review:13",
    "actions-run:101",
    "actions-run:102",
    "actions-log:run:101",
    "actions-log:run:102"
  ]);
});

test("repository fields retain stable safe locators and complete key-context coverage", async (context) => {
  const firstRoot = await mkdtemp(path.join(os.tmpdir(), "inner-signal-repository-fields-first-test-"));
  const secondRoot = await mkdtemp(path.join(os.tmpdir(), "inner-signal-repository-fields-second-test-"));
  context.after(async () => await rm(firstRoot, { recursive: true, force: true }));
  context.after(async () => await rm(secondRoot, { recursive: true, force: true }));
  const sentinel = `ghp_${"v".repeat(36)}`;
  const entries = [
    ["full_name", EXPECTED_REPOSITORY],
    ["visibility", "private"],
    ["default_branch", "main"],
    ["description", `synthetic ${sentinel}`],
    ["homepage", "https://example.invalid"],
    ["node_id", "R_synthetic"],
    [".env", "unsafe metadata key"],
    [sentinel, "token-bearing metadata key"]
  ];

  const collectWithMetadata = async (tempRoot, orderedEntries) => {
    const fixture = makeHostedRunCommand();
    const command = async (tool, args, options) => {
      if (args.at(-1) === `repos/${EXPECTED_REPOSITORY}`) {
        return { stdout: JSON.stringify(Object.fromEntries(orderedEntries)), stderr: "" };
      }
      return await fixture.runCommand(tool, args, options);
    };
    return await collectHostedPublicationRecords({ repository: EXPECTED_REPOSITORY, runCommand: command, tempRoot });
  };
  const identifierByKey = async (tempRoot, result) => {
    const identifiers = new Map();
    const repositoryRecords = result.records.filter(({ surface }) => surface === "repository");
    assert.equal(repositoryRecords.length, entries.length);
    for (const [relativeFile, identifier] of result.hostedFileIdentifiers) {
      if (!identifier.startsWith("repository:field:")) continue;
      const projected = JSON.parse(await readFile(path.join(tempRoot, relativeFile), "utf8"));
      const keys = Object.keys(projected);
      assert.equal(keys.length, 1);
      const [key] = keys;
      assert.equal(Object.is(projected[key], Object.fromEntries(entries)[key]), true);
      assert.equal(identifiers.has(key), false);
      identifiers.set(key, identifier);
    }
    assert.equal(identifiers.size, entries.length);
    return identifiers;
  };

  const first = await collectWithMetadata(firstRoot, entries);
  const second = await collectWithMetadata(secondRoot, [...entries].reverse());
  const firstIdentifiers = await identifierByKey(firstRoot, first);
  const secondIdentifiers = await identifierByKey(secondRoot, second);
  for (const [key, identifier] of firstIdentifiers) assert.equal(secondIdentifiers.get(key) === identifier, true);

  assert.equal(firstIdentifiers.get("description"), "repository:field:description");
  assert.equal(firstIdentifiers.get("homepage"), "repository:field:homepage");
  assert.equal(firstIdentifiers.get("node_id"), "repository:field:node_id");
  assert.equal(firstIdentifiers.get(".env"), "repository:field:other:rank:1");
  assert.equal(firstIdentifiers.get(sentinel), "repository:field:other:rank:2");
  assert.equal(JSON.stringify([...firstIdentifiers.values()]).includes(sentinel), false);
  assert.equal(JSON.stringify([...firstIdentifiers.values()]).includes(".env"), false);

  const scanned = scanPublicationRecords(first.records.filter(({ surface }) => surface === "repository"));
  assert.deepEqual(scanned.findings.map(({ identifier }) => identifier), [
    "repository:field:description",
    "repository:field:other:rank:2"
  ]);
  assert.equal(JSON.stringify(scanned).includes(sentinel), false);
});

test("exact repository transport credential is discarded while variants and descriptions remain covered", async (context) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "inner-signal-repository-transport-test-"));
  context.after(async () => await rm(tempRoot, { recursive: true, force: true }));
  const sentinel = `ghp_${"t".repeat(36)}`;
  const fixture = makeHostedRunCommand();
  const command = async (tool, args, options) => {
    if (args.at(-1) === `repos/${EXPECTED_REPOSITORY}`) {
      return {
        stdout: JSON.stringify({
          full_name: EXPECTED_REPOSITORY,
          visibility: "private",
          default_branch: "main",
          temp_clone_token: sentinel,
          temp_clone_token_backup: sentinel,
          description: `synthetic ${sentinel}`
        }),
        stderr: ""
      };
    }
    return await fixture.runCommand(tool, args, options);
  };

  const result = await collectHostedPublicationRecords({ repository: EXPECTED_REPOSITORY, runCommand: command, tempRoot });
  const repositoryRecords = result.records.filter(({ surface }) => surface === "repository");
  assert.equal(repositoryRecords.some(({ identifier }) => identifier === "repository:field:temp_clone_token"), false);
  assert.equal(
    [...result.hostedFileIdentifiers.values()].some((identifier) => identifier === "repository:field:temp_clone_token"),
    false
  );
  for (const [relativeFile, identifier] of result.hostedFileIdentifiers) {
    if (!identifier.startsWith("repository:field:")) continue;
    const projected = JSON.parse(await readFile(path.join(tempRoot, relativeFile), "utf8"));
    assert.equal(Object.hasOwn(projected, "temp_clone_token"), false);
  }

  const scanned = scanPublicationRecords(repositoryRecords);
  assert.deepEqual(scanned.findings.map(({ identifier }) => identifier), [
    "repository:field:description",
    "repository:field:temp_clone_token_backup"
  ]);
  assert.equal(JSON.stringify(scanned).includes(sentinel), false);
});

test("malformed repository transport credential type fails before any persistence", async (context) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "inner-signal-repository-transport-type-test-"));
  context.after(async () => await rm(tempRoot, { recursive: true, force: true }));
  const fixture = makeHostedRunCommand();
  const command = async (tool, args, options) => {
    if (args.at(-1) === `repos/${EXPECTED_REPOSITORY}`) {
      return {
        stdout: JSON.stringify({
          full_name: EXPECTED_REPOSITORY,
          visibility: "private",
          default_branch: "main",
          temp_clone_token: { malformed: true }
        }),
        stderr: ""
      };
    }
    return await fixture.runCommand(tool, args, options);
  };

  await assert.rejects(
    collectHostedPublicationRecords({ repository: EXPECTED_REPOSITORY, runCommand: command, tempRoot }),
    (error) => {
      assert.equal(error.code, "audit-incomplete");
      assert.equal(error.identifier, "repository:metadata:temp-clone-token");
      return true;
    }
  );
  assert.deepEqual(await readdir(tempRoot), []);
});

test("null repository transport credential is accepted and discarded", async (context) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "inner-signal-repository-transport-null-test-"));
  context.after(async () => await rm(tempRoot, { recursive: true, force: true }));
  const fixture = makeHostedRunCommand();
  const command = async (tool, args, options) => {
    if (args.at(-1) === `repos/${EXPECTED_REPOSITORY}`) {
      return {
        stdout: JSON.stringify({
          full_name: EXPECTED_REPOSITORY,
          visibility: "private",
          default_branch: "main",
          temp_clone_token: null
        }),
        stderr: ""
      };
    }
    return await fixture.runCommand(tool, args, options);
  };

  const result = await collectHostedPublicationRecords({ repository: EXPECTED_REPOSITORY, runCommand: command, tempRoot });
  assert.equal(
    result.records.some(({ identifier }) => identifier === "repository:field:temp_clone_token"),
    false
  );
  assert.equal(
    [...result.hostedFileIdentifiers.values()].some((identifier) => identifier === "repository:field:temp_clone_token"),
    false
  );
});

test("hosted pagination consumes every concatenated page for arrays and object collections", async (context) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "inner-signal-hosted-audit-test-"));
  context.after(async () => await rm(tempRoot, { recursive: true, force: true }));
  const fixture = makeHostedRunCommand();
  const pagedCommand = async (command, args, options) => {
    const endpoint = args.at(-1);
    if (endpoint === `repos/${EXPECTED_REPOSITORY}/branches?per_page=100`) {
      return {
        stdout:
          `${JSON.stringify([{ name: "main", commit: { sha: "1".repeat(40) }, protected: false }])}\n` +
          `${JSON.stringify([{ name: "stable", commit: { sha: "2".repeat(40) }, protected: false }])}\n`,
        stderr: ""
      };
    }
    if (endpoint === `repos/${EXPECTED_REPOSITORY}/issues/comments?per_page=100`) {
      return {
        stdout: `${JSON.stringify([{ id: 11, body: "first" }])}\n${JSON.stringify([{ id: 14, body: "second" }])}\n`,
        stderr: ""
      };
    }
    if (endpoint === `repos/${EXPECTED_REPOSITORY}/pulls/8/reviews?per_page=100`) {
      return {
        stdout:
          `${JSON.stringify([{ id: 13, body: "first", state: "APPROVED" }])}\n` +
          `${JSON.stringify([{ id: 15, body: "second", state: "COMMENTED" }])}\n`,
        stderr: ""
      };
    }
    if (endpoint === `repos/${EXPECTED_REPOSITORY}/actions/runs?per_page=100`) {
      return {
        stdout:
          `${JSON.stringify({ total_count: 2, workflow_runs: [{ id: 101, name: "first", status: "completed" }] })}\n` +
          `${JSON.stringify({ total_count: 2, workflow_runs: [{ id: 102, name: "second", status: "completed" }] })}\n`,
        stderr: ""
      };
    }
    if (endpoint === `repos/${EXPECTED_REPOSITORY}/actions/artifacts?per_page=100`) {
      return {
        stdout:
          `${JSON.stringify({ total_count: 0, artifacts: [] })}\n` +
          `${JSON.stringify({ total_count: 0, artifacts: [] })}\n`,
        stderr: ""
      };
    }
    return await fixture.runCommand(command, args, options);
  };

  const result = await collectHostedPublicationRecords({
    repository: EXPECTED_REPOSITORY,
    runCommand: pagedCommand,
    tempRoot
  });

  assert.equal(result.counts.branches, 2);
  assert.equal(result.counts.issueComments, 2);
  assert.equal(result.counts.reviews, 2);
  assert.equal(result.counts.actionRuns, 2);
  assert.equal(result.counts.actionLogs, 2);
  assert.equal(result.counts.artifacts, 0);
});

test("branch locators are stable across reordered pages and shared-commit collisions", async (context) => {
  const firstRoot = await mkdtemp(path.join(os.tmpdir(), "inner-signal-branch-locator-first-test-"));
  const secondRoot = await mkdtemp(path.join(os.tmpdir(), "inner-signal-branch-locator-second-test-"));
  context.after(async () => await rm(firstRoot, { recursive: true, force: true }));
  context.after(async () => await rm(secondRoot, { recursive: true, force: true }));
  const sharedCommit = "1".repeat(40);
  const distinctCommit = "2".repeat(40);
  const alpha = { name: "alpha", commit: { sha: sharedCommit }, protected: false };
  const omega = { name: "omega", commit: { sha: sharedCommit }, protected: false };
  const stable = { name: "stable", commit: { sha: distinctCommit }, protected: false };

  const collectWithPages = async (tempRoot, pages) => {
    const fixture = makeHostedRunCommand();
    const command = async (tool, args, options) => {
      if (args.at(-1) === `repos/${EXPECTED_REPOSITORY}/branches?per_page=100`) {
        return { stdout: pages.map((page) => JSON.stringify(page)).join("\n") + "\n", stderr: "" };
      }
      return await fixture.runCommand(tool, args, options);
    };
    return await collectHostedPublicationRecords({ repository: EXPECTED_REPOSITORY, runCommand: command, tempRoot });
  };
  const projectByBranchName = async (tempRoot, result) => {
    const entries = [];
    for (const [relativeFile, identifier] of result.hostedFileIdentifiers) {
      if (!identifier.startsWith("branch:")) continue;
      const record = JSON.parse(await readFile(path.join(tempRoot, relativeFile), "utf8"));
      entries.push([record.name, identifier]);
    }
    entries.sort(([left], [right]) => left.localeCompare(right));
    return Object.fromEntries(entries);
  };

  const first = await collectWithPages(firstRoot, [[omega, stable], [alpha]]);
  const second = await collectWithPages(secondRoot, [[alpha], [stable, omega]]);
  const firstLocators = await projectByBranchName(firstRoot, first);
  const secondLocators = await projectByBranchName(secondRoot, second);

  assert.deepEqual(firstLocators, secondLocators);
  assert.deepEqual(firstLocators, {
    alpha: `branch:commit:${sharedCommit}:rank:1`,
    omega: `branch:commit:${sharedCommit}:rank:2`,
    stable: `branch:commit:${distinctCommit}`
  });
  assert.equal(Object.values(firstLocators).some((identifier) => /alpha|omega|stable/.test(identifier)), false);
});

test("hosted pagination frames escaped quotes and structural characters inside strings", async (context) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "inner-signal-hosted-json-framing-test-"));
  context.after(async () => await rm(tempRoot, { recursive: true, force: true }));
  const fixture = makeHostedRunCommand();
  const command = async (tool, args, options) => {
    if (args.at(-1) === `repos/${EXPECTED_REPOSITORY}/issues/comments?per_page=100`) {
      return {
        stdout: hostedApiPages([{ id: 11, body: 'quoted " } ] { " text' }]),
        stderr: ""
      };
    }
    return await fixture.runCommand(tool, args, options);
  };

  const result = await collectHostedPublicationRecords({ repository: EXPECTED_REPOSITORY, runCommand: command, tempRoot });

  assert.equal(result.counts.issueComments, 1);
  assert.equal(result.records.some(({ identifier }) => identifier === "issue-comment:11"), true);
});

test("missing action log fails hosted coverage closed with a safe identifier", async (context) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "inner-signal-hosted-audit-test-"));
  context.after(async () => await rm(tempRoot, { recursive: true, force: true }));
  const fixture = makeHostedRunCommand({ logFailure: true });

  await assert.rejects(
    collectHostedPublicationRecords({
      repository: EXPECTED_REPOSITORY,
      runCommand: fixture.runCommand,
      tempRoot
    }),
    (error) => {
      assert.equal(error.code, "audit-incomplete");
      assert.equal(error.identifier, "actions-run:2:log");
      assert.equal(JSON.stringify({ code: error.code, identifier: error.identifier }).includes(fixture.sentinel), false);
      return true;
    }
  );
});

test("artifact coverage scans every regular member without following symlinks", async (context) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "inner-signal-hosted-audit-test-"));
  context.after(async () => await rm(tempRoot, { recursive: true, force: true }));
  const fixture = makeHostedRunCommand({
    artifactWriter: async (artifactRoot) => {
      await mkdir(path.join(artifactRoot, "nested"), { recursive: true });
      await writeFile(path.join(artifactRoot, "nested", ".env"), "PLACEHOLDER=true\n");
      await writeFile(path.join(artifactRoot, "safe.txt"), "safe member\n");
    }
  });

  const result = await collectHostedPublicationRecords({
    repository: EXPECTED_REPOSITORY,
    runCommand: fixture.runCommand,
    tempRoot
  });
  const scanned = scanPublicationRecords(result.records);

  assert.equal(result.counts.artifacts, 1);
  assert.deepEqual(scanned.findings.map(({ code }) => code), ["credential-pattern", "secret-file"]);
  assert.equal(
    result.records.filter(({ surface }) => surface === "artifact-member").length,
    2,
    "every regular artifact member must become a scan record"
  );
  assert.deepEqual(
    [...result.hostedFileIdentifiers.values()].filter((identifier) => identifier.startsWith("artifact:")),
    ["artifact:201", "artifact:201:member:1", "artifact:201:member:2"]
  );

  const symlinkRoot = await mkdtemp(path.join(os.tmpdir(), "inner-signal-hosted-audit-symlink-test-"));
  context.after(async () => await rm(symlinkRoot, { recursive: true, force: true }));
  const symlinkFixture = makeHostedRunCommand({
    artifactWriter: async (artifactRoot) => {
      await mkdir(artifactRoot, { recursive: true });
      await symlink("/tmp", path.join(artifactRoot, "outside"));
    }
  });
  await assert.rejects(
    collectHostedPublicationRecords({
      repository: EXPECTED_REPOSITORY,
      runCommand: symlinkFixture.runCommand,
      tempRoot: symlinkRoot
    }),
    (error) => {
      assert.equal(error.code, "audit-incomplete");
      assert.equal(error.identifier, "artifact:201:member:1:type");
      return true;
    }
  );
});

test("artifact scanning reads the opened member inode after pathname replacement", async (context) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "inner-signal-hosted-artifact-race-test-"));
  context.after(async () => await rm(tempRoot, { recursive: true, force: true }));
  const replacement = path.join(tempRoot, "replacement.txt");
  await writeFile(replacement, "replacement member\n");
  let replaced = false;
  const fixture = makeHostedRunCommand({
    artifactWriter: async (artifactRoot) => {
      await mkdir(artifactRoot, { recursive: true });
      await writeFile(path.join(artifactRoot, "safe.txt"), "trusted member\n");
    }
  });

  const result = await collectHostedPublicationRecords({
    repository: EXPECTED_REPOSITORY,
    runCommand: fixture.runCommand,
    tempRoot,
    withOpenedFile: async (file, reader) => await withOpenedRegularFile(file, async (handle, openedStat) => {
      if (!replaced && path.basename(file) === "safe.txt") {
        await fsRename(file, `${file}.original`);
        await symlink(replacement, file);
        replaced = true;
      }
      return await reader(handle, openedStat);
    })
  });

  assert.equal(replaced, true);
  assert.equal(result.records.find(({ surface }) => surface === "artifact-member").text, "trusted member\n");
});

test("artifact download failure and malformed pagination fail hosted coverage closed", async (context) => {
  const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "inner-signal-hosted-audit-test-"));
  const malformedRoot = await mkdtemp(path.join(os.tmpdir(), "inner-signal-hosted-audit-test-"));
  context.after(async () => await rm(artifactRoot, { recursive: true, force: true }));
  context.after(async () => await rm(malformedRoot, { recursive: true, force: true }));

  const artifactFixture = makeHostedRunCommand({ artifactFailure: true });
  await assert.rejects(
    collectHostedPublicationRecords({
      repository: EXPECTED_REPOSITORY,
      runCommand: artifactFixture.runCommand,
      tempRoot: artifactRoot
    }),
    (error) => {
      assert.equal(error.code, "audit-incomplete");
      assert.equal(error.identifier, "artifact:201:download");
      return true;
    }
  );

  const malformedFixture = makeHostedRunCommand();
  const malformedCommand = async (command, args, options) => {
    if (args.at(-1) === `repos/${EXPECTED_REPOSITORY}/branches?per_page=100`) {
      return { stdout: "{", stderr: "" };
    }
    return await malformedFixture.runCommand(command, args, options);
  };
  await assert.rejects(
    collectHostedPublicationRecords({
      repository: EXPECTED_REPOSITORY,
      runCommand: malformedCommand,
      tempRoot: malformedRoot
    }),
    (error) => {
      assert.equal(error.code, "audit-incomplete");
      assert.equal(error.identifier, "branches:pagination");
      return true;
    }
  );
});

test("empty artifact and malformed artifact metadata fail before coverage can pass", async (context) => {
  const emptyRoot = await mkdtemp(path.join(os.tmpdir(), "inner-signal-hosted-empty-artifact-test-"));
  const malformedRoot = await mkdtemp(path.join(os.tmpdir(), "inner-signal-hosted-malformed-artifact-test-"));
  context.after(async () => await rm(emptyRoot, { recursive: true, force: true }));
  context.after(async () => await rm(malformedRoot, { recursive: true, force: true }));

  const emptyFixture = makeHostedRunCommand({ artifactWriter: async () => {} });
  await assert.rejects(
    collectHostedPublicationRecords({
      repository: EXPECTED_REPOSITORY,
      runCommand: emptyFixture.runCommand,
      tempRoot: emptyRoot
    }),
    (error) => {
      assert.equal(error.code, "audit-incomplete");
      assert.equal(error.identifier, "artifact:201:members-empty");
      return true;
    }
  );

  const malformedFixture = makeHostedRunCommand({ artifactWriter: async () => assert.fail("download must not run") });
  const malformedCommand = async (command, args, options) => {
    if (args.at(-1) === `repos/${EXPECTED_REPOSITORY}/actions/artifacts?per_page=100`) {
      return {
        stdout: hostedApiPages({
          total_count: 1,
          artifacts: [{ id: 201, name: "publication-evidence", expired: "false", workflow_run: { id: 101 } }]
        }),
        stderr: ""
      };
    }
    return await malformedFixture.runCommand(command, args, options);
  };
  await assert.rejects(
    collectHostedPublicationRecords({
      repository: EXPECTED_REPOSITORY,
      runCommand: malformedCommand,
      tempRoot: malformedRoot
    }),
    (error) => {
      assert.equal(error.code, "audit-incomplete");
      assert.equal(error.identifier, "artifact:1:metadata");
      return true;
    }
  );
});

test("artifact member and aggregate byte ceilings fail closed before member reads", async (context) => {
  const memberRoot = await mkdtemp(path.join(os.tmpdir(), "inner-signal-hosted-member-limit-test-"));
  const aggregateRoot = await mkdtemp(path.join(os.tmpdir(), "inner-signal-hosted-aggregate-limit-test-"));
  context.after(async () => await rm(memberRoot, { recursive: true, force: true }));
  context.after(async () => await rm(aggregateRoot, { recursive: true, force: true }));

  const createSparse = async (filePath, size) => {
    const handle = await open(filePath, "w", 0o600);
    try {
      await handle.truncate(size);
    } finally {
      await handle.close();
    }
  };

  const memberFixture = makeHostedRunCommand({
    artifactWriter: async (artifactRoot) => {
      await createSparse(path.join(artifactRoot, "oversized.bin"), 20 * 1024 * 1024 + 1);
    }
  });
  await assert.rejects(
    collectHostedPublicationRecords({
      repository: EXPECTED_REPOSITORY,
      runCommand: memberFixture.runCommand,
      tempRoot: memberRoot
    }),
    (error) => {
      assert.equal(error.code, "audit-incomplete");
      assert.equal(error.identifier, "artifact:201:member:1:size-limit");
      return true;
    }
  );

  const aggregateFixture = makeHostedRunCommand({
    artifactWriter: async (artifactRoot) => {
      for (let index = 1; index <= 4; index += 1) {
        await createSparse(path.join(artifactRoot, `member-${index}.bin`), 17 * 1024 * 1024);
      }
    }
  });
  await assert.rejects(
    collectHostedPublicationRecords({
      repository: EXPECTED_REPOSITORY,
      runCommand: aggregateFixture.runCommand,
      tempRoot: aggregateRoot
    }),
    (error) => {
      assert.equal(error.code, "audit-incomplete");
      assert.equal(error.identifier, "artifact:201:aggregate-size-limit");
      return true;
    }
  );
});

test("endpoint-specific hosted schemas reject malformed scalar and nested fields", async (context) => {
  const cases = [
    {
      endpoint: `repos/${EXPECTED_REPOSITORY}`,
      stdout: JSON.stringify({ full_name: EXPECTED_REPOSITORY, visibility: "private", default_branch: [] }),
      identifier: "repository:metadata"
    },
    {
      endpoint: `repos/${EXPECTED_REPOSITORY}/branches?per_page=100`,
      stdout: hostedApiPages([{ name: "", commit: { sha: "1".repeat(40) }, protected: false }]),
      identifier: "branches:pagination"
    },
    {
      endpoint: `repos/${EXPECTED_REPOSITORY}/issues?state=all&per_page=100`,
      stdout: hostedApiPages([{ number: 0, title: "Issue", body: null, state: "open" }]),
      identifier: "issues:pagination"
    },
    {
      endpoint: `repos/${EXPECTED_REPOSITORY}/issues/comments?per_page=100`,
      stdout: hostedApiPages([{ id: 0, body: "comment" }]),
      identifier: "issue-comments:pagination"
    },
    {
      endpoint: `repos/${EXPECTED_REPOSITORY}/pulls?state=all&per_page=100`,
      stdout: hostedApiPages([{ number: "8", title: "Pull", body: null, state: "open" }]),
      identifier: "pull-requests:pagination"
    },
    {
      endpoint: `repos/${EXPECTED_REPOSITORY}/pulls/comments?per_page=100`,
      stdout: hostedApiPages([{ id: -1, body: "comment" }]),
      identifier: "review-comments:pagination"
    },
    {
      endpoint: `repos/${EXPECTED_REPOSITORY}/pulls/8/reviews?per_page=100`,
      stdout: hostedApiPages([{ id: 0, body: "review", state: "APPROVED" }]),
      identifier: "pull-request:1:reviews:pagination"
    },
    {
      endpoint: `repos/${EXPECTED_REPOSITORY}/actions/runs?per_page=100`,
      stdout: hostedApiPages({ total_count: 1, workflow_runs: [{ id: 0, name: "run", status: "completed" }] }),
      identifier: "actions-runs:pagination"
    }
  ];

  for (const [index, malformed] of cases.entries()) {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), `inner-signal-hosted-schema-${index}-`));
    context.after(async () => await rm(tempRoot, { recursive: true, force: true }));
    const fixture = makeHostedRunCommand();
    const command = async (tool, args, options) => {
      if (args.at(-1) === malformed.endpoint) return { stdout: malformed.stdout, stderr: "" };
      return await fixture.runCommand(tool, args, options);
    };
    await assert.rejects(
      collectHostedPublicationRecords({ repository: EXPECTED_REPOSITORY, runCommand: command, tempRoot }),
      (error) => {
        assert.equal(error.code, "audit-incomplete");
        assert.equal(error.identifier, malformed.identifier);
        return true;
      }
    );
  }
});

test("repository identity other than the exact publication target fails closed", async (context) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "inner-signal-hosted-audit-test-"));
  context.after(async () => await rm(tempRoot, { recursive: true, force: true }));

  await assert.rejects(
    collectHostedPublicationRecords({
      repository: "u-dont-existDOTcom/not-innerSignalGraph",
      runCommand: makeHostedRunCommand().runCommand,
      tempRoot
    }),
    (error) => {
      assert.equal(error.code, "audit-incomplete");
      assert.equal(error.identifier, "repository-identity");
      return true;
    }
  );
});

test("pinned Gitleaks wrapper downloads and executes only the reviewed Linux x86_64 asset", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inner-signal-gitleaks-wrapper-test-"));
  context.after(async () => await rm(root, { recursive: true, force: true }));
  const fakeBin = path.join(root, "bin");
  await mkdir(fakeBin);
  const invocationLog = path.join(root, "invocation.log");
  const curlLog = path.join(root, "curl.log");
  const checksumLog = path.join(root, "checksum.log");

  await writeExecutable(
    path.join(fakeBin, "uname"),
    "#!/usr/bin/env bash\nif [[ \"$1\" == \"-s\" ]]; then printf 'Linux\\n'; else printf 'x86_64\\n'; fi\n"
  );
  await writeExecutable(
    path.join(fakeBin, "curl"),
    "#!/usr/bin/env bash\nprintf '%s\\n' \"$*\" > \"$FAKE_CURL_LOG\"\nwhile (( $# )); do if [[ \"$1\" == \"--output\" ]]; then shift; : > \"$1\"; exit 0; fi; shift; done\nexit 2\n"
  );
  await writeExecutable(
    path.join(fakeBin, "sha256sum"),
    "#!/usr/bin/env bash\ninput=$(</dev/stdin)\nprintf '%s\\n' \"$input\" > \"$FAKE_CHECKSUM_LOG\"\n[[ \"$input\" == e4eb209d04e20339d77122a3bdf9cd41351255cfb27ebcb75e85325e04f88924* ]]\n"
  );
  await writeExecutable(
    path.join(fakeBin, "tar"),
    "#!/usr/bin/env bash\nwhile (( $# )); do if [[ \"$1\" == \"-C\" ]]; then shift; tool_root=\"$1\"; fi; shift; done\nprintf '#!/usr/bin/env bash\\nexit 0\\n' > \"$tool_root/gitleaks\"\nchmod 700 \"$tool_root/gitleaks\"\n"
  );
  await writeExecutable(
    path.join(fakeBin, "node"),
    `#!/usr/bin/env bash
if [[ "$1" == "scripts/validate-publication-audit-result.mjs" ]]; then
  exec "$REAL_NODE" "$@"
fi
printf '%s\n' "$*" > "$FAKE_INVOCATION_LOG"
printf '%s\n' '${JSON.stringify(hostedAuditResult())}'
`
  );

  const execution = await execFileAsync("bash", ["scripts/run-publication-audit-hosted.sh", "--github", EXPECTED_REPOSITORY], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PATH: `${fakeBin}:/usr/bin:/bin`,
      REAL_NODE: process.execPath,
      FAKE_INVOCATION_LOG: invocationLog,
      FAKE_CURL_LOG: curlLog,
      FAKE_CHECKSUM_LOG: checksumLog
    }
  });
  assert.deepEqual(JSON.parse(execution.stdout), hostedAuditResult());
  assert.equal(execution.stderr, "");

  const invocation = (await readFile(invocationLog, "utf8")).trim();
  const curlInvocation = (await readFile(curlLog, "utf8")).trim();
  const checksumInvocation = (await readFile(checksumLog, "utf8")).trim();
  assert.match(
    curlInvocation,
    /--fail --location --silent --show-error https:\/\/github\.com\/gitleaks\/gitleaks\/releases\/download\/v8\.29\.1\/gitleaks_8\.29\.1_linux_x64\.tar\.gz --output \/tmp\/inner-signal-gitleaks\./
  );
  assert.match(checksumInvocation, /^e4eb209d04e20339d77122a3bdf9cd41351255cfb27ebcb75e85325e04f88924  \/tmp\/inner-signal-gitleaks\./);
  assert.match(
    invocation,
    /^scripts\/audit-publication\.mjs --root .+ --github u-dont-existDOTcom\/innerSignalGraph --gitleaks \/tmp\/inner-signal-gitleaks\.[^/]+\/gitleaks$/
  );
  const binaryPath = invocation.split(" ").at(-1);
  await assert.rejects(access(binaryPath), "the exact wrapper temp root must be removed after execution");
});

test("hosted wrapper rejects absent or invalid audit results and preserves valid exit semantics", async (context) => {
  const harness = await makeHostedWrapperHarness(context);
  const finding = {
    severity: "error",
    code: "audit-incomplete",
    surface: "hosted",
    identifier: "synthetic"
  };
  const invalidCases = [
    { name: "absent", output: "", exitCode: 0 },
    { name: "whitespace", output: " \n", exitCode: 0 },
    { name: "malformed", output: "{", exitCode: 0 },
    { name: "multiple", output: "{}\n{}\n", exitCode: 0 },
    { name: "missing counts", output: JSON.stringify({ ...hostedAuditResult(), counts: undefined }), exitCode: 0 },
    { name: "success with findings", output: JSON.stringify(hostedAuditResult({ findings: [finding] })), exitCode: 0 },
    { name: "failure marked ok", output: JSON.stringify(hostedAuditResult()), exitCode: 1 },
    { name: "tool failure marked ok", output: JSON.stringify(hostedAuditResult()), exitCode: 2 },
    { name: "unsupported child exit", output: JSON.stringify(hostedAuditResult({ ok: false, findings: [finding] })), exitCode: 3 }
  ];

  for (const fixture of invalidCases) {
    await assert.rejects(
      execFileAsync("bash", ["scripts/run-publication-audit-hosted.sh", "--github", EXPECTED_REPOSITORY], {
        cwd: process.cwd(),
        env: {
          ...harness.env,
          FAKE_AUDIT_OUTPUT: fixture.output,
          FAKE_AUDIT_EXIT: String(fixture.exitCode)
        }
      }),
      (error) => {
        assert.equal(error.code, 2, fixture.name);
        assert.equal(error.stdout, "", fixture.name);
        assert.match(error.stderr, /invalid-hosted-audit-result/, fixture.name);
        return true;
      }
    );
  }

  const validCases = [
    { exitCode: 0, result: hostedAuditResult() },
    { exitCode: 1, result: hostedAuditResult({ ok: false, findings: [finding] }) },
    { exitCode: 2, result: hostedAuditResult({ ok: false, findings: [finding] }) },
    {
      exitCode: 1,
      result: {
        schemaVersion: 1,
        ok: false,
        scannedRecords: 0,
        findings: [finding]
      }
    },
    {
      exitCode: 2,
      result: {
        schemaVersion: 1,
        ok: false,
        scannedRecords: 0,
        findings: [finding]
      }
    }
  ];
  for (const fixture of validCases) {
    const expected = `${JSON.stringify(fixture.result)}\n`;
    if (fixture.exitCode === 0) {
      const execution = await execFileAsync(
        "bash",
        ["scripts/run-publication-audit-hosted.sh", "--github", EXPECTED_REPOSITORY],
        {
          cwd: process.cwd(),
          env: {
            ...harness.env,
            FAKE_AUDIT_OUTPUT: JSON.stringify(fixture.result),
            FAKE_AUDIT_EXIT: "0"
          }
        }
      );
      assert.equal(execution.stdout, expected);
      assert.equal(execution.stderr, "");
    } else {
      await assert.rejects(
        execFileAsync("bash", ["scripts/run-publication-audit-hosted.sh", "--github", EXPECTED_REPOSITORY], {
          cwd: process.cwd(),
          env: {
            ...harness.env,
            FAKE_AUDIT_OUTPUT: JSON.stringify(fixture.result),
            FAKE_AUDIT_EXIT: String(fixture.exitCode)
          }
        }),
        (error) => {
          assert.equal(error.code, fixture.exitCode);
          assert.equal(error.stdout, expected);
          assert.equal(error.stderr, "");
          return true;
        }
      );
    }
    assert.equal(await readFile(harness.outputModeLog, "utf8"), "600 700\n");
  }
});

test("hosted wrapper rejects silent audit and validator processes", async (context) => {
  const harness = await makeHostedWrapperHarness(context);
  for (const auditOutput of ["", JSON.stringify(hostedAuditResult())]) {
    await assert.rejects(
      execFileAsync("bash", ["scripts/run-publication-audit-hosted.sh", "--github", EXPECTED_REPOSITORY], {
        cwd: process.cwd(),
        env: {
          ...harness.env,
          FAKE_AUDIT_OUTPUT: auditOutput,
          FAKE_AUDIT_EXIT: "0",
          FAKE_VALIDATOR_NOOP: "1"
        }
      }),
      (error) => {
        assert.equal(error.code, 2);
        assert.equal(error.stdout, "");
        assert.match(error.stderr, /invalid-hosted-audit-result/);
        return true;
      }
    );
  }
});

test("wrong Gitleaks digest prevents scanner execution and cleans the private temp root", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inner-signal-gitleaks-wrapper-test-"));
  context.after(async () => await rm(root, { recursive: true, force: true }));
  const fakeBin = path.join(root, "bin");
  await mkdir(fakeBin);
  const invocationLog = path.join(root, "invocation.log");

  await writeExecutable(
    path.join(fakeBin, "uname"),
    "#!/usr/bin/env bash\nif [[ \"$1\" == \"-s\" ]]; then printf 'Linux\\n'; else printf 'x86_64\\n'; fi\n"
  );
  await writeExecutable(
    path.join(fakeBin, "curl"),
    "#!/usr/bin/env bash\nwhile (( $# )); do if [[ \"$1\" == \"--output\" ]]; then shift; : > \"$1\"; exit 0; fi; shift; done\nexit 2\n"
  );
  await writeExecutable(path.join(fakeBin, "sha256sum"), "#!/usr/bin/env bash\nexit 1\n");
  await writeExecutable(path.join(fakeBin, "tar"), "#!/usr/bin/env bash\nexit 99\n");
  await writeExecutable(
    path.join(fakeBin, "node"),
    "#!/usr/bin/env bash\nprintf 'executed\\n' > \"$FAKE_INVOCATION_LOG\"\n"
  );

  await assert.rejects(
    execFileAsync("bash", ["scripts/run-publication-audit-hosted.sh", "--github", EXPECTED_REPOSITORY], {
      cwd: process.cwd(),
      env: { ...process.env, PATH: `${fakeBin}:/usr/bin:/bin`, FAKE_INVOCATION_LOG: invocationLog }
    }),
    (error) => {
      assert.notEqual(error.code, 0);
      assert.match(error.stderr, /gitleaks-checksum-mismatch/);
      return true;
    }
  );
  await assert.rejects(access(invocationLog), "checksum failure must prevent scanner execution");
});

test("unsupported scanner platform exits with a named error before download", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inner-signal-gitleaks-wrapper-test-"));
  context.after(async () => await rm(root, { recursive: true, force: true }));
  const fakeBin = path.join(root, "bin");
  await mkdir(fakeBin);
  const invocationLog = path.join(root, "invocation.log");

  await writeExecutable(
    path.join(fakeBin, "uname"),
    "#!/usr/bin/env bash\nif [[ \"$1\" == \"-s\" ]]; then printf 'Linux\\n'; else printf 'aarch64\\n'; fi\n"
  );
  await writeExecutable(
    path.join(fakeBin, "curl"),
    "#!/usr/bin/env bash\nprintf 'downloaded\\n' > \"$FAKE_INVOCATION_LOG\"\n"
  );

  await assert.rejects(
    execFileAsync("bash", ["scripts/run-publication-audit-hosted.sh", "--github", EXPECTED_REPOSITORY], {
      cwd: process.cwd(),
      env: { ...process.env, PATH: `${fakeBin}:/usr/bin:/bin`, FAKE_INVOCATION_LOG: invocationLog }
    }),
    (error) => {
      assert.notEqual(error.code, 0);
      assert.match(error.stderr, /unsupported-scanner-platform/);
      return true;
    }
  );
  await assert.rejects(access(invocationLog), "unsupported platforms must not download or execute the scanner");
});

test("Gitleaks safe normalization discards secret fields and redacts malicious metadata", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inner-signal-gitleaks-adapter-test-"));
  const hostedRoot = await mkdtemp(path.join(os.tmpdir(), "inner-signal-gitleaks-hosted-test-"));
  context.after(async () => await rm(root, { recursive: true, force: true }));
  context.after(async () => await rm(hostedRoot, { recursive: true, force: true }));
  const sentinel = `ghp_${"q".repeat(36)}`;
  const reportRoots = [];

  const result = await runGitleaks({
    binary: "/synthetic/gitleaks",
    root,
    hostedRoot,
    runCommand: async (command, args) => {
      assert.equal(command, "/synthetic/gitleaks");
      assert.equal(args.includes("--redact=100"), true);
      assert.equal(args.includes("--no-banner"), true);
      assert.equal(args.includes("--report-format=json"), true);
      const reportPath = args.find((argument) => argument.startsWith("--report-path=")).slice("--report-path=".length);
      reportRoots.push(path.dirname(reportPath));
      if (args[0] === "git") {
        await writeFile(
          reportPath,
          JSON.stringify([
            {
              RuleID: `rule-${sentinel}`,
              Commit: "a".repeat(40),
              File: `nested/${sentinel}.txt`,
              StartLine: 7,
              Secret: sentinel,
              Match: `token=${sentinel}`,
              Entropy: 9.9,
              Message: sentinel
            }
          ])
        );
        return { exitCode: 1, stdout: Buffer.from([0, 255]), stderr: Buffer.from([255]) };
      }
      await writeFile(reportPath, "[]\n");
      return { exitCode: 0, stdout: "", stderr: "" };
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.scannedRecords, 1);
  assert.deepEqual(result.findings.map(({ code, surface }) => ({ code, surface })), [
    { code: "credential-pattern", surface: "gitleaks" }
  ]);
  assert.deepEqual(result.findings.map(({ identifier }) => identifier), [
    `git:finding:1:commit:${"a".repeat(40)}:line:7`
  ]);
  assert.equal(JSON.stringify(result).includes(sentinel), false, "Gitleaks result must omit secret and malicious metadata");
  assert.equal(reportRoots.length, 2);
  for (const reportRoot of reportRoots) {
    await assert.rejects(access(reportRoot), "raw Gitleaks reports must be removed after normalization");
  }
});

test("Gitleaks hosted findings use actionable in-memory locators and unknown files fail closed", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inner-signal-gitleaks-map-test-"));
  const hostedRoot = await mkdtemp(path.join(os.tmpdir(), "inner-signal-gitleaks-map-hosted-test-"));
  context.after(async () => await rm(root, { recursive: true, force: true }));
  context.after(async () => await rm(hostedRoot, { recursive: true, force: true }));
  await writeFile(path.join(hostedRoot, "hosted-1.raw"), "private fixture\n", { mode: 0o600 });
  await writeFile(path.join(hostedRoot, "hosted-2.raw"), "private branch fixture\n", { mode: 0o600 });
  await writeFile(path.join(hostedRoot, "hosted-3.raw"), "private repository fixture\n", { mode: 0o600 });
  const branchCommit = "b".repeat(40);

  const actionable = await runGitleaks({
    binary: "/synthetic/gitleaks",
    root,
    hostedRoot,
    hostedFileIdentifiers: new Map([
      ["hosted-1.raw", "actions-log:run:101"],
      ["hosted-2.raw", `branch:commit:${branchCommit}:rank:2`],
      ["hosted-3.raw", "repository:field:description"]
    ]),
    runCommand: async (_command, args) => {
      const reportPath = args.find((argument) => argument.startsWith("--report-path=")).slice("--report-path=".length);
      await writeFile(
        reportPath,
        args[0] === "dir"
          ? JSON.stringify([
              { RuleID: "generic-api-key", Commit: "", File: "hosted-1.raw", StartLine: 4 },
              { RuleID: "generic-api-key", Commit: "", File: "hosted-2.raw", StartLine: 2 },
              { RuleID: "generic-api-key", Commit: "", File: "hosted-3.raw", StartLine: 1 }
            ])
          : "[]"
      );
      return { exitCode: args[0] === "dir" ? 1 : 0, stdout: "", stderr: "" };
    }
  });
  assert.deepEqual(actionable.findings, [
    {
      severity: "error",
      code: "credential-pattern",
      surface: "gitleaks",
      identifier: "actions-log:run:101:line:4"
    },
    {
      severity: "error",
      code: "credential-pattern",
      surface: "gitleaks",
      identifier: `branch:commit:${branchCommit}:rank:2:line:2`
    },
    {
      severity: "error",
      code: "credential-pattern",
      surface: "gitleaks",
      identifier: "repository:field:description:line:1"
    }
  ]);

  const sentinel = `ghp_${"u".repeat(36)}`;
  const unknown = await runGitleaks({
    binary: "/synthetic/gitleaks",
    root,
    hostedRoot,
    hostedFileIdentifiers: new Map([["hosted-1.raw", "actions-log:run:101"]]),
    runCommand: async (_command, args) => {
      const reportPath = args.find((argument) => argument.startsWith("--report-path=")).slice("--report-path=".length);
      await writeFile(
        reportPath,
        args[0] === "dir"
          ? JSON.stringify([{ RuleID: sentinel, Commit: "", File: `unknown-${sentinel}.raw`, StartLine: 1 }])
          : "[]"
      );
      return { exitCode: args[0] === "dir" ? 1 : 0, stdout: "", stderr: "" };
    }
  });
  assert.deepEqual(unknown.findings, [
    { severity: "error", code: "audit-incomplete", surface: "gitleaks", identifier: "dir:report-metadata:1" }
  ]);
  assert.equal(JSON.stringify(unknown).includes(sentinel), false);
});

test("Gitleaks report files exist as private regular files before scanner writes", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inner-signal-gitleaks-report-mode-test-"));
  const hostedRoot = await mkdtemp(path.join(os.tmpdir(), "inner-signal-gitleaks-report-mode-hosted-test-"));
  context.after(async () => await rm(root, { recursive: true, force: true }));
  context.after(async () => await rm(hostedRoot, { recursive: true, force: true }));

  const visibleModes = [];
  const result = await runGitleaks({
    binary: "/synthetic/gitleaks",
    root,
    hostedRoot,
    hostedFileIdentifiers: new Map(),
    runCommand: async (_command, args) => {
      const reportPath = args.find((argument) => argument.startsWith("--report-path=")).slice("--report-path=".length);
      const before = await stat(reportPath);
      visibleModes.push(before.mode & 0o777);
      assert.equal(before.isFile(), true);
      await writeFile(reportPath, "[]\n");
      return { exitCode: 0, stdout: "", stderr: "" };
    }
  });

  assert.deepEqual(visibleModes, [0o600, 0o600]);
  assert.equal(result.ok, true);
});

test("Gitleaks rejects report mode drift and symlink replacement before reading", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inner-signal-gitleaks-report-output-test-"));
  const hostedRoot = await mkdtemp(path.join(os.tmpdir(), "inner-signal-gitleaks-report-output-hosted-test-"));
  const outsideReport = path.join(hostedRoot, "outside-report.json");
  context.after(async () => await rm(root, { recursive: true, force: true }));
  context.after(async () => await rm(hostedRoot, { recursive: true, force: true }));
  await writeFile(outsideReport, "[]\n", { mode: 0o600 });

  const result = await runGitleaks({
    binary: "/synthetic/gitleaks",
    root,
    hostedRoot,
    hostedFileIdentifiers: new Map([["outside-report.json", "repository"]]),
    runCommand: async (_command, args) => {
      const reportPath = args.find((argument) => argument.startsWith("--report-path=")).slice("--report-path=".length);
      if (args[0] === "git") {
        await writeFile(reportPath, "[]\n");
        await chmod(reportPath, 0o644);
      } else {
        await rm(reportPath);
        await symlink(outsideReport, reportPath);
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    }
  });

  assert.deepEqual(result.findings, [
    { severity: "error", code: "audit-incomplete", surface: "gitleaks", identifier: "dir:report" },
    { severity: "error", code: "audit-incomplete", surface: "gitleaks", identifier: "git:report" }
  ]);
  assert.equal(await readFile(outsideReport, "utf8"), "[]\n");
});

test("Gitleaks normalization reads each opened report inode after pathname replacement", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inner-signal-gitleaks-report-race-test-"));
  const hostedRoot = await mkdtemp(path.join(os.tmpdir(), "inner-signal-gitleaks-report-race-hosted-test-"));
  const replacement = path.join(hostedRoot, "replacement.json");
  context.after(async () => await rm(root, { recursive: true, force: true }));
  context.after(async () => await rm(hostedRoot, { recursive: true, force: true }));
  await writeFile(replacement, "not-json\n", { mode: 0o600 });
  let replacements = 0;

  const result = await runGitleaks({
    binary: "/synthetic/gitleaks",
    root,
    hostedRoot,
    runCommand: async (_command, args) => {
      const reportPath = args.find((argument) => argument.startsWith("--report-path=")).slice("--report-path=".length);
      await writeFile(reportPath, "[]\n");
      return { exitCode: 0, stdout: "", stderr: "" };
    },
    withOpenedFile: async (file, reader) => await withOpenedRegularFile(file, async (handle, openedStat) => {
      await fsRename(file, `${file}.original`);
      await symlink(replacement, file);
      replacements += 1;
      return await reader(handle, openedStat);
    })
  });

  assert.equal(replacements, 2);
  assert.equal(result.ok, true);
});

test("Gitleaks rejects zero-byte git and directory reports for every scanner exit", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inner-signal-gitleaks-empty-report-test-"));
  const hostedRoot = await mkdtemp(path.join(os.tmpdir(), "inner-signal-gitleaks-empty-report-hosted-test-"));
  context.after(async () => await rm(root, { recursive: true, force: true }));
  context.after(async () => await rm(hostedRoot, { recursive: true, force: true }));

  for (const exitCode of [0, 1, 2]) {
    const result = await runGitleaks({
      binary: "/synthetic/gitleaks",
      root,
      hostedRoot,
      runCommand: async () => ({ exitCode, stdout: "", stderr: "" })
    });
    assert.equal(result.ok, false, `exit ${exitCode}`);
    assert.equal(
      result.findings.some(({ identifier }) => identifier === "git:report"),
      true,
      `exit ${exitCode} git report`
    );
    assert.equal(
      result.findings.some(({ identifier }) => identifier === "dir:report"),
      true,
      `exit ${exitCode} directory report`
    );
  }
});

test("Gitleaks exit handling treats only zero and one as complete scanner outcomes", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inner-signal-gitleaks-adapter-test-"));
  const hostedRoot = await mkdtemp(path.join(os.tmpdir(), "inner-signal-gitleaks-hosted-test-"));
  context.after(async () => await rm(root, { recursive: true, force: true }));
  context.after(async () => await rm(hostedRoot, { recursive: true, force: true }));

  const clear = await runGitleaks({
    binary: "/synthetic/gitleaks",
    root,
    hostedRoot,
    runCommand: async (_command, args) => {
      const reportPath = args.find((argument) => argument.startsWith("--report-path=")).slice("--report-path=".length);
      await writeFile(reportPath, "[]\n");
      return { exitCode: 0, stdout: "", stderr: "" };
    }
  });
  assert.deepEqual(clear, { schemaVersion: 1, ok: true, scannedRecords: 0, findings: [] });

  const incomplete = await runGitleaks({
    binary: "/synthetic/gitleaks",
    root,
    hostedRoot,
    runCommand: async (_command, args) => {
      const reportPath = args.find((argument) => argument.startsWith("--report-path=")).slice("--report-path=".length);
      await writeFile(reportPath, "[]\n");
      return { exitCode: args[0] === "git" ? 2 : 0, stdout: "", stderr: "" };
    }
  });
  assert.equal(incomplete.ok, false);
  assert.deepEqual(incomplete.findings, [
    { severity: "error", code: "audit-incomplete", surface: "gitleaks", identifier: "git:exit:2" }
  ]);
});

test("binary Gitleaks report and unsafe reported file path fail closed without raw bytes or paths", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inner-signal-gitleaks-adapter-test-"));
  const hostedRoot = await mkdtemp(path.join(os.tmpdir(), "inner-signal-gitleaks-hosted-test-"));
  context.after(async () => await rm(root, { recursive: true, force: true }));
  context.after(async () => await rm(hostedRoot, { recursive: true, force: true }));

  let invocation = 0;
  const result = await runGitleaks({
    binary: "/synthetic/gitleaks",
    root,
    hostedRoot,
    runCommand: async (_command, args) => {
      invocation += 1;
      const reportPath = args.find((argument) => argument.startsWith("--report-path=")).slice("--report-path=".length);
      if (invocation === 1) await writeFile(reportPath, Buffer.from([0xff, 0xfe, 0xfd]));
      else {
        await writeFile(
          reportPath,
          JSON.stringify([{ RuleID: "generic", Commit: "", File: "/home/private-user/secret.txt", StartLine: 1 }])
        );
      }
      return { exitCode: 1, stdout: "", stderr: "" };
    }
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.findings, [
    { severity: "error", code: "audit-incomplete", surface: "gitleaks", identifier: "dir:report-metadata:1" },
    { severity: "error", code: "audit-incomplete", surface: "gitleaks", identifier: "git:report" }
  ]);
  assert.equal(JSON.stringify(result).includes("private-user"), false);
  assert.equal(JSON.stringify(result).includes("secret.txt"), false);
});

test("publication result merging preserves only safe finding projections", () => {
  const safe = scanPublicationRecords([{ surface: "git", identifier: "safe", text: "redacted" }]);
  const blocked = scanPublicationRecords([
    { surface: "git", identifier: "blocked", path: ".env", text: "placeholder" }
  ]);

  assert.deepEqual(mergePublicationResults(safe, blocked), {
    schemaVersion: 1,
    ok: false,
    scannedRecords: 2,
    findings: [{ severity: "error", code: "secret-file", surface: "git", identifier: "blocked" }]
  });
});

test("publication audit CLI returns one JSON result with contractual exit codes", async (context) => {
  const safeRoot = await makeGitRepository();
  const blockedRoot = await makeGitRepository();
  context.after(async () => await rm(safeRoot, { recursive: true, force: true }));
  context.after(async () => await rm(blockedRoot, { recursive: true, force: true }));

  await writeFile(path.join(safeRoot, ".env.example"), "TOKEN=replace-me\n");
  await git(safeRoot, "add", ".env.example");
  await git(safeRoot, "commit", "-m", "add safe example");

  const success = await execFileAsync(process.execPath, ["scripts/audit-publication.mjs", "--root", safeRoot]);
  const successResult = JSON.parse(success.stdout);
  assert.equal(successResult.ok, true);
  assert.equal(success.stderr, "");

  await writeFile(path.join(blockedRoot, ".env"), "TOKEN=placeholder\n");
  await git(blockedRoot, "add", ".env");
  await git(blockedRoot, "commit", "-m", "add blocked path");

  await assert.rejects(
    execFileAsync(process.execPath, ["scripts/audit-publication.mjs", "--root", blockedRoot]),
    (error) => {
      assert.equal(error.code, 1);
      const result = JSON.parse(error.stdout);
      assert.equal(result.ok, false);
      assert.deepEqual(result.findings.map(({ code }) => code), ["secret-file"]);
      assert.equal(error.stderr, "");
      return true;
    }
  );

  await assert.rejects(execFileAsync(process.execPath, ["scripts/audit-publication.mjs", "--unknown"]), (error) => {
    assert.equal(error.code, 2);
    assert.deepEqual(JSON.parse(error.stdout), {
      schemaVersion: 1,
      ok: false,
      scannedRecords: 0,
      findings: [{ severity: "error", code: "invalid-arguments", surface: "cli", identifier: "arguments" }]
    });
    assert.equal(error.stderr, "");
    return true;
  });
});

test("hosted publication audit CLI composes Git, hosted records, and Gitleaks with private cleanup", async (context) => {
  const root = await makeGitRepository();
  const fakeBin = await mkdtemp(path.join(os.tmpdir(), "inner-signal-hosted-cli-bin-"));
  context.after(async () => await rm(root, { recursive: true, force: true }));
  context.after(async () => await rm(fakeBin, { recursive: true, force: true }));
  await writeFile(path.join(root, "safe.txt"), "safe repository content\n");
  await git(root, "add", "safe.txt");
  await git(root, "commit", "-m", "add safe content");

  await writeExecutable(
    path.join(fakeBin, "gh"),
    `#!/usr/bin/env bash
endpoint="\${!#}"
case "$endpoint" in
  "repos/${EXPECTED_REPOSITORY}") printf '%s\\n' '{"full_name":"${EXPECTED_REPOSITORY}","visibility":"private","default_branch":"main"}' ;;
  "repos/${EXPECTED_REPOSITORY}/branches?per_page=100") printf '%s\\n' '[{"name":"main","commit":{"sha":"1111111111111111111111111111111111111111"},"protected":false}]' ;;
  "repos/${EXPECTED_REPOSITORY}/issues?state=all&per_page=100"|"repos/${EXPECTED_REPOSITORY}/issues/comments?per_page=100"|"repos/${EXPECTED_REPOSITORY}/pulls?state=all&per_page=100"|"repos/${EXPECTED_REPOSITORY}/pulls/comments?per_page=100") printf '%s\\n' '[]' ;;
  "repos/${EXPECTED_REPOSITORY}/actions/runs?per_page=100") printf '%s\\n' '{"total_count":0,"workflow_runs":[]}' ;;
  "repos/${EXPECTED_REPOSITORY}/actions/artifacts?per_page=100") printf '%s\\n' '{"total_count":0,"artifacts":[]}' ;;
  *) exit 9 ;;
esac
`
  );
  const fakeGitleaks = path.join(fakeBin, "gitleaks");
  const hostedRootLog = path.join(fakeBin, "hosted-root.log");
  await writeExecutable(
    fakeGitleaks,
    "#!/usr/bin/env bash\nif [[ \"$1\" == \"dir\" ]]; then printf '%s\\n' \"$2\" > \"$FAKE_HOSTED_ROOT_LOG\"; fi\nfor argument in \"$@\"; do case \"$argument\" in --report-path=*) report_path=\"${argument#--report-path=}\" ;; esac; done\nprintf '[]\\n' > \"$report_path\"\n"
  );

  const success = await execFileAsync(
    process.execPath,
    [
      "scripts/audit-publication.mjs",
      "--root",
      root,
      "--github",
      EXPECTED_REPOSITORY,
      "--gitleaks",
      fakeGitleaks
    ],
    { env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}`, FAKE_HOSTED_ROOT_LOG: hostedRootLog } }
  );
  const result = JSON.parse(success.stdout);
  assert.equal(success.stderr, "");
  assert.equal(result.ok, true);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.counts, {
    refs: 1,
    commits: 1,
    objects: 3,
    blobs: 1,
    branches: 1,
    issues: 0,
    pullRequests: 0,
    issueComments: 0,
    reviewComments: 0,
    reviews: 0,
    actionRuns: 0,
    actionLogs: 0,
    artifacts: 0
  });
  const cleanedHostedRoot = (await readFile(hostedRootLog, "utf8")).trim();
  assert.match(cleanedHostedRoot, /^\/tmp\/inner-signal-hosted-publication-/);
  await assert.rejects(access(cleanedHostedRoot), "hosted raw temp root must be removed after successful orchestration");

  await assert.rejects(
    execFileAsync(process.execPath, ["scripts/audit-publication.mjs", "--root", root, "--github", EXPECTED_REPOSITORY]),
    (error) => {
      assert.equal(error.code, 2);
      assert.deepEqual(JSON.parse(error.stdout).findings.map(({ code }) => code), ["invalid-arguments"]);
      assert.equal(error.stderr, "");
      return true;
    }
  );
});

test("publication audit CLI returns exit 2 for a Git tool failure", async () => {
  const missingRoot = path.join(os.tmpdir(), `inner-signal-publication-audit-missing-${process.pid}-${Date.now()}`);

  await assert.rejects(
    execFileAsync(process.execPath, ["scripts/audit-publication.mjs", "--root", missingRoot]),
    (error) => {
      assert.equal(error.code, 2);
      assert.deepEqual(JSON.parse(error.stdout), {
        schemaVersion: 1,
        ok: false,
        scannedRecords: 0,
        findings: [{ severity: "error", code: "audit-tool-failure", surface: "cli", identifier: "git" }]
      });
      assert.equal(error.stderr, "");
      return true;
    }
  );
});

test("filename-only credential is redacted from publication audit CLI JSON", async (context) => {
  const root = await makeGitRepository();
  context.after(async () => await rm(root, { recursive: true, force: true }));
  const sentinel = `ghp_${"c".repeat(36)}`;

  await writeFile(path.join(root, sentinel), "safe body\n");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "add filename-only fixture");

  await assert.rejects(execFileAsync(process.execPath, ["scripts/audit-publication.mjs", "--root", root]), (error) => {
    assert.equal(error.code, 1);
    const result = JSON.parse(error.stdout);
    assert.deepEqual(result.findings.map(({ code }) => code), ["credential-pattern"]);
    assert.equal(JSON.stringify(result).includes(sentinel), false, "CLI JSON must omit the matched filename");
    assert.equal(error.stderr, "");
    return true;
  });
});
