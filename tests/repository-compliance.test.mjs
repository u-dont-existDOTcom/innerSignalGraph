import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checkpointPath = "state/CODEX-CURRENT-STATE.md";
const expectedCommands = {
  bootstrap: "npm ci --ignore-scripts",
  test: "npm test",
  graph: "npm run graph:test",
  package: "npm run verify",
  audit: "npm run audit:repository",
  verify: "npm run verify",
  current_state: "bash scripts/report-worktree.sh"
};

async function read(relative) {
  return await fs.readFile(path.join(root, relative), "utf8");
}

test("repository profile declares exact commands and one canonical checkpoint", async () => {
  const profile = JSON.parse(await read(".github/codex-repository.json"));
  assert.equal(profile.repository_kind, "software");
  assert.equal(profile.active, true);
  assert.equal(profile.long_running, true);
  assert.equal(profile.visibility, "private");
  assert.equal(profile.risk, "critical");
  assert.deepEqual(profile.commands, expectedCommands);
  assert.equal(profile.current_state, checkpointPath);

  const checkpoint = (await read(checkpointPath)).toLowerCase();
  for (const heading of [
    "goal",
    "authority / baseline",
    "completed",
    "current checkpoint",
    "remaining",
    "blockers / unresolved",
    "evidence / artifacts",
    "next safe action"
  ]) {
    assert.match(checkpoint, new RegExp(`^## ${heading.replace("/", "\\/")}$`, "m"));
  }
});

test("all entry documents route to the canonical checkpoint and retire the stale checkpoint", async () => {
  for (const relative of ["AGENTS.md", "README.md", "docs/INDEX.md"]) {
    assert.match(await read(relative), /state\/CODEX-CURRENT-STATE\.md/, relative);
  }
  const retired = await read("docs/CURRENT-STATE.md");
  assert.match(retired, /superseded/i);
  assert.match(retired, /state\/CODEX-CURRENT-STATE\.md/);

  const implementation = await read("IMPLEMENTATION-REPORT-v0.15.2.md");
  assert.match(implementation, /historical intake note[^\n]*\n[^\n]*No `AGENTS\.md`/i);
});

test("private security, contribution, PR, and release evidence contracts are explicit", async () => {
  const security = (await read("SECURITY.md")).toLowerCase();
  assert.match(security, /draft security advisor|private.*channel/);
  assert.match(security, /do not.*credential|never.*credential/);
  assert.match(security, /therapy.*data|therapy.*content/);

  const contributing = (await read("CONTRIBUTING.md")).toLowerCase();
  assert.match(contributing, /private/);
  assert.match(contributing, /owner-controlled/);
  assert.match(contributing, /no public license|not grant.*license/);

  const release = `${await read("docs/RELEASE-EVIDENCE.md")}\n${await read(
    ".github/RELEASE-EVIDENCE-TEMPLATE.md"
  )}`.toLowerCase();
  for (const phrase of [
    "exact candidate commit",
    "deterministic",
    "live-model entitlement",
    "adversarial review",
    "psychological-safety",
    "owner decision",
    "stable",
    "transactional install",
    "private-byte preservation",
    "rollback",
    "installed commit",
    "sustained health"
  ]) {
    assert.match(release, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), phrase);
  }
  assert.match(release, /deterministic[^\n]*cannot[^\n]*live|does not[^\n]*live-model entitlement/);

  const pullRequest = (await read(".github/pull_request_template.md")).toLowerCase();
  for (const phrase of ["acceptance", "rollback", "current-state", "residual", "privacy", "stable", "final diff"]) {
    assert.match(pullRequest, new RegExp(phrase), phrase);
  }
});

test("machine-readable repository audit passes repository-visible controls", async () => {
  const script = path.join(root, "scripts", "audit-repository.mjs");
  let result;
  try {
    const success = await execFileAsync(process.execPath, [script], { cwd: root });
    result = { code: 0, stdout: success.stdout, stderr: success.stderr };
  } catch (error) {
    result = {
      code: Number(error.code),
      stdout: String(error.stdout ?? ""),
      stderr: String(error.stderr ?? "")
    };
  }
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  const audit = JSON.parse(result.stdout);
  assert.equal(audit.ok, true);
  assert.equal(audit.errors, 0);
  assert.ok(Array.isArray(audit.findings));
});
