import { loadConfig } from "../core/config.mjs";
import { OpenAIProvider } from "../providers/openai.mjs";
import { AnthropicProvider } from "../providers/anthropic.mjs";

const config = loadConfig({ mode: "api" });
const providers = [
  new OpenAIProvider({
    apiKey: config.openaiApiKey,
    model: config.openaiModel,
    timeoutMs: config.requestTimeoutMs,
    maxOutputTokens: 128
  }),
  new AnthropicProvider({
    apiKey: config.anthropicApiKey,
    model: config.anthropicModel,
    timeoutMs: config.requestTimeoutMs,
    maxOutputTokens: 128
  })
];

const results = [];
for (const provider of providers) {
  try {
    const response = await provider.generate({
      system: "This is an entitlement check. Reply with exactly OK.",
      user: "OK",
      metadata: { stage: "entitlement-check" }
    });
    results.push({ provider: provider.id, model: provider.model, ok: true, responseId: response.responseId });
  } catch (error) {
    results.push({ provider: provider.id, model: provider.model, ok: false, error: error.message, details: error.details });
  }
}
console.log(JSON.stringify(results, null, 2));
if (results.some((item) => !item.ok)) process.exitCode = 1;
