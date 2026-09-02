import { createHash, createHmac } from "node:crypto";
import { validateLessonCandidate } from "./contracts.mjs";

function normalize(value) {
  return value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

function digest(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function candidateFingerprint(candidate) {
  validateLessonCandidate(candidate);
  const canonical = [
    candidate.candidateKind,
    candidate.evidenceClass,
    normalize(candidate.generalizedSignal),
    normalize(candidate.expectedBehavior),
    candidate.policySurface,
    candidate.causalBoundary
  ];
  return digest(JSON.stringify(canonical));
}

function assertSecret(secret) {
  if (typeof secret !== "string" || secret.length < 16) throw new TypeError("An injected local random secret of at least 16 characters is required.");
}

export function createOccurrenceToken(localSecret, fingerprint) {
  assertSecret(localSecret);
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new TypeError("A canonical candidate fingerprint is required.");
  return createHmac("sha256", localSecret).update(`occurrence\0${fingerprint}`, "utf8").digest("hex");
}

export function createRevocationToken(localSecret, occurrenceToken) {
  assertSecret(localSecret);
  if (!/^[a-f0-9]{64}$/.test(occurrenceToken)) throw new TypeError("A candidate-scoped occurrence token is required.");
  return createHmac("sha256", localSecret).update(`revocation\0${occurrenceToken}`, "utf8").digest("hex");
}
