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

test("CODEOWNERS explicitly routes every high-consequence path", async () => {
  const codeowners = await read(".github/CODEOWNERS");
  for (const ownerPath of [
    "/.github/",
    "/packaging/",
    "/run-autopilot.sh",
    "/scripts/verify-clean.sh",
    "/scripts/verify-package.sh",
    "/src/git/",
    "/src/cli/git-update.mjs",
    "/src/diagnostics/",
    "/src/export/",
    "/guides/",
    "/guide-graphs/",
    "/guide-packets/",
    "/src/guide-packet/",
    "/src/hypnosis/",
    "/src/prompts/",
    "/src/autopilot/model-policy.mjs",
    "/src/autopilot/model-resolver.mjs",
    "/src/core/config.mjs",
    "/src/providers/",
    "/THERAPY-LESSONS",
    "/ledgers/",
    "/docs/RELEASE-EVIDENCE.md"
  ]) {
    assert.match(codeowners, new RegExp(`^${ownerPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+@u-dont-existDOTcom$`, "m"), ownerPath);
  }
});

test("CI uses immutable least-privilege actions, exact runtime, scoped concurrency, and drift coverage", async () => {
  const relativeWorkflows = [
    ".github/workflows/verify.yml",
    ".github/workflows/repository-workflow-policy.yml"
  ];
  const workflows = await Promise.all(relativeWorkflows.map(async (relative) => [relative, await read(relative)]));
  for (const [relative, workflow] of workflows) {
    assert.match(workflow, /^permissions:\n  contents: read$/m, relative);
    assert.match(workflow, /timeout-minutes:\s*[1-9][0-9]*/, relative);
    assert.match(workflow, /group:\s*\$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}/, relative);
    assert.match(workflow, /cancel-in-progress:\s*\$\{\{ github\.event_name == 'pull_request' \}\}/, relative);
    assert.match(workflow, /branches:\s*\[main, stable\]/, relative);
    assert.match(workflow, /node-version-file:\s*\.nvmrc/, relative);
    assert.match(workflow, /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/, relative);
    assert.match(workflow, /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020/, relative);
    const checkoutCount = (workflow.match(/actions\/checkout@/g) ?? []).length;
    const noCredentialCount = (workflow.match(/persist-credentials:\s*false/g) ?? []).length;
    assert.equal(noCredentialCount, checkoutCount, `${relative}: every checkout disables persisted credentials`);
    assert.doesNotMatch(workflow, /OPENAI_API_KEY|ANTHROPIC_API_KEY|CODEX_COMMAND|CLAUDE_COMMAND/);
  }

  const verify = workflows[0][1];
  assert.match(verify, /name:\s*deterministic-package/);
  assert.match(verify, /npm ci --ignore-scripts/);
  assert.match(verify, /npm run audit:repository/);
  assert.match(verify, /npm run verify/);
  assert.match(verify, /git status --porcelain/);

  const policy = workflows[1][1];
  assert.match(policy, /name:\s*workflow-policy/);
  assert.match(policy, /schedule:/);
  assert.match(policy, /cron:/);
  assert.match(policy, /workflow_dispatch:/);
  assert.match(policy, /npm ci --ignore-scripts/);
  assert.match(policy, /npm run audit:repository/);
});

test("hosted-control evidence records verified improvements and exact unresolved boundaries", async () => {
  const profile = JSON.parse(await read(".github/codex-repository.json"));
  assert.deepEqual(
    {
      actions_default_permissions: profile.github_controls.actions_default_permissions,
      actions_allowed_set: profile.github_controls.actions_allowed_set,
      actions_sha_pinning: profile.github_controls.actions_sha_pinning,
      vulnerability_alerts: profile.github_controls.vulnerability_alerts,
      dependabot_alerts: profile.github_controls.dependabot_alerts,
      automated_security_fixes: profile.github_controls.automated_security_fixes,
      default_branch_rules: profile.github_controls.default_branch_rules,
      stable_branch_rules: profile.github_controls.stable_branch_rules,
      secret_scanning: profile.github_controls.secret_scanning,
      push_protection: profile.github_controls.push_protection,
      code_scanning: profile.github_controls.code_scanning,
      private_vulnerability_reporting: profile.github_controls.private_vulnerability_reporting,
      github_app_permissions: profile.github_controls.github_app_permissions
    },
    {
      actions_default_permissions: "verified",
      actions_allowed_set: "enabled",
      actions_sha_pinning: "enabled",
      vulnerability_alerts: "enabled",
      dependabot_alerts: "enabled",
      automated_security_fixes: "enabled",
      default_branch_rules: "disabled",
      stable_branch_rules: "disabled",
      secret_scanning: "disabled",
      push_protection: "disabled",
      code_scanning: "disabled",
      private_vulnerability_reporting: "not_applicable",
      github_app_permissions: "unverified"
    }
  );
  assert.equal(
    profile.github_controls_evidence.hardening_issue,
    "https://github.com/u-dont-existDOTcom/innerSignalGraph/issues/4"
  );
  assert.match(profile.github_controls_evidence.branch_rules, /HTTP 403/);
  assert.match(profile.github_controls_evidence.security, /HTTP 422/);

  const report = await read("docs/CODEX-GITHUB-COMPLIANCE-REPORT-2026-08-14.md");
  assert.match(report, /Terminal status:\s*`BLOCKED`/);
  assert.match(report, /issues\/4/);
  assert.match(report, /81265fd3592ee842bfe30c7d73a5c1f3dc01b2d0/);
  assert.match(report, /GitHub App installation permissions[^\n]*`UNVERIFIED`/i);
  assert.doesNotMatch(report, /gho_[A-Za-z0-9]/);
});
