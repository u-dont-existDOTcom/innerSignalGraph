#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { auditWorkflows } from "./audit-workflows.mjs";

const EXPECTED_CLASSIFICATION = {
  repository_kind: "software",
  active: true,
  long_running: true,
  risk: "critical"
};
const EXPECTED_COMMANDS = {
  bootstrap: "npm ci --ignore-scripts",
  test: "npm test",
  graph: "npm run graph:test",
  package: "npm run verify",
  audit: "npm run audit:repository",
  publication: "npm run audit:publication",
  verify: "npm run verify",
  current_state: "bash scripts/report-worktree.sh"
};
const EXPECTED_PUBLICATION_TRANSITION = {
  target_visibility: "public",
  license: "MIT",
  design: "docs/superpowers/specs/2026-08-14-public-repository-transition-design.md",
  audit_command: "npm run audit:publication:hosted"
};
const EXPECTED_MIT_LICENSE = `MIT License

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
const CHECKPOINT = "state/CODEX-CURRENT-STATE.md";
const CONTROL_STATES = new Set(["verified", "enabled", "disabled", "unverified", "not_applicable"]);
const CHECKPOINT_HEADINGS = [
  "goal",
  "authority / baseline",
  "completed",
  "current checkpoint",
  "remaining",
  "blockers / unresolved",
  "evidence / artifacts",
  "next safe action"
];
const REQUIRED_OWNER_PATHS = [
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
];

function readText(root, relative, findings) {
  try {
    return fs.readFileSync(path.join(root, relative), "utf8");
  } catch (error) {
    findings.push({ severity: "error", code: "file-missing", path: relative, message: error.code ?? error.message });
    return null;
  }
}

function readJson(root, relative, findings) {
  const text = readText(root, relative, findings);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    findings.push({ severity: "error", code: "json-invalid", path: relative, message: error.message });
    return null;
  }
}

function requireMatch(text, pattern, code, relative, message, findings) {
  if (text !== null && !pattern.test(text)) findings.push({ severity: "error", code, path: relative, message });
}

function auditProfile(root, findings) {
  const relative = ".github/codex-repository.json";
  const profile = readJson(root, relative, findings);
  if (!profile) return;
  for (const [key, expected] of Object.entries(EXPECTED_CLASSIFICATION)) {
    if (profile[key] !== expected) {
      findings.push({ severity: "error", code: `profile-${key}`, path: relative, message: `${key} must be ${JSON.stringify(expected)}` });
    }
  }
  const transitionStatus = profile.publication_transition?.status;
  const validTransitionState =
    (profile.visibility === "private" && transitionStatus === "pre_publication_ready") ||
    (profile.visibility === "public" && transitionStatus === "completed");
  if (!validTransitionState) {
    findings.push({
      severity: "error",
      code: "profile-publication-transition-state",
      path: relative,
      message: "visibility/status must be private/pre_publication_ready or public/completed"
    });
  }
  const expectedTransition = { ...EXPECTED_PUBLICATION_TRANSITION, status: transitionStatus };
  const transition = profile.publication_transition;
  if (
    !transition ||
    typeof transition !== "object" ||
    Array.isArray(transition) ||
    Object.keys(transition).length !== Object.keys(expectedTransition).length ||
    Object.entries(expectedTransition).some(([key, expected]) => transition[key] !== expected)
  ) {
    findings.push({
      severity: "error",
      code: "profile-publication-transition",
      path: relative,
      message: "publication_transition fields must match the exact repository contract"
    });
  }
  if (JSON.stringify(profile.commands) !== JSON.stringify(EXPECTED_COMMANDS)) {
    findings.push({ severity: "error", code: "profile-commands", path: relative, message: "exact verified command map is incomplete or changed" });
  }
  if (profile.current_state !== CHECKPOINT) {
    findings.push({ severity: "error", code: "profile-current-state", path: relative, message: `current_state must be ${CHECKPOINT}` });
  }
  if (!profile.github_controls || typeof profile.github_controls !== "object" || Array.isArray(profile.github_controls)) {
    findings.push({ severity: "error", code: "profile-hosted-controls", path: relative, message: "github_controls must be an object" });
  } else {
    for (const [name, state] of Object.entries(profile.github_controls)) {
      if (!CONTROL_STATES.has(state)) {
        findings.push({ severity: "error", code: "profile-hosted-control-state", path: relative, message: `${name} has unsupported state ${state}` });
      } else if (state === "disabled" || state === "unverified") {
        findings.push({ severity: "warning", code: `hosted-${name}`, path: relative, message: `${name} is ${state}; repository files do not supply hosted enforcement` });
      }
    }
  }
}

function auditAuthority(root, findings) {
  for (const relative of ["AGENTS.md", "README.md", "docs/INDEX.md"]) {
    const entry = readText(root, relative, findings);
    requireMatch(entry, /state\/CODEX-CURRENT-STATE\.md/, "authority-route", relative, `must route to ${CHECKPOINT}`, findings);
    for (const [pattern, route] of [
      [/docs\/superpowers\/specs\/2026-08-14-public-repository-transition-design\.md/, "transition design"],
      [/docs\/PUBLIC-REPOSITORY-TRANSITION-REPORT-2026-08-14\.md/, "transition report"],
      [/`npm run audit:publication`/, "local publication audit"],
      [/`npm run audit:publication:hosted`/, "hosted publication audit"]
    ]) {
      requireMatch(entry, pattern, "publication-route", relative, `must route to ${route}`, findings);
    }
  }
  const checkpoint = readText(root, CHECKPOINT, findings)?.toLowerCase() ?? null;
  for (const heading of CHECKPOINT_HEADINGS) {
    requireMatch(checkpoint, new RegExp(`^## ${heading.replace("/", "\\/")}$`, "m"), "checkpoint-heading", CHECKPOINT, `missing checkpoint heading: ${heading}`, findings);
  }
  const retired = readText(root, "docs/CURRENT-STATE.md", findings);
  requireMatch(retired, /superseded/i, "checkpoint-not-superseded", "docs/CURRENT-STATE.md", "competing checkpoint must be marked superseded", findings);
  requireMatch(retired, /state\/CODEX-CURRENT-STATE\.md/, "checkpoint-route", "docs/CURRENT-STATE.md", `must route to ${CHECKPOINT}`, findings);
  requireMatch(
    readText(root, "IMPLEMENTATION-REPORT-v0.15.2.md", findings),
    /historical intake note[^\n]*\n[^\n]*No `AGENTS\.md`/i,
    "historical-report-scope",
    "IMPLEMENTATION-REPORT-v0.15.2.md",
    "stale AGENTS statement must be labeled as historical intake evidence",
    findings
  );
}

function auditPolicyDocuments(root, findings) {
  const security = readText(root, "SECURITY.md", findings)?.toLowerCase() ?? null;
  for (const [pattern, message] of [
    [/github private vulnerability reporting/, "missing GitHub private vulnerability reporting route"],
    [/once (?:it is|this is) enabled/, "private vulnerability reporting must remain conditional until hosted enablement"],
    [/draft security advisor/, "missing draft-advisory fallback"],
    [/private.*(?:contact|channel)/, "missing private-contact fallback"],
    [/synthetic/, "missing synthetic reproduction requirement"],
    [/redacted/, "missing redacted reproduction requirement"]
  ]) {
    requireMatch(security, pattern, "security-private-route", "SECURITY.md", message, findings);
  }
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
    if (security !== null && !security.includes(excluded)) {
      findings.push({ severity: "error", code: "security-excluded-data", path: "SECURITY.md", message: `missing excluded-data boundary: ${excluded}` });
    }
  }

  const contributing = readText(root, "CONTRIBUTING.md", findings)?.toLowerCase() ?? null;
  for (const [pattern, code, message] of [
    [/public contribution/, "contribution-public", "public contribution posture missing"],
    [/focused.*branch/, "contribution-workflow", "focused branch workflow missing"],
    [/pull request/, "contribution-workflow", "pull-request workflow missing"],
    [/accepted contribution[^\n]*mit|mit[^\n]*accepted contribution/, "contribution-license", "accepted-contribution MIT grant missing"],
    [/does not grant authority|do not grant authority/, "contribution-owner-boundary", "contribution authority boundary missing"],
    [/therapy\/framework policy/, "contribution-owner-boundary", "therapy/framework owner boundary missing"],
    [/model roles/, "contribution-owner-boundary", "model-role owner boundary missing"],
    [/privacy scope/, "contribution-owner-boundary", "privacy-scope owner boundary missing"],
    [/stable`? release/, "contribution-owner-boundary", "stable-release owner boundary missing"]
  ]) {
    requireMatch(contributing, pattern, code, "CONTRIBUTING.md", message, findings);
  }

  const license = readText(root, "LICENSE", findings);
  if (license !== null && license !== EXPECTED_MIT_LICENSE) {
    findings.push({ severity: "error", code: "license-contract", path: "LICENSE", message: "LICENSE must be the unmodified standard MIT text with the approved copyright line" });
  }

  const release = `${readText(root, "docs/RELEASE-EVIDENCE.md", findings) ?? ""}\n${readText(root, ".github/RELEASE-EVIDENCE-TEMPLATE.md", findings) ?? ""}`.toLowerCase();
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
    if (!release.includes(phrase)) findings.push({ severity: "error", code: "release-evidence", path: "docs/RELEASE-EVIDENCE.md", message: `missing release evidence phrase: ${phrase}` });
  }
  requireMatch(release, /deterministic[^\n]*cannot[^\n]*live|does not[^\n]*live-model entitlement/, "release-live-distinction", "docs/RELEASE-EVIDENCE.md", "deterministic and live evidence must remain distinct", findings);

  const pullRequest = readText(root, ".github/pull_request_template.md", findings)?.toLowerCase() ?? null;
  for (const phrase of ["acceptance", "rollback", "current-state", "residual", "privacy", "stable", "final diff"]) {
    requireMatch(pullRequest, new RegExp(phrase), "pull-request-evidence", ".github/pull_request_template.md", `missing PR evidence field: ${phrase}`, findings);
  }
}

function auditRuntime(root, findings) {
  const nvmrc = readText(root, ".nvmrc", findings)?.trim();
  const packageJson = readJson(root, "package.json", findings);
  const lock = readJson(root, "package-lock.json", findings);
  if (nvmrc !== "24.18.0" || packageJson?.engines?.node !== nvmrc || packageJson?.packageManager !== "npm@11.16.0") {
    findings.push({ severity: "error", code: "runtime-pin", path: "package.json", message: "Node/npm toolchain does not match .nvmrc" });
  }
  if (lock?.lockfileVersion !== 3 || lock?.packages?.[""]?.engines?.node !== nvmrc) {
    findings.push({ severity: "error", code: "runtime-lock", path: "package-lock.json", message: "lockfile does not preserve the exact Node engine" });
  }
  if (packageJson?.scripts?.["audit:repository"] !== "node scripts/audit-repository.mjs") {
    findings.push({ severity: "error", code: "audit-command", path: "package.json", message: "audit:repository script is missing" });
  }
  if (packageJson?.scripts?.["audit:publication"] !== "node scripts/audit-publication.mjs") {
    findings.push({ severity: "error", code: "publication-command", path: "package.json", message: "audit:publication script is missing" });
  }
}

function auditOwnershipAndCi(root, findings) {
  const codeowners = readText(root, ".github/CODEOWNERS", findings);
  if (codeowners !== null) {
    const routed = new Map(
      codeowners
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
        .map((line) => line.split(/\s+/, 2))
    );
    for (const ownerPath of REQUIRED_OWNER_PATHS) {
      if (routed.get(ownerPath) !== "@u-dont-existDOTcom") {
        findings.push({ severity: "error", code: "codeowners-route", path: ".github/CODEOWNERS", message: `missing explicit owner for ${ownerPath}` });
      }
    }
  }

  const workflowPaths = [
    ".github/workflows/verify.yml",
    ".github/workflows/repository-workflow-policy.yml"
  ];
  const workflows = workflowPaths.map((relative) => [relative, readText(root, relative, findings)]);
  for (const [relative, workflow] of workflows) {
    if (workflow === null) continue;
    for (const [pattern, message] of [
      [/^permissions:\n  contents: read$/m, "top-level contents: read is required"],
      [/group:\s*\$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}/, "concurrency must be scoped by workflow and ref"],
      [/cancel-in-progress:\s*\$\{\{ github\.event_name == 'pull_request' \}\}/, "only superseded pull-request runs may cancel"],
      [/branches:\s*\[main, stable\]/, "main and stable triggers are required"],
      [/node-version-file:\s*\.nvmrc/, "CI must use .nvmrc"],
      [/actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/, "checkout revision is not the reviewed SHA"],
      [/actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020/, "setup-node revision is not the reviewed SHA"]
    ]) {
      requireMatch(workflow, pattern, "ci-contract", relative, message, findings);
    }
    const checkouts = workflow.match(/actions\/checkout@/g)?.length ?? 0;
    const disabledCredentials = workflow.match(/persist-credentials:\s*false/g)?.length ?? 0;
    if (checkouts !== disabledCredentials) {
      findings.push({ severity: "error", code: "ci-checkout-credentials", path: relative, message: "every checkout must disable persisted credentials" });
    }
    if (/OPENAI_API_KEY|ANTHROPIC_API_KEY|CODEX_COMMAND|CLAUDE_COMMAND/.test(workflow)) {
      findings.push({ severity: "error", code: "ci-model-credentials", path: relative, message: "ordinary CI must not receive live model configuration" });
    }
  }
  const verify = workflows[0][1];
  for (const [pattern, message] of [
    [/name:\s*deterministic-package/, "deterministic package check name is missing"],
    [/npm ci --ignore-scripts/, "bootstrap command is missing"],
    [/npm run audit:repository/, "repository audit is missing"],
    [/npm run verify/, "complete package gate is missing"],
    [/git status --porcelain/, "independent final cleanliness check is missing"]
  ]) {
    requireMatch(verify, pattern, "ci-verify", workflowPaths[0], message, findings);
  }
  const policy = workflows[1][1];
  for (const [pattern, message] of [
    [/name:\s*workflow-policy/, "workflow policy check name is missing"],
    [/schedule:/, "scheduled drift detection is missing"],
    [/cron:/, "scheduled drift cron is missing"],
    [/workflow_dispatch:/, "manual drift audit is missing"],
    [/npm ci --ignore-scripts/, "policy bootstrap is missing"],
    [/npm run audit:repository/, "policy repository audit is missing"]
  ]) {
    requireMatch(policy, pattern, "ci-policy", workflowPaths[1], message, findings);
  }
}

export function auditRepository(root = process.cwd()) {
  const resolvedRoot = path.resolve(root);
  const findings = [];
  auditProfile(resolvedRoot, findings);
  auditAuthority(resolvedRoot, findings);
  auditPolicyDocuments(resolvedRoot, findings);
  auditRuntime(resolvedRoot, findings);
  auditOwnershipAndCi(resolvedRoot, findings);
  for (const finding of auditWorkflows(resolvedRoot).findings) {
    findings.push({ ...finding, severity: "error", code: `workflow-${finding.code}` });
  }
  findings.sort((left, right) => left.severity.localeCompare(right.severity) || left.path.localeCompare(right.path) || left.code.localeCompare(right.code));
  const errors = findings.filter(({ severity }) => severity === "error").length;
  const warnings = findings.filter(({ severity }) => severity === "warning").length;
  return { schemaVersion: 1, ok: errors === 0, errors, warnings, findings };
}

function parseRoot(argv) {
  if (argv.length === 0) return process.cwd();
  if (argv.length === 2 && argv[0] === "--root" && argv[1]) return argv[1];
  throw new Error("Usage: node scripts/audit-repository.mjs [--root <repository-root>]");
}

function main() {
  try {
    const result = auditRepository(parseRoot(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main();
}
