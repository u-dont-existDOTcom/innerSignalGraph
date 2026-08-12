import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { writeFinalStatus } from "../src/autopilot/status.mjs";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function executable(file, text) {
  await fs.writeFile(file, text, { mode: 0o755 });
  return file;
}

test("Codex auth recovery performs one browser login, verifies it, and resumes validation", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-codex-auth-"));
  const calls = path.join(dir, "calls.txt");
  const resumed = path.join(dir, "resumed.txt");
  const codex = await executable(path.join(dir, "codex"), `#!/usr/bin/env bash
printf 'codex:%s\n' "$*" >> "${calls}"
if [[ "$1" == "login" && "$2" == "status" ]]; then exit 0; fi
if [[ "$1" == "login" ]]; then exit 0; fi
exit 9
`);
  const resume = await executable(path.join(dir, "resume"), `#!/usr/bin/env bash
printf 'attempted=%s args=%s\n' "${'${INNER_SIGNAL_CODEX_REAUTH_ATTEMPTED:-}'}" "$*" > "${resumed}"
`);

  await execFileAsync("bash", [path.join(root, "scripts/reauth-codex.sh"), "--external-launch"], {
    cwd: root,
    env: {
      ...process.env,
      CODEX_COMMAND: codex,
      INNER_SIGNAL_RESUME_COMMAND: resume,
      INNER_SIGNAL_CODEX_REAUTH_ATTEMPTED: "0"
    }
  });

  const callText = await fs.readFile(calls, "utf8");
  assert.equal(callText, "codex:login\ncodex:login status\n");
  assert.equal(await fs.readFile(resumed, "utf8"), "attempted=1 args=--force-validation --external-launch\n");
});

test("Codex auth recovery refuses a second automatic login loop", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-codex-auth-loop-"));
  const marker = path.join(dir, "called.txt");
  const codex = await executable(path.join(dir, "codex"), `#!/usr/bin/env bash
printf called > "${marker}"
`);
  await assert.rejects(
    execFileAsync("bash", [path.join(root, "scripts/reauth-codex.sh")], {
      cwd: root,
      env: {
        ...process.env,
        CODEX_COMMAND: codex,
        INNER_SIGNAL_CODEX_REAUTH_ATTEMPTED: "1"
      }
    }),
    (error) => error.code === 1
  );
  await assert.rejects(fs.access(marker));
});

test("local final status renders the safe A001 failure without arbitrary raw details", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-final-status-"));
  await writeFinalStatus(stateDir, {
    status: "BLOCKED",
    stage: "A001-case-audit",
    summary: "The Codex audit failed.",
    nextAction: "Resume from the checkpoint.",
    doNotDo: ["Do not upload logs."],
    runDir: "/private/local/run",
    details: {
      failure: {
        classification: "TRANSIENT",
        provider: "openai",
        model: "gpt-5.6-sol",
        message: "openai/gpt-5.6-sol case_audit encountered a transient provider or transport failure."
      },
      raw: "RAW_STATUS_PRIVATE_SENTINEL"
    }
  });
  const text = await fs.readFile(path.join(stateDir, "ACTION-REQUIRED.md"), "utf8");
  assert.match(text, /TRANSIENT/);
  assert.match(text, /gpt-5\.6-sol/);
  assert.match(text, /transient provider or transport failure/);
  assert.doesNotMatch(text, /RAW_STATUS_PRIVATE_SENTINEL/);
});
