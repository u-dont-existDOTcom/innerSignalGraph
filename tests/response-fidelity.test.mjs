import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { responseFidelityRules } from "../src/prompts/response-fidelity.mjs";
import { longitudinalClinicalRules } from "../src/prompts/common.mjs";
import { loadTherapyProtocol } from "../src/protocol/therapy-protocol.mjs";

const load = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const graph = JSON.parse(load("../guide-graphs/candidates/cross-guide.graph.json"));
const amendment = JSON.parse(load("../guides/owner-amendments.json"));
const ids = ["ROUTE.MEDICAL_RED_FLAG","ROUTE.REFRACTORY_PAIN_NAVIGATION","ROUTE.ALTERED_STABLE_THERAPY","ROUTE.ALTERED_AFTERMATH","ROUTE.ACT_OUTWARD","ROUTE.THREE_WAY_GATE"];

test("application and served plugin share response fidelity guidance", () => {
  const protocol = loadTherapyProtocol();
  const ref = load("../plugins/inner-signal-therapy/skills/inner-signal-therapy/references/RESPONSE-FIDELITY.md");
  assert.equal(ref.slice(ref.indexOf("RESPONSE FIDELITY AND PRACTICAL CARE VALUE")).trim(), responseFidelityRules.trim());
  assert.equal(protocol.files.find(f=>f.path==="references/RESPONSE-FIDELITY.md").content, ref);
  for (const name of ["LOW_VALUE_REPEAT_REFERRAL","AUTOMATIC_PRACTICE_WARNING","ALTERED_SOURCE_AS_FACT","RELAPSE_CHANGE_MISSED","ROOT_CAUSE_HARDENING","RESPONSE_DUPLICATION"]) {
    assert.ok(longitudinalClinicalRules.includes(name), name);
  }
  assert.ok(protocol.instructions.includes("references/RESPONSE-FIDELITY.md"));
});

test("owner-approved graph preserves urgent route while adding contextual care and de-duplication", () => {
  const id = "AMEND.CROSS.RESPONSE_FIDELITY_20261025";
  assert.equal(amendment.items.find(x=>x.id===id)?.status, "owner-approved");
  for (const nodeId of ids) assert.ok(graph.nodes.find(x=>x.id===nodeId)?.sourceRefs.includes(id),nodeId);
  const n = (id) => graph.nodes.find(x=>x.id===id);
  assert.equal(n("ROUTE.MEDICAL_RED_FLAG").activation.all[0].value, "urgent");
  assert.ok(n("ROUTE.REFRACTORY_PAIN_NAVIGATION").effects.requiredNuance.join(" ").includes("what the person considers helpful"));
  assert.ok(n("ROUTE.ALTERED_STABLE_THERAPY").avoid.join(" ").includes("altered attention by itself"));
  assert.ok(n("ROUTE.ALTERED_AFTERMATH").effects.requiredNuance.join(" ").includes("not independent waking testimony"));
  assert.ok(n("ROUTE.ACT_OUTWARD").recommendations.join(" ").includes("lower-symptom periods"));
  assert.ok(n("ROUTE.THREE_WAY_GATE").effects.requiredNuance.join(" ").includes("second mention needs a distinct decision"));
});
