import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";
import {
  CURRENT_CONTRIBUTION_POLICY,
  PAID_GLOBAL_CONTRIBUTION_SETTING,
  contributionAccessResult
} from "../src/learning/contribution-policy.mjs";
import { modelContributionState } from "../src/learning/consent-model.mjs";
import { validateContributionPolicy } from "../src/learning/contracts.mjs";

const load = async (relative) => JSON.parse(await fs.readFile(new URL(relative, import.meta.url), "utf8"));

test("strict contribution policy is default-on, preview-first, and release-disabled", async () => {
  const schema = await load("../learning-system/schemas/contribution-policy.schema.json");
  const fixture = await load("../learning-system/fixtures/free-default-contribution-preview.json");
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  assert.equal(validate(fixture), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...fixture, unexpected: true }), false);
  assert.deepEqual(CURRENT_CONTRIBUTION_POLICY, fixture);
  assert.equal(validateContributionPolicy(CURRENT_CONTRIBUTION_POLICY), CURRENT_CONTRIBUTION_POLICY);
  assert.equal(fixture.freeContributionMode, "default-on-per-candidate-refusal");
  assert.equal(fixture.candidatePreviewRequired, true);
  assert.equal(fixture.candidateTransmissionEnabled, false);
  assert.equal(fixture.releaseAuthorized, false);
});

test("offline state machine requires preview and has no transmitted state", () => {
  const beforePreview = modelContributionState();
  assert.equal(beforePreview.state, "preview-required");
  assert.equal(beforePreview.canTransmit, false);

  const pending = modelContributionState({ state: "preview-required", candidatePreviewed: true });
  assert.equal(pending.state, "default-contribution-pending-release");
  assert.equal(pending.canTransmit, false);

  const blocked = modelContributionState({ state: pending.state, candidatePreviewed: true });
  assert.equal(blocked.state, "blocked-live-transport-disabled");
  assert.equal(blocked.candidateTransmissionEnabled, false);
  assert.throws(() => modelContributionState({ candidateRefused: true }), /before its generalized preview/);
});

test("free per-candidate refusal costs nothing and never reduces access", async () => {
  const fixture = await load("../learning-system/fixtures/free-candidate-refusal.json");
  const modeled = modelContributionState({ state: fixture.inputState, candidatePreviewed: fixture.candidatePreviewed, candidateRefused: fixture.candidateRefused });
  assert.equal(modeled.state, fixture.expectedState);
  assert.equal(modeled.refusalCost, "free");
  assert.equal(modeled.accessReduced, false);
  assert.equal(modeled.standingFreeOptOutPersisted, false);

  const access = contributionAccessResult({ userTier: "free", candidateRefused: true });
  assert.equal(access.candidateContributionEligible, false);
  assert.equal(access.accessReduced, false);
  assert.equal(access.candidateTransmissionEnabled, false);
});

test("paid API capability exists without choosing a global setting default", () => {
  assert.equal(CURRENT_CONTRIBUTION_POLICY.paidApiRequiresPayment, true);
  assert.equal(CURRENT_CONTRIBUTION_POLICY.paidGlobalContributionDisableAvailable, true);
  assert.equal(CURRENT_CONTRIBUTION_POLICY.paidGlobalContributionSetting, PAID_GLOBAL_CONTRIBUTION_SETTING);
  const unspecified = contributionAccessResult({ userTier: "paid-api" });
  assert.equal(unspecified.paidGlobalDisable, PAID_GLOBAL_CONTRIBUTION_SETTING);
  assert.equal(contributionAccessResult({ userTier: "paid-api", paidGlobalDisable: true }).candidateContributionEligible, false);
  assert.throws(() => contributionAccessResult({ userTier: "free", paidGlobalDisable: true }), /no global/);
});

test("no existing candidate is backfilled and raw messages are not generalized candidates", async () => {
  const noBackfill = await load("../learning-system/fixtures/no-backfill.json");
  assert.equal(noBackfill.existingCandidateBackfillEnabled, false);
  assert.equal(noBackfill.candidateTransmissionEnabled, false);
  assert.equal(noBackfill.result, "remain-local");

  const candidateSchema = await load("../learning-system/schemas/lesson-candidate.schema.json");
  const validateCandidate = new Ajv2020({ allErrors: true, strict: true }).compile(candidateSchema);
  assert.equal(validateCandidate({ format: "inner-signal-generalized-lesson-candidate-v1", rawUserMessage: "That did not work." }), false);
});
