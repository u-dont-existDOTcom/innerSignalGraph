import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { CASE_VARIABLE_ENUMS } from "../src/guide-graph/contract.mjs";
import { compileGuideGraphs } from "../src/guide-graph/compiler.mjs";
import { planFromGraphs } from "../src/guide-graph/planner.mjs";

test("refractory pain is an evidence-gated variable, not a psychiatric diagnosis", async () => {
  assert.deepEqual(CASE_VARIABLE_ENUMS.refractory_pain_care, ["indicated", "not_indicated", "unknown"]);
  const extractor=await fs.readFile(new URL("../src/prompts/case-extract.mjs", import.meta.url),"utf8");
  assert.match(extractor,/refractory_pain_care is indicated/);
  assert.match(extractor,/nearly daily familiar pain does not automatically/);
});

test("specialist pain route survives pain-related ideation without taking over imminent danger", async () => {
  const bundle=await compileGuideGraphs({write:false});
  const base={present_safety:"safe",orientation:"oriented",ability_to_stop:"yes",ability_to_return:"yes",
    suicidal_state:"ideation",medical_urgency:"nonurgent",refractory_pain_care:"indicated",
    actionable_problem:"present",inner_adult_access:"low",witness_capacity:"unknown"};
  const chronic=planFromGraphs({graphs:bundle.graphs,variables:base});
  assert.equal(chronic.primaryJob.id,"ROUTE.REFRACTORY_PAIN_NAVIGATION");
  assert.ok(chronic.avoid.some(v=>/daily|ambulance/i.test(v)));
  assert.ok(chronic.recommendations?.some(v=>/referral/i.test(v)) ||
    chronic.selectedNodes.some(v=>v.recommendations.some(r=>/referral/i.test(r))));
  const danger=planFromGraphs({graphs:bundle.graphs,variables:{...base,suicidal_state:"intent"}});
  assert.ok(!danger.selectedNodes.some(v=>v.id==="ROUTE.REFRACTORY_PAIN_NAVIGATION"));
  const acute=planFromGraphs({graphs:bundle.graphs,variables:{...base,medical_urgency:"urgent"}});
  assert.equal(acute.primaryJob.id,"ROUTE.MEDICAL_RED_FLAG");
});

test("canonical r6 retains prior source and safe disclosure distinction", async () => {
  const r5=await fs.readFile(new URL("../guides/inner-child-guide-2026-10-10-r5.txt", import.meta.url),"utf8");
  const r6=await fs.readFile(new URL("../guides/inner-child-guide-2026-10-11-r6.txt", import.meta.url),"utf8");
  assert.ok(r6.includes("a named chronic-pain specialist service"));
  assert.ok(r6.includes("If you actually fear you may harm yourself"));
  const before=r5.split("\n");
  let i=0;
  for (const line of r6.split("\n")) if(i<before.length && line===before[i]) i++;
  assert.equal(i,before.length,"all predecessor lines must survive in order");
});
