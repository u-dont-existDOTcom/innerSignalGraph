#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const FULL_SHA = /^[0-9a-fA-F]{40}$/;
const BLOCK_SCALAR = /^[>|](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?\s*(?:#.*)?$/;

function physicalKey(line) {
  const match = /^( *)(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))\s*:\s*(.*?)\s*$/.exec(line);
  if (!match) return null;
  return {
    indent: match[1].length,
    key: match[2] ?? match[3] ?? match[4],
    value: match[5]
  };
}

function scalarValue(value) {
  const withoutComment = value.replace(/\s+#.*$/, "").trim();
  if (
    withoutComment.length >= 2 &&
    ((withoutComment.startsWith('"') && withoutComment.endsWith('"')) ||
      (withoutComment.startsWith("'") && withoutComment.endsWith("'")))
  ) {
    return withoutComment.slice(1, -1);
  }
  return withoutComment;
}

function eventScalarIncludes(value, eventName) {
  const scalar = scalarValue(value);
  if (scalar.startsWith("{") && scalar.endsWith("}")) {
    const keys = [];
    let depth = 0;
    let quote = null;
    let escaped = false;
    let entryStart = 1;
    let expectingKey = true;
    for (let index = 0; index < scalar.length; index += 1) {
      const character = scalar[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === quote) quote = null;
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
        continue;
      }
      if (character === "{" || character === "[") depth += 1;
      else if (character === "}" || character === "]") depth -= 1;
      else if (character === ":" && depth === 1 && expectingKey) {
        keys.push(scalarValue(scalar.slice(entryStart, index)));
        expectingKey = false;
      } else if (character === "," && depth === 1) {
        entryStart = index + 1;
        expectingKey = true;
      }
    }
    return keys.includes(eventName);
  }
  const normalized = scalar.replace(/^\[|\]$/g, "");
  return normalized
    .split(",")
    .map((item) => scalarValue(item))
    .some((item) => item === eventName);
}

function actionReference(line) {
  const match = /^\s*(?:-\s*)?uses\s*:\s*(.*?)\s*$/.exec(line);
  if (!match) return null;
  return scalarValue(match[1]);
}

export function auditWorkflowText(text, relativePath) {
  const findings = [];
  let blockIndent = null;
  let onIndent = null;
  let hasTopLevelPermissions = false;
  let hasPullRequestTarget = false;
  let hasCheckout = false;

  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const indent = line.match(/^ */)[0].length;
    const trimmed = line.trim();
    if (blockIndent !== null) {
      if (trimmed === "" || indent > blockIndent) continue;
      blockIndent = null;
    }
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    const parsed = physicalKey(line);
    if (onIndent !== null && indent <= onIndent && !(parsed?.indent === 0 && parsed.key === "on")) {
      onIndent = null;
    }

    if (parsed?.indent === 0 && parsed.key === "permissions") {
      hasTopLevelPermissions = true;
    }
    if (parsed?.key === "permissions" && scalarValue(parsed.value) === "write-all") {
      findings.push({
        code: "permissions-write-all",
        path: relativePath,
        line: index + 1,
        message: "permissions: write-all is forbidden"
      });
    }

    if (parsed?.indent === 0 && parsed.key === "on") {
      if (scalarValue(parsed.value) === "") onIndent = 0;
      else if (eventScalarIncludes(parsed.value, "pull_request_target")) hasPullRequestTarget = true;
    } else if (onIndent !== null && parsed && parsed.indent > onIndent && parsed.key === "pull_request_target") {
      hasPullRequestTarget = true;
    }

    const reference = actionReference(line);
    if (reference) {
      if (reference.startsWith("actions/checkout@")) hasCheckout = true;
      if (!reference.startsWith("./") && !reference.startsWith("docker://")) {
        const separator = reference.lastIndexOf("@");
        const action = separator > 0 ? reference.slice(0, separator) : reference;
        const ref = separator > 0 ? reference.slice(separator + 1) : "";
        if (!FULL_SHA.test(ref)) {
          findings.push({
            code: "action-ref-unpinned",
            path: relativePath,
            line: index + 1,
            message: `remote dependency ${action} is not pinned to a full commit SHA`
          });
        }
      }
    }

    if (parsed && BLOCK_SCALAR.test(parsed.value)) blockIndent = parsed.indent;
  }

  if (!hasTopLevelPermissions) {
    findings.push({
      code: "permissions-missing",
      path: relativePath,
      line: 1,
      message: "workflow is missing explicit top-level permissions"
    });
  }
  if (hasPullRequestTarget && hasCheckout) {
    findings.push({
      code: "pull-request-target-checkout",
      path: relativePath,
      line: 1,
      message: "pull_request_target must not check out or execute untrusted pull-request code"
    });
  }
  return findings;
}

export function auditWorkflows(root = process.cwd()) {
  const resolvedRoot = path.resolve(root);
  const workflowRoot = path.join(resolvedRoot, ".github", "workflows");
  const checked = [];
  const findings = [];
  if (!fs.existsSync(workflowRoot)) {
    findings.push({
      code: "workflows-missing",
      path: ".github/workflows",
      line: 1,
      message: "workflow directory is missing"
    });
  } else {
    for (const name of fs.readdirSync(workflowRoot).filter((item) => /\.ya?ml$/i.test(item)).sort()) {
      const absolute = path.join(workflowRoot, name);
      if (!fs.statSync(absolute).isFile()) continue;
      const relative = path.relative(resolvedRoot, absolute).split(path.sep).join("/");
      checked.push(relative);
      findings.push(...auditWorkflowText(fs.readFileSync(absolute, "utf8"), relative));
    }
  }
  findings.sort((left, right) =>
    left.path.localeCompare(right.path) || left.line - right.line || left.code.localeCompare(right.code)
  );
  return { schemaVersion: 1, ok: findings.length === 0, checked, findings };
}

function parseRoot(argv) {
  if (argv.length === 0) return process.cwd();
  if (argv.length === 2 && argv[0] === "--root" && argv[1]) return argv[1];
  throw new Error("Usage: node scripts/audit-workflows.mjs [--root <repository-root>]");
}

function main() {
  try {
    const result = auditWorkflows(parseRoot(process.argv.slice(2)));
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
