import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import {
  knownAnswerRule,
  knownVersusNewAuditRules,
  knownVersusNewRules,
  longitudinalSynthesisRules,
  repeatedAdviceRule,
  salienceRule,
  targetPreservationRule
} from "../src/prompts/longitudinal-synthesis.mjs";
import { longitudinalClinicalRules } from "../src/prompts/common.mjs";
import { caseAuditPrompt } from "../src/prompts/case-audit.mjs";
import { candidatePrompt } from "../src/prompts/candidate.mjs";
import { critiquePrompt } from "../src/prompts/critique.mjs";
import { adjudicationPrompt } from "../src/prompts/adjudicate.mjs";
import { realizationPrompt } from "../src/prompts/realize.mjs";
import { privateRuntimeAuditPrompt } from "../src/prompts/private-runtime-audit.mjs";
import { privateRuntimeRepairPrompt } from "../src/prompts/private-runtime-repair.mjs";
import { listenPrivateCaseMcp } from "../src/server/private-case-mcp.mjs";
import { THERAPY_PROTOCOL_FILES, loadTherapyProtocol } from "../src/protocol/therapy-protocol.mjs";
import { PrivateCaseAccessDeniedError } from "../src/storage/private-case-access.mjs";

// Issue #172 (17 Oct 2026): after a journal import, a supervisor answer called an established theme a new idea and did not
// say what the journal changed. These tests establish that the known-versus-new rules reach every app role and the served
// protocol; they do not show that a model follows them.

const base = new URL("../plugins/inner-signal-therapy/skills/inner-signal-therapy/", import.meta.url);
const cases = JSON.parse(await fs.readFile(new URL("../corpus/longitudinal-synthesis-cases.json", import.meta.url), "utf8"));
const byId = new Map(cases.map((fixture) => [fixture.id, fixture]));
const deniedService = Object.freeze({
  async loadCaseContext() { throw new PrivateCaseAccessDeniedError(); },
  async loadCaseContextByAlias() { throw new PrivateCaseAccessDeniedError(); },
  async retrieveCaseEvidence() { throw new PrivateCaseAccessDeniedError(); }
});
const count = (text, part) => text.split(part).length - 1;

// The roles that compose, review or repair a response. The extraction records observations tied to the person's own words
// and composes no review; it gets the rule on a priority's source with the case plan, where it will propose goals.
function rolePrompts(fixture) {
  const context = { guideManifest: { version: "synthetic" }, guideExcerpts: "", userFacts: [],
    recentTranscript: fixture.precedingPrompt, userMessage: fixture.reply };
  const packet = { recent_transcript: fixture.precedingPrompt, current_user_message: fixture.reply };
  return [
    ["case audit", caseAuditPrompt(context, {})],
    ["candidate", candidatePrompt(context, "synthetic")],
    ["critique", critiquePrompt(context, {}, "synthetic", "synthetic")],
    ["adjudication", adjudicationPrompt(context, {}, "synthetic")],
    ["realization", realizationPrompt(context, {}, "synthetic")],
    ["private audit", privateRuntimeAuditPrompt(packet)],
    ["private repair", privateRuntimeRepairPrompt(packet)]
  ];
}

test("the app roles' longitudinal rules are defined once and served unchanged, with the known-versus-new rules", () => {
  // The four rules the app roles already followed, now defined in one module: each appears once in the shared rules.
  for (const rule of [salienceRule, targetPreservationRule, knownAnswerRule, repeatedAdviceRule]) {
    assert.equal(count(longitudinalClinicalRules, rule), 1, rule.slice(0, 60));
    assert.equal(count(longitudinalSynthesisRules, rule), 1, rule.slice(0, 60));
  }
  assert.ok(longitudinalClinicalRules.includes(`${repeatedAdviceRule}\n${knownVersusNewRules}\n`), "the known-versus-new rules follow the repeated-advice rule");
  assert.ok(longitudinalClinicalRules.endsWith(`\n${knownVersusNewAuditRules}\n`), "the audit failure closes the shared rules");
  assert.equal(count(longitudinalClinicalRules, "KNOWN_PRESENTED_AS_NEW"), 1);
  // The four moved lines are the app roles' text from before the move, unchanged (sha256 of the four lines as they stood on
  // main 87dce2de, joined with newlines).
  assert.equal(createHash("sha256").update([salienceRule, targetPreservationRule, knownAnswerRule, repeatedAdviceRule].join("\n"), "utf8").digest("hex"),
    "74bdadad848232f097aba3974efccb4f1e9acc8f62aef93d87d1898bf1a9c190");
  assert.ok(longitudinalSynthesisRules.includes(`KNOWN VERSUS NEW\n${knownVersusNewRules}\n\n${knownVersusNewAuditRules}\n`));
});

test("the known-versus-new rules say what to check, what to report, and what a journal's labels are not", () => {
  for (const part of [
    "check it against the established record: the case's facts and hypotheses, settled answers, intervention history, current episode and any plan the record holds",
    "already established (and where), a new example of an established point, a contradiction of one, a new actionable lever, or a change to what should come first",
    "An established theme is not new because it appears in a new source or format, such as an imported journal.",
    "In such a review, report what changes the next step or the order of priorities.",
    "More examples of a known problem do not make it newer",
    "say so when nothing changes",
    "This is for reviews: in an ordinary turn, a person who wants to be heard about a familiar difficulty gets listening first, not a verdict that nothing has changed.",
    "tags, summaries and other model-made labels are search aids, not diagnoses, findings or approved goals",
    "A priority keeps its source: what the client chose, what an authorized person decided, or what a model only proposed.",
    "Never present a model's proposal as the client's choice or a decided plan.",
    "A safety need or a withdrawn consent can override the ordinary order at any time."
  ]) assert.ok(knownVersusNewRules.includes(part), part);
  assert.match(knownVersusNewAuditRules, /^LONGITUDINAL SYNTHESIS AUDIT FAILURES\n- KNOWN_PRESENTED_AS_NEW: in a review across sessions, case records or journal material, /u);
  assert.match(knownVersusNewAuditRules, /Listening to a familiar difficulty in an ordinary turn is not this failure\.$/u);
});

// Each synthetic case and the rules its expected answer depends on.
const CASES = [
  ["journal-repeats-established-theme", ["a new example of an established point", "More examples of a known problem do not make it newer", "say so when nothing changes"]],
  ["journal-changes-next-step", ["a new actionable lever", "In such a review, report what changes the next step or the order of priorities.", "Never present a model's proposal as the client's choice or a decided plan."]],
  ["journal-tag-is-not-a-diagnosis", ["search aids, not diagnoses, findings or approved goals", "A priority keeps its source"]],
  ["safety-overrides-ordinary-order", ["A safety need or a withdrawn consent can override the ordinary order at any time."]]
];

for (const [id, rules] of CASES) {
  test(`synthetic case ${id}: its rules and the case reach every response, review and repair prompt`, () => {
    const fixture = byId.get(id);
    assert.ok(fixture, `${id} is in the longitudinal synthesis corpus`);
    assert.ok(fixture.rejectedClaims.length >= 3 && fixture.expectedNextMove);
    // Each case's expected reading uses the rules' own terms.
    assert.match(fixture.expectedClassification, /an established point|a new actionable lever|search aids|a safety need/u);
    for (const claim of fixture.rejectedClaims) assert.equal(fixture.expectedNextMove.includes(claim), false, claim);
    for (const rule of rules) assert.ok(knownVersusNewRules.includes(rule), rule);
    for (const [role, prompt] of rolePrompts(fixture)) {
      assert.equal(count(prompt.system, knownVersusNewRules), 1, `${role} carries the known-versus-new rules once`);
      assert.equal(count(prompt.system, knownVersusNewAuditRules), 1, `${role} carries the audit failure once`);
      assert.ok(prompt.user.includes(fixture.reply), `${role} carries the case`);
    }
  });
}

test("every corpus case is tested", () => {
  assert.deepEqual(cases.map((fixture) => fixture.id).sort(), CASES.map(([id]) => id).sort());
});

test("the plugin reads the longitudinal synthesis reference and the connector serves it byte for byte", async (t) => {
  const skill = await fs.readFile(new URL("SKILL.md", base), "utf8");
  const reference = await fs.readFile(new URL("references/LONGITUDINAL-SYNTHESIS.md", base), "utf8");
  assert.ok(reference.endsWith(longitudinalSynthesisRules), "the served reference mirrors the module");
  assert.match(reference, /^# Longitudinal synthesis\n\nThis advisory contract mirrors `src\/prompts\/longitudinal-synthesis\.mjs`\. It does not establish deterministic state enforcement or model adherence\.\n/u);
  const readLine = skill.split("\n").find((line) => line.startsWith("Read `references/") && line.endsWith("before responding."));
  const alwaysRead = [...readLine.matchAll(/`(references\/[A-Z0-9-]+\.md)`/g)].map((match) => match[1]);
  assert.ok(alwaysRead.includes("references/LONGITUDINAL-SYNTHESIS.md"));
  assert.ok(THERAPY_PROTOCOL_FILES.includes("references/LONGITUDINAL-SYNTHESIS.md"));
  assert.match(skill, /check what the record has already established before calling anything new, and say what, if anything, the new material changes in the next step or in what comes first/u);
  assert.match(skill, /Keep the established long-term goal unless the evidence genuinely changes it\./u);

  const listener = await listenPrivateCaseMcp({ caseAccessService: deniedService });
  t.after(() => listener.close());
  const response = await fetch(listener.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "load_therapy_protocol", arguments: {} } })
  });
  const served = (await response.json()).result.structuredContent.files.find((file) => file.path === "references/LONGITUDINAL-SYNTHESIS.md");
  assert.equal(served.content, reference);
  assert.equal(served.content, loadTherapyProtocol().files.find((file) => file.path === "references/LONGITUDINAL-SYNTHESIS.md").content);
});
