import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ProviderError } from "../core/errors.mjs";
import { runSubprocess, sealedInferenceEnvironment } from "../core/subprocess.mjs";
import { detectCodexCapabilities } from "../core/cli-capabilities.mjs";
import { CODEX_ISOLATION_CONFIG } from "../evals/protocol-application.mjs";

// GPT for a runner-trial worker, through `codex exec` on the person's ChatGPT plan, as close to sealed as Codex allows
// (design, section 10): an empty 0700 working folder removed after the call; no session kept; a read-only sandbox; the user's
// config, rules and MCP servers ignored; every agent feature the protocol-application eval turns off turned off; the rules and
// instructions in a 0600 file given as `model_instructions_file`, which replaces Codex's own instructions (a command-line
// argument can't carry them: Linux caps one at 131,072 bytes); the case packet on stdin; the answer read from the event stream,
// so no answer file is written; and a Codex home of its own for the call, holding only a link to the sign-in, so the person's
// global Codex instructions (AGENTS.md), memories and logs never reach the worker or keep anything of the call (a probe on
// 21 Nov 2026 showed the global instructions reaching a worker that used the person's own Codex home). Codex still offers a model some actions, so the isolation is checked on the result, not
// prevented: a call whose event stream shows any action, or isn't whole, is refused. A CLI without every flag is refused.

// `exec` never asks for approval, and Codex 0.171 has no --ask-for-approval on exec: it is passed only when the CLI lists it.
// Codex's own built-in server offers two tools that only list MCP servers' resources. The call's Codex home configures no MCP
// server, so they can reach nothing; a call to them, by these exact names, isn't counted as an action. Any other is.
const INTROSPECTION_TOOLS = Object.freeze(["list_mcp_resources", "list_mcp_resource_templates"]);
const isIntrospection = (item) => item?.type === "mcp_tool_call" && item.server === "codex" && INTROSPECTION_TOOLS.includes(item.tool);
const REQUIRED_FLAGS = ["ephemeral", "json", "sandbox", "skipGit", "config", "outputSchema", "ignoreUserConfig", "ignoreRules"];
const capabilityCache = new Map();

export function classifyCodexFailure(text) {
  if (/usage limit|rate limit|quota|too many requests|\b429\b/iu.test(text)) return "PLAN_LIMIT";
  if (/not logged in|log ?in|unauthori[sz]ed|\b401\b|\b403\b|auth/iu.test(text)) return "SIGN_IN_NEEDED";
  if (/timed? ?out|timeout/iu.test(text)) return "TIMEOUT";
  return "PROVIDER_FAILED";
}

function parseEvents(text) {
  const events = [];
  let malformed = 0;
  for (const line of text.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); } catch { if (line.trimStart().startsWith("{")) malformed += 1; }
  }
  return { events, malformed };
}

export function sealedCodexArgs({ model, effort, instructionsPath, schemaPath, approvalFlag = false }) {
  const args = ["exec", "--ephemeral", "--json", "--sandbox", "read-only", ...(approvalFlag ? ["--ask-for-approval", "never"] : []), "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules"];
  if (model) args.push("--model", model);
  if (effort) args.push("-c", `model_reasoning_effort=${JSON.stringify(effort)}`);
  for (const setting of [...CODEX_ISOLATION_CONFIG, "features.goals=false", "features.memories=false"]) args.push("-c", setting);
  args.push("-c", `model_instructions_file=${JSON.stringify(instructionsPath)}`, "--output-schema", schemaPath, "-");
  return args;
}

export class SealedCodexWorker {
  constructor({ command = "codex", model = "", effort = "medium", environment = process.env } = {}) {
    this.provider = "openai";
    this.command = command;
    this.model = model;
    this.effort = effort;
    this.environment = environment;
    this.isolation = Object.freeze({ packetOnly: true, tools: "disabled_and_any_action_refused", filesystem: "empty_read_only_folder", sessionPersistence: false, environment: "allowlisted", transport: "codex-cli-exec-sealed" });
  }

  async capabilities() {
    if (!capabilityCache.has(this.command)) capabilityCache.set(this.command, detectCodexCapabilities(this.command).catch((error) => { capabilityCache.delete(this.command); throw error; }));
    const capabilities = await capabilityCache.get(this.command);
    const missing = REQUIRED_FLAGS.filter((flag) => !capabilities?.flags?.[flag]);
    if (missing.length) throw new ProviderError("The installed Codex CLI can't make a sealed runner call.", { code: "PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE", details: { missing } });
    return capabilities;
  }

  // `beforeSend`, when given, is asked after the preparation (the capability check, the folder) and right before the packet leaves:
  // a check that must still hold then (the runner trial's journal gate) stops the call.
  async call({ system, user, schema, timeoutMs, stage, beforeSend = null }) {
    const capabilities = await this.capabilities();
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-runner-codex-"));
    const work = path.join(folder, "work");
    await fs.mkdir(work, { mode: 0o700 });
    const codexHome = path.join(folder, "codex-home");
    await fs.mkdir(codexHome, { mode: 0o700 });
    await fs.symlink(path.join(this.environment.CODEX_HOME || path.join(os.homedir(), ".codex"), "auth.json"), path.join(codexHome, "auth.json"));
    const instructionsPath = path.join(folder, "instructions.md");
    const schemaPath = path.join(folder, "schema.json");
    await fs.writeFile(instructionsPath, system, { mode: 0o600 });
    await fs.writeFile(schemaPath, `${JSON.stringify(schema)}\n`, { mode: 0o600 });
    const started = Date.now();
    try {
      const environment = { ...sealedInferenceEnvironment(this.environment), CODEX_HOME: codexHome };
      if (beforeSend) await beforeSend();
      let run;
      try {
        run = await runSubprocess({ command: this.command, args: sealedCodexArgs({ model: this.model, effort: this.effort, instructionsPath, schemaPath, approvalFlag: Boolean(capabilities.flags.approval) }), stdin: `${user}\n`, cwd: work, env: environment, timeoutMs, label: `Runner ${stage}` });
      } catch (error) {
        throw new ProviderError(`Runner ${stage} failed to finish.`, { code: /timed out/iu.test(error.message) ? "TIMEOUT" : "PROVIDER_FAILED", details: { stage } });
      }
      const { events, malformed } = parseEvents(run.stdout);
      const failed = [...events].reverse().find((event) => event.type === "turn.failed" || event.type === "error");
      if (run.code !== 0 || failed) {
        throw new ProviderError(`Runner ${stage} returned an error.`, { code: classifyCodexFailure(`${run.stderr.slice(-2000)}\n${JSON.stringify(failed ?? {}).slice(0, 2000)}`), details: { stage, exit: run.code } });
      }
      const completed = [...events].reverse().find((event) => event.type === "turn.completed");
      const messages = events.filter((event) => event.type === "item.completed" && event.item?.type === "agent_message");
      if (malformed !== 0 || !completed || messages.length === 0) throw new ProviderError("The sealed Codex call's event stream isn't whole, so whether it acted can't be told.", { code: "CODEX_RECEIPT_INCOMPLETE", details: { stage } });
      const acting = events.filter((event) => ["item.started", "item.updated", "item.completed"].includes(event.type) && event.item
        && !["agent_message", "reasoning", "todo_list", "error"].includes(event.item.type));
      const actions = new Set(acting.filter((event) => !isIntrospection(event.item)).map((event, index) => event.item.id ?? `item-${index}`)).size;
      const introspection = new Set(acting.filter((event) => isIntrospection(event.item)).map((event, index) => event.item.id ?? `item-${index}`)).size;
      if (actions !== 0) throw new ProviderError("The sealed Codex call took an action; its answer is refused.", { code: "CODEX_ACTION_TAKEN", details: { stage, actions } });
      let value;
      try { value = JSON.parse(String(messages.at(-1).item.text ?? "").trim()); } catch { value = null; }
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProviderError(`Runner ${stage} gave no structured answer.`, { code: "PROVIDER_MALFORMED", details: { stage } });
      const thread = events.find((event) => event.type === "thread.started");
      const usage = completed.usage ?? {};
      return {
        value,
        receipt: Object.freeze({
          provider: this.provider,
          model: this.model || "codex default",
          effort: this.effort,
          session_id: thread?.thread_id ?? `codex-${randomUUID()}`,
          duration_ms: Date.now() - started,
          input_tokens: usage.input_tokens ?? null,
          cache_read_input_tokens: usage.cached_input_tokens ?? null,
          output_tokens: usage.output_tokens ?? null,
          reasoning_output_tokens: usage.reasoning_output_tokens ?? null,
          isolation: this.isolation,
          actions: 0,
          introspection_calls: introspection
        })
      };
    } finally {
      await fs.rm(folder, { recursive: true, force: true });
    }
  }
}
