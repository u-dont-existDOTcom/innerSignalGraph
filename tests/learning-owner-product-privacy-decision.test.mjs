import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";

const receiptUrl = new URL("../tasks/opt-in-community-mvp-20260830/OWNER-PRODUCT-PRIVACY-DECISION-20260831-003.json", import.meta.url);
const schemaUrl = new URL("../learning-system/schemas/product-privacy-decision-receipt.schema.json", import.meta.url);

test("owner product/privacy receipt is strict and hash-bound to the exact source", async () => {
  const receipt = JSON.parse(await fs.readFile(receiptUrl, "utf8"));
  const schema = JSON.parse(await fs.readFile(schemaUrl, "utf8"));
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  assert.equal(validate(receipt), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...receipt, unexpected: true }), false);
  const digest = createHash("sha256").update(receipt.exactSource.text, "utf8").digest("hex");
  assert.equal(digest, "1146d9832a04ad7b3310d684f8ec580a6c3676604688a4990d455d3e48dc608c");
  assert.equal(digest, receipt.exactSource.sha256);
});

test("receipt records Option A only as product/privacy authority", async () => {
  const receipt = JSON.parse(await fs.readFile(receiptUrl, "utf8"));
  assert.equal(receipt.interpretation.selectedOption, "A");
  assert.equal(receipt.interpretation.freeContributionPolicy, "default-on-per-candidate-refusal");
  assert.equal(receipt.interpretation.candidateScope, "privacy-screened-generalized-candidates-only");
  assert.equal(receipt.interpretation.classification, "PRODUCT_PRIVACY_ECONOMIC_POLICY");
  assert.equal(receipt.interpretation.therapyPolicyAuthority, "none");
});

test("receipt authorizes only offline design and cannot activate therapy or release", async () => {
  const { implementationAuthority: authority } = JSON.parse(await fs.readFile(receiptUrl, "utf8"));
  assert.equal(authority.offlinePolicyDesign, true);
  for (const field of ["rawTherapyChatTransmission", "existingCandidateBackfill", "liveTransmission", "realQueue", "billing", "liveSignup", "privacyPolicyPublication", "runtimePersonalization", "therapyPolicyActivation", "release"]) assert.equal(authority[field], false, field);
});
