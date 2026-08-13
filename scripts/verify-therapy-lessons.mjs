#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturesRoot = path.join(root, "guide-packets", "fixtures");
const lessonPath = path.join(root, "THERAPY-LESSONS");
const ENTRY_PATTERN = /<!-- therapy-lesson (\{[^\r\n]*\}) -->/g;
const ACTIVATIONS = new Set(["active-runtime", "candidate-awaiting-owner"]);

function validInstant(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function latestCandidate() {
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

export async function verifyTherapyLessons() {
  const { manifest, packetRoot } = await latestCandidate();
  const decisions = await readJson(path.join(packetRoot, manifest.paths.ownerDecisions));
  const cards = decisions.cards.filter((card) => card.classification === "substantive" && card.requiresHumanDecision === true);
  const entries = parseEntries(await fs.readFile(lessonPath, "utf8"));
  const activeCount = entries.filter((entry) => entry.activation === "active-runtime").length;
  if (activeCount === 0) throw new Error("THERAPY-LESSONS has no active-runtime prompt lesson.");

  const knownDecisionIds = new Set(cards.map((card) => card.id));
  for (const entry of entries.filter((item) => item.packetId === manifest.packetId && item.decisionId)) {
    if (!knownDecisionIds.has(entry.decisionId)) throw new Error(`Unknown latest-packet therapy decision: ${entry.decisionId}`);
  }

  for (const card of cards) {
    const matches = entries.filter((entry) => entry.decisionId === card.id);
    if (matches.length !== 1) throw new Error(`Expected exactly one therapy lesson for ${card.id}; found ${matches.length}.`);
    const entry = matches[0];
    if (entry.packetId !== manifest.packetId) throw new Error(`Therapy lesson ${card.id} names the wrong Guide Packet.`);
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
