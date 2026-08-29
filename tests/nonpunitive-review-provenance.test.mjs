import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { compileGuideGraphs } from "../src/guide-graph/compiler.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const d09Id = "OWNER.MAP.RESOLUTION.2026-08-29.D09";
const amendmentId = "AMEND.IC.NONPUNITIVE_REVIEW";
const exactOwnerText = "Review is critical. Notice recognition, repair, missed and kept promises, and what should change next without turning review into a trial. No mandatory morning/evening cadence is established.";

async function readJson(relative) {
  return JSON.parse(await fs.readFile(path.join(root, relative), "utf8"));
}

async function sha256(relative) {
  return createHash("sha256").update(await fs.readFile(path.join(root, relative))).digest("hex");
}

test("D09 has one exact owner-amendment provenance bridge and D10 remains excluded", async () => {
  const resolution = await readJson("authoring/migration/owner-map-resolution-2026-08-29.json");
  const amendments = await readJson("guides/owner-amendments.json");
  const manifest = await readJson("guides/manifest.json");
  const d09 = resolution.decisions.find((item) => item.id === d09Id);
  const matching = amendments.items.filter((item) => item.id === amendmentId);

  assert.equal(d09.statement, exactOwnerText);
  assert.equal(d09.status, "approved-qualified");
  assert.equal(d09.futureGuideProposalRequired, true);
  assert.equal(matching.length, 1);
  assert.deepEqual(matching[0], {
    id: amendmentId,
    domain: "inner-child",
    status: "owner-approved",
    text: exactOwnerText
  });
  assert.equal(amendments.version, "2026-08-29-r2");
  assert.equal(manifest.sources.find((item) => item.id === "owner-amendments").version, amendments.version);
  assert.equal(amendments.items.some((item) => item.id.includes("COMMON_HUMANITY")), false);
});

test("the D09 amendment is source-mapped but remains uncompiled pending owner decisions", async () => {
  const bundle = await compileGuideGraphs({ root, write: false });
  const sourceMap = bundle.sourceMaps.find((item) => item.guideId === "owner-amendments");
  const section = sourceMap.sections.find((item) => item.id === amendmentId);
  const candidateNodeRefs = bundle.graphs.flatMap((graph) => graph.nodes).flatMap((node) => node.sourceRefs ?? []);
  const overlays = await readJson("authoring/overlays/inner-child.overlay.json");
  const d09Overlay = overlays.items.find((item) => item.id === "OVERLAY.IC.NONPUNITIVE_REVIEW");

  assert.equal(section.excerpt, exactOwnerText);
  assert.equal(section.status, "owner-approved");
  assert.equal(section.domain, "inner-child");
  assert.equal(section.sha256, createHash("sha256").update(exactOwnerText).digest("hex"));
  assert.equal(candidateNodeRefs.includes(amendmentId), false);
  assert.equal(d09Overlay.status, "owner-approved-uncompiled");
  assert.deepEqual(d09Overlay.reconciledNodeIds, []);
});

test("the canonical guide source family remains byte-identical to the proposal baseline", async () => {
  assert.equal(await sha256("guides/inner-child-guide.txt"), "a481cc657ea6e92761a90019a33af9fc6b926037583524f58bbb4dc4953297b3");
  assert.equal(await sha256("guides/somatic-sequencing-guide.txt"), "f865c8d93221cccd8e49f49adbf0961051f0c0775603e785420ee89509acb419");
  assert.equal(await sha256("guides/source-layout.json"), "0b2701c8b48569e57c71ffda468ba9f66c92a398832f4eafe9f1b693744a0299");
  assert.equal(await sha256("guides/vagal-blitz-source.pdf"), "79181c31e8cb5af5b20b1269c448bb3afbde4d903e7e609d5b059cb63399af5c");
});
