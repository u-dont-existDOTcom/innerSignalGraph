#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { canonicalJson } from "../src/guide-packet/contract.mjs";
import { readZipEntries } from "../src/core/zip.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const execFileAsync = promisify(execFile);
const ENTRY_PATTERN = /<!-- therapy-lesson (\{[^\r\n]*\}) -->/g;
const ACTIVATIONS = new Set(["active-runtime", "candidate-awaiting-owner"]);
const LEDGER_FILES = {
  history: "THERAPY-LESSONS",
  suggestions: "SUGGESTED-THERAPY-LESSONS",
  decisions: "THERAPY-DECISIONS",
  approvals: "APPROVED-THERAPY-LESSONS"
};
const POLICY_DECISION_PACKAGE_DIR = path.join("docs", "therapy-policy", "decision-packages");
const POLICY_DECISION_PACKAGE_CONTRACT = "therapy-policy-decision-package-v1";
const SUGGESTION_STATUSES = new Set([
  "blocked-by-packet-review", "needs-technical-repair", "ready-for-owner",
  "approved", "implemented", "declined", "superseded"
]);
const APPROVAL_STATUSES = new Set(["approved-not-implemented", "implemented"]);
const SUGGESTION_SECTIONS = [
  "Proposal", "Guide impact", "Evidence and uncertainty", "Review result",
  "Why not active", "Technical next action", "Decision needed",
  "Options and trade-offs", "Recommendation and reasoning"
];
const APPROVAL_SECTIONS = [
  "Exact decision", "Owner reasoning or stated preference", "Scope and constraints",
  "Guide impact", "Implementation status", "Verification evidence"
];
const REVIEW_SECTIONS = [
  "Review outcome", "Finding dispositions", "What this does not mean",
  "Finding-to-suggestion mapping", "Packet-level findings", "Next phase"
];
const DECISION_CHOICES = new Set(["approve", "decline"]);
const DECISION_SECTIONS = ["Explicit owner choice", "Evidence binding"];
const IMPLEMENTATION_SECTIONS = ["Implementation scope", "Regression evidence"];
const OWNER_PROTOCOL_RULES = [
  "read-all-four-ledgers",
  "separate-deterministic-repairs-from-owner-choice",
  "ask-joel-directly-in-active-conversation",
  "one-substantive-decision-unless-joel-requests-bundling",
  "state-exact-decision-and-why-now",
  "classify-evidence-type-and-limitations",
  "present-viable-options-benefits-costs-worst-failure",
  "keep-recommendation-and-detailed-reasoning-distinct",
  "enumerate-guide-graph-prompt-safety-regression-effects",
  "no-answer-leaves-policy-unchanged",
  "record-explicit-answer-only-never-infer",
  "commit-git-transition-and-tests-before-durable-guidance",
  "never-store-private-therapy-transcript"
];
const AFFECTED_ID_FIELDS = ["guideIds", "graphNodeIds", "promptContractIds", "policySafetyGateIds", "regressionIds"];
const MARKERS_BY_FILE = {
  "THERAPY-LESSONS": new Set(["therapy-lesson", "therapy-review-event", "therapy-implementation-event"]),
  "SUGGESTED-THERAPY-LESSONS": new Set(["therapy-suggestion"]),
  "THERAPY-DECISIONS": new Set(["therapy-decision"]),
  "APPROVED-THERAPY-LESSONS": new Set(["therapy-approval"]),
  "AGENTS.md": new Set(["therapy-owner-decision-protocol"])
};
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const DECISION_RECEIPT_FIELDS = new Set([
  "receiptId", "suggestionId", "packetId", "packetDigest", "decisionId",
  "decisionCardDigest", "reviewEventId", "reviewArtifactPath",
  "reviewArtifactSha256", "choice", "decisionSource", "decidedAt",
  ...AFFECTED_ID_FIELDS
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedId(value) {
  return typeof value === "string" ? value.trim() : "";
}

function assertScalarId(entry, field, id) {
  const normalized = normalizedId(entry[field]);
  if (!normalized) throw new Error(`${id} has an invalid ${field}.`);
  entry[field] = normalized;
}

function assertNoForbiddenFields(entry, id, fields) {
  for (const field of fields) {
    if (Object.hasOwn(entry, field)) throw new Error(`${id} contains forbidden field ${field}.`);
  }
}

function assertOnlyFields(entry, id, allowedFields) {
  for (const field of Object.keys(entry)) {
    if (!allowedFields.has(field)) throw new Error(`${id} contains unsupported field ${field}.`);
  }
}

function scanGovernanceMarkers({ source, fileName }) {
  const allowed = MARKERS_BY_FILE[fileName];
  if (!allowed) return;
  const markerStarts = [...source.matchAll(/<!--\s*therapy-/g)].map((match) => match.index);
  const allCommentStarts = [...source.matchAll(/<!--/g)].map((match) => match.index);
  const allCommentEnds = [...source.matchAll(/-->/g)].map((match) => match.index);
  if (allCommentEnds.length > allCommentStarts.length) throw new Error(`${fileName}: dangling governance marker terminator.`);
  for (const start of markerStarts) {
    if (!source.startsWith("<!-- therapy-", start)) {
      const marker = source.slice(start).match(/^<!--\s*(therapy-[a-z0-9-]+)/)?.[1] ?? "governance";
      throw new Error(`${fileName}: malformed ${marker} marker.`);
    }
  }
  let offset = 0;
  while (true) {
    const start = source.indexOf("<!-- therapy-", offset);
    if (start === -1) return;
    const end = source.indexOf("-->", start);
    const nested = source.indexOf("<!--", start + 4);
    if (nested !== -1 && (end === -1 || nested < end)) throw new Error(`${fileName}: multiply consumed governance marker.`);
    const prefix = source.slice(start + 5, end === -1 ? source.length : end).trimStart();
    const marker = prefix.match(/^(therapy-[a-z0-9-]+)/)?.[1] ?? "unknown";
    if (end === -1) throw new Error(`${fileName}: truncated ${marker} marker.`);
    if (!MARKERS_BY_FILE[fileName].has(marker)) {
      const known = Object.values(MARKERS_BY_FILE).some((set) => set.has(marker));
      throw new Error(`${fileName}: ${known ? `${marker} marker is not allowed` : `unknown governance marker ${marker}`}.`);
    }
    const raw = source.slice(start, end + 3);
    if (!new RegExp(`^<!-- ${escapeRegExp(marker)} \\{[^\\r\\n]*\\} -->$`).test(raw)) {
      throw new Error(`${fileName}: malformed ${marker} marker.`);
    }
    offset = end + 3;
  }
}

function validInstant(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function readRequiredFile(rootDir, fileName) {
  try {
    return await fs.readFile(path.join(rootDir, fileName), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`${fileName} is required.`);
    throw error;
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertIdArray({ entry, field, id }) {
  const value = entry[field];
  if (!Array.isArray(value) || value.some((item) => !normalizedId(item))) {
    throw new Error(`${id} has an invalid ${field}.`);
  }
  const normalized = value.map(normalizedId);
  if (new Set(normalized).size !== normalized.length) throw new Error(`${id} has duplicate ${field}.`);
  entry[field] = normalized;
}

function assertIdArrays(entry, id, fields) {
  for (const field of fields) {
    assertIdArray({ entry, field, id });
  }
}

export function assertRequiredSections({ fileName, id, body, sections }) {
  for (const section of sections) {
    const sectionPattern = new RegExp(`^### ${escapeRegExp(section)}\\r?\\n([\\s\\S]*?)(?=^### |(?![\\s\\S]))`, "m");
    const match = body.match(sectionPattern);
    if (!match || !match[1].trim()) throw new Error(`${fileName} ${id} is missing section: ${section}`);
  }
}

export function parseLedgerEntries({ source, fileName, marker, idField, timestampField, validateMetadata = () => {} }) {
  const entryPattern = new RegExp(`<!-- ${escapeRegExp(marker)} (\\{[^\\r\\n]*\\}) -->`, "g");
  const entries = [];
  for (const match of source.matchAll(entryPattern)) {
    let metadata;
    try {
      metadata = JSON.parse(match[1]);
    } catch (error) {
      throw new Error(`${fileName}: malformed ${marker} metadata: ${error.message}`);
    }
    const id = normalizedId(metadata[idField]);
    if (!id) throw new Error(`${fileName}: every ${marker} requires ${idField}.`);
    metadata[idField] = id;
    if (!validInstant(metadata[timestampField])) throw new Error(`${id} has an invalid UTC ${timestampField}.`);
    const bodyStart = match.index + match[0].length;
    const nextEntry = /^## (?!#)/gm;
    nextEntry.lastIndex = bodyStart;
    const nextMatch = nextEntry.exec(source);
    const body = source.slice(bodyStart, nextMatch?.index);
    validateMetadata(metadata);
    entries.push({ metadata, body });
  }
  return entries;
}

function assertUniqueGovernanceIds({ reviewEvents, implementationEvents, suggestions, decisions, approvals }) {
  const ids = [
    ...reviewEvents.map(({ metadata }) => metadata.eventId),
    ...implementationEvents.map(({ metadata }) => metadata.eventId),
    ...suggestions.map(({ metadata }) => metadata.suggestionId),
    ...decisions.map(({ metadata }) => metadata.receiptId),
    ...approvals.map(({ metadata }) => metadata.approvalId)
  ];
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
  if (duplicate) throw new Error(`Duplicate therapy governance ID: ${duplicate}`);
}

export async function loadTherapyGovernance({ rootDir = root } = {}) {
  const [historySource, suggestionsSource, decisionsSource, approvalsSource, agentsSource] = await Promise.all([
    readRequiredFile(rootDir, LEDGER_FILES.history),
    readRequiredFile(rootDir, LEDGER_FILES.suggestions),
    readRequiredFile(rootDir, LEDGER_FILES.decisions),
    readRequiredFile(rootDir, LEDGER_FILES.approvals),
    readRequiredFile(rootDir, "AGENTS.md")
  ]);
  for (const [fileName, source] of [
    [LEDGER_FILES.history, historySource],
    [LEDGER_FILES.suggestions, suggestionsSource],
    [LEDGER_FILES.decisions, decisionsSource],
    [LEDGER_FILES.approvals, approvalsSource],
    ["AGENTS.md", agentsSource]
  ]) scanGovernanceMarkers({ source, fileName });
  const historyLessons = parseLedgerEntries({
    source: historySource,
    fileName: LEDGER_FILES.history,
    marker: "therapy-lesson",
    idField: "lessonId",
    timestampField: "learnedAt",
    validateMetadata: (entry) => {
      if (!ACTIVATIONS.has(entry.activation)) throw new Error(`Therapy lesson ${entry.lessonId} has an invalid activation state.`);
    }
  });
  const reviewEvents = parseLedgerEntries({
    source: historySource,
    fileName: LEDGER_FILES.history,
    marker: "therapy-review-event",
    idField: "eventId",
    timestampField: "occurredAt",
    validateMetadata: (entry) => assertIdArrays(entry, entry.eventId, ["findingIds", "packetLevelFindingIds"])
  });
  const implementationEvents = parseLedgerEntries({
    source: historySource,
    fileName: LEDGER_FILES.history,
    marker: "therapy-implementation-event",
    idField: "eventId",
    timestampField: "occurredAt",
    validateMetadata: (entry) => {
      for (const field of ["suggestionId", "decisionReceiptId", "approvalId", "implementationCommit"]) assertScalarId(entry, field, entry.eventId);
      assertIdArray({ entry, field: "implementationPaths", id: entry.eventId });
      if (entry.implementationPaths.length === 0) throw new Error(`${entry.eventId} must declare at least one implementation path.`);
      if (!Array.isArray(entry.regressionResults)) throw new Error(`${entry.eventId} has invalid regressionResults.`);
    }
  });
  const suggestions = parseLedgerEntries({
    source: suggestionsSource,
    fileName: LEDGER_FILES.suggestions,
    marker: "therapy-suggestion",
    idField: "suggestionId",
    timestampField: "createdAt",
    validateMetadata: (entry) => {
      assertIdArrays(entry, entry.suggestionId, ["reviewFindingIds", "guideIds", "graphNodeIds", "promptContractIds", "policySafetyGateIds", "regressionIds"]);
      assertScalarId(entry, "packetId", entry.suggestionId);
      assertScalarId(entry, "decisionId", entry.suggestionId);
      if (!SHA256_PATTERN.test(entry.packetDigest)) throw new Error(`${entry.suggestionId} has an invalid packetDigest.`);
      if (!SHA256_PATTERN.test(entry.decisionCardDigest)) throw new Error(`${entry.suggestionId} has an invalid decisionCardDigest.`);
      assertNoForbiddenFields(entry, entry.suggestionId, ["approvalId", "receiptId", "decisionReceiptId", "decisionSource", "eventId", "lessonId"]);
      if (!SUGGESTION_STATUSES.has(entry.status)) throw new Error(`${entry.suggestionId} has an invalid status.`);
    }
  });
  const decisions = parseLedgerEntries({
    source: decisionsSource,
    fileName: LEDGER_FILES.decisions,
    marker: "therapy-decision",
    idField: "receiptId",
    timestampField: "decidedAt",
    validateMetadata: (entry) => {
      assertOnlyFields(entry, entry.receiptId, DECISION_RECEIPT_FIELDS);
      assertIdArrays(entry, entry.receiptId, ["guideIds", "graphNodeIds", "promptContractIds", "policySafetyGateIds", "regressionIds"]);
      for (const field of ["suggestionId", "packetId", "decisionId", "reviewEventId"]) assertScalarId(entry, field, entry.receiptId);
      for (const field of ["packetDigest", "decisionCardDigest", "reviewArtifactSha256"]) {
        if (!SHA256_PATTERN.test(entry[field])) throw new Error(`${entry.receiptId} has an invalid ${field}.`);
      }
      assertScalarId(entry, "reviewArtifactPath", entry.receiptId);
      assertNoForbiddenFields(entry, entry.receiptId, ["approvalId", "eventId", "lessonId", "origin", "modelOrigin"]);
      if (!DECISION_CHOICES.has(entry.choice)) throw new Error(`${entry.receiptId} has an invalid choice.`);
    }
  });
  const approvals = parseLedgerEntries({
    source: approvalsSource,
    fileName: LEDGER_FILES.approvals,
    marker: "therapy-approval",
    idField: "approvalId",
    timestampField: "decidedAt",
    validateMetadata: (entry) => {
      assertIdArrays(entry, entry.approvalId, ["guideIds", "graphNodeIds", "promptContractIds", "policySafetyGateIds", "regressionIds"]);
      for (const field of ["suggestionId", "decisionReceiptId"]) assertScalarId(entry, field, entry.approvalId);
      assertNoForbiddenFields(entry, entry.approvalId, ["receiptId", "decisionSource", "origin", "modelOrigin", "eventId", "lessonId"]);
      if (!APPROVAL_STATUSES.has(entry.implementationStatus)) throw new Error(`${entry.approvalId} has an invalid implementationStatus.`);
    }
  });

  for (const entry of reviewEvents) {
    assertRequiredSections({ fileName: LEDGER_FILES.history, id: entry.metadata.eventId, body: entry.body, sections: REVIEW_SECTIONS });
  }
  for (const entry of implementationEvents) {
    assertRequiredSections({ fileName: LEDGER_FILES.history, id: entry.metadata.eventId, body: entry.body, sections: IMPLEMENTATION_SECTIONS });
  }
  for (const entry of suggestions) {
    assertRequiredSections({ fileName: LEDGER_FILES.suggestions, id: entry.metadata.suggestionId, body: entry.body, sections: SUGGESTION_SECTIONS });
  }
  for (const entry of decisions) {
    assertRequiredSections({ fileName: LEDGER_FILES.decisions, id: entry.metadata.receiptId, body: entry.body, sections: DECISION_SECTIONS });
  }
  for (const entry of approvals) {
    assertRequiredSections({ fileName: LEDGER_FILES.approvals, id: entry.metadata.approvalId, body: entry.body, sections: APPROVAL_SECTIONS });
  }
  assertUniqueGovernanceIds({ reviewEvents, implementationEvents, suggestions, decisions, approvals });
  const protocolMatches = [...agentsSource.matchAll(/<!-- therapy-owner-decision-protocol (\{[^\r\n]*\}) -->/g)];
  if (!protocolMatches.length) throw new Error("AGENTS.md is missing therapy-owner-decision-protocol-v2.");
  if (protocolMatches.length !== 1) {
    throw new Error(`AGENTS.md must contain exactly one therapy-owner-decision-protocol contract; found ${protocolMatches.length}.`);
  }
  const protocolMatch = protocolMatches[0];
  let protocol;
  try {
    protocol = JSON.parse(protocolMatch[1]);
  } catch (error) {
    throw new Error(`AGENTS.md has malformed therapy-owner-decision-protocol metadata: ${error.message}`);
  }
  if (protocol.schemaVersion !== 2 || !Array.isArray(protocol.rules) || !sameStringSet(protocol.rules, OWNER_PROTOCOL_RULES)) {
    throw new Error("AGENTS.md therapy-owner-decision-protocol-v2 does not contain the complete required rule set.");
  }
  return { historyLessons, reviewEvents, implementationEvents, suggestions, decisions, approvals };
}

function sameObject(value, other) {
  return canonicalJson(value) === canonicalJson(other);
}

async function packetArchive(candidateRoot) {
  const archives = (await fs.readdir(candidateRoot)).filter((name) => name.endsWith(".zip"));
  if (archives.length !== 1) throw new Error(`${candidateRoot} must contain exactly one packet archive.`);
  return fs.readFile(path.join(candidateRoot, archives[0]));
}

function requiredPacketEntry(entries, candidateRoot, entryPath) {
  const data = entries.get(entryPath);
  if (!data) throw new Error(`${candidateRoot} packet archive is missing ${entryPath}.`);
  return data;
}

async function loadCandidatePackets(rootDir) {
  const fixturesRoot = path.join(rootDir, "guide-packets", "fixtures");
  const packets = [];
  for (const name of await fs.readdir(fixturesRoot)) {
    const candidateRoot = path.join(fixturesRoot, name);
    let archive;
    try { archive = await packetArchive(candidateRoot); }
    catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    const entries = readZipEntries(archive);
    const manifestSource = requiredPacketEntry(entries, candidateRoot, "manifest.json").toString("utf8");
    const manifest = JSON.parse(manifestSource);
    if (manifest.status !== "candidate" || !Number.isSafeInteger(manifest.packetRevision)) continue;
    const decisionsSource = requiredPacketEntry(entries, candidateRoot, manifest.paths.ownerDecisions).toString("utf8");
    const decisionDocument = JSON.parse(decisionsSource);
    const cards = decisionDocument.cards.filter((card) => card.classification === "substantive" && card.requiresHumanDecision === true);
    packets.push({
      manifest,
      manifestSha256: sha256(manifestSource),
      decisionCardsSha256: sha256(decisionsSource),
      cards,
      cardsById: new Map(cards.map((card) => [card.id, card])),
      entries,
      candidateRoot,
      packetDigest: sha256(archive)
    });
  }
  packets.sort((a, b) => b.manifest.packetRevision - a.manifest.packetRevision);
  if (!packets.length) throw new Error("No bundled Guide Packet candidate was found.");
  const ids = packets.map(({ manifest }) => manifest.packetId);
  const duplicateId = ids.find((id, index) => ids.indexOf(id) !== index);
  if (duplicateId) throw new Error(`Multiple Guide Packet candidates use packet ID ${duplicateId}.`);
  if (packets[1]?.manifest.packetRevision === packets[0].manifest.packetRevision) {
    throw new Error(`Multiple Guide Packet candidates use revision ${packets[0].manifest.packetRevision}.`);
  }
  return packets;
}

export async function loadPolicyDecisionPackages({ rootDir = root } = {}) {
  const packagesRoot = path.join(rootDir, POLICY_DECISION_PACKAGE_DIR);
  let names;
  try {
    names = (await fs.readdir(packagesRoot)).filter((name) => name.endsWith(".json")).sort();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const packages = [];
  for (const name of names) {
    const relativePath = path.posix.join(POLICY_DECISION_PACKAGE_DIR, name);
    const source = await fs.readFile(path.join(packagesRoot, name), "utf8");
    let document;
    try {
      document = JSON.parse(source);
    } catch (error) {
      throw new Error(`${relativePath} has malformed JSON: ${error.message}`);
    }
    if (document.contractVersion !== POLICY_DECISION_PACKAGE_CONTRACT) {
      throw new Error(`${relativePath} has an unsupported policy-decision package contract.`);
    }
    assertScalarId(document, "packetId", relativePath);
    if (!Number.isSafeInteger(document.packetRevision) || document.packetRevision < 1) {
      throw new Error(`${document.packetId} has an invalid packetRevision.`);
    }
    if (!validInstant(document.createdAt)) throw new Error(`${document.packetId} has an invalid UTC createdAt.`);
    assertAffectedScope({ scope: document.identifierCatalog, id: `${document.packetId} identifierCatalog` });
    if (!Array.isArray(document.cards) || document.cards.length === 0) {
      throw new Error(`${document.packetId} must contain at least one decision card.`);
    }
    const cardIds = [];
    for (const card of document.cards) {
      assertScalarId(card, "id", document.packetId);
      cardIds.push(card.id);
      if (card.classification !== "substantive" || card.requiresHumanDecision !== true) {
        throw new Error(`${document.packetId} decision ${card.id} must be a substantive human decision.`);
      }
      for (const field of ["title", "behavioralEffect", "provenance", "current", "candidate", "worstPlausibleFailure"]) {
        assertScalarId(card, field, `${document.packetId} decision ${card.id}`);
      }
      assertAffectedScope({ scope: card.affectedIds, id: `${document.packetId} decision ${card.id}` });
      if (!scopeIsSubset(card.affectedIds, document.identifierCatalog)) {
        throw new Error(`${document.packetId} decision ${card.id} affected IDs exceed its identifierCatalog.`);
      }
      if (!sameStringSet(card.affectedRegressions ?? [], card.affectedIds.regressionIds)) {
        throw new Error(`${document.packetId} decision ${card.id} affectedRegressions must match its affected IDs.`);
      }
    }
    const duplicateCardId = cardIds.find((id, index) => cardIds.indexOf(id) !== index);
    if (duplicateCardId) throw new Error(`${document.packetId} has duplicate decision card ${duplicateCardId}.`);
    const manifest = {
      status: "candidate",
      packetRevision: document.packetRevision,
      packetId: document.packetId,
      createdAt: document.createdAt,
      paths: { ownerDecisions: relativePath }
    };
    const decisionCardsSource = canonicalJson({ cards: document.cards });
    const manifestSource = canonicalJson(manifest);
    packages.push({
      kind: "policy-decision-package",
      manifest,
      manifestSha256: sha256(manifestSource),
      decisionCardsSha256: sha256(decisionCardsSource),
      cards: document.cards,
      cardsById: new Map(document.cards.map((card) => [card.id, card])),
      entries: new Map(),
      candidateRoot: packagesRoot,
      packetDigest: sha256(source),
      authority: document.identifierCatalog,
      sourcePath: relativePath
    });
  }
  const packetIds = packages.map(({ manifest }) => manifest.packetId);
  const duplicatePacketId = packetIds.find((id, index) => packetIds.indexOf(id) !== index);
  if (duplicatePacketId) throw new Error(`Multiple policy-decision packages use packet ID ${duplicatePacketId}.`);
  const revisions = packages.map(({ manifest }) => manifest.packetRevision);
  const duplicateRevision = revisions.find((revision, index) => revisions.indexOf(revision) !== index);
  if (duplicateRevision) throw new Error(`Multiple policy-decision packages use revision ${duplicateRevision}.`);
  return packages.sort((left, right) => right.manifest.packetRevision - left.manifest.packetRevision);
}

async function loadReviewArtifact({ rootDir, reviewEvent, packet }) {
  const metadata = reviewEvent.metadata;
  const artifactPath = normalizedId(metadata.reviewArtifactPath);
  if (!artifactPath || path.isAbsolute(artifactPath) || !artifactPath.startsWith("docs/diagnostics/")) {
    throw new Error(`${metadata.eventId} has an invalid reviewArtifactPath.`);
  }
  const resolved = path.resolve(rootDir, artifactPath);
  const diagnosticsRoot = `${path.resolve(rootDir, "docs", "diagnostics")}${path.sep}`;
  if (!resolved.startsWith(diagnosticsRoot)) throw new Error(`${metadata.eventId} reviewArtifactPath escapes docs/diagnostics.`);
  const source = await readRequiredFile(rootDir, artifactPath);
  if (!SHA256_PATTERN.test(metadata.reviewArtifactSha256) || sha256(source) !== metadata.reviewArtifactSha256) {
    throw new Error(`${metadata.eventId} review artifact checksum mismatch.`);
  }
  const artifact = JSON.parse(source);
  if (artifact.contractVersion !== "therapy-review-diagnostic-v1") throw new Error(`${metadata.eventId} has an unsupported review artifact contract.`);
  if (artifact.reviewEventId !== metadata.eventId || artifact.packet?.packetId !== metadata.packetId) throw new Error(`${metadata.eventId} review artifact identity mismatch.`);
  if (!validInstant(artifact.occurredAt) || artifact.occurredAt !== metadata.occurredAt) {
    throw new Error(`${metadata.eventId} review artifact occurredAt does not match its event.`);
  }
  if (artifact.packet.packetRevision !== packet.manifest.packetRevision || artifact.packet.decisionCardsPath !== packet.manifest.paths.ownerDecisions) {
    throw new Error(`${metadata.eventId} review artifact packet identity mismatch.`);
  }
  if (!new Set(["rejected-before-owner-gate", "passed-owner-gate"]).has(artifact.outcome)) {
    throw new Error(`${metadata.eventId} review artifact has invalid outcome ${artifact.outcome}.`);
  }
  if (artifact.outcome !== metadata.outcome || artifact.nextPhase !== metadata.nextPhase) throw new Error(`${metadata.eventId} review artifact outcome mismatch.`);
  if (artifact.packet.packetSha256 !== packet.packetDigest || artifact.packet.manifestSha256 !== packet.manifestSha256 || artifact.packet.decisionCardsSha256 !== packet.decisionCardsSha256) {
    throw new Error(`${metadata.eventId} review artifact packet binding mismatch.`);
  }
  if (!sameObject(artifact.mappings?.suggestionFindings, metadata.suggestionFindings)) {
    throw new Error(`${metadata.eventId} suggestion finding mapping does not match its artifact.`);
  }
  if (!sameStringSet(artifact.mappings?.packetLevelFindingIds ?? [], metadata.packetLevelFindingIds)) {
    throw new Error(`${metadata.eventId} packet-level finding mapping does not match its artifact.`);
  }
  const mappedDecisionIds = Object.keys(artifact.mappings?.suggestionFindings ?? {});
  if (!sameStringSet(mappedDecisionIds, packet.cards.map(({ id }) => id))) {
    throw new Error(`${metadata.eventId} review artifact must map exactly the packet's substantive decisions.`);
  }
  const affectedDecisionIds = Object.keys(artifact.decisionAffectedIds ?? {});
  if (!sameStringSet(affectedDecisionIds, packet.cards.map(({ id }) => id))) {
    throw new Error(`${metadata.eventId} decisionAffectedIds must contain exactly the packet's substantive decisions.`);
  }
  for (const decisionId of affectedDecisionIds) {
    const scope = artifact.decisionAffectedIds[decisionId];
    assertAffectedScope({ scope, id: `${metadata.eventId} decision ${decisionId}` });
    await validateScopeIdentifiers({ rootDir, packet, scope, id: `${metadata.eventId} decision ${decisionId}` });
  }
  if (!Array.isArray(artifact.findings)) throw new Error(`${metadata.eventId} has invalid findings.`);
  const findingIds = artifact.findings.map((finding) => normalizedId(finding?.id));
  if (new Set(findingIds).size !== findingIds.length || !sameStringSet(findingIds, metadata.findingIds)) {
    throw new Error(`${metadata.eventId} finding IDs do not match its artifact.`);
  }
  for (const finding of artifact.findings) {
    if (!["blocking", "review", "informational", "positive"].includes(finding.severity)) throw new Error(`${finding.id} has invalid severity.`);
    if (!normalizedId(finding.summary) || !normalizedId(finding.requiredAction) || !normalizedId(finding.disposition?.status) || !normalizedId(finding.disposition?.evidence)) {
      throw new Error(`${finding.id} has invalid disposition metadata.`);
    }
  }
  const affectedFindingIds = Object.keys(artifact.findingAffectedIds ?? {});
  if (!sameStringSet(affectedFindingIds, findingIds)) {
    throw new Error(`${metadata.eventId} findingAffectedIds must contain exactly the artifact finding IDs.`);
  }
  for (const findingId of affectedFindingIds) {
    const scope = artifact.findingAffectedIds[findingId];
    assertAffectedScope({ scope, id: `${metadata.eventId} finding ${findingId}` });
    await validateScopeIdentifiers({ rootDir, packet, scope, id: `${metadata.eventId} finding ${findingId}` });
  }
  const assignments = new Map();
  for (const [decisionId, ids] of Object.entries(artifact.mappings.suggestionFindings)) {
    assertIdArray({ entry: artifact.mappings.suggestionFindings, field: decisionId, id: `${metadata.eventId} suggestionFindings` });
    for (const id of ids) (assignments.get(id) ?? assignments.set(id, []).get(id)).push(`decision:${decisionId}`);
  }
  for (const id of artifact.mappings.packetLevelFindingIds) (assignments.get(id) ?? assignments.set(id, []).get(id)).push("packet");
  if (!sameStringSet([...assignments.keys()], findingIds)) {
    throw new Error(`${metadata.eventId} finding assignments must contain exactly the artifact finding IDs.`);
  }
  for (const [id, values] of assignments) {
    if (values.length > 1 && artifact.mappings.allowMultipleAssignmentsByFinding?.[id] !== true) {
      throw new Error(`Finding ${id} has incompatible duplicate assignments.`);
    }
    for (const assignment of values.filter((value) => value.startsWith("decision:"))) {
      const decisionId = assignment.slice("decision:".length);
      if (!scopeIsSubset(artifact.findingAffectedIds[id], artifact.decisionAffectedIds[decisionId])) {
        throw new Error(`${metadata.eventId} finding ${id} affected scope exceeds ${decisionId}.`);
      }
    }
  }
  const readableOutcome = sectionBody(reviewEvent.body, "Review outcome").match(/^Outcome:\s*(\S+)$/m)?.[1];
  if (readableOutcome !== metadata.outcome) throw new Error(`${metadata.eventId} readable outcome does not match metadata.`);
  if (metadata.outcome === "passed-owner-gate") {
    for (const finding of artifact.findings.filter(({ severity }) => severity === "blocking" || severity === "review")) {
      if (finding.disposition?.status !== "resolved") throw new Error(`${metadata.eventId} reached passed-owner-gate while ${finding.id} is ${finding.disposition?.status ?? "unresolved"}.`);
    }
    if (metadata.nextPhase !== "owner-decisions") throw new Error(`${metadata.eventId} passed-owner-gate must advance to owner-decisions.`);
    if (/\b(reject(?:ed|ion)?|unresolved|repair-r\d+|remains blocked)\b/i.test(reviewEvent.body)) {
      throw new Error(`${metadata.eventId} passed-owner-gate review body retains rejection or repair state.`);
    }
  } else if (!artifact.findings.some((finding) => (finding.severity === "blocking" || finding.severity === "review") && finding.disposition.status === "unresolved")) {
    throw new Error(`${metadata.eventId} rejected-before-owner-gate must retain at least one unresolved blocking or review finding.`);
  }
  return artifact;
}

function sectionBody(body, section) {
  const sectionPattern = new RegExp(`^### ${escapeRegExp(section)}\\r?\\n([\\s\\S]*?)(?=^### |(?![\\s\\S]))`, "m");
  return body.match(sectionPattern)?.[1] ?? "";
}

function scopeMatches(left, right) {
  return AFFECTED_ID_FIELDS.every((field) => sameStringSet(left[field], right[field]));
}

function scopeIsSubset(left, right) {
  return AFFECTED_ID_FIELDS.every((field) => left[field].every((id) => right[field].includes(id)));
}

function assertAffectedScope({ scope, id }) {
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) throw new Error(`${id} has invalid affected IDs.`);
  assertIdArrays(scope, id, AFFECTED_ID_FIELDS);
}

export function validateApprovalLinks({ suggestions, decisions = [], approvals, reviewEvents = [] }) {
  const suggestionsById = new Map(suggestions.map((suggestion) => [suggestion.metadata.suggestionId, suggestion]));
  const decisionsById = new Map(decisions.map((decision) => [decision.metadata.receiptId, decision]));
  const decisionsBySuggestionId = new Map();
  const approvalsBySuggestionId = new Map();

  for (const decision of decisions) {
    const { receiptId, suggestionId } = decision.metadata;
    if (!suggestionsById.has(suggestionId)) throw new Error(`THERAPY-DECISIONS ${receiptId} references missing suggestion ${suggestionId}.`);
    const linked = decisionsBySuggestionId.get(suggestionId) ?? [];
    linked.push(decision);
    decisionsBySuggestionId.set(suggestionId, linked);
  }

  for (const approval of approvals) {
    const { approvalId, suggestionId } = approval.metadata;
    if (!suggestionsById.has(suggestionId)) {
      throw new Error(`APPROVED-THERAPY-LESSONS ${approvalId} references missing suggestion ${suggestionId}.`);
    }
    const linkedApprovals = approvalsBySuggestionId.get(suggestionId) ?? [];
    linkedApprovals.push(approval);
    approvalsBySuggestionId.set(suggestionId, linkedApprovals);
  }

  for (const [suggestionId, linkedApprovals] of approvalsBySuggestionId) {
    if (linkedApprovals.length > 1) {
      throw new Error(`APPROVED-THERAPY-LESSONS has duplicate approvals for suggestion ${suggestionId}.`);
    }
  }

  for (const approval of approvals) {
    const { approvalId, suggestionId, decisionReceiptId, implementationStatus, implementationCommit } = approval.metadata;
    const suggestion = suggestionsById.get(suggestionId);
    const decision = decisionsById.get(decisionReceiptId);
    if (!decision || decision.metadata.suggestionId !== suggestionId) throw new Error(`${approvalId} must link the approving decision receipt for ${suggestionId}.`);
    if (decision.metadata.choice !== "approve") throw new Error(`${decisionReceiptId} decline receipt must not have an approval view.`);
    if (!scopeMatches(approval.metadata, suggestion.metadata)) throw new Error(`${approvalId} affected scope must exactly match ${suggestionId}.`);
    if (approval.metadata.decidedAt !== decision.metadata.decidedAt) throw new Error(`${approvalId} decidedAt must match ${decisionReceiptId}.`);
    if (implementationStatus === "implemented") {
      if (typeof implementationCommit !== "string" || !/^[0-9a-f]{7,40}$/.test(implementationCommit)) {
        throw new Error(`${approvalId} must provide a valid implementationCommit.`);
      }
      const evidence = sectionBody(approval.body, "Verification evidence").trim();
      if (!evidence || /no (implementation )?evidence/i.test(evidence)) {
        throw new Error(`${approvalId} must include substantive implementation verification evidence.`);
      }
    }
  }

  const expectedApprovalStatuses = new Map([
    ["blocked-by-packet-review", null],
    ["needs-technical-repair", null],
    ["ready-for-owner", null],
    ["approved", "approved-not-implemented"],
    ["implemented", "implemented"],
    ["declined", null],
    ["superseded", null]
  ]);
  for (const suggestion of suggestions) {
    const { suggestionId, status } = suggestion.metadata;
    const linkedDecisions = decisionsBySuggestionId.get(suggestionId) ?? [];
    const linkedApproval = approvalsBySuggestionId.get(suggestionId)?.[0];
    const expectedApprovalStatus = expectedApprovalStatuses.get(status);
    if (["blocked-by-packet-review", "needs-technical-repair", "ready-for-owner"].includes(status) && linkedDecisions.length) {
      throw new Error(`${suggestionId} with status ${status} must not have a decision receipt.`);
    }
    if (status === "approved" || status === "implemented") {
      if (linkedDecisions.length !== 1 || linkedDecisions[0].metadata.choice !== "approve") {
        throw new Error(`${suggestionId} with status ${status} requires exactly one approve decision receipt.`);
      }
    }
    if (status === "declined" && (linkedDecisions.length !== 1 || linkedDecisions[0].metadata.choice !== "decline")) {
      throw new Error(`${suggestionId} with status declined requires exactly one decline decision receipt.`);
    }
    if (status === "superseded" && linkedDecisions.length) throw new Error(`superseded ${suggestionId} must not have a decision receipt.`);
    if (expectedApprovalStatus === null && linkedApproval) {
      throw new Error(`SUGGESTED-THERAPY-LESSONS ${suggestionId} with status ${status} must not have an approval.`);
    }
    if (expectedApprovalStatus && !linkedApproval) {
      throw new Error(`SUGGESTED-THERAPY-LESSONS ${suggestionId} with status ${status} requires exactly one approval.`);
    }
    if (expectedApprovalStatus === "implemented" && linkedApproval?.metadata.implementationStatus !== "implemented") {
      throw new Error(`SUGGESTED-THERAPY-LESSONS ${suggestionId} with status implemented requires an implemented approval.`);
    }
    if (expectedApprovalStatus === "approved-not-implemented" && linkedApproval?.metadata.implementationStatus !== expectedApprovalStatus) {
      throw new Error(`SUGGESTED-THERAPY-LESSONS ${suggestionId} with status approved requires an approved-not-implemented approval.`);
    }
  }

  for (const decision of decisions) {
    const metadata = decision.metadata;
    const suggestion = suggestionsById.get(metadata.suggestionId);
    if (metadata.decisionSource !== "direct-user-conversation") throw new Error(`${metadata.receiptId} must use decisionSource direct-user-conversation.`);
    if (metadata.packetId !== suggestion.metadata.packetId || metadata.packetDigest !== suggestion.metadata.packetDigest) {
      throw new Error(`${metadata.receiptId} packet binding does not match ${metadata.suggestionId}.`);
    }
    if (metadata.decisionId !== suggestion.metadata.decisionId || metadata.decisionCardDigest !== suggestion.metadata.decisionCardDigest) {
      throw new Error(`${metadata.receiptId} decision-card binding does not match ${metadata.suggestionId}.`);
    }
    const review = reviewEvents.find(({ metadata: event }) => event.eventId === metadata.reviewEventId && event.packetId === metadata.packetId);
    if (!review || review.metadata.outcome !== "passed-owner-gate" || review.metadata.reviewArtifactPath !== metadata.reviewArtifactPath || review.metadata.reviewArtifactSha256 !== metadata.reviewArtifactSha256) {
      throw new Error(`${metadata.receiptId} review binding does not match the passed review.`);
    }
    if (new Date(metadata.decidedAt) < new Date(review.metadata.occurredAt)) throw new Error(`${metadata.receiptId} must follow its passed review.`);
    if (new Date(metadata.decidedAt) < new Date(suggestion.metadata.createdAt)) throw new Error(`${metadata.receiptId} must follow suggestion creation.`);
    if (!scopeMatches(metadata, suggestion.metadata)) throw new Error(`${metadata.receiptId} affected scope must exactly match ${metadata.suggestionId}.`);
  }
}

function assertRegressionResults({ approvalId, regressionIds, regressionResults }) {
  if (!Array.isArray(regressionResults)) throw new Error(`${approvalId} has invalid regressionResults.`);
  for (const regressionId of regressionIds) {
    const matches = regressionResults.filter((result) => normalizedId(result?.regressionId) === regressionId);
    if (matches.length !== 1) throw new Error(`${approvalId} must record exactly one PASS result for ${regressionId}.`);
    if (matches[0].status !== "PASS" || !normalizedId(matches[0].evidence)) throw new Error(`${approvalId} regression ${regressionId} must be PASS with evidence.`);
  }
  if (regressionResults.length !== regressionIds.length) throw new Error(`${approvalId} regressionResults must exactly match affected regressions.`);
}

async function validateImplementationEvidence({ rootDir, suggestions, decisions, approvals, implementationEvents }) {
  const decisionsById = new Map(decisions.map((entry) => [entry.metadata.receiptId, entry]));
  const suggestionsById = new Map(suggestions.map((entry) => [entry.metadata.suggestionId, entry]));
  const implementedApprovalsById = new Map(approvals.filter(({ metadata }) => metadata.implementationStatus === "implemented").map((entry) => [entry.metadata.approvalId, entry]));
  for (const { metadata: event } of implementationEvents) {
    const approval = implementedApprovalsById.get(event.approvalId);
    if (!approval || approval.metadata.suggestionId !== event.suggestionId || approval.metadata.decisionReceiptId !== event.decisionReceiptId) {
      throw new Error(`${event.eventId} does not link an implemented approval.`);
    }
  }
  for (const approval of approvals.filter(({ metadata }) => metadata.implementationStatus === "implemented")) {
    const metadata = approval.metadata;
    if (!/^[0-9a-f]{40}$/.test(metadata.implementationCommit ?? "")) {
      if (/^[0-9a-f]{7,39}$/.test(metadata.implementationCommit ?? "")) throw new Error(`${metadata.approvalId} implementationCommit must be a full 40-character commit ID.`);
      throw new Error(`${metadata.approvalId} implementationCommit is not an unambiguous reachable commit.`);
    }
    try {
      await execFileAsync("git", ["cat-file", "-e", `${metadata.implementationCommit}^{commit}`], { cwd: rootDir });
      await execFileAsync("git", ["merge-base", "--is-ancestor", metadata.implementationCommit, "HEAD"], { cwd: rootDir });
    } catch {
      throw new Error(`${metadata.approvalId} implementationCommit is not an unambiguous reachable commit.`);
    }
    const decision = decisionsById.get(metadata.decisionReceiptId);
    const suggestion = suggestionsById.get(metadata.suggestionId);
    const commitTime = (await execFileAsync("git", ["show", "-s", "--format=%cI", metadata.implementationCommit], { cwd: rootDir })).stdout.trim();
    if (new Date(commitTime) < new Date(decision.metadata.decidedAt)) throw new Error(`${metadata.approvalId} implementation commit must follow its owner decision.`);
    assertIdArray({ entry: metadata, field: "implementationPaths", id: metadata.approvalId });
    if (metadata.implementationPaths.length === 0) throw new Error(`${metadata.approvalId} must declare at least one implementation path.`);
    const changedPaths = new Set((await execFileAsync("git", ["diff-tree", "--root", "--no-commit-id", "--name-only", "-r", metadata.implementationCommit], { cwd: rootDir })).stdout.trim().split(/\r?\n/).filter(Boolean));
    for (const implementationPath of metadata.implementationPaths) {
      if (path.isAbsolute(implementationPath) || implementationPath.includes("..")) throw new Error(`${metadata.approvalId} has invalid implementation path ${implementationPath}.`);
      if (!changedPaths.has(implementationPath)) throw new Error(`${metadata.approvalId} implementation path ${implementationPath} is absent from the commit diff.`);
    }
    if (!sameStringSet(metadata.implementationPaths, [...changedPaths])) {
      throw new Error(`${metadata.approvalId} implementationPaths must exactly match the commit diff.`);
    }
    assertRegressionResults({ approvalId: metadata.approvalId, regressionIds: suggestion.metadata.regressionIds, regressionResults: metadata.regressionResults });
    const events = implementationEvents.filter(({ metadata: event }) => event.approvalId === metadata.approvalId);
    if (events.length !== 1) throw new Error(`${metadata.approvalId} requires exactly one implementation history event; found ${events.length}.`);
    const event = events[0].metadata;
    if (event.suggestionId !== metadata.suggestionId || event.decisionReceiptId !== metadata.decisionReceiptId || event.implementationCommit !== metadata.implementationCommit || !sameStringSet(event.implementationPaths, metadata.implementationPaths) || !sameObject(event.regressionResults, metadata.regressionResults)) {
      throw new Error(`${metadata.approvalId} implementation history event does not match approval evidence.`);
    }
    if (new Date(event.occurredAt) < new Date(commitTime)) throw new Error(`${event.eventId} must follow the implementation commit.`);
  }
}

function assertDecisionBriefElement({ suggestion, source, label, context = "" }) {
  const match = source.match(new RegExp(`^[\\t ]*${escapeRegExp(label)}[\\t ]*([^\\r\\n]*)$`, "m"));
  if (!match) {
    throw new Error(`${suggestion.metadata.suggestionId} is missing decision-brief element: ${label}`);
  }
  if (!match[1].trim()) {
    throw new Error(`${suggestion.metadata.suggestionId}${context} has empty decision-brief element: ${label}`);
  }
}

function assertOptionTradeOffs({ suggestion, body }) {
  const options = new Map(
    [...sectionBody(body, "Options and trade-offs").matchAll(/^Option\s+([^\s—:-]+)\s*[—:-]\s*([\s\S]*?)(?=^Option\s+|(?![\s\S]))/gm)]
      .map((match) => [match[1], match[2]])
  );
  if (options.size < 2) {
    throw new Error(`${suggestion.metadata.suggestionId} is missing decision-brief element: two option labels`);
  }
  const labels = ["Benefits:", "Costs:", "Worst plausible failure:"];
  for (const option of ["A", "B"]) {
    const optionBody = options.get(option);
    if (!optionBody) {
      throw new Error(`${suggestion.metadata.suggestionId} is missing decision-brief element: Option ${option}`);
    }
    for (const label of labels) {
      assertDecisionBriefElement({
        suggestion,
        source: optionBody,
        label,
        context: ` Option ${option}`
      });
    }
  }
}

function decisionBriefValue({ suggestion, source, label, context = "" }) {
  const match = source.match(new RegExp(`^[\\t ]*${escapeRegExp(label)}[\\t ]*([^\\r\\n]*)$`, "m"));
  if (!match || !match[1].trim()) {
    throw new Error(`${suggestion.metadata.suggestionId}${context} is missing decision-card field: ${label}`);
  }
  return match[1].trim();
}

function assertDecisionCardFidelity({ suggestion, card }) {
  const proposal = sectionBody(suggestion.body, "Proposal");
  for (const { label, expected } of [
    { label: "Decision-card title:", expected: card.title },
    { label: "Behavioral effect:", expected: card.behavioralEffect },
    { label: "Provenance:", expected: card.provenance },
    { label: "Current behavior:", expected: card.current },
    { label: "Candidate behavior:", expected: card.candidate }
  ]) {
    const actual = decisionBriefValue({ suggestion, source: proposal, label });
    if (actual !== expected) {
      throw new Error(`${suggestion.metadata.suggestionId} ${label.slice(0, -1)} does not match ${card.id}.`);
    }
  }

  const optionAMatch = sectionBody(suggestion.body, "Options and trade-offs")
    .match(/^Option\s+A\s*[—:-]\s*([\s\S]*?)(?=^Option\s+|(?![\s\S]))/m);
  const actualWorstFailure = decisionBriefValue({
    suggestion,
    source: optionAMatch?.[1] ?? "",
    label: "Worst plausible failure:",
    context: " Option A"
  });
  if (actualWorstFailure !== card.worstPlausibleFailure) {
    throw new Error(`${suggestion.metadata.suggestionId} Option A worst plausible failure does not match ${card.id}.`);
  }
}

function allGraphNodeIds(graph) {
  return new Set(Array.isArray(graph?.nodes) ? graph.nodes.map(({ id }) => id) : []);
}

async function authoritativeIdentifiers({ rootDir, packet }) {
  if (packet.kind === "policy-decision-package") {
    return {
      guides: new Set(packet.authority.guideIds),
      graphNodes: new Set(packet.authority.graphNodeIds),
      promptContractIds: new Set(packet.authority.promptContractIds),
      policySafetyGateIds: new Set(packet.authority.policySafetyGateIds),
      regressionIds: new Set(packet.authority.regressionIds)
    };
  }
  const guides = new Set(packet.manifest.guides?.map(({ id }) => id) ?? []);
  const graphNodes = new Set();
  for (const guide of packet.manifest.guides ?? []) {
    const graph = JSON.parse(requiredPacketEntry(packet.entries, packet.candidateRoot, guide.graphPath).toString("utf8"));
    for (const id of allGraphNodeIds(graph)) graphNodes.add(id);
  }
  const promptContractIds = new Set();
  const srcRoot = path.join(rootDir, "src");
  for (const relative of ["orchestrator/run-pipeline.mjs", "orchestrator/run-tiered-pipeline.mjs", "server/create-server.mjs", "hypnosis/app-owned-copy.mjs"]) {
    try {
      const source = await fs.readFile(path.join(srcRoot, relative), "utf8");
      for (const match of source.matchAll(/(?:response-realization|hypnosis-components)-v\d+/g)) promptContractIds.add(match[0]);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  const policySafetyGateIds = new Set(packet.manifest.externalSources?.map(({ id }) => id) ?? []);
  if (packet.manifest.paths.ownerAmendments) {
    const amendments = JSON.parse(requiredPacketEntry(packet.entries, packet.candidateRoot, packet.manifest.paths.ownerAmendments).toString("utf8"));
    for (const item of amendments.items ?? []) policySafetyGateIds.add(item.id);
  }
  const regressionIds = new Set();
  for (const [name, data] of packet.entries) {
    if (!name.startsWith("tests/decision-cases/") || !name.endsWith(".json")) continue;
    regressionIds.add(JSON.parse(data.toString("utf8")).id);
  }
  return { guides, graphNodes, promptContractIds, policySafetyGateIds, regressionIds };
}

async function validateAffectedIdentifiers({ rootDir, packet, suggestion }) {
  await validateScopeIdentifiers({
    rootDir,
    packet,
    scope: suggestion.metadata,
    id: suggestion.metadata.suggestionId
  });
}

async function validateScopeIdentifiers({ rootDir, packet, scope, id }) {
  const authoritative = await authoritativeIdentifiers({ rootDir, packet });
  const mappings = [
    ["guideIds", authoritative.guides, "guide"],
    ["graphNodeIds", authoritative.graphNodes, "graph node"],
    ["promptContractIds", authoritative.promptContractIds, "prompt-contract"],
    ["policySafetyGateIds", authoritative.policySafetyGateIds, "policy or safety-gate"],
    ["regressionIds", authoritative.regressionIds, "regression"]
  ];
  for (const [field, known, label] of mappings) {
    for (const value of scope[field]) {
      if (!known.has(value)) throw new Error(`${id} names unknown ${label} identifier ${value}.`);
    }
  }
}

function validateCandidateHistory({ historyLessons, suggestions }) {
  for (const { metadata } of historyLessons) {
    const hasDecisionIdentity = Object.hasOwn(metadata, "packetId") || Object.hasOwn(metadata, "decisionId");
    if (metadata.activation === "active-runtime" && hasDecisionIdentity) {
      throw new Error(`${metadata.lessonId} cannot activate candidate decision history.`);
    }
    if (metadata.activation === "candidate-awaiting-owner" && (!normalizedId(metadata.packetId) || !normalizedId(metadata.decisionId))) {
      throw new Error(`${metadata.lessonId} has incomplete candidate decision identity.`);
    }
    if (metadata.activation === "candidate-awaiting-owner") {
      const sameIdentity = suggestions.filter((suggestion) => suggestion.metadata.packetId === metadata.packetId && suggestion.metadata.decisionId === metadata.decisionId);
      if (sameIdentity.length !== 1) throw new Error(`${metadata.lessonId} requires exactly one retained suggestion; found ${sameIdentity.length}.`);
    }
  }
  for (const suggestion of suggestions) {
    const { suggestionId, packetId, decisionId } = suggestion.metadata;
    const sameIdentity = historyLessons.filter(({ metadata }) => metadata.packetId === packetId && metadata.decisionId === decisionId);
    if (sameIdentity.length !== 1) throw new Error(`${suggestionId} requires exactly one candidate history entry; found ${sameIdentity.length}.`);
    if (sameIdentity[0].metadata.activation !== "candidate-awaiting-owner") {
      throw new Error(`${sameIdentity[0].metadata.lessonId} must remain candidate-awaiting-owner.`);
    }
  }
}

function sameStringSet(left, right) {
  return left.length === right.length && left.every((value) => right.includes(value));
}

export function validateLatestPacket({ manifest, cards, reviewEvents, suggestions }) {
  const packetReviewEvents = reviewEvents.filter((entry) => entry.metadata.packetId === manifest.packetId);
  if (packetReviewEvents.length !== 1) {
    throw new Error(`Expected exactly one review event for ${manifest.packetId}; found ${packetReviewEvents.length}.`);
  }
  const reviewEvent = packetReviewEvents[0];
  const outcome = reviewEvent.metadata.outcome;
  if (outcome !== "rejected-before-owner-gate" && outcome !== "passed-owner-gate") {
    throw new Error(`${reviewEvent.metadata.eventId} review event has invalid outcome: ${outcome}`);
  }

  const knownDecisionIds = new Set(cards.map((card) => card.id));
  const packetSuggestions = suggestions.filter((entry) => entry.metadata.packetId === manifest.packetId);
  for (const suggestion of packetSuggestions) {
    if (!knownDecisionIds.has(suggestion.metadata.decisionId)) {
      throw new Error(`Unknown latest-packet therapy decision: ${suggestion.metadata.decisionId}`);
    }
  }

  const suggestionsByDecision = new Map();
  for (const card of cards) {
    const sameDecision = suggestions.filter((entry) => entry.metadata.decisionId === card.id);
    const matches = sameDecision.filter((entry) => entry.metadata.packetId === manifest.packetId);
    if (matches.length === 0 && sameDecision.length === 1) {
      throw new Error(`${card.id} names the wrong Guide Packet.`);
    }
    if (matches.length !== 1) {
      throw new Error(`Expected exactly one suggestion for ${card.id}; found ${matches.length}.`);
    }
    const suggestion = matches[0];
    const metadata = suggestion.metadata;
    suggestionsByDecision.set(card.id, suggestion);

    if (metadata.ownerDecisionRequired !== true) {
      throw new Error(`${metadata.suggestionId} must require an owner decision.`);
    }
    const blockedStatuses = new Set(["blocked-by-packet-review", "needs-technical-repair"]);
    if (outcome === "rejected-before-owner-gate" && !blockedStatuses.has(metadata.status)) {
      throw new Error(`${metadata.suggestionId} has invalid status for a rejected packet: ${metadata.status}`);
    }
    if (outcome === "passed-owner-gate" && blockedStatuses.has(metadata.status)) {
      throw new Error(`${metadata.suggestionId} has invalid status for a passed packet: ${metadata.status}`);
    }
    if (new Date(metadata.createdAt) < new Date(manifest.createdAt)) {
      throw new Error(`${metadata.suggestionId} predates its Guide Packet.`);
    }
    const affectedRegressions = card.affectedRegressions ?? [];
    for (const regressionId of affectedRegressions) {
      if (!metadata.regressionIds.includes(regressionId)) {
        throw new Error(`${metadata.suggestionId} is missing affected regression: ${regressionId}`);
      }
    }
    if (!sameStringSet(metadata.regressionIds, affectedRegressions)) {
      throw new Error(`${metadata.suggestionId} regressionIds must exactly match ${card.id} affectedRegressions.`);
    }
    if (![...metadata.guideIds, ...metadata.graphNodeIds, ...metadata.promptContractIds, ...metadata.policySafetyGateIds].length) {
      throw new Error(`${metadata.suggestionId} has no stable affected identifier.`);
    }

    const evidence = sectionBody(suggestion.body, "Evidence and uncertainty");
    assertDecisionBriefElement({ suggestion, source: evidence, label: "Source status:" });
    assertDecisionBriefElement({ suggestion, source: evidence, label: "Limitation:" });
    assertOptionTradeOffs({ suggestion, body: suggestion.body });
    const recommendation = sectionBody(suggestion.body, "Recommendation and reasoning");
    assertDecisionBriefElement({ suggestion, source: recommendation, label: "Recommendation:" });
    assertDecisionBriefElement({ suggestion, source: recommendation, label: "Reasoning:" });
    assertDecisionCardFidelity({ suggestion, card });
  }

  const mappedFindingIds = new Set(reviewEvent.metadata.packetLevelFindingIds);
  for (const suggestion of suggestionsByDecision.values()) {
    for (const findingId of suggestion.metadata.reviewFindingIds) mappedFindingIds.add(findingId);
  }
  for (const findingId of reviewEvent.metadata.findingIds) {
    if (!mappedFindingIds.has(findingId)) {
      throw new Error(`Review finding ${findingId} is not mapped to a suggestion or packet-level remediation.`);
    }
  }
  const reviewFindingIds = new Set(reviewEvent.metadata.findingIds);
  for (const suggestion of suggestionsByDecision.values()) {
    for (const findingId of suggestion.metadata.reviewFindingIds) {
      if (!reviewFindingIds.has(findingId)) {
        throw new Error(`Suggestion finding ${findingId} is absent from the latest review event.`);
      }
    }
  }
  for (const findingId of reviewEvent.metadata.packetLevelFindingIds) {
    if (!reviewFindingIds.has(findingId)) {
      throw new Error(`Packet-level finding ${findingId} is absent from the latest review event.`);
    }
  }

  const suggestionFindings = reviewEvent.metadata.suggestionFindings;
  const suggestionFindingDecisionIds = suggestionFindings && !Array.isArray(suggestionFindings)
    ? Object.keys(suggestionFindings)
    : [];
  const missingDecisionId = cards.find(({ id }) => !suggestionFindingDecisionIds.includes(id))?.id;
  const extraDecisionId = suggestionFindingDecisionIds.find((id) => !knownDecisionIds.has(id));
  if (missingDecisionId || extraDecisionId || suggestionFindingDecisionIds.length !== cards.length) {
    const detail = missingDecisionId ? `missing ${missingDecisionId}` : `extra ${extraDecisionId}`;
    throw new Error(`${reviewEvent.metadata.eventId} suggestionFindings must contain exactly the latest decision IDs; ${detail}.`);
  }
  for (const card of cards) {
    assertIdArray({
      entry: suggestionFindings,
      field: card.id,
      id: `${reviewEvent.metadata.eventId} suggestionFindings`
    });
    const suggestion = suggestionsByDecision.get(card.id);
    if (!sameStringSet(suggestionFindings[card.id], suggestion.metadata.reviewFindingIds)) {
      throw new Error(`${reviewEvent.metadata.eventId} suggestionFindings for ${card.id} does not match ${suggestion.metadata.suggestionId} reviewFindingIds.`);
    }
  }

  return { reviewEvent, suggestionsByDecision };
}

export async function verifyTherapyGovernance({ rootDir = root } = {}) {
  const governance = await loadTherapyGovernance({ rootDir });
  const guidePackets = await loadCandidatePackets(rootDir);
  const policyDecisionPackages = await loadPolicyDecisionPackages({ rootDir });
  const packets = [...guidePackets, ...policyDecisionPackages];
  const packetsById = new Map(packets.map((packet) => [packet.manifest.packetId, packet]));
  if (packetsById.size !== packets.length) throw new Error("Guide and policy-decision packages must use distinct packet IDs.");
  const reviewsByPacket = new Map();
  for (const suggestion of governance.suggestions) {
    const packet = packetsById.get(suggestion.metadata.packetId);
    if (!packet) throw new Error(`${suggestion.metadata.suggestionId} references unknown Guide Packet ${suggestion.metadata.packetId}.`);
    const card = packet.cardsById.get(suggestion.metadata.decisionId);
    if (!card) throw new Error(`${suggestion.metadata.suggestionId} references unknown decision ${suggestion.metadata.decisionId}.`);
    if (suggestion.metadata.packetDigest !== packet.packetDigest) throw new Error(`${suggestion.metadata.suggestionId} packet digest does not match its immutable archive.`);
    if (suggestion.metadata.decisionCardDigest !== sha256(canonicalJson(card))) throw new Error(`${suggestion.metadata.suggestionId} decision-card digest does not match ${card.id}.`);
    assertDecisionCardFidelity({ suggestion, card });
    if (packet.kind === "policy-decision-package" && !scopeMatches(suggestion.metadata, card.affectedIds)) {
      throw new Error(`${suggestion.metadata.suggestionId} affected IDs do not match ${card.id}.`);
    }
    await validateAffectedIdentifiers({ rootDir, packet, suggestion });
    let review = reviewsByPacket.get(packet.manifest.packetId);
    if (!review) {
      const events = governance.reviewEvents.filter(({ metadata }) => metadata.packetId === packet.manifest.packetId);
      if (events.length !== 1) throw new Error(`Expected exactly one review event for ${packet.manifest.packetId}; found ${events.length}.`);
      review = { event: events[0], artifact: await loadReviewArtifact({ rootDir, reviewEvent: events[0], packet }) };
      reviewsByPacket.set(packet.manifest.packetId, review);
    }
    if (new Date(review.event.metadata.occurredAt) < new Date(suggestion.metadata.createdAt)) {
      throw new Error(`${review.event.metadata.eventId} predates ${suggestion.metadata.suggestionId}.`);
    }
    const artifactAffectedIds = review.artifact.decisionAffectedIds?.[suggestion.metadata.decisionId];
    if (!artifactAffectedIds || !scopeMatches(artifactAffectedIds, suggestion.metadata)) {
      throw new Error(`${review.event.metadata.eventId} affected IDs for ${suggestion.metadata.decisionId} do not match ${suggestion.metadata.suggestionId}.`);
    }
    const artifactFindingIds = review.artifact.mappings.suggestionFindings[suggestion.metadata.decisionId];
    if (!Array.isArray(artifactFindingIds) || !sameStringSet(artifactFindingIds, suggestion.metadata.reviewFindingIds)) {
      throw new Error(`${suggestion.metadata.suggestionId} reviewFindingIds do not match its authoritative review artifact.`);
    }
    if (suggestion.metadata.ownerDecisionRequired !== true) {
      throw new Error(`${suggestion.metadata.suggestionId} must require an owner decision.`);
    }
    if (new Date(suggestion.metadata.createdAt) < new Date(packet.manifest.createdAt)) {
      throw new Error(`${suggestion.metadata.suggestionId} predates its Guide Packet.`);
    }
    if (!sameStringSet(suggestion.metadata.regressionIds, card.affectedRegressions ?? [])) {
      throw new Error(`${suggestion.metadata.suggestionId} regressionIds must exactly match ${card.id} affectedRegressions.`);
    }
    if (![...suggestion.metadata.guideIds, ...suggestion.metadata.graphNodeIds, ...suggestion.metadata.promptContractIds, ...suggestion.metadata.policySafetyGateIds].length) {
      throw new Error(`${suggestion.metadata.suggestionId} has no stable affected identifier.`);
    }
    const blocked = new Set(["blocked-by-packet-review", "needs-technical-repair"]);
    if (review.event.metadata.outcome !== "passed-owner-gate" && !blocked.has(suggestion.metadata.status) && suggestion.metadata.status !== "superseded") {
      throw new Error(`${suggestion.metadata.suggestionId} has invalid status for a rejected packet: ${suggestion.metadata.status}`);
    }
    if (review.event.metadata.outcome === "passed-owner-gate" && blocked.has(suggestion.metadata.status)) {
      throw new Error(`${suggestion.metadata.suggestionId} has invalid status for a passed packet: ${suggestion.metadata.status}`);
    }
  }
  validateCandidateHistory(governance);
  const latest = guidePackets[0];
  const latestPacket = validateLatestPacket({
    manifest: latest.manifest,
    cards: latest.cards,
    reviewEvents: governance.reviewEvents,
    suggestions: governance.suggestions
  });
  for (const suggestion of governance.suggestions.filter(({ metadata }) => metadata.status === "superseded")) {
    const { suggestionId, supersededBy, supersessionReason } = suggestion.metadata;
    if (normalizedId(supersessionReason) !== "technical-replacement") throw new Error(`${suggestionId} supersession requires technical-replacement metadata.`);
    const replacement = governance.suggestions.find(({ metadata }) => metadata.suggestionId === supersededBy);
    if (!replacement || replacement.metadata.decisionId !== suggestion.metadata.decisionId || !scopeMatches(replacement.metadata, suggestion.metadata)) {
      throw new Error(`${suggestionId} supersededBy replacement is not scope-compatible.`);
    }
    const currentPacket = packetsById.get(suggestion.metadata.packetId);
    const replacementPacket = packetsById.get(replacement.metadata.packetId);
    if (!replacementPacket || replacementPacket.manifest.packetRevision <= currentPacket.manifest.packetRevision) {
      throw new Error(`${suggestionId} supersededBy replacement must come from a later packet.`);
    }
  }
  validateApprovalLinks({
    suggestions: governance.suggestions,
    decisions: governance.decisions,
    approvals: governance.approvals,
    reviewEvents: governance.reviewEvents
  });
  await validateImplementationEvidence({ rootDir, ...governance });
  return { packetId: latest.manifest.packetId, tracked: latest.cards.length, packets, policyDecisionPackages, reviewsByPacket, ...governance, ...latestPacket };
}

function parseEntries(source) {
  const entries = [];
  for (const match of source.matchAll(ENTRY_PATTERN)) {
    let entry;
    try {
      entry = JSON.parse(match[1]);
    } catch (error) {
      throw new Error(`Malformed therapy lesson metadata: ${error.message}`);
    }
    if (typeof entry.lessonId !== "string" || !entry.lessonId) throw new Error("Every therapy lesson requires lessonId.");
    if (!validInstant(entry.learnedAt)) throw new Error(`Therapy lesson ${entry.lessonId} has an invalid UTC timestamp.`);
    if (!ACTIVATIONS.has(entry.activation)) throw new Error(`Therapy lesson ${entry.lessonId} has an invalid activation state.`);
    entries.push(entry);
  }
  const ids = entries.map((entry) => entry.lessonId);
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
  if (duplicate) throw new Error(`Duplicate therapy lesson ID: ${duplicate}`);
  return entries;
}

export async function verifyTherapyLessons({ rootDir = root } = {}) {
  const entries = parseEntries(await fs.readFile(path.join(rootDir, "THERAPY-LESSONS"), "utf8"));
  const activeCount = entries.filter((entry) => entry.activation === "active-runtime").length;
  if (activeCount === 0) throw new Error("THERAPY-LESSONS has no active-runtime prompt lesson.");
  const governance = await verifyTherapyGovernance({ rootDir });
  const suggestions = [...governance.suggestionsByDecision.values()];
  const blockedCount = suggestions.filter(({ metadata }) =>
    metadata.status === "blocked-by-packet-review" || metadata.status === "needs-technical-repair"
  ).length;
  return {
    packetId: governance.packetId,
    tracked: governance.tracked,
    activeCount,
    suggestionCount: suggestions.length,
    blockedCount,
    decisionCount: governance.decisions.length,
    approvalCount: governance.approvals.length,
    implementationCount: governance.implementationEvents.length,
    reviewEventId: governance.reviewEvent.metadata.eventId
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await verifyTherapyLessons();
    process.stdout.write(`PASS ${result.suggestionCount}/${result.tracked} substantive therapy suggestions tracked for ${result.packetId}; ${result.activeCount} active runtime lessons; ${result.blockedCount} blocked suggestions; ${result.decisionCount} explicit owner decision receipts; ${result.approvalCount} explicit owner approvals; ${result.implementationCount} implementations; r02 rejection explained by ${result.reviewEventId}.\n`);
  } catch (error) {
    process.stderr.write(`FAIL ${error.message}\n`);
    process.exitCode = 1;
  }
}
