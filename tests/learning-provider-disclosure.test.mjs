import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";
import {
  COMMUNITY_LEARNING_BOUNDARY_COPY,
  FREE_CANDIDATE_NOTICE,
  FREE_SIGNUP_COPY,
  IDENTIFIABILITY_WARNING,
  PAID_API_SIGNUP_COPY,
  PROVIDER_BOUNDARY_COPY,
  PROVIDER_PATH_DISCLOSURE,
  disclosureForProviderPath
} from "../src/learning/provider-disclosure.mjs";
import { validateProviderPathDisclosure } from "../src/learning/contracts.mjs";

const load = async (relative) => JSON.parse(await fs.readFile(new URL(relative, import.meta.url), "utf8"));
const read = async (relative) => fs.readFile(new URL(relative, import.meta.url), "utf8");

test("provider disclosure schema preserves user-account and paid-API boundaries", async () => {
  const schema = await load("../learning-system/schemas/provider-path-disclosure.schema.json");
  const fixture = await load("../learning-system/fixtures/paid-api-path.json");
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  assert.equal(validate(fixture), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...fixture, unexpected: true }), false);
  assert.deepEqual(PROVIDER_PATH_DISCLOSURE, fixture);
  assert.equal(validateProviderPathDisclosure(PROVIDER_PATH_DISCLOSURE), PROVIDER_PATH_DISCLOSURE);
  assert.equal(fixture.freeUserChatgpt.innerSignalControlsOpenAIAccountSettings, false);
  assert.equal(fixture.paidApi.paymentRequired, true);
});

test("paid API copy separates training default, monitoring, application state, and special controls", () => {
  assert.match(PAID_API_SIGNUP_COPY, /not used to train or improve its models by default unless the API customer opts in/);
  assert.match(PAID_API_SIGNUP_COPY, /abuse-monitoring logs may include prompts, responses, and derived metadata/);
  assert.match(PAID_API_SIGNUP_COPY, /up to 30 days, subject to documented exceptions/);
  assert.match(PAID_API_SIGNUP_COPY, /some endpoints or features may retain application state/);
  assert.match(PAID_API_SIGNUP_COPY, /will not claim Modified Abuse Monitoring or Zero Data Retention unless/);
  assert.match(PROVIDER_BOUNDARY_COPY, /cannot truthfully promise/);
  assert.equal(PROVIDER_PATH_DISCLOSURE.paidApi.zeroDataRetentionVerified, false);
  assert.equal(PROVIDER_PATH_DISCLOSURE.paidApi.modifiedAbuseMonitoringVerified, false);
});

test("exact disclosure copy is present in both unpublished drafts", async () => {
  const providerDoc = await read("../learning-system/PROVIDER-PATH-DISCLOSURE.md");
  const signupDoc = await read("../learning-system/SIGNUP-AGREEMENT-DRAFT.md");
  for (const copy of [FREE_SIGNUP_COPY, FREE_CANDIDATE_NOTICE, PAID_API_SIGNUP_COPY, IDENTIFIABILITY_WARNING]) {
    assert.equal(providerDoc.includes(copy), true);
    assert.equal(signupDoc.includes(copy), true);
  }
  const privacyDoc = await read("../learning-system/PRIVACY-POLICY-DRAFT.md");
  assert.equal(privacyDoc.includes(PROVIDER_BOUNDARY_COPY), true);
  assert.equal(privacyDoc.includes(COMMUNITY_LEARNING_BOUNDARY_COPY), true);
});

test("provider disclosures contain no forbidden privacy promise", async () => {
  const corpus = [
    PAID_API_SIGNUP_COPY,
    PROVIDER_BOUNDARY_COPY,
    await read("../learning-system/PRIVACY-POLICY-DRAFT.md"),
    await read("../learning-system/SIGNUP-AGREEMENT-DRAFT.md")
  ].join("\n");
  for (const forbidden of ["InnerSignal promises that API traffic is never monitored", "InnerSignal promises that API traffic is never retained", "API mode makes your content anonymous", "ordinary API provides Zero Data Retention", "ordinary API opts out of monitoring"]) assert.equal(corpus.includes(forbidden), false, forbidden);
  assert.match(corpus, /unpublished|Not published/);
});

test("both provider paths carry the same identifiability warning", () => {
  assert.equal(disclosureForProviderPath("user-owned-chatgpt-account").identifiabilityWarning, IDENTIFIABILITY_WARNING);
  assert.equal(disclosureForProviderPath("innersignal-controlled-openai-api-account").identifiabilityWarning, IDENTIFIABILITY_WARNING);
  assert.throws(() => disclosureForProviderPath("unknown"), /Unknown provider path/);
});
