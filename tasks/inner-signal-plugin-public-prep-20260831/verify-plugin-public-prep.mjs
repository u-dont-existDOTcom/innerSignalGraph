import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const pluginRoot = path.join(root, "plugins", "inner-signal-therapy");
const submissionRoot = path.join(pluginRoot, "public-submission");
const manifestPath = path.join(pluginRoot, ".codex-plugin", "plugin.json");

const requiredSubmissionFiles = [
  "README.md",
  "OFFICIAL-REQUIREMENTS.md",
  "LISTING.json",
  "STARTER-PROMPTS.json",
  "TEST-CASES.json",
  "RELEASE-NOTES.md",
  "PRIVACY-POLICY-DRAFT.md",
  "TERMS-DRAFT.md",
  "SUPPORT-READINESS.md",
  "PUBLISHER-READINESS.md",
  "SUBMISSION-READINESS.json",
  "PACKAGE-HASHES.json"
];
const positiveFields = ["id", "kind", "userPrompt", "expectedSkillOrWorkflowBehavior", "expectedResultShape", "fixtureData"];
const negativeFields = ["id", "kind", "userPromptOrScenario", "expectedSafeFallback", "whyPluginShouldNotCompleteRequestedAction"];
const listingFields = ["pluginName", "shortDescription", "longDescription", "category", "developerIdentity", "websiteURL", "supportURL", "privacyPolicyURL", "termsURL", "logo", "availability", "status"];
const readinessChecks = [
  "manifestValid",
  "skillsTreeFrozen",
  "skillsOnly",
  "starterPromptsReady",
  "fivePositiveTestsReady",
  "threeNegativeTestsReady",
  "privacyDraftReady",
  "termsDraftReady",
  "releaseNotesReady",
  "packageHashesReady",
  "publisherIdentityVerified",
  "websitePublic",
  "supportURLPublic",
  "privacyURLPublic",
  "termsURLPublic",
  "logoReady",
  "availabilityChosen"
];
const externalReadinessChecks = [
  "publisherIdentityVerified",
  "websitePublic",
  "supportURLPublic",
  "privacyURLPublic",
  "termsURLPublic",
  "logoReady",
  "availabilityChosen"
];

function fail(message) {
  throw new Error(message);
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function readJson(filePath) {
  let parsed;
  try {
    parsed = JSON.parse(readText(filePath));
  } catch (error) {
    fail(`${path.relative(root, filePath)} is not valid JSON: ${error.message}`);
  }
  return parsed;
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function walkFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(entryPath));
    else if (entry.isFile()) files.push(entryPath);
    else fail(`unsupported non-regular package entry: ${path.relative(root, entryPath)}`);
  }
  return files.sort();
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
}

function requireFields(value, fields, label) {
  requireObject(value, label);
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) fail(`${label} is missing ${field}`);
  }
}

function requireRelativePath(value, label) {
  if (typeof value !== "string" || !value.startsWith("./")) fail(`${label} must start with ./`);
  const resolved = path.resolve(pluginRoot, value);
  const prefix = `${pluginRoot}${path.sep}`;
  if (resolved !== pluginRoot && !resolved.startsWith(prefix)) fail(`${label} escapes the plugin root`);
  if (!fs.existsSync(resolved)) fail(`${label} does not resolve to an existing package path`);
}

function verifyManifest() {
  const manifest = requireObject(readJson(manifestPath), "plugin.json");
  if (manifest.name !== "inner-signal-therapy") fail("plugin identity changed");
  if (manifest.version !== "0.1.0") fail("plugin version changed outside the preparation contract");
  requireRelativePath(manifest.skills, "plugin.json skills");
  for (const forbidden of ["mcpServers", "apps", "hooks"]) {
    if (Object.hasOwn(manifest, forbidden)) fail(`skills-only manifest contains ${forbidden}`);
  }
  if (!Array.isArray(manifest.interface?.defaultPrompt) || manifest.interface.defaultPrompt.length < 1 || manifest.interface.defaultPrompt.length > 3) {
    fail("manifest defaultPrompt must contain one to three prompts");
  }
  if (manifest.interface.defaultPrompt.some((value) => typeof value !== "string" || !value.trim() || value.length > 128)) {
    fail("manifest defaultPrompt entries must be non-empty and at most 128 characters");
  }
  const codexFiles = walkFiles(path.join(pluginRoot, ".codex-plugin")).map((filePath) => path.basename(filePath));
  if (codexFiles.length !== 1 || codexFiles[0] !== "plugin.json") fail("only plugin.json may exist in .codex-plugin");
  const skillFiles = walkFiles(path.join(pluginRoot, "skills"));
  if (!skillFiles.some((filePath) => path.basename(filePath) === "SKILL.md")) fail("no SKILL.md exists under the declared skills path");
  for (const forbiddenName of [".mcp.json", ".app.json"]) {
    if (walkFiles(pluginRoot).some((filePath) => path.basename(filePath) === forbiddenName)) fail(`${forbiddenName} is forbidden in this skills-only package`);
  }
  if (fs.existsSync(path.join(pluginRoot, "hooks"))) fail("hooks are forbidden in this preparation cycle");
  return { manifest, skillFiles };
}

function verifySubmissionArtifacts() {
  const actual = walkFiles(submissionRoot).map((filePath) => path.basename(filePath)).sort();
  const expected = [...requiredSubmissionFiles].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail("public-submission contains a missing or unexpected file");

  const allText = walkFiles(submissionRoot).map(readText).join("\n");
  if (allText.toLowerCase().includes("example.com")) fail("public-submission contains placeholder example URL");
  for (const [label, expression] of [
    ["absolute home path", /\/(?:home|mnt)\//],
    ["Codex private path", /~\/\.codex|\.codex\/plugins\/cache/i],
    ["review handoff content", /\.review-handoff|PRIVATE_[A-Z0-9_]+/]
  ]) {
    if (expression.test(allText)) fail(`public-submission contains ${label}`);
  }

  const listing = readJson(path.join(submissionRoot, "LISTING.json"));
  requireFields(listing, listingFields, "LISTING.json");
  if (listing.status !== "externally-blocked") fail("listing must remain externally blocked");
  for (const field of ["websiteURL", "supportURL", "privacyPolicyURL", "termsURL"]) {
    if (listing[field] !== null) fail(`${field} must remain null without public evidence`);
  }
  if (listing.developerIdentity?.platformVerified !== false) fail("publisher identity must remain unverified");
  if (listing.logo?.ready !== false || listing.availability?.chosen !== false) fail("logo and availability must remain unresolved");

  const prompts = readJson(path.join(submissionRoot, "STARTER-PROMPTS.json"));
  if (!Array.isArray(prompts.prompts) || prompts.prompts.length < 3 || prompts.prompts.length > 6) fail("starter prompt count must be between three and six");
  for (const prompt of prompts.prompts) {
    requireFields(prompt, ["id", "prompt"], "starter prompt");
    if (typeof prompt.prompt !== "string" || !prompt.prompt.trim()) fail("starter prompt text is empty");
  }

  const tests = readJson(path.join(submissionRoot, "TEST-CASES.json"));
  if (!Array.isArray(tests.positive) || tests.positive.length !== 5) fail("exactly five positive test cases are required");
  if (!Array.isArray(tests.negative) || tests.negative.length !== 3) fail("exactly three negative test cases are required");
  for (const item of tests.positive) {
    requireFields(item, positiveFields, `positive test ${item?.id ?? "unknown"}`);
    if (item.kind !== "positive") fail("positive test kind is invalid");
  }
  for (const item of tests.negative) {
    requireFields(item, negativeFields, `negative test ${item?.id ?? "unknown"}`);
    if (item.kind !== "negative") fail("negative test kind is invalid");
  }

  const readiness = readJson(path.join(submissionRoot, "SUBMISSION-READINESS.json"));
  if (readiness.internalPackageState !== "package-ready") fail("internal package state must be package-ready");
  if (readiness.submissionState !== "externally-blocked") fail("submission state must remain externally-blocked");
  if (readiness.releaseAuthority !== "none" || readiness.portalDraftCreated !== false || readiness.submittedForReview !== false || readiness.published !== false) {
    fail("submission readiness crosses the public release boundary");
  }
  requireFields(readiness.checks, readinessChecks, "submission readiness checks");
  for (const key of externalReadinessChecks) {
    if (readiness.checks[key]?.ready !== false || typeof readiness.checks[key]?.reason !== "string") fail(`${key} must fail closed with a reason`);
  }
  for (const key of readinessChecks.filter((value) => !externalReadinessChecks.includes(value))) {
    if (readiness.checks[key]?.ready !== true) fail(`${key} must be internally ready`);
  }

  const privacy = readText(path.join(submissionRoot, "PRIVACY-POLICY-DRAFT.md"));
  const normalizedPrivacy = privacy.replace(/\s+/g, " ").toLowerCase();
  for (const fact of ["not published", "skills-only plugin", "no MCP server", "does not persist potential lessons", "host platform", "separate local-runtime capability"]) {
    if (!normalizedPrivacy.includes(fact.toLowerCase())) fail(`privacy draft omits required fact: ${fact}`);
  }
  const terms = readText(path.join(submissionRoot, "TERMS-DRAFT.md"));
  const normalizedTerms = terms.replace(/\s+/g, " ").toLowerCase();
  for (const fact of ["owner and legal review required", "not legal approval", "skills-only advisory package", "not claimed to be sufficient"]) {
    if (!normalizedTerms.includes(fact.toLowerCase())) fail(`terms draft omits required fact: ${fact}`);
  }
  return { prompts: prompts.prompts.length, positive: tests.positive.length, negative: tests.negative.length };
}

function verifyHashes(skillFiles) {
  const hashes = readJson(path.join(submissionRoot, "PACKAGE-HASHES.json"));
  if (hashes.algorithm !== "sha256") fail("package hash algorithm must be sha256");
  if (hashes.skillsTreePrePostIdentical !== true) fail("skills tree is not recorded as byte-identical");
  if (hashes.manifest?.path !== "plugins/inner-signal-therapy/.codex-plugin/plugin.json" || hashes.manifest.sha256 !== sha256(manifestPath)) {
    fail("manifest hash is stale");
  }
  const expectedSkills = skillFiles.map((filePath) => path.relative(root, filePath).split(path.sep).join("/"));
  const recordedSkills = Array.isArray(hashes.skills) ? hashes.skills : [];
  if (JSON.stringify(recordedSkills.map((item) => item.path).sort()) !== JSON.stringify(expectedSkills.sort())) fail("skill hash inventory is incomplete");
  for (const item of recordedSkills) {
    const filePath = path.join(root, item.path);
    const actual = sha256(filePath);
    if (item.preSha256 !== actual || item.postSha256 !== actual || item.identical !== true) fail(`skill hash changed: ${item.path}`);
  }
  const expectedSubmission = requiredSubmissionFiles
    .filter((name) => name !== "PACKAGE-HASHES.json")
    .map((name) => `plugins/inner-signal-therapy/public-submission/${name}`)
    .sort();
  const recordedSubmission = Array.isArray(hashes.publicSubmission) ? hashes.publicSubmission : [];
  if (JSON.stringify(recordedSubmission.map((item) => item.path).sort()) !== JSON.stringify(expectedSubmission)) fail("public-submission hash inventory is incomplete");
  for (const item of recordedSubmission) {
    if (item.sha256 !== sha256(path.join(root, item.path))) fail(`public-submission hash is stale: ${item.path}`);
  }
  if (!Array.isArray(hashes.assets) || hashes.assets.length !== 0) fail("assets must remain empty without approved assets");
  return { manifestSha256: hashes.manifest.sha256, skillFiles: recordedSkills.length, submissionFiles: recordedSubmission.length };
}

try {
  const { skillFiles } = verifyManifest();
  const submission = verifySubmissionArtifacts();
  const hashes = verifyHashes(skillFiles);
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    ok: true,
    plugin: "inner-signal-therapy",
    skillsOnly: true,
    skillsTreeFrozen: true,
    submissionState: "externally-blocked",
    counts: { ...submission, skillFiles: hashes.skillFiles, hashedSubmissionFiles: hashes.submissionFiles },
    manifestSha256: hashes.manifestSha256
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`PLUGIN_PUBLIC_PREP_INVALID: ${error.message}\n`);
  process.exitCode = 1;
}
