const COUNT_KEYS = new Set(["tests", "suites", "pass", "fail", "cancelled", "skipped", "todo"]);
const TEST_FILE = /^tests\/[A-Za-z0-9._/-]+\.(?:test|spec)\.(?:mjs|cjs|js|ts)$/;
const ERROR_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const HASH = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const VERSION = /^v?\d+(?:\.\d+){1,3}(?:-[A-Za-z0-9.-]+)?$/;
const NUMBER = /^-?\d+(?:\.\d+)?$/;

function safeScalar(value) {
  const candidate = String(value ?? "").trim().replace(/^['"]|['"]$/g, "");
  if (HASH.test(candidate) || VERSION.test(candidate) || NUMBER.test(candidate)) return candidate;
  if (["true", "false", "null", "undefined"].includes(candidate)) return candidate;
  return null;
}

function normalizeTestFile(value, projectRoot) {
  let candidate = String(value ?? "").trim().replace(/^file:\/\//, "");
  try {
    candidate = decodeURIComponent(candidate);
  } catch {
    return null;
  }
  const root = String(projectRoot ?? "").replace(/\/+$/, "");
  if (root && candidate.startsWith(`${root}/`)) candidate = candidate.slice(root.length + 1);
  candidate = candidate.replaceAll("\\", "/");
  if (candidate.includes("..") || !TEST_FILE.test(candidate)) return null;
  return candidate;
}

function safeTestName(value) {
  const candidate = String(value ?? "").replace(/\s+\(\d+(?:\.\d+)?ms\)\s*$/, "").trim();
  if (!candidate || candidate === "failing tests:" || candidate.length > 240) return null;
  if (/\b(?:sk-[A-Za-z0-9_-]{8,}|PRIVATE_|\/home\/|therapy\.json)\b/i.test(candidate)) return null;
  return candidate.replace(/[\u0000-\u001f\u007f]/g, "");
}

function parseCounts(lines) {
  const counts = {};
  for (const line of lines) {
    const match = line.trim().match(/^(?:ℹ|#)\s*(tests|suites|pass|fail|cancelled|skipped|todo)\s+(\d+)$/i);
    if (!match) continue;
    const key = match[1].toLowerCase();
    if (COUNT_KEYS.has(key)) counts[key] = Number.parseInt(match[2], 10);
  }
  return counts;
}

function parseFailures(lines, projectRoot) {
  const failures = [];
  let pendingLocation = null;
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const locationMatch = line.match(/^test at (.+):(\d+):(\d+)$/);
    if (locationMatch) {
      const file = normalizeTestFile(locationMatch[1], projectRoot);
      pendingLocation = file ? {
        file,
        line: Number.parseInt(locationMatch[2], 10),
        column: Number.parseInt(locationMatch[3], 10)
      } : null;
      continue;
    }

    const failureMatch = line.match(/^(?:✖\s+|not ok \d+\s+-\s+)(.+)$/);
    if (failureMatch) {
      const name = safeTestName(failureMatch[1]);
      if (!name) continue;
      current = { name, ...(pendingLocation ? { location: pendingLocation } : {}) };
      failures.push(current);
      pendingLocation = null;
      continue;
    }

    if (!current) continue;
    const errorMatch = line.match(/^[A-Za-z]+Error\s+\[([A-Z][A-Z0-9_]+)\]/);
    if (errorMatch && ERROR_CODE.test(errorMatch[1])) {
      current.errorCode = errorMatch[1];
      continue;
    }
    const valueMatch = line.match(/^(actual|expected):\s*(.+)$/i);
    if (valueMatch) {
      const value = safeScalar(valueMatch[2]);
      if (value != null) current[valueMatch[1].toLowerCase()] = value;
    }
  }

  return failures.slice(0, 20);
}

export function summarizeTestFailure({ command, exitCode, stdout = "", stderr = "", projectRoot = "" }) {
  const lines = `${stdout}\n${stderr}`.split(/\r?\n/);
  return {
    format: "inner-signal-test-failure-v1",
    command: command === "npm test" ? command : "package tests",
    exitCode: Number.isInteger(exitCode) ? exitCode : null,
    counts: parseCounts(lines),
    failures: parseFailures(lines, projectRoot)
  };
}
