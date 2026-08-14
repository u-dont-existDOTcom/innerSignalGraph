import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_BLOB_BYTES = 20 * 1024 * 1024;

const CONTENT_RULES = Object.freeze([
  Object.freeze(["credential-pattern", /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/]),
  Object.freeze(["credential-pattern", /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/]),
  Object.freeze(["credential-pattern", /\bsk-ant-[A-Za-z0-9_-]{20,}\b/]),
  Object.freeze(["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/])
]);

const SECRET_FILE_PATTERN = /(^|\/)\.env$/;
const PRIVATE_FILE_PATTERN = /(^|\/)(Cookies|Login Data|id_rsa|\.netrc|\.npmrc)$/;
const PRIVATE_SESSION_PATTERN = /(^|\/)(private-)?therapy-session-transcript\.(txt|json|md)$/i;

export function scanPublicationRecords(records) {
  const findings = [];

  for (const record of records) {
    for (const [code, pattern] of CONTENT_RULES) {
      if (pattern.test(record.text)) {
        findings.push({ severity: "error", code, surface: record.surface, identifier: record.identifier });
      }
    }

    const normalized = (record.path ?? "").replaceAll("\\", "/");
    if (SECRET_FILE_PATTERN.test(normalized)) {
      findings.push({ severity: "error", code: "secret-file", surface: record.surface, identifier: record.identifier });
    }
    if (PRIVATE_FILE_PATTERN.test(normalized)) {
      findings.push({ severity: "error", code: "private-file", surface: record.surface, identifier: record.identifier });
    }
    if (PRIVATE_SESSION_PATTERN.test(normalized)) {
      findings.push({ severity: "error", code: "private-session-material", surface: record.surface, identifier: record.identifier });
    }
  }

  findings.sort((left, right) =>
    `${left.surface}:${left.identifier}:${left.code}`.localeCompare(`${right.surface}:${right.identifier}:${right.code}`)
  );

  return { schemaVersion: 1, ok: findings.length === 0, scannedRecords: records.length, findings };
}

export function mergePublicationResults(...results) {
  const findings = results.flatMap((result) =>
    result.findings.map(({ severity, code, surface, identifier }) => ({ severity, code, surface, identifier }))
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

async function runGit(runCommand, root, args) {
  return await runCommand("git", args, { cwd: root });
}

async function defaultRunCommand(command, args, options = {}) {
  return await execFileAsync(command, args, {
    ...options,
    encoding: "utf8",
    maxBuffer: MAX_BLOB_BYTES + 1024 * 1024
  });
}

function parseObjectListing(output) {
  const objects = new Map();
  for (const line of output.split("\n")) {
    if (line.length === 0) continue;
    const separator = line.indexOf(" ");
    const objectId = separator === -1 ? line : line.slice(0, separator);
    const objectPath = separator === -1 ? undefined : line.slice(separator + 1);
    if (/^[0-9a-f]{40,64}$/.test(objectId) && !objects.has(objectId)) objects.set(objectId, objectPath);
  }
  return objects;
}

function parseTree(output) {
  const entries = [];
  for (const item of output.split("\0")) {
    if (item.length === 0) continue;
    const match = /^[0-7]+\s+blob\s+([0-9a-f]{40,64})\t([\s\S]+)$/.exec(item);
    if (match) entries.push({ objectId: match[1], path: match[2] });
  }
  return entries;
}

function safePath(value) {
  return value.replaceAll("\\", "/").replace(/[\u0000-\u001f\u007f]/g, "?").slice(0, 400);
}

function incompleteFinding(identifier) {
  return { severity: "error", code: "audit-incomplete", surface: "git", identifier };
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
  const objects = parseObjectListing(objectsResult.stdout);
  const objectTypes = new Map();
  const incomplete = [];

  for (const objectId of objects.keys()) {
    try {
      const typeResult = await runGit(runCommand, repositoryRoot, ["cat-file", "-t", objectId]);
      objectTypes.set(objectId, typeResult.stdout.trim());
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
      for (const entry of parseTree(treeResult.stdout)) {
        if (!occurrences.has(entry.objectId)) continue;
        const repositoryPath = safePath(entry.path);
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
      size = Number.parseInt(sizeResult.stdout.trim(), 10);
      if (!Number.isSafeInteger(size) || size < 0) throw new Error("invalid blob size");
    } catch {
      incomplete.push(incompleteFinding(`blob:${objectId}:size`));
      continue;
    }
    if (size > MAX_BLOB_BYTES) {
      incomplete.push(incompleteFinding(`blob:${objectId}:size-limit`));
      continue;
    }

    let text;
    try {
      const blobResult = await runGit(runCommand, repositoryRoot, ["cat-file", "blob", objectId]);
      text = blobResult.stdout;
    } catch {
      incomplete.push(incompleteFinding(`blob:${objectId}:read`));
      continue;
    }

    const blobOccurrences = occurrences.get(objectId);
    if (blobOccurrences.size === 0) {
      const repositoryPath = safePath(objects.get(objectId) ?? "unmapped");
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
