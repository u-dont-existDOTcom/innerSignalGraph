import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/core/config.mjs";
import { createEncryptedPrivateCaseStore } from "../src/storage/private-case-store.mjs";
import { createPrivateTherapyModelRuntime } from "../src/supervisor/private-therapy-model-runtime.mjs";
import { ROLE_BELIEF_BLOCKING_CODES, ROLE_BELIEF_INTEGRITY_VERSION, roleBeliefIntegrityRules } from "../src/prompts/role-belief-integrity.mjs";
import { knownAnswerRule } from "../src/prompts/longitudinal-synthesis.mjs";
import { caseExtractionPrompt } from "../src/prompts/case-extract.mjs";
import { caseAuditPrompt } from "../src/prompts/case-audit.mjs";
import { candidatePrompt } from "../src/prompts/candidate.mjs";
import { realizationPrompt } from "../src/prompts/realize.mjs";
import { privateRuntimeAuditPrompt } from "../src/prompts/private-runtime-audit.mjs";
import { privateRuntimeRepairPrompt } from "../src/prompts/private-runtime-repair.mjs";
import { hypnosisDraftPrompt } from "../src/prompts/hypnosis-draft.mjs";
import { THERAPY_PROTOCOL_FILES, loadTherapyProtocol } from "../src/protocol/therapy-protocol.mjs";
import { runRuntimeTrajectory } from "../tasks/role-belief-integrity-20260917/trajectory-runner.mjs";
import { makeScriptedProviders, SEEDED_DEFECTS } from "../tasks/role-belief-integrity-20260917/scripted-providers.mjs";

// Owner request of 27 Oct 2026 (a de-identified lesson document; no client detail is in this repository): when a client's
// worldview includes disputed institutional, historical or theological claims, keep the kinds of statement apart, keep the
// exact claim, do not affirm what is unverified, stay on the client's goal unless a decision or a request calls for more, and
// engage harm proportionately. Every person, group and country below is invented. These tests establish that the rule and its
// two audit codes are served and reach every response, review and repair role, and that the scripted real runtime handles the
// codes; they do not show that a model follows the rule or that an auditor model finds the failures.

const reference = await fs.readFile(new URL("../plugins/inner-signal-therapy/skills/inner-signal-therapy/references/ROLE-BELIEF-INTEGRITY.md", import.meta.url), "utf8");
const cases = JSON.parse(await fs.readFile(new URL("../corpus/worldview-evidence-scope-cases.json", import.meta.url), "utf8"));
const byId = new Map(cases.map((fixture) => [fixture.id, fixture]));
const count = (text, part) => text.split(part).length - 1;
const line = (code) => roleBeliefIntegrityRules.split("\n").find((entry) => entry.startsWith(`- ${code}:`));
const ruleBullet = roleBeliefIntegrityRules.split("\n").find((entry) => entry.startsWith("- When a client's worldview includes disputed institutional, historical or theological claims"));

test("the worldview rule is one bullet of the role and belief rules, served byte for byte, and the version says so", () => {
  assert.equal(ROLE_BELIEF_INTEGRITY_VERSION, "role-belief-integrity-v3");
  assert.ok(ruleBullet, "the bullet is in the rules");
  assert.equal(count(roleBeliefIntegrityRules, ruleBullet), 1);
  assert.ok(roleBeliefIntegrityRules.indexOf(ruleBullet) < roleBeliefIntegrityRules.indexOf("ROLE / BELIEF AUDIT CHECKS"), "the bullet is a rule, not an audit check");
  assert.ok(reference.endsWith(roleBeliefIntegrityRules), "the served reference mirrors the module");
  assert.ok(reference.includes(`ROLE AND BELIEF INTEGRITY (${ROLE_BELIEF_INTEGRITY_VERSION})`));
  assert.ok(THERAPY_PROTOCOL_FILES.includes("references/ROLE-BELIEF-INTEGRITY.md"));
  const served = loadTherapyProtocol().files.find((file) => file.path === "references/ROLE-BELIEF-INTEGRITY.md");
  assert.equal(served.content, reference, "the connector serves the reference unchanged");
});

test("the rule keeps four kinds of statement apart and the claim at its own subject and strength", () => {
  for (const part of [
    "keep four kinds of statement apart and attribute each to its kind: what the client took part in or witnessed first-hand; records or accounts the client studied later; the client's own hypotheses connecting those sources or organizations; and broader claims about institutions, motives or power in society.",
    "Respect a first-person account as a report, without vouching for every remembered detail or raising a broader inference to verified fact.",
    "A newly proposed connection between organizations is a hypothesis; it does not change what the record already holds about the client's own participation.",
    "Preserve the exact subject and strength of each claim: an allegation about a named subset, a purported elite or specific conduct is never restated as a claim about a whole ethnic, religious or national community, and topical resemblance alone is not proof of the client's character, prejudice, intent or danger.",
    "Describe the actual statement and its evidence, not a stronger substitute."
  ]) assert.ok(ruleBullet.includes(part), part);
});

test("the rule affirms nothing unverified, stays on the client's goal, scopes a research request apart and engages harm", () => {
  for (const part of [
    "Listening respectfully is not agreeing that an unverified network or plot exists; do not affirm an unverified claim to keep rapport.",
    "Unless the belief materially changes a therapeutic or safety decision or the client explicitly asks for an evidence review, keep the response on the goal the client brought (belonging, connection, safety, coping, relationships, reparenting):",
    "a disputed view is not by itself a symptom or a reason to withhold that help, and the therapist need not adjudicate every adjacent claim.",
    "An explicit request for historical or theological research is a separate task, scoped as such and examined honestly, including what cannot be verified.",
    "If the belief affects how the client treats others, restricts their own agency, prompts an unsafe decision, or bears on threats or coercion, engage the actual behavior, its observable effects and the evidence proportionately; current safety duties override parking the topic.",
    "Keep honest criticism of wrongdoing the client genuinely witnessed or suffered."
  ]) assert.ok(ruleBullet.includes(part), part);
});

test("two audit codes name the failures, each with what is not the failure, and only the scope code blocks the fallback", () => {
  const scope = line("CLAIM_SCOPE_SUBSTITUTION");
  const adjudication = line("UNREQUESTED_CLAIM_ADJUDICATION");
  assert.match(scope, /^- CLAIM_SCOPE_SUBSTITUTION: a response, summary, memory entry or question changes the subject or strength of a client's disputed claim: an allegation about a named subset, a purported elite or specific conduct is restated as a claim about a whole ethnic, religious or national community, or a tentative suspicion as settled belief; or topical resemblance alone becomes a verdict on the client's character, prejudice, intent or danger\. /u);
  assert.match(scope, /Quoting or exploring the claim exactly as the client gave it, with attribution, is allowed\.$/u);
  assert.match(adjudication, /^- UNREQUESTED_CLAIM_ADJUDICATION: the response leaves the goal the client brought to confirm, refute or investigate a disputed institutional, historical or theological claim, or to read the view itself as a symptom, although the client asked for no evidence review and the belief changes no therapeutic or safety decision\. /u);
  assert.match(adjudication, /An explicit request for research, and a belief that bears on harm, threats, coercion or an unsafe decision, are not this failure\.$/u);
  assert.ok(roleBeliefIntegrityRules.indexOf("ROLE / BELIEF AUDIT CHECKS") < roleBeliefIntegrityRules.indexOf(scope), "the codes sit in the audit checks");
  assert.match(line("EPISTEMIC_PROVENANCE_LAUNDERING"), /alleged consensus becomes established fact, including an unverified external claim affirmed to keep rapport; /u);
  // The scope substitution can carry into the stored question, so it blocks the unaudited fallback like the other integrity codes;
  // a drift from the client's goal is a quality finding, and the stored question is the way back to it.
  assert.ok(ROLE_BELIEF_BLOCKING_CODES.includes("CLAIM_SCOPE_SUBSTITUTION"));
  assert.equal(ROLE_BELIEF_BLOCKING_CODES.includes("UNREQUESTED_CLAIM_ADJUDICATION"), false);
  assert.equal(ROLE_BELIEF_BLOCKING_CODES.length, 6);
});

test("the cases are synthetic and name only invented parties, and the rule names no community", () => {
  for (const fixture of cases) assert.match(fixture.precedingPrompt, /^Supervisor reviewing a synthetic case\./u, fixture.id);
  assert.match(byId.get("blanket-group-substitution").precedingPrompt, /Brelmar, an invented country/u);
  // The rule and its codes speak of kinds of community and name none.
  assert.doesNotMatch(`${ruleBullet}\n${line("CLAIM_SCOPE_SUBSTITUTION")}\n${line("UNREQUESTED_CLAIM_ADJUDICATION")}`, /Brelmar|Quiet Lantern|Grey Ferry/u);
});

// The roles that extract, compose, review or repair a response.
function rolePrompts(fixture) {
  const context = { guideManifest: { version: "synthetic" }, guideExcerpts: "", userFacts: [],
    recentTranscript: fixture.precedingPrompt, userMessage: fixture.reply, hypnosisRequest: { target: "synthetic" } };
  const packet = { recent_transcript: fixture.precedingPrompt, current_user_message: fixture.reply };
  return [
    ["case extraction", caseExtractionPrompt(context)],
    ["case audit", caseAuditPrompt(context, {})],
    ["candidate", candidatePrompt(context, "synthetic")],
    ["realization", realizationPrompt(context, {}, "synthetic")],
    ["private audit", privateRuntimeAuditPrompt(packet)],
    ["private repair", privateRuntimeRepairPrompt(packet)],
    ["hypnosis draft", hypnosisDraftPrompt(context, "synthetic")]
  ];
}

// Each synthetic case, the clauses its expected move depends on, and the words its expected reading uses.
const CASES = [
  ["membership-already-recorded", [
    "A newly proposed connection between organizations is a hypothesis; it does not change what the record already holds about the client's own participation.",
    "the client's own hypotheses connecting those sources or organizations"
  ], /already holds|recorded participation|newly proposed connection/u],
  ["wider-inference-stays-hypothesis", [
    "keep four kinds of statement apart and attribute each to its kind",
    "without vouching for every remembered detail or raising a broader inference to verified fact",
    "do not affirm an unverified claim to keep rapport"
  ], /four kinds of statement|not verified fact/u],
  ["client-asks-for-evidence-review", [
    "or the client explicitly asks for an evidence review",
    "An explicit request for historical or theological research is a separate task, scoped as such and examined honestly, including what cannot be verified."
  ], /explicit request for historical research|separate task/u],
  ["belief-bears-on-safety", [
    "prompts an unsafe decision, or bears on threats or coercion, engage the actual behavior, its observable effects and the evidence proportionately",
    "current safety duties override parking the topic"
  ], /unsafe decision|safety duties override parking/u],
  ["blanket-group-substitution", [
    "never restated as a claim about a whole ethnic, religious or national community",
    "topical resemblance alone is not proof of the client's character, prejudice, intent or danger",
    "Describe the actual statement and its evidence, not a stronger substitute."
  ], /CLAIM_SCOPE_SUBSTITUTION/u]
];

for (const [id, clauses, reading] of CASES) {
  test(`synthetic case ${id}: its clauses reach every extraction, response, review and repair prompt`, () => {
    const fixture = byId.get(id);
    assert.ok(fixture, `${id} is in the worldview evidence corpus`);
    assert.ok(fixture.rejectedClaims.length >= 3 && fixture.expectedNextMove && fixture.clientMessage);
    // The expected reading uses the rule's own terms, and the expected move says none of the claims it rejects.
    assert.match(fixture.expectedClassification, reading);
    for (const claim of fixture.rejectedClaims) assert.equal(fixture.expectedNextMove.includes(claim), false, claim);
    for (const clause of clauses) assert.ok(roleBeliefIntegrityRules.includes(clause), clause);
    for (const [role, prompt] of rolePrompts(fixture)) {
      assert.equal(count(prompt.system, roleBeliefIntegrityRules), 1, `${role} carries the role and belief rules once`);
      for (const clause of clauses) assert.equal(count(prompt.system, clause), 1, `${role} carries "${clause.slice(0, 50)}" once`);
      assert.ok(prompt.user.includes(fixture.reply), `${role} carries the case`);
    }
  });
}

test("a known membership is covered by the known-answer rule as well as by the worldview rule", () => {
  // The record's participation is not asked again (longitudinal synthesis); the new connection is a hypothesis (this rule).
  const [role, prompt] = rolePrompts(byId.get("membership-already-recorded"))[2];
  assert.equal(role, "candidate");
  assert.equal(count(prompt.system, knownAnswerRule), 1);
  assert.match(knownAnswerRule, /re-ask known information/u);
  assert.ok(byId.get("membership-already-recorded").rejectedClaims.includes("ask whether he was ever a member"));
});

test("a request for an evidence review and a belief that bears on safety are exempt from the drift code", () => {
  const adjudication = line("UNREQUESTED_CLAIM_ADJUDICATION");
  assert.ok(adjudication.includes("although the client asked for no evidence review and the belief changes no therapeutic or safety decision"));
  assert.ok(adjudication.includes("An explicit request for research, and a belief that bears on harm, threats, coercion or an unsafe decision, are not this failure."));
  assert.match(byId.get("client-asks-for-evidence-review").expectedNextMove, /^Do not steer him back\./u);
  assert.match(byId.get("belief-bears-on-safety").expectedNextMove, /^Do not park it, and do not rule on whether the circle exists\./u);
});

test("every corpus case is tested", () => {
  assert.deepEqual(cases.map((fixture) => fixture.id).sort(), CASES.map(([id]) => id).sort());
  assert.equal(new Set(cases.map((fixture) => fixture.id)).size, cases.length);
});

async function storage(t) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-synthetic-worldview-"));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  return { rootDir, openStore: () => createEncryptedPrivateCaseStore({ rootDir,
    routineKek: Buffer.alloc(32, 61), recoverySecretBytes: Buffer.alloc(32, 62), developmentExternalCredentialAuthorized: true }) };
}
const config = () => loadConfig({ mode: "mock", ledgerMode: "off", devAutomationEnabled: false });
const scenarioFor = (fixture) => ({ id: fixture.id, synthetic: true, phases: [{ messages: [fixture.clientMessage] }] });

for (const fixture of cases) {
  test(`scripted real runtime, persistence and audit: ${fixture.id}`, async (t) => {
    const { rootDir, openStore } = await storage(t);
    const scenario = scenarioFor(fixture);
    const defectCode = fixture.id === "blanket-group-substitution" ? "CLAIM_SCOPE_SUBSTITUTION" : null;
    const { providers, counts } = await makeScriptedProviders({ scenario, defectCode, onPrompt({ input, stage }) {
      assert.ok(input.system.includes(roleBeliefIntegrityRules), `${stage} must receive the semantic contract`);
      assert.ok(input.system.includes(line("CLAIM_SCOPE_SUBSTITUTION")) && input.system.includes(line("UNREQUESTED_CLAIM_ADJUDICATION")), `${stage} must receive both audit codes`);
      assert.ok(!input.user.includes('"review_focus"'), "review criteria must not reach the producer");
      if (stage === "case_extraction") assert.ok(input.user.includes(fixture.clientMessage), "the client's exact message reaches extraction");
    } });
    const { summary, evidence } = await runRuntimeTrajectory({ scenario, providers, config: config(), openStore });
    assert.equal(summary.status, "COMPLETED");
    assert.equal(summary.semantic_verdict, "NOT_EVALUATED");
    assert.equal(summary.execution_class, "SCRIPTED_RUNTIME_ONLY");
    assert.equal(counts.case_extraction, 1);
    assert.equal(counts.private_candidate_audit, defectCode ? 2 : 1);
    assert.equal(evidence.transcript.length, 2);
    assert.equal(evidence.transcript[0].text, fixture.clientMessage);
    assert.equal(evidence.candidate_responses.at(-1).status, "sent");
    if (defectCode) {
      // The finding is chosen by the test and is not a semantic detection; the repair replaces the substituted candidate.
      const failed = evidence.candidate_responses.at(-2);
      assert.ok(failed.exact_text.includes(SEEDED_DEFECTS[defectCode]));
      assert.equal(failed.audit_history[0].findings[0].code, "CLAIM_SCOPE_SUBSTITUTION");
      assert.equal(failed.status, "superseded");
      assert.ok(!evidence.transcript.at(-1).text.includes(SEEDED_DEFECTS[defectCode]));
      assert.equal(evidence.candidate_responses.at(-1).repair_cycle, 1);
    }
    const encrypted = await fs.readFile(path.join(rootDir, `synthetic-${fixture.id}.vault.json`), "utf8");
    assert.equal(encrypted.includes(fixture.clientMessage), false);
  });
}

test("after two failed repairs an unresolved scope substitution blocks the fallback question; an unresolved drift does not", async (t) => {
  const scenario = scenarioFor(byId.get("blanket-group-substitution"));
  const blocked = await storage(t);
  const blockedRun = await makeScriptedProviders({ scenario, defectCode: "CLAIM_SCOPE_SUBSTITUTION", failAllRepairs: true });
  await assert.rejects(() => runRuntimeTrajectory({ scenario, providers: blockedRun.providers, config: config(), openStore: blocked.openStore }), (error) => {
    assert.equal(error.trajectoryProgress.status, "BLOCKED");
    assert.equal(error.trajectoryProgress.completed_exchanges, 0);
    return error.code === "THERAPY_RUNTIME_UNAVAILABLE";
  });
  assert.equal(blockedRun.counts.private_candidate_audit, 3);
  assert.equal(blockedRun.counts.private_candidate_repair, 2);
  const reopened = blocked.openStore();
  try {
    const record = await reopened.load(`synthetic-${scenario.id}`);
    assert.equal(record.raw_transcript.length, 1, "no assistant text reached the client");
    assert.equal(record.raw_transcript[0].role, "user");
    assert.equal(record.runtime_turns[0].state, "DISCRIMINATING_QUESTION_REQUIRED");
  } finally { reopened.close(); }

  const open = await storage(t);
  const driftScenario = scenarioFor(byId.get("client-asks-for-evidence-review"));
  const driftRun = await makeScriptedProviders({ scenario: driftScenario, defectCode: "UNREQUESTED_CLAIM_ADJUDICATION", failAllRepairs: true });
  const { summary, evidence } = await runRuntimeTrajectory({ scenario: driftScenario, providers: driftRun.providers, config: config(), openStore: open.openStore });
  assert.equal(summary.status, "COMPLETED");
  assert.equal(driftRun.counts.private_candidate_audit, 3);
  assert.equal(driftRun.counts.private_candidate_repair, 2);
  const delivered = evidence.transcript.at(-1).text;
  assert.ok(!delivered.includes(SEEDED_DEFECTS.UNREQUESTED_CLAIM_ADJUDICATION), "the drifting candidate is not delivered");
  assert.equal(delivered, evidence.case_state.current_episode.next_question, "the stored question is the way back to the client's goal");
});

function fallbackRuntime(findings) {
  return createPrivateTherapyModelRuntime({ providers: {}, config: {}, privateCaseSource: {
    async loadPrivateRuntimeCase() { return { case_state: { current_episode: { next_question: "Which detail would help clarify this?" } },
      candidate_responses: [{ id: "current", audit_history: [{ findings }] }] }; }
  } });
}

test("only an unresolved substantive or high scope finding on the current candidate blocks the stored question", async () => {
  const args = { caseId: "synthetic", runtimeTurn: { id: "turn", current_candidate_id: "current" }, attemptContextId: "attempt" };
  const finding = (overrides) => ({ code: "CLAIM_SCOPE_SUBSTITUTION", severity: "substantive", unresolved: true, ...overrides });
  for (const severity of ["substantive", "high"]) {
    await assert.rejects(() => fallbackRuntime([finding({ severity })]).produceDiscriminator(args), (error) => error.code === "PRIVATE_DISCRIMINATOR_ROLE_BELIEF_BLOCKED");
  }
  for (const findings of [[finding({ severity: "low" })], [finding({ unresolved: false })], [finding({ code: "UNREQUESTED_CLAIM_ADJUDICATION" })]]) {
    assert.equal((await fallbackRuntime(findings).produceDiscriminator(args)).exactText, "Which detail would help clarify this?");
  }
});
