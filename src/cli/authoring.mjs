#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateBases } from "../authoring/bases.mjs";
import { buildMapFiles, checkMapFiles, writeMapFiles } from "../authoring/map-files.mjs";
import { createCurrentProjection } from "../authoring/projection.mjs";
import { assertProjectionCurrent, writeProjectionAtomically } from "../authoring/projection-check.mjs";
import { createProposal } from "../authoring/proposal.mjs";
import { buildProposal, checkProposal } from "../authoring/proposal-builder.mjs";
import { reconcileApprovedProposal } from "../authoring/reconcile.mjs";

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
  const [command, ...args] = process.argv.slice(2);
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
  if (command === "proposal-new") {
    const options = parseOptions(args, { repeatable: new Set(["node", "edge", "regression"]) });
    if (!options.id) throw Object.assign(new Error("proposal-new requires --id."), { code: "PROPOSAL_ID_REQUIRED" });
    print({ ok: true, command, ...(await createProposal({ root, id: options.id, nodeIds: options.node ?? [], edgeIds: options.edge ?? [], regressionIds: options.regression ?? [] })) });
    return;
  }
  if (command === "proposal-build") {
    const options = parseOptions(args);
    if (!options.id) throw Object.assign(new Error("proposal-build requires --id."), { code: "PROPOSAL_ID_REQUIRED" });
    print({ ok: true, command, ...(await buildProposal({ root, id: options.id })) });
    return;
  }
  if (command === "proposal-check") {
    const options = parseOptions(args);
    if (!options.id) throw Object.assign(new Error("proposal-check requires --id."), { code: "PROPOSAL_ID_REQUIRED" });
    print({ ok: true, command, ...(await checkProposal({ root, id: options.id })) });
    return;
  }
  if (command === "proposal-reconcile") {
    const options = parseOptions(args);
    if (!options.id || !options["packet-id"] || !options.packet || !options.sha256) throw Object.assign(new Error("proposal-reconcile requires --id, --packet-id, --packet, and --sha256."), { code: "AUTHORING_ARGUMENT_INVALID" });
    print({ ok: true, command, ...(await reconcileApprovedProposal({ root, id: options.id, packetId: options["packet-id"], packetPath: options.packet, packetSha256: options.sha256 })) });
    return;
  }
  throw new Error(`Unknown authoring command: ${command ?? "(missing)"}`);
}

function parseOptions(args, { repeatable = new Set() } = {}) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith("--") || value === undefined || value.startsWith("--")) throw Object.assign(new Error(`Invalid option sequence near ${flag ?? "(end)"}.`), { code: "AUTHORING_ARGUMENT_INVALID" });
    const name = flag.slice(2);
    if (!/^[a-z][a-z-]*$/.test(name)) throw Object.assign(new Error(`Invalid option name: ${flag}.`), { code: "AUTHORING_ARGUMENT_INVALID" });
    if (repeatable.has(name)) options[name] = [...(options[name] ?? []), value];
    else if (Object.hasOwn(options, name)) throw Object.assign(new Error(`Duplicate option: ${flag}.`), { code: "AUTHORING_ARGUMENT_INVALID" });
    else options[name] = value;
  }
  return options;
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ ok: false, code: error.code ?? "AUTHORING_COMMAND_FAILED", message: error.message })}\n`);
  process.exitCode = 1;
});
