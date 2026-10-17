import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ProviderError } from "../core/errors.mjs";
import { runSubprocess } from "../core/subprocess.mjs";
import { detectCodexCapabilities } from "../core/cli-capabilities.mjs";

// The events, and how many lines that start like a JSON event don't parse (a truncated or broken event).
function parseJsonLines(text) {
  const events = [];
  let malformed = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // Progress and compatibility notices may appear as non-JSON output; a line that starts like an event is a broken one.
      if (line.trimStart().startsWith("{")) malformed += 1;
    }
  }
  return { events, malformed };
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
    detectCapabilities = true,
    configOverrides = []
  } = {}) {
    this.id = "openai";
    this.command = command;
    this.baseArgs = baseArgs;
    this.model = model;
    this.reasoningEffort = reasoningEffort;
    this.timeoutMs = timeoutMs;
    this.cwd = cwd;
    this.isolateConfig = isolateConfig;
    // Extra `-c key=value` settings for this caller, such as features it wants turned off.
    this.configOverrides = [...configOverrides];
    this.detectCapabilities = detectCapabilities;
    this.capabilitiesPromise = null;
    this.privateInferenceIsolation = Object.freeze({ packetOnly: false, freshContextPerGenerate: true, tools: true, filesystem: true, sessionPersistence: false, transport: "codex-cli-agent" });
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
      if (this.configOverrides.length && (!flags || flags.config)) {
        for (const override of this.configOverrides) args.push("-c", override);
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

      const { events, malformed } = parseJsonLines(run.stdout);
      const thread = events.find((event) => event.type === "thread.started");
      const completed = [...events].reverse().find((event) => event.type === "turn.completed");
      const failed = [...events].reverse().find((event) => event.type === "turn.failed" || event.type === "error");
      if (failed) throw new ProviderError("Codex CLI reported a failed turn.", { details: failed });
      // How many actions (commands, file changes, tool calls, searches) the agent took beyond reasoning and its message:
      // a caller that wants an answer from the prompt alone can tell when the agent reached outside it.
      const toolItems = new Set(events
        .filter((event) => ["item.started", "item.updated", "item.completed"].includes(event.type) && event.item
          && !["agent_message", "reasoning", "todo_list", "error"].includes(event.item.type))
        .map((event, index) => event.item.id ?? `item-${index}`)).size;
      // The count is a receipt only when the event stream is whole: every event-looking line parses, the turn completed and
      // the agent's message is in it. Otherwise (a changed event format, a truncated or broken event) there is no count (null),
      // so no caller mistakes a missing receipt for an agent that took no action.
      const receipt = malformed === 0 && Boolean(completed) && events.some((event) => event.type === "item.completed" && event.item?.type === "agent_message");

      return {
        provider: this.id,
        model: this.model || "CLI default",
        text,
        requestId: thread?.thread_id ?? `codex-cli-${randomUUID()}`,
        responseId: thread?.thread_id,
        usage: completed?.usage,
        toolItems: receipt ? toolItems : null,
        transport: "cli",
        stderr: run.stderr.trim()
      };
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }
}
