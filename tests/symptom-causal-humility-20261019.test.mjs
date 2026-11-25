import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { loadCompiledGuideGraphBundle } from "../src/guide-graph/compiler.mjs";
import { runGraphRegressionSuite } from "../src/guide-graph/regressions.mjs";
import { loadTherapyProtocol } from "../src/protocol/therapy-protocol.mjs";
import { assessGuideChangeProvenance } from "../scripts/check-guide-change-provenance.mjs";

// IS7: the owner approved two clarifications on 19 Oct 2026 (pull request 185, closed on 21 Nov 2026 as replaced by pull
// request 229). Pull request 229 carried his own words on both into guide r11 and the ordinary-want point into IC.MEET_GUARD;
// this change ports the map line on symptoms it left out: one owner amendment, one avoid line and one required nuance on
// IC.SOLAR_PLEXUS_RELAXATION, graph case G20261019C and queue entry PGQ-089. These static tests show where the lines are
// written, compiled and served; they do not show that a model follows them.

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const json = (path) => JSON.parse(read(path));
const count = (text, part) => text.split(part).length - 1;
const AMEND = "AMEND.CROSS.SYMPTOM_CAUSAL_HUMILITY_20261019";
const NODE = "IC.SOLAR_PLEXUS_RELAXATION";
const AVOID = "Do not interpret pain, illness or body tension as proof of suppressed emotion, childhood trauma, or an inner child's communication; do not displace indicated medical care.";
const NUANCE = "Emotional regulation and medical care may proceed together; the symptom is real, but its origin is not established by its emotional associations alone.";
const AMEND_TEXT = "The owner approved this clarification after checking unsupported psychosomatic inferences in a reparenting book (19 Oct 2026): bodily sensations, pain, illness or a physical symptom do not by themselves establish their medical cause, emotional suppression, an unmet inner-child need, or a hidden childhood event. A person's interpretation remains a revisable hypothesis rather than a diagnosis or recovered memory. Emotional care can accompany medical evaluation, practical safety, and ongoing treatment, but must not replace indicated assessment or imply that the person caused their illness. Preserve urgency for new/severe medical red flags and avoid assuming prior workups or care did not happen.";
const BOXES = ["../docs/INNER-CHILD-BOX-GUIDANCE.md", "../plugins/inner-signal-therapy/skills/inner-signal-therapy/references/INNER-CHILD-BOX-GUIDANCE.md"];

test("the owner's 19 Oct 2026 symptom amendment is recorded once, in his approved words, and the ordinary-want amendment is not ported", () => {
  const amendments = json("../guides/owner-amendments.json");
  assert.equal(amendments.version, "owner-amendments-2026-11-25-r25"); // i79 1a (25 Nov 2026) adds one after it
  const items = amendments.items.filter((item) => item.id === AMEND);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0], { id: AMEND, domain: "cross-guide", status: "owner-approved", approvedAt: "2026-10-19", text: AMEND_TEXT });
  assert.deepEqual(amendments.items.slice(-2).map((item) => item.id), [AMEND, "AMEND.IC.GENERATIONAL_VIEW_20261125"], "appended after every earlier item; only answer i79 1a's amendment (25 Nov 2026) comes after it");
  assert.ok(!amendments.items.some((item) => item.id === "AMEND.IC.ORDINARY_DESIRE_NO_TRAUMA_20261019"), "the ordinary-want amendment stays on its branch");
  assert.equal(json("../guides/manifest.json").sources.find((source) => source.id === "owner-amendments").version, amendments.version);
});

test("IC.SOLAR_PLEXUS_RELAXATION gains the avoid line and the nuance once each, bound to the amendment, with its activation and effects otherwise unchanged", () => {
  const node = json("../guide-graphs/candidates/inner-child.graph.json").nodes.find((candidate) => candidate.id === NODE);
  assert.deepEqual(node.sourceRefs, ["IC.REGULATION_BEFORE_DIALOGUE", "IC.HEART_SOLAR_LOOP", "AMEND.SOM.PREP_MODALITIES", "AMEND.IC.NEWER_GUIDE_PARTS_20261120", AMEND]);
  assert.deepEqual(node.avoid, ["Do not force breath, chase intensity, or assume tension proves a hidden memory.", AVOID]);
  assert.deepEqual(node.effects.requiredNuance, ["Relaxation may remove a bodily barrier but does not by itself repair credibility or resolve relational conflict.", NUANCE]);
  assert.deepEqual(node.effects.deferNodes, ["IC.DEEP_CHILD_DIALOGUE"]);
  assert.deepEqual(node.effects.blockNodes, []);
  assert.deepEqual(node.effects.forbiddenOverclaims, ["Do not claim that energy has definitively moved or trauma has been released."]);
  assert.equal(node.recommendations.length, 3, "no recommendation was added");
  assert.deepEqual(node.activation, {
    any: [{ field: "solar_plexus_tension", op: "eq", value: "present" }, { field: "activation", op: "eq", value: "high" }],
    none: [{ field: "present_safety", op: "eq", value: "unsafe" }, { field: "orientation", op: "eq", value: "disoriented" }]
  });
  const graph = read("../guide-graphs/candidates/inner-child.graph.json");
  assert.equal(count(graph, AVOID), 1, "only this node carries the avoid line");
  assert.equal(count(graph, NUANCE), 1, "only this node carries the nuance");
});

test("the compiled bundle, the served box advice and the map carry the lines", async () => {
  const bundle = await loadCompiledGuideGraphBundle({});
  const compiled = bundle.graphs.flatMap((graph) => graph.nodes).find((node) => node.id === NODE);
  assert.ok(compiled.avoid.includes(AVOID));
  assert.ok(compiled.effects.requiredNuance.includes(NUANCE));
  assert.ok(compiled.sourceRefs.includes(AMEND));
  for (const path of BOXES) {
    const boxes = read(path);
    const start = boxes.indexOf(`### ${NODE}: `);
    const box = boxes.slice(start, boxes.indexOf("\n### ", start + 1));
    assert.ok(box.includes(`- Avoid: ${AVOID}`), `${path}: the avoid line is in the box`);
    assert.ok(box.includes(`- Keep in mind: ${NUANCE}`), `${path}: the nuance is in the box`);
    assert.equal(count(boxes, AVOID), 1, `${path}: once`);
  }
  const served = JSON.stringify(loadTherapyProtocol({ boxGuidance: true }));
  assert.ok(served.includes("do not displace indicated medical care"), "the served protocol carries the box line");
});

test("graph case G20261019C passes, and fails when the nuance is taken out", async () => {
  const all = await runGraphRegressionSuite();
  assert.equal(all.ok, true);
  assert.equal(all.results.find((result) => result.id === "G20261019C")?.ok, true);
  const bundle = await loadCompiledGuideGraphBundle({});
  for (const graph of bundle.graphs) for (const node of graph.nodes) {
    if (node.id === NODE) node.effects.requiredNuance = node.effects.requiredNuance.filter((line) => line !== NUANCE);
  }
  const without = await runGraphRegressionSuite({ bundle });
  assert.deepEqual(without.results.filter((result) => !result.ok).map((result) => result.id), ["G20261019C"]);
});

test("PGQ-089 is queued once with every field, and the change passes the guide-change provenance rules", () => {
  const queue = read("../authoring/PENDING-PUBLIC-GUIDE-CHANGES.md");
  assert.equal(count(queue, "### PGQ-089 — "), 1);
  const body = queue.slice(queue.indexOf("### PGQ-089 — ")).split("\n## ")[0];
  assert.match(body, new RegExp(`^Caused by: Owner-approved 19 Oct 2026 ${AMEND}`, "mu"));
  for (const field of ["Teaching point:", "Reader need:", "Already covered: Partly:", "Where:"]) assert.match(body, new RegExp(`^${field} \\S`, "mu"), field);
  const before = queue.replace(/\n## Pending: the owner's approved change of 19 October 2026 \(PGQ-089\)[\s\S]*?(?=\n## EMPTY sentinel)/u, "").replace("Queue version: 2026-11-21-r24", "Queue version: 2026-11-20-r23");
  assert.ok(!before.includes("PGQ-089"));
  const changedPaths = ["authoring/PENDING-PUBLIC-GUIDE-CHANGES.md", "guide-graphs/candidates/inner-child.graph.json", "guides/owner-amendments.json", "corpus/graph-cases/G20261019C.json"];
  assert.deepEqual(assessGuideChangeProvenance({ changedPaths, oldQueue: before, newQueue: queue }), []);
});
