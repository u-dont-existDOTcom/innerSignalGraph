import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sha256Bytes } from "../src/authoring/canonical-json.mjs";
import { nodeRecordFromAuthoringNote } from "../src/authoring/note-parser.mjs";
import { createCurrentProjection, projectionInputToken } from "../src/authoring/projection.mjs";
import { assertProjectionCurrent, compareProjection, writeProjectionAtomically } from "../src/authoring/projection-check.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let projected;

test.before(async () => {
  projected = await createCurrentProjection({ root });
});

test("current projection has the exact canonical inventories and resolved links", () => {
  const keys = [...projected.output.keys()];
  assert.equal(keys.filter((item) => item.includes("/nodes/")).length, 39);
  assert.equal(keys.filter((item) => item.includes("/edges/")).length, 35);
  assert.equal(keys.filter((item) => item.includes("/sources/")).length, 68);
  assert.equal(keys.filter((item) => item.includes("/regressions/")).length, 12);
  assert.equal(keys.filter((item) => item.includes("/governance/amendments/")).length, 15);
  assert.equal(keys.filter((item) => item.includes("/governance/decisions/")).length, 15);
  assert(keys.includes("current/maps/development-graph.canvas"));
  assert(keys.includes("current/manifest.json"));
  const collisionNote = projected.output.get("current/nodes/inner-child-directed-graph/IC.NEUTRAL_WITNESS.md");
  assert.match(collisionNote, /\[\[current\/sources\/inner-child-guide\/IC\.NEUTRAL_WITNESS\]\]/);
  const amendmentNote = projected.output.get("current/nodes/inner-child-directed-graph/IC.BEST_FRIEND_PERSPECTIVE.md");
  assert.match(amendmentNote, /\[\[current\/governance\/amendments\/AMEND\.IC\.BEST_FRIEND_PROMPT\]\]/);
  const crossEdge = [...projected.output.entries()].find(([relative, text]) => relative.includes("current/edges/inner-child-somatic-cross-guide/") && text.includes("relation: may-enable"));
  assert.match(crossEdge[1], /current\/nodes\/inner-child-directed-graph\/IC\.SOLAR_PLEXUS_RELAXATION/);
  assert.match(crossEdge[1], /current\/nodes\/inner-child-directed-graph\/IC\.BORROW_LOVE/);
});

test("node projection reconstructs exact sparse canonical records", () => {
  for (const graph of projected.authority.bundle.graphs) {
    for (const node of graph.nodes) {
      const note = projected.output.get(`current/nodes/${graph.graphId}/${node.id}.md`);
      assert.deepEqual(nodeRecordFromAuthoringNote(note, { label: node.id }), node);
    }
  }
  const sparse = projected.authority.bundle.graphs.flatMap((graph) => graph.nodes).find((node) => Object.keys(node.activation).length === 1);
  const graph = projected.authority.bundle.graphs.find((candidate) => candidate.nodes.includes(sparse));
  assert.deepEqual(Object.keys(nodeRecordFromAuthoringNote(projected.output.get(`current/nodes/${graph.graphId}/${sparse.id}.md`)).activation), Object.keys(sparse.activation));
});

test("two independent projections are byte-identical", async () => {
  const second = await createCurrentProjection({ root });
  assert.deepEqual([...second.output.keys()], [...projected.output.keys()]);
  for (const [relative, text] of projected.output) assert.equal(second.output.get(relative), text, relative);
  assert.equal(second.authority.projectionInputSha256, projected.authority.projectionInputSha256);
});

test("input token changes for any changed authoritative input hash", () => {
  const records = projected.authority.authoritativeInputs;
  const changed = structuredClone(records);
  changed[0].sha256 = "f".repeat(64);
  assert.notEqual(projectionInputToken(records), projectionInputToken(changed));
});

test("atomic write and check detect edits, additions, and removals without rewriting", async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-projection-"));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const destination = path.join(temporary, "current");
  await writeProjectionAtomically(projected.output, destination);
  assert.equal((await assertProjectionCurrent(projected.output, destination)).ok, true);
  const node = path.join(destination, "nodes", "inner-child-directed-graph", "IC.NEUTRAL_WITNESS.md");
  await fs.appendFile(node, "edited\n");
  const before = sha256Bytes(await fs.readFile(node));
  const report = await compareProjection(projected.output, destination);
  assert.equal(report.ok, false);
  assert(report.differing.some((item) => item.path.endsWith("IC.NEUTRAL_WITNESS.md")));
  await assert.rejects(() => assertProjectionCurrent(projected.output, destination), { code: "GENERATED_PROJECTION_DRIFT" });
  assert.equal(sha256Bytes(await fs.readFile(node)), before, "check mode must not write");
  await fs.writeFile(path.join(destination, "unexpected.md"), "unexpected\n");
  await fs.rm(path.join(destination, "regressions", "G001.md"));
  const inventory = await compareProjection(projected.output, destination);
  assert(inventory.unexpected.includes("unexpected.md"));
  assert(inventory.missing.includes("regressions/G001.md"));
});

test("projection manifest is non-self-referential and contains no local identity", () => {
  const manifest = JSON.parse(projected.output.get("current/manifest.json"));
  assert(!manifest.generatedFiles.some((item) => item.path.endsWith("current/manifest.json")));
  assert.equal(manifest.projectionInputSha256, projected.authority.projectionInputSha256);
  const text = projected.output.get("current/manifest.json");
  assert.doesNotMatch(text, /\/home\//);
  assert.doesNotMatch(text, /(?:generatedAt|timestamp|commit)/i);
});
