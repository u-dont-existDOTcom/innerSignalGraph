import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCanvas, renderCanvas } from "../src/authoring/canvas-generator.mjs";
import { compileGuideGraphs } from "../src/guide-graph/compiler.mjs";
import { loadOverlayRegistries } from "../src/authoring/overlay.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Canvas deterministically mirrors all graph records and separates overlays", async () => {
  const bundle = await compileGuideGraphs({ root, write: false });
  const resolution = JSON.parse(await fs.readFile(path.join(root, "authoring/migration/owner-map-resolution-2026-08-29.json"), "utf8"));
  const registries = await loadOverlayRegistries({ root, bundle, additionalSourceIds: resolution.decisions.map((item) => item.id) });
  const options = { bundle, registries };
  const canvas = buildCanvas(options);
  assert.equal(canvas.nodes.filter((node) => node.type === "file").length, 39);
  assert.equal(canvas.nodes.filter((node) => node.type === "text").length, 12);
  assert.equal(canvas.edges.length, 35);
  assert(canvas.nodes.every((node) => Number.isInteger(node.x) && Number.isInteger(node.y)));
  assert.equal(new Set(canvas.nodes.map((node) => node.id)).size, canvas.nodes.length);
  assert.equal(new Set(canvas.edges.map((edge) => edge.id)).size, canvas.edges.length);
  assert.equal(renderCanvas(options), renderCanvas(options));
  assert(canvas.nodes.filter((node) => node.type === "text").every((node) => node.text.startsWith("OWNER-APPROVED, NOT COMPILED")));
});
