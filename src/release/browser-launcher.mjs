import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const DISCOVERY_CANDIDATES = Object.freeze([
  { name: "brave-browser", kind: "browser" },
  { name: "brave", kind: "browser" },
  { name: "google-chrome", kind: "browser" },
  { name: "google-chrome-stable", kind: "browser" },
  { name: "chromium", kind: "browser" },
  { name: "chromium-browser", kind: "browser" },
  { name: "firefox", kind: "browser" },
  { name: "xdg-open", kind: "opener" },
  { name: "gio", kind: "gio-opener" }
]);

const UNSAFE_EXECUTABLE = /[\s;&|`$<>(){}\[\]!*?]/;

function launcherKind(executable) {
  const name = path.basename(executable);
  if (name === "gio") return "gio-opener";
  if (name === "xdg-open") return "opener";
  return "browser";
}

function invocationArgs(kind, url) {
  return kind === "gio-opener" ? ["open", url] : [url];
}

async function executableAt(file, access = fs.access) {
  try {
    await access(file, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function findOnPath(name, { pathValue, access }) {
  for (const directory of String(pathValue ?? "").split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory, name);
    if (await executableAt(candidate, access)) return candidate;
  }
  return null;
}

export function validateBrowserExecutable(value) {
  if (typeof value !== "string" || !value || value !== value.trim() || UNSAFE_EXECUTABLE.test(value)) {
    throw new TypeError("INNER_SIGNAL_BROWSER_EXECUTABLE must contain one executable name or path without arguments or shell syntax.");
  }
  return value;
}

export function validateLoopbackBrowserUrl(value) {
  if (typeof value !== "string" || !value) throw new TypeError("A loopback browser URL is required.");
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError("The browser URL is invalid.");
  }
  const loopback = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
  if (parsed.protocol !== "http:" || !loopback || !parsed.port || parsed.username || parsed.password
      || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new TypeError("The browser URL must be an HTTP loopback origin with an explicit port.");
  }
  const port = Number(parsed.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new TypeError("The browser URL port is invalid.");
  return value;
}

export async function discoverBrowserLauncher({
  env = process.env,
  cwd = process.cwd(),
  access = fs.access,
  candidates = DISCOVERY_CANDIDATES
} = {}) {
  const attempts = [];
  const configured = env.INNER_SIGNAL_BROWSER_EXECUTABLE;
  if (configured != null && configured !== "") {
    let value;
    try {
      value = validateBrowserExecutable(configured);
    } catch (error) {
      return { ok: false, code: "INVALID_BROWSER_EXECUTABLE", source: "environment", attempts, message: error.message };
    }
    const executable = value.includes(path.sep)
      ? path.resolve(cwd, value)
      : await findOnPath(value, { pathValue: env.PATH, access });
    const found = executable && await executableAt(executable, access);
    attempts.push({ candidate: value, source: "environment", status: found ? "selected" : "not-found" });
    if (!found) {
      return {
        ok: false,
        code: "CONFIGURED_BROWSER_NOT_FOUND",
        source: "environment",
        attempts,
        message: "The configured browser executable is not available."
      };
    }
    return {
      ok: true,
      source: "environment",
      executable,
      candidate: value,
      kind: launcherKind(executable),
      attempts
    };
  }

  for (const candidate of candidates) {
    const executable = await findOnPath(candidate.name, { pathValue: env.PATH, access });
    attempts.push({ candidate: candidate.name, source: "path", status: executable ? "selected" : "not-found" });
    if (executable) {
      return {
        ok: true,
        source: "path",
        executable,
        candidate: candidate.name,
        kind: candidate.kind,
        attempts
      };
    }
  }
  return {
    ok: false,
    code: "BROWSER_EXECUTABLE_NOT_FOUND",
    source: "path",
    attempts,
    message: "No supported browser executable or desktop opener was found."
  };
}

async function spawnDetached(executable, args, spawnImpl) {
  const child = spawnImpl(executable, args, {
    shell: false,
    detached: true,
    stdio: "ignore"
  });
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  child.unref();
  return child.pid ?? null;
}

export async function launchBrowser({
  url,
  env = process.env,
  cwd = process.cwd(),
  access = fs.access,
  spawnImpl = spawn,
  candidates = DISCOVERY_CANDIDATES
}) {
  const exactUrl = validateLoopbackBrowserUrl(url);
  const discovery = await discoverBrowserLauncher({ env, cwd, access, candidates });
  if (!discovery.ok) return { ok: false, url: exactUrl, discovery };
  const args = invocationArgs(discovery.kind, exactUrl);
  const pid = await spawnDetached(discovery.executable, args, spawnImpl);
  return {
    ok: true,
    url: exactUrl,
    discovery,
    invocation: {
      executable: discovery.executable,
      arguments: args,
      shell: false,
      detached: true,
      pid
    }
  };
}

export { DISCOVERY_CANDIDATES };
