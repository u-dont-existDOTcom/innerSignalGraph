#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { auditWorkflows } from "./audit-workflows.mjs";

const EXPECTED_CLASSIFICATION = {
  repository_kind: "software",
  active: true,
  long_running: true,
  visibility: "private",
  risk: "critical"
};
const EXPECTED_COMMANDS = {
  bootstrap: "npm ci --ignore-scripts",
  test: "npm test",
  graph: "npm run graph:test",
  package: "npm run verify",
  audit: "npm run audit:repository",
  verify: "npm run verify",
  current_state: "bash scripts/report-worktree.sh"
};
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
    requireMatch(readText(root, relative, findings), /state\/CODEX-CURRENT-STATE\.md/, "authority-route", relative, `must route to ${CHECKPOINT}`, findings);
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
  requireMatch(security, /draft security advisor|private.*channel/, "security-private-route", "SECURITY.md", "missing private reporting route", findings);
  requireMatch(security, /credential/, "security-credentials", "SECURITY.md", "missing credential boundary", findings);
  requireMatch(security, /therapy/, "security-therapy-data", "SECURITY.md", "missing therapy-data boundary", findings);

  const contributing = readText(root, "CONTRIBUTING.md", findings)?.toLowerCase() ?? null;
  requireMatch(contributing, /private/, "contribution-private", "CONTRIBUTING.md", "private contribution posture missing", findings);
  requireMatch(contributing, /owner-controlled/, "contribution-owner", "CONTRIBUTING.md", "owner-controlled posture missing", findings);
  requireMatch(contributing, /no public license|not grant.*license/, "contribution-license", "CONTRIBUTING.md", "license posture missing", findings);

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
}

export function auditRepository(root = process.cwd()) {
  const resolvedRoot = path.resolve(root);
  const findings = [];
  auditProfile(resolvedRoot, findings);
  auditAuthority(resolvedRoot, findings);
  auditPolicyDocuments(resolvedRoot, findings);
  auditRuntime(resolvedRoot, findings);
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
