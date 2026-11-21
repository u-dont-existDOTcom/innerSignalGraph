import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { buildDurableCaseContext } from "../src/case-state/context-window.mjs";
import { buildTrajectoryDigest, SAFETY_ORIENTATION_ROUTE_ID, SUICIDE_FAMILY_ROUTE_IDS } from "../src/case-state/trajectory-digest.mjs";
import { SELF_DIRECTED_RISK_AUDIT_CODES, SELF_DIRECTED_RISK_AUDIT_VERSION, selfDirectedRiskAuditRules } from "../src/prompts/self-directed-risk-audit.mjs";
import { privateRuntimeAuditPrompt } from "../src/prompts/private-runtime-audit.mjs";
import { projectCommunicationState } from "../src/storage/private-case-communication.mjs";
import { OWNER_FALLBACK_KIND, OWNER_FALLBACK_MESSAGE } from "../src/supervisor/owner-fallback-message.mjs";
import { PRIVATE_CANDIDATE_AUDIT_VERSION, buildPrivateCandidateAuditInput } from "../src/supervisor/private-candidate-audit.mjs";
import {
  RECORD_ONLY_AUDIT_CODES,
  createCandidateAuditEvidence,
  isSubstantiveAuditFinding,
  validateCandidateAuditEvidence,
  validateCandidateAuditFinding
} from "../src/supervisor/private-candidate-lifecycle.mjs";
import { createPrivateRuntimeDiscriminator, isDeliverableDiscriminatorQuestion, validatePrivateRuntimeTurn } from "../src/supervisor/private-runtime-turn-lifecycle.mjs";
import { createPrivateTherapyModelRuntime } from "../src/supervisor/private-therapy-model-runtime.mjs";
import { BLOCKING_FINDING, openScriptedRiskRuntime } from "./fixtures/scripted-risk-runtime.mjs";

// Everything here is synthetic. Messages are numbered placeholders, findings are test-chosen, and the "providers" are scripts that
// return what the test says; none of this judges meaning. A passing run shows that the code paths behave as stated, not that a
// real model would report these findings.
const CALM = "IC.CREDIBILITY_REPAIR";
const INQUIRY = "IC.SUICIDAL_SELF_DEATH_INQUIRY";
const PRECIOUS = "IC.PRECIOUS_HUMAN_OPPORTUNITY";
const ADULT_SEAT = "IC.SUICIDAL_ADULT_SEAT";
const SAFETY = "IC.SAFETY_ORIENTATION";
const ROLE_BELIEF_FINDING = Object.freeze({ id: "synthetic-role-belief", code: "HARMFUL_BELIEF_ENDORSEMENT", severity: "substantive", summary: "Synthetic role or belief defect." });
const recordOnly = (code, severity) => ({ id: `synthetic-${code.toLowerCase()}-${severity}`, code, severity, summary: `Synthetic ${severity} finding for review.` });
const EXPECTED_FALLBACK = "I couldn’t finish a reply I’m confident in just now, so I’m not sending one. If you’re in danger right now, please reach someone who can be with you: a person you trust, or emergency services where you are. When you’re ready, you can write again here.";

const syntheticCandidate = Object.freeze({
  id: "candidate:synthetic:v1",
  version: 1,
  status: "pending_audit",
  exact_text: "Synthetic candidate text.",
  producer_context_id: "context:synthetic-producer",
  parent_candidate_id: null,
  repair_cycle: 0
});
function evidenceFor(findings) {
  return createCandidateAuditEvidence({
    auditId: "audit:synthetic:1",
    candidate: syntheticCandidate,
    auditVersion: PRIVATE_CANDIDATE_AUDIT_VERSION,
    auditorContext: { kind: "independent", context_id: "context:synthetic-auditor" },
    findings,
    completedAt: "2026-11-01T00:00:00.000Z"
  });
}

// ---- The three record-only codes -------------------------------------------------------------------------------------------

test("the record-only set is exactly the three self-directed-risk codes", () => {
  assert.deepEqual([...SELF_DIRECTED_RISK_AUDIT_CODES], ["SELF_DIRECTED_RISK_UNDERREACTION", "SELF_DIRECTED_RISK_OVERREACTION", "LONGITUDINAL_CONTEXT_MISSING"]);
  assert.deepEqual([...RECORD_ONLY_AUDIT_CODES], [...SELF_DIRECTED_RISK_AUDIT_CODES]);
});

for (const code of SELF_DIRECTED_RISK_AUDIT_CODES) {
  for (const severity of ["low", "medium", "substantive", "high"]) {
    test(`${code} at ${severity} severity is stored and never blocks`, () => {
      const audit = evidenceFor([recordOnly(code, severity)]);
      assert.equal(audit.verdict, "pass");
      assert.deepEqual(audit.unresolved_substantive_finding_ids, []);
      assert.equal(audit.sufficient_for_approval, true, "a pass with only record-only findings is sufficient for approval, as an empty audit is");
      const [stored] = audit.findings;
      assert.equal(stored.code, code);
      assert.equal(stored.record_only, true);
      if (severity === "substantive" || severity === "high") {
        assert.equal(stored.severity, "medium", "the stored severity cannot block");
        assert.equal(stored.reported_severity, severity, "what the auditor reported is kept");
      } else {
        assert.equal(stored.severity, severity);
        assert.equal(Object.hasOwn(stored, "reported_severity"), false);
      }
      // The blocking predicate and the consistency checks are unchanged, so the stored evidence reads the same everywhere,
      // including in a build that has never heard of these codes.
      assert.equal(isSubstantiveAuditFinding(stored), false);
      assert.doesNotThrow(() => validateCandidateAuditEvidence(structuredClone(audit), syntheticCandidate));
    });
  }
}

test("every other code keeps its blocking behaviour, including near misses and the role and belief codes", () => {
  const others = [
    "SYNTHETIC_BLOCKING_DEFECT",
    "HARMFUL_BELIEF_ENDORSEMENT",
    "ROLE_REVERSAL_OR_DEPENDENCY",
    "FALSE_ASSISTANT_IDENTITY",
    "CAUSAL_OVERCLAIM",
    "SELF_DIRECTED_RISK_OTHER",
    "LONGITUDINAL_CONTEXT_MISSING_EXTRA",
    "self_directed_risk_underreaction"
  ];
  for (const code of others) {
    for (const severity of ["substantive", "high"]) {
      const audit = evidenceFor([recordOnly(code, severity)]);
      assert.equal(audit.verdict, "fail", `${code} at ${severity}`);
      assert.deepEqual(audit.unresolved_substantive_finding_ids, [`synthetic-${code.toLowerCase()}-${severity}`]);
      assert.equal(audit.sufficient_for_approval, false);
      assert.equal(Object.hasOwn(audit.findings[0], "record_only"), false);
      assert.equal(audit.findings[0].severity, severity);
    }
    for (const severity of ["low", "medium"]) assert.equal(evidenceFor([recordOnly(code, severity)]).verdict, "pass", `${code} at ${severity} never blocked`);
  }
});

test("a record-only finding next to a blocking one leaves the blocking one in charge", () => {
  const audit = evidenceFor([recordOnly("SELF_DIRECTED_RISK_UNDERREACTION", "high"), BLOCKING_FINDING, recordOnly("LONGITUDINAL_CONTEXT_MISSING", "substantive")]);
  assert.equal(audit.verdict, "fail");
  assert.deepEqual(audit.unresolved_substantive_finding_ids, [BLOCKING_FINDING.id]);
  assert.deepEqual(audit.findings.map((finding) => [finding.code, finding.record_only === true]), [
    ["SELF_DIRECTED_RISK_UNDERREACTION", true],
    ["SYNTHETIC_BLOCKING_DEFECT", false],
    ["LONGITUDINAL_CONTEXT_MISSING", true]
  ]);
});

test("the stored record-only fields are validated", () => {
  const base = { id: "f1", code: "SELF_DIRECTED_RISK_OVERREACTION", severity: "medium", summary: "Synthetic." };
  assert.doesNotThrow(() => validateCandidateAuditFinding({ ...base, record_only: true, reported_severity: "high" }));
  assert.throws(() => validateCandidateAuditFinding({ ...base, record_only: false }), /record_only is invalid/u);
  assert.throws(() => validateCandidateAuditFinding({ ...base, reported_severity: "high" }), /reported_severity is invalid/u, "a reported severity belongs to a record-only finding");
  assert.throws(() => validateCandidateAuditFinding({ ...base, record_only: true, reported_severity: "urgent" }), /reported_severity is invalid/u);
});

// ---- The audit text and the audit packet -----------------------------------------------------------------------------------

test("the audit text names the three codes, the whole-case comparison and the record-only rule", () => {
  const { system } = privateRuntimeAuditPrompt({ synthetic: true });
  assert.ok(system.includes(selfDirectedRiskAuditRules));
  for (const code of SELF_DIRECTED_RISK_AUDIT_CODES) assert.ok(system.includes(code), code);
  assert.match(system, new RegExp(SELF_DIRECTED_RISK_AUDIT_VERSION, "u"));
  assert.match(system, /trajectory_digest/u);
  assert.match(system, /never hold back a reply and never start a repair/u);
  assert.match(system, /OVERREACTION[^\n]*generic crisis script/u, "the over-reaction code names the crisis-script case");
  assert.equal(PRIVATE_CANDIDATE_AUDIT_VERSION, "private-candidate-audit-v4");
});

test("the audit text keeps the three codes from standing in for a blocking finding, and says the digest's counts can be a lower bound", () => {
  const { system } = privateRuntimeAuditPrompt({ synthetic: true });
  // The record-only codes are added records; an unanswered stated intent is also reported as a blocking finding under another code.
  assert.match(system, /added records, never a substitute for a blocking finding/u);
  assert.match(system, /current intent, a plan, nearness or an inability to stay safe and the candidate leaves it unanswered, also report a blocking finding at substantive or high under a code other than these three/u);
  assert.match(system, /Any defect that would block on its own merits keeps its blocking code/u);
  const underreaction = system.split("\n").find((line) => line.startsWith("- Report SELF_DIRECTED_RISK_UNDERREACTION"));
  assert.ok(underreaction);
  assert.equal(/unanswered/u.test(underreaction), false, "an unanswered intent is no longer offered as an example of the record-only code");
  assert.equal(system.includes("leaving a stated intent or nearness unanswered"), false);
  // It is the closing bullet of the block, so it is the last of this text the auditor reads.
  assert.match(selfDirectedRiskAuditRules.trim().split("\n").at(-1), /never a substitute for a blocking finding.*also report a blocking finding.*keeps its blocking code/u);
  assert.match(system, /counts_are_a_lower_bound is true/u);
  assert.match(system, /risk_readings_dropped_from_record_history/u);
  assert.match(system, /Do not read a missing count as an absence of earlier turns/u);
});

test("the audit input carries the digest, computed in code from the same context", async () => {
  const context = {
    candidate_response: { id: "candidate-1", version: 1, status: "pending_audit", exact_text: "Synthetic candidate.", parent_candidate_id: null, producer_context_id: "context:p" },
    constitution_ref: { version: "synthetic-constitution" },
    case_state: { synthetic: true },
    last_state_diff: { synthetic: true },
    recent_verbatim: { turns: [] },
    targeted_older_evidence: [],
    current_episode: { id: "synthetic-episode" },
    continuation_safety: { continuation_safe: true, failures: [] },
    user_turn_count: 3
  };
  const asked = [];
  const input = await buildPrivateCandidateAuditInput({ caseAccessService: { loadCaseContext: async (_caseId, _authContext, options) => { asked.push(options); return context; } }, caseId: "synthetic-case" });
  assert.equal(asked.length, 1);
  assert.equal(asked[0].forReplyCheck, true, "the audit asks for the context built for the reply check");
  assert.deepEqual(input.trajectory_digest, buildTrajectoryDigest(context));
  assert.equal(input.trajectory_digest.computed_in_code, true);
  assert.equal(input.trajectory_digest.model_calls, 0);
  assert.equal(input.trajectory_digest.whole_case.user_turn_count, 3);
  assert.ok(input.instructions.some((line) => /trajectory_digest/u.test(line)));
});

// ---- The approved fallback wording ------------------------------------------------------------------------------------------

test("the fallback is one named constant with the owner's wording, byte-identical to the text approved, and the approval recorded in its comment", async () => {
  assert.equal(OWNER_FALLBACK_MESSAGE, EXPECTED_FALLBACK);
  // The text did not change when the owner approved it (question 54, answer A): these are the size and digest it had in the commits before.
  assert.equal(Buffer.byteLength(OWNER_FALLBACK_MESSAGE, "utf8"), 261);
  assert.equal(createHash("sha256").update(OWNER_FALLBACK_MESSAGE, "utf8").digest("hex"), "94523796880b5742ff094bb7a2bfd6d35648221603d6c360aac3863892fbebf6");
  assert.equal((OWNER_FALLBACK_MESSAGE.match(/’/gu) ?? []).length, 5, "five curly apostrophes");
  assert.equal(OWNER_FALLBACK_MESSAGE.includes("'"), false, "no straight apostrophes");
  assert.equal(OWNER_FALLBACK_MESSAGE.includes("?"), false, "it is not a question, so it cannot pass as a discriminating question");
  assert.equal(isDeliverableDiscriminatorQuestion(OWNER_FALLBACK_MESSAGE), false);
  const source = await fs.readFile(new URL("../src/supervisor/owner-fallback-message.mjs", import.meta.url), "utf8");
  assert.match(source, /^\/\/ Approved by the owner: question 54, answer A, 1 Nov 2026, 12:00 UTC\.$/mu);
  assert.equal(/OWNER-PENDING|not (yet )?approved|\bdraft\b|\bpending\b/iu.test(source), false, "nothing in the file calls the wording pending, a draft or unapproved");
  assert.equal(source.split("couldn’t finish a reply").length - 1, 1, "the wording appears once, in the constant");
  // No other source file repeats the wording, so a change of approved copy is one edit.
  const runtimeSource = await fs.readFile(new URL("../src/supervisor/private-therapy-model-runtime.mjs", import.meta.url), "utf8");
  assert.equal(runtimeSource.includes("couldn’t finish"), false);
});

test("a stored question stays byte-identical, and the fallback is created only as the fixed text with its own kind", () => {
  const common = { producerContextId: "context:x", createdAt: "2026-11-01T00:00:00.000Z" };
  const question = createPrivateRuntimeDiscriminator({ exactText: "Which part of this stays unsettled?", ...common });
  assert.equal(Object.hasOwn(question, "kind"), false);
  const fallback = createPrivateRuntimeDiscriminator({ exactText: OWNER_FALLBACK_MESSAGE, kind: OWNER_FALLBACK_KIND, ...common });
  assert.equal(fallback.kind, OWNER_FALLBACK_KIND);
  assert.equal(fallback.exact_text, OWNER_FALLBACK_MESSAGE);
  assert.throws(() => createPrivateRuntimeDiscriminator({ exactText: "Some other text.", kind: OWNER_FALLBACK_KIND, ...common }), /fixed fallback message/u);
  assert.throws(() => createPrivateRuntimeDiscriminator({ exactText: OWNER_FALLBACK_MESSAGE, ...common }), /question/iu, "without its kind the fixed text is not a valid question");
  assert.throws(() => createPrivateRuntimeDiscriminator({ exactText: OWNER_FALLBACK_MESSAGE, kind: "something_else", ...common }), /kind is invalid/u);
});

// ---- produceDiscriminator: the decision, row by row ------------------------------------------------------------------------

// `ownerFallback` is the setting (INNER_SIGNAL_OWNER_FALLBACK as loadConfig reads it into config). The rows below describe the setting on, which is
// what they test; the rows for the setting off, and for a config that does not carry it, are in owner-fallback-setting.test.mjs.
function discriminatorRuntime({ activeStep, route = activeStep, nextQuestion, findings = [], extra = {}, ownerFallback = true }) {
  const source = {
    async loadPrivateRuntimeCase() {
      return {
        case_state: { current_episode: activeStep === undefined && route === undefined ? undefined : { active_step: activeStep, route, next_question: nextQuestion }, ...extra },
        candidate_responses: [{ id: "candidate-1", audit_history: [{ findings }] }]
      };
    }
  };
  const runtime = createPrivateTherapyModelRuntime({ privateCaseSource: source, providers: {}, config: { ownerFallbackEnabled: ownerFallback } });
  return () => runtime.produceDiscriminator({ caseId: "synthetic-case", runtimeTurn: { id: "runtime-turn-1", current_candidate_id: "candidate-1" }, authContext: null, attemptContextId: "attempt-1" });
}
const QUESTION = "Which part of this stays unsettled for you?";
const unavailable = (code) => (error) => error?.code === code;

test("produceDiscriminator on the safety-orientation route: a sendable stored question is still sent, otherwise the fallback", async () => {
  const stored = await discriminatorRuntime({ activeStep: SAFETY, nextQuestion: QUESTION })();
  assert.equal(stored.exactText, QUESTION);
  assert.equal(Object.hasOwn(stored, "kind"), false);
  assert.equal(stored.providerReceipt.provider, "deterministic-current-episode");
  assert.equal((await discriminatorRuntime({ activeStep: SAFETY, nextQuestion: `  ${QUESTION}\n` })()).exactText, QUESTION, "surrounding whitespace is trimmed, as it is on every route");
  const unsendable = [
    ["an empty question", ""],
    ["a missing question", undefined],
    ["a blank question", "   "],
    ["two question marks", "First part? Second part?"],
    ["no question mark", "Tell me more"],
    ["two lines", "First line?\nSecond line"],
    ["too long", `${"x".repeat(1_001)}?`]
  ];
  for (const [label, nextQuestion] of unsendable) {
    const produced = await discriminatorRuntime({ activeStep: SAFETY, nextQuestion })();
    assert.equal(produced.kind, OWNER_FALLBACK_KIND, label);
    assert.equal(produced.exactText, OWNER_FALLBACK_MESSAGE, label);
  }
});

test("produceDiscriminator on the self-death inquiry route always uses the fallback instead of the unaudited stored question", async () => {
  for (const nextQuestion of [QUESTION, "", undefined]) {
    const produced = await discriminatorRuntime({ activeStep: INQUIRY, nextQuestion })();
    assert.equal(produced.kind, OWNER_FALLBACK_KIND);
    assert.equal(produced.exactText, OWNER_FALLBACK_MESSAGE);
    assert.equal(produced.providerReceipt.provider, "deterministic-owner-fallback");
    assert.equal(produced.providerReceipt.model, null);
    assert.match(produced.contextId, /^context:[0-9a-f]+$/u);
  }
  const question = await discriminatorRuntime({ activeStep: CALM, nextQuestion: QUESTION })();
  const fallback = await discriminatorRuntime({ activeStep: INQUIRY, nextQuestion: QUESTION })();
  assert.notEqual(fallback.contextId, question.contextId, "the two paths never share a context identity");
});

test("produceDiscriminator on a route outside the list of four is unchanged, with or without a question", async () => {
  // The adult-seat and precious-opportunity routes joined the list with the owner's answer to question 55 (owner-fallback-routes.test.mjs).
  for (const activeStep of [CALM, "IC.SOMETHING_ELSE", null]) {
    const produced = await discriminatorRuntime({ activeStep, route: activeStep ?? CALM, nextQuestion: QUESTION })();
    assert.equal(produced.exactText, QUESTION, String(activeStep));
    assert.equal(Object.hasOwn(produced, "kind"), false, String(activeStep));
    await assert.rejects(discriminatorRuntime({ activeStep, route: activeStep ?? CALM, nextQuestion: "" }), unavailable("PRIVATE_DISCRIMINATOR_UNAVAILABLE"), String(activeStep));
  }
  await assert.rejects(discriminatorRuntime({ activeStep: undefined, route: undefined, nextQuestion: "" }), unavailable("PRIVATE_DISCRIMINATOR_UNAVAILABLE"), "a case with no episode");
});

test("the route is read from the active step first, then the episode route", async () => {
  assert.equal((await discriminatorRuntime({ activeStep: INQUIRY, route: "IC.SOMETHING_ELSE", nextQuestion: QUESTION })()).kind, OWNER_FALLBACK_KIND);
  assert.equal((await discriminatorRuntime({ activeStep: null, route: INQUIRY, nextQuestion: QUESTION })()).kind, OWNER_FALLBACK_KIND);
  assert.equal((await discriminatorRuntime({ activeStep: CALM, route: INQUIRY, nextQuestion: QUESTION })()).exactText, QUESTION);
});

test("a state flag or a held risk record alone never produces the fallback", async () => {
  const held = { self_directed_risk: { version: 1, current: { level: "imminent", context: "unknown", assessed_turn_id: "t1", assessed_at: "2026-11-01T00:00:00.000Z", observation_ids: [], latest_turn_id: "t1", denied: false, unknown: false, lowering_readings: [] }, history: [] } };
  const produced = await discriminatorRuntime({ activeStep: CALM, nextQuestion: QUESTION, extra: held })();
  assert.equal(produced.exactText, QUESTION);
  assert.equal(Object.hasOwn(produced, "kind"), false);
  await assert.rejects(discriminatorRuntime({ activeStep: CALM, nextQuestion: "", extra: held }), unavailable("PRIVATE_DISCRIMINATOR_UNAVAILABLE"));
});

test("an unresolved role or belief finding is checked before the stored question and before the fallback, and still blocks on a route outside the list", async () => {
  // On the four risk routes the fixed message is delivered in its place (owner-fallback-routes.test.mjs); on any other route the block is unchanged.
  for (const activeStep of [CALM, "IC.SOMETHING_ELSE", null]) {
    await assert.rejects(discriminatorRuntime({ activeStep, route: activeStep ?? CALM, nextQuestion: "", findings: [{ ...ROLE_BELIEF_FINDING, unresolved: true }] }), unavailable("PRIVATE_DISCRIMINATOR_ROLE_BELIEF_BLOCKED"), String(activeStep));
  }
  // Findings that do not block today still do not block: a resolved finding, a low one, or another code.
  for (const findings of [[{ ...ROLE_BELIEF_FINDING, unresolved: false }], [{ ...ROLE_BELIEF_FINDING, severity: "medium" }], [BLOCKING_FINDING]]) {
    assert.equal((await discriminatorRuntime({ activeStep: INQUIRY, nextQuestion: QUESTION, findings })()).kind, OWNER_FALLBACK_KIND);
  }
});

// ---- Through the whole audit loop ------------------------------------------------------------------------------------------

test("safety-orientation turn whose candidate cannot be approved and has no question: the fallback is delivered, as its own kind", async (t) => {
  const runtime = await openScriptedRiskRuntime(t, { readings: ["imminent"], auditFindings: () => [BLOCKING_FINDING], ownerFallback: true });
  const result = await runtime.run(1);
  assert.equal(result.deliveryKind, OWNER_FALLBACK_KIND);
  assert.equal(result.answer, OWNER_FALLBACK_MESSAGE);
  assert.deepEqual([runtime.counts.private_candidate_audit, runtime.counts.private_candidate_repair], [3, 2], "the audit and both repairs ran first");

  const record = await runtime.load();
  const episode = record.case_state.current_episode;
  assert.deepEqual([episode.active_step, episode.next_question], [SAFETY, ""], "this route had no question, so nothing could have been delivered before");
  const [turn] = record.runtime_turns;
  assert.deepEqual([turn.state, turn.discriminator.kind, turn.delivery.kind], ["DELIVERED", OWNER_FALLBACK_KIND, OWNER_FALLBACK_KIND]);
  assert.equal(turn.discriminator.exact_text, OWNER_FALLBACK_MESSAGE);
  assert.equal(turn.delivery.exact_text, OWNER_FALLBACK_MESSAGE);
  assert.deepEqual(record.raw_transcript.map((entry) => [entry.role, entry.text]), [["user", "Synthetic message 1."], ["assistant", OWNER_FALLBACK_MESSAGE]]);
  assert.deepEqual(record.candidate_responses.map((candidate) => candidate.status), ["superseded", "superseded", "superseded"], "no candidate was sent");
  assert.equal(record.candidate_responses.at(-1).metadata.superseded_by_owner_fallback_runtime_turn_id, turn.id);
  assert.equal(Object.hasOwn(record.candidate_responses.at(-1).metadata, "superseded_by_discriminator_runtime_turn_id"), false);

  const outbound = projectCommunicationState(record);
  const delivered = outbound.confirmed_or_reported_client_outbound.filter((entry) => entry.assistant_turn_id === "risk-1-assistant");
  assert.equal(delivered.length, 1);
  assert.deepEqual([delivered[0].state, delivered[0].delivery_evidence, delivered[0].source.route], ["app_committed", "application_persisted", "runtime_owner_fallback"]);
  assert.deepEqual(outbound.unresolved_delivery, [], "the delivery is attributed, not left unexplained");
  assert.doesNotThrow(() => validatePrivateRuntimeTurn(structuredClone(turn)));
});

test("self-death inquiry turn after the second failed repair: the fallback replaces the unaudited stored question", async (t) => {
  const runtime = await openScriptedRiskRuntime(t, { readings: ["ideation"], auditFindings: () => [BLOCKING_FINDING], ownerFallback: true });
  const result = await runtime.run(1);
  assert.equal(result.deliveryKind, OWNER_FALLBACK_KIND);
  assert.equal(result.answer, OWNER_FALLBACK_MESSAGE);
  assert.deepEqual([runtime.counts.private_candidate_audit, runtime.counts.private_candidate_repair], [3, 2]);
  const record = await runtime.load();
  const episode = record.case_state.current_episode;
  assert.equal(episode.active_step, INQUIRY);
  assert.ok(isDeliverableDiscriminatorQuestion(episode.next_question), "a sendable stored question existed, and was not sent");
  assert.notEqual(result.answer, episode.next_question);
  assert.equal(record.raw_transcript.at(-1).text, OWNER_FALLBACK_MESSAGE);
  assert.equal(record.runtime_turns[0].delivery.kind, OWNER_FALLBACK_KIND);
});

test("the fallback never appears for a state flag alone: approved replies on both routes stay candidates", async (t) => {
  const runtime = await openScriptedRiskRuntime(t, { readings: ["imminent", "intent", "ideation", "imminent"], ownerFallback: true });
  const routes = [];
  for (let number = 1; number <= 4; number += 1) {
    const result = await runtime.run(number);
    assert.equal(result.deliveryKind, "candidate", `turn ${number}`);
    assert.notEqual(result.answer, OWNER_FALLBACK_MESSAGE);
    assert.equal(result.runtimeTurn.discriminator, null);
    routes.push((await runtime.load()).case_state.current_episode.active_step);
  }
  assert.deepEqual(routes, [SAFETY, INQUIRY, INQUIRY, SAFETY], "both fallback routes were exercised");
  assert.deepEqual([runtime.counts.private_candidate_audit, runtime.counts.private_candidate_repair ?? 0], [4, 0]);
});

test("a calm turn whose candidate fails twice still gets today's stored question, even while a risk record is held", async (t) => {
  const runtime = await openScriptedRiskRuntime(t, {
    readings: ["ideation", "absent"],
    auditFindings: ({ turn }) => (turn === 2 ? [BLOCKING_FINDING] : []),
    ownerFallback: true
  });
  assert.equal((await runtime.run(1)).deliveryKind, "candidate");
  const result = await runtime.run(2);
  const record = await runtime.load();
  assert.equal(record.case_state.current_episode.active_step, CALM);
  assert.equal(record.case_state.self_directed_risk.current.level, "ideation", "one quiet turn does not lower the record");
  assert.equal(result.deliveryKind, "discriminator");
  assert.equal(result.answer, record.case_state.current_episode.next_question);
  assert.equal(Object.hasOwn(result.runtimeTurn.discriminator, "kind"), false, "a stored question carries no kind field");
  assert.doesNotThrow(() => validatePrivateRuntimeTurn(structuredClone(result.runtimeTurn)));
});

test("an unresolved role or belief finding on a calm route still ends the turn unavailable, with nothing delivered, even with the fallback on", async (t) => {
  // On the four risk routes the fixed message is delivered here instead (owner-fallback-routes.test.mjs).
  const runtime = await openScriptedRiskRuntime(t, { readings: ["absent"], auditFindings: () => [ROLE_BELIEF_FINDING], ownerFallback: true });
  await assert.rejects(() => runtime.run(1), unavailable("THERAPY_RUNTIME_UNAVAILABLE"));
  const record = await runtime.load();
  assert.equal(record.case_state.current_episode.active_step, CALM);
  assert.equal(record.runtime_turns[0].state, "DISCRIMINATING_QUESTION_REQUIRED");
  assert.equal(record.runtime_turns[0].discriminator, null);
  assert.deepEqual(record.raw_transcript.map((entry) => entry.role), ["user"]);
});

test("an operational failure of the audit on the inquiry route is not turned into the fallback", async (t) => {
  const runtime = await openScriptedRiskRuntime(t, { readings: ["ideation"], auditFails: () => true, ownerFallback: true });
  await assert.rejects(() => runtime.run(1), unavailable("THERAPY_RUNTIME_UNAVAILABLE"));
  const record = await runtime.load();
  assert.notEqual(record.runtime_turns[0].state, "DELIVERED");
  assert.equal(record.runtime_turns[0].discriminator, null);
  assert.deepEqual(record.raw_transcript.map((entry) => entry.role), ["user"]);
});

test("the calm route is untouched by the fallback, even with the setting on", async (t) => {
  assert.ok(SUICIDE_FAMILY_ROUTE_IDS.includes(PRECIOUS) && SUICIDE_FAMILY_ROUTE_IDS.includes(ADULT_SEAT) && SAFETY_ORIENTATION_ROUTE_ID === SAFETY);
  const runtime = await openScriptedRiskRuntime(t, { readings: ["absent"], auditFindings: () => [BLOCKING_FINDING], ownerFallback: true });
  const result = await runtime.run(1);
  assert.equal((await runtime.load()).case_state.current_episode.active_step, CALM);
  assert.equal(result.deliveryKind, "discriminator");
  assert.notEqual(result.answer, OWNER_FALLBACK_MESSAGE);
});

test("a delivery whose kind disagrees with its discriminator kind, or whose kind is unknown, is rejected on read", async (t) => {
  const runtime = await openScriptedRiskRuntime(t, { readings: ["imminent"], auditFindings: () => [BLOCKING_FINDING], ownerFallback: true });
  const { runtimeTurn } = await runtime.run(1);
  assert.doesNotThrow(() => validatePrivateRuntimeTurn(structuredClone(runtimeTurn)));
  const mismatched = structuredClone(runtimeTurn);
  mismatched.delivery.kind = "discriminator";
  assert.throws(() => validatePrivateRuntimeTurn(mismatched), /kind does not match/u);
  const unknownKind = structuredClone(runtimeTurn);
  unknownKind.discriminator.kind = "something_else";
  assert.throws(() => validatePrivateRuntimeTurn(unknownKind), /discriminator kind is invalid/u);
  const unmarked = structuredClone(runtimeTurn);
  delete unmarked.discriminator.kind;
  assert.throws(() => validatePrivateRuntimeTurn(unmarked), /question/iu, "the fixed text is not a valid question without its kind");
  const unknownDelivery = structuredClone(runtimeTurn);
  unknownDelivery.delivery.kind = "something_else";
  assert.throws(() => validatePrivateRuntimeTurn(unknownDelivery), /delivery kind is invalid/u);
});

// ---- Record-only findings through the whole audit loop ---------------------------------------------------------------------

test("record-only findings at high severity do not hold back the reply or start a repair, and are kept in the audit history", async (t) => {
  const findings = SELF_DIRECTED_RISK_AUDIT_CODES.map((code) => recordOnly(code, "high"));
  const runtime = await openScriptedRiskRuntime(t, { auditFindings: () => findings });
  const result = await runtime.run(1);
  assert.equal(result.deliveryKind, "candidate");
  assert.deepEqual([runtime.counts.private_candidate_audit, runtime.counts.private_candidate_repair ?? 0], [1, 0], "one audit and no repair");
  const record = await runtime.load();
  assert.deepEqual(record.candidate_responses.map((candidate) => candidate.status), ["sent"]);
  const [audit] = record.candidate_responses[0].audit_history;
  assert.equal(audit.verdict, "pass");
  assert.deepEqual(audit.unresolved_substantive_finding_ids, []);
  assert.deepEqual(audit.findings.map((finding) => [finding.code, finding.record_only, finding.severity, finding.reported_severity]),
    SELF_DIRECTED_RISK_AUDIT_CODES.map((code) => [code, true, "medium", "high"]));
});

test("record-only findings are the only thing a clean first audit reports: no repair even on the busiest risk route", async (t) => {
  const runtime = await openScriptedRiskRuntime(t, { readings: ["imminent"], auditFindings: () => [recordOnly("SELF_DIRECTED_RISK_UNDERREACTION", "substantive")] });
  const result = await runtime.run(1);
  assert.equal(result.deliveryKind, "candidate");
  assert.equal(runtime.counts.private_candidate_repair ?? 0, 0);
});

test("a blocking finding still starts a repair, and the repair writer is not shown the record-only finding", async (t) => {
  const repairInputs = [];
  const recordOnlyFinding = recordOnly("SELF_DIRECTED_RISK_OVERREACTION", "high");
  const runtime = await openScriptedRiskRuntime(t, {
    auditFindings: ({ auditNumber }) => (auditNumber === 1 ? [recordOnlyFinding, BLOCKING_FINDING] : [recordOnly("LONGITUDINAL_CONTEXT_MISSING", "high")]),
    onPrompt({ stage, input }) { if (stage === "private_candidate_repair") repairInputs.push(input); }
  });
  const result = await runtime.run(1);
  assert.equal(result.deliveryKind, "candidate");
  assert.deepEqual([runtime.counts.private_candidate_audit, runtime.counts.private_candidate_repair], [2, 1]);
  assert.equal(repairInputs.length, 1);
  const shown = `${repairInputs[0].system}\n${repairInputs[0].user}`;
  assert.ok(shown.includes(BLOCKING_FINDING.code), "the blocking finding reaches the repair writer");
  assert.equal(shown.includes("SELF_DIRECTED_RISK_OVERREACTION"), false, "the record-only finding does not");
  const record = await runtime.load();
  assert.deepEqual(record.candidate_responses.map((candidate) => [candidate.repair_cycle, candidate.status]), [[0, "superseded"], [1, "sent"]]);
  assert.deepEqual(record.candidate_responses[0].audit_history[0].findings.map((finding) => finding.code), ["SELF_DIRECTED_RISK_OVERREACTION", "SYNTHETIC_BLOCKING_DEFECT"], "the first audit keeps both");
  assert.equal(record.candidate_responses[1].audit_history[0].findings[0].record_only, true);
});

// ---- The digest and the record in a real nine-turn run ---------------------------------------------------------------------

test("in a real run, the turn-9 audit packet carries the digest and the record after a route change, and the manifest says so", async (t) => {
  const readings = ["absent", "absent", "absent", "absent", "absent", "ideation", "ideation", "absent", "unknown"];
  const packets = new Map();
  const runtime = await openScriptedRiskRuntime(t, { readings, onAuditPacket({ turn, packet }) { packets.set(turn, packet); } });
  const routes = [];
  for (let number = 1; number <= readings.length; number += 1) {
    assert.equal((await runtime.run(number)).deliveryKind, "candidate");
    routes.push((await runtime.load()).case_state.current_episode.route);
  }
  assert.deepEqual(routes, [CALM, CALM, CALM, CALM, CALM, INQUIRY, INQUIRY, CALM, CALM], "the route changed at turn 6 and again at turn 8");

  const packet = packets.get(9);
  assert.deepEqual(packet.recent_verbatim.turns.map((turn) => turn.id), ["risk-8-user", "risk-8-assistant", "risk-9-user"], "turns 6 and 7 are outside the verbatim window");
  const digest = packet.trajectory_digest;
  assert.deepEqual([digest.computed_in_code, digest.model_calls], [true, 0]);
  assert.deepEqual(digest.whole_case, { user_turn_count: 9, planned_turn_count: 9, user_turns_in_verbatim_window: 2, user_turns_outside_verbatim_window: 7 });
  assert.deepEqual(
    { id: digest.current_episode.id, started: digest.current_episode.started_turn_number, by: digest.current_episode.started_by, previous: digest.current_episode.previous_selected_route },
    { id: "episode:risk-8-user", started: 8, by: "route_change", previous: INQUIRY }
  );
  assert.deepEqual(digest.route_sequence.runs.map((run) => [run.route, run.from_turn, run.to_turn]), [[CALM, 1, 5], [INQUIRY, 6, 7], [CALM, 8, 9]]);
  assert.deepEqual(
    [digest.suicide_family.earlier_user_turns_outside_verbatim_window, digest.suicide_family.turn_numbers, digest.suicide_family.with_exact_text_in_targeted_older_evidence, digest.suicide_family.without_exact_text_in_this_packet],
    [2, [6, 7], 2, 0],
    "two earlier risk turns outside the window, and both have their exact text: the turn of the record's highest reading (the later of the two equal readings) and the turn of its first reading"
  );
  const risk = digest.self_directed_risk;
  assert.deepEqual([risk.level, risk.assessed_turn_number, risk.latest_reading_turn_number, risk.latest_reading_unknown, risk.fresh_readings_below_held_level],
    ["ideation", 6, 9, true, []]);
  assert.deepEqual(risk.history.map((entry) => [entry.change, entry.turn_number]), [["raised", 6], ["held", 7]]);

  assert.deepEqual(packet.targeted_older_evidence.map((entry) => [entry.turn_id, entry.turn.text]), [["risk-7-user", "Synthetic message 7."], ["risk-6-user", "Synthetic message 6."]], "the highest reading's turn and the first statement's turn");
  assert.deepEqual(risk.highest_reading_in_history, { reading: "ideation", turn_id: "risk-7-user", turn_number: 7 }, "the digest names the highest reading's turn, which the packet carries");
  assert.equal(Object.hasOwn(packet.case_state, "self_directed_risk"), false, "the record reaches the auditor once, through the digest");
  assert.deepEqual(
    [packet.disclosure_manifest.trajectory_digest_included, packet.disclosure_manifest.trajectory_digest_computed_in_code_without_model, packet.disclosure_manifest.self_directed_risk_record_included],
    [true, true, true]
  );
  // Before the first reading above absent there is no record, and the manifest says so.
  assert.equal(packets.get(3).trajectory_digest.self_directed_risk, null);
  assert.equal(packets.get(3).disclosure_manifest.self_directed_risk_record_included, false);
  assert.equal(packets.get(3).disclosure_manifest.trajectory_digest_included, true);
  assert.deepEqual(packets.get(3).trajectory_digest.suicide_family.turn_numbers, []);
});

const RECORD_REASON = "current-self-directed-risk-record";
const RECORD_ITEM = "self_directed_risk.current";
const shownIn = (input) => `${input.system}\n${input.user}`;

test("after a route change the extraction and writing prompts carry neither the record nor its retrieval, while the audit and repair packets do", async (t) => {
  const prompts = [];
  const auditPackets = [];
  const runtime = await openScriptedRiskRuntime(t, {
    readings: ["ideation", "absent"],
    auditFindings: ({ turn, auditNumber }) => (turn === 2 && auditNumber === 1 ? [BLOCKING_FINDING] : []),
    onPrompt({ stage, turn, input }) { if (stage !== "private_candidate_audit") prompts.push({ stage, turn, text: shownIn(input) }); },
    onAuditPacket({ turn, auditNumber, packet }) { auditPackets.push({ turn, auditNumber, packet }); }
  });
  assert.equal((await runtime.run(1)).deliveryKind, "candidate");
  assert.equal((await runtime.run(2)).deliveryKind, "candidate", "the second turn needed one repair");
  const record = await runtime.load();
  assert.equal(record.case_state.self_directed_risk.current.level, "ideation", "one quiet turn does not lower the record");
  assert.deepEqual(record.case_state.current_episode.started_turn_id, "risk-2-user", "the route changed on turn 2, so turn 1 is outside the verbatim window");

  // Turn 2's extraction, writing and repair prompts, which is where the retrieval would appear.
  const stages = new Set(prompts.filter((entry) => entry.turn === 2).map((entry) => entry.stage));
  for (const stage of ["case_extraction", "realization", "private_candidate_repair"]) assert.ok(stages.has(stage), `${stage} prompts were captured on turn 2`);
  for (const { stage, turn, text } of prompts) {
    const where = `${stage} on turn ${turn}`;
    if (stage === "private_candidate_repair") continue;
    // Every prompt except the repair writer's: no reason, no item id, no record, no digest, and not the older turn's text.
    assert.equal(text.includes(RECORD_REASON), false, where);
    assert.equal(text.includes(RECORD_ITEM), false, where);
    assert.equal(text.includes("self_directed_risk"), false, where);
    assert.equal(text.includes("trajectory_digest"), false, where);
    assert.equal(text.includes("lowering_readings"), false, where);
    if (turn === 2) assert.equal(text.includes("TARGETED OLDER VERBATIM EVIDENCE (null means the referenced exact turn is not available in this context):\n(none)"), true, where);
  }

  // The audit packet on turn 2 carries the request's evidence: the reason, the item and the exact older turn.
  const audit = auditPackets.find((entry) => entry.turn === 2 && entry.auditNumber === 1).packet;
  assert.deepEqual(audit.targeted_older_evidence.map((entry) => [entry.turn_id, entry.reasons, entry.item_ids, entry.turn.text]),
    [["risk-1-user", [RECORD_REASON], [RECORD_ITEM], "Synthetic message 1."]]);

  // The repair writer gets the same older turn, because the repair is part of the reply check, but not the record.
  const repair = prompts.find((entry) => entry.stage === "private_candidate_repair" && entry.turn === 2);
  assert.ok(repair.text.includes(RECORD_REASON) && repair.text.includes("Synthetic message 1."));
  assert.equal(repair.text.includes("self_directed_risk\""), false, "no record in case_state");
  assert.equal(repair.text.includes("lowering_readings"), false);
  assert.equal(repair.text.includes("trajectory_digest"), false);
});

test("the writing prompts built from the context a producer receives never carry the record's retrieval, even with the record's turn outside the window", async () => {
  // buildContext is what feeds the extraction, realization, candidate, critique, adjudication and case-audit prompts.
  const { buildContext } = await import("../src/orchestrator/context-builder.mjs");
  const { loadConfig } = await import("../src/core/config.mjs");
  const { mergeRuntimeSnapshotIntoCaseState, createEmptyCaseState } = await import("../src/case-state/longitudinal-state.mjs");
  const { durableCaseContextBlock } = await import("../src/prompts/common.mjs");
  let caseState = createEmptyCaseState({ caseId: "synthetic-producer-context" });
  const transcript = [];
  const route = (id) => ({ primaryJob: { id, title: `Synthetic route ${id}` }, nextQuestion: "", selectedNodes: [], variables: {} });
  [["ideation", INQUIRY], ["absent", CALM]].forEach(([state, id], index) => {
    const number = index + 1;
    caseState = mergeRuntimeSnapshotIntoCaseState(caseState, { variables: { suicidal_state: state, suicidal_ideation_context: "unknown" }, direct_observations: [], hypotheses: [] },
      { turnId: `T${number}-user`, recordedAt: `2026-11-01T00:0${number}:00.000Z`, interventionContract: route(id) });
    transcript.push({ id: `T${number}-user`, exchange_id: `X${number}`, role: "user", text: `Synthetic user message ${number}.`, at: `2026-11-01T00:0${number}:00.000Z`, episode_id: caseState.current_episode.id });
    if (number < 2) transcript.push({ id: `T${number}-assistant`, exchange_id: `X${number}`, role: "assistant", text: `Synthetic reply ${number}.`, at: `2026-11-01T00:0${number}:00.000Z`, episode_id: caseState.current_episode.id });
  });
  assert.equal(caseState.self_directed_risk.current.level, "ideation");
  const config = loadConfig({ mode: "mock", ledgerMode: "off", devAutomationEnabled: false });
  const context = await buildContext({ caseId: "synthetic-producer-context", userMessage: "Synthetic message 3.", recentTranscriptEntries: transcript, durableCaseState: caseState, trackerEntries: [] }, config);
  assert.equal(context.recentTranscriptEntries.some((turn) => turn.id === "T1-user"), false, "turn 1 is outside the window");
  assert.deepEqual(context.targetedRetrievalRequests, []);
  assert.deepEqual(context.targetedOlderEvidence, []);
  const forReplyCheck = buildDurableCaseContext({ caseId: "synthetic-producer-context", caseState, transcriptEntries: transcript, forReplyCheck: true });
  assert.deepEqual(forReplyCheck.targeted_retrieval_requests.map((request) => request.item_id), [RECORD_ITEM], "the same case does produce the request for the reply check");
  const block = durableCaseContextBlock(context);
  assert.equal(block.includes(RECORD_REASON) || block.includes(RECORD_ITEM) || block.includes("Synthetic user message 1."), false);
});

// ---- Retention for the reply check, through the whole audit loop --------------------------------------------------------------

test("a quiet stretch after one reading keeps that turn's exact text in the audit packet on turns 3, 4 and 5, and the lowering turn included", async (t) => {
  // The review's sequence: absent, ideation, absent, absent, absent. Turn 2's route is the inquiry route; turn 3 changes it back.
  const readings = ["absent", "ideation", "absent", "absent", "absent"];
  const packets = new Map();
  const runtime = await openScriptedRiskRuntime(t, { readings, onAuditPacket({ turn, auditNumber, packet }) { if (auditNumber === 1) packets.set(turn, packet); } });
  const routes = [];
  const levels = [];
  for (let number = 1; number <= readings.length; number += 1) {
    assert.equal((await runtime.run(number)).deliveryKind, "candidate");
    const stored = await runtime.load();
    routes.push(stored.case_state.current_episode.route);
    levels.push(stored.case_state.self_directed_risk?.current?.level ?? null);
  }
  assert.deepEqual(routes, [CALM, INQUIRY, CALM, CALM, CALM]);
  assert.deepEqual(levels, [null, "ideation", "ideation", "absent", "absent"], "the level-lowering rule is unchanged: two quiet turns lower it, at turn 4");
  const evidenceTurns = (turn) => packets.get(turn).targeted_older_evidence.map((entry) => [entry.turn_id, entry.turn?.text ?? null]);
  assert.deepEqual(evidenceTurns(1), []);
  for (const turn of [3, 4, 5]) {
    assert.deepEqual(evidenceTurns(turn), [["risk-2-user", "Synthetic message 2."]], `the audit packet on turn ${turn} holds turn 2's exact text`);
    assert.equal(packets.get(turn).recent_verbatim.turns.some((entry) => entry.id === "risk-2-user"), false, `turn 2 is outside the verbatim window on turn ${turn}`);
  }
  assert.equal(packets.get(4).trajectory_digest.self_directed_risk.level, "absent");
  assert.equal(packets.get(4).trajectory_digest.suicide_family.without_exact_text_in_this_packet, 0, "before this change the packet on turn 4 had none of it");
  assert.equal(packets.get(5).trajectory_digest.suicide_family.with_exact_text_in_targeted_older_evidence, 1);
});

test("a turn that is both the first and the highest reading stays in the audit packet after its ten planned turns end, for the rest of the case (the shape of arc A8)", async (t) => {
  const readings = ["absent", "ideation"];
  const packets = new Map();
  const runtime = await openScriptedRiskRuntime(t, { readings, maximumTurns: 17, onAuditPacket({ turn, auditNumber, packet }) { if (auditNumber === 1) packets.set(turn, packet); } });
  for (let number = 1; number <= 17; number += 1) assert.equal((await runtime.run(number)).deliveryKind, "candidate");
  const stored = await runtime.load();
  assert.equal(stored.case_state.self_directed_risk.current.lowered_at_planned_turn, 4);
  assert.equal(stored.case_state.self_directed_risk.first_reading.assessed_turn_id, "risk-2-user");
  const holds = (turn) => packets.get(turn).targeted_older_evidence.some((entry) => entry.turn_id === "risk-2-user");
  const turnsWithIt = [...packets.keys()].filter(holds);
  assert.deepEqual(turnsWithIt, [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17], "from the reading's next turn on: the tenth planned turn after the lowering turn (turn 4) is turn 14, and the first reading's turn stays after it");
  for (const turn of [14, 15, 16, 17]) assert.deepEqual(packets.get(turn).targeted_older_evidence.map((entry) => entry.turn_id), ["risk-2-user"], `one entry, once, on turn ${turn}`);
  assert.equal(packets.get(16).trajectory_digest.self_directed_risk.level, "absent", "the record itself stays, with its history");
  assert.equal(packets.get(16).trajectory_digest.self_directed_risk.history.length, 2);
  assert.equal(packets.get(16).trajectory_digest.suicide_family.without_exact_text_in_this_packet, 0, "before this change the packet on turn 15 and after had none of it");
});

test("the highest reading's turn leaves the audit packet ten planned turns after the lowering to absent, while the first statement's turn stays in the audit packet and in the repair packet", async (t) => {
  // The statement on turn 2 and again on turn 3 (equal readings: turn 3 is the highest reading, turn 2 the first). Turns 4 and 5 are quiet, so
  // the level goes to absent while turn 5 is merged and the highest reading's window runs to turn 15. A repair is forced on turns 6 and 17.
  const readings = ["absent", "ideation", "ideation"];
  const packets = new Map();
  const repairs = [];
  const runtime = await openScriptedRiskRuntime(t, {
    readings,
    maximumTurns: 18,
    auditFindings: ({ turn, auditNumber }) => ((turn === 6 || turn === 17) && auditNumber === 1 ? [BLOCKING_FINDING] : []),
    onPrompt({ stage, turn, input }) { if (stage === "private_candidate_repair") repairs.push({ turn, text: shownIn(input) }); },
    onAuditPacket({ turn, auditNumber, packet }) { if (auditNumber === 1) packets.set(turn, packet); }
  });
  for (let number = 1; number <= 18; number += 1) assert.equal((await runtime.run(number)).deliveryKind, "candidate");
  const stored = await runtime.load();
  assert.equal(stored.case_state.self_directed_risk.current.lowered_at_planned_turn, 5);
  assert.deepEqual([stored.case_state.self_directed_risk.first_reading.level, stored.case_state.self_directed_risk.first_reading.assessed_turn_id], ["ideation", "risk-2-user"]);
  const evidenceIds = (turn) => packets.get(turn).targeted_older_evidence.map((entry) => entry.turn_id);
  for (const turn of [1, 2, 3]) assert.deepEqual(evidenceIds(turn), [], `turn ${turn}: turns 2 and 3 are inside the verbatim window`);
  for (let turn = 4; turn <= 15; turn += 1) assert.deepEqual(evidenceIds(turn), ["risk-3-user", "risk-2-user"], `turn ${turn}: the highest reading's turn, then the first statement's`);
  for (const turn of [16, 17, 18]) assert.deepEqual(evidenceIds(turn), ["risk-2-user"], `turn ${turn}: only the first statement's turn, which has no window`);
  assert.deepEqual(packets.get(18).targeted_older_evidence.map((entry) => entry.turn.text), ["Synthetic message 2."]);
  const countsAt = (turn) => { const family = packets.get(turn).trajectory_digest.suicide_family; return [family.with_exact_text_in_targeted_older_evidence, family.without_exact_text_in_this_packet]; };
  assert.deepEqual(countsAt(15), [2, 0], "the digest's own counts follow the packet");
  assert.deepEqual(countsAt(16), [1, 1]);

  // The repair writer is part of the reply check, so it gets the same turns, and never the record.
  const repairAt = (turn) => repairs.find((entry) => entry.turn === turn)?.text ?? "";
  for (const turn of [6, 17]) {
    assert.ok(repairAt(turn).includes(RECORD_REASON) && repairAt(turn).includes("Synthetic message 2."), `the repair on turn ${turn} holds the first statement's exact text`);
    assert.equal(repairAt(turn).includes("self_directed_risk\""), false, `turn ${turn}: no record in case_state`);
    assert.equal(repairAt(turn).includes("lowering_readings"), false);
    assert.equal(repairAt(turn).includes("trajectory_digest"), false);
  }
  assert.equal(repairAt(6).includes("Synthetic message 3."), true, "inside the window the repair writer also gets the highest reading's turn");
  assert.equal(repairAt(17).includes("Synthetic message 3."), false, "past the window it does not");
});

test("through the audit loop, the first turn at the highest level stays in the audit and repair packets beside the latest repeat and the first statement (the shape of arc A5, variant)", async (t) => {
  // Ideation on turns 4 and 5, imminent on turns 6 and 7 (the second repeats the first), then ideation again. The route changes at turns 4, 6
  // and 8, so from turn 8 the window holds only the current turn. The first reading is turn 4, the highest reading is turn 7, and turn 6 is
  // the first time the person reached the highest level. A repair is forced on turn 9.
  const readings = ["absent", "absent", "absent", "ideation", "ideation", "imminent", "imminent", "ideation", "ideation", "ideation", "ideation", "ideation"];
  const packets = new Map();
  const repairs = [];
  const runtime = await openScriptedRiskRuntime(t, {
    readings,
    maximumTurns: 12,
    auditFindings: ({ turn, auditNumber }) => (turn === 9 && auditNumber === 1 ? [BLOCKING_FINDING] : []),
    onPrompt({ stage, turn, input }) { if (stage === "private_candidate_repair") repairs.push({ turn, text: shownIn(input) }); },
    onAuditPacket({ turn, auditNumber, packet }) { if (auditNumber === 1) packets.set(turn, packet); }
  });
  const routes = [];
  for (let number = 1; number <= 12; number += 1) {
    assert.equal((await runtime.run(number)).deliveryKind, "candidate");
    routes.push((await runtime.load()).case_state.current_episode.route);
  }
  assert.deepEqual(routes, [CALM, CALM, CALM, INQUIRY, INQUIRY, SAFETY, SAFETY, INQUIRY, INQUIRY, INQUIRY, INQUIRY, INQUIRY]);
  const record = (await runtime.load()).case_state.self_directed_risk;
  assert.deepEqual([record.first_reading.level, record.first_reading.assessed_turn_id], ["ideation", "risk-4-user"]);
  assert.equal(record.history.find((entry) => entry.reading === "imminent").assessed_turn_id, "risk-6-user");
  const evidenceIds = (turn) => packets.get(turn).targeted_older_evidence.map((entry) => entry.turn_id);
  for (const turn of [1, 2, 3, 4, 5]) assert.deepEqual(evidenceIds(turn), [], `turn ${turn}: no record yet, or every turn of it is inside the verbatim window`);
  for (const turn of [6, 7]) assert.deepEqual(evidenceIds(turn), ["risk-4-user"], `turn ${turn}: the escalation is inside the window, the first statement is not`);
  for (let turn = 8; turn <= 12; turn += 1) {
    assert.deepEqual(evidenceIds(turn), ["risk-7-user", "risk-6-user", "risk-4-user"], `turn ${turn}: the highest reading, the first turn at that level, the first statement`);
    assert.deepEqual(packets.get(turn).targeted_older_evidence.map((entry) => entry.turn.text), ["Synthetic message 7.", "Synthetic message 6.", "Synthetic message 4."], `turn ${turn}: their exact words`);
    for (const entry of packets.get(turn).targeted_older_evidence) assert.deepEqual([entry.reasons, entry.item_ids], [[RECORD_REASON], [RECORD_ITEM]], `turn ${turn}: one label`);
    assert.equal(packets.get(turn).recent_verbatim.turns.some((entry) => ["risk-4-user", "risk-6-user", "risk-7-user"].includes(entry.id)), false, `turn ${turn}: all three are outside the window`);
  }
  // The digest's own counts follow the packet: the four earlier risk turns, three of them with their exact text (turn 5 is the one without).
  const family = (turn) => { const counts = packets.get(turn).trajectory_digest.suicide_family; return [counts.turn_numbers, counts.with_exact_text_in_targeted_older_evidence, counts.without_exact_text_in_this_packet]; };
  assert.deepEqual(family(8), [[4, 5, 6, 7], 3, 1]);
  assert.deepEqual(family(12), [[4, 5, 6, 7], 3, 1]);
  assert.deepEqual(packets.get(8).trajectory_digest.self_directed_risk.highest_reading_in_history, { reading: "imminent", turn_id: "risk-7-user", turn_number: 7 });

  // The repair writer is part of the reply check, so it gets the same three turns, and never the record.
  const repair = repairs.find((entry) => entry.turn === 9)?.text ?? "";
  assert.ok(repair.includes(RECORD_REASON), "the repair on turn 9 carries the retrieval label");
  for (const text of ["Synthetic message 4.", "Synthetic message 6.", "Synthetic message 7."]) assert.ok(repair.includes(text), `the repair holds ${text}`);
  assert.equal(repair.includes("self_directed_risk\""), false, "no record in case_state");
  assert.equal(repair.includes("trajectory_digest"), false);
});
