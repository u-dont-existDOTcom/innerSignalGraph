#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { candidateFingerprint } from "../src/learning/fingerprint.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const required = [
  "learning-system/ARCHITECTURE.md",
  "learning-system/PRIVACY-CONSENT-BOUNDARY.md",
  "learning-system/PRIVATE-QUEUE-BOUNDARY.md",
  "learning-system/PERSONALIZATION-BOUNDARY.md",
  ...["feedback-evidence", "personalization-memory", "lesson-candidate", "review-card", "queue-status", "owner-decision-reference"].map((name) => `learning-system/schemas/${name}.schema.json`),
  ...["style-preference", "outcome-benefit", "outcome-worsening", "factual-correction-verified", "unsupported-disagreement", "unsafe-validation-request", "contradiction-set"].map((name) => `learning-system/fixtures/${name}.json`),
  "learning-system/reviewer-preview/review-cards.fixture.json",
  "learning-system/reviewer-preview/index.html",
  ...["contracts", "privacy-screen", "fingerprint", "consent-model", "personalization", "aggregation", "mock-private-queue", "reviewer", "promotion-gate"].map((name) => `src/learning/${name}.mjs`),
  ...["contracts", "privacy", "queue", "personalization", "governance", "isolation"].map((name) => `tests/learning-groundwork-${name}.test.mjs`)
];

for (const relative of required) await fs.access(path.join(root, relative));

const validDateTime = (value) => typeof value === "string" && !Number.isNaN(new Date(value).valueOf()) && new Date(value).toISOString() === value;
const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat("date-time", { type: "string", validate: validDateTime });
const schemaNames = ["feedback-evidence", "personalization-memory", "lesson-candidate", "review-card", "queue-status", "owner-decision-reference"];
const validators = {};
for (const name of schemaNames) {
  const schema = JSON.parse(await fs.readFile(path.join(root, `learning-system/schemas/${name}.schema.json`), "utf8"));
  validators[name] = ajv.compile(schema);
}

function validate(name, value, label) {
  if (!validators[name](value)) throw new Error(`${label} failed ${name} schema: ${ajv.errorsText(validators[name].errors, { separator: "; " })}`);
  const withUnknown = { ...value, unexpectedOfflineField: true };
  if (validators[name](withUnknown)) throw new Error(`${name} schema accepts an unknown field.`);
}

for (const name of ["style-preference", "outcome-benefit", "outcome-worsening", "factual-correction-verified", "unsupported-disagreement", "unsafe-validation-request"]) {
  validate("feedback-evidence", JSON.parse(await fs.readFile(path.join(root, `learning-system/fixtures/${name}.json`), "utf8")), `${name}.json`);
}

const contradictionSet = JSON.parse(await fs.readFile(path.join(root, "learning-system/fixtures/contradiction-set.json"), "utf8"));
if (contradictionSet.format !== "inner-signal-synthetic-contradiction-set-v1" || !Array.isArray(contradictionSet.occurrences) || contradictionSet.occurrences.length < 2) throw new Error("Synthetic contradiction fixture is incomplete.");
for (const [index, occurrence] of contradictionSet.occurrences.entries()) validate("lesson-candidate", occurrence.candidate, `contradiction occurrence ${index}`);

const cards = JSON.parse(await fs.readFile(path.join(root, "learning-system/reviewer-preview/review-cards.fixture.json"), "utf8"));
if (!Array.isArray(cards) || cards.length < 2) throw new Error("At least two synthetic review cards are required.");
for (const [index, card] of cards.entries()) validate("review-card", card, `review card ${index}`);

const memory = {
  format: "inner-signal-user-personalization-v1",
  memoryId: "ISM-SYN-VERIFY-001",
  memoryType: "presentation-preference",
  generalizedValue: "Prefer one fabricated step at a time.",
  provenance: "explicit-user-preference",
  status: "active",
  consentStatus: "local-only",
  createdAt: "2026-08-31T20:00:00.000Z",
  lastConfirmedAt: "2026-08-31T20:00:00.000Z",
  reviewAfter: "2026-09-30T20:00:00.000Z",
  authority: "user-scope-only",
  overrideClass: "soft",
  runtimeConsumerPresent: false
};
validate("personalization-memory", memory, "synthetic memory");
for (const prohibitedMeaning of ["Give a diagnosis.", "Create a global therapy rule.", "Always agree with me."]) {
  if (validators["personalization-memory"]({ ...memory, generalizedValue: prohibitedMeaning })) throw new Error(`Personalization schema accepts a prohibited meaning: ${prohibitedMeaning}`);
}

for (const queueStatus of [
  { availability: "available", totalOpen: 1, needsReview: 1, acceptedNotIncorporated: 0, incorporatedClosed: 0 },
  { availability: "unavailable", totalOpen: null, needsReview: null, acceptedNotIncorporated: null, incorporatedClosed: null, reasonCode: "SYNTHETIC_OFFLINE" }
]) validate("queue-status", queueStatus, `${queueStatus.availability} queue status`);

validate("owner-decision-reference", {
  format: "inner-signal-owner-decision-reference-v1",
  sourceLedger: "THERAPY-DECISIONS",
  decisionId: "SYNTHETIC-DECISION-VERIFY-001",
  candidateFingerprint: candidateFingerprint(contradictionSet.occurrences[0].candidate),
  decision: "approved",
  receiptSha256: "a".repeat(64)
}, "synthetic owner reference");

const sourceFiles = required.filter((relative) => relative.startsWith("src/learning/"));
const source = (await Promise.all(sourceFiles.map((relative) => fs.readFile(path.join(root, relative), "utf8")))).join("\n");
for (const forbidden of ["node:http", "node:https", "node:net", "node:tls", "undici", "octokit", "github", "fetch(", "WebSocket", "XMLHttpRequest"]) {
  if (source.includes(forbidden)) throw new Error(`Learning source contains network-capable token: ${forbidden}`);
}
const externalImports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]).filter((specifier) => !specifier.startsWith("."));
if (externalImports.length !== 1 || externalImports[0] !== "node:crypto") throw new Error(`Unexpected external learning imports: ${externalImports.join(", ")}`);

async function filesUnder(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory() ? filesUnder(path.join(directory, entry.name)) : [path.join(directory, entry.name)]))).flat();
}

const production = (await Promise.all(["src", "apps"].map((directory) => filesUnder(path.join(root, directory))))).flat().filter((file) => !file.startsWith(`${path.join(root, "src/learning")}${path.sep}`));
for (const file of production) {
  const content = await fs.readFile(file, "utf8");
  if (/src\/learning|\/learning\/(?:contracts|privacy-screen|fingerprint|consent-model|personalization|aggregation|mock-private-queue|reviewer|promotion-gate)\.mjs/.test(content)) throw new Error(`Runtime consumer imports learning groundwork: ${path.relative(root, file)}`);
  if (content.includes("learning-system/") || /(?:GET|POST|PUT|PATCH|DELETE)\s+\/?learning/.test(content)) throw new Error(`Runtime endpoint references learning groundwork: ${path.relative(root, file)}`);
}

const preview = await fs.readFile(path.join(root, "learning-system/reviewer-preview/index.html"), "utf8");
if (/<script\b/i.test(preview) || /(?:src|href)=["']https?:/i.test(preview)) throw new Error("Static reviewer preview contains a script or network resource.");
if (!preview.includes("Fabricated offline data only")) throw new Error("Static reviewer preview lacks its synthetic-data boundary.");

const statusLines = execFileSync("git", ["status", "--porcelain=v1", "-uall"], { cwd: root, encoding: "utf8" }).split("\n").filter((line) => line.trim());
const changedPaths = statusLines.map((line) => line.slice(3)).filter((relative) => !relative.startsWith(".review-handoff/"));
const allowed = [
  /^learning-system\//,
  /^src\/learning\//,
  /^scripts\/verify-learning-groundwork\.mjs$/,
  /^tests\/learning-groundwork-.*\.test\.mjs$/,
  /^package\.json$/,
  /^tasks\/opt-in-community-mvp-20260830\/(?:CURRENT-STATE|LEARNING-GROUNDWORK-EVIDENCE)\.md$/
];
for (const relative of changedPaths) if (!allowed.some((pattern) => pattern.test(relative))) throw new Error(`Changed path falls outside the directive: ${relative}`);
for (const ledger of ["THERAPY-LESSONS", "SUGGESTED-THERAPY-LESSONS", "THERAPY-DECISIONS", "APPROVED-THERAPY-LESSONS"]) if (changedPaths.includes(ledger)) throw new Error(`Therapy ledger changed: ${ledger}`);

process.stdout.write(`PASS ${schemaNames.length} strict schemas, ${required.length} required artifacts, ${cards.length} synthetic review cards, zero network-capable learning imports, and zero runtime consumers.\n`);
