import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
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
  const input = await buildPrivateCandidateAuditInput({ caseAccessService: { loadCaseContext: async () => context }, caseId: "synthetic-case" });
  assert.deepEqual(input.trajectory_digest, buildTrajectoryDigest(context));
  assert.equal(input.trajectory_digest.computed_in_code, true);
  assert.equal(input.trajectory_digest.model_calls, 0);
  assert.equal(input.trajectory_digest.whole_case.user_turn_count, 3);
  assert.ok(input.instructions.some((line) => /trajectory_digest/u.test(line)));
});

// ---- The owner-pending fallback wording ------------------------------------------------------------------------------------

test("the fallback is one named constant with the exact draft wording and an owner-pending comment", async () => {
  assert.equal(OWNER_FALLBACK_MESSAGE, EXPECTED_FALLBACK);
  assert.equal((OWNER_FALLBACK_MESSAGE.match(/’/gu) ?? []).length, 5, "five curly apostrophes");
  assert.equal(OWNER_FALLBACK_MESSAGE.includes("'"), false, "no straight apostrophes");
  assert.equal(OWNER_FALLBACK_MESSAGE.includes("?"), false, "it is not a question, so it cannot pass as a discriminating question");
  assert.equal(isDeliverableDiscriminatorQuestion(OWNER_FALLBACK_MESSAGE), false);
  const source = await fs.readFile(new URL("../src/supervisor/owner-fallback-message.mjs", import.meta.url), "utf8");
  assert.match(source, /OWNER-PENDING[^\n]*has not yet approved it/u);
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

function discriminatorRuntime({ activeStep, route = activeStep, nextQuestion, findings = [], extra = {} }) {
  const source = {
    async loadPrivateRuntimeCase() {
      return {
        case_state: { current_episode: activeStep === undefined && route === undefined ? undefined : { active_step: activeStep, route, next_question: nextQuestion }, ...extra },
        candidate_responses: [{ id: "candidate-1", audit_history: [{ findings }] }]
      };
    }
  };
  const runtime = createPrivateTherapyModelRuntime({ privateCaseSource: source, providers: {}, config: {} });
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

test("produceDiscriminator on every other route is unchanged, with or without a question", async () => {
  for (const activeStep of [CALM, PRECIOUS, "IC.SOMETHING_ELSE", null]) {
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

test("an unresolved role or belief finding is checked before the fallback, and cannot be bypassed by it", async () => {
  for (const activeStep of [INQUIRY, SAFETY]) {
    await assert.rejects(discriminatorRuntime({ activeStep, nextQuestion: "", findings: [{ ...ROLE_BELIEF_FINDING, unresolved: true }] }), unavailable("PRIVATE_DISCRIMINATOR_ROLE_BELIEF_BLOCKED"), activeStep);
  }
  // Findings that do not block today still do not block: a resolved finding, a low one, or another code.
  for (const findings of [[{ ...ROLE_BELIEF_FINDING, unresolved: false }], [{ ...ROLE_BELIEF_FINDING, severity: "medium" }], [BLOCKING_FINDING]]) {
    assert.equal((await discriminatorRuntime({ activeStep: INQUIRY, nextQuestion: QUESTION, findings })()).kind, OWNER_FALLBACK_KIND);
  }
});

// ---- Through the whole audit loop ------------------------------------------------------------------------------------------

test("safety-orientation turn whose candidate cannot be approved and has no question: the fallback is delivered, as its own kind", async (t) => {
  const runtime = await openScriptedRiskRuntime(t, { readings: ["imminent"], auditFindings: () => [BLOCKING_FINDING] });
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
  const runtime = await openScriptedRiskRuntime(t, { readings: ["ideation"], auditFindings: () => [BLOCKING_FINDING] });
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
  const runtime = await openScriptedRiskRuntime(t, { readings: ["imminent", "intent", "ideation", "imminent"] });
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
    auditFindings: ({ turn }) => (turn === 2 ? [BLOCKING_FINDING] : [])
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

test("an unresolved role or belief finding on the inquiry route still ends the turn unavailable, with nothing delivered", async (t) => {
  const runtime = await openScriptedRiskRuntime(t, { readings: ["ideation"], auditFindings: () => [ROLE_BELIEF_FINDING] });
  await assert.rejects(() => runtime.run(1), unavailable("THERAPY_RUNTIME_UNAVAILABLE"));
  const record = await runtime.load();
  assert.equal(record.runtime_turns[0].state, "DISCRIMINATING_QUESTION_REQUIRED");
  assert.equal(record.runtime_turns[0].discriminator, null);
  assert.deepEqual(record.raw_transcript.map((entry) => entry.role), ["user"]);
});

test("an operational failure of the audit on the inquiry route is not turned into the fallback", async (t) => {
  const runtime = await openScriptedRiskRuntime(t, { readings: ["ideation"], auditFails: () => true });
  await assert.rejects(() => runtime.run(1), unavailable("THERAPY_RUNTIME_UNAVAILABLE"));
  const record = await runtime.load();
  assert.notEqual(record.runtime_turns[0].state, "DELIVERED");
  assert.equal(record.runtime_turns[0].discriminator, null);
  assert.deepEqual(record.raw_transcript.map((entry) => entry.role), ["user"]);
});

test("the precious-opportunity inquiry route and the calm route are untouched by the fallback", async (t) => {
  assert.ok(SUICIDE_FAMILY_ROUTE_IDS.includes(PRECIOUS) && SAFETY_ORIENTATION_ROUTE_ID === SAFETY);
  const runtime = await openScriptedRiskRuntime(t, { readings: ["absent"], auditFindings: () => [BLOCKING_FINDING] });
  const result = await runtime.run(1);
  assert.equal(result.deliveryKind, "discriminator");
  assert.notEqual(result.answer, OWNER_FALLBACK_MESSAGE);
});

test("a delivery whose kind disagrees with its discriminator kind, or whose kind is unknown, is rejected on read", async (t) => {
  const runtime = await openScriptedRiskRuntime(t, { readings: ["imminent"], auditFindings: () => [BLOCKING_FINDING] });
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
    [2, [6, 7], 1, 1],
    "two earlier risk turns outside the window; the record's turn has its exact text, the repeat does not"
  );
  const risk = digest.self_directed_risk;
  assert.deepEqual([risk.level, risk.assessed_turn_number, risk.latest_reading_turn_number, risk.latest_reading_unknown, risk.fresh_readings_below_held_level],
    ["ideation", 6, 9, true, []]);
  assert.deepEqual(risk.history.map((entry) => [entry.change, entry.turn_number]), [["raised", 6], ["held", 7]]);

  assert.deepEqual(packet.targeted_older_evidence.map((entry) => [entry.turn_id, entry.turn.text]), [["risk-6-user", "Synthetic message 6."]]);
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

test("producers and the repair writer never see the record in a real run", async (t) => {
  const seen = [];
  const stages = new Set();
  const runtime = await openScriptedRiskRuntime(t, {
    readings: ["ideation", "absent"],
    auditFindings: ({ turn, auditNumber }) => (turn === 2 && auditNumber === 1 ? [BLOCKING_FINDING] : []),
    onPrompt({ stage, input }) {
      if (stage === "private_candidate_audit") return;
      stages.add(stage);
      seen.push(`${input.system}\n${input.user}`);
    }
  });
  await runtime.run(1);
  await runtime.run(2);
  for (const stage of ["case_extraction", "realization", "private_candidate_repair"]) assert.ok(stages.has(stage), `${stage} prompts were captured`);
  assert.equal((await runtime.load()).case_state.self_directed_risk.current.level, "ideation");
  let retrievalLabels = 0;
  for (const text of seen) {
    // The one mention they may carry is the label on the retrieval request that points at the older turn (beside the threat-pathway
    // label). The record itself, its level, its history and the digest are not in them.
    const withoutLabel = text.split("self_directed_risk.current").join("");
    retrievalLabels += text.length - withoutLabel.length > 0 ? 1 : 0;
    assert.equal(withoutLabel.includes("self_directed_risk"), false);
    assert.equal(text.includes("trajectory_digest"), false);
    assert.equal(text.includes("lowering_readings"), false);
  }
  assert.ok(retrievalLabels > 0, "the older turn was retrieved for the writing prompts, as the brief asks");
});
