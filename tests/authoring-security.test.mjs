import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { escapeMermaidLabel } from "../src/authoring/mermaid-generator.mjs";
import { assertPublicAuthoringText, resolveInside } from "../src/authoring/private-data-boundary.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("authoring boundary rejects traversal, credentials, transcripts, and Mermaid injection", () => {
  assert.throws(() => resolveInside(root, "authoring/../../escape"), { code: "AUTHORING_PATH_TRAVERSAL" });
  assert.throws(() => assertPublicAuthoringText("GH_TOKEN=secret"), { code: "PRIVATE_AUTHORING_CONTENT" });
  assert.throws(() => assertPublicAuthoringText("therapy transcript: user: this is deliberately long synthetic private case material"), { code: "PRIVATE_AUTHORING_CONTENT" });
  const escaped = escapeMermaidLabel(`bad"]\nX --> Y{`);
  assert.doesNotMatch(escaped, /\[|\]|\{|\}|\n/);
});

test("authoring implementation contains no network or model subprocess integration", async () => {
  const files = (await fs.readdir(path.join(root, "src", "authoring"))).filter((file) => file.endsWith(".mjs"));
  const source = (await Promise.all(files.map((file) => fs.readFile(path.join(root, "src", "authoring", file), "utf8")))).join("\n");
  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/);
  assert.doesNotMatch(source, /from\s+["'][^"']*(?:openai|anthropic|claude|codex)[^"']*["']/i);
  assert.doesNotMatch(source, /execFileAsync\([^\n]*(?:claude|codex|openai|anthropic)/i);
  assert.doesNotMatch(source, /execFileAsync\(\s*["'](?:curl|wget|ssh)["']/);
});
