import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { auditRepository } from "../scripts/audit-repository.mjs";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checkpointPath = "state/CODEX-CURRENT-STATE.md";
const expectedCommands = {
  bootstrap: "npm ci --ignore-scripts",
  test: "npm test",
  graph: "npm run graph:test",
  package: "npm run verify",
  audit: "npm run audit:repository",
  publication: "npm run audit:publication",
  verify: "npm run verify",
  current_state: "bash scripts/report-worktree.sh"
};
const expectedPublicationTransition = {
  target_visibility: "public",
  license: "MIT",
  status: "pre_publication_ready",
  design: "docs/superpowers/specs/2026-08-14-public-repository-transition-design.md",
  audit_command: "npm run audit:publication:hosted"
};
const expectedMitLicense = `MIT License

Copyright (c) 2026 u-dont-existDOTcom

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

async function read(relative) {
  return await fs.readFile(path.join(root, relative), "utf8");
}

async function createAuditFixture(t) {
  const fixture = await fs.mkdtemp(path.join(path.dirname(root), "inner-signal-public-contract-"));
  t.after(() => fs.rm(fixture, { recursive: true, force: true }));
  const excluded = new Set([".git", ".superpowers", "node_modules"]);
  await fs.cp(root, fixture, {
    recursive: true,
    filter: (source) => source === root || !excluded.has(path.basename(source))
  });
  return fixture;
}

test("repository profile declares exact commands, publication transition, and one canonical checkpoint", async () => {
  const profile = JSON.parse(await read(".github/codex-repository.json"));
  assert.equal(profile.repository_kind, "software");
  assert.equal(profile.active, true);
  assert.equal(profile.long_running, true);
  assert.equal(profile.visibility, "private");
  assert.equal(profile.risk, "critical");
  assert.deepEqual(profile.commands, expectedCommands);
  assert.deepEqual(profile.publication_transition, expectedPublicationTransition);
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

test("publication transition entry documents route to the design, audits, checkpoint, and report", async () => {
  for (const relative of ["AGENTS.md", "README.md", "docs/INDEX.md"]) {
    const entry = await read(relative);
    assert.match(entry, /docs\/superpowers\/specs\/2026-08-14-public-repository-transition-design\.md/, relative);
    assert.match(entry, /`npm run audit:publication`/, relative);
    assert.match(entry, /`npm run audit:publication:hosted`/, relative);
    assert.match(entry, /state\/CODEX-CURRENT-STATE\.md/, relative);
    assert.match(entry, /docs\/PUBLIC-REPOSITORY-TRANSITION-REPORT-2026-08-14\.md/, relative);
    assert.doesNotMatch(entry, /repository is (?:now |already )?public/i, relative);
  }
});

test("the repository carries the unmodified standard MIT license", async () => {
  assert.equal(await read("LICENSE"), expectedMitLicense);
});

test("public security reporting preserves private fallbacks and every excluded-data boundary", async () => {
  const security = (await read("SECURITY.md")).toLowerCase();
  assert.match(security, /github private vulnerability reporting/);
  assert.match(security, /once (?:it is|this is) enabled/);
  assert.match(security, /draft security advisor/);
  assert.match(security, /private.*(?:contact|channel)/);
  assert.match(security, /synthetic/);
  assert.match(security, /redacted/);
  for (const excluded of [
    "credentials",
    "tokens",
    "cookies",
    ".env",
    "private keys",
    "browser chat",
    "therapy/hypnosis content",
    "prompts",
    "model output/reasoning",
    "raw sensitive logs",
    "usernames",
    "hostnames",
    "ip addresses",
    "absolute home paths"
  ]) {
    assert.ok(security.includes(excluded), excluded);
  }
});

test("public contributions use focused pull requests under MIT without gaining owner authority", async () => {
  const contributing = (await read("CONTRIBUTING.md")).toLowerCase();
  assert.match(contributing, /public contribution/);
  assert.match(contributing, /focused.*branch/);
  assert.match(contributing, /pull request/);
  assert.match(contributing, /accepted contribution[^\n]*mit|mit[^\n]*accepted contribution/);
  assert.match(contributing, /does not grant authority|do not grant authority/);
  for (const boundary of ["therapy/framework policy", "model roles", "privacy scope", "stable release"]) {
    assert.ok(contributing.includes(boundary), boundary);
  }
});

test("PR and release evidence contracts remain explicit during the publication transition", async () => {
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

test("repository audit accepts only the two valid publication transition state pairs", async (t) => {
  const fixture = await createAuditFixture(t);
  const profilePath = path.join(fixture, ".github", "codex-repository.json");
  const baseProfile = {
    ...JSON.parse(await fs.readFile(profilePath, "utf8")),
    commands: expectedCommands,
    publication_transition: expectedPublicationTransition
  };

  for (const [visibility, status] of [
    ["private", "pre_publication_ready"],
    ["public", "completed"]
  ]) {
    const profile = structuredClone(baseProfile);
    profile.visibility = visibility;
    profile.publication_transition.status = status;
    await fs.writeFile(profilePath, `${JSON.stringify(profile, null, 2)}\n`);
    const result = auditRepository(fixture);
    assert.equal(result.ok, true, `${visibility}/${status}: ${JSON.stringify(result.findings)}`);
  }

  for (const [visibility, status] of [
    ["private", "completed"],
    ["public", "pre_publication_ready"],
    ["private", "unknown"],
    ["public", null]
  ]) {
    const profile = structuredClone(baseProfile);
    profile.visibility = visibility;
    profile.publication_transition.status = status;
    await fs.writeFile(profilePath, `${JSON.stringify(profile, null, 2)}\n`);
    const result = auditRepository(fixture);
    assert.ok(
      result.findings.some(({ code }) => code === "profile-publication-transition-state"),
      `${visibility}/${status}: ${JSON.stringify(result.findings)}`
    );
  }
});

test("repository audit rejects mutated publication fields and a missing publication command", async (t) => {
  const fixture = await createAuditFixture(t);
  const profilePath = path.join(fixture, ".github", "codex-repository.json");
  const baseProfile = {
    ...JSON.parse(await fs.readFile(profilePath, "utf8")),
    commands: expectedCommands,
    publication_transition: expectedPublicationTransition
  };
  for (const [field, value] of [
    ["target_visibility", "private"],
    ["license", "Apache-2.0"],
    ["design", "docs/other-design.md"],
    ["audit_command", "npm test"]
  ]) {
    const profile = structuredClone(baseProfile);
    profile.publication_transition[field] = value;
    await fs.writeFile(profilePath, `${JSON.stringify(profile, null, 2)}\n`);
    const result = auditRepository(fixture);
    assert.ok(result.findings.some(({ code }) => code === "profile-publication-transition"), field);
  }

  const withoutPublication = structuredClone(baseProfile);
  delete withoutPublication.commands.publication;
  await fs.writeFile(profilePath, `${JSON.stringify(withoutPublication, null, 2)}\n`);
  assert.ok(auditRepository(fixture).findings.some(({ code }) => code === "profile-commands"));
});

test("repository audit rejects license, contribution, and security contract mutations", async (t) => {
  const fixture = await createAuditFixture(t);
  const cases = [
    ["LICENSE", /Permission is hereby granted/, "Permission is withheld", "license-contract"],
    ["CONTRIBUTING.md", /therapy\/framework policy/i, "product policy", "contribution-owner-boundary"],
    ["SECURITY.md", /absolute home paths/i, "local paths", "security-excluded-data"]
  ];
  for (const [relative, pattern, replacement, expectedCode] of cases) {
    const absolute = path.join(fixture, relative);
    const original = await fs.readFile(absolute, "utf8");
    await fs.writeFile(absolute, original.replace(pattern, replacement));
    const result = auditRepository(fixture);
    assert.ok(result.findings.some(({ code }) => code === expectedCode), `${relative}: ${JSON.stringify(result.findings)}`);
    await fs.writeFile(absolute, original);
  }
});

test("private transition audit rejects additive present-tense public claims in every entry document", async (t) => {
  const fixture = await createAuditFixture(t);
  for (const relative of ["README.md", "AGENTS.md", "docs/INDEX.md"]) {
    const absolute = path.join(fixture, relative);
    const original = await fs.readFile(absolute, "utf8");
    await fs.writeFile(absolute, `${original}\nHosted GitHub visibility is public.\n`);
    const result = auditRepository(fixture);
    assert.ok(
      result.findings.some(({ code, path: findingPath }) => code === "publication-premature-public-claim" && findingPath === relative),
      `${relative}: ${JSON.stringify(result.findings)}`
    );
    await fs.writeFile(absolute, original);
  }

  const readmePath = path.join(fixture, "README.md");
  const readme = await fs.readFile(readmePath, "utf8");
  for (const contradiction of [
    "The GitHub repository is public.",
    "Repository visibility is already public.",
    "Hosted repository visibility is now public.",
    "The repository is public."
  ]) {
    await fs.writeFile(readmePath, `${readme}\n${contradiction}\n`);
    const result = auditRepository(fixture);
    assert.ok(result.findings.some(({ code }) => code === "publication-premature-public-claim"), contradiction);
  }

  await fs.writeFile(
    readmePath,
    `${readme}\nThe GitHub repository will become public only after verified readback.\nThe target visibility is public.\nThe public transition design is accepted.\n`
  );
  assert.ok(
    auditRepository(fixture).findings.every(({ code }) => code !== "publication-premature-public-claim"),
    "future, target, and design language must remain allowed"
  );
});

test("repository audit rejects additive prohibitions of public contribution and private reporting", async (t) => {
  const fixture = await createAuditFixture(t);
  const cases = [
    [
      "SECURITY.md",
      "security-private-route",
      [
        "Do not use GitHub private vulnerability reporting once it is enabled.",
        "Never use GitHub private vulnerability reporting.",
        "GitHub private vulnerability reporting is forbidden.",
        "GitHub private vulnerability reporting must not be used."
      ]
    ],
    [
      "CONTRIBUTING.md",
      "contribution-public",
      [
        "Public contributions are forbidden through focused task branches and pull requests.",
        "Public contributions are not accepted.",
        "Public contributions are prohibited.",
        "Do not accept public contributions."
      ]
    ]
  ];
  for (const [relative, expectedCode, prohibitions] of cases) {
    const absolute = path.join(fixture, relative);
    const original = await fs.readFile(absolute, "utf8");
    for (const prohibition of prohibitions) {
      await fs.writeFile(absolute, `${original}\n${prohibition}\n`);
      const result = auditRepository(fixture);
      assert.ok(result.findings.some(({ code }) => code === expectedCode), `${relative}/${prohibition}: ${JSON.stringify(result.findings)}`);
    }
    await fs.writeFile(absolute, original);
  }

  const securityPath = path.join(fixture, "SECURITY.md");
  const security = await fs.readFile(securityPath, "utf8");
  await fs.writeFile(securityPath, `${security}\nGitHub private vulnerability reporting is not enabled yet.\nDo not put excluded data into GitHub private vulnerability reporting.\n`);
  assert.ok(auditRepository(fixture).findings.every(({ code }) => code !== "security-private-route"));

  const contributingPath = path.join(fixture, "CONTRIBUTING.md");
  const contributing = await fs.readFile(contributingPath, "utf8");
  await fs.writeFile(contributingPath, `${contributing}\nPublic contributions do not grant product authority.\nNot every public contribution is accepted.\n`);
  assert.ok(auditRepository(fixture).findings.every(({ code }) => code !== "contribution-public"));
});

test("public-posture integrity rejects unrecognized additive contradictions and arbitrary prose", async (t) => {
  const fixture = await createAuditFixture(t);
  const contradictions = [
    ["README.md", "This repository is publicly visible on GitHub."],
    ["AGENTS.md", "GitHub exposes this repository to everyone."],
    ["docs/INDEX.md", "Anyone can view the hosted repository now."],
    ["SECURITY.md", "Private vulnerability reports are not permitted."],
    ["CONTRIBUTING.md", "External public contributions will be rejected."],
    ["CONTRIBUTING.md", "Only private collaborators may contribute."]
  ];
  for (const [relative, contradiction] of contradictions) {
    const absolute = path.join(fixture, relative);
    const original = await fs.readFile(absolute, "utf8");
    await fs.writeFile(absolute, `${original}\n${contradiction}\n`);
    const result = auditRepository(fixture);
    assert.ok(
      result.findings.some(({ code, path: findingPath }) => code === "public-posture-integrity" && findingPath === relative),
      `${relative}/${contradiction}: ${JSON.stringify(result.findings)}`
    );
    await fs.writeFile(absolute, original);
  }

  for (const relative of ["README.md", "AGENTS.md", "docs/INDEX.md", "SECURITY.md", "CONTRIBUTING.md"]) {
    const absolute = path.join(fixture, relative);
    const original = await fs.readFile(absolute, "utf8");
    await fs.writeFile(absolute, `${original}\nEditorial note with no policy keywords.\n`);
    const result = auditRepository(fixture);
    assert.ok(
      result.findings.some(({ code, path: findingPath }) => code === "public-posture-integrity" && findingPath === relative),
      `${relative}: arbitrary append must require reviewed digest maintenance`
    );
    await fs.writeFile(absolute, original);
  }
});

test("public-posture integrity maintenance requires one reviewed content-and-digest change", async () => {
  assert.match(
    await read("AGENTS.md"),
    /any legitimate edit to `README\.md`, `AGENTS\.md`, `docs\/INDEX\.md`, `SECURITY\.md`, or `CONTRIBUTING\.md`[^\n]*Task 9[^\n]*must update the reviewed SHA-256 bindings in `scripts\/audit-repository\.mjs` in the same reviewed change/
  );
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

test("the production repository audit rejects missing model-role ownership routes", async (t) => {
  const fixture = await fs.mkdtemp(path.join(path.dirname(root), "inner-signal-owner-audit-"));
  t.after(() => fs.rm(fixture, { recursive: true, force: true }));
  await fs.cp(root, fixture, {
    recursive: true,
    filter: (source) => path.basename(source) !== ".git"
  });
  const codeownersPath = path.join(fixture, ".github", "CODEOWNERS");
  const omitted = new Set([
    "/src/autopilot/model-policy.mjs",
    "/src/autopilot/model-resolver.mjs",
    "/src/core/config.mjs",
    "/src/providers/"
  ]);
  const codeowners = (await fs.readFile(codeownersPath, "utf8"))
    .split("\n")
    .filter((line) => ![...omitted].some((ownerPath) => line.startsWith(`${ownerPath} `)))
    .join("\n");
  await fs.writeFile(codeownersPath, codeowners);

  const result = await execFileAsync(process.execPath, [path.join(fixture, "scripts", "audit-repository.mjs")], {
    cwd: fixture
  }).then(
    (success) => ({ code: 0, stdout: success.stdout, stderr: success.stderr }),
    (error) => ({ code: Number(error.code), stdout: String(error.stdout ?? ""), stderr: String(error.stderr ?? "") })
  );
  assert.equal(result.code, 1, `${result.stdout}\n${result.stderr}`);
  const audit = JSON.parse(result.stdout);
  const missing = new Set(audit.findings.filter(({ code }) => code === "codeowners-route").map(({ message }) => message));
  for (const ownerPath of omitted) assert.ok([...missing].some((message) => message.includes(ownerPath)), ownerPath);
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
