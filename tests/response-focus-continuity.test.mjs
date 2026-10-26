import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { responseFidelityRules } from "../src/prompts/response-fidelity.mjs";
import { focusDisciplineRules } from "../src/prompts/focus-discipline.mjs";
import { longitudinalClinicalRules } from "../src/prompts/common.mjs";
import { loadTherapyProtocol } from "../src/protocol/therapy-protocol.mjs";

const read = (file) => fs.readFileSync(new URL(file, import.meta.url), "utf8");
const json = (file) => JSON.parse(read(file));
const name = "AMEND.CROSS.REPLY_FOCUS_AND_DELIVERY_20261025";
const flags = [
  "UNSENT_ADVICE_AS_DELIVERED", "DELIVERED_ADVICE_AS_NEW", "SPLIT_FOCUS_RETURN",
  "HISTORY_FREE_CESSATION_ADVICE", "RELIEF_SCOPE_OVERCLAIM",
  "MISSED_VALUED_STATE_FUNCTION", "UNTESTED_ACCESS_FRICTION",
  "TRANSLATION_SCOPE_LOSS"
];

test("app and served protocol use the same expanded fidelity and focus rules", () => {
  const protocol = loadTherapyProtocol();
  const servedFidelity = protocol.files.find(x=>x.path==="references/RESPONSE-FIDELITY.md")?.content;
  const servedFocus = protocol.files.find(x=>x.path==="references/FOCUS-DISCIPLINE.md")?.content;
  assert.ok(servedFidelity);
  assert.ok(servedFocus);
  assert.ok(servedFidelity.endsWith(responseFidelityRules.trim()+"\n"));
  assert.ok(servedFocus.endsWith(focusDisciplineRules));
  for (const code of flags) {
    assert.ok(responseFidelityRules.includes(code), code);
    assert.ok(longitudinalClinicalRules.includes(code), code);
    assert.ok(servedFidelity.includes(code), code);
  }
  assert.match(servedFidelity, /monastics to monks alone/);
  assert.match(focusDisciplineRules, /one contiguous block per subject/);
});

test("delivery, functional coping and focus nuance reach compiled guide sources with unchanged safety routing", () => {
  const owner = json("../guides/owner-amendments.json");
  const manifest = json("../guides/manifest.json");
  assert.equal(owner.version, "owner-amendments-2026-10-26-r17");
  assert.equal(owner.items.find(x=>x.id===name)?.status, "owner-approved");
  assert.equal(manifest.sources.find(x=>x.id==="owner-amendments")?.version, owner.version);
  const paths = [
    ["../guide-graphs/candidates/cross-guide.graph.json", ["ROUTE.THREE_WAY_GATE","ROUTE.ACT_OUTWARD"]],
    ["../guide-graphs/candidates/inner-child.graph.json", ["IC.PRACTICE_TO_LIFE_TRANSFER","IC.PROTECTOR_ACTION"]]
  ];
  for (const [file, ids] of paths) {
    const graph = json(file);
    for (const id of ids) {
      const node=graph.nodes.find(x=>x.id===id);
      assert.ok(node?.sourceRefs.includes(name), id);
    }
  }
  const cross = json("../guide-graphs/candidates/cross-guide.graph.json");
  const n = id=>cross.nodes.find(x=>x.id===id);
  assert.equal(n("ROUTE.THREE_WAY_GATE").activation.all[0].field,"attention_loop");
  assert.ok(n("ROUTE.THREE_WAY_GATE").activation.none.some(x=>x.field==="present_safety" && x.value==="unsafe"));
  assert.ok(n("ROUTE.ACT_OUTWARD").activation.none.some(x=>x.field==="present_safety" && x.value==="unsafe"));
  assert.match(n("ROUTE.ACT_OUTWARD").effects.requiredNuance.join(" "), /monks and nuns/);
});

test("guide handoff tracks new reader-facing meaning without rewriting owner-authored prose", () => {
  const pending = read("../authoring/PENDING-PUBLIC-GUIDE-CHANGES.md");
  const lessons = read("../THERAPY-LESSONS");
  assert.match(pending,/PGQ-041 — Make existing partial regulation usable outside the exercise/);
  assert.match(pending,/PGQ-042 — Protect from relapse by understanding the need/);
  assert.match(pending,/practice-to-life/i);
  assert.match(lessons,/inclusive group in translation/);
  assert.match(lessons,/Development candidate, not live/);
});

test("synthetic pre/post response failures have focused, explicit criteria for future model replay", () => {
  const fixtures = json("../corpus/response-focus-regression-cases.json");
  assert.equal(fixtures.schema_version,1);
  assert.equal(fixtures.cases.length,6);
  for (const scenario of fixtures.cases) {
    assert.ok(scenario.purpose.length>15);
    assert.ok(flags.includes(scenario.failure_code));
    assert.ok(scenario.synthetic_input.length>70);
    assert.ok(scenario.failure_example.length>15);
    assert.ok(scenario.pass_criterion.length>30);
  }
});
