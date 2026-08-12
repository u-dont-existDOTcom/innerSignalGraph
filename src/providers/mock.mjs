import fs from "node:fs/promises";
import { ProviderError } from "../core/errors.mjs";

export class MockProvider {
  constructor({ id, model = `mock-${id}`, fixturePath }) {
    this.id = id;
    this.model = model;
    this.fixturePath = fixturePath;
    this.fixture = null;
  }

  async generate({ metadata = {} }) {
    if (!this.fixture) {
      this.fixture = JSON.parse(await fs.readFile(this.fixturePath, "utf8"));
    }
    const key = metadata.fixtureKey ?? metadata.stage;
    const value = this.fixture[this.id]?.[key];
    if (!value) {
      throw new ProviderError(`No mock response for ${this.id}:${key}.`);
    }
    return {
      provider: this.id,
      model: this.model,
      text: typeof value === "string" ? value : JSON.stringify(value),
      requestId: `mock-${this.id}-${key}`,
      responseId: `mock-${this.id}-${key}`,
      usage: { input_tokens: 0, output_tokens: 0 }
    };
  }
}
