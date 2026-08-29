import { canonicalJson, sha256Bytes } from "./canonical-json.mjs";
import { edgeDigest, validateSchema } from "./contract.mjs";
import { activeOverlays } from "./overlay.mjs";

const WIDTH = 300;
const HEIGHT = 140;
const X_GAP = 440;
const Y_GAP = 220;
const GRAPH_GAP = 4200;

function canvasId(type, stableId) {
  return sha256Bytes(Buffer.from(`${type}\0${stableId}`, "utf8"));
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function buildCanvas({ bundle, registries }) {
  const nodes = [];
  const edges = [];
  const canvasNodeIdByGraphNode = new Map();
  const graphs = [...bundle.graphs].sort((left, right) => compareText(left.graphId, right.graphId));
  for (const [graphIndex, graph] of graphs.entries()) {
    const sortedNodes = [...graph.nodes].sort((left, right) => left.tier - right.tier || right.priority - left.priority || compareText(left.id, right.id));
    const tierSlots = new Map();
    for (const node of sortedNodes) {
      const slot = tierSlots.get(node.tier) ?? 0;
      tierSlots.set(node.tier, slot + 1);
      const id = canvasId("graph-node", node.id);
      canvasNodeIdByGraphNode.set(node.id, id);
      nodes.push({
        id,
        type: "file",
        file: `current/nodes/${graph.graphId}/${node.id}.md`,
        x: graphIndex * GRAPH_GAP + (node.tier - 1) * X_GAP,
        y: slot * Y_GAP,
        width: WIDTH,
        height: HEIGHT
      });
    }
  }
  for (const graph of graphs) {
    for (const edge of graph.edges) {
      edges.push({
        id: edgeDigest({ graphId: graph.graphId, ...edge }),
        fromNode: canvasNodeIdByGraphNode.get(edge.from),
        toNode: canvasNodeIdByGraphNode.get(edge.to),
        label: edge.relation
      });
    }
  }

  const overlays = activeOverlays(registries);
  if (overlays.length) {
    const overlayX = graphs.length * GRAPH_GAP;
    nodes.push({
      id: canvasId("overlay-group", "owner-approved-not-compiled"),
      type: "group",
      label: "Owner-approved, not compiled",
      x: overlayX - 40,
      y: -80,
      width: WIDTH + 80,
      height: overlays.length * Y_GAP + 100
    });
    for (const [index, item] of overlays.entries()) {
      nodes.push({
        id: canvasId("overlay", item.id),
        type: "text",
        text: `OWNER-APPROVED, NOT COMPILED\n${item.id}\n${item.title}\n\n${item.description}`,
        x: overlayX,
        y: index * Y_GAP,
        width: WIDTH,
        height: HEIGHT,
        color: "3"
      });
    }
  }
  nodes.sort((left, right) => compareText(left.id, right.id));
  edges.sort((left, right) => compareText(left.id, right.id));
  const canvas = { nodes, edges };
  validateSchema("canvas", canvas, { label: "development graph Canvas" });
  if (new Set(nodes.map((node) => node.id)).size !== nodes.length) throw new Error("Canvas node ids are not unique.");
  if (new Set(edges.map((edge) => edge.id)).size !== edges.length) throw new Error("Canvas edge ids are not unique.");
  return canvas;
}

export function renderCanvas(options) {
  return canonicalJson(buildCanvas(options));
}
