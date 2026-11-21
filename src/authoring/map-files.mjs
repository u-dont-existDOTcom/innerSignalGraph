import fs from "node:fs/promises";
import path from "node:path";
import { renderBoxGuidance } from "./box-guidance.mjs";
import { renderMermaidMap } from "./mermaid-generator.mjs";

export const INNER_CHILD_MAP_PATH = "docs/INNER-CHILD-THERAPY-MAP.md";
export const INNER_CHILD_BOX_GUIDANCE_PATH = "docs/INNER-CHILD-BOX-GUIDANCE.md";
export const SERVED_REFERENCES_DIR = "plugins/inner-signal-therapy/skills/inner-signal-therapy/references";
export const SERVED_INNER_CHILD_MAP_PATH = `${SERVED_REFERENCES_DIR}/INNER-CHILD-THERAPY-MAP.md`;
export const SERVED_INNER_CHILD_BOX_GUIDANCE_PATH = `${SERVED_REFERENCES_DIR}/INNER-CHILD-BOX-GUIDANCE.md`;
// Every file buildMapFiles writes, so a caller that must undo a failed write (reconciliation) restores all of them.
export const MAP_FILE_PATHS = Object.freeze([INNER_CHILD_MAP_PATH, INNER_CHILD_BOX_GUIDANCE_PATH, SERVED_INNER_CHILD_MAP_PATH, SERVED_INNER_CHILD_BOX_GUIDANCE_PATH]);

// The docs/ files are the reviewed audit copies; the plugin's served references are byte-equal copies, written and
// checked by the same command so a chat never receives a map or box guidance that differs from the graph.
export function buildMapFiles(authority) {
  const map = renderMermaidMap({
    bundle: authority.bundle,
    registries: authority.registries,
    mapId: "inner-child",
    projectionInputSha256: authority.projectionInputSha256
  });
  const boxes = renderBoxGuidance({ bundle: authority.bundle });
  return new Map([
    [INNER_CHILD_MAP_PATH, map],
    [INNER_CHILD_BOX_GUIDANCE_PATH, boxes],
    [SERVED_INNER_CHILD_MAP_PATH, map],
    [SERVED_INNER_CHILD_BOX_GUIDANCE_PATH, boxes]
  ]);
}

export async function checkMapFiles({ root, files }) {
  const differing = [];
  for (const [relative, expected] of files) {
    let actual = null;
    try {
      actual = await fs.readFile(path.join(root, relative), "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (actual !== expected) differing.push(relative);
  }
  if (differing.length) {
    const error = new Error(`Generated map drift: ${differing.join(", ")}`);
    error.code = "GENERATED_MAP_DRIFT";
    error.paths = differing;
    throw error;
  }
  return { ok: true, count: files.size };
}

export async function writeMapFiles({ root, files }) {
  for (const [relative, text] of files) {
    const file = path.join(root, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    await fs.writeFile(temporary, text, { encoding: "utf8", flag: "wx" });
    await fs.rename(temporary, file);
  }
}
