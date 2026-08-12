#!/usr/bin/env node
import fs from "node:fs/promises";
import { createHash } from "node:crypto";

const statePath = process.env.FAKE_GH_STATE;
if (!statePath) {
  console.error("FAKE_GH_STATE is required");
  process.exit(2);
}

const args = process.argv.slice(2);
let state = JSON.parse(await fs.readFile(statePath, "utf8"));
state.calls ??= [];
state.calls.push(args);

function field(name) {
  for (let index = 0; index < args.length - 1; index += 1) {
    if (args[index] !== "-f") continue;
    const [key, ...rest] = args[index + 1].split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

async function save() {
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

async function fail(message, code = 1) {
  await save();
  console.error(message);
  process.exit(code);
}

function output(value) {
  console.log(JSON.stringify(value));
}

if (args[0] !== "api") await fail("expected gh api");
const methodIndex = args.indexOf("--method");
const method = methodIndex >= 0 ? args[methodIndex + 1] : "GET";
const endpoint = args.find((value, index) => index > 0 && args[index - 1] !== "--method" && !value.startsWith("-"));
if (!endpoint) await fail("missing endpoint");

const repository = state.repository ?? "u-dont-existDOTcom/innerSignalGraph";
if (endpoint === `repos/${repository}` && method === "GET") {
  if (state.repositoryAuthFailure) await fail("HTTP 401: Bad credentials");
  if (state.repositoryFailure) await fail("repository unavailable");
  await save();
  output({ permissions: { push: state.pushPermission !== false } });
  process.exit(0);
}

const refPrefix = `repos/${repository}/git/ref/heads/`;
if (method === "GET" && endpoint.startsWith(refPrefix)) {
  const branch = decodeURIComponent(endpoint.slice(refPrefix.length));
  const sha = state.refs?.[branch];
  if (!sha) await fail("reference not found");
  await save();
  output({ ref: `refs/heads/${branch}`, object: { sha } });
  process.exit(0);
}

if (method === "POST" && endpoint === `repos/${repository}/git/refs`) {
  const ref = field("ref");
  const sha = field("sha");
  if (!ref?.startsWith("refs/heads/") || !/^[a-f0-9]{40}$/.test(sha ?? "")) await fail("invalid create ref");
  const branch = ref.slice("refs/heads/".length);
  state.refs ??= {};
  state.refs[branch] = sha;
  await save();
  output({ ref, object: { sha } });
  process.exit(0);
}

const contentsPrefix = `repos/${repository}/contents/`;
if (endpoint.startsWith(contentsPrefix)) {
  const [encodedPath, query = ""] = endpoint.slice(contentsPrefix.length).split("?");
  const remotePath = encodedPath.split("/").map(decodeURIComponent).join("/");
  const queryBranch = new URLSearchParams(query).get("ref");
  const branch = method === "PUT" ? field("branch") : queryBranch;
  const key = `${branch}:${remotePath}`;
  state.files ??= {};

  if (method === "GET") {
    const existing = state.files[key];
    if (!existing) await fail("content not found");
    await save();
    output({
      sha: existing.sha,
      content: existing.content,
      encoding: "base64"
    });
    process.exit(0);
  }

  if (method === "PUT") {
    if ((state.failPutCount ?? 0) > 0) {
      state.failPutCount -= 1;
      await fail("simulated upload failure");
    }
    const content = field("content");
    if (!content || !branch || !field("message")) await fail("missing upload field");
    const bytes = Buffer.from(content, "base64");
    const contentSha = createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])).digest("hex");
    const commitSha = createHash("sha1").update(`commit:${key}:${contentSha}`).digest("hex");
    state.files[key] = { content, sha: contentSha, commitSha };
    state.refs ??= {};
    state.refs[branch] = commitSha;
    await save();
    output({ content: { sha: contentSha }, commit: { sha: commitSha } });
    process.exit(0);
  }
}

await fail(`unsupported fake gh request: ${method} ${endpoint}`);
