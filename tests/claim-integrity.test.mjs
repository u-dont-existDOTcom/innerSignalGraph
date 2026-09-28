import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { CLAIM_INTEGRITY_AUDIT_CODES, CLAIM_INTEGRITY_VERSION, claimIntegrityRules } from "../src/prompts/claim-integrity.mjs";
import { longitudinalClinicalRules, sharedClinicalRules } from "../src/prompts/common.mjs";
import { caseExtractionPrompt } from "../src/prompts/case-extract.mjs";
import { caseAuditPrompt } from "../src/prompts/case-audit.mjs";
import { candidatePrompt } from "../src/prompts/candidate.mjs";
import { critiquePrompt } from "../src/prompts/critique.mjs";
import { adjudicationPrompt } from "../src/prompts/adjudicate.mjs";
import { realizationPrompt } from "../src/prompts/realize.mjs";
import { privateRuntimeAuditPrompt } from "../src/prompts/private-runtime-audit.mjs";
import { privateRuntimeRepairPrompt } from "../src/prompts/private-runtime-repair.mjs";
import { THERAPY_PROTOCOL_FILES, loadTherapyProtocol } from "../src/protocol/therapy-protocol.mjs";

// These tests pin delivery and wording. They do not show that a model follows the rules,
// and the synthetic cases are evaluation inputs, not completed model evaluations.
const root = new URL("../", import.meta.url);
const skillDir = new URL("plugins/inner-signal-therapy/skills/inner-signal-therapy/", root);
const REFERENCE = "references/CLAIM-INTEGRITY.md";
const read = (relative) => fs.readFile(new URL(relative, root), "utf8");
const flat = (text) => text.replace(/\s+/gu, " ").trim();
const coverage = JSON.parse(await read("tasks/claim-integrity-20260927/COVERAGE.json"));
const cases = JSON.parse(await read("corpus/claim-integrity-cases.json"));
const PACK_CHECKS = ["CI-01", "CI-02", "CI-03", "CI-04", "CI-05", "CI-06", "CI-07", "CI-08", "CI-09", "CI-10", "CI-11", "CI-X1"];
const DISPOSITIONS = new Set(["ADDED", "COVERED_BY_EXISTING", "NOT_APPLICABLE", "DEFERRED"]);
const context = (extra = {}) => ({ guideManifest: { version: "synthetic" }, guideExcerpts: "", userFacts: [],
  userMessage: "A synthetic report.", recentTranscript: "", ...extra });

test("every check has a recorded disposition, and the companion checks are carried", () => {
  assert.deepEqual(Object.keys(coverage.checks).sort(), [...PACK_CHECKS].sort());
  for (const [id, entry] of Object.entries(coverage.checks)) {
    assert.ok(DISPOSITIONS.has(entry.disposition), `${id} disposition`);
    if (entry.disposition === "NOT_APPLICABLE" || entry.disposition === "DEFERRED") {
      assert.ok(typeof entry.reason === "string" && entry.reason.length > 60, `${id} states its reason`);
    } else {
      assert.ok(Array.isArray(entry.anchors) && entry.anchors.length > 0, `${id} names its anchor phrases`);
    }
  }
  for (const id of ["CI-01", "CI-02", "CI-03", "CI-07", "CI-10"]) {
    assert.ok(["ADDED", "COVERED_BY_EXISTING"].includes(coverage.checks[id].disposition), `${id} is carried`);
  }
  assert.deepEqual(coverage.checks["CI-11"], {
    title: "Independent claim check before delivery",
    disposition: "NOT_APPLICABLE",
    reason: "The pack excludes companion and therapeutic replies from CI-11. InnerSignal replies are natural, not formulaic, and its separate critique and adjudication roles already carry the anchoring, quotation, absence, correction, and consistency rules."
  });
  assert.equal(coverage.checks["CI-X1"].disposition, "NOT_APPLICABLE");
});

test("every recorded anchor phrase is present word for word in its file", async () => {
  for (const [id, entry] of Object.entries(coverage.checks)) {
    for (const anchor of [...(entry.anchors ?? []), ...(entry.relatedExisting ?? [])]) {
      const words = flat(anchor.text).split(" ").length;
      assert.ok(words >= 6 && words <= 40, `${id} anchor has 6 to 40 words: ${anchor.text}`);
      assert.ok(flat(await read(anchor.file)).includes(flat(anchor.text)), `${id}: ${anchor.file} contains "${anchor.text}"`);
    }
    if (entry.disposition === "ADDED") {
      for (const anchor of entry.anchors) {
        assert.equal(anchor.file, `plugins/inner-signal-therapy/skills/inner-signal-therapy/${REFERENCE}`, `${id} anchor is in the served reference`);
        assert.ok(flat(claimIntegrityRules).includes(flat(anchor.text)), `${id} anchor is in the application rule`);
      }
    }
  }
  for (const boundary of coverage.scopeBoundaries) {
    if (boundary.anchor) assert.ok(flat(await read(boundary.anchor.file)).includes(flat(boundary.anchor.text)), boundary.surface);
  }
});

test("each reasoning consumer receives the claim-integrity rules exactly once", () => {
  const prompts = [caseAuditPrompt(context(), {}), candidatePrompt(context(), "synthetic"),
    critiquePrompt(context(), {}, "synthetic", "synthetic"), adjudicationPrompt(context(), {}, "synthetic"),
    realizationPrompt(context(), {}, "synthetic"), privateRuntimeAuditPrompt({}), privateRuntimeRepairPrompt({})];
  for (const prompt of prompts) assert.equal(prompt.system.split(claimIntegrityRules).length - 1, 1);
  assert.equal(longitudinalClinicalRules.split(claimIntegrityRules).length - 1, 1);
  assert.equal(sharedClinicalRules.split(claimIntegrityRules).length - 1, 1);
  // Extraction keeps its own equivalent anchoring rule instead of receiving a second copy.
  const extraction = caseExtractionPrompt(context()).system;
  assert.equal(extraction.includes(claimIntegrityRules), false);
  assert.match(extraction, /Record only direct observations that can be tied to exact user language\./u);
  assert.ok(claimIntegrityRules.startsWith(`\nCLAIM INTEGRITY (${CLAIM_INTEGRITY_VERSION})\n`));
  for (const code of CLAIM_INTEGRITY_AUDIT_CODES) assert.ok(claimIntegrityRules.includes(`\n- ${code}: `), code);
});

test("the plugin reference is the exact shared rule, read before responding, and served over MCP", async () => {
  const skill = await fs.readFile(new URL("SKILL.md", skillDir), "utf8");
  const reference = await fs.readFile(new URL(REFERENCE, skillDir), "utf8");
  assert.ok(reference.endsWith(claimIntegrityRules));
  const readLine = skill.split("\n").find((line) => line.startsWith("Read `references/") && line.endsWith("before responding."));
  assert.ok(readLine.includes(`\`${REFERENCE}\``));
  assert.ok(THERAPY_PROTOCOL_FILES.includes(REFERENCE));
  assert.equal(loadTherapyProtocol().files.find((file) => file.path === REFERENCE).content, reference);
});

test("the served rules are self-contained and govern claims, not style", async () => {
  const reference = await fs.readFile(new URL(REFERENCE, skillDir), "utf8");
  for (const text of [reference, claimIntegrityRules]) {
    assert.doesNotMatch(text, /universal-dev-architecture|\bUDA\b|\bCI-(?:0\d|10|X1)\b|Mission Control|check pack/iu);
    assert.doesNotMatch(text, /\b(?:always|must)\s+(?:quote|restate|summari[sz]e|repeat)\b/iu);
  }
  assert.match(claimIntegrityRules, /They never require quoting, restating, or summarizing the person; natural paraphrase and warm, conversational wording stay the default\./u);
  assert.match(claimIntegrityRules, /keep that light rather than hedging every sentence/u);
  assert.match(claimIntegrityRules, /Quotation marks around a suggested phrase, an example, or exercise wording are fine when it is clear the words are yours\./u);
  assert.match(claimIntegrityRules, /Do not flag natural paraphrase, a response that quotes nothing, a reading plainly offered as the responder's own, or quotation marks around wording that is clearly the responder's suggestion\./u);
});

const quoted = (text) => [...text.matchAll(/["“]([^"”]+)["”]/gu)].map((match) => match[1].trim().replace(/[.,;:!?]+$/u, ""));
const personWords = (fixture) => [
  ...fixture.priorTranscript.split("\n").filter((line) => line.startsWith("User: ")).map((line) => line.slice("User: ".length)),
  fixture.personMessage
].join("\n");

test("the synthetic contrast cases obey the rules they illustrate", () => {
  assert.deepEqual([...new Set(cases.map((fixture) => fixture.expectedAuditCode))].sort(), [...CLAIM_INTEGRITY_AUDIT_CODES].sort());
  for (const fixture of cases) {
    const words = personWords(fixture);
    assert.notEqual(fixture.acceptableResponse, fixture.rejectedResponse, fixture.id);
    for (const span of quoted(fixture.acceptableResponse)) {
      assert.ok(words.includes(span), `${fixture.id}: the acceptable response quotes the person's exact words: ${span}`);
    }
    if (fixture.expectedAuditCode === "INEXACT_QUOTATION") {
      assert.ok(quoted(fixture.rejectedResponse).some((span) => !words.includes(span)), `${fixture.id}: the rejected quotation is inexact`);
    }
    if (fixture.expectedAuditCode === "UNSUPPORTED_ABSENCE_CLAIM") {
      assert.ok(words.includes(fixture.mentionedEarlier), `${fixture.id}: the earlier mention is in the conversation`);
    }
  }
});

for (const fixture of cases) {
  test(`claim-integrity case reaches the response consumers with the rules: ${fixture.id}`, () => {
    const caseContext = context({ recentTranscript: fixture.priorTranscript, userMessage: fixture.personMessage });
    for (const prompt of [caseAuditPrompt(caseContext, {}), candidatePrompt(caseContext, "test"), realizationPrompt(caseContext, {}, "test")]) {
      assert.ok(prompt.system.includes(claimIntegrityRules));
      assert.ok(prompt.user.includes(fixture.personMessage));
      if (fixture.priorTranscript) assert.ok(prompt.user.includes(fixture.priorTranscript));
    }
    const packet = { recent_transcript: fixture.priorTranscript, current_user_message: fixture.personMessage };
    for (const prompt of [privateRuntimeAuditPrompt(packet), privateRuntimeRepairPrompt(packet)]) {
      assert.ok(prompt.system.includes(claimIntegrityRules));
      assert.ok(prompt.user.includes(JSON.stringify(packet, null, 2)));
    }
  });
}
