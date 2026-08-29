import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileGuideGraphs } from "../src/guide-graph/compiler.mjs";
import { activeOverlays, loadOverlayRegistries, validateOverlayRegistries } from "../src/authoring/overlay.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let bundle;
let resolution;
let registries;

test.before(async () => {
  bundle = await compileGuideGraphs({ root, write: false });
  resolution = JSON.parse(await fs.readFile(path.join(root, "authoring/migration/owner-map-resolution-2026-08-29.json"), "utf8"));
  registries = await loadOverlayRegistries({ root, bundle, additionalSourceIds: resolution.decisions.map((item) => item.id) });
});

test("owner-approved overlays have authority, sources, anchors, and never enter planner graphs", () => {
  const active = activeOverlays(registries);
  assert.equal(active.length, 12);
  for (const item of active) {
    assert(item.authority.startsWith("OWNER.MAP.RESOLUTION."));
    assert(item.sourceRefs.length > 1);
    assert(item.anchorNodeIds.length > 0);
    assert.equal(item.reconciledNodeIds.length, 0);
  }
  const graphIds = new Set(bundle.graphs.flatMap((graph) => graph.nodes.map((node) => node.id)));
  assert(active.every((item) => !graphIds.has(item.id)));
  assert.equal(JSON.stringify(bundle).includes("OVERLAY."), false);
});

test("overlay validation fails closed for collisions and unresolved provenance", () => {
  const copy = structuredClone(registries);
  copy[0].items[0].id = "IC.MEET_GUARD";
  assert.throws(() => validateOverlayRegistries(copy, bundle, { additionalSourceIds: resolution.decisions.map((item) => item.id) }), { code: "AUTHORING_SCHEMA_INVALID" });
  const unresolved = structuredClone(registries);
  unresolved[0].items[0].sourceRefs.push("UNKNOWN.SOURCE");
  assert.throws(() => validateOverlayRegistries(unresolved, bundle, { additionalSourceIds: resolution.decisions.map((item) => item.id) }), { code: "OVERLAY_SOURCE_UNKNOWN" });
  const conflict = structuredClone(registries);
  conflict[0].items[0].reconciledNodeIds.push("IC.MEET_GUARD");
  assert.throws(() => validateOverlayRegistries(conflict, bundle, { additionalSourceIds: resolution.decisions.map((item) => item.id) }), { code: "OVERLAY_RECONCILIATION_CONFLICT" });
});

test("legacy map migration ledger has complete zero-loss inventories", async () => {
  const ledger = JSON.parse(await fs.readFile(path.join(root, "authoring/migration/map-classification.json"), "utf8"));
  assert.equal(ledger.nodes.length, 46);
  assert.equal(ledger.edges.length, 57);
  assert.equal(ledger.layout.length, 6);
  assert.equal(ledger.operatingBullets.length, 11);
  assert.equal(ledger.overlayRows.length, 11);
  assert.equal(ledger.edgeClassification.classification, "retired-with-reason");
  assert.equal(ledger.edgeClassification.count, 57);
  assert.equal(new Set(ledger.edges.map((edge) => edge.id)).size, 57);
});
