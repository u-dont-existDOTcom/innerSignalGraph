import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import {
  auditGitPublication,
  mergePublicationResults,
  scanPublicationRecords
} from "../src/compliance/publication-audit.mjs";

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
