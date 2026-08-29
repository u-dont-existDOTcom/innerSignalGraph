import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileGuideGraphs } from "../src/guide-graph/compiler.mjs";
import { escapeMermaidLabel, renderMermaidMap } from "../src/authoring/mermaid-generator.mjs";
import { loadOverlayRegistries } from "../src/authoring/overlay.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("generated Mermaid is deterministic, complete, visibly layered, and injection-safe", async () => {
  const bundle = await compileGuideGraphs({ root, write: false });
  const resolution = JSON.parse(await fs.readFile(path.join(root, "authoring/migration/owner-map-resolution-2026-08-29.json"), "utf8"));
  const registries = await loadOverlayRegistries({ root, bundle, additionalSourceIds: resolution.decisions.map((item) => item.id) });
  const options = { bundle, registries, mapId: "inner-child", projectionInputSha256: "a".repeat(64) };
  const first = renderMermaidMap(options);
  assert.equal(renderMermaidMap(options), first);
  assert.match(first, /all 19 compiled inner-child nodes and all 10 compiled inner-child edges/);
  assert.equal((first.match(/OWNER-APPROVED \/ NOT COMPILED/g) ?? []).length, 12);
  assert.doesNotMatch(first, /pause for 1(?:–|-)​?3 breaths/i);
  assert.equal(escapeMermaidLabel('x"] --> HACK["y'), "x&quot;&#93; --&gt; HACK&#91;&quot;y");
});
