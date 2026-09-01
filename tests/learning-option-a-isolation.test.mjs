import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CURRENT_CONTRIBUTION_POLICY } from "../src/learning/contribution-policy.mjs";
import { PROVIDER_PATH_DISCLOSURE } from "../src/learning/provider-disclosure.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const learningRoot = path.join(root, "src/learning");

async function filesUnder(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory() ? filesUnder(path.join(directory, entry.name)) : [path.join(directory, entry.name)]))).flat();
}

test("Option A policy remains pure when network access throws", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("NETWORK_SENTINEL"); };
  try {
    for (const name of ["contribution-policy.mjs", "provider-disclosure.mjs", "identifiability-warning.mjs", "consent-model.mjs", "contracts.mjs"]) await import(`../src/learning/${name}?option-a-isolation=${name}`);
    assert.equal(CURRENT_CONTRIBUTION_POLICY.candidateTransmissionEnabled, false);
    assert.equal(PROVIDER_PATH_DISCLOSURE.liveSignupEnabled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("learning sources contain no network, provider client, queue, or billing capability", async () => {
  const sources = await Promise.all((await filesUnder(learningRoot)).map((file) => fs.readFile(file, "utf8")));
  const joined = sources.join("\n");
  for (const forbidden of ["node:http", "node:https", "node:net", "node:tls", "undici", "octokit", "fetch(", "WebSocket", "XMLHttpRequest", "Authorization:", "Bearer ", "api.openai.com", "stripe", "checkout.session"]) assert.equal(joined.includes(forbidden), false, forbidden);
});

test("no production runtime consumes the new policy helpers", async () => {
  const productionFiles = (await Promise.all(["src", "apps"].map((directory) => filesUnder(path.join(root, directory))))).flat().filter((file) => !file.startsWith(`${learningRoot}${path.sep}`));
  const offenders = [];
  for (const file of productionFiles) {
    const source = await fs.readFile(file, "utf8");
    if (/src\/learning|\/learning\/(?:contribution-policy|provider-disclosure|identifiability-warning)\.mjs/.test(source)) offenders.push(path.relative(root, file));
  }
  assert.deepEqual(offenders, []);
});

test("payment and contribution never change epistemic or therapy authority", () => {
  assert.equal(CURRENT_CONTRIBUTION_POLICY.therapyPolicyAuthority, "none");
  assert.equal(CURRENT_CONTRIBUTION_POLICY.runtimePersonalizationEnabled, false);
  assert.equal(CURRENT_CONTRIBUTION_POLICY.therapyPolicyActivated, false);
  assert.equal(PROVIDER_PATH_DISCLOSURE.releaseAuthorized, false);
});

test("privacy and signup artifacts remain draft and unpublished", async () => {
  const privacy = await fs.readFile(path.join(root, "learning-system/PRIVACY-POLICY-DRAFT.md"), "utf8");
  const signup = await fs.readFile(path.join(root, "learning-system/SIGNUP-AGREEMENT-DRAFT.md"), "utf8");
  assert.match(privacy, /Not published|unpublished/);
  assert.match(signup, /unpublished/);
  assert.match(privacy, /privacyPolicyPublished[\s\S]*remain false/);
  assert.match(signup, /No signup flow uses this text/);
});
