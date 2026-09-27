import { ValidationError } from "../core/errors.mjs";
import { openPrivateJournalGraph } from "./retrieval.mjs";
import { runColdConsumerComparisons } from "./cold-profile-test.mjs";

const requireValue = (condition, code) => {
  if (!condition) throw new ValidationError(code, { code });
};

/**
 * Entry point for a separate consumer process. Its inputs are a saved profile
 * locator and frozen questions only. The source upload and producer checkpoint
 * are never opened by this process or included in the reasoning packet.
 */
export async function runSavedProfileColdConsumer({
  service, auth, caseId, corpusId, expectedGeneration, questions,
  port, grant, readIfPresent, writeOnce,
  openReader = openPrivateJournalGraph, authContextProvider = null,
  requiredScope = "case:read", maximumTraversed = 1000,
  packetRecordLimit = 64
}) {
  requireValue(service && typeof service.withJournalCorpus === "function"
    && typeof service.inspectJournalCorpus === "function", "COLD_PROFILE_SERVICE_REQUIRED");
  requireValue(typeof caseId === "string" && typeof corpusId === "string"
    && typeof expectedGeneration === "string", "COLD_PROFILE_LOCATOR_INVALID");
  requireValue(["case:read", "case:write"].includes(requiredScope), "COLD_PROFILE_SCOPE_INVALID");
  requireValue(grant?.purpose === "session_use"
    && grant.allowed_roles?.includes("cold_consumer"), "COLD_PROFILE_GRANT_INVALID");
  const refreshAuth = async () => {
    if (authContextProvider) Object.assign(auth, await authContextProvider());
  };
  // Every snapshot check uses this process's own scope and purpose, so a session-use consumer
  // needs no organize_search grant and a write-scoped consumer needs no case:read grant.
  const inspect = () => service.inspectJournalCorpus(caseId, corpusId, {
    requiredScope, requiredPurpose: "session_use"
  }, auth);
  await refreshAuth();
  await service.verifyCaseAccess(caseId, {
    requiredScope, requiredPurpose: "session_use"
  }, auth);
  const before = await inspect();
  requireValue(before.reference?.active_generation === expectedGeneration
    && typeof before.reference.manifest_object_id === "string",
    "COLD_PROFILE_GENERATION_NOT_SAVED");
  return service.withJournalCorpus(caseId, corpusId, {
    requiredScope, requiredPurpose: "session_use"
  }, async ({ corpusStore, cursorSecret, reference }) => {
    requireValue(reference.active_generation === expectedGeneration
      && reference.manifest_object_id === before.reference.manifest_object_id,
      "COLD_PROFILE_SNAPSHOT_CHANGED");
    const assertSnapshotCurrent = async () => {
      await refreshAuth();
      await service.verifyCaseAccess(caseId, {
        requiredScope, requiredPurpose: "session_use"
      }, auth);
      const now = await inspect();
      return now.reference?.active_generation === expectedGeneration
        && now.reference.manifest_object_id === reference.manifest_object_id
        && now.reference.visibility_epoch === reference.visibility_epoch;
    };
    const reader = await openReader({
      corpusStore, manifestObjectId: reference.manifest_object_id,
      caseId, corpusId, generation: expectedGeneration,
      visibilityEpoch: reference.visibility_epoch, purpose: "session_use",
      cursorSecret, assertSnapshotCurrent
    });
    try {
      return await runColdConsumerComparisons({
        reader, questions, port, grant, caseId, corpusId,
        generation: expectedGeneration, readIfPresent, writeOnce,
        maximumTraversed, packetRecordLimit
      });
    } finally { reader.close(); }
  }, auth);
}
