import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {responseFidelityRules} from "../src/prompts/response-fidelity.mjs";
import {focusDisciplineRules} from "../src/prompts/focus-discipline.mjs";
import {loadTherapyProtocol} from "../src/protocol/therapy-protocol.mjs";

const read=(p)=>fs.readFileSync(new URL(p,import.meta.url),"utf8");
const json=(p)=>JSON.parse(read(p));
const a1="AMEND.CROSS.FEELING_AGENCY_AND_REFERRAL_FIT_20261026";
const a2="AMEND.CROSS.EARLY_REGULATION_CONDITION_20261026";
const failures=["ATTRACTION_ACTION_CONFLATION","SHAME_RESPONSIBILITY_FALSE_CHOICE","UNSUPPORTED_SEXUAL_CAUSE","SEXUAL_CARE_SCOPE_ERROR","SENSITIVE_REFERRAL_FIT_MISSING","REFRACTORY_PEAK_REASK","LEGAL_CLINICAL_CONSENT_COLLAPSE"];

test("same focus and response rules ship in application and therapy protocol",()=>{
  const p=loadTherapyProtocol();
  const ref=p.files.find(f=>f.path==="references/RESPONSE-FIDELITY.md")?.content;
  const focus=p.files.find(f=>f.path==="references/FOCUS-DISCIPLINE.md")?.content;
  assert.ok(ref?.endsWith(responseFidelityRules.trim()+"\n"));
  assert.ok(focus?.endsWith(focusDisciplineRules));
  for(const key of failures)assert.ok(responseFidelityRules.includes(key),key);
  assert.match(focusDisciplineRules,/no method sufficiently relieved peak overwhelm/);
});
test("owner amendment and guide projections match current source",()=>{
 const m=json("../guides/manifest.json");
 const a=json("../guides/owner-amendments.json");
 assert.equal(m.sources.find(x=>x.id==="owner-amendments").version,a.version);
 assert.equal(a.items.length,71);
 assert.equal(a.version,"owner-amendments-2026-10-28-r18");
 assert.equal(a.items.find(x=>x.id===a1)?.status,"owner-approved");
 assert.equal(a.items.find(x=>x.id===a2)?.status,"owner-approved");
 const groups=[
  ["../guide-graphs/candidates/inner-child.graph.json",{"IC.DIFFERENTIATION":a1,"IC.COMMON_HUMANITY":a1,"IC.PROTECTOR_ACTION":a1,"IC.PRACTICE_TO_LIFE_TRANSFER":a2}],
  ["../guide-graphs/candidates/cross-guide.graph.json",{"ROUTE.ACT_OUTWARD":a1,"ROUTE.COMMUNITY_SUPPORT":a1}]
 ];
 for(const [f,bindings] of groups){
  const g=json(f);
  for(const [name,source] of Object.entries(bindings)){
   const n=g.nodes.find(x=>x.id===name);
   assert.ok(n?.sourceRefs.includes(source),name);
  }
 }
 const ic=json("../guide-graphs/candidates/inner-child.graph.json");
 const prot=ic.nodes.find(x=>x.id==="IC.PROTECTOR_ACTION");
 assert.match(prot.recommendations.at(-1),/without harsh judgment/);
 assert.match(prot.avoid.at(-1),/Do not make review punitive/);
});
test("public guide handoff is scoped, not automatically published",()=>{
 const queue=read("../authoring/PENDING-PUBLIC-GUIDE-CHANGES.md");
 assert.match(queue,/PGQ-043 — Notice feelings, choose actions without self-condemnation/);
 assert.match(queue,/PGQ-039/);
 assert.match(queue,/Also Look Outward/);
});
test("synthetic regression prompts are explicitly behavior tests for future replay",()=>{
 const cases=json("../corpus/attraction-agency-regression-cases.json");
 assert.equal(cases.schema_version,1);
 assert.equal(cases.cases.length,4);
 for(const x of cases.cases){assert.ok(failures.includes(x.expected_failure_code));assert.ok(x.input.length>60 && x.pass_criterion.length>70);}
});
