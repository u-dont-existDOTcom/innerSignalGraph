import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { OPERATION_CLASS_VALUES, ROUTE_DISPOSITIONS } from "./contract.mjs";
import { validateProtocolProfile } from "./validate.mjs";

export const CORPUS_SCHEMA_VERSION = 2;
export const CORPUS_SOURCE_REPOSITORY = "u-dont-existDOTcom/creativeTailSampling";
export const CORPUS_SOURCE_SHA = "af36a51e44a65067a3d7703a78a004fdb8ad7693";
export const CORPUS_CASE_COUNT = 49;
export const CORPUS_BATCH_COUNTS = Object.freeze({ "006": 16, "007": 12, "008": 11, "009": 10 });
export const QUERY_ALLOWED_KEYS = Object.freeze(["id", "query", "source", "sourceUrl", "sourceDate", "batch"]);
export const QUERY_FORBIDDEN_KEYS = Object.freeze([
  "expectedRoute",
  "expectedFirstOperation",
  "assertions",
  "prohibitedBehaviors",
  "grader",
  "targetFramework",
  "mapDisposition",
  "failureClass"
]);

const ROUTE_DISPOSITION_VALUES = new Set(Object.values(ROUTE_DISPOSITIONS));
const OPERATION_VALUES = new Set(OPERATION_CLASS_VALUES);

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function readJsonWithBytes(file) {
  const bytes = fs.readFileSync(file);
  return { bytes, value: JSON.parse(bytes.toString("utf8")) };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertPlainObject(value, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object.`);
}

function resolveMember(root, rel, expectedPrefix) {
  assert(typeof rel === "string" && rel.length > 0, "Corpus member path must be a non-empty string.");
  const normalized = rel.replaceAll("\\", "/");
  assert(normalized.startsWith(expectedPrefix), `Corpus member ${rel} must be under ${expectedPrefix}.`);
  assert(!normalized.split("/").includes(".."), `Corpus member ${rel} cannot traverse outside the corpus.`);
  const absolute = path.resolve(root, normalized);
  const corpusRoot = path.resolve(root, "corpus/real-therapy-queries");
  assert(absolute.startsWith(`${corpusRoot}${path.sep}`), `Corpus member ${rel} resolves outside the corpus.`);
  const stat = fs.lstatSync(absolute);
  assert(stat.isFile() && !stat.isSymbolicLink(), `Corpus member ${rel} must be a regular non-symlink file.`);
  return absolute;
}

export function expectedCorpusIds() {
  const ids = [];
  for (const [batch, count] of Object.entries(CORPUS_BATCH_COUNTS)) {
    const shortBatch = String(Number(batch));
    for (let index = 1; index <= count; index += 1) ids.push(`RQ${shortBatch}-${String(index).padStart(2, "0")}`);
  }
  return ids;
}

export function validateCorpusManifest(manifest) {
  assertPlainObject(manifest, "Corpus manifest");
  assert(manifest.schemaVersion === CORPUS_SCHEMA_VERSION, `Corpus schemaVersion must be ${CORPUS_SCHEMA_VERSION}.`);
  assert(manifest.source?.repository === CORPUS_SOURCE_REPOSITORY, "Corpus source repository is not the pinned Creative Tail repository.");
  assert(manifest.source?.commit === CORPUS_SOURCE_SHA, "Corpus source commit is not the pinned Creative Tail commit.");
  assert(manifest.caseCount === CORPUS_CASE_COUNT, `Corpus caseCount must be ${CORPUS_CASE_COUNT}.`);
  assert(Array.isArray(manifest.cases) && manifest.cases.length === CORPUS_CASE_COUNT, `Corpus cases must contain ${CORPUS_CASE_COUNT} entries.`);
  assert(JSON.stringify(manifest.batchCounts) === JSON.stringify(CORPUS_BATCH_COUNTS), "Corpus batchCounts do not match the pinned batch contract.");
  const ids = manifest.cases.map((item) => item?.id);
  assert(new Set(ids).size === CORPUS_CASE_COUNT, "Corpus IDs must be present and unique.");
  assert(JSON.stringify([...ids].sort()) === JSON.stringify(expectedCorpusIds().sort()), "Corpus IDs do not match the exact pinned 49-case set.");
  const queryPaths = manifest.cases.map((item) => item?.queryPath);
  const graderPaths = manifest.cases.map((item) => item?.graderPath);
  assert(new Set(queryPaths).size === CORPUS_CASE_COUNT, "Every corpus case must use a unique query path.");
  assert(new Set(graderPaths).size === CORPUS_CASE_COUNT, "Every corpus case must use a unique grader path.");
  const recomputed = Object.fromEntries(Object.keys(CORPUS_BATCH_COUNTS).map((batch) => [batch, 0]));
  for (const item of manifest.cases) {
    assertPlainObject(item, "Corpus manifest case");
    assert(typeof item.batch === "string" && Object.hasOwn(recomputed, item.batch), `Case ${item.id} has an invalid batch.`);
    recomputed[item.batch] += 1;
    assert(item.queryPath !== item.graderPath, `Case ${item.id} query and grader paths collide.`);
    assert(/^[a-f0-9]{64}$/.test(item.queryFileSha256 ?? ""), `Case ${item.id} lacks a valid query file hash.`);
    assert(/^[a-f0-9]{64}$/.test(item.graderFileSha256 ?? ""), `Case ${item.id} lacks a valid grader file hash.`);
  }
  assert(JSON.stringify(recomputed) === JSON.stringify(CORPUS_BATCH_COUNTS), "Corpus batch counts do not match the case entries.");
  return manifest;
}

export function validateQueryInput(query, manifestItem) {
  assertPlainObject(query, `Query ${manifestItem.id}`);
  const keys = Object.keys(query);
  for (const key of keys) assert(QUERY_ALLOWED_KEYS.includes(key), `Query ${manifestItem.id} contains non-allowlisted field ${key}.`);
  for (const key of QUERY_FORBIDDEN_KEYS) assert(!Object.hasOwn(query, key), `Query ${manifestItem.id} leaks grader field ${key}.`);
  assert(query.id === manifestItem.id, `Query ${manifestItem.id} has a mismatched ID.`);
  assert(query.batch === manifestItem.batch, `Query ${manifestItem.id} has a mismatched batch.`);
  assert(typeof query.query === "string" && query.query.trim(), `Query ${manifestItem.id} has no model-facing text.`);
  assert(typeof query.source === "string" && query.source === `${CORPUS_SOURCE_REPOSITORY}@${CORPUS_SOURCE_SHA}`, `Query ${manifestItem.id} has invalid source identity.`);
  assert(typeof query.sourceUrl === "string" && /^https:\/\//.test(query.sourceUrl), `Query ${manifestItem.id} has an invalid public source URL.`);
  assert(query.sourceDate === "2026-08-18", `Query ${manifestItem.id} has an invalid source date.`);
  return query;
}

export function validateGrader(grader, manifestItem) {
  assertPlainObject(grader, `Grader ${manifestItem.id}`);
  assert(grader.schemaVersion === 1, `Grader ${manifestItem.id} has an unsupported schemaVersion.`);
  assert(grader.id === manifestItem.id && grader.batch === manifestItem.batch, `Grader ${manifestItem.id} identity does not match the manifest.`);
  assert(grader.source?.repository === CORPUS_SOURCE_REPOSITORY && grader.source?.commit === CORPUS_SOURCE_SHA, `Grader ${manifestItem.id} is not bound to the pinned source.`);
  assert(typeof grader.source?.path === "string" && grader.source.path.endsWith(`/cases/${grader.id}.json`), `Grader ${manifestItem.id} has an invalid source path.`);
  assert(/^[a-f0-9]{40}$/.test(grader.source?.blobSha ?? ""), `Grader ${manifestItem.id} lacks a source Git blob SHA.`);
  assert(/^[a-f0-9]{64}$/.test(grader.source?.recordSha256 ?? ""), `Grader ${manifestItem.id} lacks a source-record hash.`);
  assert(/^[a-f0-9]{64}$/.test(grader.querySha256 ?? ""), `Grader ${manifestItem.id} lacks a query hash.`);
  assert(grader.derivation?.method === "owner-authorized-operation-translation-v1", `Grader ${manifestItem.id} lacks the expected derivation method.`);
  assert(ROUTE_DISPOSITION_VALUES.has(grader.expected?.disposition), `Grader ${manifestItem.id} has an invalid expected disposition.`);
  assert(OPERATION_VALUES.has(grader.expected?.operation), `Grader ${manifestItem.id} has an invalid expected operation.`);
  assert(Array.isArray(grader.expected?.acceptableOperations) && grader.expected.acceptableOperations.includes(grader.expected.operation), `Grader ${manifestItem.id} has invalid acceptable operations.`);
  assert(grader.expected.acceptableOperations.every((operation) => OPERATION_VALUES.has(operation)), `Grader ${manifestItem.id} contains an invalid acceptable operation.`);
  assert(Array.isArray(grader.expected?.requiredUnknowns), `Grader ${manifestItem.id} requiredUnknowns must be an array.`);
  assert(Array.isArray(grader.expected?.prohibitedBehaviors) && grader.expected.prohibitedBehaviors.length > 0, `Grader ${manifestItem.id} needs prohibited behaviors.`);
  assert(Array.isArray(grader.expected?.assertions) && grader.expected.assertions.length > 0, `Grader ${manifestItem.id} needs assertions.`);
  assert(["low", "moderate", "severe"].includes(grader.expected?.wrongRouteSeverity), `Grader ${manifestItem.id} has invalid route severity.`);
  assert(Array.isArray(grader.expected?.falseEscalationOperations), `Grader ${manifestItem.id} falseEscalationOperations must be an array.`);
  assert(Array.isArray(grader.ablationMaps), `Grader ${manifestItem.id} ablationMaps must be an array.`);
  assert(grader.ablationMaps.every((map) => ["map15", "map16"].includes(map)), `Grader ${manifestItem.id} has invalid ablation map tags.`);
  validateProtocolProfile(grader.protocolProfile);
  assertPlainObject(grader.variables, `Grader ${manifestItem.id} variables`);
  return grader;
}

export function loadCorpusManifest(root = process.cwd()) {
  const manifestPath = path.join(root, "corpus/real-therapy-queries/manifest.json");
  const { bytes, value } = readJsonWithBytes(manifestPath);
  return { manifest: validateCorpusManifest(value), manifestPath, manifestSha256: sha256(bytes) };
}

// Executor-side loader. This function deliberately never opens graderPath.
export function loadModelInputs(root = process.cwd()) {
  const { manifest, manifestSha256 } = loadCorpusManifest(root);
  const inputs = manifest.cases.map((item) => {
    const file = resolveMember(root, item.queryPath, "corpus/real-therapy-queries/queries/");
    const { bytes, value } = readJsonWithBytes(file);
    assert(sha256(bytes) === item.queryFileSha256, `Query file hash mismatch for ${item.id}.`);
    const query = validateQueryInput(value, item);
    return Object.freeze({ id: query.id, query: query.query, batch: query.batch, querySha256: sha256(query.query), queryFileSha256: sha256(bytes) });
  });
  return { manifest, manifestSha256, inputs };
}

// Grader-side loader. Call only after model execution has completed or been checkpointed.
export function loadGraders(root = process.cwd()) {
  const { manifest, manifestSha256 } = loadCorpusManifest(root);
  const graders = new Map();
  for (const item of manifest.cases) {
    const file = resolveMember(root, item.graderPath, "corpus/real-therapy-queries/graders/");
    const { bytes, value } = readJsonWithBytes(file);
    assert(sha256(bytes) === item.graderFileSha256, `Grader file hash mismatch for ${item.id}.`);
    const grader = validateGrader(value, item);
    const queryItem = manifest.cases.find((candidate) => candidate.id === item.id);
    const queryFile = resolveMember(root, queryItem.queryPath, "corpus/real-therapy-queries/queries/");
    const query = readJsonWithBytes(queryFile).value;
    assert(grader.querySha256 === sha256(query.query), `Grader/query text hash mismatch for ${item.id}.`);
    graders.set(item.id, grader);
  }
  return { manifest, manifestSha256, graders };
}

export function loadCompleteCorpus(root = process.cwd()) {
  const executor = loadModelInputs(root);
  const grading = loadGraders(root);
  assert(executor.manifestSha256 === grading.manifestSha256, "Executor and grader phases observed different corpus manifests.");
  return {
    manifest: executor.manifest,
    manifestSha256: executor.manifestSha256,
    cases: executor.inputs.map((input) => ({ input, grader: grading.graders.get(input.id) }))
  };
}
