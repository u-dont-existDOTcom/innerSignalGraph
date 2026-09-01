#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { CURRENT_CONTRIBUTION_POLICY } from "../src/learning/contribution-policy.mjs";
import { PROVIDER_PATH_DISCLOSURE, FREE_SIGNUP_COPY, FREE_CANDIDATE_NOTICE, PAID_API_SIGNUP_COPY, IDENTIFIABILITY_WARNING, PROVIDER_BOUNDARY_COPY, COMMUNITY_LEARNING_BOUNDARY_COPY, ACCOUNT_IDENTITY_SHIELDING_COPY, ACCOUNT_IDENTITY_SHIELDING_QUALIFICATION } from "../src/learning/provider-disclosure.mjs";
import { scanIdentifiability } from "../src/learning/identifiability-warning.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const required = [
  ...["DEFAULT-CONTRIBUTION-POLICY", "PROVIDER-PATH-DISCLOSURE", "PRIVACY-POLICY-DRAFT", "SIGNUP-AGREEMENT-DRAFT", "RETENTION-REVOCATION-BOUNDARY", "OPENAI-API-DATA-FACTS-20260831"].map((name) => `learning-system/${name}.md`),
  ...["product-privacy-decision-receipt", "contribution-policy", "provider-path-disclosure"].map((name) => `learning-system/schemas/${name}.schema.json`),
  ...["free-default-contribution-preview", "free-candidate-refusal", "paid-api-path", "identifiability-warning", "no-backfill"].map((name) => `learning-system/fixtures/${name}.json`),
  ...["contribution-policy", "provider-disclosure", "identifiability-warning"].map((name) => `src/learning/${name}.mjs`),
  ...["learning-default-contribution-policy", "learning-provider-disclosure", "learning-owner-product-privacy-decision", "learning-identifiability-warning", "learning-option-a-isolation"].map((name) => `tests/${name}.test.mjs`),
  "tasks/opt-in-community-mvp-20260830/OWNER-PRODUCT-PRIVACY-DECISION-20260831-003.json",
  "tasks/opt-in-community-mvp-20260830/DEFAULT-CONTRIBUTION-API-PRIVACY-EVIDENCE.md"
];
for (const relative of required) await fs.access(path.join(root, relative));

const ajv = new Ajv2020({ allErrors: true, strict: true });
const schemas = {};
for (const name of ["product-privacy-decision-receipt", "contribution-policy", "provider-path-disclosure"]) {
  schemas[name] = ajv.compile(JSON.parse(await fs.readFile(path.join(root, `learning-system/schemas/${name}.schema.json`), "utf8")));
}
function strictValidate(name, value, label) {
  const validate = schemas[name];
  if (!validate(value)) throw new Error(`${label} failed ${name} schema: ${ajv.errorsText(validate.errors, { separator: "; " })}`);
  if (validate({ ...value, unexpectedPolicyField: true })) throw new Error(`${name} accepts an unknown field.`);
}

strictValidate("contribution-policy", CURRENT_CONTRIBUTION_POLICY, "current contribution policy");
const fixturePolicy = JSON.parse(await fs.readFile(path.join(root, "learning-system/fixtures/free-default-contribution-preview.json"), "utf8"));
strictValidate("contribution-policy", fixturePolicy, "free default contribution fixture");
if (JSON.stringify(fixturePolicy) !== JSON.stringify(CURRENT_CONTRIBUTION_POLICY)) throw new Error("Contribution policy fixture differs from the current source model.");

strictValidate("provider-path-disclosure", PROVIDER_PATH_DISCLOSURE, "current provider disclosure");
const providerFixture = JSON.parse(await fs.readFile(path.join(root, "learning-system/fixtures/paid-api-path.json"), "utf8"));
strictValidate("provider-path-disclosure", providerFixture, "paid API path fixture");
if (JSON.stringify(providerFixture) !== JSON.stringify(PROVIDER_PATH_DISCLOSURE)) throw new Error("Provider disclosure fixture differs from the current source model.");

const receiptPath = path.join(root, "tasks/opt-in-community-mvp-20260830/OWNER-PRODUCT-PRIVACY-DECISION-20260831-003.json");
const receipt = JSON.parse(await fs.readFile(receiptPath, "utf8"));
strictValidate("product-privacy-decision-receipt", receipt, "owner product/privacy receipt");
const ownerSourceSha256 = createHash("sha256").update(receipt.exactSource.text, "utf8").digest("hex");
if (ownerSourceSha256 !== "1146d9832a04ad7b3310d684f8ec580a6c3676604688a4990d455d3e48dc608c" || receipt.exactSource.sha256 !== ownerSourceSha256) throw new Error("Owner source hash does not match the exact receipt text.");
if (receipt.interpretation.selectedOption !== "A" || receipt.interpretation.therapyPolicyAuthority !== "none" || receipt.interpretation.classification !== "PRODUCT_PRIVACY_ECONOMIC_POLICY") throw new Error("Owner receipt misclassifies Option A authority.");

const providerDoc = await fs.readFile(path.join(root, "learning-system/PROVIDER-PATH-DISCLOSURE.md"), "utf8");
const signupDraft = await fs.readFile(path.join(root, "learning-system/SIGNUP-AGREEMENT-DRAFT.md"), "utf8");
const privacyDraft = await fs.readFile(path.join(root, "learning-system/PRIVACY-POLICY-DRAFT.md"), "utf8");
for (const copy of [FREE_SIGNUP_COPY, FREE_CANDIDATE_NOTICE, PAID_API_SIGNUP_COPY, IDENTIFIABILITY_WARNING, ACCOUNT_IDENTITY_SHIELDING_COPY, ACCOUNT_IDENTITY_SHIELDING_QUALIFICATION]) {
  if (!providerDoc.includes(copy) || !signupDraft.includes(copy)) throw new Error("An exact provider/signup copy contract is missing.");
}
if (!privacyDraft.includes(PROVIDER_BOUNDARY_COPY) || !privacyDraft.includes(COMMUNITY_LEARNING_BOUNDARY_COPY) || !privacyDraft.includes(IDENTIFIABILITY_WARNING)) throw new Error("Privacy draft is missing an exact boundary or warning.");
for (const forbidden of ["InnerSignal promises that API traffic is never monitored", "InnerSignal promises that API traffic is never retained", "API mode makes your content anonymous", "ordinary API provides Zero Data Retention", "ordinary API opts out of monitoring"]) {
  if (`${providerDoc}\n${signupDraft}\n${privacyDraft}`.includes(forbidden)) throw new Error(`Forbidden API privacy claim present: ${forbidden}`);
}

const identifierFixture = JSON.parse(await fs.readFile(path.join(root, "learning-system/fixtures/identifiability-warning.json"), "utf8"));
const categories = new Set(identifierFixture.syntheticInputs.flatMap((value) => scanIdentifiability(value).categories));
for (const expected of identifierFixture.expectedCategories) if (!categories.has(expected)) throw new Error(`Identifiability category was not detected: ${expected}`);
const cleanScan = scanIdentifiability(identifierFixture.cleanInput);
if (cleanScan.anonymous !== false || cleanScan.nonIdentifying !== false || cleanScan.warningRequired !== true) throw new Error("Clean identifiability scan overclaims anonymity.");

if (CURRENT_CONTRIBUTION_POLICY.candidateTransmissionEnabled || CURRENT_CONTRIBUTION_POLICY.existingCandidateBackfillEnabled || CURRENT_CONTRIBUTION_POLICY.runtimePersonalizationEnabled || CURRENT_CONTRIBUTION_POLICY.therapyPolicyActivated || CURRENT_CONTRIBUTION_POLICY.releaseAuthorized) throw new Error("Policy enables forbidden external transmission, backfill, therapy, or release capability.");
if (PROVIDER_PATH_DISCLOSURE.liveSignupEnabled || PROVIDER_PATH_DISCLOSURE.privacyPolicyPublished || PROVIDER_PATH_DISCLOSURE.releaseAuthorized) throw new Error("Provider disclosure enables signup, publication, or release.");
if (PROVIDER_PATH_DISCLOSURE.paidApi.globalCommunityContributionSetting !== "UNSPECIFIED_PENDING_FUTURE_BILLING_UI_DECISION") throw new Error("Paid global contribution setting default was improperly selected.");

async function filesUnder(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory() ? filesUnder(path.join(directory, entry.name)) : [path.join(directory, entry.name)]))).flat();
}
const learningFiles = await filesUnder(path.join(root, "src/learning"));
const learningSource = (await Promise.all(learningFiles.map((file) => fs.readFile(file, "utf8")))).join("\n");
for (const forbidden of ["node:http", "node:https", "node:net", "node:tls", "undici", "octokit", "fetch(", "WebSocket", "XMLHttpRequest", "api.openai.com", "checkout.session"]) if (learningSource.includes(forbidden)) throw new Error(`Learning source contains forbidden capability token: ${forbidden}`);

const production = (await Promise.all(["src", "apps"].map((directory) => filesUnder(path.join(root, directory))))).flat().filter((file) => !file.startsWith(`${path.join(root, "src/learning")}${path.sep}`));
const learningConsumers = [];
for (const file of production) {
  const content = await fs.readFile(file, "utf8");
  for (const match of content.matchAll(/from\s+["']([^"']*\/learning\/[^"']+\.mjs)["']/g)) learningConsumers.push([path.relative(root, file), match[1]]);
}
learningConsumers.sort(([leftFile], [rightFile]) => leftFile.localeCompare(rightFile));
const expectedConsumers = [
  ["src/cli/learning-review.mjs", "../learning/live-store.mjs"],
  ["src/server/create-server.mjs", "../learning/live-store.mjs"]
];
if (JSON.stringify(learningConsumers) !== JSON.stringify(expectedConsumers)) throw new Error(`Unexpected runtime learning consumers: ${JSON.stringify(learningConsumers)}`);

const retentionDoc = await fs.readFile(path.join(root, "learning-system/RETENTION-REVOCATION-BOUNDARY.md"), "utf8");
for (const requiredText of ["at no charge", "without payment", "Existing local candidates are never backfilled", "No current artifact chooses a remotely hosted InnerSignal retention duration"]) if (!retentionDoc.includes(requiredText)) throw new Error(`Retention/revocation boundary is missing: ${requiredText}`);

process.stdout.write(`PASS ${required.length} required policy artifacts, 3 strict schemas, exact owner source ${ownerSourceSha256}, truthful account-identity-shielding copy, identifiability warnings, zero external network writes, zero provider API calls, zero live signup/billing/publication, exactly two authorized local-learning consumers, and therapyPolicyAuthority=none.\n`);
