import fs from "node:fs/promises";
import path from "node:path";
import { validateSchema } from "./contract.mjs";

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

export function validateOverlayRegistries(registries, bundle, { additionalSourceIds = [] } = {}) {
  const nodeIds = new Set(bundle.graphs.flatMap((graph) => graph.nodes.map((node) => node.id)));
  const sourceIds = new Set([...bundle.sourceMaps.flatMap((sourceMap) => sourceMap.sections.map((section) => section.id)), ...additionalSourceIds]);
  const overlayIds = new Set();
  const mapIds = new Set();
  for (const registry of registries) {
    validateSchema("overlay", registry, { label: `overlay ${registry.mapId ?? "unknown"}` });
    if (mapIds.has(registry.mapId)) fail("OVERLAY_MAP_DUPLICATE", `Duplicate overlay map id: ${registry.mapId}`);
    mapIds.add(registry.mapId);
    for (const item of registry.items) {
      if (overlayIds.has(item.id)) fail("OVERLAY_ID_DUPLICATE", `Duplicate overlay id: ${item.id}`);
      if (nodeIds.has(item.id)) fail("OVERLAY_NODE_COLLISION", `Overlay id collides with a graph node: ${item.id}`);
      overlayIds.add(item.id);
      for (const ref of item.sourceRefs) {
        if (!sourceIds.has(ref)) fail("OVERLAY_SOURCE_UNKNOWN", `${item.id} cites unknown source ref ${ref}.`);
      }
      for (const nodeId of [...item.anchorNodeIds, ...item.reconciledNodeIds]) {
        if (!nodeIds.has(nodeId)) fail("OVERLAY_NODE_UNKNOWN", `${item.id} cites unknown graph node ${nodeId}.`);
      }
      if (item.status === "owner-approved-uncompiled" && item.reconciledNodeIds.length) {
        fail("OVERLAY_RECONCILIATION_CONFLICT", `${item.id} cannot be uncompiled and reconciled at the same time.`);
      }
      if (item.status === "reconciled" && item.anchorNodeIds.some((nodeId) => !item.reconciledNodeIds.includes(nodeId))) {
        fail("OVERLAY_RECONCILIATION_CONFLICT", `${item.id} has anchors outside its reconciled node inventory.`);
      }
    }
  }
  return registries;
}

export function activeOverlays(registries, { mapId = null } = {}) {
  return registries
    .filter((registry) => !mapId || registry.mapId === mapId)
    .flatMap((registry) => registry.items)
    .filter((item) => item.status === "owner-approved-uncompiled")
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

export async function loadOverlayRegistries({ root, bundle, additionalSourceIds = [], overlayRoot = path.join(root, "authoring", "overlays") }) {
  let files = [];
  try {
    files = (await fs.readdir(overlayRoot)).filter((file) => file.endsWith(".overlay.json")).sort();
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const registries = [];
  for (const file of files) {
    const text = await fs.readFile(path.join(overlayRoot, file), "utf8");
    const value = JSON.parse(text);
    registries.push(value);
  }
  return validateOverlayRegistries(registries, bundle, { additionalSourceIds });
}
