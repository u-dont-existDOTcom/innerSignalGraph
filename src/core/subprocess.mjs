import { spawn } from "node:child_process";
import { ProviderError } from "./errors.mjs";

const MAX_CAPTURE_BYTES = 20 * 1024 * 1024;

function appendLimited(current, chunk, label) {
  const next = current + chunk.toString("utf8");
  if (Buffer.byteLength(next, "utf8") > MAX_CAPTURE_BYTES) {
    throw new ProviderError(`${label} exceeded ${MAX_CAPTURE_BYTES} bytes.`);
  }
  return next;
}

export async function runSubprocess({
  command,
  args = [],
  stdin = "",
  cwd,
  env = process.env,
  timeoutMs = 900000,
  label = command
}) {
  return await new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let captureError = null;

    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      detached: process.platform !== "win32"
    });

    const timer = setTimeout(() => {
      if (settled) return;
      try {
        if (process.platform === "win32") child.kill("SIGKILL");
        else process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
      settled = true;
      reject(new ProviderError(`${label} timed out after ${timeoutMs} ms.`, {
        details: { command, args }
      }));
    }, timeoutMs);

    child.on("error", (cause) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new ProviderError(`Could not start ${label}.`, {
        cause,
        details: { command, args }
      }));
    });

    child.stdout.on("data", (chunk) => {
      if (captureError) return;
      try {
        stdout = appendLimited(stdout, chunk, `${label} stdout`);
      } catch (error) {
        captureError = error;
        child.kill("SIGKILL");
      }
    });

    child.stderr.on("data", (chunk) => {
      if (captureError) return;
      try {
        stderr = appendLimited(stderr, chunk, `${label} stderr`);
      } catch (error) {
        captureError = error;
        child.kill("SIGKILL");
      }
    });

    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (captureError) return reject(captureError);
      resolve({ code, signal, stdout, stderr });
    });

    child.stdin.on("error", (error) => {
      if (error.code !== "EPIPE" && !settled) {
        captureError = new ProviderError(`${label} rejected stdin.`, { cause: error });
      }
    });
    child.stdin.end(stdin);
  });
}
