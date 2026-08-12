import { ProviderError } from "../core/errors.mjs";

function extractText(payload) {
  return (payload.content ?? [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

export class AnthropicProvider {
  constructor({ apiKey, model, timeoutMs = 180000, maxOutputTokens = 12000 } = {}) {
    this.id = "anthropic";
    this.apiKey = apiKey;
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.maxOutputTokens = maxOutputTokens;
  }

  async generate({ system, user, metadata = {} }) {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxOutputTokens,
        system,
        messages: [{ role: "user", content: user }]
      }),
      signal: AbortSignal.timeout(this.timeoutMs)
    }).catch((cause) => {
      throw new ProviderError(`Anthropic request failed during ${metadata.stage ?? "generation"}.`, { cause });
    });

    const requestId = response.headers.get("request-id") ?? undefined;
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new ProviderError(`Anthropic returned HTTP ${response.status}.`, {
        details: { requestId, status: response.status, error: payload.error ?? payload }
      });
    }
    if (payload.stop_reason === "refusal") {
      throw new ProviderError("Anthropic refused the request.", {
        details: { requestId, responseId: payload.id, stopReason: payload.stop_reason }
      });
    }
    const text = extractText(payload);
    if (!text) {
      throw new ProviderError("Anthropic returned no text.", { details: { requestId, responseId: payload.id } });
    }
    return {
      provider: this.id,
      model: this.model,
      text,
      requestId,
      responseId: payload.id,
      usage: payload.usage
    };
  }
}
