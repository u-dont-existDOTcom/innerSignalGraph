import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { runSubprocess } from "../core/subprocess.mjs";
import { detectClaudeCapabilities } from "../core/cli-capabilities.mjs";
import { ProviderError } from "../core/errors.mjs";

const resultSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", enum: ["implemented", "blocked"] },
    summary: { type: "string" },
    regression_added: { type: "boolean" },
    changed_files: { type: "array", items: { type: "string" } },
    tests_run: { type: "array", items: { type: "string" } },
    policy_change_claim: { type: "string", enum: ["none", "restorative", "substantive", "uncertain"] },
    blocker: { type: "string" }
  },
  required: ["status", "summary", "regression_added", "changed_files", "tests_run", "policy_change_claim", "blocker"]
};

export async function runClaudeCodingAgent({ command = "claude", model, candidateRoot, developmentCase, audit, cycle = 1, priorFailure = null, timeoutMs = 1800000 }) {
  const caps = await detectClaudeCapabilities(command);
  const flags = caps.flags || {};
  if (!flags.print || !flags.outputFormat || !flags.jsonSchema || !flags.tools) {
    throw new ProviderError("Claude CLI lacks the tool-enabled structured mode required for autonomous repair.", {
      code: "DEV_CLI_INCOMPATIBLE",
      details: { required: ["print", "output-format", "json-schema", "tools"], detected: flags }
    });
  }
  const metaDir = path.join(candidateRoot, ".inner-signal-dev");
  await fs.mkdir(metaDir, { recursive: true });
  await fs.writeFile(path.join(metaDir, "DEVELOPMENT_CASE.json"), `${JSON.stringify(developmentCase, null, 2)}\n`);
  await fs.writeFile(path.join(metaDir, "DEVELOPMENT_AUDIT.json"), `${JSON.stringify(audit, null, 2)}\n`);
  if (priorFailure) await fs.writeFile(path.join(metaDir, `PRIOR_FAILURE_CYCLE_${cycle - 1}.json`), `${JSON.stringify(priorFailure, null, 2)}\n`);

  const policyInstruction = audit?.human_decision_required
    ? "The audit already identifies a substantive product decision. You may implement a concrete isolated candidate so the human can judge the actual behavior, but mark policy_change_claim=substantive and do not weaken any existing safety or evidence boundary."
    : "Do not make substantive therapy-policy changes. If such a change appears necessary, stop and report policy_change_claim=substantive instead of implementing it.";
  const system = `You are the Inner Signal autonomous repair implementer. You are working inside an isolated candidate copy, never the approved/running runtime. Read .inner-signal-dev/DEVELOPMENT_CASE.json and DEVELOPMENT_AUDIT.json before editing. Repair the narrowest demonstrated defect. First add or strengthen a regression test that reproduces the reported behavior when feasible, then implement the smallest fix. Preserve all safety, consent, epistemic, guide-graph, hypnosis, and user-autonomy contracts. Never weaken or delete a failing assertion merely to make the suite green. Do not edit .env, ledgers, user data, or .inner-signal-autopilot. ${policyInstruction} Add or strengthen targeted regression tests, and run them opportunistically if the sandbox permits. Verification is owned by the parent controller: inability to execute npm/node/bash commands is NOT a reason to block after the code and regression are implemented. In that situation return status=implemented, list the changed files, leave tests_run empty or partial, and explain the tooling limitation in blocker. You may use Read, Edit, Write, and Bash tools in this candidate only.`;
  const user = `Repair cycle ${cycle}. The complete development case and audit are files in .inner-signal-dev/. ${priorFailure ? "A prior candidate failed; inspect the PRIOR_FAILURE file and materially address it." : ""} Finish with the required structured result.`;
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-dev-claude-"));
  const systemPath = path.join(temp, "system.txt");
  await fs.writeFile(systemPath, system, { mode: 0o600 });
  try {
    const args = ["-p", "--model", model, "--output-format", "json", "--json-schema", JSON.stringify(resultSchema), "--tools", "Read,Edit,Write,Bash"];
    if (flags.effort) args.push("--effort", "high");
    if (flags.maxTurns) args.push("--max-turns", "40");
    if (flags.noSessionPersistence) args.push("--no-session-persistence");
    if (flags.permissionMode) args.push("--permission-mode", "acceptEdits");
    if (flags.noChrome) args.push("--no-chrome");
    if (flags.strictMcpConfig) args.push("--strict-mcp-config");
    if (flags.systemPromptFile) args.push("--system-prompt-file", systemPath);
    else if (flags.systemPrompt) args.push("--system-prompt", system);
    const stdin = flags.systemPromptFile || flags.systemPrompt ? user : `SYSTEM\n${system}\n\nTASK\n${user}`;
    const run = await runSubprocess({ command, args, stdin, cwd: candidateRoot, timeoutMs, label: `Claude autonomous repair ${model}` });
    if (run.code !== 0) throw new ProviderError(`Claude coding agent exited with status ${run.code}.`, { details: { model, stderr: run.stderr.slice(-6000), stdout: run.stdout.slice(-3000) } });
    let envelope;
    try { envelope = JSON.parse(run.stdout); } catch (cause) { throw new ProviderError("Claude coding agent returned an invalid JSON envelope.", { cause, details: { stdout: run.stdout.slice(-4000) } }); }
    const value = envelope.structured_output;
    if (!value || typeof value !== "object") throw new ProviderError("Claude coding agent returned no structured result.");
    return { ...value, model, sessionId: envelope.session_id ?? `dev-${randomUUID()}`, stderr: run.stderr.trim() };
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}
