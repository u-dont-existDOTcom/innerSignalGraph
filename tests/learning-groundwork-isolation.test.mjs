import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { screenDerivedRecord } from "../src/learning/privacy-screen.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const learningRoot = path.join(root, "src/learning");

async function filesUnder(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => entry.isDirectory() ? filesUnder(path.join(directory, entry.name)) : [path.join(directory, entry.name)]));
  return nested.flat();
}

test("all groundwork behavior remains green when fetch throws", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("NETWORK_SENTINEL"); };
  try {
    const candidate = {
      format: "inner-signal-generalized-lesson-candidate-v1",
      candidateKind: "style-process",
      subjectKey: "presentation-style",
      generalizedSignal: "A fabricated participant prefers concise steps.",
      proposedInvariant: "Keep the preference user-scoped.",
      expectedBehavior: "Safety and current instructions remain higher.",
      failureReason: "Soft memory must not become policy.",
      syntheticRegressionExample: "Hard policy wins.",
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
    assert.equal(screenDerivedRecord(candidate).offlineStructuralPass, true);
    for (const name of ["aggregation.mjs", "consent-model.mjs", "contracts.mjs", "fingerprint.mjs", "mock-private-queue.mjs", "personalization.mjs", "privacy-screen.mjs", "promotion-gate.mjs", "reviewer.mjs"]) await import(`../src/learning/${name}?isolation=${name}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("src/learning imports only local filesystem/crypto dependencies and no network dependency", async () => {
  const sources = await Promise.all((await filesUnder(learningRoot)).map((file) => fs.readFile(file, "utf8")));
  const joined = sources.join("\n");
  for (const forbidden of ["node:http", "node:https", "node:net", "node:tls", "undici", "octokit", "github", "fetch(", "WebSocket", "XMLHttpRequest"]) assert.equal(joined.includes(forbidden), false, forbidden);
  const imports = new Set([...joined.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]).filter((specifier) => !specifier.startsWith(".")));
  assert.deepEqual([...imports].sort(), ["node:crypto", "node:fs/promises", "node:path"]);
});

test("only the exact server and maintainer CLI import live learning; offline modules remain unconsumed", async () => {
  const productionFiles = (await Promise.all(["src", "apps"].map((dir) => filesUnder(path.join(root, dir))))).flat().filter((file) => !file.startsWith(`${learningRoot}${path.sep}`));
  const consumers = [];
  for (const file of productionFiles) {
    const source = await fs.readFile(file, "utf8");
    const imports = [...source.matchAll(/from\s+["']([^"']*\/learning\/[^"']+\.mjs)["']/g)].map((match) => match[1]);
    for (const specifier of imports) consumers.push([path.relative(root, file), specifier]);
  }
  consumers.sort(([leftFile], [rightFile]) => leftFile.localeCompare(rightFile));
  assert.deepEqual(consumers, [
    ["src/cli/learning-review.mjs", "../learning/live-store.mjs"],
    ["src/server/create-server.mjs", "../learning/live-store.mjs"]
  ]);
});

test("runtime and app sources define only the authorized local learning endpoints", async () => {
  const productionFiles = (await Promise.all(["src", "apps"].map((dir) => filesUnder(path.join(root, dir))))).flat().filter((file) => !file.startsWith(`${learningRoot}${path.sep}`));
  const routeOwners = [];
  for (const file of productionFiles) {
    const source = await fs.readFile(file, "utf8");
    const routes = [...source.matchAll(/["'](\/v1\/learning\/[^"']+)["']/g)].map((match) => match[1]);
    if (routes.length) routeOwners.push([path.relative(root, file), [...new Set(routes)].sort()]);
  }
  routeOwners.sort(([leftFile], [rightFile]) => leftFile.localeCompare(rightFile));
  assert.deepEqual(routeOwners, [
    ["apps/web/app.js", ["/v1/learning/preview", "/v1/learning/review/records", "/v1/learning/review/records/:receipt", "/v1/learning/review/records/:receipt/decision", "/v1/learning/review/status", "/v1/learning/revoke", "/v1/learning/submit"]],
    ["src/autopilot/web-smoke.mjs", ["/v1/learning/preview", "/v1/learning/revoke", "/v1/learning/submit"]],
    ["src/server/create-server.mjs", ["/v1/learning/preview", "/v1/learning/review/records", "/v1/learning/review/records/:receipt", "/v1/learning/review/records/:receipt/decision", "/v1/learning/review/status", "/v1/learning/revoke", "/v1/learning/submit"]]
  ]);
});

test("static reviewer preview has no script or network resource", async () => {
  const html = await fs.readFile(path.join(root, "learning-system/reviewer-preview/index.html"), "utf8");
  assert.equal(/<script\b/i.test(html), false);
  assert.equal(/(?:src|href)=["']https?:/i.test(html), false);
  assert.match(html, /Fabricated offline data only/);
});
