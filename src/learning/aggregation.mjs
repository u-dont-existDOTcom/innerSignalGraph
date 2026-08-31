import { validateLessonCandidate } from "./contracts.mjs";
import { candidateFingerprint } from "./fingerprint.mjs";

const DIRECTIONS = Object.freeze(["benefit", "no-change", "mixed", "worsening", "unclear"]);

function zeroDirections() {
  return Object.fromEntries(DIRECTIONS.map((direction) => [direction, 0]));
}

function token(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new TypeError(`${label} must be a 64-hex candidate-scoped token.`);
  return value;
}

export function aggregateCandidates(occurrences) {
  if (!Array.isArray(occurrences)) throw new TypeError("Occurrences must be an array.");
  const byCandidate = new Map();
  const bySubject = new Map();

  for (const [index, occurrence] of occurrences.entries()) {
    if (!occurrence || typeof occurrence !== "object" || Array.isArray(occurrence)) throw new TypeError(`Occurrence ${index} must be an object.`);
    const candidate = validateLessonCandidate(occurrence.candidate);
    const occurrenceToken = token(occurrence.occurrenceToken, `occurrence ${index} token`);
    const fingerprint = candidateFingerprint(candidate);
    let candidateEntry = byCandidate.get(fingerprint);
    if (!candidateEntry) {
      candidateEntry = { fingerprint, subjectKey: candidate.subjectKey, evidenceClass: candidate.evidenceClass, causalBoundary: candidate.causalBoundary, outcomeDirection: candidate.outcomeDirection, tokens: new Set() };
      byCandidate.set(fingerprint, candidateEntry);
    }
    candidateEntry.tokens.add(occurrenceToken);

    let subject = bySubject.get(candidate.subjectKey);
    if (!subject) {
      subject = Object.fromEntries(DIRECTIONS.map((direction) => [direction, new Set()]));
      bySubject.set(candidate.subjectKey, subject);
    }
    if (DIRECTIONS.includes(candidate.outcomeDirection)) subject[candidate.outcomeDirection].add(`${fingerprint}:${occurrenceToken}`);
  }

  return Object.freeze({
    candidates: [...byCandidate.values()].sort((a, b) => a.fingerprint.localeCompare(b.fingerprint)).map((entry) => Object.freeze({
      candidateFingerprint: entry.fingerprint,
      subjectKey: entry.subjectKey,
      evidenceClass: entry.evidenceClass,
      causalBoundary: entry.causalBoundary,
      outcomeDirection: entry.outcomeDirection,
      occurrenceCount: entry.tokens.size
    })),
    contradictionSets: [...bySubject.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([subjectKey, sets]) => Object.freeze({
      subjectKey,
      contradictionCounts: Object.fromEntries(DIRECTIONS.map((direction) => [direction, sets[direction].size])),
      totalOccurrences: DIRECTIONS.reduce((sum, direction) => sum + sets[direction].size, 0)
    }))
  });
}

export function emptyContradictionCounts() {
  return zeroDirections();
}
