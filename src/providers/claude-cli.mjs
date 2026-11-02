import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ProviderError } from "../core/errors.mjs";
import { runSubprocess, sealedInferenceEnvironment } from "../core/subprocess.mjs";
import { detectClaudeCapabilities } from "../core/cli-capabilities.mjs";

export class ClaudeCliProvider {
  constructor({
    command = "claude",
    baseArgs = [],
    model = "",
    effort = "high",
    timeoutMs = 900000,
    cwd = process.cwd(),
    isolateConfig = true,
    detectCapabilities = true,
    maxTurns = 1
  } = {}) {
    this.id = "anthropic";
    this.command = command;
    this.baseArgs = baseArgs;
    this.model = model;
    this.effort = effort;
    this.timeoutMs = timeoutMs;
    this.cwd = cwd;
    this.isolateConfig = isolateConfig;
    this.detectCapabilities = detectCapabilities;
    // The turn cap passed when the CLI has --max-turns; null leaves it out (a caller whose agent has no tools and wants the
    // CLI's own structured-output step, which takes a turn of its own, never cut short). Sealed inference always caps.
    this.maxTurns = maxTurns;
    this.capabilitiesPromise = null;
    this.privateInferenceIsolation = Object.freeze({ packetOnly: true, freshContextPerGenerate: true, tools: false, filesystem: false, sessionPersistence: false, environment: "allowlisted", requiresSealedFlag: true, transport: "claude-cli-print" });
  }

  async capabilities() {
    if (!this.detectCapabilities) return null;
    this.capabilitiesPromise ??= detectClaudeCapabilities(this.command, this.baseArgs);
    return await this.capabilitiesPromise;
  }

  async generate({ system, user, outputSchema, metadata = {}, sealed = false }) {
    if (!outputSchema) throw new ProviderError("Claude CLI requires an output schema.");

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-claude-"));
    const systemPath = path.join(tempDir, "system.txt");
    await fs.writeFile(systemPath, system, { mode: 0o600 });

    try {
      const capabilities = await this.capabilities();
      const flags = capabilities?.flags;
      if (flags && (!flags.print || !flags.outputFormat || !flags.jsonSchema)) {
        throw new ProviderError("Installed Claude CLI lacks required noninteractive structured-output flags.", {
          code: "CLI_INCOMPATIBLE",
          details: { required: ["-p/--print", "--output-format", "--json-schema"], detected: flags }
        });
      }
      if (sealed && flags) {
        // Not maxTurns: --tools "" is required and passed, so there are no tool turns to cap; the cap below is still passed when the CLI lists it.
        const requiredIsolationFlags = ["tools", "noSessionPersistence", "permissionMode", "noChrome", "safeMode", "strictMcpConfig"];
        const missingIsolationFlags = requiredIsolationFlags.filter((name) => !flags[name]);
        if (missingIsolationFlags.length) {
          throw new ProviderError("Installed Claude CLI cannot guarantee packet-only private inference isolation.", {
            code: "PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE",
            details: { missingIsolationFlags }
          });
        }
      }

      const args = [...this.baseArgs, "-p"];
      if (this.model && (!flags || flags.model)) args.push("--model", this.model);
      if (this.effort && (!flags || flags.effort)) args.push("--effort", this.effort);
      args.push("--output-format", "json", "--json-schema", JSON.stringify(outputSchema));
      if (!flags || flags.tools) args.push("--tools", "");
      const maxTurns = sealed ? (this.maxTurns ?? 1) : this.maxTurns;
      if (maxTurns != null && (!flags || flags.maxTurns)) args.push("--max-turns", String(maxTurns));
      if (!flags || flags.noSessionPersistence) args.push("--no-session-persistence");
      if (!flags || flags.permissionMode) args.push("--permission-mode", "dontAsk");
      if (!flags || flags.noChrome) args.push("--no-chrome");
      if ((sealed || this.isolateConfig) && (!flags || flags.safeMode)) args.push("--safe-mode");
      if ((sealed || this.isolateConfig) && (!flags || flags.strictMcpConfig)) args.push("--strict-mcp-config");

      let stdin = user;
      if (!flags || flags.systemPromptFile) {
        args.push("--system-prompt-file", systemPath);
      } else if (flags.systemPrompt) {
        args.push("--system-prompt", system);
      } else {
        stdin = `SYSTEM INSTRUCTIONS\n${system}\n\nUSER MESSAGE AND CONTEXT\n${user}`;
      }

      const run = await runSubprocess({
        command: this.command,
        args,
        stdin,
        cwd: sealed ? tempDir : this.cwd,
        env: sealed ? sealedInferenceEnvironment() : process.env,
        timeoutMs: this.timeoutMs,
        label: `Claude CLI ${metadata.stage ?? "generation"}`
      });

      if (run.code !== 0) {
        throw new ProviderError(`Claude CLI exited with status ${run.code}.`, {
          details: {
            stage: metadata.stage,
            model: this.model || "CLI default",
            stderr: run.stderr.slice(-4000),
            stdout: run.stdout.slice(-2000)
          }
        });
      }

      let envelope;
      try {
        envelope = JSON.parse(run.stdout);
      } catch (cause) {
        throw new ProviderError("Claude CLI did not return its JSON envelope.", {
          cause,
          details: { stdout: run.stdout.slice(-4000), stderr: run.stderr.slice(-4000) }
        });
      }

      const structured = envelope.structured_output;
      const text = structured && typeof structured === "object"
        ? JSON.stringify(structured)
        : typeof envelope.result === "string"
          ? envelope.result.trim()
          : "";
      if (!text) {
        throw new ProviderError("Claude CLI returned no structured output.", {
          details: { envelopeKeys: Object.keys(envelope) }
        });
      }

      return {
        provider: this.id,
        model: this.model || "CLI default",
        text,
        requestId: envelope.session_id ?? `claude-cli-${randomUUID()}`,
        responseId: envelope.session_id,
        usage: envelope.usage,
        modelUsage: envelope.modelUsage,
        transport: "cli",
        stderr: run.stderr.trim()
      };
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }
}
