#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import {
  LIVE_LEARNING_CATEGORIES,
  buildLiveLearningEvidence,
  validateLiveLearningEvidence
} from "../src/learning/live-contracts.mjs";
import {
  ACCOUNT_IDENTITY_SHIELDING_COPY,
  ACCOUNT_IDENTITY_SHIELDING_QUALIFICATION
} from "../src/learning/provider-disclosure.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const required = [
  "apps/web/app.js",
  "apps/web/correction-learning.js",
  "apps/web/index.html",
  "apps/web/styles.css",
  "src/server/create-server.mjs",
  "src/autopilot/web-smoke.mjs",
  "src/cli/learning-review.mjs",
  "src/learning/live-contracts.mjs",
  "src/learning/live-store.mjs",
  "learning-system/LIVE-LOCAL-LEARNING.md",
  "learning-system/schemas/live-learning-evidence.schema.json",
  "learning-system/fixtures/live-learning-correction.json",
  "tests/learning-live-contracts.test.mjs",
  "tests/learning-live-store.test.mjs",
  "tests/learning-live-server.test.mjs",
  "tests/learning-live-review-api.test.mjs",
  "tests/learning-live-review-workbench.test.mjs",
  "tests/learning-live-isolation.test.mjs",
  "tasks/opt-in-community-mvp-20260830/CURRENT-STATE.md",
  "tasks/opt-in-community-mvp-20260830/LIVE-LEARNING-EVIDENCE.md",
  "tasks/opt-in-community-mvp-20260830/OWNER-REVIEW-WORKBENCH-EVIDENCE.md"
];
for (const relative of required) await fs.access(path.join(root, relative));

const schema = JSON.parse(await fs.readFile(path.join(root, "learning-system/schemas/live-learning-evidence.schema.json"), "utf8"));
const validateSchema = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
const fixture = JSON.parse(await fs.readFile(path.join(root, "learning-system/fixtures/live-learning-correction.json"), "utf8"));
if (!validateSchema(fixture)) throw new Error(`Live learning fixture failed its strict schema: ${JSON.stringify(validateSchema.errors)}`);
if (validateSchema({ ...fixture, transcript: "PRIVATE_MARKER" })) throw new Error("Live learning schema accepts an unknown raw transcript field.");
validateLiveLearningEvidence(fixture);

const expected = {
  "did-not-work": ["outcome-signal", "A user reported that an InnerSignal response did not work for them.", "participant-reported", "participant-report-only-no-causal-inference", "unclear"],
  "did-not-make-sense": ["comprehension-signal", "A user reported that an InnerSignal response did not make sense to them.", "unresolved", "unresolved", "not-applicable"],
  disagreement: ["disagreement-signal", "A user explicitly disagreed with an InnerSignal response.", "unsupported-disagreement", "unresolved", "not-applicable"],
  correction: ["correction-signal", "A user explicitly corrected an InnerSignal response.", "unresolved", "unresolved", "not-applicable"],
  other: ["other-feedback-signal", "A user deliberately saved feedback as a potential InnerSignal lesson.", "unresolved", "unresolved", "not-applicable"]
};
for (const category of LIVE_LEARNING_CATEGORIES) {
  const candidate = buildLiveLearningEvidence({
    feedbackCategory: category,
    runtimeVersion: "0.15.2",
    detectorVersion: "private-correction-signal-v1"
  });
  const actual = [candidate.candidateKind, candidate.generalizedObservation, candidate.evidenceClass, candidate.causalBoundary, candidate.outcomeDirection];
  if (JSON.stringify(actual) !== JSON.stringify(expected[category])) throw new Error(`Conservative category mapping changed for ${category}.`);
  if (candidate.sourceContentRetained || candidate.runtimeAuthority !== "none" || candidate.therapyPolicyAuthority !== "none" || candidate.externalTransmissionAuthority !== "none") throw new Error(`${category} gained source content or authority.`);
}

async function filesUnder(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory() ? filesUnder(path.join(directory, entry.name)) : [path.join(directory, entry.name)]))).flat();
}

const learningFiles = await filesUnder(path.join(root, "src/learning"));
const learningSource = (await Promise.all(learningFiles.map((file) => fs.readFile(file, "utf8")))).join("\n");
for (const forbidden of ["node:http", "node:https", "node:net", "node:tls", "undici", "octokit", "fetch(", "WebSocket", "XMLHttpRequest", "api.openai.com", "openrouter.ai", "Authorization:", "Bearer ", "stripe", "checkout.session"]) {
  if (learningSource.includes(forbidden)) throw new Error(`Learning source contains external network/provider capability: ${forbidden}`);
}
const externalImports = new Set([...learningSource.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]).filter((specifier) => !specifier.startsWith(".")));
if (JSON.stringify([...externalImports].sort()) !== JSON.stringify(["node:crypto", "node:fs/promises", "node:path"])) throw new Error(`Unexpected learning module dependency: ${[...externalImports].join(", ")}`);

const productionFiles = (await Promise.all(["src", "apps"].map((directory) => filesUnder(path.join(root, directory))))).flat().filter((file) => !file.startsWith(`${path.join(root, "src/learning")}${path.sep}`));
const consumers = [];
for (const file of productionFiles) {
  const source = await fs.readFile(file, "utf8");
  for (const match of source.matchAll(/from\s+["']([^"']*\/learning\/[^"']+\.mjs)["']/g)) consumers.push([path.relative(root, file), match[1]]);
}
consumers.sort(([leftFile], [rightFile]) => leftFile.localeCompare(rightFile));
const expectedConsumers = [
  ["src/cli/learning-review.mjs", "../learning/live-store.mjs"],
  ["src/server/create-server.mjs", "../learning/live-store.mjs"]
];
if (JSON.stringify(consumers) !== JSON.stringify(expectedConsumers)) throw new Error(`Unexpected live learning consumers: ${JSON.stringify(consumers)}`);

const server = await fs.readFile(path.join(root, "src/server/create-server.mjs"), "utf8");
const routeBlockStart = server.indexOf("const LIVE_LEARNING_ENDPOINTS");
const routeBlockEnd = server.indexOf("\n]);", routeBlockStart);
const routeDefinitions = [...server.slice(routeBlockStart, routeBlockEnd).matchAll(/"(\/v1\/learning\/[^"]+)"/g)].map((match) => match[1]);
const expectedRoutes = [
  "/v1/learning/preview",
  "/v1/learning/submit",
  "/v1/learning/revoke",
  "/v1/learning/review/status",
  "/v1/learning/review/records",
  "/v1/learning/review/records/:receipt",
  "/v1/learning/review/records/:receipt/decision"
];
if (JSON.stringify(routeDefinitions) !== JSON.stringify(expectedRoutes)) throw new Error(`Learning route set changed: ${routeDefinitions.join(", ")}`);
if ((server.match(/readJson\(req, 16 \* 1024\)/g) ?? []).length !== 3) throw new Error("The candidate lifecycle must retain three 16 KiB JSON limits.");
if ((server.match(/readJson\(req, 4096\)/g) ?? []).length !== 1) throw new Error("The review decision route must use exactly one 4096-byte JSON limit.");
if (!server.includes("connect-src 'self'")) throw new Error("Loopback server CSP no longer limits connections to self.");

const app = await fs.readFile(path.join(root, "apps/web/app.js"), "utf8");
for (const route of routeDefinitions) if (!app.includes(route)) throw new Error(`Browser lacks ${route}.`);
const reviewUiStart = app.indexOf("const LEARNING_REVIEW_ROUTES");
const reviewUiEnd = app.indexOf("\nasync function postBinary", reviewUiStart);
if (reviewUiStart < 0 || reviewUiEnd < 0) throw new Error("Local learning review workbench boundary is missing.");
const reviewUi = app.slice(reviewUiStart, reviewUiEnd);
for (const action of ["Reject", "Insufficient evidence", "Duplicate", "Personalization/process only", "Needs external evidence", "Flag for owner therapy-policy decision"]) if (!reviewUi.includes(action)) throw new Error(`Local learning review action is missing: ${action}`);
for (const forbidden of ["occurrenceHash", "revocationHash", "revocationToken", "occurrenceToken", "previewNonce", "rawUserMessage", "assistantAnswer", "private-learning", "queue.json"]) if (reviewUi.includes(forbidden)) throw new Error(`Local learning review UI references a private field: ${forbidden}`);
if (!reviewUi.includes("Queue unavailable — counts not shown.") || !reviewUi.includes("No zero count has been inferred.")) throw new Error("Local learning review UI can collapse unavailable into zero.");
const lifecycleStart = app.indexOf("async function previewLearningContribution");
const lifecycleEnd = app.indexOf("\nfunction reviewButton", lifecycleStart);
if (lifecycleStart < 0 || lifecycleEnd < 0) throw new Error("Browser learning lifecycle boundary is missing.");
const lifecycle = app.slice(lifecycleStart, lifecycleEnd);
for (const forbidden of ["setInterval(", "setTimeout("]) if (lifecycle.includes(forbidden)) throw new Error(`Browser learning lifecycle contains background timing: ${forbidden}`);
for (const action of ["Preview learning contribution", "Continue with default contribution", "Do not contribute this candidate", "Revoke local contribution"]) if (!app.includes(action)) throw new Error(`Browser learning action is missing: ${action}`);
if ((app.match(/submitLearningContribution\(/g) ?? []).length !== 2 || !app.includes('submit.addEventListener("click", () => submitLearningContribution')) throw new Error("Submission is not bounded to the explicit preview click action.");
if (!app.includes("Access is unchanged.") || !app.includes("without payment")) throw new Error("Free refusal/revocation guarantees are missing from the browser.");
if (!/for \(const contribution of \[\.\.\.state\.learningContributions\]\)[\s\S]*await revokeLearningContribution\(contribution, \{ candidate \}\)[\s\S]*localStorage\.removeItem/.test(app)) throw new Error("Erase-local-data does not revoke known contributions before discarding mappings.");
if (!/recoverPendingLearningContribution[\s\S]*occurrenceToken: contribution\.occurrenceToken[\s\S]*revocationToken: contribution\.revocationToken/.test(lifecycle)) throw new Error("Ambiguous pending submissions cannot recover a receipt before erasure.");
if (!app.includes('state === "submission-pending") return candidate') || !app.includes("category.disabled = contributionPending")) throw new Error("Pending retry can drift from its original strict candidate.");
if (!app.includes('["contributed", "submission-pending"].includes(contribution?.state)')) throw new Error("Candidate deletion can discard an ambiguous pending contribution mapping.");
if (!app.includes("retry credentials were preserved")) throw new Error("Erase-local-data lacks a truthful retryable failure state.");

const html = await fs.readFile(path.join(root, "apps/web/index.html"), "utf8");
const visibleText = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
for (const copy of [ACCOUNT_IDENTITY_SHIELDING_COPY, ACCOUNT_IDENTITY_SHIELDING_QUALIFICATION]) if (!visibleText.includes(copy)) throw new Error("Exact account-identity-shielding copy is missing from the app.");
if (/remain(?:s)? anonymous unless|guarantee(?:s|d)? anonymity/i.test(visibleText)) throw new Error("App overclaims API anonymity.");

const sourceWithPrivateLearningPath = [];
for (const file of await filesUnder(path.join(root, "src"))) {
  if ((await fs.readFile(file, "utf8")).includes("private-learning")) sourceWithPrivateLearningPath.push(path.relative(root, file));
}
if (JSON.stringify(sourceWithPrivateLearningPath) !== JSON.stringify(["src/learning/live-store.mjs"])) throw new Error(`Private learning path leaked into export/sync code: ${sourceWithPrivateLearningPath.join(", ")}`);
const diagnostic = await fs.readFile(path.join(root, "src/export/diagnostic-bundle.mjs"), "utf8");
if (/private-learning|queue\.json/.test(diagnostic)) throw new Error("Diagnostic bundle references the private learning store.");

const statusLines = execFileSync("git", ["status", "--porcelain=v1", "-uall"], { cwd: root, encoding: "utf8" }).split("\n").filter((line) => line.trim());
const changedPaths = statusLines.map((line) => line.slice(3)).filter((relative) => !relative.startsWith(".review-handoff/"));
const allowed = [
  /^apps\/web\/(?:app\.js|index\.html|styles\.css|correction-learning\.js)$/,
  /^src\/server\/create-server\.mjs$/,
  /^src\/autopilot\/web-smoke\.mjs$/,
  /^src\/learning\//,
  /^src\/cli\/learning-review\.mjs$/,
  /^learning-system\//,
  /^scripts\/verify-learning-(?:live-loopback|groundwork|policy-groundwork)\.mjs$/,
  /^tests\/learning-live-.*\.test\.mjs$/,
  /^tests\/(?:correction-learning|server|web-client|learning-groundwork-isolation|learning-option-a-isolation)\.test\.mjs$/,
  /^package\.json$/,
  /^tasks\/opt-in-community-mvp-20260830\/(?:CURRENT-STATE|LIVE-LEARNING-EVIDENCE|OWNER-REVIEW-WORKBENCH-EVIDENCE)\.md$/
];
const isAllowed = (relative) => allowed.some((pattern) => pattern.test(relative));
for (const relative of changedPaths) if (!isAllowed(relative)) throw new Error(`Changed path falls outside the live-loopback directive: ${relative}`);
for (const relative of ["src/server/unrelated.mjs", "apps/web/unrelated.js", "tests/unrelated.test.mjs", "src/prompts/realize.mjs", "roadmap/roadmap.json", "state/CODEX-CURRENT-STATE.md", "tasks/opt-in-community-mvp-20260830/UNAUTHORIZED.md"]) if (isAllowed(relative)) throw new Error(`Changed-path allowlist is too broad: ${relative}`);
for (const ledger of ["THERAPY-LESSONS", "SUGGESTED-THERAPY-LESSONS", "THERAPY-DECISIONS", "APPROVED-THERAPY-LESSONS"]) if (changedPaths.includes(ledger)) throw new Error(`Therapy ledger changed: ${ledger}`);

process.stdout.write(`PASS 1 strict live evidence schema, ${LIVE_LEARNING_CATEGORIES.length} conservative category mappings, 7 loopback routes, one local owner-review workbench, exactly 2 runtime consumers, 0 external learning calls, 0 diagnostic/progress sync paths, exact account-identity-shielding copy, and runtime/therapy authority=none.\n`);
