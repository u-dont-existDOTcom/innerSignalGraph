import path from "node:path";
import { OpenAIProvider } from "./openai.mjs";
import { AnthropicProvider } from "./anthropic.mjs";
import { CodexCliProvider } from "./codex-cli.mjs";
import { ClaudeCliProvider } from "./claude-cli.mjs";
import { MockProvider } from "./mock.mjs";
import { projectRoot } from "../core/config.mjs";

export function createProviders(config, { fixturePath } = {}) {
  if (config.mode === "mock") {
    const resolvedFixture = fixturePath ?? path.join(projectRoot, "fixtures/mock-responses/A001.json");
    return {
      openai: new MockProvider({ id: "openai", fixturePath: resolvedFixture }),
      anthropic: new MockProvider({ id: "anthropic", fixturePath: resolvedFixture }),
      renderer: new MockProvider({ id: "anthropic", model: "mock-renderer", fixturePath: resolvedFixture })
    };
  }

  if (config.mode === "cli") {
    return {
      openai: new CodexCliProvider({
        command: config.codexCommand,
        model: config.openaiModel,
        reasoningEffort: config.codexReasoningEffort,
        timeoutMs: config.requestTimeoutMs,
        cwd: config.cliWorkingDirectory,
        isolateConfig: config.cliIsolateConfig
      }),
      anthropic: new ClaudeCliProvider({
        command: config.claudeCommand,
        model: config.anthropicModel,
        effort: config.claudeEffort,
        timeoutMs: config.requestTimeoutMs,
        cwd: config.cliWorkingDirectory,
        isolateConfig: config.cliIsolateConfig
      }),
      renderer: new ClaudeCliProvider({
        command: config.claudeCommand,
        model: config.responseRendererModel,
        effort: config.claudeEffort,
        timeoutMs: config.requestTimeoutMs,
        cwd: config.cliWorkingDirectory,
        isolateConfig: config.cliIsolateConfig
      })
    };
  }

  return {
    openai: new OpenAIProvider({
      apiKey: config.openaiApiKey,
      model: config.openaiModel,
      timeoutMs: config.requestTimeoutMs,
      maxOutputTokens: config.maxOutputTokens
    }),
    anthropic: new AnthropicProvider({
      apiKey: config.anthropicApiKey,
      model: config.anthropicModel,
      timeoutMs: config.requestTimeoutMs,
      maxOutputTokens: config.maxOutputTokens
    }),
    renderer: new AnthropicProvider({
      apiKey: config.anthropicApiKey,
      model: config.responseRendererModel || config.anthropicModel,
      timeoutMs: config.requestTimeoutMs,
      maxOutputTokens: config.maxOutputTokens
    })
  };
}
