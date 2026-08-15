#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";
import { parseDocument } from "yaml";
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
const PRIVATE_ENTRY_CLAIMS = {
  "README.md": "Its GitHub repository remains private while the approved public transition is in `pre_publication_ready`; this is not a claim that hosted visibility is already public.",
  "AGENTS.md": "The repository remains private until GitHub visibility is changed and read back; `pre_publication_ready` is not public visibility.",
  "docs/INDEX.md": "The repository is still private while `.github/codex-repository.json` records `pre_publication_ready`. Neither the MIT license nor public-ready documentation proves that GitHub visibility or hosted controls have changed."
};
const SECURITY_CONTRACT = {
  privateReporting: "Use GitHub private vulnerability reporting once it is enabled.",
  fallback: "Until then, or if that route is unavailable, create a draft security advisory in this repository's **Security → Advisories** area or contact the repository owner through the already established private collaboration channel. If neither fallback is available, open only a metadata-only issue asking for a private contact path; do not include exploit details or sensitive material.",
  excludedData: "Do not place credentials, tokens, cookies, `.env` values, private keys, browser chat, therapy/hypnosis content, prompts, model output/reasoning, raw sensitive logs, usernames, hostnames, IP addresses, or absolute home paths in an issue, pull request, workflow log, or artifact.",
  reproduction: "Safe reports should include the affected version or exact commit, bounded reproduction steps using synthetic data, impact, expected behavior, and a suggested private follow-up route. Use redacted or synthetic markers for excluded data."
};
const CONTRIBUTION_CONTRACT = {
  workflow: "Public contributions are welcome through focused task branches and pull requests.",
  license: "Accepted contributions are licensed under the repository's MIT License.",
  ownerBoundary: "Contribution does not grant authority over owner-gated therapy/framework policy, owner decision cards, model roles, privacy scope, or stable release approval."
};
const PUBLIC_POSTURE_SHA256 = {
  "README.md": "1982122b74650e4ef36683fab3c68ef721b4e2ed7aab4adf5328cdebb24d79ce",
  "AGENTS.md": "b4c91596a4abc7e4430eb89cad4689a587b25d58c0eb869d05a27bdc07195e02",
  "docs/INDEX.md": "93c2124004ec9a40823df899f270c3971da914b5dc63572f4c744079e4d8c565",
  "SECURITY.md": "b6b40e701cddb53fe49a1676c2e01cf15a8a07a28553bf78bde3a91b42e1d72a",
  "CONTRIBUTING.md": "3e36a03597382a82cb628f0daa1c9595ad86b57ffa339873dcf18be1efdd40c4"
};
const PREMATURE_PUBLIC_ASSERTIONS = [
  /\bhosted github visibility is (?:now |already )?public\b/i,
  /\b(?:the )?github repository is (?:now |already )?public\b/i,
  /\brepository visibility is (?:now |already )?public\b/i,
  /\bhosted repository visibility is (?:now |already )?public\b/i,
  /\bthe repository is (?:now |already )?public\b/i
];
const PRIVATE_REPORTING_PROHIBITIONS = [
  /\b(?:do not|never) use github private vulnerability reporting\b/i,
  /\bgithub private vulnerability reporting (?:is (?:forbidden|prohibited|disallowed)|(?:must|should) not be used)\b/i
];
const PUBLIC_CONTRIBUTION_PROHIBITIONS = [
  /\bpublic contributions? are (?:forbidden|prohibited|disallowed)\b/i,
  /\bpublic contributions? are not (?:accepted|allowed|welcome)\b/i,
  /\b(?:do not|never) accept public contributions?\b/i
];
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
const CODEQL_WORKFLOW_PATH = ".github/workflows/codeql.yml";
const CODEQL_ACTION_SHA = "ff2f1c621b7f889edc0d3c761ac2e6a3f8cdb0dd";
const EXPECTED_CODEQL_WORKFLOW = {
  name: "CodeQL",
  on: {
    pull_request: null,
    push: { branches: ["main", "stable"] },
    schedule: [{ cron: "23 5 * * 3" }],
    workflow_dispatch: null
  },
  permissions: { contents: "read" },
  concurrency: {
    group: "${{ github.workflow }}-${{ github.ref }}",
    "cancel-in-progress": "${{ github.event_name == 'pull_request' }}"
  },
  jobs: {
    analyze: {
      if: "github.event.repository.private == false",
      name: "codeql-javascript",
      "runs-on": "ubuntu-latest",
      "timeout-minutes": 30,
      permissions: { contents: "read", "security-events": "write" },
      steps: [
        {
          name: "Check out repository",
          uses: "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
          with: { "persist-credentials": false }
        },
        {
          name: "Initialize CodeQL",
          uses: `github/codeql-action/init@${CODEQL_ACTION_SHA}`,
          with: { languages: "javascript-typescript", queries: "security-extended" }
        },
        {
          name: "Analyze",
          uses: `github/codeql-action/analyze@${CODEQL_ACTION_SHA}`
        }
      ]
    }
  }
};
const FORBIDDEN_CODEQL_REFERENCES = /pull_request_target|write-all|packages:\s*read|OPENAI|ANTHROPIC|CLAUDE|FABLE|secrets\./i;

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

function requireLiteral(text, expected, code, relative, message, findings) {
  if (text !== null && !text.includes(expected)) findings.push({ severity: "error", code, path: relative, message });
}

function rejectPatterns(text, patterns, code, relative, message, findings) {
  if (text !== null && patterns.some((pattern) => pattern.test(text))) {
    findings.push({ severity: "error", code, path: relative, message });
  }
}

function auditPublicPostureIntegrity(root, findings) {
  for (const [relative, expectedDigest] of Object.entries(PUBLIC_POSTURE_SHA256)) {
    let bytes;
    try {
      bytes = fs.readFileSync(path.join(root, relative));
    } catch {
      continue;
    }
    const actualDigest = createHash("sha256").update(bytes).digest("hex");
    if (actualDigest !== expectedDigest) {
      findings.push({
        severity: "error",
        code: "public-posture-integrity",
        path: relative,
        message: "reviewed public-posture bytes changed; update the document and SHA-256 binding in one reviewed change"
      });
    }
  }
}

function auditProfile(root, findings) {
  const relative = ".github/codex-repository.json";
  const profile = readJson(root, relative, findings);
  if (!profile) return null;
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
  return profile;
}

function auditAuthority(root, findings, profile) {
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
    if (profile?.visibility === "private" && profile.publication_transition?.status === "pre_publication_ready") {
      requireLiteral(
        entry,
        PRIVATE_ENTRY_CLAIMS[relative],
        "publication-premature-public-claim",
        relative,
        "private/pre_publication_ready entry document must retain its bounded truthful hosted-visibility statement",
        findings
      );
      rejectPatterns(
        entry,
        PREMATURE_PUBLIC_ASSERTIONS,
        "publication-premature-public-claim",
        relative,
        "private/pre_publication_ready entry document contains a present-tense hosted-public assertion",
        findings
      );
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
  const security = readText(root, "SECURITY.md", findings);
  requireLiteral(security, SECURITY_CONTRACT.privateReporting, "security-private-route", "SECURITY.md", "missing affirmative private-vulnerability-reporting route", findings);
  requireLiteral(security, SECURITY_CONTRACT.fallback, "security-private-route", "SECURITY.md", "missing exact draft-advisory/private-contact fallback", findings);
  requireLiteral(security, SECURITY_CONTRACT.reproduction, "security-reproduction", "SECURITY.md", "missing exact synthetic/redacted reproduction contract", findings);
  requireLiteral(security, SECURITY_CONTRACT.excludedData, "security-excluded-data", "SECURITY.md", "missing exact excluded-data boundary", findings);
  rejectPatterns(security, PRIVATE_REPORTING_PROHIBITIONS, "security-private-route", "SECURITY.md", "private vulnerability reporting is explicitly prohibited", findings);

  const contributing = readText(root, "CONTRIBUTING.md", findings);
  requireLiteral(contributing, CONTRIBUTION_CONTRACT.workflow, "contribution-public", "CONTRIBUTING.md", "missing affirmative public contribution workflow", findings);
  requireLiteral(contributing, CONTRIBUTION_CONTRACT.license, "contribution-license", "CONTRIBUTING.md", "missing accepted-contribution MIT grant", findings);
  requireLiteral(contributing, CONTRIBUTION_CONTRACT.ownerBoundary, "contribution-owner-boundary", "CONTRIBUTING.md", "missing exact owner-authority boundary", findings);
  rejectPatterns(contributing, PUBLIC_CONTRIBUTION_PROHIBITIONS, "contribution-public", "CONTRIBUTING.md", "public contributions are explicitly prohibited or rejected", findings);

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

function auditCodeqlWorkflow(root, findings) {
  const text = readText(root, CODEQL_WORKFLOW_PATH, findings);
  if (text === null) {
    findings.push({
      severity: "error",
      code: "ci-codeql",
      path: CODEQL_WORKFLOW_PATH,
      message: "the exact visibility-gated CodeQL workflow is required"
    });
    return;
  }

  const document = parseDocument(text, { strict: true, uniqueKeys: true });
  if (document.errors.length > 0) {
    findings.push({
      severity: "error",
      code: "ci-codeql",
      path: CODEQL_WORKFLOW_PATH,
      message: "CodeQL workflow YAML must parse uniquely and strictly"
    });
    return;
  }

  let workflow;
  try {
    workflow = document.toJS({ maxAliasCount: 0 });
  } catch {
    findings.push({
      severity: "error",
      code: "ci-codeql",
      path: CODEQL_WORKFLOW_PATH,
      message: "CodeQL workflow aliases are not allowed"
    });
    return;
  }

  if (!isDeepStrictEqual(workflow, EXPECTED_CODEQL_WORKFLOW)) {
    findings.push({
      severity: "error",
      code: "ci-codeql",
      path: CODEQL_WORKFLOW_PATH,
      message: "CodeQL workflow must match the exact reviewed triggers, guard, permissions, concurrency, timeout, steps, pins, language, and query suite"
    });
  }
  if (FORBIDDEN_CODEQL_REFERENCES.test(text)) {
    findings.push({
      severity: "error",
      code: "ci-codeql",
      path: CODEQL_WORKFLOW_PATH,
      message: "CodeQL workflow must not use privileged PR execution, broad permissions, packages access, live-model providers, or secrets"
    });
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
  auditCodeqlWorkflow(root, findings);
}

export function auditRepository(root = process.cwd()) {
  const resolvedRoot = path.resolve(root);
  const findings = [];
  const profile = auditProfile(resolvedRoot, findings);
  auditAuthority(resolvedRoot, findings, profile);
  auditPolicyDocuments(resolvedRoot, findings);
  auditPublicPostureIntegrity(resolvedRoot, findings);
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
