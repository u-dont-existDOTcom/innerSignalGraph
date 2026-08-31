#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaRoot = path.join(root, "community-learning", "schemas");
const examplesRoot = path.join(root, "community-learning", "examples");

function validDateTime(value) {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat("date-time", { type: "string", validate: validDateTime });
ajv.addFormat("uuid", { type: "string", validate: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i });

const schemas = new Map();
for (const name of (await fs.readdir(schemaRoot)).filter((item) => item.endsWith(".schema.json")).sort()) {
  const schema = JSON.parse(await fs.readFile(path.join(schemaRoot, name), "utf8"));
  schemas.set(name, schema);
  ajv.addSchema(schema);
}

for (const required of [
  "consent-grant.schema.json",
  "post.schema.json",
  "field-note.schema.json",
  "contribution-receipt.schema.json",
  "learning-card.schema.json",
  "proposal-export.schema.json"
]) {
  if (!schemas.has(required)) throw new Error(`Missing required community schema: ${required}`);
}

const cardValidator = ajv.getSchema(schemas.get("learning-card.schema.json").$id);
const proposalValidator = ajv.getSchema(schemas.get("proposal-export.schema.json").$id);
let cardCount = 0;
let proposalCount = 0;
for (const name of (await fs.readdir(examplesRoot)).filter((item) => item.endsWith(".json")).sort()) {
  const example = JSON.parse(await fs.readFile(path.join(examplesRoot, name), "utf8"));
  const validator = name.startsWith("learning-card-") ? cardValidator : name.startsWith("proposal-export-") ? proposalValidator : null;
  if (!validator) continue;
  if (!validator(example)) {
    throw new Error(`${name} failed schema validation: ${ajv.errorsText(validator.errors, { separator: "; " })}`);
  }
  if (name.startsWith("learning-card-")) {
    cardCount += 1;
    if (example.runtimeAuthority !== "none") throw new Error(`${name} claims runtime authority.`);
    if (example.sourceKind !== "synthetic") throw new Error(`${name} must remain visibly synthetic.`);
  } else {
    proposalCount += 1;
    if (example.candidateOnly !== true || example.activation !== "proposal-only" || example.runtimeWritable !== false) {
      throw new Error(`${name} violates the non-activation contract.`);
    }
  }
}

if (cardCount < 3) throw new Error("At least three synthetic Learning Cards are required.");
if (proposalCount < 1) throw new Error("A synthetic non-activating proposal export is required.");

const proposalSchema = schemas.get("proposal-export.schema.json");
if (proposalSchema.properties.activation.const !== "proposal-only"
    || proposalSchema.properties.candidateOnly.const !== true
    || proposalSchema.properties.runtimeWritable.const !== false) {
  throw new Error("Proposal schema no longer fails closed at proposal-only/non-writable.");
}
if (schemas.get("post.schema.json").properties.conversationOnly.const !== true) {
  throw new Error("Commons posts are no longer structurally conversation-only.");
}
if (schemas.get("learning-card.schema.json").properties.runtimeAuthority.const !== "none") {
  throw new Error("Learning Cards are no longer structurally non-authoritative.");
}

const runtimeSources = await Promise.all([
  "src/community-learning/contracts.mjs",
  "src/community-learning/store.mjs",
  "src/community-learning/server.mjs"
].map((relative) => fs.readFile(path.join(root, relative), "utf8")));
const runtimeSource = runtimeSources.join("\n");
const storeSource = runtimeSources[1];
if (!/MIN_PUBLIC_CARD_CONTRIBUTORS = 3/.test(storeSource)) {
  throw new Error("Community-derived shared-card minimum is no longer three independent contributors.");
}
if (!/raw prose is not republished|verbatim details remain reviewer-restricted/.test(storeSource)) {
  throw new Error("Shared Learning Cards no longer preserve the no-verbatim-Field-Note boundary.");
}
if (!/stale-consent-change/.test(storeSource) || !/stale-data-deletion/.test(storeSource)) {
  throw new Error("Proposal records are not invalidated after consent withdrawal or data deletion.");
}
if (!/reviewStatus === "human-reviewed"/.test(storeSource)) {
  throw new Error("Community-derived Learning Cards no longer fail closed on human review.");
}
for (const forbidden of ["THERAPY-LESSONS", "guide-packets/", "guide-graphs/", "refs/heads/stable"]) {
  if (runtimeSource.includes(forbidden)) throw new Error(`Community runtime contains prohibited authority path: ${forbidden}`);
}

const html = await fs.readFile(path.join(root, "apps/community/index.html"), "utf8");
for (const requiredText of [
  "Your private InnerSignal sessions are not imported",
  "No box is preselected",
  "Support reactions and evidence follow-ups are counted separately",
  "No card can activate InnerSignal runtime behavior",
  "Remove my current Commons content and deactivate account",
  "append-only event ledger may retain pseudonymous",
  "I confirm that I am at least 18 years old"
]) {
  if (!html.includes(requiredText)) throw new Error(`Community UI is missing required boundary text: ${requiredText}`);
}

const architecture = await fs.readFile(path.join(root, "community-learning/ARCHITECTURE.md"), "utf8");
if ((architecture.match(/```mermaid/g) ?? []).length < 2 || !architecture.includes("prohibited direct write")) {
  throw new Error("Community operational Mermaid maps are missing or incomplete.");
}

process.stdout.write(`PASS ${cardCount} synthetic Learning Cards and ${proposalCount} proposal export validate; conversation, consent, deletion, minimum-cell, and runtime non-activation gates are intact.\n`);
