import test from "node:test";
import assert from "node:assert/strict";
import { CANDIDATE_FORMAT } from "../src/learning/contracts.mjs";
import { PRIVACY_RISK_CODES, screenDerivedRecord } from "../src/learning/privacy-screen.mjs";

function candidate(generalizedSignal = "A fabricated participant reports a bounded process preference.") {
  return {
    format: CANDIDATE_FORMAT,
    candidateKind: "style-process",
    subjectKey: "presentation-style",
    generalizedSignal,
    proposedInvariant: "Represent the preference only within the user scope.",
    expectedBehavior: "Keep safety and current instructions above the soft preference.",
    failureReason: "A soft preference must not become policy.",
    syntheticRegressionExample: "Safety remains above presentation memory.",
    evidenceClass: "self-authenticating-preference",
    validationBasis: ["fabricated explicit preference"],
    policySurface: "presentation",
    outcomeDirection: "not-applicable",
    causalBoundary: "not-applicable",
    contextTags: ["synthetic"],
    versionIdentifiers: ["offline-groundwork-v1"],
    runtimeAuthority: "none",
    therapyPolicyAuthority: "none",
    transmissionAuthority: "none"
  };
}

test("privacy screen rejects raw conversation objects before scanning", () => {
  assert.throws(() => screenDerivedRecord({ messages: [{ role: "user", content: "private" }] }), /never raw conversation objects/);
});

test("every required deterministic privacy risk code is detected", async (t) => {
  const cases = {
    SECRET_LIKE: "api_key=sk-syntheticabcdefghijklmnop",
    EMAIL: "Contact synthetic.person@example.test",
    PHONE: "Call +1 (202) 555-0199",
    UUID_OR_ACCOUNT_IDENTIFIER: "Account 123e4567-e89b-42d3-a456-426614174000",
    ABSOLUTE_LOCAL_PATH: "Stored at /home/synthetic/private-note.txt",
    IDENTIFYING_URL_QUERY: "See https://example.test/path?account=synthetic-person",
    RAW_CONVERSATION_FORMAT: "user: synthetic private statement\nassistant: response",
    LONG_QUOTED_SPAN: `“${"synthetic private wording ".repeat(5)}”`,
    ADDRESS_LIKE_TEXT: "Meet at 123 Synthetic Avenue"
  };
  assert.deepEqual(Object.keys(cases), [...PRIVACY_RISK_CODES]);
  for (const [code, value] of Object.entries(cases)) {
    await t.test(code, () => {
      const result = screenDerivedRecord(candidate(value));
      assert.equal(result.offlineStructuralPass, false);
      assert.ok(result.riskCodes.includes(code));
      assert.equal(result.liveTransmissionApproved, false);
    });
  }
});

test("post-screen catches prohibited data introduced between passes", () => {
  const result = screenDerivedRecord(candidate(), {
    syntheticTransform(value) {
      value.generalizedSignal = "Synthetic redaction mistake: leaked.person@example.test";
      return value;
    }
  });
  assert.equal(result.offlineStructuralPass, false);
  assert.ok(result.riskCodes.includes("EMAIL"));
  assert.equal(result.liveTransmissionApproved, false);
});

test("a clean structural pass still never approves live transmission", () => {
  assert.deepEqual(screenDerivedRecord(candidate()), { offlineStructuralPass: true, riskCodes: [], liveTransmissionApproved: false });
});
