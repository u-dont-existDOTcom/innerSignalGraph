import { validateLessonCandidate, validateQueueStatus } from "./contracts.mjs";
import { candidateFingerprint } from "./fingerprint.mjs";

function opaqueToken(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new TypeError(`${label} must be a 64-hex opaque token.`);
}

function unavailableStatus(reasonCode) {
  return validateQueueStatus({ availability: "unavailable", totalOpen: null, needsReview: null, acceptedNotIncorporated: null, incorporatedClosed: null, reasonCode });
}

export function createMockPrivateQueue({ available = true, unavailableReason = "MOCK_QUEUE_DISABLED" } = {}) {
  const records = new Map();

  function status() {
    if (!available) return unavailableStatus(unavailableReason);
    return validateQueueStatus({
      availability: "available",
      totalOpen: records.size,
      needsReview: [...records.values()].filter((record) => record.status === "needs-review").length,
      acceptedNotIncorporated: 0,
      incorporatedClosed: 0
    });
  }

  function publicRecord(record, submissionStatus) {
    return Object.freeze({
      status: submissionStatus,
      candidateReceipt: record.candidateReceipt,
      candidateFingerprint: record.candidateFingerprint,
      occurrenceCount: record.occurrences.size,
      runtimeAuthority: "none",
      therapyPolicyAuthority: "none",
      transmissionAuthority: "none"
    });
  }

  function submit({ candidate, occurrenceToken, revocationToken }) {
    if (!available) return Object.freeze({ status: "unavailable", candidateReceipt: null, candidateFingerprint: null, occurrenceCount: null, queueStatus: unavailableStatus(unavailableReason) });
    validateLessonCandidate(candidate);
    opaqueToken(occurrenceToken, "occurrenceToken");
    opaqueToken(revocationToken, "revocationToken");
    const fingerprint = candidateFingerprint(candidate);
    let record = records.get(fingerprint);
    const submissionStatus = record ? "existing_candidate" : "submitted";
    if (!record) {
      record = {
        candidate: structuredClone(candidate),
        candidateFingerprint: fingerprint,
        candidateReceipt: `ISL-MOCK-${fingerprint.slice(0, 16)}`,
        status: "needs-review",
        occurrences: new Map()
      };
      records.set(fingerprint, record);
    }
    if (!record.occurrences.has(occurrenceToken)) record.occurrences.set(occurrenceToken, revocationToken);
    return publicRecord(record, submissionStatus);
  }

  function revoke({ candidate, revocationToken }) {
    if (!available) return Object.freeze({ status: "unavailable", revoked: false, occurrenceCount: null });
    validateLessonCandidate(candidate);
    opaqueToken(revocationToken, "revocationToken");
    const fingerprint = candidateFingerprint(candidate);
    const record = records.get(fingerprint);
    if (!record) return Object.freeze({ status: "existing_candidate", revoked: false, occurrenceCount: 0 });
    const match = [...record.occurrences.entries()].find(([, storedRevocation]) => storedRevocation === revocationToken);
    if (!match) return Object.freeze({ status: "existing_candidate", revoked: false, occurrenceCount: record.occurrences.size });
    record.occurrences.delete(match[0]);
    const occurrenceCount = record.occurrences.size;
    if (occurrenceCount === 0) records.delete(fingerprint);
    return Object.freeze({ status: "existing_candidate", revoked: true, occurrenceCount });
  }

  function inspect(candidate) {
    validateLessonCandidate(candidate);
    const record = records.get(candidateFingerprint(candidate));
    if (!record) return null;
    return Object.freeze({
      candidate: structuredClone(record.candidate),
      candidateReceipt: record.candidateReceipt,
      candidateFingerprint: record.candidateFingerprint,
      occurrenceCount: record.occurrences.size,
      status: record.status
    });
  }

  return Object.freeze({ submit, revoke, inspect, status });
}
