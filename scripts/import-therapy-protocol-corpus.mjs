#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CORPUS_BATCH_COUNTS,
  CORPUS_CASE_COUNT,
  CORPUS_SCHEMA_VERSION,
  CORPUS_SOURCE_REPOSITORY,
  CORPUS_SOURCE_SHA,
  expectedCorpusIds,
  sha256
} from "../src/therapy-protocol/corpus.mjs";
import { expectationFor } from "./therapy-protocol-case-expectations.mjs";

const targetRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.resolve(process.argv[2] ?? "");
const outputRoot = path.join(targetRoot, "corpus/real-therapy-queries");

const EXPECTED_SOURCE_TREE = "0c0e3f1d15d3a9b1471261e96d1d6f7e533ce389";
const EXPECTED_PROTOCOL_TREE = "06a915aec1eedbf17d98c3764fa304881afb490d";
const EXPECTED_MAP_TREE = "ea19e973cbe4807922e50182efc2c6b61b2f22db";
const EXPECTED_SOURCE_MANIFEST_HASHES = Object.freeze({
  "006": "b1d1f5f32977ee179f46ac5ab5a9b49130fd3e8626d99c191c7615c081c927fd",
  "007": "c13909ff2edffe55d60c55954f3bba37540c0cc676aa37ce2228b0200ae5cc62",
  "008": "dca40e010ed67ad56df6cbb6e6a837b9b4038aaad7ad284aed75d50d9bb85b85",
  "009": "e570c2b74299cb6cc9a9016a898c5c80a9bb67fa6ebc79d58723a63ca6281a27"
});

function fail(message) {
  throw new Error(message);
}

function git(args, { encoding = "utf8" } = {}) {
  return execFileSync("git", args, { cwd: sourceRoot, encoding, stdio: ["ignore", "pipe", "pipe"] });
}

function gitBytes(rel) {
  return git(["show", `${CORPUS_SOURCE_SHA}:${rel}`], { encoding: null });
}

function pretty(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function writeJson(rel, value) {
  const file = path.join(outputRoot, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const bytes = Buffer.from(pretty(value));
  fs.writeFileSync(file, bytes);
  return sha256(bytes);
}

if (!sourceRoot || !fs.existsSync(path.join(sourceRoot, ".git"))) {
  fail("Usage: node scripts/import-therapy-protocol-corpus.mjs /path/to/creativeTailSampling");
}

const remote = git(["remote", "get-url", "origin"]).trim();
if (!/u-dont-existDOTcom\/creativeTailSampling(?:\.git)?$/.test(remote)) fail(`Unexpected source remote: ${remote}`);
git(["cat-file", "-e", `${CORPUS_SOURCE_SHA}^{commit}`]);
const sourceTree = git(["rev-parse", `${CORPUS_SOURCE_SHA}^{tree}`]).trim();
if (sourceTree !== EXPECTED_SOURCE_TREE) fail(`Pinned source tree mismatch: ${sourceTree}`);
const protocolTree = git(["rev-parse", `${CORPUS_SOURCE_SHA}:analysis/inner_child_protocol`]).trim();
if (protocolTree !== EXPECTED_PROTOCOL_TREE) fail(`Pinned protocol tree mismatch: ${protocolTree}`);
const mapTree = git(["rev-parse", `${CORPUS_SOURCE_SHA}:analysis/inner_child_protocol/maps`]).trim();
if (mapTree !== EXPECTED_MAP_TREE) fail(`Pinned map tree mismatch: ${mapTree}`);

const generatedCases = [];
const decodedQueryInventory = [];
const sourceRecordInventory = [];
for (const [batch, count] of Object.entries(CORPUS_BATCH_COUNTS)) {
  const sourceBatch = String(Number(batch));
  const sourceBase = `analysis/inner_child_protocol/real-query-batch-${batch}`;
  const sourceManifestPath = `${sourceBase}/manifest.json`;
  const sourceManifestBytes = gitBytes(sourceManifestPath);
  if (sha256(sourceManifestBytes) !== EXPECTED_SOURCE_MANIFEST_HASHES[batch]) fail(`Source manifest ${batch} hash mismatch.`);
  const sourceManifest = JSON.parse(sourceManifestBytes.toString("utf8"));
  if (sourceManifest.case_count !== count || sourceManifest.case_files.length !== count) fail(`Source manifest ${batch} count mismatch.`);
  for (const rel of sourceManifest.case_files) {
    const sourcePath = `${sourceBase}/${rel}`;
    const sourceBytes = gitBytes(sourcePath);
    const sourceRecord = JSON.parse(sourceBytes.toString("utf8"));
    const expected = expectationFor(sourceRecord.id);
    const expectedFile = `cases/${sourceRecord.id}.json`;
    if (rel !== expectedFile) fail(`Source manifest path/ID mismatch for ${sourceRecord.id}.`);
    const querySha256 = sha256(sourceRecord.query);
    const sourceBlobSha = git(["rev-parse", `${CORPUS_SOURCE_SHA}:${sourcePath}`]).trim();
    const query = {
      id: sourceRecord.id,
      query: sourceRecord.query,
      source: `${CORPUS_SOURCE_REPOSITORY}@${CORPUS_SOURCE_SHA}`,
      sourceUrl: sourceRecord.source_url,
      sourceDate: "2026-08-18",
      batch
    };
    const grader = {
      schemaVersion: 1,
      id: sourceRecord.id,
      batch,
      source: {
        repository: CORPUS_SOURCE_REPOSITORY,
        commit: CORPUS_SOURCE_SHA,
        tree: sourceTree,
        path: sourcePath,
        blobSha: sourceBlobSha,
        recordSha256: sha256(sourceBytes),
        evidenceType: batch === "008" && sourceRecord.source_type === "peer_reviewed_analysis_quoting_public_reddit_original"
          ? "peer-reviewed analysis quoting a public anecdotal original"
          : "public anecdotal first-person account",
        limitations: [
          "The imported text is a privacy-reduced paraphrase or quoted public account, not the original raw-post bytes.",
          "The source claim is unverified and does not establish diagnosis, causation, clinical efficacy, or legal correctness.",
          "Creative Tail expected routes are conceptual post-repair judgments, not independent validation of InnerSignalGraph."
        ]
      },
      querySha256,
      derivation: {
        method: "owner-authorized-operation-translation-v1",
        translatedAt: "2026-08-18",
        sourceRouteField: Array.isArray(sourceRecord.route) ? "route" : "first_route",
        explanation: "The pinned prose-first route was translated into the smallest O0-O10 operation that preserves its first consequential permission boundary."
      },
      sourceMetadata: {
        domain: sourceRecord.domain,
        sourceTitle: sourceRecord.source_title,
        sourceType: sourceRecord.source_type ?? "public_reddit_original_post",
        sourceContext: sourceRecord.source_context ?? sourceRecord.source_subreddit ?? "",
        whyUnprimed: sourceRecord.why_unprimed,
        route: sourceRecord.route ?? sourceRecord.first_route,
        sourceResult: sourceRecord.result_after_patch ?? sourceRecord.initial_result,
        defectFound: sourceRecord.defect_found,
        implementedImprovement: sourceRecord.implemented_improvement
      },
      protocolProfile: expected.profile,
      variables: expected.variables,
      expected: {
        ...expected.expected,
        prohibitedBehaviors: sourceRecord.regression_assertions.filter((item) => /\b(?:does not|do not|no individualized|cannot|must not)\b/i.test(item)),
        assertions: sourceRecord.regression_assertions
      },
      ablationMaps: expected.ablationMaps
    };
    if (!grader.expected.prohibitedBehaviors.length) grader.expected.prohibitedBehaviors = [...sourceRecord.regression_assertions];
    const queryPath = `queries/${sourceRecord.id}.json`;
    const graderPath = `graders/${sourceRecord.id}.json`;
    const queryFileSha256 = writeJson(queryPath, query);
    const graderFileSha256 = writeJson(graderPath, grader);
    generatedCases.push({
      id: sourceRecord.id,
      batch,
      queryPath: `corpus/real-therapy-queries/${queryPath}`,
      graderPath: `corpus/real-therapy-queries/${graderPath}`,
      queryFileSha256,
      graderFileSha256
    });
    decodedQueryInventory.push(`${sourceRecord.id}\0${sourceRecord.query}`);
    sourceRecordInventory.push(`${sourcePath}\0${sha256(sourceBytes)}`);
  }
}

if (generatedCases.length !== CORPUS_CASE_COUNT) fail(`Expected ${CORPUS_CASE_COUNT} generated cases; got ${generatedCases.length}.`);
const ids = generatedCases.map((item) => item.id);
if (JSON.stringify([...ids].sort()) !== JSON.stringify(expectedCorpusIds().sort())) fail("Generated IDs do not match the exact pinned corpus.");

const manifest = {
  schemaVersion: CORPUS_SCHEMA_VERSION,
  generatedBy: "scripts/import-therapy-protocol-corpus.mjs",
  source: {
    repository: CORPUS_SOURCE_REPOSITORY,
    commit: CORPUS_SOURCE_SHA,
    tree: sourceTree,
    protocolTree,
    mapTree,
    oneParentSemanticCheckpoint: "db591713a3feb0a1576943408ae356685c0034ec",
    sourceManifestSha256: EXPECTED_SOURCE_MANIFEST_HASHES,
    sourceRecordInventorySha256: sha256(sourceRecordInventory.join("\n")),
    decodedQueryInventorySha256: sha256(decodedQueryInventory.join("\n"))
  },
  isolation: {
    version: "physical-query-grader-split-v1",
    modelInput: "decoded query string only",
    executorLoader: "src/therapy-protocol/corpus.mjs#loadModelInputs",
    graderLoader: "src/therapy-protocol/corpus.mjs#loadGraders",
    graderLoadedAfterExecution: true
  },
  caseCount: generatedCases.length,
  batchCounts: { ...CORPUS_BATCH_COUNTS },
  cases: generatedCases
};
writeJson("manifest.json", manifest);
process.stdout.write(`${JSON.stringify({ ok: true, outputRoot, caseCount: generatedCases.length, sourceCommit: CORPUS_SOURCE_SHA }, null, 2)}\n`);
