import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ProviderError } from "../core/errors.mjs";
import { runSubprocess, sealedInferenceEnvironment } from "../core/subprocess.mjs";
import { detectClaudeCapabilities } from "../core/cli-capabilities.mjs";

// Claude for a runner-trial worker: one sealed `claude -p` call, with the isolation the app's ClaudeCliProvider uses for its
// private reply check (no tools, no session, safe mode, strict MCP config, an allowlisted environment, a fresh 0700 folder
// removed after the call), plus what the trial needs on top: a limit per call, the reason a call failed in fixed words (a plan
// limit, a lapsed sign-in, a timeout, a refusal), and the call's time and token use for measurement. The rules go in the system
// prompt file; the case packet only on stdin, never in a file or on the command line.

const REQUIRED_FLAGS = ["print", "outputFormat", "jsonSchema", "tools", "noSessionPersistence", "permissionMode", "noChrome", "safeMode", "strictMcpConfig", "systemPromptFile"];
const capabilityCache = new Map();

export function classifyClaudeFailure(text) {
  if (/weekly limit|usage limit|rate limit|hit your .*limit|limit reached|too many requests|\b429\b/iu.test(text)) return "PLAN_LIMIT";
  if (/not logged in|log ?in|\/login|authenticat|unauthori[sz]ed|\b401\b|\b403\b|credential/iu.test(text)) return "SIGN_IN_NEEDED";
  if (/timed out|timeout/iu.test(text)) return "TIMEOUT";
  return "PROVIDER_FAILED";
}

export class SealedClaudeWorker {
  // configDir: the Claude sign-in folder the runner's calls use (CLAUDE_CONFIG_DIR), so the runner can have a sign-in of its own
  // apart from the person's default `claude` (the InnerSignal lane's question i64, option a). The folder is only named here:
  // nothing reads or copies what is in it.
  constructor({ command = "claude", model, effort = "medium", environment = process.env, configDir = null } = {}) {
    if (typeof model !== "string" || !model.trim()) throw new ProviderError("A runner worker needs an explicit Claude model.", { code: "RUNNER_SETTINGS_INVALID" });
    if (configDir != null && (typeof configDir !== "string" || !path.isAbsolute(configDir))) throw new ProviderError("The runner's Claude config folder must be an absolute path.", { code: "RUNNER_SETTINGS_INVALID" });
    this.configDir = configDir;
    this.provider = "anthropic";
    this.command = command;
    this.model = model;
    this.effort = effort;
    this.environment = environment;
    this.isolation = Object.freeze({ packetOnly: true, tools: "none", filesystem: "empty_folder", sessionPersistence: false, environment: "allowlisted", transport: "claude-cli-print-sealed" });
  }

  async capabilities() {
    if (!capabilityCache.has(this.command)) capabilityCache.set(this.command, detectClaudeCapabilities(this.command).catch((error) => { capabilityCache.delete(this.command); throw error; }));
    const capabilities = await capabilityCache.get(this.command);
    const missing = REQUIRED_FLAGS.filter((flag) => !capabilities?.flags?.[flag]);
    if (missing.length) throw new ProviderError("The installed Claude CLI can't make a sealed runner call.", { code: "PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE", details: { missing } });
    return capabilities;
  }

  async call({ system, user, schema, timeoutMs, stage }) {
    const capabilities = await this.capabilities();
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-runner-claude-"));
    const systemPath = path.join(folder, "system.txt");
    await fs.writeFile(systemPath, system, { mode: 0o600 });
    const started = Date.now();
    try {
      const args = ["-p", "--model", this.model];
      if (this.effort && capabilities.flags.effort) args.push("--effort", this.effort);
      args.push("--output-format", "json", "--json-schema", JSON.stringify(schema), "--tools", "");
      if (capabilities.flags.maxTurns) args.push("--max-turns", "2");
      args.push("--no-session-persistence", "--permission-mode", "dontAsk", "--no-chrome", "--safe-mode", "--strict-mcp-config", "--system-prompt-file", systemPath);
      let run;
      try {
        const env = { ...sealedInferenceEnvironment(this.environment), ...(this.configDir ? { CLAUDE_CONFIG_DIR: this.configDir } : {}) };
        run = await runSubprocess({ command: this.command, args, stdin: user, cwd: folder, env, timeoutMs, label: `Runner ${stage}` });
      } catch (error) {
        throw new ProviderError(`Runner ${stage} failed to finish.`, { code: /timed out/iu.test(error.message) ? "TIMEOUT" : "PROVIDER_FAILED", details: { stage } });
      }
      let envelope = null;
      try { envelope = JSON.parse(run.stdout); } catch { envelope = null; }
      const resultText = typeof envelope?.result === "string" ? envelope.result : "";
      if (run.code !== 0 || envelope?.is_error) {
        throw new ProviderError(`Runner ${stage} returned an error.`, { code: classifyClaudeFailure(`${resultText}\n${run.stderr.slice(-2000)}`), details: { stage, exit: run.code } });
      }
      const structured = envelope?.structured_output;
      if (!structured || typeof structured !== "object") {
        // A refusal is known only from the API's own stop reason; the model's words are never read for it.
        throw new ProviderError(`Runner ${stage} gave no structured answer.`, { code: envelope?.stop_reason === "refusal" ? "REFUSED" : "PROVIDER_MALFORMED", details: { stage } });
      }
      const usage = envelope.usage ?? {};
      return {
        value: structured,
        receipt: Object.freeze({
          provider: this.provider,
          model: this.model,
          effort: this.effort,
          session_id: envelope.session_id ?? `claude-${randomUUID()}`,
          duration_ms: Date.now() - started,
          duration_api_ms: envelope.duration_api_ms ?? null,
          input_tokens: usage.input_tokens ?? null,
          cache_read_input_tokens: usage.cache_read_input_tokens ?? null,
          cache_creation_input_tokens: usage.cache_creation_input_tokens ?? null,
          output_tokens: usage.output_tokens ?? null,
          isolation: this.isolation
        })
      };
    } finally {
      await fs.rm(folder, { recursive: true, force: true });
    }
  }
}
