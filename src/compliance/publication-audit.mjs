import { execFile } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_BLOB_BYTES = 20 * 1024 * 1024;
const MAX_ARTIFACT_MEMBER_BYTES = 20 * 1024 * 1024;
const MAX_ARTIFACT_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_PROJECTED_METADATA_CHARACTERS = 400;
const REDACTED = "[REDACTED]";
const EXPECTED_REPOSITORY = "u-dont-existDOTcom/innerSignalGraph";
// GitHub's authenticated `Get a repository` response documents this temporary clone-access field.
// It is transport authentication material, not repository publication content:
// https://docs.github.com/en/rest/repos/repos#get-a-repository
const GITHUB_REPOSITORY_TRANSPORT_CREDENTIAL_FIELD = "temp_clone_token";

const CONTENT_RULES = Object.freeze([
  Object.freeze(["credential-pattern", /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/]),
  Object.freeze(["credential-pattern", /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/]),
  Object.freeze(["credential-pattern", /\bsk-ant-[A-Za-z0-9_-]{20,}\b/]),
  Object.freeze(["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/])
]);

const SECRET_FILE_PATTERN = /(^|\/)\.env$/;
const PRIVATE_FILE_PATTERN = /(^|\/)(Cookies|Login Data|id_rsa|\.netrc|\.npmrc)$/;
const PRIVATE_SESSION_PATTERN = /(^|\/)(private-)?therapy-session-transcript\.(txt|json|md)$/i;
const PRIVATE_METADATA_PATTERN =
  /(^|[\\/:])(?:\.env|Cookies|Login Data|id_rsa|\.netrc|\.npmrc|(?:private-)?therapy-session-transcript\.(?:txt|json|md))(?=$|[\\/])/gi;

function redactPattern(value, pattern) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return value.replace(new RegExp(pattern.source, flags), REDACTED);
}

function sanitizeMetadata(value) {
  let sanitized = String(value ?? "unknown");
  for (const [, pattern] of CONTENT_RULES) sanitized = redactPattern(sanitized, pattern);
  sanitized = sanitized.replace(PRIVATE_METADATA_PATTERN, (match, prefix) => `${prefix}${REDACTED}`);
  sanitized = sanitized.replace(/[\u0000-\u001f\u007f]/g, "?");
  if (sanitized.length > MAX_PROJECTED_METADATA_CHARACTERS) {
    sanitized = `${sanitized.slice(0, MAX_PROJECTED_METADATA_CHARACTERS - 1)}…`;
  }
  return sanitized;
}

function projectFinding({ severity = "error", code, surface, identifier }) {
  return {
    severity: sanitizeMetadata(severity),
    code: sanitizeMetadata(code),
    surface: sanitizeMetadata(surface),
    identifier: sanitizeMetadata(identifier)
  };
}

export function scanPublicationRecords(records) {
  const findings = [];

  for (const record of records) {
    const codes = new Set();
    const normalized = (record.path ?? "").replaceAll("\\", "/");
    for (const [code, pattern] of CONTENT_RULES) {
      if (pattern.test(record.text) || pattern.test(normalized)) codes.add(code);
    }

    if (SECRET_FILE_PATTERN.test(normalized)) codes.add("secret-file");
    if (PRIVATE_FILE_PATTERN.test(normalized)) codes.add("private-file");
    if (PRIVATE_SESSION_PATTERN.test(normalized)) codes.add("private-session-material");

    for (const code of codes) {
      findings.push(projectFinding({ code, surface: record.surface, identifier: record.identifier }));
    }
  }

  findings.sort((left, right) =>
    `${left.surface}:${left.identifier}:${left.code}`.localeCompare(`${right.surface}:${right.identifier}:${right.code}`)
  );

  return { schemaVersion: 1, ok: findings.length === 0, scannedRecords: records.length, findings };
}

export function mergePublicationResults(...results) {
  const findings = results.flatMap((result) =>
    result.findings.map(({ severity, code, surface, identifier }) =>
      projectFinding({ severity, code, surface, identifier })
    )
  );
  findings.sort((left, right) =>
    `${left.surface}:${left.identifier}:${left.code}`.localeCompare(`${right.surface}:${right.identifier}:${right.code}`)
  );

  return {
    schemaVersion: 1,
    ok: findings.length === 0 && results.every((result) => result.ok),
    scannedRecords: results.reduce((total, result) => total + result.scannedRecords, 0),
    findings
  };
}

async function runGit(runCommand, root, args, options = {}) {
  return await runCommand("git", args, { cwd: root, ...options });
}

async function defaultRunCommand(command, args, options = {}) {
  return await execFileAsync(command, args, {
    encoding: "utf8",
    maxBuffer: MAX_BLOB_BYTES + 1024 * 1024,
    ...options
  });
}

function parseObjectListing(output) {
  const objects = new Map();
  const malformedRecordNumbers = [];
  const terminated = output.length === 0 || output.endsWith("\n");
  const lines = output.split("\n");
  if (terminated) lines.pop();

  for (const [index, line] of lines.entries()) {
    if (line.length === 0) {
      malformedRecordNumbers.push(index + 1);
      continue;
    }
    if (!terminated && index === lines.length - 1) {
      malformedRecordNumbers.push(index + 1);
      continue;
    }
    const match = /^((?:[0-9a-f]{40}|[0-9a-f]{64}))(?: (.*))?$/.exec(line);
    if (!match) {
      malformedRecordNumbers.push(index + 1);
      continue;
    }
    if (!objects.has(match[1])) objects.set(match[1], match[2]);
  }
  return { objects, malformedRecordNumbers };
}

function parseTree(output) {
  const entries = [];
  const malformedRecordNumbers = [];
  const terminated = output.length === 0 || output.endsWith("\0");
  const items = output.split("\0");
  if (terminated) items.pop();

  for (const [index, item] of items.entries()) {
    if (item.length === 0) {
      malformedRecordNumbers.push(index + 1);
      continue;
    }
    if (!terminated && index === items.length - 1) {
      malformedRecordNumbers.push(index + 1);
      continue;
    }
    const match = /^([0-7]{6}) (blob|tree|commit) ((?:[0-9a-f]{40}|[0-9a-f]{64}))\t([\s\S]+)$/.exec(item);
    const validModeAndType =
      match &&
      ((match[2] === "blob" && ["100644", "100755", "120000"].includes(match[1])) ||
        (match[2] === "tree" && match[1] === "040000") ||
        (match[2] === "commit" && match[1] === "160000"));
    if (!validModeAndType) {
      malformedRecordNumbers.push(index + 1);
      continue;
    }
    if (match[2] === "blob") entries.push({ objectId: match[3], path: match[4] });
  }
  return { entries, malformedRecordNumbers };
}

function normalizeTrackedPath(value) {
  return value.replaceAll("\\", "/");
}

function incompleteFinding(identifier) {
  return { severity: "error", code: "audit-incomplete", surface: "git", identifier };
}

class PublicationAuditIncompleteError extends Error {
  constructor(identifier) {
    super("publication audit coverage is incomplete");
    this.name = "PublicationAuditIncompleteError";
    this.code = "audit-incomplete";
    this.identifier = sanitizeMetadata(identifier);
  }
}

function hostedIncomplete(identifier) {
  return new PublicationAuditIncompleteError(identifier);
}

function requireObject(value, identifier) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw hostedIncomplete(identifier);
  return value;
}

function requirePositiveInteger(value, identifier) {
  if (!Number.isSafeInteger(value) || value <= 0) throw hostedIncomplete(identifier);
  return value;
}

function requireNonemptyString(value, identifier) {
  if (typeof value !== "string" || value.length === 0) throw hostedIncomplete(identifier);
  return value;
}

function requireNullableString(value, identifier) {
  if (value !== null && typeof value !== "string") throw hostedIncomplete(identifier);
  return value;
}

function parseJson(text, identifier) {
  if (typeof text !== "string") throw hostedIncomplete(identifier);
  try {
    return JSON.parse(text);
  } catch {
    throw hostedIncomplete(identifier);
  }
}

function parseJsonDocuments(text, identifier) {
  if (typeof text !== "string") throw hostedIncomplete(identifier);
  const documents = [];
  let index = 0;
  while (index < text.length) {
    while (index < text.length && /\s/.test(text[index])) index += 1;
    if (index === text.length) break;
    if (text[index] !== "[" && text[index] !== "{") throw hostedIncomplete(identifier);
    const start = index;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let complete = false;
    for (; index < text.length; index += 1) {
      const character = text[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') {
        inString = true;
        continue;
      }
      if (character === "[" || character === "{") depth += 1;
      else if (character === "]" || character === "}") depth -= 1;
      if (depth < 0) throw hostedIncomplete(identifier);
      if (depth === 0) {
        documents.push(parseJson(text.slice(start, index + 1), identifier));
        index += 1;
        complete = true;
        break;
      }
    }
    if (!complete || inString || escaped) throw hostedIncomplete(identifier);
  }
  if (documents.length === 0) throw hostedIncomplete(identifier);
  return documents;
}

function parseArrayPages(text, identifier) {
  const pages = parseJsonDocuments(text, identifier);
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) throw hostedIncomplete(identifier);
  return pages.flat();
}

function parseObjectPages(text, property, identifier) {
  const pages = parseJsonDocuments(text, identifier);
  if (!Array.isArray(pages)) throw hostedIncomplete(identifier);
  const records = [];
  let totalCount;
  for (const page of pages) {
    requireObject(page, identifier);
    if (!Array.isArray(page[property]) || !Number.isSafeInteger(page.total_count) || page.total_count < 0) {
      throw hostedIncomplete(identifier);
    }
    if (totalCount === undefined) totalCount = page.total_count;
    else if (totalCount !== page.total_count) throw hostedIncomplete(identifier);
    records.push(...page[property]);
  }
  if (pages.length === 0) throw hostedIncomplete(identifier);
  if (records.length !== totalCount) throw hostedIncomplete(identifier);
  return records;
}

function validateUnique(records, key, identifier, validateRecord) {
  const seen = new Set();
  for (const record of records) {
    requireObject(record, identifier);
    validateRecord(record, identifier);
    const value = record[key];
    if (seen.has(value)) throw hostedIncomplete(identifier);
    seen.add(value);
  }
}

function validateRepository(record, identifier) {
  requireObject(record, identifier);
  requireNonemptyString(record.full_name, identifier);
  requireNonemptyString(record.visibility, identifier);
  requireNonemptyString(record.default_branch, identifier);
  if (
    Object.hasOwn(record, GITHUB_REPOSITORY_TRANSPORT_CREDENTIAL_FIELD) &&
    record[GITHUB_REPOSITORY_TRANSPORT_CREDENTIAL_FIELD] !== null &&
    typeof record[GITHUB_REPOSITORY_TRANSPORT_CREDENTIAL_FIELD] !== "string"
  ) {
    throw hostedIncomplete("repository:metadata:temp-clone-token");
  }
}

function compareCanonicalStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function buildRepositoryFieldRecords(repositoryMetadata) {
  const entries = Object.entries(repositoryMetadata)
    .filter(([key]) => key !== GITHUB_REPOSITORY_TRANSPORT_CREDENTIAL_FIELD)
    .sort(([left], [right]) => compareCanonicalStrings(left, right));
  const unsafeKeys = entries
    .map(([key]) => key)
    .filter((key) => !/^[a-z][a-z0-9_]{0,63}$/.test(key) || sanitizeMetadata(key) !== key)
    .sort(compareCanonicalStrings);
  const unsafeRanks = new Map(unsafeKeys.map((key, index) => [key, index + 1]));

  return entries.map(([key, value]) => ({
    identifier: unsafeRanks.has(key)
      ? `repository:field:other:rank:${unsafeRanks.get(key)}`
      : `repository:field:${key}`,
    text: JSON.stringify({ [key]: value })
  }));
}

function validateBranch(record, identifier) {
  requireNonemptyString(record.name, identifier);
  const commit = requireObject(record.commit, identifier);
  if (typeof commit.sha !== "string" || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(commit.sha)) {
    throw hostedIncomplete(identifier);
  }
  if (typeof record.protected !== "boolean") throw hostedIncomplete(identifier);
}

function buildBranchIdentifiers(branches) {
  const byCommit = new Map();
  for (const branch of branches) {
    const group = byCommit.get(branch.commit.sha) ?? [];
    group.push(branch);
    byCommit.set(branch.commit.sha, group);
  }

  const identifiers = new Map();
  for (const [commitSha, group] of byCommit) {
    if (group.length === 1) {
      identifiers.set(group[0], `branch:commit:${commitSha}`);
      continue;
    }
    const canonicalGroup = [...group].sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0
    );
    canonicalGroup.forEach((branch, index) => {
      identifiers.set(branch, `branch:commit:${commitSha}:rank:${index + 1}`);
    });
  }
  return identifiers;
}

function validateIssue(record, identifier) {
  requirePositiveInteger(record.number, identifier);
  if (typeof record.title !== "string") throw hostedIncomplete(identifier);
  requireNullableString(record.body, identifier);
  requireNonemptyString(record.state, identifier);
  if (record.pull_request !== undefined) {
    const pullRequest = requireObject(record.pull_request, identifier);
    requireNonemptyString(pullRequest.url, identifier);
  }
}

function validateComment(record, identifier) {
  requirePositiveInteger(record.id, identifier);
  requireNullableString(record.body, identifier);
}

function validatePullRequest(record, identifier) {
  requirePositiveInteger(record.number, identifier);
  if (typeof record.title !== "string") throw hostedIncomplete(identifier);
  requireNullableString(record.body, identifier);
  requireNonemptyString(record.state, identifier);
}

function validateReview(record, identifier) {
  validateComment(record, identifier);
  requireNonemptyString(record.state, identifier);
}

function validateActionRun(record, identifier) {
  requirePositiveInteger(record.id, identifier);
  requireNonemptyString(record.name, identifier);
  requireNonemptyString(record.status, identifier);
}

function validateArtifact(record, identifier) {
  requirePositiveInteger(record.id, identifier);
  requireNonemptyString(record.name, identifier);
  if (typeof record.expired !== "boolean") throw hostedIncomplete(identifier);
  const workflowRun = requireObject(record.workflow_run, identifier);
  requirePositiveInteger(workflowRun.id, identifier);
}

async function writePrivateFile(filePath, bytes) {
  await writeFile(filePath, bytes, { mode: 0o600, flag: "wx" });
  await chmod(filePath, 0o600);
  const fileStat = await lstat(filePath);
  if (!fileStat.isFile() || fileStat.isSymbolicLink() || (fileStat.mode & 0o777) !== 0o600) {
    throw new Error("private-file-invariant");
  }
}

async function listArtifactMembers(artifactRoot, artifactId) {
  const root = path.resolve(artifactRoot);
  const rootStat = await lstat(root).catch(() => undefined);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) {
    throw hostedIncomplete(`artifact:${artifactId}:root`);
  }
  await chmod(root, 0o700);

  const members = [];
  let aggregateBytes = 0;
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => {
      throw hostedIncomplete(`artifact:${artifactId}:directory`);
    });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const memberIndex = members.length + 1;
      const absolutePath = path.resolve(directory, entry.name);
      const relativePath = path.relative(root, absolutePath).replaceAll("\\", "/");
      if (relativePath === "" || relativePath === ".." || relativePath.startsWith("../") || path.isAbsolute(relativePath)) {
        throw hostedIncomplete(`artifact:${artifactId}:member:${memberIndex}:path`);
      }
      const memberStat = await lstat(absolutePath).catch(() => undefined);
      if (!memberStat || memberStat.isSymbolicLink()) {
        throw hostedIncomplete(`artifact:${artifactId}:member:${memberIndex}:type`);
      }
      if (memberStat.isDirectory()) {
        await chmod(absolutePath, 0o700);
        await visit(absolutePath);
        continue;
      }
      if (!memberStat.isFile()) throw hostedIncomplete(`artifact:${artifactId}:member:${memberIndex}:type`);
      if (memberStat.size > MAX_ARTIFACT_MEMBER_BYTES) {
        throw hostedIncomplete(`artifact:${artifactId}:member:${memberIndex}:size-limit`);
      }
      aggregateBytes += memberStat.size;
      if (aggregateBytes > MAX_ARTIFACT_TOTAL_BYTES) {
        throw hostedIncomplete(`artifact:${artifactId}:aggregate-size-limit`);
      }
      await chmod(absolutePath, 0o600);
      const bytes = await readFile(absolutePath).catch(() => {
        throw hostedIncomplete(`artifact:${artifactId}:member:${memberIndex}:read`);
      });
      members.push({ relativePath, text: bytes.toString("utf8") });
    }
  }

  await visit(root);
  return members;
}

export async function collectHostedPublicationRecords({
  repository,
  runCommand = defaultRunCommand,
  tempRoot
}) {
  if (repository !== EXPECTED_REPOSITORY) throw hostedIncomplete("repository-identity");
  if (typeof tempRoot !== "string" || tempRoot.length === 0) throw hostedIncomplete("temporary-root");

  const privateRoot = path.resolve(tempRoot);
  await mkdir(privateRoot, { recursive: true, mode: 0o700 }).catch(() => {
    throw hostedIncomplete("temporary-root");
  });
  const rootStat = await lstat(privateRoot).catch(() => undefined);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) throw hostedIncomplete("temporary-root");
  await chmod(privateRoot, 0o700).catch(() => {
    throw hostedIncomplete("temporary-root");
  });

  let rawFileNumber = 0;
  const records = [];
  const hostedFileIdentifiers = new Map();
  const runHosted = async (args, identifier) => {
    let result;
    try {
      result = await runCommand("gh", args, { encoding: "utf8", maxBuffer: MAX_BLOB_BYTES + 1024 * 1024 });
    } catch {
      throw hostedIncomplete(identifier);
    }
    if (!result || typeof result.stdout !== "string") throw hostedIncomplete(identifier);
    return result.stdout;
  };
  const addHostedRecord = async ({ surface, identifier, text, path: recordPath }, safeIdentifier) => {
    rawFileNumber += 1;
    const rawName = `hosted-${rawFileNumber}.raw`;
    await writePrivateFile(path.join(privateRoot, rawName), text).catch(() => {
      throw hostedIncomplete("temporary-record");
    });
    hostedFileIdentifiers.set(rawName, safeIdentifier);
    records.push({ surface, identifier, ...(recordPath === undefined ? {} : { path: recordPath }), text });
  };
  const api = async (endpoint, identifier) =>
    await runHosted(["api", endpoint], identifier);
  const pagedApi = async (endpoint, identifier) =>
    await runHosted(["api", "--paginate", endpoint], identifier);

  const repositoryMetadata = requireObject(
    parseJson(await api(`repos/${repository}`, "repository:metadata"), "repository:metadata"),
    "repository:metadata"
  );
  validateRepository(repositoryMetadata, "repository:metadata");
  if (repositoryMetadata.full_name !== EXPECTED_REPOSITORY) throw hostedIncomplete("repository-identity");
  delete repositoryMetadata[GITHUB_REPOSITORY_TRANSPORT_CREDENTIAL_FIELD];
  for (const field of buildRepositoryFieldRecords(repositoryMetadata)) {
    await addHostedRecord(
      { surface: "repository", identifier: field.identifier, text: field.text },
      field.identifier
    );
  }

  const branches = parseArrayPages(
    await pagedApi(`repos/${repository}/branches?per_page=100`, "branches:request"),
    "branches:pagination"
  );
  validateUnique(branches, "name", "branches:pagination", validateBranch);
  const branchIdentifiers = buildBranchIdentifiers(branches);
  for (const branch of branches) {
    const identifier = branchIdentifiers.get(branch);
    await addHostedRecord({ surface: "branch", identifier, text: JSON.stringify(branch) }, identifier);
  }

  const issueResponses = parseArrayPages(
    await pagedApi(`repos/${repository}/issues?state=all&per_page=100`, "issues:request"),
    "issues:pagination"
  );
  validateUnique(issueResponses, "number", "issues:pagination", validateIssue);
  const issues = issueResponses.filter((issue) => issue.pull_request === undefined);
  for (const issue of issues) {
    const identifier = `issue:${issue.number}`;
    await addHostedRecord({ surface: "issue", identifier, text: JSON.stringify(issue) }, identifier);
  }

  const issueComments = parseArrayPages(
    await pagedApi(`repos/${repository}/issues/comments?per_page=100`, "issue-comments:request"),
    "issue-comments:pagination"
  );
  validateUnique(issueComments, "id", "issue-comments:pagination", validateComment);
  for (const comment of issueComments) {
    const identifier = `issue-comment:${comment.id}`;
    await addHostedRecord({ surface: "issue-comment", identifier, text: JSON.stringify(comment) }, identifier);
  }

  const pullRequests = parseArrayPages(
    await pagedApi(`repos/${repository}/pulls?state=all&per_page=100`, "pull-requests:request"),
    "pull-requests:pagination"
  );
  validateUnique(pullRequests, "number", "pull-requests:pagination", validatePullRequest);
  for (const pullRequest of pullRequests) {
    const identifier = `pull:${pullRequest.number}`;
    await addHostedRecord({ surface: "pull-request", identifier, text: JSON.stringify(pullRequest) }, identifier);
  }

  const reviewComments = parseArrayPages(
    await pagedApi(`repos/${repository}/pulls/comments?per_page=100`, "review-comments:request"),
    "review-comments:pagination"
  );
  validateUnique(reviewComments, "id", "review-comments:pagination", validateComment);
  for (const comment of reviewComments) {
    const identifier = `review-comment:${comment.id}`;
    await addHostedRecord({ surface: "review-comment", identifier, text: JSON.stringify(comment) }, identifier);
  }

  const reviews = [];
  for (const [pullIndex, pullRequest] of pullRequests.entries()) {
    const pullNumber = requirePositiveInteger(pullRequest.number, "pull-requests:pagination");
    const pullReviews = parseArrayPages(
      await pagedApi(
        `repos/${repository}/pulls/${pullNumber}/reviews?per_page=100`,
        `pull-request:${pullIndex + 1}:reviews:request`
      ),
      `pull-request:${pullIndex + 1}:reviews:pagination`
    );
    validateUnique(pullReviews, "id", `pull-request:${pullIndex + 1}:reviews:pagination`, validateReview);
    for (const review of pullReviews) {
      reviews.push(review);
      const identifier = `review:${review.id}`;
      await addHostedRecord({ surface: "review", identifier, text: JSON.stringify(review) }, identifier);
    }
  }

  const actionRuns = parseObjectPages(
    await pagedApi(`repos/${repository}/actions/runs?per_page=100`, "actions-runs:request"),
    "workflow_runs",
    "actions-runs:pagination"
  );
  validateUnique(actionRuns, "id", "actions-runs:pagination", validateActionRun);
  for (const run of actionRuns) {
    const identifier = `actions-run:${run.id}`;
    await addHostedRecord({ surface: "actions-run", identifier, text: JSON.stringify(run) }, identifier);
  }

  let actionLogs = 0;
  for (const [runIndex, run] of actionRuns.entries()) {
    const runId = requirePositiveInteger(run.id, "actions-runs:pagination");
    const log = await runHosted(
      ["run", "view", String(runId), "--repo", repository, "--log"],
      `actions-run:${runIndex + 1}:log`
    );
    actionLogs += 1;
    const identifier = `actions-log:run:${runId}`;
    await addHostedRecord({ surface: "actions-log", identifier, text: log }, identifier);
  }

  const artifacts = parseObjectPages(
    await pagedApi(`repos/${repository}/actions/artifacts?per_page=100`, "artifacts:request"),
    "artifacts",
    "artifacts:pagination"
  );
  const artifactIds = new Set();
  for (const [artifactIndex, artifact] of artifacts.entries()) {
    requireObject(artifact, "artifacts:pagination");
    const artifactId = requirePositiveInteger(artifact.id, "artifacts:pagination");
    if (artifactIds.has(artifactId)) throw hostedIncomplete("artifacts:pagination");
    artifactIds.add(artifactId);
    validateArtifact(artifact, `artifact:${artifactIndex + 1}:metadata`);
  }
  for (const [artifactIndex, artifact] of artifacts.entries()) {
    const artifactNumber = artifactIndex + 1;
    const artifactId = artifact.id;
    const runId = artifact.workflow_run.id;
    const artifactIdentifier = `artifact:${artifactId}`;
    await addHostedRecord(
      { surface: "artifact", identifier: artifactIdentifier, text: JSON.stringify(artifact) },
      artifactIdentifier
    );
    const artifactRoot = path.join(privateRoot, `artifact-${artifactNumber}`);
    await mkdir(artifactRoot, { mode: 0o700 });
    try {
      await runCommand(
        "gh",
        [
          "run",
          "download",
          String(runId),
          "--repo",
          repository,
          "--name",
          artifact.name,
          "--dir",
          artifactRoot
        ],
        { cwd: privateRoot, encoding: "utf8", maxBuffer: MAX_BLOB_BYTES + 1024 * 1024 }
      );
    } catch {
      throw hostedIncomplete(`artifact:${artifactId}:download`);
    }
    const members = await listArtifactMembers(artifactRoot, artifactId);
    if (members.length === 0) throw hostedIncomplete(`artifact:${artifactId}:members-empty`);
    members.forEach((member, memberIndex) => {
      const memberIdentifier = `artifact:${artifactId}:member:${memberIndex + 1}`;
      const relativePrivatePath = path.relative(privateRoot, path.join(artifactRoot, member.relativePath)).replaceAll("\\", "/");
      hostedFileIdentifiers.set(relativePrivatePath, memberIdentifier);
      records.push({
        surface: "artifact-member",
        identifier: memberIdentifier,
        path: member.relativePath,
        text: member.text
      });
    });
  }

  return {
    records,
    hostedFileIdentifiers,
    counts: {
      branches: branches.length,
      issues: issues.length,
      pullRequests: pullRequests.length,
      issueComments: issueComments.length,
      reviewComments: reviewComments.length,
      reviews: reviews.length,
      actionRuns: actionRuns.length,
      actionLogs,
      artifacts: artifacts.length
    }
  };
}

function gitleaksIncomplete(identifier) {
  return projectFinding({ code: "audit-incomplete", surface: "gitleaks", identifier });
}

function scannerExitCode(result) {
  if (Number.isSafeInteger(result?.exitCode)) return result.exitCode;
  if (Number.isSafeInteger(result?.code)) return result.code;
  return 0;
}

async function runScannerCommand(runCommand, command, args, options) {
  try {
    const result = await runCommand(command, args, options);
    return { ...result, exitCode: scannerExitCode(result) };
  } catch (error) {
    if (Number.isSafeInteger(error?.code)) return { exitCode: error.code };
    return { exitCode: "tool-failure" };
  }
}

function withinRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function isSafeHostedIdentifier(identifier) {
  return (
    typeof identifier === "string" &&
    /^(?:repository:field:(?:[a-z][a-z0-9_]{0,63}|other:rank:[1-9]\d*)|branch:commit:(?:[0-9a-f]{40}|[0-9a-f]{64})(?::rank:[1-9]\d*)?|issue:[1-9]\d*|pull:[1-9]\d*|issue-comment:[1-9]\d*|review-comment:[1-9]\d*|review:[1-9]\d*|actions-run:[1-9]\d*|actions-log:run:[1-9]\d*|artifact:[1-9]\d*(?::member:[1-9]\d*)?)$/.test(identifier)
  );
}

async function readGitleaksReport({ reportPath, scanRoot, kind, exitCode, hostedFileIdentifiers }) {
  const reportStat = await lstat(reportPath).catch(() => undefined);
  if (
    !reportStat ||
    !reportStat.isFile() ||
    reportStat.isSymbolicLink() ||
    (reportStat.mode & 0o777) !== 0o600 ||
    reportStat.size > MAX_BLOB_BYTES
  ) {
    return { findings: [gitleaksIncomplete(`${kind}:report`)], scannedRecords: 0 };
  }
  if (reportStat.size === 0) {
    return { findings: [gitleaksIncomplete(`${kind}:report`)], scannedRecords: 0 };
  }

  let decoded;
  try {
    const bytes = await readFile(reportPath);
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { findings: [gitleaksIncomplete(`${kind}:report`)], scannedRecords: 0 };
  }

  let parsed;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return { findings: [gitleaksIncomplete(`${kind}:report`)], scannedRecords: 0 };
  }
  if (!Array.isArray(parsed)) {
    return { findings: [gitleaksIncomplete(`${kind}:report`)], scannedRecords: 0 };
  }
  if (exitCode === 1 && parsed.length === 0) {
    return { findings: [gitleaksIncomplete(`${kind}:report`)], scannedRecords: 0 };
  }

  const findings = [];
  for (const [index, rawFinding] of parsed.entries()) {
    const metadataIdentifier = `${kind}:report-metadata:${index + 1}`;
    if (!rawFinding || typeof rawFinding !== "object" || Array.isArray(rawFinding)) {
      findings.push(gitleaksIncomplete(metadataIdentifier));
      continue;
    }
    const { RuleID, Commit, File, StartLine } = rawFinding;
    const validCommit = typeof Commit === "string" && (Commit === "" || /^[0-9a-f]{7,64}$/.test(Commit));
    if (
      typeof RuleID !== "string" ||
      RuleID.length === 0 ||
      typeof File !== "string" ||
      File.length === 0 ||
      !validCommit ||
      !Number.isSafeInteger(StartLine) ||
      StartLine <= 0
    ) {
      findings.push(gitleaksIncomplete(metadataIdentifier));
      continue;
    }

    const resolvedFile = path.resolve(scanRoot, File);
    if (!withinRoot(scanRoot, resolvedFile)) {
      findings.push(gitleaksIncomplete(metadataIdentifier));
      continue;
    }
    let identifier;
    if (kind === "dir") {
      const relativeFile = path.relative(scanRoot, resolvedFile).replaceAll("\\", "/");
      const mappedIdentifier = hostedFileIdentifiers.get(relativeFile);
      if (!isSafeHostedIdentifier(mappedIdentifier)) {
        findings.push(gitleaksIncomplete(metadataIdentifier));
        continue;
      }
      identifier = `${mappedIdentifier}:line:${StartLine}`;
    } else {
      const commitPart = Commit === "" ? "" : `:commit:${Commit}`;
      identifier = `${kind}:finding:${index + 1}${commitPart}:line:${StartLine}`;
    }
    findings.push(
      projectFinding({
        severity: "error",
        code: "credential-pattern",
        surface: "gitleaks",
        identifier
      })
    );
  }
  return { findings, scannedRecords: parsed.length };
}

export async function runGitleaks({
  binary,
  root,
  hostedRoot,
  hostedFileIdentifiers = new Map(),
  runCommand = defaultRunCommand
}) {
  const repositoryRoot = path.resolve(root);
  const privateHostedRoot = path.resolve(hostedRoot);
  if (!(hostedFileIdentifiers instanceof Map)) {
    return {
      schemaVersion: 1,
      ok: false,
      scannedRecords: 0,
      findings: [gitleaksIncomplete("dir:file-map")]
    };
  }
  const reportRoot = await mkdtemp(path.join(os.tmpdir(), "inner-signal-gitleaks-reports-"));
  await chmod(reportRoot, 0o700);

  const targets = [
    { kind: "git", scanRoot: repositoryRoot, reportPath: path.join(reportRoot, "git.json") },
    { kind: "dir", scanRoot: privateHostedRoot, reportPath: path.join(reportRoot, "hosted.json") }
  ];
  const findings = [];
  let scannedRecords = 0;

  try {
    for (const target of targets) await writePrivateFile(target.reportPath, "");
    for (const target of targets) {
      const args =
        target.kind === "git"
          ? [
              "git",
              repositoryRoot,
              `--config=${path.join(repositoryRoot, ".gitleaks.toml")}`,
              "--log-opts=--all",
              "--redact=100",
              "--no-banner",
              "--report-format=json",
              `--report-path=${target.reportPath}`
            ]
          : [
              "dir",
              privateHostedRoot,
              `--config=${path.join(repositoryRoot, ".gitleaks.toml")}`,
              "--redact=100",
              "--no-banner",
              "--report-format=json",
              `--report-path=${target.reportPath}`
            ];
      const commandResult = await runScannerCommand(runCommand, binary, args, {
        cwd: repositoryRoot,
        encoding: null,
        maxBuffer: MAX_BLOB_BYTES + 1024 * 1024
      });
      const exitCode = commandResult.exitCode;
      if (exitCode !== 0 && exitCode !== 1) {
        findings.push(gitleaksIncomplete(`${target.kind}:exit:${exitCode}`));
      }
      const normalized = await readGitleaksReport({
        reportPath: target.reportPath,
        scanRoot: target.scanRoot,
        kind: target.kind,
        exitCode,
        hostedFileIdentifiers
      });
      findings.push(...normalized.findings);
      scannedRecords += normalized.scannedRecords;
    }
  } finally {
    await rm(reportRoot, { recursive: true, force: true });
  }

  findings.sort((left, right) =>
    `${left.surface}:${left.identifier}:${left.code}`.localeCompare(`${right.surface}:${right.identifier}:${right.code}`)
  );
  return { schemaVersion: 1, ok: findings.length === 0, scannedRecords, findings };
}

export async function auditGitPublication({ root, runCommand = defaultRunCommand }) {
  const repositoryRoot = path.resolve(root);
  const refsResult = await runGit(runCommand, repositoryRoot, [
    "for-each-ref",
    "--format=%(refname)",
    "refs/heads",
    "refs/remotes",
    "refs/tags"
  ]);
  const refs = refsResult.stdout.split("\n").filter(Boolean);
  const objectsResult = await runGit(runCommand, repositoryRoot, ["rev-list", "--objects", "--all"]);
  const objectListing = parseObjectListing(objectsResult.stdout);
  const objects = objectListing.objects;
  const objectTypes = new Map();
  const incomplete = objectListing.malformedRecordNumbers.map((recordNumber) =>
    incompleteFinding(`rev-list:record:${recordNumber}`)
  );

  for (const objectId of objects.keys()) {
    try {
      const typeResult = await runGit(runCommand, repositoryRoot, ["cat-file", "-t", objectId]);
      const match = /^(blob|tree|commit|tag)\n$/.exec(typeResult.stdout);
      if (!match) throw new Error("invalid object type response");
      objectTypes.set(objectId, match[1]);
    } catch {
      incomplete.push(incompleteFinding(`object:${objectId}:type`));
    }
  }

  const commitIds = [...objectTypes]
    .filter(([, type]) => type === "commit")
    .map(([objectId]) => objectId);
  const blobIds = [...objectTypes]
    .filter(([, type]) => type === "blob")
    .map(([objectId]) => objectId);
  const occurrences = new Map(blobIds.map((objectId) => [objectId, new Map()]));

  for (const commitId of commitIds) {
    try {
      const treeResult = await runGit(runCommand, repositoryRoot, ["ls-tree", "-r", "-z", "--full-tree", commitId]);
      const tree = parseTree(treeResult.stdout);
      for (const recordNumber of tree.malformedRecordNumbers) {
        incomplete.push(incompleteFinding(`commit:${commitId}:tree-record:${recordNumber}`));
      }
      for (const entry of tree.entries) {
        if (!occurrences.has(entry.objectId)) continue;
        const repositoryPath = normalizeTrackedPath(entry.path);
        occurrences.get(entry.objectId).set(`${commitId}:${repositoryPath}`, repositoryPath);
      }
    } catch {
      incomplete.push(incompleteFinding(`commit:${commitId}:tree`));
    }
  }

  const records = [];
  for (const objectId of blobIds) {
    let size;
    try {
      const sizeResult = await runGit(runCommand, repositoryRoot, ["cat-file", "-s", objectId]);
      const match = /^(0|[1-9][0-9]*)\n$/.exec(sizeResult.stdout);
      if (!match) throw new Error("invalid blob size response");
      size = Number(match[1]);
      if (!Number.isSafeInteger(size) || size < 0) throw new Error("invalid blob size");
    } catch {
      incomplete.push(incompleteFinding(`blob:${objectId}:size`));
      continue;
    }
    if (size > MAX_BLOB_BYTES) {
      incomplete.push(incompleteFinding(`blob:${objectId}:size-limit`));
      continue;
    }

    let blobBytes;
    try {
      const blobResult = await runGit(runCommand, repositoryRoot, ["cat-file", "blob", objectId], { encoding: null });
      if (Buffer.isBuffer(blobResult.stdout)) blobBytes = blobResult.stdout;
      else if (typeof blobResult.stdout === "string") blobBytes = Buffer.from(blobResult.stdout, "utf8");
      else throw new Error("invalid blob response");
    } catch {
      incomplete.push(incompleteFinding(`blob:${objectId}:read`));
      continue;
    }
    if (blobBytes.length !== size) {
      incomplete.push(incompleteFinding(`blob:${objectId}:size-mismatch`));
      continue;
    }
    const text = blobBytes.toString("utf8");

    const blobOccurrences = occurrences.get(objectId);
    if (blobOccurrences.size === 0) {
      const repositoryPath = normalizeTrackedPath(objects.get(objectId) ?? "unmapped");
      records.push({ surface: "git", identifier: `blob:${objectId}:${repositoryPath}`, path: repositoryPath, text });
      continue;
    }
    for (const [identifier, repositoryPath] of blobOccurrences) {
      records.push({ surface: "git", identifier, path: repositoryPath, text });
    }
  }

  const scanned = scanPublicationRecords(records);
  const result = mergePublicationResults(scanned, {
    schemaVersion: 1,
    ok: incomplete.length === 0,
    scannedRecords: 0,
    findings: incomplete
  });

  return {
    ...result,
    counts: {
      refs: refs.length,
      commits: commitIds.length,
      objects: objects.size,
      blobs: blobIds.length
    }
  };
}
