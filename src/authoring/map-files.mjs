import fs from "node:fs/promises";
import path from "node:path";
import { renderMermaidMap } from "./mermaid-generator.mjs";

export const INNER_CHILD_MAP_PATH = "docs/INNER-CHILD-THERAPY-MAP.md";

export function buildMapFiles(authority) {
  return new Map([[
    INNER_CHILD_MAP_PATH,
    renderMermaidMap({
      bundle: authority.bundle,
      registries: authority.registries,
      mapId: "inner-child",
      projectionInputSha256: authority.projectionInputSha256
    })
  ]]);
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
