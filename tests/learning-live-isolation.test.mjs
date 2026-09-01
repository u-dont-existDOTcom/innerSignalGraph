import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function filesUnder(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory() ? filesUnder(path.join(directory, entry.name)) : [path.join(directory, entry.name)]))).flat();
}

test("learning modules have filesystem and crypto capability but no external network/provider capability", async () => {
  const files = await filesUnder(path.join(root, "src/learning"));
  const joined = (await Promise.all(files.map((file) => fs.readFile(file, "utf8")))).join("\n");
  for (const forbidden of ["node:http", "node:https", "node:net", "node:tls", "undici", "octokit", "fetch(", "WebSocket", "XMLHttpRequest", "api.openai.com", "openrouter.ai", "Authorization:", "Bearer ", "stripe", "checkout.session"]) {
    assert.equal(joined.includes(forbidden), false, forbidden);
  }
});

test("only the exact main server and maintainer CLI consume live local learning modules", async () => {
  const productionFiles = (await Promise.all(["src", "apps"].map((directory) => filesUnder(path.join(root, directory))))).flat();
  const consumers = [];
  for (const file of productionFiles) {
    const source = await fs.readFile(file, "utf8");
    if (/learning\/(?:live-store|live-contracts)\.mjs/.test(source)) consumers.push(path.relative(root, file));
  }
  assert.deepEqual(consumers.sort(), ["src/cli/learning-review.mjs", "src/server/create-server.mjs"]);
});

test("exactly seven learning HTTP routes exist and every one is loopback-app local", async () => {
  const server = await fs.readFile(path.join(root, "src/server/create-server.mjs"), "utf8");
  const routeStart = server.indexOf("const LIVE_LEARNING_ENDPOINTS");
  const routeEnd = server.indexOf("\n]);", routeStart);
  const routes = [...server.slice(routeStart, routeEnd).matchAll(/"(\/v1\/learning\/[^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(routes, [
    "/v1/learning/preview",
    "/v1/learning/submit",
    "/v1/learning/revoke",
    "/v1/learning/review/status",
    "/v1/learning/review/records",
    "/v1/learning/review/records/:receipt",
    "/v1/learning/review/records/:receipt/decision"
  ]);
  assert.equal((server.match(/readJson\(req, 16 \* 1024\)/g) ?? []).length, 3);
  assert.match(server, /readJson\(req, 4096\)/);
  const app = await fs.readFile(path.join(root, "apps/web/app.js"), "utf8");
  for (const route of routes) assert.match(app, new RegExp(route.replaceAll("/", "\\/")));
  assert.doesNotMatch(app, /https?:\/\//);
});

test("provider copy says account-identity shielding and explicitly denies anonymity", async () => {
  const files = ["apps/web/index.html", "learning-system/PROVIDER-PATH-DISCLOSURE.md", "learning-system/SIGNUP-AGREEMENT-DRAFT.md", "learning-system/PRIVACY-POLICY-DRAFT.md"];
  for (const relative of files) {
    const content = await fs.readFile(path.join(root, relative), "utf8");
    assert.match(content, /account-identity shielding/);
    assert.match(content, /not anonymity/);
    assert.doesNotMatch(content, /remain(?:s)? anonymous unless|guarantee(?:s|d)? anonymity/i);
  }
});
