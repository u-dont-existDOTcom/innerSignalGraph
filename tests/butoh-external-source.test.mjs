import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { compileGuideGraphs } from "../src/guide-graph/compiler.mjs";

const root = new URL("../", import.meta.url);
const source = await fs.readFile(new URL("guides/somatic-sequencing-guide.txt", root), "utf8");
const layout = JSON.parse(await fs.readFile(new URL("guides/source-layout.json", root), "utf8"));
const manifest = JSON.parse(await fs.readFile(new URL("guides/manifest.json", root), "utf8"));

test("Butoh/ecstatic/enactment remains evidence-labeled, anecdote-bounded, external-only source material", () => {
  assert.match(source, /Evidence quality: loose, emerging, and not standardized as a clinical treatment/);
  assert.match(source, /Owner-reported origin:[\s\S]*anecdotal report about some events/);
  assert.match(source, /no standardized or clinically validated therapy called “Butoh ecstatic dance\.?”/);
  assert.match(source, /must not conduct physical Butoh, ecstatic dance, coercive or sexualized role-play, BDSM enactment, touch, restraint, impact/);
  assert.match(source, /clear, specific, sober, revocable consent/);
  assert.match(source, /dissociation, psychosis, mania/);
  assert.match(source, /are adverse signals, not “deep work\.?”/);
  assert.match(source, /not evidence that these elements are intrinsic to Butoh, ecstatic dance, or therapy generally/);
});

test("the external note is source-addressable but cannot be selected as an AI intervention", async () => {
  const somatic = layout.textGuides.find(item => item.guideId === "somatic-sequencing-guide");
  assert.ok(somatic.sections.some(item => item.id === "SOM.BUTOH_EXTERNAL"));
  const bundle = await compileGuideGraphs({ write: false });
  const mapped = bundle.sourceMaps.find(item => item.guideId === "somatic-sequencing-guide").sections.find(item => item.id === "SOM.BUTOH_EXTERNAL");
  assert.ok(mapped);
  const graphText = JSON.stringify(bundle.graphs.flatMap(graph => graph.nodes));
  assert.doesNotMatch(graphText, /Butoh|ecstatic dance|BDSM/i);
});

test("the active somatic-source hash is exact", () => {
  const entry = manifest.sources.find(item => item.id === "somatic-sequencing-guide");
  const hash = crypto.createHash("sha256").update(source).digest("hex");
  assert.equal(entry.sha256, hash);
  assert.match(entry.version, /external-modality-note-2026-09-08/);
});
