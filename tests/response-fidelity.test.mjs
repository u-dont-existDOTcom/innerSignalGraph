import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { responseFidelityRules } from "../src/prompts/response-fidelity.mjs";
import { longitudinalClinicalRules } from "../src/prompts/common.mjs";
import { critiquePrompt } from "../src/prompts/critique.mjs";
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
  // The same shame decision rule must reach application roles and MCP skill clients.
  for (const passage of [
    "Even accurate social rejection does not prove wrongdoing",
    "When norms are unjust, allow differentiation and safer belonging",
    "Do not require disclosure to a hostile or unpredictable audience"
  ]) {
    assert.ok(responseFidelityRules.includes(passage), passage);
    assert.ok(longitudinalClinicalRules.includes(passage), "application: "+passage);
    assert.ok(ref.includes(passage), "served skill: "+passage);
  }
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

test("first-contact and appropriately screened couples-care lessons appear in served and app rules", () => {
  const protocol = loadTherapyProtocol();
  const ref = load("../plugins/inner-signal-therapy/skills/inner-signal-therapy/references/RESPONSE-FIDELITY.md");
  const markers = ["REPRIMANDING_OPENING", "UNCHOSEN_FIRST_AGENDA", "ORNAMENTAL_FAITH_REFERENCE", "UNGATED_SCRIPTURE", "IPV_COUNSELING_SCOPE_COLLAPSE"];
  for (const marker of markers) {
    assert.ok(responseFidelityRules.includes(marker), marker);
    assert.ok(longitudinalClinicalRules.includes(marker), marker);
    assert.ok(ref.includes(marker), marker);
    assert.ok(protocol.files.find(f=>f.path==="references/RESPONSE-FIDELITY.md").content.includes(marker), marker);
  }
  assert.match(responseFidelityRules, /private(?:ly)? assess both partners/);
  assert.match(responseFidelityRules, /not alone establish current coercive control/);
  assert.match(responseFidelityRules, /Ongoing coercion or credible safety risk makes ordinary conjoint treatment inappropriate/);
  assert.match(responseFidelityRules, /Do not assume relationship conflict makes the threatened partner responsible/);
});

test("the owner's 27 October 2026 first-contact spec is carried clause by clause on every surface, under the spec's audit names", () => {
  const servedProtocol = loadTherapyProtocol().files.find(f=>f.path==="references/RESPONSE-FIDELITY.md").content;
  const servedFile = load("../plugins/inner-signal-therapy/skills/inner-signal-therapy/references/RESPONSE-FIDELITY.md");
  const surfaces = {
    "application rules": responseFidelityRules,
    "longitudinal rules": longitudinalClinicalRules,
    "served file": servedFile,
    "served protocol": servedProtocol
  };
  const clauses = [
    /When writing directly to a person, never open with their bare name\./,
    /If using their name at the start, begin with a natural greeting, such as "Hi Alex," or "Hello Alex,"\./,
    /For first contact, welcome the person and establish why the conversation is happening before discussing painful history, faults, interpretations/,
    /Avoid a reprimanding or interrogative opening and avoid artificial praise/,
    /If a new client has no already-chosen therapeutic priority, invite them to choose one or two concerns to explore\./,
    /Offer a few relevant, grounded possibilities, including childhood patterns where welcomed and the option of starting with a present-day difficulty\./,
    /Do not impose a focus based on a third party’s interpretation/,
    /independently supported safety needs still take precedence/,
    /REPRIMANDING_OPENING: a personal message opens with the bare name, or presents a distressing catalogue before a natural greeting and welcoming context\./,
    /UNCHOSEN_FIRST_AGENDA: a first message assigns the therapeutic focus from a third-party report without a client choice, absent a current safety exception\./
  ];
  for (const [surface, text] of Object.entries(surfaces)) {
    for (const clause of clauses) assert.match(text, clause, surface);
    // The two codes were renamed to the spec's names, and the earlier names are gone from every surface.
    for (const retired of ["REPRIMANDING_FIRST_CONTACT", "IMPOSED_UNCHOSEN_AGENDA"]) assert.ok(!text.includes(retired), `${retired} is still in the ${surface}`);
  }
});

test("the owner's 28 October 2026 scripture gate is carried clause by clause on every surface, with its audit failure", () => {
  // First-contact PR #198, the owner's request of 28 October 2026: scripture is gated on the person's own orientation,
  // learned from how they talk or by asking once, lightly, after the welcome.
  const servedProtocol = loadTherapyProtocol().files.find(f=>f.path==="references/RESPONSE-FIDELITY.md").content;
  const servedFile = load("../plugins/inner-signal-therapy/skills/inner-signal-therapy/references/RESPONSE-FIDELITY.md");
  const context = { guideManifest: { version: "synthetic" }, guideExcerpts: "", userFacts: [], recentTranscript: "", userMessage: "synthetic" };
  const surfaces = {
    "application rules": responseFidelityRules,
    "longitudinal rules": longitudinalClinicalRules,
    "critique prompt": critiquePrompt(context, {}, "synthetic", "synthetic").system,
    "served file": servedFile,
    "served protocol": servedProtocol
  };
  const clauses = [
    /Gate scripture on the person's own orientation\./,
    /Before quoting or citing scripture or another religious or spiritual text, know from the person whether they would welcome it and from which tradition or traditions:/,
    /from how they talk \(they quote or cite a tradition's texts, or speak of their faith as a resource\)/,
    /or, when that hasn't shown it, by asking once, lightly, near the start and after the welcome, whether they would like scripture or spiritual texts included and from which religion or religions\./,
    /Never infer a tradition from a name, family, country or culture; "none" and "several" are ordinary answers\./,
    /If the person declines, leave scripture out unless they bring it up later; their answer can change at any time\./,
    /UNGATED_SCRIPTURE: a reply quotes or cites scripture or another religious text before the person's welcome for it is known from their own words or answer, uses a tradition they did not choose, or infers their tradition from a name, family, country or culture\./
  ];
  for (const [surface, text] of Object.entries(surfaces)) {
    for (const clause of clauses) assert.match(text, clause, surface);
    assert.equal(text.split("Gate scripture on the person's own orientation.").length - 1, 1, `${surface}: the gate is stated once`);
    assert.equal(text.split("- UNGATED_SCRIPTURE: ").length - 1, 1, `${surface}: the audit failure is listed once`);
    // The gate sits immediately before the faith-reference rule, and the audit failure immediately after ORNAMENTAL_FAITH_REFERENCE.
    assert.match(text, /- Gate scripture on the person's own orientation\.[^\n]*\n- Treat Christian or other faith references as meaningful only when/, surface);
    assert.match(text, /- ORNAMENTAL_FAITH_REFERENCE: [^\n]*\n- UNGATED_SCRIPTURE: /, surface);
    // The faith-reference rule and the older audit failure are kept as they were.
    assert.ok(text.includes("- Treat Christian or other faith references as meaningful only when a passage addresses something this person actually raised and the application respects their own interpretation. Do not insert stock verses or unrequested assurances merely to signal affinity with the client’s religion.\n"), surface);
    assert.ok(text.includes("- ORNAMENTAL_FAITH_REFERENCE: a religious passage or reassuring theological gloss is inserted without an actual connection to the client’s relevant statement or goal.\n"), surface);
  }
});

test("logic and supervisor-purpose rules reach the reviewed pipeline", () => {
 const served = load("../plugins/inner-signal-therapy/skills/inner-signal-therapy/references/RESPONSE-FIDELITY.md");
 const critique = load("../src/prompts/critique.mjs");
 for (const code of ["NON_SEQUITUR_QUALIFICATION","UNMADE_CLAIM_REBUTTAL","QUESTION_WITHOUT_STEP_VALUE","SUPERVISOR_PURPOSE_OMITTED","EDITORIAL_AFTERCARE_OVERCOMPLETION"]) {
   assert.ok(responseFidelityRules.includes(code));
   assert.ok(longitudinalClinicalRules.includes(code));
   assert.ok(served.includes(code));
 }
 assert.match(responseFidelityRules,/supervisor-only Therapeutic purpose statement/);
 assert.match(responseFidelityRules,/Do not add a mandatory extra model review/);
 assert.match(critique,/rebuttals of unmade claims/);
});
