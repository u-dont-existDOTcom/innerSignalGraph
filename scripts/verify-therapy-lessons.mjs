#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY_PATTERN = /<!-- therapy-lesson (\{[^\r\n]*\}) -->/g;
const ACTIVATIONS = new Set(["active-runtime", "candidate-awaiting-owner"]);
const LEDGER_FILES = {
  history: "THERAPY-LESSONS",
  suggestions: "SUGGESTED-THERAPY-LESSONS",
  approvals: "APPROVED-THERAPY-LESSONS"
};
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
  "Review outcome", "Why the packet was rejected", "What this does not mean",
  "Finding-to-suggestion mapping", "Packet-level findings", "Next phase"
];

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
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item)) {
    throw new Error(`${id} has an invalid ${field}.`);
  }
  if (new Set(value).size !== value.length) throw new Error(`${id} has duplicate ${field}.`);
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
    const id = metadata[idField];
    if (typeof id !== "string" || !id) throw new Error(`${fileName}: every ${marker} requires ${idField}.`);
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

function assertUniqueGovernanceIds(entries) {
  const ids = entries.map(({ metadata }) => metadata.eventId ?? metadata.suggestionId ?? metadata.approvalId);
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
  if (duplicate) throw new Error(`Duplicate therapy governance ID: ${duplicate}`);
}

export async function loadTherapyGovernance({ rootDir = root } = {}) {
  const [historySource, suggestionsSource, approvalsSource, agentsSource] = await Promise.all([
    readRequiredFile(rootDir, LEDGER_FILES.history),
    readRequiredFile(rootDir, LEDGER_FILES.suggestions),
    readRequiredFile(rootDir, LEDGER_FILES.approvals),
    readRequiredFile(rootDir, "AGENTS.md")
  ]);
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
    source: suggestionsSource,
    fileName: LEDGER_FILES.suggestions,
    marker: "therapy-review-event",
    idField: "eventId",
    timestampField: "occurredAt",
    validateMetadata: (entry) => assertIdArrays(entry, entry.eventId, ["findingIds", "packetLevelFindingIds"])
  });
  const suggestions = parseLedgerEntries({
    source: suggestionsSource,
    fileName: LEDGER_FILES.suggestions,
    marker: "therapy-suggestion",
    idField: "suggestionId",
    timestampField: "createdAt",
    validateMetadata: (entry) => {
      assertIdArrays(entry, entry.suggestionId, ["reviewFindingIds", "guideIds", "graphNodeIds", "promptIds", "regressionIds"]);
      if (!SUGGESTION_STATUSES.has(entry.status)) throw new Error(`${entry.suggestionId} has an invalid status.`);
    }
  });
  const approvals = parseLedgerEntries({
    source: approvalsSource,
    fileName: LEDGER_FILES.approvals,
    marker: "therapy-approval",
    idField: "approvalId",
    timestampField: "decidedAt",
    validateMetadata: (entry) => {
      assertIdArrays(entry, entry.approvalId, ["guideIds"]);
      if (!APPROVAL_STATUSES.has(entry.implementationStatus)) throw new Error(`${entry.approvalId} has an invalid implementationStatus.`);
    }
  });

  for (const entry of reviewEvents) {
    assertRequiredSections({ fileName: LEDGER_FILES.suggestions, id: entry.metadata.eventId, body: entry.body, sections: REVIEW_SECTIONS });
  }
  for (const entry of suggestions) {
    assertRequiredSections({ fileName: LEDGER_FILES.suggestions, id: entry.metadata.suggestionId, body: entry.body, sections: SUGGESTION_SECTIONS });
  }
  for (const entry of approvals) {
    assertRequiredSections({ fileName: LEDGER_FILES.approvals, id: entry.metadata.approvalId, body: entry.body, sections: APPROVAL_SECTIONS });
  }
  assertUniqueGovernanceIds([...reviewEvents, ...suggestions, ...approvals]);
  if (!agentsSource.includes("<!-- therapy-owner-decision-protocol-v1 -->")) {
    throw new Error("AGENTS.md is missing therapy-owner-decision-protocol-v1.");
  }
  return { historyLessons, reviewEvents, suggestions, approvals };
}

async function latestCandidate(rootDir) {
  const fixturesRoot = path.join(rootDir, "guide-packets", "fixtures");
  const candidates = [];
  for (const name of await fs.readdir(fixturesRoot)) {
    const packetRoot = path.join(fixturesRoot, name, "packet");
    const manifestPath = path.join(packetRoot, "manifest.json");
    try {
      const manifest = await readJson(manifestPath);
      if (manifest.status === "candidate" && Number.isSafeInteger(manifest.packetRevision)) {
        candidates.push({ manifest, packetRoot });
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  candidates.sort((a, b) => b.manifest.packetRevision - a.manifest.packetRevision);
  if (!candidates.length) throw new Error("No bundled Guide Packet candidate was found.");
  if (candidates.length > 1 && candidates[0].manifest.packetRevision === candidates[1].manifest.packetRevision) {
    throw new Error(`Multiple Guide Packet candidates use revision ${candidates[0].manifest.packetRevision}.`);
  }
  return candidates[0];
}

function sectionBody(body, section) {
  const sectionPattern = new RegExp(`^### ${escapeRegExp(section)}\\r?\\n([\\s\\S]*?)(?=^### |(?![\\s\\S]))`, "m");
  return body.match(sectionPattern)?.[1] ?? "";
}

function assertDecisionBriefElement({ suggestion, body, section, label }) {
  if (!sectionBody(body, section).includes(label)) {
    throw new Error(`${suggestion.metadata.suggestionId} is missing decision-brief element: ${label}`);
  }
}

function assertTwoOptionLabels({ suggestion, body }) {
  const labels = [...sectionBody(body, "Options and trade-offs").matchAll(/^Option\s+([^\s—:-]+)\s*[—:-]/gm)]
    .map((match) => match[1]);
  if (new Set(labels).size < 2) {
    throw new Error(`${suggestion.metadata.suggestionId} is missing decision-brief element: two option labels`);
  }
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
    for (const regressionId of card.affectedRegressions ?? []) {
      if (!metadata.regressionIds.includes(regressionId)) {
        throw new Error(`${metadata.suggestionId} is missing affected regression: ${regressionId}`);
      }
    }
    if (![...metadata.guideIds, ...metadata.graphNodeIds, ...metadata.promptIds].length) {
      throw new Error(`${metadata.suggestionId} has no stable affected identifier.`);
    }

    assertDecisionBriefElement({ suggestion, body: suggestion.body, section: "Evidence and uncertainty", label: "Source status:" });
    assertDecisionBriefElement({ suggestion, body: suggestion.body, section: "Evidence and uncertainty", label: "Limitation:" });
    assertTwoOptionLabels({ suggestion, body: suggestion.body });
    assertDecisionBriefElement({ suggestion, body: suggestion.body, section: "Options and trade-offs", label: "Benefits:" });
    assertDecisionBriefElement({ suggestion, body: suggestion.body, section: "Options and trade-offs", label: "Costs:" });
    assertDecisionBriefElement({ suggestion, body: suggestion.body, section: "Options and trade-offs", label: "Worst plausible failure:" });
    assertDecisionBriefElement({ suggestion, body: suggestion.body, section: "Recommendation and reasoning", label: "Recommendation:" });
    assertDecisionBriefElement({ suggestion, body: suggestion.body, section: "Recommendation and reasoning", label: "Reasoning:" });
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

  return { reviewEvent, suggestionsByDecision };
}

export async function verifyTherapyGovernance({ rootDir = root } = {}) {
  const governance = await loadTherapyGovernance({ rootDir });
  const { manifest, packetRoot } = await latestCandidate(rootDir);
  const decisions = await readJson(path.join(packetRoot, manifest.paths.ownerDecisions));
  const cards = decisions.cards.filter(
    (card) => card.classification === "substantive" && card.requiresHumanDecision === true
  );
  const latestPacket = validateLatestPacket({
    manifest,
    cards,
    reviewEvents: governance.reviewEvents,
    suggestions: governance.suggestions
  });
  return { packetId: manifest.packetId, tracked: cards.length, ...latestPacket };
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
  const { manifest, packetRoot } = await latestCandidate(rootDir);
  const decisions = await readJson(path.join(packetRoot, manifest.paths.ownerDecisions));
  const cards = decisions.cards.filter((card) => card.classification === "substantive" && card.requiresHumanDecision === true);
  const entries = parseEntries(await fs.readFile(path.join(rootDir, "THERAPY-LESSONS"), "utf8"));
  const activeCount = entries.filter((entry) => entry.activation === "active-runtime").length;
  if (activeCount === 0) throw new Error("THERAPY-LESSONS has no active-runtime prompt lesson.");

  const knownDecisionIds = new Set(cards.map((card) => card.id));
  for (const entry of entries.filter((item) => item.packetId === manifest.packetId && item.decisionId)) {
    if (!knownDecisionIds.has(entry.decisionId)) throw new Error(`Unknown latest-packet therapy decision: ${entry.decisionId}`);
  }

  for (const card of cards) {
    const sameDecision = entries.filter((entry) => entry.decisionId === card.id);
    const matches = sameDecision.filter((entry) => entry.packetId === manifest.packetId);
    if (matches.length === 0 && sameDecision.length === 1) {
      throw new Error(`Therapy lesson ${card.id} names the wrong Guide Packet.`);
    }
    if (matches.length !== 1) throw new Error(`Expected exactly one therapy lesson for ${card.id}; found ${matches.length}.`);
    const entry = matches[0];
    if (entry.activation !== "candidate-awaiting-owner") {
      throw new Error(`Pending Guide Packet decision ${card.id} is falsely marked ${entry.activation}.`);
    }
    if (new Date(entry.learnedAt) < new Date(manifest.createdAt)) {
      throw new Error(`Therapy lesson ${card.id} predates its Guide Packet.`);
    }
  }

  return { packetId: manifest.packetId, tracked: cards.length, activeCount };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await verifyTherapyLessons();
    process.stdout.write(`PASS ${result.tracked}/${result.tracked} substantive therapy prompt lessons tracked for ${result.packetId}; ${result.activeCount} active runtime lessons documented.\n`);
  } catch (error) {
    process.stderr.write(`FAIL ${error.message}\n`);
    process.exitCode = 1;
  }
}
