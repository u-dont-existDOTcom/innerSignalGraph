#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isAlias, isMap, isScalar, isSeq, LineCounter, parseDocument } from "yaml";
import { withOpenedRegularFileSync } from "../src/core/opened-regular-file.mjs";

const FULL_SHA = /^[0-9a-fA-F]{40}$/;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function resolveNode(node, document) {
  let resolved = node;
  const seen = new Set();
  while (isAlias(resolved)) {
    if (seen.has(resolved)) return null;
    seen.add(resolved);
    resolved = resolved.resolve(document);
  }
  return resolved ?? null;
}

function mapPair(node, key, document) {
  if (!isMap(node)) return null;
  return node.items.find((pair) => {
    const resolvedKey = resolveNode(pair.key, document);
    return isScalar(resolvedKey) && String(resolvedKey.value) === key;
  }) ?? null;
}

function mapValueNode(node, key, document) {
  return mapPair(node, key, document)?.value ?? null;
}

function sourceLine(node, lineCounter, fallback = 1) {
  const offset = Array.isArray(node?.range) ? node.range[0] : null;
  return Number.isInteger(offset) ? lineCounter.linePos(offset).line : fallback;
}

function eventIncludes(value, eventName) {
  if (typeof value === "string") return value === eventName;
  if (Array.isArray(value)) return value.some((event) => event === eventName);
  return isObject(value) && Object.hasOwn(value, eventName);
}

function flowFinding(code, relativePath, line, message) {
  return { code, path: relativePath, line, message };
}

function structureFinding(relativePath, line, message) {
  return { code: "workflow-structure-invalid", path: relativePath, line, message };
}

export function auditWorkflowText(text, relativePath) {
  const findings = [];
  const lineCounter = new LineCounter();
  const document = parseDocument(text, {
    lineCounter,
    strict: true,
    uniqueKeys: true
  });

  if (document.errors.length > 0) {
    for (const error of document.errors) {
      const offset = Array.isArray(error.pos) ? error.pos[0] : 0;
      findings.push({
        code: "yaml-invalid",
        path: relativePath,
        line: lineCounter.linePos(offset).line || 1,
        message: error.message.split("\n", 1)[0]
      });
    }
    return findings;
  }

  let workflow;
  try {
    workflow = document.toJS({ maxAliasCount: 100 });
  } catch (error) {
    return [{ code: "yaml-invalid", path: relativePath, line: 1, message: error.message }];
  }
  if (!isObject(workflow) || !isMap(document.contents)) {
    return [structureFinding(relativePath, 1, "workflow root must be a mapping")];
  }

  const rootNode = document.contents;
  const permissionsNode = mapValueNode(rootNode, "permissions", document);
  if (!Object.hasOwn(workflow, "permissions")) {
    findings.push({
      code: "permissions-missing",
      path: relativePath,
      line: 1,
      message: "workflow is missing explicit top-level permissions"
    });
  } else if (workflow.permissions === "write-all") {
    findings.push({
      code: "permissions-write-all",
      path: relativePath,
      line: sourceLine(permissionsNode, lineCounter),
      message: "permissions: write-all is forbidden"
    });
  }

  const hasPullRequestTarget = eventIncludes(workflow.on, "pull_request_target");
  const jobs = workflow.jobs;
  const jobsNode = mapValueNode(rootNode, "jobs", document);
  const resolvedJobsNode = resolveNode(jobsNode, document);
  let hasCheckout = false;

  if (!isObject(jobs)) {
    findings.push(structureFinding(relativePath, sourceLine(jobsNode, lineCounter), "workflow jobs must be a mapping"));
    return findings;
  }
  if (isMap(resolvedJobsNode) && resolvedJobsNode.flow) {
    findings.push(flowFinding(
      "flow-jobs-unsupported",
      relativePath,
      sourceLine(jobsNode, lineCounter),
      "workflow jobs must use block mapping syntax so Action references can be audited"
    ));
  }

  function auditReference(rawReference, line) {
    if (typeof rawReference !== "string" || rawReference.trim() === "") {
      findings.push({
        code: "action-reference-invalid",
        path: relativePath,
        line,
        message: "Action and reusable-workflow uses values must resolve to a non-empty string"
      });
      return;
    }
    const reference = rawReference.trim();
    if (reference.toLowerCase().startsWith("actions/checkout@")) hasCheckout = true;
    if (reference.startsWith("./") || reference.startsWith("docker://")) return;
    const separator = reference.lastIndexOf("@");
    const action = separator > 0 ? reference.slice(0, separator) : reference;
    const ref = separator > 0 ? reference.slice(separator + 1) : "";
    if (!FULL_SHA.test(ref)) {
      findings.push({
        code: "action-ref-unpinned",
        path: relativePath,
        line,
        message: `remote dependency ${action} is not pinned to a full commit SHA`
      });
    }
  }

  for (const [jobId, job] of Object.entries(jobs)) {
    const jobNode = mapValueNode(resolvedJobsNode, jobId, document);
    const resolvedJobNode = resolveNode(jobNode, document);
    const jobLine = sourceLine(jobNode, lineCounter);
    if (!isObject(job)) {
      findings.push(structureFinding(relativePath, jobLine, `job ${jobId} must be a mapping`));
      continue;
    }
    if (isMap(resolvedJobNode) && resolvedJobNode.flow) {
      findings.push(flowFinding(
        "flow-jobs-unsupported",
        relativePath,
        jobLine,
        "individual jobs must use block mapping syntax so Action references can be audited"
      ));
    }
    if (job.permissions === "write-all") {
      findings.push({
        code: "permissions-write-all",
        path: relativePath,
        line: sourceLine(mapValueNode(resolvedJobNode, "permissions", document), lineCounter, jobLine),
        message: "permissions: write-all is forbidden"
      });
    }

    if (Object.hasOwn(job, "uses")) {
      const usesLine = sourceLine(mapValueNode(resolvedJobNode, "uses", document), lineCounter, jobLine);
      auditReference(job.uses, usesLine);
      if (hasPullRequestTarget) {
        findings.push({
          code: "pull-request-target-reusable-workflow",
          path: relativePath,
          line: usesLine,
          message: "pull_request_target must not delegate execution to a reusable workflow"
        });
      }
    }
    if (!Object.hasOwn(job, "steps")) continue;

    const stepsNode = mapValueNode(resolvedJobNode, "steps", document);
    const resolvedStepsNode = resolveNode(stepsNode, document);
    if (!Array.isArray(job.steps)) {
      findings.push(structureFinding(relativePath, sourceLine(stepsNode, lineCounter, jobLine), `job ${jobId} steps must be a sequence`));
      continue;
    }
    if (isSeq(resolvedStepsNode)) {
      const flowNode = resolvedStepsNode.flow
        ? stepsNode
        : resolvedStepsNode.items.find((item) => resolveNode(item, document)?.flow);
      if (flowNode) {
        findings.push(flowFinding(
          "flow-steps-unsupported",
          relativePath,
          sourceLine(flowNode, lineCounter, jobLine),
          "workflow steps must use block sequence and mapping syntax so Action references can be audited"
        ));
      }
    }

    for (const [stepIndex, step] of job.steps.entries()) {
      const stepNode = isSeq(resolvedStepsNode) ? resolvedStepsNode.items[stepIndex] : null;
      const resolvedStepNode = resolveNode(stepNode, document);
      const stepLine = sourceLine(stepNode, lineCounter, jobLine);
      if (!isObject(step)) {
        findings.push(structureFinding(relativePath, stepLine, `job ${jobId} step ${stepIndex + 1} must be a mapping`));
        continue;
      }
      if (Object.hasOwn(step, "uses")) {
        auditReference(step.uses, sourceLine(mapValueNode(resolvedStepNode, "uses", document), lineCounter, stepLine));
      }
    }
  }

  if (hasPullRequestTarget && hasCheckout) {
    findings.push({
      code: "pull-request-target-checkout",
      path: relativePath,
      line: sourceLine(mapValueNode(rootNode, "on", document), lineCounter),
      message: "pull_request_target must not check out or execute untrusted pull-request code"
    });
  }
  return findings;
}

export function auditWorkflows(root = process.cwd()) {
  const resolvedRoot = path.resolve(root);
  const metadataRoot = path.join(resolvedRoot, ".github");
  const workflowRoot = path.join(metadataRoot, "workflows");
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
    const metadataRootStat = fs.lstatSync(metadataRoot);
    const workflowRootStat = fs.lstatSync(workflowRoot);
    if (
      !metadataRootStat.isDirectory()
      || metadataRootStat.isSymbolicLink()
      || !workflowRootStat.isDirectory()
      || workflowRootStat.isSymbolicLink()
    ) {
      findings.push({
        code: "workflow-directory-unsafe",
        path: ".github/workflows",
        line: 1,
        message: "workflow directory must be a real directory inside the repository"
      });
    } else {
      for (const name of fs.readdirSync(workflowRoot).filter((item) => /\.ya?ml$/i.test(item)).sort()) {
        const absolute = path.join(workflowRoot, name);
        const relative = path.relative(resolvedRoot, absolute).split(path.sep).join("/");
        let source;
        try {
          source = withOpenedRegularFileSync(absolute, (descriptor) => fs.readFileSync(descriptor, "utf8"));
        } catch {
          findings.push({
            code: "workflow-file-unsafe",
            path: relative,
            line: 1,
            message: "workflow entry must be a readable regular file inside the workflow directory"
          });
          continue;
        }
        checked.push(relative);
        findings.push(...auditWorkflowText(source, relative));
      }
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
