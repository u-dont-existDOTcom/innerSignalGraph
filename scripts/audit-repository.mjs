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
const PUBLIC_ENTRY_CLAIMS = {
  "README.md": "The existing GitHub repository is public, and the publication transition is complete.",
  "AGENTS.md": "The GitHub repository is public and the publication transition is complete.",
  "docs/INDEX.md": "The GitHub repository is public and `.github/codex-repository.json` records the completed publication transition."
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
  "README.md": "cae2b2fc414804044d7a84b17960dc60f3986a8e0862faf4464633e722eaf49d",
  "AGENTS.md": "1c8b651f371ec3037bfbe62f6938f2dedf94a7cbbebf50c9f022669df6a8c97a",
  "docs/INDEX.md": "c510a338cd4d594d33f8f73e2f14ac3dccbc9d3319d487c936b58293705cded9",
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
const PUBLICATION_REPORT = "docs/PUBLIC-REPOSITORY-TRANSITION-REPORT-2026-08-14.md";
const COMPLIANCE_REPORT = "docs/CODEX-GITHUB-COMPLIANCE-REPORT-2026-08-14.md";
const PUBLIC_CLOSEOUT_REPORT_SECTIONS = {
  [PUBLICATION_REPORT]: "Issue 4 and remaining action",
  [COMPLIANCE_REPORT]: "Remaining action and residual risk"
};
const PUBLIC_CLOSEOUT_ACTIVE_STALE_PATTERNS = [
  /\b(?:finish|run|begin|start|continue|open|create|publish|squash-?merge|merge|obtain independent review)\b[^\n]*(?:\btask 9\b|\btask 10\b|\bpr 9\b|\bpublic hosted-evidence\b|\bprotected (?:evidence )?pull request\b)/i,
  /\b(?:task 9|task 10|pr 9|public hosted-evidence|protected (?:evidence )?pull request)\b[^\n]*(?:\b(?:begins?|owns|will|must|needs? to be)\b|\bafter\b[^\n]*\bmerge|\bwhen green\b)/i,
  /\bcurrent task 9 branch\b|\bexact task 9 base\b|\bcurrent protected public\s+`?main`?\b/i,
  /\bfuture squash-merge\b|\brecorded after they exist\b/i,
  /\bcomplete or in the final protected evidence pull-request path\b/i,
  /\bprotected (?:evidence )?pull request may merge only (?:after|when)\b/i
];
const EXPECTED_PUBLIC_CLOSEOUT_RECEIPT = {
  schemaVersion: 1,
  pullRequest: {
    url: "https://github.com/u-dont-existDOTcom/innerSignalGraph/pull/9",
    receiptUrl: "https://github.com/u-dont-existDOTcom/innerSignalGraph/pull/9#issuecomment-5300990615",
    state: "merged",
    reviewedHead: "7bf2b1a706aab6a7d9c36070b15590153c652e2a",
    reviewedTree: "4ff2a229a628bf0f9dc1a11abb23a88cd6068e18",
    mergeCommit: "0ccb120442292653a11676ad312f18092944b5a1",
    mergeTree: "4ff2a229a628bf0f9dc1a11abb23a88cd6068e18",
    treeMatch: true
  },
  exactHeadChecks: {
    "deterministic-package": { run: "31869840311", job: "94976658513", conclusion: "success" },
    "workflow-policy": { run: "31869840270", job: "94976658502", conclusion: "success" },
    "codeql-javascript": { run: "31869840222", job: "94976658119", conclusion: "success" }
  },
  advancedSecurityCheck: { id: "94976762584", conclusion: "success" },
  mergedMainChecks: {
    "deterministic-package": { run: "31869941911", job: "94976909523", conclusion: "success" },
    "workflow-policy": { run: "31869942049", job: "94976909702", conclusion: "success" },
    "codeql-javascript": { run: "31869941895", job: "94976909307", conclusion: "success" }
  },
  mergedMainCodeqlAnalysis: {
    id: "1622858177",
    commit: "0ccb120442292653a11676ad312f18092944b5a1",
    openAlerts: 0
  },
  remainingIssue: {
    url: "https://github.com/u-dont-existDOTcom/innerSignalGraph/issues/4",
    state: "open",
    soleAction: "read repository-scoped installed GitHub App permissions with GitHub App-authorized authentication"
  }
};
const EXPECTED_PUBLIC_CLOSEOUT_CHECKPOINT_SECTIONS = {
  "Current checkpoint": [
    "- All executable Tasks 1-10 are completed through the protected GitHub path; public visibility and every verified control except installed-App permissions were reconciled in the final readback.",
    "- Visible closeout receipt: pull request 9 is merged; its reviewed candidate tree equals the merged-main tree; every exact-head and merged-main required check succeeded; merged-main CodeQL analysis `1622858177` is associated with the verified baseline and had zero open alerts.",
    "- The immutable Task 9/10 baseline, matching-tree receipt, exact successful check associations, final-main CodeQL analysis, protected refs, and non-effects are in `docs/PUBLIC-REPOSITORY-TRANSITION-REPORT-2026-08-14.md` and `docs/CODEX-GITHUB-COMPLIANCE-REPORT-2026-08-14.md`.",
    "- Treat current Git refs and hosted settings as live state: fetch and read them when needed rather than treating a tracked checkpoint SHA as permanently current. The tracked reports remain historical evidence for the verified transition baseline.",
    "- `stable` remains the sole installation/release source and `runtime-diagnostics` remains separate generated data; neither was merged or advanced by the public-transition closeout."
  ].join("\n"),
  Remaining: [
    "- Issue 4 remains open solely because installed GitHub App permissions are `UNVERIFIED` without GitHub App-authorized authentication.",
    "- All other executable public-transition and repository-compliance work is complete.",
    "- Keep terminal status `BLOCKED` until the installed-App permission readback exists."
  ].join("\n"),
  "Next safe action": "Obtain GitHub App-authorized authentication, read repository-scoped installed-App permissions, and reconcile issue 4 and terminal status through a protected evidence update. Repeat read-only verification only if hosted evidence drifts. Preserve `stable`, keep `runtime-diagnostics` separate, and do not change therapy, model-role, privacy, or release policy without the applicable owner decision."
};
const CONTROL_STATES = new Set(["verified", "enabled", "disabled", "unverified", "not_applicable"]);
const EXPECTED_PUBLIC_GITHUB_CONTROLS = {
  default_branch_rules: "enabled",
  stable_branch_rules: "enabled",
  secret_scanning: "enabled",
  push_protection: "enabled",
  code_scanning: "enabled",
  actions_default_permissions: "verified",
  actions_allowed_set: "enabled",
  actions_sha_pinning: "enabled",
  vulnerability_alerts: "enabled",
  dependabot_alerts: "enabled",
  dependabot_security_updates: "enabled",
  automated_security_fixes: "enabled",
  private_vulnerability_reporting: "enabled",
  github_app_permissions: "unverified"
};
const EXPECTED_CODEQL_EVIDENCE = {
  id: 31865348513,
  job_id: 94965480118,
  url: "https://github.com/u-dont-existDOTcom/innerSignalGraph/actions/runs/31865348513",
  sha: "956b17cc008fe68b6d9f5e9c36f002066aa9732a",
  check: "codeql-javascript",
  conclusion: "success",
  analysis_ids: [1622692668, 1622690884],
  open_alerts: 0
};
const EXPECTED_PROTECTED_BRANCH = {
  protected: true,
  strict: true,
  enforce_admins: true,
  required_approvals: 0,
  required_conversation_resolution: true,
  required_linear_history: true,
  allow_force_pushes: false,
  allow_deletions: false
};
const EXPECTED_BRANCH_PROTECTION_EVIDENCE = {
  required_contexts: ["deterministic-package", "workflow-policy", "codeql-javascript"],
  main: EXPECTED_PROTECTED_BRANCH,
  stable: EXPECTED_PROTECTED_BRANCH
};
const DEPENDABOT_PATH = ".github/dependabot.yml";
const EXPECTED_DEPENDABOT = {
  version: 2,
  updates: [
    {
      "package-ecosystem": "github-actions",
      directory: "/",
      schedule: { interval: "monthly" },
      "open-pull-requests-limit": 5,
      labels: ["dependencies", "github-actions"],
      "commit-message": { prefix: "chore(actions)" }
    },
    {
      "package-ecosystem": "npm",
      directory: "/",
      schedule: { interval: "monthly" },
      "open-pull-requests-limit": 5,
      labels: ["dependencies", "npm"],
      "commit-message": { prefix: "chore(deps)" }
    }
  ]
};
const EXPECTED_DEPENDENCY_UPDATE_EVIDENCE =
  "Repository policy enforces exact bounded monthly root Dependabot schedules for npm and GitHub Actions; this file-backed configuration does not by itself prove hosted execution.";
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readUniqueMarkdownSection(text, heading, relative, findings) {
  if (text === null) return null;
  const headingPattern = new RegExp(`^## ${escapeRegExp(heading)}\\s*$`, "gm");
  const matches = [...text.matchAll(headingPattern)];
  if (matches.length !== 1) {
    findings.push({
      severity: "error",
      code: "public-closeout-section",
      path: relative,
      message: `public closeout evidence must contain exactly one authoritative ## ${heading} section`
    });
    return null;
  }
  const start = matches[0].index + matches[0][0].length;
  const remainder = text.slice(start);
  const nextHeading = remainder.search(/^## /m);
  return (nextHeading === -1 ? remainder : remainder.slice(0, nextHeading)).trim();
}

function readUniquePublicCloseoutReceipt(text, relative, findings) {
  if (text === null) return null;
  const matches = [...text.matchAll(/<!-- public-closeout-receipt\s*\n([\s\S]*?)\n-->/g)];
  if (matches.length !== 1) {
    findings.push({
      severity: "error",
      code: "public-closeout-receipt",
      path: relative,
      message: "public closeout report must contain exactly one structured receipt"
    });
    return null;
  }
  try {
    return JSON.parse(matches[0][1]);
  } catch (error) {
    findings.push({
      severity: "error",
      code: "public-closeout-receipt",
      path: relative,
      message: `public closeout receipt is invalid JSON: ${error.message}`
    });
    return null;
  }
}

function renderPublicCloseoutReceiptSection(receipt, relative) {
  const pr = receipt.pullRequest;
  const head = receipt.exactHeadChecks;
  const merged = receipt.mergedMainChecks;
  const analysis = receipt.mergedMainCodeqlAnalysis;
  const structured = `<!-- public-closeout-receipt\n${JSON.stringify(receipt, null, 2)}\n-->`;
  if (relative === PUBLICATION_REPORT) {
    return [
      `Pull request [9](${pr.url}) completed the protected evidence path with reviewed head \`${pr.reviewedHead}\`, tree \`${pr.reviewedTree}\`, and squash merge \`${pr.mergeCommit}\` whose tree matches exactly. The [durable receipt](${pr.receiptUrl}) records protection gating, final refs, hosted readback, and issue 4 disposition.`,
      "",
      "| Check | Run / job | Result |",
      "|---|---|---|",
      `| \`deterministic-package\` | \`${head["deterministic-package"].run}\` / \`${head["deterministic-package"].job}\` | ${head["deterministic-package"].conclusion} on exact reviewed head |`,
      `| \`workflow-policy\` | \`${head["workflow-policy"].run}\` / \`${head["workflow-policy"].job}\` | ${head["workflow-policy"].conclusion} on exact reviewed head |`,
      `| \`codeql-javascript\` | \`${head["codeql-javascript"].run}\` / \`${head["codeql-javascript"].job}\` | ${head["codeql-javascript"].conclusion} on exact reviewed head |`,
      `| GitHub Advanced Security \`CodeQL\` | check \`${receipt.advancedSecurityCheck.id}\` | ${receipt.advancedSecurityCheck.conclusion} |`,
      "",
      `Protected merged-main checks on \`${pr.mergeCommit}\` also succeeded:`,
      "",
      "| Check | Run / job | Result |",
      "|---|---|---|",
      `| \`deterministic-package\` | \`${merged["deterministic-package"].run}\` / \`${merged["deterministic-package"].job}\` | ${merged["deterministic-package"].conclusion} on exact merged main |`,
      `| \`workflow-policy\` | \`${merged["workflow-policy"].run}\` / \`${merged["workflow-policy"].job}\` | ${merged["workflow-policy"].conclusion} on exact merged main |`,
      `| \`codeql-javascript\` | \`${merged["codeql-javascript"].run}\` / \`${merged["codeql-javascript"].job}\` | ${merged["codeql-javascript"].conclusion} on exact merged main |`,
      "",
      `Exact merged-main CodeQL analysis \`${analysis.id}\` is associated with \`${analysis.commit}\`; final open-alert readback was zero.`,
      "",
      structured
    ].join("\n");
  }
  return [
    `Pull request 9 is ${pr.state}: reviewed candidate tree \`${pr.reviewedTree}\` equals merged-main tree \`${pr.mergeTree}\` at \`${pr.mergeCommit}\`.`,
    "",
    "Pull request 9 exact-head and merge checks:",
    "",
    `- \`deterministic-package\`: run \`${head["deterministic-package"].run}\`, job \`${head["deterministic-package"].job}\`, ${head["deterministic-package"].conclusion}.`,
    `- \`workflow-policy\`: run \`${head["workflow-policy"].run}\`, job \`${head["workflow-policy"].job}\`, ${head["workflow-policy"].conclusion}.`,
    `- \`codeql-javascript\`: run \`${head["codeql-javascript"].run}\`, job \`${head["codeql-javascript"].job}\`, ${head["codeql-javascript"].conclusion}.`,
    `- GitHub Advanced Security \`CodeQL\`: check \`${receipt.advancedSecurityCheck.id}\`, ${receipt.advancedSecurityCheck.conclusion}.`,
    "",
    `Protected merged-main checks on \`${pr.mergeCommit}\`:`,
    "",
    `- \`deterministic-package\`: run \`${merged["deterministic-package"].run}\`, job \`${merged["deterministic-package"].job}\`, ${merged["deterministic-package"].conclusion}.`,
    `- \`workflow-policy\`: run \`${merged["workflow-policy"].run}\`, job \`${merged["workflow-policy"].job}\`, ${merged["workflow-policy"].conclusion}.`,
    `- \`codeql-javascript\`: run \`${merged["codeql-javascript"].run}\`, job \`${merged["codeql-javascript"].job}\`, ${merged["codeql-javascript"].conclusion}.`,
    `- Exact merged-main CodeQL analysis \`${analysis.id}\` is associated with \`${analysis.commit}\`; final open-alert readback was zero.`,
    "",
    structured,
    "",
    `The containing Task 9 commit could not embed its own immutable merge identity, so pull request 9's [post-merge receipt](${pr.receiptUrl}) durably binds the exact merge, check, ref, and issue result.`
  ].join("\n");
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
  if (profile.visibility === "public" && transitionStatus === "completed") {
    const evidence = profile.github_controls_evidence;
    if (!isDeepStrictEqual(profile.github_controls, EXPECTED_PUBLIC_GITHUB_CONTROLS)) {
      findings.push({
        severity: "error",
        code: "profile-public-hosted-controls",
        path: relative,
        message: "public/completed profile must retain the exact verified control map and sole unverified installed-App boundary"
      });
    }
    if (!isDeepStrictEqual(evidence?.codeql_run, EXPECTED_CODEQL_EVIDENCE)) {
      findings.push({
        severity: "error",
        code: "profile-codeql-evidence",
        path: relative,
        message: "public/completed profile must record the exact successful CodeQL run, SHA, analyses, and open-alert count"
      });
    }
    if (!isDeepStrictEqual(evidence?.branch_protection, EXPECTED_BRANCH_PROTECTION_EVIDENCE)) {
      findings.push({
        severity: "error",
        code: "profile-branch-protection-evidence",
        path: relative,
        message: "public/completed profile must record exact main/stable protection and required contexts"
      });
    }
    if (evidence?.dependency_updates !== EXPECTED_DEPENDENCY_UPDATE_EVIDENCE) {
      findings.push({
        severity: "error",
        code: "profile-dependency-update-evidence",
        path: relative,
        message: "public/completed profile must distinguish enforced Dependabot configuration from hosted execution evidence"
      });
    }
    if (
      !/^2026-08-15T\d{2}:\d{2}:\d{2}Z$/.test(evidence?.checked_at ?? "") ||
      evidence?.source !== "GitHub REST API readback and verified GitHub Actions results"
    ) {
      findings.push({
        severity: "error",
        code: "profile-hosted-evidence-source",
        path: relative,
        message: "public/completed profile must record the bounded UTC readback time and exact hosted evidence source"
      });
    }
    if (
      evidence?.hardening_issue_state !== "open" ||
      !/GitHub App-authorized token/.test(evidence?.hardening_issue_remaining_action ?? "") ||
      !/repository-scoped installed-App permissions/.test(evidence?.hardening_issue_remaining_action ?? "")
    ) {
      findings.push({
        severity: "error",
        code: "profile-hardening-issue-disposition",
        path: relative,
        message: "public/completed profile must keep issue 4 open with the exact installed-App permission action"
      });
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
    } else if (profile?.visibility === "public" && profile.publication_transition?.status === "completed") {
      if (!entry?.includes(PUBLIC_ENTRY_CLAIMS[relative]) || entry.includes(PRIVATE_ENTRY_CLAIMS[relative])) {
        findings.push({
          severity: "error",
          code: "publication-stale-private-claim",
          path: relative,
          message: "public/completed entry document must state the verified public posture and retire the private/pre-public claim"
        });
      }
    }
  }
  const checkpointText = readText(root, CHECKPOINT, findings);
  const checkpoint = checkpointText?.toLowerCase() ?? null;
  for (const heading of CHECKPOINT_HEADINGS) {
    requireMatch(checkpoint, new RegExp(`^## ${heading.replace("/", "\\/")}$`, "m"), "checkpoint-heading", CHECKPOINT, `missing checkpoint heading: ${heading}`, findings);
  }
  const publicationEvidence = profile?.publication_evidence;
  const exactPublicationEvidenceRecorded =
    /^[a-f0-9]{40}$/.test(publicationEvidence?.subject_commit ?? "") &&
    /^[a-f0-9]{40}$/.test(publicationEvidence?.subject_tree ?? "") &&
    publicationEvidence?.report === PUBLICATION_REPORT &&
    fs.existsSync(path.join(root, PUBLICATION_REPORT));
  if (
    exactPublicationEvidenceRecorded &&
    /^(?:-\s+)?commit\b[^\n]*(?:\bpre-public\b[^\n]*\bevidence\b|\brefreshed evidence\b|\bthe evidence\b)/im.test(
      checkpoint ?? ""
    )
  ) {
    findings.push({
      severity: "error",
      code: "checkpoint-stale-publication-evidence-step",
      path: CHECKPOINT,
      message: "completed pre-publication evidence commit must not remain an active checkpoint instruction"
    });
  }
  if (profile?.visibility === "public" && profile.publication_transition?.status === "completed") {
    const checkpointSections = ["Current checkpoint", "Remaining", "Next safe action"].map((heading) =>
      readUniqueMarkdownSection(checkpointText, heading, CHECKPOINT, findings)
    );
    const activeCheckpoint = checkpointSections.filter((section) => section !== null).join("\n");
    if (PUBLIC_CLOSEOUT_ACTIVE_STALE_PATTERNS.some((pattern) => pattern.test(activeCheckpoint))) {
      findings.push({
        severity: "error",
        code: "public-closeout-stale-evidence",
        path: CHECKPOINT,
        message: "completed public-transition work must not remain in authoritative active checkpoint sections"
      });
    }
    const [currentSection, remainingSection, nextSection] = checkpointSections;
    for (const [index, heading] of ["Current checkpoint", "Remaining", "Next safe action"].entries()) {
      const section = checkpointSections[index];
      if (section !== null && section !== EXPECTED_PUBLIC_CLOSEOUT_CHECKPOINT_SECTIONS[heading]) {
        findings.push({
          severity: "error",
          code: "public-closeout-stale-evidence",
          path: CHECKPOINT,
          message: `authoritative ## ${heading} must remain the closed, timeless public-closeout projection`
        });
      }
    }
    if (currentSection !== null && currentSection !== EXPECTED_PUBLIC_CLOSEOUT_CHECKPOINT_SECTIONS["Current checkpoint"]) {
      findings.push({
        severity: "error",
        code: "public-closeout-receipt",
        path: CHECKPOINT,
        message: "visible checkpoint receipt must agree with merged, matching-tree, successful-check, and zero-alert evidence"
      });
    }
    for (const reportPath of [PUBLICATION_REPORT, COMPLIANCE_REPORT]) {
      requireLiteral(
        checkpointText,
        reportPath,
        "public-closeout-route",
        CHECKPOINT,
        `checkpoint must route to ${reportPath}`,
        findings
      );
    }
    for (const [relative, activeHeading] of Object.entries(PUBLIC_CLOSEOUT_REPORT_SECTIONS)) {
      const report = readText(root, relative, findings);
      const activeSection = readUniqueMarkdownSection(report, activeHeading, relative, findings);
      if (
        activeSection !== null &&
        (PUBLIC_CLOSEOUT_ACTIVE_STALE_PATTERNS.some((pattern) => pattern.test(activeSection)) ||
          !/issue 4[^\n]*(?:remains|is) open[^\n]*sole(?:ly)?/i.test(activeSection) ||
          !/GitHub App-authorized/i.test(activeSection) ||
          !/terminal (?:label|status)[^\n]*`?BLOCKED`?/i.test(activeSection))
      ) {
        findings.push({
          severity: "error",
          code: "public-closeout-stale-evidence",
          path: relative,
          message: "authoritative report action must contain only the installed-App readback blocker"
        });
      }
      const receiptSection = readUniqueMarkdownSection(report, "Verified closeout receipt", relative, findings);
      const receipt = readUniquePublicCloseoutReceipt(receiptSection, relative, findings);
      if (receipt !== null && !isDeepStrictEqual(receipt, EXPECTED_PUBLIC_CLOSEOUT_RECEIPT)) {
        findings.push({
          severity: "error",
          code: "public-closeout-receipt",
          path: relative,
          message: "structured receipt must preserve exact merged PR, successful checks, matching tree, main analysis, and sole open issue semantics"
        });
      }
      if (
        receiptSection !== null &&
        receiptSection !== renderPublicCloseoutReceiptSection(EXPECTED_PUBLIC_CLOSEOUT_RECEIPT, relative)
      ) {
        findings.push({
          severity: "error",
          code: "public-closeout-receipt",
          path: relative,
          message: "the unique visible receipt section must exactly render the structured merged, matching-tree, successful-check, and zero-alert evidence"
        });
      }
    }
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

function auditDependencyUpdates(root, findings) {
  const text = readText(root, DEPENDABOT_PATH, findings);
  if (text === null) return;
  const document = parseDocument(text, { strict: true, uniqueKeys: true });
  if (document.errors.length > 0) {
    findings.push({
      severity: "error",
      code: "dependency-updates",
      path: DEPENDABOT_PATH,
      message: "Dependabot configuration must parse uniquely and strictly"
    });
    return;
  }
  let configuration;
  try {
    configuration = document.toJS({ maxAliasCount: 0 });
  } catch {
    findings.push({
      severity: "error",
      code: "dependency-updates",
      path: DEPENDABOT_PATH,
      message: "Dependabot configuration aliases are not allowed"
    });
    return;
  }
  if (!isDeepStrictEqual(configuration, EXPECTED_DEPENDABOT)) {
    findings.push({
      severity: "error",
      code: "dependency-updates",
      path: DEPENDABOT_PATH,
      message: "Dependabot must retain the exact bounded monthly root schedules for npm and GitHub Actions"
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
  auditDependencyUpdates(root, findings);
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
