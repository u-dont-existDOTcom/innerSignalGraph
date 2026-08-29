#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateBases } from "../authoring/bases.mjs";
import { buildMapFiles, checkMapFiles, writeMapFiles } from "../authoring/map-files.mjs";
import { createCurrentProjection } from "../authoring/projection.mjs";
import { assertProjectionCurrent, writeProjectionAtomically } from "../authoring/projection-check.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function validateClassification() {
  const file = path.join(root, "authoring", "migration", "map-classification.json");
  const value = JSON.parse(await fs.readFile(file, "utf8"));
  if (value.nodes.length !== 46 || value.edges.length !== 57 || value.operatingBullets.length !== 11 || value.overlayRows.length !== 11 || value.layout.length !== 6) {
    const error = new Error("Legacy map classification inventory is incomplete.");
    error.code = "MAP_CLASSIFICATION_INCOMPLETE";
    throw error;
  }
  if (value.edges.some((edge) => !edge.id || !edge.edge) || value.edgeClassification.count !== value.edges.length) {
    throw new Error("Legacy map edge classification is inconsistent.");
  }
  return value;
}

async function buildAll() {
  const projected = await createCurrentProjection({ root });
  const maps = buildMapFiles(projected.authority);
  return { ...projected, maps };
}

async function main() {
  const [command] = process.argv.slice(2);
  if (command === "project") {
    const built = await buildAll();
    await validateBases({ root });
    await validateClassification();
    await writeProjectionAtomically(built.output, path.join(root, "authoring", "obsidian", "current"));
    await writeMapFiles({ root, files: built.maps });
    print({ ok: true, command, projectionInputSha256: built.authority.projectionInputSha256, generatedFiles: built.output.size, maps: built.maps.size });
    return;
  }
  if (command === "check") {
    const built = await buildAll();
    await assertProjectionCurrent(built.output, path.join(root, "authoring", "obsidian", "current"));
    print({ ok: true, command, projectionInputSha256: built.authority.projectionInputSha256, generatedFiles: built.output.size });
    return;
  }
  if (command === "validate") {
    const built = await buildAll();
    const bases = await validateBases({ root });
    await validateClassification();
    print({ ok: true, command, projectionInputSha256: built.authority.projectionInputSha256, generatedFiles: built.output.size, bases: bases.count, maps: built.maps.size });
    return;
  }
  if (command === "maps") {
    const built = await buildAll();
    await writeMapFiles({ root, files: built.maps });
    print({ ok: true, command, maps: built.maps.size });
    return;
  }
  if (command === "maps-check") {
    const built = await buildAll();
    await checkMapFiles({ root, files: built.maps });
    const committedCanvas = await fs.readFile(path.join(root, "authoring", "obsidian", "current", "maps", "development-graph.canvas"), "utf8");
    if (committedCanvas !== built.output.get("current/maps/development-graph.canvas")) throw Object.assign(new Error("Generated Canvas drift."), { code: "GENERATED_CANVAS_DRIFT" });
    print({ ok: true, command, maps: built.maps.size, canvas: true });
    return;
  }
  throw new Error(`Unknown authoring command: ${command ?? "(missing)"}`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ ok: false, code: error.code ?? "AUTHORING_COMMAND_FAILED", message: error.message })}\n`);
  process.exitCode = 1;
});
