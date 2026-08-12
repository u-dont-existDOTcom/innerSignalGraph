import { ProviderError } from "../core/errors.mjs";

function extractText(payload) {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) return payload.output_text;
  const parts = [];
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (typeof content.text === "string") parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}

export class OpenAIProvider {
  constructor({ apiKey, model, timeoutMs = 180000, maxOutputTokens = 12000 } = {}) {
    this.id = "openai";
    this.apiKey = apiKey;
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.maxOutputTokens = maxOutputTokens;
  }

  async generate({ system, user, metadata = {} }) {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        instructions: system,
        input: user,
        max_output_tokens: this.maxOutputTokens,
        store: false
      }),
      signal: AbortSignal.timeout(this.timeoutMs)
    }).catch((cause) => {
      throw new ProviderError(`OpenAI request failed during ${metadata.stage ?? "generation"}.`, { cause });
    });

    const requestId = response.headers.get("x-request-id") ?? undefined;
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new ProviderError(`OpenAI returned HTTP ${response.status}.`, {
        details: { requestId, status: response.status, error: payload.error ?? payload }
      });
    }
    const text = extractText(payload);
    if (!text) {
      throw new ProviderError("OpenAI returned no text.", { details: { requestId, responseId: payload.id } });
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
