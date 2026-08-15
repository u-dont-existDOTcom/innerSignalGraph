import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";
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
  status: "completed",
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
const transitionEntryClaims = {
  "README.md": {
    public: "The existing GitHub repository is public, and the publication transition is complete.",
    private: "Its GitHub repository remains private while the approved public transition is in `pre_publication_ready`; this is not a claim that hosted visibility is already public."
  },
  "AGENTS.md": {
    public: "The GitHub repository is public and the publication transition is complete.",
    private: "The repository remains private until GitHub visibility is changed and read back; `pre_publication_ready` is not public visibility."
  },
  "docs/INDEX.md": {
    public: "The GitHub repository is public and `.github/codex-repository.json` records the completed publication transition.",
    private: "The repository is still private while `.github/codex-repository.json` records `pre_publication_ready`. Neither the MIT license nor public-ready documentation proves that GitHub visibility or hosted controls have changed."
  }
};
const expectedDependabot = {
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
const expectedPublicGithubControls = {
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
const publicCloseoutReceipt = {
  pullRequest: "https://github.com/u-dont-existDOTcom/innerSignalGraph/pull/9",
  receipt: "https://github.com/u-dont-existDOTcom/innerSignalGraph/pull/9#issuecomment-5300990615",
  head: "7bf2b1a706aab6a7d9c36070b15590153c652e2a",
  tree: "4ff2a229a628bf0f9dc1a11abb23a88cd6068e18",
  merge: "0ccb120442292653a11676ad312f18092944b5a1",
  deterministicRun: "31869840311",
  deterministicJob: "94976658513",
  workflowRun: "31869840270",
  workflowJob: "94976658502",
  codeqlRun: "31869840222",
  codeqlJob: "94976658119",
  advancedCodeqlCheck: "94976762584",
  mergedDeterministicRun: "31869941911",
  mergedDeterministicJob: "94976909523",
  mergedWorkflowRun: "31869942049",
  mergedWorkflowJob: "94976909702",
  mergedCodeqlRun: "31869941895",
  mergedCodeqlJob: "94976909307",
  mergedCodeqlAnalysis: "1622858177",
  issue: "https://github.com/u-dont-existDOTcom/innerSignalGraph/issues/4"
};

const structuredPublicCloseoutReceipt = {
  schemaVersion: 1,
  pullRequest: {
    url: publicCloseoutReceipt.pullRequest,
    receiptUrl: publicCloseoutReceipt.receipt,
    state: "merged",
    reviewedHead: publicCloseoutReceipt.head,
    reviewedTree: publicCloseoutReceipt.tree,
    mergeCommit: publicCloseoutReceipt.merge,
    mergeTree: publicCloseoutReceipt.tree,
    treeMatch: true
  },
  exactHeadChecks: {
    "deterministic-package": {
      run: publicCloseoutReceipt.deterministicRun,
      job: publicCloseoutReceipt.deterministicJob,
      conclusion: "success"
    },
    "workflow-policy": {
      run: publicCloseoutReceipt.workflowRun,
      job: publicCloseoutReceipt.workflowJob,
      conclusion: "success"
    },
    "codeql-javascript": {
      run: publicCloseoutReceipt.codeqlRun,
      job: publicCloseoutReceipt.codeqlJob,
      conclusion: "success"
    }
  },
  advancedSecurityCheck: {
    id: publicCloseoutReceipt.advancedCodeqlCheck,
    conclusion: "success"
  },
  mergedMainChecks: {
    "deterministic-package": {
      run: publicCloseoutReceipt.mergedDeterministicRun,
      job: publicCloseoutReceipt.mergedDeterministicJob,
      conclusion: "success"
    },
    "workflow-policy": {
      run: publicCloseoutReceipt.mergedWorkflowRun,
      job: publicCloseoutReceipt.mergedWorkflowJob,
      conclusion: "success"
    },
    "codeql-javascript": {
      run: publicCloseoutReceipt.mergedCodeqlRun,
      job: publicCloseoutReceipt.mergedCodeqlJob,
      conclusion: "success"
    }
  },
  mergedMainCodeqlAnalysis: {
    id: publicCloseoutReceipt.mergedCodeqlAnalysis,
    commit: publicCloseoutReceipt.merge,
    openAlerts: 0
  },
  remainingIssue: {
    url: publicCloseoutReceipt.issue,
    state: "open",
    soleAction: "read repository-scoped installed GitHub App permissions with GitHub App-authorized authentication"
  }
};

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

function replaceMarkdownSection(source, heading, body) {
  const marker = `## ${heading}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, marker);
  const contentStart = source.indexOf("\n", start) + 1;
  const next = source.indexOf("\n## ", contentStart);
  const end = next === -1 ? source.length : next + 1;
  return `${source.slice(0, contentStart)}\n${body.trim()}\n\n${source.slice(end)}`;
}

function readMarkdownSection(source, heading) {
  const marker = `## ${heading}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, marker);
  const contentStart = source.indexOf("\n", start) + 1;
  const next = source.indexOf("\n## ", contentStart);
  return source.slice(contentStart, next === -1 ? source.length : next + 1).trim();
}

function withStructuredPublicCloseoutReceipt(source) {
  if (source.includes("<!-- public-closeout-receipt")) return source;
  return `${source.trimEnd()}\n\n<!-- public-closeout-receipt\n${JSON.stringify(structuredPublicCloseoutReceipt, null, 2)}\n-->\n`;
}

function mutateStructuredPublicCloseoutReceipt(source, mutate) {
  const withReceipt = withStructuredPublicCloseoutReceipt(source);
  const match = withReceipt.match(/<!-- public-closeout-receipt\n([\s\S]*?)\n-->/);
  assert.ok(match);
  const receipt = JSON.parse(match[1]);
  mutate(receipt);
  return withReceipt.replace(match[0], `<!-- public-closeout-receipt\n${JSON.stringify(receipt, null, 2)}\n-->`);
}

function appendToVerifiedCloseoutReceipt(source, line) {
  if (!source.includes("## Verified closeout receipt")) return `${source.trimEnd()}\n\n${line}\n`;
  const body = readMarkdownSection(source, "Verified closeout receipt");
  return replaceMarkdownSection(source, "Verified closeout receipt", `${body}\n${line}`);
}

test("public profile declares exact commands, completed publication transition, and one canonical checkpoint", async () => {
  const profile = JSON.parse(await read(".github/codex-repository.json"));
  assert.equal(profile.repository_kind, "software");
  assert.equal(profile.active, true);
  assert.equal(profile.long_running, true);
  assert.equal(profile.visibility, "public");
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
    assert.match(entry, /repository is public/i, relative);
  }
});

test("public profile rejects stale private transition claims in every entry document", async (t) => {
  const fixture = await createAuditFixture(t);
  for (const [relative, { public: publicClaim, private: stalePrivateClaim }] of Object.entries(transitionEntryClaims)) {
    const absolute = path.join(fixture, relative);
    const current = await fs.readFile(absolute, "utf8");
    assert.ok(current.includes(publicClaim), relative);
    await fs.writeFile(absolute, current.replace(publicClaim, stalePrivateClaim));
    const result = auditRepository(fixture);
    assert.ok(
      result.findings.some(
        ({ code, path: findingPath }) => code === "publication-stale-private-claim" && findingPath === relative
      ),
      `${relative}: ${JSON.stringify(result.findings)}`
    );
    await fs.writeFile(absolute, current);
  }
});

test("repository audit rejects completed publication-evidence commit steps in the canonical checkpoint", async (t) => {
  const fixture = await createAuditFixture(t);
  const reportPath = path.join(fixture, "docs", "PUBLIC-REPOSITORY-TRANSITION-REPORT-2026-08-14.md");
  const profile = JSON.parse(await fs.readFile(path.join(fixture, ".github", "codex-repository.json"), "utf8"));
  const checkpoint = await fs.readFile(path.join(fixture, checkpointPath), "utf8");

  assert.ok((await fs.stat(reportPath)).isFile());
  assert.match(profile.publication_evidence?.subject_commit ?? "", /^[a-f0-9]{40}$/);
  assert.equal(profile.publication_evidence?.report, "docs/PUBLIC-REPOSITORY-TRANSITION-REPORT-2026-08-14.md");

  for (const staleStep of [
    "- Commit the pre-public report/profile/checkpoint/index evidence and repeat the exact affected gates.",
    "Commit and independently review this refreshed evidence, then publish the single private transition PR."
  ]) {
    await fs.writeFile(path.join(fixture, checkpointPath), `${checkpoint}\n${staleStep}\n`);
    const result = auditRepository(fixture);
    assert.ok(
      result.findings.some(
        ({ code, path: findingPath }) =>
          code === "checkpoint-stale-publication-evidence-step" && findingPath === checkpointPath
      ),
      `${staleStep}: ${JSON.stringify(result.findings)}`
    );
  }
});

test("public closeout audit enforces semantic PR 9, merged-main, CodeQL, and issue receipts", async (t) => {
  const fixture = await createAuditFixture(t);
  const reportPaths = [
    "docs/PUBLIC-REPOSITORY-TRANSITION-REPORT-2026-08-14.md",
    "docs/CODEX-GITHUB-COMPLIANCE-REPORT-2026-08-14.md"
  ];
  const mutations = [
    ["unmerged pull request", (receipt) => (receipt.pullRequest.state = "unmerged")],
    ["nonmatching reviewed and merge trees", (receipt) => (receipt.pullRequest.treeMatch = false)],
    ["failed exact-head check", (receipt) => (receipt.exactHeadChecks["deterministic-package"].conclusion = "failure")],
    ["failed Advanced Security check", (receipt) => (receipt.advancedSecurityCheck.conclusion = "failure")],
    ["failed merged-main check", (receipt) => (receipt.mergedMainChecks["workflow-policy"].conclusion = "failure")],
    ["analysis associated with the wrong SHA", (receipt) => (receipt.mergedMainCodeqlAnalysis.commit = publicCloseoutReceipt.head)],
    ["remaining issue closed without App readback", (receipt) => (receipt.remainingIssue.state = "closed")]
  ];

  for (const relative of reportPaths) {
    const absolute = path.join(fixture, relative);
    const original = await fs.readFile(absolute, "utf8");
    for (const [label, mutate] of mutations) {
      await fs.writeFile(absolute, mutateStructuredPublicCloseoutReceipt(original, mutate));
      const result = auditRepository(fixture);
      assert.ok(
        result.findings.some(
          ({ code, path: findingPath }) => code === "public-closeout-receipt" && findingPath === relative
        ),
        `${relative}: ${label}: ${JSON.stringify(result.findings)}`
      );
    }
    await fs.writeFile(absolute, original);

    const structuredReceipt = original.match(/<!-- public-closeout-receipt\n[\s\S]*?\n-->/)?.[0];
    assert.ok(structuredReceipt, relative);
    await fs.writeFile(
      absolute,
      `${original.trimEnd()}\n\n## Historical machine receipt copy\n\n${structuredReceipt}\n`
    );
    const duplicateGlobalReceiptResult = auditRepository(fixture);
    assert.ok(
      duplicateGlobalReceiptResult.findings.some(
        ({ code, path: findingPath }) => code === "public-closeout-receipt" && findingPath === relative
      ),
      `${relative}: duplicate global receipt: ${JSON.stringify(duplicateGlobalReceiptResult.findings)}`
    );

    await fs.writeFile(absolute, original.replace(structuredReceipt, ""));
    const missingGlobalReceiptResult = auditRepository(fixture);
    assert.ok(
      missingGlobalReceiptResult.findings.some(
        ({ code, path: findingPath }) => code === "public-closeout-receipt" && findingPath === relative
      ),
      `${relative}: missing global receipt: ${JSON.stringify(missingGlobalReceiptResult.findings)}`
    );

    await fs.writeFile(
      absolute,
      original.replace(structuredReceipt, '<!-- public-closeout-receipt\n{"schemaVersion":\n-->')
    );
    const malformedGlobalReceiptResult = auditRepository(fixture);
    assert.ok(
      malformedGlobalReceiptResult.findings.some(
        ({ code, path: findingPath }) => code === "public-closeout-receipt" && findingPath === relative
      ),
      `${relative}: malformed global receipt: ${JSON.stringify(malformedGlobalReceiptResult.findings)}`
    );

    await fs.writeFile(
      absolute,
      `${original.trimEnd()}\n\n## Historical malformed receipt copy\n\n<!-- public-closeout-receipt\n{"schemaVersion":1}\n`
    );
    const unterminatedGlobalReceiptResult = auditRepository(fixture);
    assert.ok(
      unterminatedGlobalReceiptResult.findings.some(
        ({ code, path: findingPath }) => code === "public-closeout-receipt" && findingPath === relative
      ),
      `${relative}: unterminated global receipt: ${JSON.stringify(unterminatedGlobalReceiptResult.findings)}`
    );
    await fs.writeFile(absolute, original);
  }

  const visibleContradictions = [
    {
      relative: reportPaths[0],
      mutate: (source) => source.replace("success on exact merged main", "failure on exact merged main")
    },
    {
      relative: reportPaths[0],
      mutate: (source) => source.replace("whose tree matches exactly", "whose tree does not match")
    },
    {
      relative: reportPaths[1],
      mutate: (source) => source.replace(
        "`deterministic-package`: run `31869941911`, job `94976909523`, success.",
        "`deterministic-package`: run `31869941911`, job `94976909523`, failure."
      )
    }
  ];
  for (const { relative, mutate } of visibleContradictions) {
    const absolute = path.join(fixture, relative);
    const original = await fs.readFile(absolute, "utf8");
    const contradicted = mutate(original);
    assert.notEqual(contradicted, original, relative);
    await fs.writeFile(absolute, contradicted);
    const result = auditRepository(fixture);
    assert.ok(
      result.findings.some(
        ({ code, path: findingPath }) => code === "public-closeout-receipt" && findingPath === relative
      ),
      `${relative}: visible contradiction: ${JSON.stringify(result.findings)}`
    );
    await fs.writeFile(absolute, original);
  }

  const additiveVisibleContradictions = [
    "The reviewed candidate tree does not equal the merged-main tree.",
    "The exact-head and merged-main required checks failed.",
    "Merged-main CodeQL analysis 1622858177 had five open alerts.",
    "The merged-main CodeQL analysis belongs to a different commit.",
    "Run 31869941911 did not succeed."
  ];
  for (const relative of reportPaths) {
    const absolute = path.join(fixture, relative);
    const original = await fs.readFile(absolute, "utf8");
    for (const contradiction of additiveVisibleContradictions) {
      await fs.writeFile(absolute, appendToVerifiedCloseoutReceipt(original, contradiction));
      const result = auditRepository(fixture);
      assert.ok(
        result.findings.some(
          ({ code, path: findingPath }) => code === "public-closeout-receipt" && findingPath === relative
        ),
        `${relative}: ${contradiction}: ${JSON.stringify(result.findings)}`
      );
    }
    await fs.writeFile(absolute, original);
  }

  const historicalReportAbsolute = path.join(fixture, reportPaths[0]);
  const historicalReport = await fs.readFile(historicalReportAbsolute, "utf8");
  await fs.writeFile(
    historicalReportAbsolute,
    `${historicalReport.trimEnd()}\n\n## Historical pre-merge receipt state\n\nPR 9 was unmerged while its required checks were pending.\n`
  );
  const historicalReceiptResult = auditRepository(fixture);
  assert.ok(
    historicalReceiptResult.findings.every(
      ({ code, path: findingPath }) =>
        findingPath !== reportPaths[0] || !["public-closeout-receipt", "public-closeout-stale-evidence"].includes(code)
    ),
    JSON.stringify(historicalReceiptResult.findings)
  );
  await fs.writeFile(historicalReportAbsolute, historicalReport);

  const checkpointAbsolute = path.join(fixture, checkpointPath);
  const checkpoint = await fs.readFile(checkpointAbsolute, "utf8");
  const current = readMarkdownSection(checkpoint, "Current checkpoint");
  await fs.writeFile(
    checkpointAbsolute,
    replaceMarkdownSection(
      checkpoint,
      "Current checkpoint",
      `${current}\n- Receipt contradiction: PR 9 is unmerged, its candidate tree does not match main, merged-main checks failed, and the analysis has nonzero alerts.`
    )
  );
  const checkpointResult = auditRepository(fixture);
  assert.ok(
    checkpointResult.findings.some(
      ({ code, path: findingPath }) => code === "public-closeout-receipt" && findingPath === checkpointPath
    ),
    JSON.stringify(checkpointResult.findings)
  );
});

test("public closeout audit scopes stale work to unique authoritative active sections", async (t) => {
  const fixture = await createAuditFixture(t);
  const checkpointAbsolute = path.join(fixture, checkpointPath);
  const original = await fs.readFile(checkpointAbsolute, "utf8");
  const staleActiveLines = [
    "- Complete the Task 9 security/privacy diff review and freeze the exact containing commit.",
    "- Obtain independent review before publishing the branch.",
    "- Open the focused protected pull request and wait for its required checks.",
    "- Squash-merge only after the exact reviewed tree is green.",
    "- Update the pull request and issue 4 with the merge SHA and final check IDs.",
    "- Run Task 10's complete exact-main verification after this protected closeout repair is merged.",
    "- Task 10 begins only after this protected repair merges.",
    "- Finish Task 9, open its protected evidence pull request, and squash-merge it when green.",
    "- Exact base: protected public `origin/main=956b17cc008fe68b6d9f5e9c36f002066aa9732a`.",
    "- Current Task 9 branch: `codex/public-hosted-evidence-2026-08-14`."
  ];
  const nextAction = readMarkdownSection(original, "Next safe action");

  for (const stale of staleActiveLines) {
    await fs.writeFile(checkpointAbsolute, replaceMarkdownSection(original, "Next safe action", `${nextAction}\n${stale}`));
    const result = auditRepository(fixture);
    assert.ok(
      result.findings.some(
        ({ code, path: findingPath }) => code === "public-closeout-stale-evidence" && findingPath === checkpointPath
      ),
      `${stale}: ${JSON.stringify(result.findings)}`
    );
  }

  const historical = replaceMarkdownSection(
    original,
    "Completed",
    "Historical rejected instruction from the pre-merge plan:\n\nFinish Task 9, open its protected evidence pull request, and merge it when green."
  );
  await fs.writeFile(checkpointAbsolute, historical);
  const historicalResult = auditRepository(fixture);
  assert.ok(
    historicalResult.findings.every(({ code }) => code !== "public-closeout-stale-evidence"),
    JSON.stringify(historicalResult.findings)
  );

  const publicReportPath = "docs/PUBLIC-REPOSITORY-TRANSITION-REPORT-2026-08-14.md";
  const publicReportAbsolute = path.join(fixture, publicReportPath);
  const publicReport = await fs.readFile(publicReportAbsolute, "utf8");
  await fs.writeFile(
    publicReportAbsolute,
    `${publicReport}\n## Historical rejected plan quotation\n\nTask 10 begins only after this protected repair merges.\n`
  );
  const historicalReportResult = auditRepository(fixture);
  assert.ok(
    historicalReportResult.findings.every(({ code }) => code !== "public-closeout-stale-evidence"),
    JSON.stringify(historicalReportResult.findings)
  );
  await fs.writeFile(publicReportAbsolute, publicReport);

  const sectionMutations = [
    {
      relative: checkpointPath,
      mutate: (source) => source.replace("## Remaining", "## Retired remaining")
    },
    {
      relative: checkpointPath,
      mutate: (source) => `${source}\n## Remaining\nDuplicate active state.\n`
    },
    {
      relative: "docs/PUBLIC-REPOSITORY-TRANSITION-REPORT-2026-08-14.md",
      mutate: (source) => source.replace("## Issue 4 and remaining action", "## Historical issue 4 disposition")
    },
    {
      relative: "docs/CODEX-GITHUB-COMPLIANCE-REPORT-2026-08-14.md",
      mutate: (source) => `${source}\n## Remaining action and residual risk\nDuplicate active state.\n`
    },
    {
      relative: "docs/PUBLIC-REPOSITORY-TRANSITION-REPORT-2026-08-14.md",
      mutate: (source) => source.replace("## Verified closeout receipt", "## Historical closeout receipt"),
      code: "public-closeout-section"
    },
    {
      relative: "docs/CODEX-GITHUB-COMPLIANCE-REPORT-2026-08-14.md",
      mutate: (source) => `${source}\n## Verified closeout receipt\nDuplicate receipt.\n`,
      code: "public-closeout-section"
    }
  ];
  for (const { relative, mutate, code = "public-closeout-section" } of sectionMutations) {
    const absolute = path.join(fixture, relative);
    const source = await fs.readFile(absolute, "utf8");
    await fs.writeFile(absolute, mutate(source));
    const result = auditRepository(fixture);
    assert.ok(
      result.findings.some(
        ({ code: findingCode, path: findingPath }) => findingCode === code && findingPath === relative
      ),
      `${relative}: ${JSON.stringify(result.findings)}`
    );
    await fs.writeFile(absolute, source);
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

  for (const [visibility, status] of [["public", "completed"]]) {
    const profile = structuredClone(baseProfile);
    profile.visibility = visibility;
    profile.publication_transition.status = status;
    await fs.writeFile(profilePath, `${JSON.stringify(profile, null, 2)}\n`);
    const result = auditRepository(fixture);
    assert.equal(result.ok, true, `${visibility}/${status}: ${JSON.stringify(result.findings)}`);
  }

  const privateProfile = structuredClone(baseProfile);
  privateProfile.visibility = "private";
  privateProfile.publication_transition.status = "pre_publication_ready";
  await fs.writeFile(profilePath, `${JSON.stringify(privateProfile, null, 2)}\n`);
  const privateResult = auditRepository(fixture);
  assert.ok(
    privateResult.findings.every(({ code }) => code !== "profile-publication-transition-state"),
    JSON.stringify(privateResult.findings)
  );
  assert.ok(
    privateResult.findings.some(({ code }) => code === "publication-premature-public-claim"),
    "a valid private/pre_publication_ready state pair must still reject final public entry-document bytes"
  );

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
  const profilePath = path.join(fixture, ".github", "codex-repository.json");
  const profile = JSON.parse(await fs.readFile(profilePath, "utf8"));
  profile.visibility = "private";
  profile.publication_transition.status = "pre_publication_ready";
  await fs.writeFile(profilePath, `${JSON.stringify(profile, null, 2)}\n`);
  for (const relative of ["README.md", "AGENTS.md", "docs/INDEX.md"]) {
    const absolute = path.join(fixture, relative);
    const original = await fs.readFile(absolute, "utf8");
    const privateEntry = original.replace(transitionEntryClaims[relative].public, transitionEntryClaims[relative].private);
    await fs.writeFile(absolute, `${privateEntry}\nHosted GitHub visibility is public.\n`);
    const result = auditRepository(fixture);
    assert.ok(
      result.findings.some(({ code, path: findingPath }) => code === "publication-premature-public-claim" && findingPath === relative),
      `${relative}: ${JSON.stringify(result.findings)}`
    );
    await fs.writeFile(absolute, original);
  }

  for (const [relative, claims] of Object.entries(transitionEntryClaims)) {
    const absolute = path.join(fixture, relative);
    const current = await fs.readFile(absolute, "utf8");
    await fs.writeFile(absolute, current.replace(claims.public, claims.private));
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

test("Dependabot schedules bounded monthly updates for root npm and GitHub Actions dependencies", async () => {
  const document = parseDocument(await read(".github/dependabot.yml"), { strict: true, uniqueKeys: true });
  assert.deepEqual(document.errors, []);
  assert.deepEqual(document.toJS({ maxAliasCount: 0 }), expectedDependabot);
});

test("repository audit rejects missing, misdirected, or rescheduled npm dependency updates", async (t) => {
  const fixture = await createAuditFixture(t);
  const relative = ".github/dependabot.yml";
  const absolute = path.join(fixture, relative);
  const mutations = [
    (source) => source.replace(/\n  - package-ecosystem: npm[\s\S]*$/, "\n"),
    (source) => source.replace(/(package-ecosystem: npm\n\s+directory:) \/\n/, "$1 /runtime\n"),
    (source) => source.replace(/(package-ecosystem: npm[\s\S]*?interval:) monthly/, "$1 weekly")
  ];

  for (const mutate of mutations) {
    const original = await fs.readFile(absolute, "utf8");
    await fs.writeFile(absolute, mutate(original));
    const result = auditRepository(fixture);
    assert.ok(
      result.findings.some(({ code, path: findingPath }) => code === "dependency-updates" && findingPath === relative),
      JSON.stringify(result.findings)
    );
    await fs.writeFile(absolute, original);
  }
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
      dependabot_security_updates: profile.github_controls.dependabot_security_updates,
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
      dependabot_security_updates: "enabled",
      automated_security_fixes: "enabled",
      default_branch_rules: "enabled",
      stable_branch_rules: "enabled",
      secret_scanning: "enabled",
      push_protection: "enabled",
      code_scanning: "enabled",
      private_vulnerability_reporting: "enabled",
      github_app_permissions: "unverified"
    }
  );
  assert.match(profile.github_controls_evidence.checked_at, /^2026-08-15T\d{2}:\d{2}:\d{2}Z$/);
  assert.equal(profile.github_controls_evidence.source, "GitHub REST API readback and verified GitHub Actions results");
  assert.equal(
    profile.github_controls_evidence.dependency_updates,
    "Repository policy enforces exact bounded monthly root Dependabot schedules for npm and GitHub Actions; this file-backed configuration does not by itself prove hosted execution."
  );
  assert.deepEqual(profile.github_controls_evidence.codeql_run, {
    id: 31865348513,
    job_id: 94965480118,
    url: "https://github.com/u-dont-existDOTcom/innerSignalGraph/actions/runs/31865348513",
    sha: "956b17cc008fe68b6d9f5e9c36f002066aa9732a",
    check: "codeql-javascript",
    conclusion: "success",
    analysis_ids: [1622692668, 1622690884],
    open_alerts: 0
  });
  assert.deepEqual(profile.github_controls_evidence.branch_protection, {
    required_contexts: ["deterministic-package", "workflow-policy", "codeql-javascript"],
    main: {
      protected: true,
      strict: true,
      enforce_admins: true,
      required_approvals: 0,
      required_conversation_resolution: true,
      required_linear_history: true,
      allow_force_pushes: false,
      allow_deletions: false
    },
    stable: {
      protected: true,
      strict: true,
      enforce_admins: true,
      required_approvals: 0,
      required_conversation_resolution: true,
      required_linear_history: true,
      allow_force_pushes: false,
      allow_deletions: false
    }
  });
  assert.equal(
    profile.github_controls_evidence.hardening_issue,
    "https://github.com/u-dont-existDOTcom/innerSignalGraph/issues/4"
  );
  assert.equal(profile.github_controls_evidence.hardening_issue_state, "open");
  assert.match(profile.github_controls_evidence.hardening_issue_remaining_action, /GitHub App-authorized token/);
  assert.match(profile.github_controls_evidence.hardening_issue_remaining_action, /repository-scoped installed-App permissions/);

  const report = await read("docs/CODEX-GITHUB-COMPLIANCE-REPORT-2026-08-14.md");
  assert.match(report, /Terminal status:\s*`BLOCKED`/);
  assert.match(report, /issues\/4/);
  assert.match(report, /pull\/13/);
  assert.match(report, /996d67ae9f8f44b0865cea6d88d169dbbadbbf41/);
  assert.match(report, /GitHub App installation permissions[^\n]*`UNVERIFIED`/i);
  assert.doesNotMatch(report, /gho_[A-Za-z0-9]/);
});

test("public profile audit fails closed on every hosted-control drift while private preparation retains warnings", async (t) => {
  const fixture = await createAuditFixture(t);
  const profilePath = path.join(fixture, ".github", "codex-repository.json");
  const original = JSON.parse(await fs.readFile(profilePath, "utf8"));
  const undetected = [];

  for (const [name, expected] of Object.entries(expectedPublicGithubControls)) {
    const profile = structuredClone(original);
    profile.github_controls[name] = expected === "enabled" ? "disabled" : expected === "verified" ? "unverified" : "enabled";
    await fs.writeFile(profilePath, `${JSON.stringify(profile, null, 2)}\n`);
    const result = auditRepository(fixture);
    if (!result.findings.some(({ code }) => code === "profile-public-hosted-controls")) undetected.push(name);
  }
  assert.deepEqual(undetected, [], `public hosted-control drift passed: ${undetected.join(", ")}`);

  const privateProfile = structuredClone(original);
  privateProfile.visibility = "private";
  privateProfile.publication_transition.status = "pre_publication_ready";
  for (const [name, expected] of Object.entries(expectedPublicGithubControls)) {
    privateProfile.github_controls[name] = expected === "enabled" ? "disabled" : "unverified";
  }
  await fs.writeFile(profilePath, `${JSON.stringify(privateProfile, null, 2)}\n`);
  const privateResult = auditRepository(fixture);
  assert.ok(privateResult.findings.some(({ severity }) => severity === "warning"));
  assert.ok(privateResult.findings.every(({ code }) => code !== "profile-public-hosted-controls"));
});

test("hosted-control evidence fails closed without exact CodeQL and branch-protection readback", async (t) => {
  const fixture = await createAuditFixture(t);
  const profilePath = path.join(fixture, ".github", "codex-repository.json");
  const profile = JSON.parse(await fs.readFile(profilePath, "utf8"));
  delete profile.github_controls_evidence.codeql_run;
  delete profile.github_controls_evidence.branch_protection;
  await fs.writeFile(profilePath, `${JSON.stringify(profile, null, 2)}\n`);
  const result = auditRepository(fixture);
  assert.ok(result.findings.some(({ code }) => code === "profile-codeql-evidence"));
  assert.ok(result.findings.some(({ code }) => code === "profile-branch-protection-evidence"));
});
