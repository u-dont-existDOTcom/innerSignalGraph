import path from "node:path";
import { OpenAIProvider } from "./openai.mjs";
import { AnthropicProvider } from "./anthropic.mjs";
import { CodexCliProvider } from "./codex-cli.mjs";
import { ClaudeCliProvider } from "./claude-cli.mjs";
import { MockProvider } from "./mock.mjs";
import { projectRoot } from "../core/config.mjs";

// `providers` names the providers to build in api mode (both by default), the same option `loadConfig` takes. An API key belongs to
// one provider, so a deployment that holds only Anthropic's key builds only the Anthropic providers: no provider is ever made
// with a key it was not given, and the one that was not built is missing from the result rather than present and unusable.
// `mock` and `cli` hold no keys, so they build both whatever is named.
export function createProviders(config, { fixturePath, providers = ["openai", "anthropic"] } = {}) {
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

  const built = {};
  if (providers.includes("openai")) {
    built.openai = new OpenAIProvider({
      apiKey: config.openaiApiKey,
      model: config.openaiModel,
      timeoutMs: config.requestTimeoutMs,
      maxOutputTokens: config.maxOutputTokens
    });
  }
  if (providers.includes("anthropic")) {
    built.anthropic = new AnthropicProvider({
      apiKey: config.anthropicApiKey,
      model: config.anthropicModel,
      timeoutMs: config.requestTimeoutMs,
      maxOutputTokens: config.maxOutputTokens
    });
    built.renderer = new AnthropicProvider({
      apiKey: config.anthropicApiKey,
      model: config.responseRendererModel || config.anthropicModel,
      timeoutMs: config.requestTimeoutMs,
      maxOutputTokens: config.maxOutputTokens
    });
  }
  return built;
}
