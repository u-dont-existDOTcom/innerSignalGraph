import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/core/config.mjs";
import { buildContext } from "../src/orchestrator/context-builder.mjs";
import { createProviders } from "../src/providers/factory.mjs";
import { runTieredTherapyPipeline } from "../src/orchestrator/run-tiered-pipeline.mjs";
import { protocolProvenanceRules } from "../src/prompts/protocol-provenance.mjs";
import { longitudinalClinicalRules, sharedClinicalRules } from "../src/prompts/common.mjs";
import { caseExtractionPrompt } from "../src/prompts/case-extract.mjs";
import { caseAuditPrompt } from "../src/prompts/case-audit.mjs";
import { candidatePrompt } from "../src/prompts/candidate.mjs";
import { critiquePrompt } from "../src/prompts/critique.mjs";
import { adjudicationPrompt } from "../src/prompts/adjudicate.mjs";
import { realizationPrompt } from "../src/prompts/realize.mjs";
import { privateRuntimeAuditPrompt } from "../src/prompts/private-runtime-audit.mjs";
import { privateRuntimeRepairPrompt } from "../src/prompts/private-runtime-repair.mjs";
import { childContactViolations } from "../src/case-formulation/protective-compatibility.mjs";
import { listenPrivateCaseMcp } from "../src/server/private-case-mcp.mjs";
import { loadTherapyProtocol } from "../src/protocol/therapy-protocol.mjs";
import { PrivateCaseAccessDeniedError } from "../src/storage/private-case-access.mjs";

// The owner's correction of 16 Oct 2026 (issue #168): reparenting is not an exercise.
// These tests establish that the corrected rules reach every consumer, including the served
// MCP route, and that existing safeguards stay; they do not show that a model follows them.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FALSE_CONTRAST = /(?:completed|enacted) reparenting/i;
const cases = JSON.parse(await fs.readFile(new URL("../corpus/protocol-provenance-cases.json", import.meta.url), "utf8"));
const byId = new Map(cases.map((fixture) => [fixture.id, fixture]));

function producerAndReviewerPrompts(fixture) {
  const context = { guideManifest: { version: "synthetic" }, guideExcerpts: "", userFacts: [],
    recentTranscript: fixture.precedingPrompt, userMessage: fixture.reply };
  const packet = { recent_transcript: fixture.precedingPrompt, current_user_message: fixture.reply };
  return [
    ["extraction", caseExtractionPrompt(context)],
    ["case audit", caseAuditPrompt(context, {})],
    ["candidate", candidatePrompt(context, "synthetic")],
    ["critique", critiquePrompt(context, {}, "synthetic", "synthetic")],
    ["adjudication", adjudicationPrompt(context, {}, "synthetic")],
    ["realization", realizationPrompt(context, {}, "synthetic")],
    ["private audit", privateRuntimeAuditPrompt(packet)],
    ["private repair", privateRuntimeRepairPrompt(packet)]
  ];
}

test("the shared rules say reparenting is the ongoing relationship, not an exercise", () => {
  const definition = protocolProvenanceRules.split("\n").find((line) => line.startsWith("- Reparenting is not an exercise."));
  assert.ok(definition, "the rules open with the definition");
  assert.match(definition, /ongoing relationship and practice in which the present-day adult cares for the vulnerable younger self/);
  for (const part of ["care", "emotional validation", "protection", "truthful boundaries", "repair", "self-guidance", "ordinary-life choices"]) {
    assert.ok(definition.includes(part), part);
  }
  assert.match(definition, /not only through a guided visualization/);
  assert.match(definition, /feel safe inside while expressing their authentic feelings, needs and boundaries is this work itself, not a separate goal that reparenting might optionally support/);
  assert.match(protocolProvenanceRules, /methods within reparenting, not its definition, a prerequisite for it or the full measure of its success/);
  // The old false contrast: a hypothetical caring answer set against "completed reparenting",
  // with the imaginal exercise as the unconditional next step.
  assert.doesNotMatch(protocolProvenanceRules, FALSE_CONTRAST);
  assert.match(protocolProvenanceRules, /not an enacted exercise, received care, trust, or improvement\. If the next step is that imaginal child\/adult exercise, reuse the person's own words/);
});

test("exercise evidence and ongoing reparenting evidence are kept apart, with no inference either way", () => {
  assert.ok(protocolProvenanceRules.includes("Exercise evidence belongs to one particular exercise: taught, attempted, response reported (including no noticeable response), and impact unknown until something is reported."));
  assert.ok(protocolProvenanceRules.includes("Reparenting evidence belongs to the ongoing relationship: what the person reports doing for the vulnerable self in daily life"));
  assert.ok(protocolProvenanceRules.includes("Do not infer reparenting progress from saying the right words, a vow, one moving session or one good day."));
  assert.ok(protocolProvenanceRules.includes("Do not infer that reparenting is absent, failing or complete from absent imagery, an inability to visualize, no emotional breakthrough, no immediate relief or a flat session."));
  assert.ok(protocolProvenanceRules.includes("Describe a person's progress only as far as reported behavior and its reported effects go, and say what remains unknown."));
  assert.ok(protocolProvenanceRules.includes("For a particular exercise, keep these evidence states separate"));
  assert.ok(protocolProvenanceRules.includes("they describe that exercise, not whether reparenting is happening"));
  // The original exercise-evidence safeguards stay.
  for (const code of ["HYPOTHETICAL_ENACTMENT_CONFLATION", "PREMATURE_RECEPTION_INQUIRY", "UNSUPPORTED_PROTOCOL_STATE_ADVANCE", "REPARENTING_EXERCISE_CONFLATION", "REPARENTING_FALSE_CHOICE"]) {
    assert.ok(protocolProvenanceRules.includes(`- ${code}: `), code);
  }
  assert.ok(protocolProvenanceRules.includes("Silence in the transcript is unknown, not a report of no response."));
  assert.ok(protocolProvenanceRules.includes("A report of no noticeable response is an observation, not proof of refusal, distrust, or failure."));
});

// Each synthetic case, the rules it depends on, and the false contrast it must reject.
const CASES = [
  {
    id: "everyday-protection-without-imagery",
    rejects: ["no reparenting happened this week", "reparenting only happens in imagery", "the younger self now trusts the adult"],
    rules: [
      "A boundary kept, a need said out loud, a repair made or a protective choice in daily life is reparenting as much as a meditation is.",
      "Do not infer that reparenting is absent, failing or complete from absent imagery",
      "Do not infer reparenting progress from saying the right words, a vow, one moving session or one good day.",
      "call an ordinary-life act reparenting only when the person uses or welcomes the inner-child frame"
    ]
  },
  {
    id: "imaginal-exercise-no-emotional-shift",
    rejects: ["reparenting did not happen", "reparenting is complete", "the meditation failed"],
    rules: [
      "no emotional breakthrough, no immediate relief or a flat session",
      "A report of no noticeable response is an observation, not proof of refusal, distrust, or failure.",
      "- REPARENTING_EXERCISE_CONFLATION: "
    ]
  },
  {
    id: "supervisor-felt-safety-and-expression",
    rejects: ["reparenting is an optional adjunct to felt safety and self-expression", "reparenting means doing the imaginal meditation", "the client already feels safe expressing her needs"],
    rules: [
      "not a separate goal that reparenting might optionally support",
      "here they are aspects of the same work",
      "concrete human support, specialist care for physical pain",
      "- REPARENTING_FALSE_CHOICE: ",
      "say what remains unknown"
    ]
  }
];

for (const { id, rejects, rules } of CASES) {
  test(`synthetic case ${id}: its rules reach every producer, reviewer and repair prompt`, () => {
    const fixture = byId.get(id);
    assert.ok(fixture, `${id} is in the provenance case corpus`);
    for (const claim of rejects) assert.ok(fixture.rejectedClaims.includes(claim), `${id} rejects "${claim}"`);
    for (const rule of rules) assert.ok(protocolProvenanceRules.includes(rule), rule);
    for (const [role, prompt] of producerAndReviewerPrompts(fixture)) {
      assert.ok(prompt.system.includes(protocolProvenanceRules), `${role} carries the rules`);
      assert.ok(prompt.user.includes(fixture.reply), `${role} carries the case`);
    }
  });
}

test("the therapy pipeline sends the reparenting rules to every model stage it runs", async () => {
  const runs = [
    { fixture: "tests/fixtures/fast-therapy.json", userMessage: "Give me one simple suggestion.", recentTranscript: "" },
    { fixture: "fixtures/mock-responses/A001.json",
      userMessage: "I can access love but it feels unsafe. The younger me says big fuckity whoopty doo, what are you gonna do for me, and I resent a younger version for not growing up.",
      recentTranscript: "Relaxation has not fixed the credibility conflict." }
  ];
  for (const { fixture, userMessage, recentTranscript } of runs) {
    const config = loadConfig({ mode: "mock", ledgerMode: "off", therapyProcessingMode: "auto" });
    const providers = createProviders(config, { fixturePath: path.join(root, fixture) });
    const requests = [];
    for (const provider of Object.values(providers)) {
      const generate = provider.generate.bind(provider);
      provider.generate = async (request) => { requests.push(request); return generate(request); };
    }
    const context = await buildContext({ userMessage, recentTranscript, userFacts: [] }, config);
    await runTieredTherapyPipeline({ context, providers, config, processingMode: "auto" });
    assert.ok(requests.length >= 2, fixture);
    for (const request of requests) {
      const sent = JSON.stringify(request);
      assert.ok(sent.includes("Reparenting is not an exercise."), `${fixture}: ${request.metadata?.stage}`);
      assert.ok(sent.includes("REPARENTING_FALSE_CHOICE"), `${fixture}: ${request.metadata?.stage}`);
    }
  }
});

test("the served MCP route delivers the correction and keeps the safeguards", async (t) => {
  const deniedService = Object.freeze({
    async loadCaseContext() { throw new PrivateCaseAccessDeniedError(); },
    async loadCaseContextByAlias() { throw new PrivateCaseAccessDeniedError(); },
    async retrieveCaseEvidence() { throw new PrivateCaseAccessDeniedError(); }
  });
  const listener = await listenPrivateCaseMcp({ caseAccessService: deniedService });
  t.after(() => listener.close());
  const response = await fetch(listener.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "load_therapy_protocol", arguments: {} } })
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.result.structuredContent.protocol_sha256, loadTherapyProtocol().protocolSha256);
  const text = body.result.content[0].text;
  const block = (label) => {
    const begin = text.indexOf(`<<<BEGIN ${label} `);
    assert.notEqual(begin, -1, `${label} is served`);
    return text.slice(begin, text.indexOf(`<<<END ${label}>>>`, begin));
  };
  const instructions = block("instructions");
  assert.match(instructions, /Reparenting is not an exercise\. It is the ongoing relationship in which the present-day adult cares for, validates, protects and guides the vulnerable younger self/);
  assert.match(instructions, /not a goal that reparenting optionally supports, including when you advise a supervisor/);
  assert.ok(block("references/PROTOCOL-STATE-PROVENANCE.md").includes(protocolProvenanceRules));
  const map = block("references/INNER-CHILD-THERAPY-MAP.md");
  assert.match(map, /OVERLAY\.IC\.PROTOCOL_STATE_PROVENANCE<br\/>OWNER-APPROVED \/ NOT COMPILED<br\/>Hypothetical care is not an enacted exercise/);
  assert.doesNotMatch(text, FALSE_CONTRAST, "no served file pairs reparenting with completion or enactment");
  const protective = block("references/PROTECTIVE-COMPATIBILITY.md");
  assert.match(protective, /While the gate is HOLD or BLOCKED, prohibit direct and indirect child imagery, dialogue, regression, hypnosis/);
  assert.match(protective, /The restriction is not withdrawal of care\./);
  assert.match(protective, /not religion, Satanism, atheism, diagnosis, appearance, affiliation, anger, moral self-condemnation, a past act alone, unwanted intrusive thoughts/);
});

test("a child-contact hold still stops child contact but not the adult's own protective behavior", () => {
  assert.ok(protocolProvenanceRules.includes("A protective-compatibility HOLD or BLOCKED gate restricts child-directed contact, not the present adult's permitted protective behavior: safety, boundaries, self-care and asking for help stay available, in ordinary adult language without child-directed framing."));
  assert.ok(protocolProvenanceRules.includes("An unwanted intrusive thought, a dream or an inability to visualize is not evidence of harmful intent or of failed reparenting"));
  // The response gate that enforces a hold is unchanged: adult protective language passes, child-directed contact is caught.
  assert.deepEqual(childContactViolations("You told your mother you won't discuss your body, left early, and made yourself a proper meal. Keeping that boundary protected you."), []);
  assert.deepEqual(childContactViolations("Next time, ask for help before the dinner and plan how you will leave."), []);
  assert.ok(childContactViolations("Tonight, comfort your inner child and tell her you kept that boundary for her.").length > 0);
  assert.ok(childContactViolations("Visualize your younger self at the dinner table.").length > 0);
  assert.match(sharedClinicalRules, /Never encourage contact, dialogue, imagery, hypnosis, regression, writing, proxy protector work, or homework involving an inner child, younger self, child part, or vulnerable child aspect while the protective compatibility gate is HOLD or BLOCKED\./);
});

test("frame consent stays: reparenting is named only when the person welcomes the frame", () => {
  assert.ok(protocolProvenanceRules.includes("After a decline, care, protection and guidance continue in the person's own words with no reparenting label."));
  assert.ok(protocolProvenanceRules.includes("Leaving the reparenting label out because the person declined or does not use the inner-child frame is not this failure."));
  assert.match(longitudinalClinicalRules, /no reparenting label on unrelated work/);
  assert.match(longitudinalClinicalRules, /Call an outward act reparenting only when the person already welcomes that frame and the label is actually useful; never after decline/);
});

test("extraction does not read an absent exercise comparison as absent reparenting", () => {
  const prompt = caseExtractionPrompt({ guideManifest: { version: "synthetic" }, guideExcerpts: "", userFacts: [], recentTranscript: "", userMessage: "synthetic" });
  assert.match(prompt.system, /not_in_play says only that no exercise is being compared: ordinary-life care, protection, boundaries or repair reported without any exercise are reparenting in their own right, so keep them as observations and never read not_in_play as absent reparenting\./);
});
