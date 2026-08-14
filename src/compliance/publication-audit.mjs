import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_BLOB_BYTES = 20 * 1024 * 1024;
const MAX_PROJECTED_METADATA_CHARACTERS = 400;
const REDACTED = "[REDACTED]";

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
