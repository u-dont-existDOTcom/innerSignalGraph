import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ProviderError } from "../core/errors.mjs";
import { runSubprocess } from "../core/subprocess.mjs";
import { detectCodexCapabilities } from "../core/cli-capabilities.mjs";

function parseJsonLines(text) {
  const events = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // Progress and compatibility notices may appear as non-JSON output.
    }
  }
  return events;
}

export class CodexCliProvider {
  constructor({
    command = "codex",
    baseArgs = [],
    model = "",
    reasoningEffort = "high",
    timeoutMs = 900000,
    cwd = process.cwd(),
    isolateConfig = true,
    detectCapabilities = true
  } = {}) {
    this.id = "openai";
    this.command = command;
    this.baseArgs = baseArgs;
    this.model = model;
    this.reasoningEffort = reasoningEffort;
    this.timeoutMs = timeoutMs;
    this.cwd = cwd;
    this.isolateConfig = isolateConfig;
    this.detectCapabilities = detectCapabilities;
    this.capabilitiesPromise = null;
  }

  async capabilities() {
    if (!this.detectCapabilities) return null;
    this.capabilitiesPromise ??= detectCodexCapabilities(this.command, this.baseArgs);
    return await this.capabilitiesPromise;
  }

  async generate({ system, user, outputSchema, metadata = {} }) {
    if (!outputSchema) throw new ProviderError("Codex CLI requires an output schema.");

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-codex-"));
    const schemaPath = path.join(tempDir, "schema.json");
    const outputPath = path.join(tempDir, "final.json");
    await fs.writeFile(schemaPath, `${JSON.stringify(outputSchema, null, 2)}\n`, { mode: 0o600 });

    try {
      const capabilities = await this.capabilities();
      const flags = capabilities?.flags;
      if (flags && (!flags.outputSchema || !flags.outputLastMessage)) {
        throw new ProviderError("Installed Codex CLI lacks required structured-output flags.", {
          code: "CLI_INCOMPATIBLE",
          details: { required: ["--output-schema", "--output-last-message"], detected: flags }
        });
      }

      const args = [...this.baseArgs, "exec"];
      if (!flags || flags.ephemeral) args.push("--ephemeral");
      if (!flags || flags.json) args.push("--json");
      if (!flags || flags.sandbox) args.push("--sandbox", "read-only");
      if (!flags || flags.approval) args.push("--ask-for-approval", "never");
      if (!flags || flags.skipGit) args.push("--skip-git-repo-check");
      if (this.model && (!flags || flags.model)) args.push("--model", this.model);
      if (this.reasoningEffort && (!flags || flags.config)) {
        args.push("-c", `model_reasoning_effort=\"${this.reasoningEffort}\"`);
      }
      args.push("--output-schema", schemaPath, "--output-last-message", outputPath);
      if (this.isolateConfig && (!flags || flags.ignoreUserConfig)) args.push("--ignore-user-config");
      if (this.isolateConfig && (!flags || flags.ignoreRules)) args.push("--ignore-rules");
      args.push("-");

      const prompt = `SYSTEM INSTRUCTIONS\n${system}\n\nUSER MESSAGE AND CONTEXT\n${user}\n`;
      const run = await runSubprocess({
        command: this.command,
        args,
        stdin: prompt,
        cwd: this.cwd,
        timeoutMs: this.timeoutMs,
        label: `Codex CLI ${metadata.stage ?? "generation"}`
      });

      if (run.code !== 0) {
        throw new ProviderError(`Codex CLI exited with status ${run.code}.`, {
          details: {
            stage: metadata.stage,
            model: this.model || "CLI default",
            stderr: run.stderr.slice(-4000),
            stdout: run.stdout.slice(-2000)
          }
        });
      }

      let text;
      try {
        text = (await fs.readFile(outputPath, "utf8")).trim();
      } catch (cause) {
        throw new ProviderError("Codex CLI did not write its final structured message.", {
          cause,
          details: { stdout: run.stdout.slice(-2000), stderr: run.stderr.slice(-4000) }
        });
      }
      if (!text) throw new ProviderError("Codex CLI returned an empty final message.");

      const events = parseJsonLines(run.stdout);
      const thread = events.find((event) => event.type === "thread.started");
      const completed = [...events].reverse().find((event) => event.type === "turn.completed");
      const failed = [...events].reverse().find((event) => event.type === "turn.failed" || event.type === "error");
      if (failed) throw new ProviderError("Codex CLI reported a failed turn.", { details: failed });

      return {
        provider: this.id,
        model: this.model || "CLI default",
        text,
        requestId: thread?.thread_id ?? `codex-cli-${randomUUID()}`,
        responseId: thread?.thread_id,
        usage: completed?.usage,
        transport: "cli",
        stderr: run.stderr.trim()
      };
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }
}
