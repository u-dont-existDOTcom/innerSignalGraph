import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { isOutside } from "../core/private-path.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RuntimeError, ValidationError } from "../core/errors.mjs";
import { withOpenedRegularFile } from "../core/opened-regular-file.mjs";
import { createEncryptedPrivateCaseStore } from "./private-case-store.mjs";
import { createPrivateJournalCorpusStore } from "./private-journal-corpus.mjs";
import { assessContinuationSafety, CaseNotContinuationSafeError } from "./private-case-continuity.mjs";
import { resolvePrivateArtifactCaseId } from "./private-artifact-locator.mjs";
import { resolvePrivateCaseAliasCaseId, writePrivateCaseAliasLocator } from "./private-case-alias-locator.mjs";

export { assessContinuationSafety, CaseNotContinuationSafeError } from "./private-case-continuity.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const PRIVATE_CASE_SCOPES = Object.freeze({
  READ: "case:read",
  WRITE: "case:write",
  AUDIT: "case:audit",
  // Narrow: lets a connector caller submit an answer for an outstanding journal work item and
  // nothing else. It opens no case store and grants no other write.
  JOURNAL_SUBMIT: "journal:submit"
});

export const PRIVATE_JOURNAL_PURPOSES = Object.freeze({
  ARCHIVE: "archive",
  ORGANIZE_SEARCH: "organize_search",
  SESSION_USE: "session_use",
  CORRECT: "correct",
  REVIEW: "review",
  EXPORT: "export",
  DELETE: "delete"
});

export class PrivateCaseAccessDeniedError extends RuntimeError {
  constructor(message = "Private case access was denied.") {
    super(message, { code: "PRIVATE_CASE_ACCESS_DENIED" });
    this.name = "PrivateCaseAccessDeniedError";
  }
}

export class PrivateCaseKeyUnavailableError extends RuntimeError {
  constructor(message = "Private case key material is unavailable.") {
    super(message, { code: "PRIVATE_CASE_KEY_UNAVAILABLE" });
    this.name = "PrivateCaseKeyUnavailableError";
  }
}

const sha256 = (value) => createHash("sha256").update(value).digest();
const nonBlank = (value, name, max = 1_000) => {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new ValidationError(`${name} must be bounded non-empty text.`);
  return value;
};
const copyBytes = (value, name) => {
  if (!(value instanceof Uint8Array) || value.byteLength === 0) throw new PrivateCaseKeyUnavailableError(`${name} is unavailable.`);
  return Buffer.from(value);
};
// A digest of everything in a case record outside the journal and the record's own bookkeeping.
// Publishing a journal generation must leave it unchanged.
const NON_JOURNAL_EXCLUDED_FIELDS = Object.freeze(["revision", "updated_at", "schema_version", "journal_corpora", "journal_corpus_keys"]);
function nonJournalStateDigest(record) {
  const copy = structuredClone(record);
  for (const field of NON_JOURNAL_EXCLUDED_FIELDS) delete copy[field];
  return createHash("sha256").update(JSON.stringify(copy)).digest("hex");
}
// Judged on real locations: a link back into the checkout is inside, and so is a name like "..private".
const isWithin = (parent, candidate) => !isOutside(parent, candidate);

function assertProvider(provider, method, name) {
  if (!provider || typeof provider[method] !== "function") throw new ValidationError(`${name} must implement ${method}().`);
}

export function createPrivateCaseAccessService({
  rootDir,
  authorizationProvider,
  keyProvider,
  allowDevelopmentFileProvider = false,
  mutationCoordinator = null,
  now = () => new Date().toISOString()
} = {}) {
  if (typeof rootDir !== "string" || !path.isAbsolute(rootDir)) throw new ValidationError("rootDir must be an absolute private storage path.");
  assertProvider(authorizationProvider, "authorize", "authorizationProvider");
  assertProvider(keyProvider, "getCaseKeyMaterial", "keyProvider");
  const withStore = async (caseId, authContext, requiredScope, operation, requiredPurpose = null) => {
    let authorization;
    try {
      authorization = await authorizationProvider.authorize({ caseId, authContext, requiredScope, requiredPurpose });
    } catch {
      throw new PrivateCaseAccessDeniedError();
    }
    if (!authorization?.allowed || !authorization?.principalId) throw new PrivateCaseAccessDeniedError();
    if (!Array.isArray(authorization.scopes) || !authorization.scopes.includes(requiredScope)) throw new PrivateCaseAccessDeniedError();
    if (requiredPurpose != null && (!Array.isArray(authorization.purposes) || !authorization.purposes.includes(requiredPurpose))) {
      throw new PrivateCaseAccessDeniedError();
    }

    let material;
    let routineKek;
    let recoverySecretBytes;
    let store;
    try {
      material = await keyProvider.getCaseKeyMaterial({ caseId, authorization, authContext });
      const osBackedReauthenticated = material?.accessAssurance === "os_backed_reauthenticated" && material.osBackedReauthenticated === true;
      const managedSecretAuthorized = material?.accessAssurance === "managed_secret_provider" && material.managedSecretProvider === true;
      const developmentExternalCredentialAuthorized = allowDevelopmentFileProvider === true
        && material?.accessAssurance === "development_external_file"
        && material.provider === "development-file-provider";
      if (!osBackedReauthenticated && !managedSecretAuthorized && !developmentExternalCredentialAuthorized) {
        throw new PrivateCaseKeyUnavailableError("Key provider did not supply an accepted access assurance.");
      }
      routineKek = copyBytes(material.routineKek, "routineKek");
      recoverySecretBytes = material.recoverySecretBytes == null ? null : copyBytes(material.recoverySecretBytes, "recoverySecretBytes");
      store = createEncryptedPrivateCaseStore({
        rootDir,
        routineKek,
        recoverySecretBytes,
        osBackedReauthenticated,
        managedSecretAuthorized,
        developmentExternalCredentialAuthorized,
        mutationCoordinator,
        now
      });
      return await operation(store, authorization);
    } catch (error) {
      if (error instanceof PrivateCaseAccessDeniedError || error instanceof PrivateCaseKeyUnavailableError) throw error;
      if (!material) throw new PrivateCaseKeyUnavailableError();
      throw error;
    } finally {
      store?.close();
      routineKek?.fill(0);
      recoverySecretBytes?.fill(0);
      if (material?.routineKek instanceof Uint8Array) material.routineKek.fill(0);
      if (material?.recoverySecretBytes instanceof Uint8Array) material.recoverySecretBytes.fill(0);
    }
  };

  const read = (caseId, authContext, operation) => withStore(caseId, authContext, PRIVATE_CASE_SCOPES.READ, operation);
  const mutate = (caseId, authContext, requiredScope, operation) => withStore(caseId, authContext, requiredScope, operation);
  const write = (caseId, authContext, operation) => mutate(caseId, authContext, PRIVATE_CASE_SCOPES.WRITE, operation);
  const auditWrite = (caseId, authContext, operation) => mutate(caseId, authContext, PRIVATE_CASE_SCOPES.AUDIT, operation);
  const withResolvedArtifact = async (kind, artifactId, authContext, requiredScope, operation) => {
    let caseId;
    try { caseId = await resolvePrivateArtifactCaseId({ rootDir, kind, artifactId }); }
    catch { throw new PrivateCaseAccessDeniedError(); }
    return withStore(caseId, authContext, requiredScope, (store, authorization) => operation(store, caseId, authorization));
  };
  const resolvedCaseAlias = async (caseAlias) => {
    try { return await resolvePrivateCaseAliasCaseId({ rootDir, alias: caseAlias }); }
    catch { throw new PrivateCaseAccessDeniedError(); }
  };
  const loadCaseContextForId = async (caseId, authContext, options = {}) => {
    const requiredScope = options.requireAuditScope === false ? PRIVATE_CASE_SCOPES.READ : PRIVATE_CASE_SCOPES.AUDIT;
    const effectiveOptions = {
      ...options,
      episodePolicy: {
        requireCompleteEpisode: options.episodePolicy?.requireCompleteEpisode !== false,
        ...(options.episodePolicy?.maximumSelectedTurns != null ? { maximumSelectedTurns: options.episodePolicy.maximumSelectedTurns } : {}),
        ...(options.episodePolicy?.currentEpisodeId ? { currentEpisodeId: options.episodePolicy.currentEpisodeId } : {}),
        ...(options.episodePolicy?.currentEpisodeStartTurnId ? { currentEpisodeStartTurnId: options.episodePolicy.currentEpisodeStartTurnId } : {})
      }
    };
    const context = await withStore(caseId, authContext, requiredScope, (store) => store.loadCaseContext(caseId, effectiveOptions));
    const continuationSafety = assessContinuationSafety(context);
    const result = Object.freeze({ ...context, continuation_safety: continuationSafety });
    if (options.requireContinuationSafe !== false && !continuationSafety.continuation_safe) throw new CaseNotContinuationSafeError(continuationSafety.failures);
    return result;
  };

  return Object.freeze({
    rootDir,
    // Checks only the caller's token, without opening any case, so a transport can tell a denial
    // that signing in again could cure from one it could not. Null means invalid, or unknown
    // because the authorization provider cannot say.
    async authenticate(authContext) {
      if (typeof authorizationProvider.authenticate !== "function") return null;
      let identity;
      try { identity = await authorizationProvider.authenticate({ authContext }); }
      catch { return null; }
      if (!identity || !Array.isArray(identity.scopes)) return null;
      return Object.freeze({ onlyGrantedAccount: identity.onlyGrantedAccount === true, scopes: Object.freeze([...identity.scopes]) });
    },
    // Authorizes the caller for one case and scope without opening the case or touching any key.
    // Used by tools that act on material outside the case store, such as the journal work exchange.
    async authorizeCase(caseId, authContext, requiredScope) {
      let authorization;
      try {
        authorization = await authorizationProvider.authorize({ caseId, authContext, requiredScope });
      } catch {
        throw new PrivateCaseAccessDeniedError();
      }
      if (!authorization?.allowed || !authorization?.principalId) throw new PrivateCaseAccessDeniedError();
      if (!Array.isArray(authorization.scopes) || !authorization.scopes.includes(requiredScope)) throw new PrivateCaseAccessDeniedError();
      return Object.freeze({ principalId: authorization.principalId, scopes: Object.freeze([...authorization.scopes]) });
    },
    // Authorizes the caller for one case, scope and journal purpose, and confirms the case exists,
    // without changing anything.
    async verifyCaseAccess(caseId, { requiredScope, requiredPurpose = null } = {}, authContext) {
      if (!Object.values(PRIVATE_CASE_SCOPES).includes(requiredScope)) throw new ValidationError("requiredScope is invalid.");
      if (requiredPurpose != null && !Object.values(PRIVATE_JOURNAL_PURPOSES).includes(requiredPurpose)) {
        throw new ValidationError("requiredPurpose is invalid.");
      }
      return withStore(caseId, authContext, requiredScope, async (store) => {
        const record = await store.load(caseId);
        if (!record) throw new RuntimeError("Private case was not found.", { code: "PRIVATE_CASE_NOT_FOUND" });
        return Object.freeze({
          case_id: caseId,
          case_revision: record.revision,
          required_scope: requiredScope,
          required_purpose: requiredPurpose,
          authorized: true
        });
      }, requiredPurpose);
    },
    async loadPrivateRuntimeCase(caseId, authContext) {
      return read(caseId, authContext, async (store) => {
        const record = await store.load(caseId);
        if (!record) throw new RuntimeError("Private case was not found.", { code: "PRIVATE_CASE_NOT_FOUND" });
        return record;
      });
    },
    async beginPrivateRuntimeTurn(caseId, input, authContext) { return write(caseId, authContext, (store) => store.beginPrivateRuntimeTurn(caseId, input)); },
    async getPrivateRuntimeTurn(caseId, runtimeTurnId, authContext) { return read(caseId, authContext, (store) => store.getPrivateRuntimeTurn(caseId, runtimeTurnId)); },
    async recordPrivateRuntimeInvocationEvent(caseId, runtimeTurnId, event, authContext) {
      const scope = event.stage === "audit" ? PRIVATE_CASE_SCOPES.AUDIT : PRIVATE_CASE_SCOPES.WRITE;
      return mutate(caseId, authContext, scope, (store) => store.recordPrivateRuntimeInvocationEvent(caseId, runtimeTurnId, event));
    },
    async transitionPrivateRuntimeTurn(caseId, runtimeTurnId, transition, authContext) {
      const scope = transition.toState === "AUDITING" || transition.toState === "APPROVED" ? PRIVATE_CASE_SCOPES.AUDIT : PRIVATE_CASE_SCOPES.WRITE;
      return mutate(caseId, authContext, scope, (store) => store.transitionPrivateRuntimeTurn(caseId, runtimeTurnId, transition));
    },
    async commitPrivateRuntimeCandidate(caseId, input, authContext) { return write(caseId, authContext, (store) => store.commitPrivateRuntimeCandidate(caseId, input)); },
    async commitPrivateRuntimeAudit(caseId, runtimeTurnId, evidence, options, authContext) {
      return auditWrite(caseId, authContext, (store) => store.commitPrivateRuntimeAudit(caseId, runtimeTurnId, evidence, options));
    },
    async savePrivateRuntimeDiscriminator(caseId, runtimeTurnId, input, authContext) {
      return write(caseId, authContext, (store) => store.savePrivateRuntimeDiscriminator(caseId, runtimeTurnId, input));
    },
    async deliverPrivateRuntimeCandidate(caseId, runtimeTurnId, input, authContext) {
      return write(caseId, authContext, (store) => store.deliverPrivateRuntimeCandidate(caseId, runtimeTurnId, input));
    },
    async deliverPrivateRuntimeDiscriminator(caseId, runtimeTurnId, input, authContext) {
      return write(caseId, authContext, (store) => store.deliverPrivateRuntimeDiscriminator(caseId, runtimeTurnId, input));
    },
    async commitCaseTurn(caseId, input, authContext) { return write(caseId, authContext, (store) => store.commitTurn(caseId, input)); },
    async saveCaseState(caseId, state, authContext) { return write(caseId, authContext, (store) => store.saveCaseState(caseId, state)); },
    async getCaseState(caseId, authContext) { return read(caseId, authContext, (store) => store.getCaseState(caseId)); },
    async saveCaseDiff(caseId, diff, options, authContext) { return write(caseId, authContext, (store) => store.saveCaseDiff(caseId, diff, options)); },
    async getCaseDiff(caseId, options, authContext) { return read(caseId, authContext, (store) => store.getCaseDiff(caseId, options)); },
    async appendTranscriptTurn(caseId, turn, authContext) { return write(caseId, authContext, (store) => store.appendTranscriptTurn(caseId, turn)); },
    async appendTranscriptCompletionAmendment(caseId, amendment, authContext) {
      return write(caseId, authContext, (store) => store.appendTranscriptCompletionAmendment(caseId, amendment));
    },
    async getTranscriptAmendments(caseId, authContext) { return read(caseId, authContext, (store) => store.getTranscriptAmendments(caseId)); },
    async getRecentVerbatim(caseId, episodePolicy, authContext) { return read(caseId, authContext, (store) => store.getRecentVerbatim(caseId, episodePolicy)); },
    async saveCandidateResponse(caseId, candidateId, exactText, metadata, authContext) {
      return write(caseId, authContext, (store) => store.saveCandidateResponse(caseId, candidateId, exactText, metadata));
    },
    async updateCandidateStatus(caseId, candidateId, status, metadataPatch, authContext) {
      return write(caseId, authContext, (store) => store.updateCandidateStatus(caseId, candidateId, status, metadataPatch));
    },
    async recordCandidateAudit(caseId, candidateId, evidence, authContext) {
      return auditWrite(caseId, authContext, (store) => store.recordCandidateAudit(caseId, candidateId, evidence));
    },
    async reconstructCandidateResponse(caseId, parentCandidateId, candidateId, exactText, metadata, authContext) {
      return write(caseId, authContext, (store) => store.reconstructCandidateResponse(caseId, parentCandidateId, candidateId, exactText, metadata));
    },
    async approveCandidateForDelivery(caseId, candidateId, auditId, authContext) {
      return auditWrite(caseId, authContext, (store) => store.approveCandidateForDelivery(caseId, candidateId, auditId));
    },
    async markCandidateSent(caseId, candidateId, authContext) {
      return write(caseId, authContext, (store) => store.markCandidateSent(caseId, candidateId));
    },
    async deliverCandidateResponse(caseId, candidateId, input, authContext) {
      return write(caseId, authContext, (store) => store.deliverCandidateResponse(caseId, candidateId, input));
    },
    async getCandidateResponse(caseId, selector, authContext) { return read(caseId, authContext, (store) => store.getCandidateResponse(caseId, selector)); },
    async getCandidateLifecycle(caseId, authContext) { return read(caseId, authContext, (store) => store.getCandidateLifecycle(caseId)); },
    async saveSourceArtifact(caseId, sourceArtifactId, chunks, metadata, authContext) {
      return write(caseId, authContext, (store) => store.saveSourceArtifact(caseId, sourceArtifactId, chunks, metadata));
    },
    async getSourceArtifact(caseId, sourceArtifactId, authContext) { return read(caseId, authContext, (store) => store.getSourceArtifact(caseId, sourceArtifactId)); },
    async retrieveCaseEvidence(caseId, criteria, authContext) { return read(caseId, authContext, (store) => store.retrieveCaseEvidence(caseId, criteria)); },
    async getTrackerWindow(caseId, options, authContext) { return read(caseId, authContext, (store) => store.getTrackerWindow(caseId, options)); },
    async getJournalEntries(caseId, options, authContext) { return read(caseId, authContext, (store) => store.getJournalEntries(caseId, options)); },
    async createJournalCorpus(caseId, input, authContext) {
      return withStore(caseId, authContext, PRIVATE_CASE_SCOPES.WRITE, (store) => store.createJournalCorpus(caseId, input), PRIVATE_JOURNAL_PURPOSES.ARCHIVE);
    },
    async getJournalCorpus(caseId, corpusId, authContext) {
      return withStore(caseId, authContext, PRIVATE_CASE_SCOPES.READ, (store) => store.getJournalCorpus(caseId, corpusId), PRIVATE_JOURNAL_PURPOSES.ORGANIZE_SEARCH);
    },
    // The corpus reference (null before the corpus exists), the case revision and a digest of the
    // state outside the journal, under the scope and purpose the caller names. It returns no case
    // content, so a journal writer holding only case:write can check its own publication, and a
    // session reader holding only session_use can check its snapshot, without a broader grant.
    async inspectJournalCorpus(caseId, corpusId, { requiredScope, requiredPurpose } = {}, authContext) {
      if (![PRIVATE_CASE_SCOPES.READ, PRIVATE_CASE_SCOPES.WRITE].includes(requiredScope)) throw new ValidationError("requiredScope is invalid.");
      if (!Object.values(PRIVATE_JOURNAL_PURPOSES).includes(requiredPurpose)) throw new ValidationError("requiredPurpose is invalid.");
      nonBlank(corpusId, "corpusId", 160);
      return withStore(caseId, authContext, requiredScope, async (store) => {
        const record = await store.load(caseId);
        if (!record) throw new RuntimeError("Private case was not found.", { code: "PRIVATE_CASE_NOT_FOUND" });
        const reference = record.journal_corpora.find((item) => item.corpus_id === corpusId);
        return Object.freeze({
          case_id: caseId,
          case_revision: record.revision,
          reference: reference ? structuredClone(reference) : null,
          non_journal_state_sha256: nonJournalStateDigest(record)
        });
      }, requiredPurpose);
    },
    async publishJournalGeneration(caseId, input, authContext) {
      return withStore(caseId, authContext, PRIVATE_CASE_SCOPES.WRITE, (store) => store.publishJournalGeneration(caseId, input), PRIVATE_JOURNAL_PURPOSES.SESSION_USE);
    },
    async rollbackJournalGeneration(caseId, input, authContext) {
      return withStore(caseId, authContext, PRIVATE_CASE_SCOPES.WRITE, async (store) => {
        // A rollback target must be readable at the current visibility epoch. A generation staged
        // before a visibility change belongs to the revoked snapshot, and activating it would leave
        // every reader refusing the corpus.
        const record = await store.load(caseId);
        const reference = record?.journal_corpora.find((item) => item.corpus_id === input?.corpusId);
        const target = reference && [...reference.previous_generations].reverse().find((item) => item.generation === input?.targetGeneration);
        if (target) {
          const corpusKey = await store.getJournalCorpusKey(caseId, input.corpusId);
          const corpusStore = createPrivateJournalCorpusStore({ rootDir, caseId, corpusId: input.corpusId, corpusKey });
          try {
            const manifest = await corpusStore.readJsonObject({ objectId: target.manifest_object_id });
            if (manifest.generation !== target.generation || manifest.visibility_epoch !== reference.visibility_epoch) {
              throw new ValidationError("Rollback generation belongs to a revoked visibility epoch.", { code: "GRANT_REVOKED" });
            }
          } finally {
            corpusStore.close();
            corpusKey.fill(0);
          }
        }
        return store.rollbackJournalGeneration(caseId, { ...input, expectedVisibilityEpoch: reference?.visibility_epoch ?? null });
      }, PRIVATE_JOURNAL_PURPOSES.CORRECT);
    },
    async incrementJournalVisibilityEpoch(caseId, input, authContext) {
      return withStore(caseId, authContext, PRIVATE_CASE_SCOPES.WRITE, (store) => store.incrementJournalVisibilityEpoch(caseId, input), PRIVATE_JOURNAL_PURPOSES.SESSION_USE);
    },
    async tombstoneJournalCorpus(caseId, input, authContext) {
      return withStore(caseId, authContext, PRIVATE_CASE_SCOPES.WRITE, (store) => store.tombstoneJournalCorpus(caseId, input), PRIVATE_JOURNAL_PURPOSES.DELETE);
    },
    async withJournalCorpus(caseId, corpusId, { requiredScope = PRIVATE_CASE_SCOPES.READ, requiredPurpose = PRIVATE_JOURNAL_PURPOSES.ORGANIZE_SEARCH } = {}, operation, authContext) {
      if (typeof operation !== "function") throw new ValidationError("Journal corpus operation must be a function.");
      return withStore(caseId, authContext, requiredScope, async (caseStore, authorization) => {
        const [{ reference }, corpusKey] = await Promise.all([
          caseStore.getJournalCorpus(caseId, corpusId),
          caseStore.getJournalCorpusKey(caseId, corpusId)
        ]);
        const corpusStore = createPrivateJournalCorpusStore({ rootDir, caseId, corpusId, corpusKey });
        const cursorSecret = createHmac("sha256", corpusKey)
          .update(`inner-signal-journal-cursor-v1\0${caseId}\0${corpusId}`)
          .digest();
        try {
          return await operation({ caseStore, corpusStore, cursorSecret, reference: structuredClone(reference), authorization: structuredClone(authorization) });
        } finally {
          cursorSecret.fill(0);
          corpusStore.close();
          corpusKey.fill(0);
        }
      }, requiredPurpose);
    },
    async appendTracker(caseId, entry, authContext) { return write(caseId, authContext, (store) => store.appendTracker(caseId, entry)); },
    async appendJournal(caseId, entry, authContext) { return write(caseId, authContext, (store) => store.appendJournal(caseId, entry)); },
    async getCurrentEpisode(caseId, authContext) { return read(caseId, authContext, (store) => store.getCurrentEpisode(caseId)); },
    async bindCaseAlias(caseId, caseAlias, authContext) {
      return write(caseId, authContext, async (store) => {
        const record = await store.load(caseId);
        if (!record) throw new RuntimeError("Private case was not found.", { code: "PRIVATE_CASE_NOT_FOUND" });
        await writePrivateCaseAliasLocator({ rootDir, alias: caseAlias, caseId });
        return Object.freeze({ case_id: caseId, alias_bound: true });
      });
    },
    async createHandoff(caseId, options, authContext) { return write(caseId, authContext, (store) => store.createHandoff(caseId, options)); },
    async loadHandoff(handoffId, authContext, { requireContinuationSafe = true, journalContinuitySupported = false } = {}) {
      const packet = await withResolvedArtifact("handoff", handoffId, authContext, PRIVATE_CASE_SCOPES.AUDIT, (store, caseId) => store.loadHandoff(caseId, handoffId));
      if (requireContinuationSafe && !packet.continuation_safety.continuation_safe) throw new CaseNotContinuationSafeError(packet.continuation_safety.failures);
      if (packet.journal_continuity?.corpora?.length && journalContinuitySupported !== true) {
        throw new CaseNotContinuationSafeError(["journal continuity capability is unsupported by this consumer"]);
      }
      return packet;
    },
    async exportHandoff(handoffId, authContext) {
      return withResolvedArtifact("handoff", handoffId, authContext, PRIVATE_CASE_SCOPES.AUDIT, (store, caseId) => store.exportHandoff(caseId, handoffId));
    },
    async getStateDiffByReference({ caseId = null, handoffId = null } = {}, authContext) {
      if (handoffId) return withResolvedArtifact("handoff", handoffId, authContext, PRIVATE_CASE_SCOPES.READ, async (store, resolvedCaseId) => (await store.loadHandoff(resolvedCaseId, handoffId)).state_diff);
      return read(caseId, authContext, (store) => store.getCaseDiff(caseId));
    },
    async getRecentVerbatimByReference({ caseId = null, handoffId = null } = {}, authContext) {
      if (handoffId) return withResolvedArtifact("handoff", handoffId, authContext, PRIVATE_CASE_SCOPES.READ, async (store, resolvedCaseId) => (await store.loadHandoff(resolvedCaseId, handoffId)).recent_verbatim);
      return read(caseId, authContext, (store) => store.getRecentVerbatim(caseId, { requireCompleteEpisode: true }));
    },
    async getPendingCandidateByReference({ candidateId = null, handoffId = null } = {}, authContext) {
      if (handoffId) {
        return withResolvedArtifact("handoff", handoffId, authContext, PRIVATE_CASE_SCOPES.AUDIT, async (store, resolvedCaseId) => {
          const packet = await store.loadHandoff(resolvedCaseId, handoffId);
          const candidate = candidateId
            ? packet.pending_artifacts.find((entry) => entry.id === candidateId)
            : packet.pending_artifacts.at(-1);
          return candidate ? structuredClone(candidate) : null;
        });
      }
      if (!candidateId) throw new ValidationError("candidateId or handoffId is required.");
      return withResolvedArtifact("candidate", candidateId, authContext, PRIVATE_CASE_SCOPES.AUDIT, (store, resolvedCaseId) => store.getCandidateResponse(resolvedCaseId, candidateId));
    },
    async getTrackerWindowByReference({ caseId = null, handoffId = null, variables = [], timeRange = null, limit = 180 } = {}, authContext) {
      const options = { variables, timeRange, limit };
      if (handoffId) return withResolvedArtifact("handoff", handoffId, authContext, PRIVATE_CASE_SCOPES.READ, (store, resolvedCaseId) => store.getHandoffTrackerWindow(resolvedCaseId, handoffId, options));
      return read(caseId, authContext, (store) => store.getTrackerWindow(caseId, options));
    },
    async getJournalEntriesByReference({ caseId = null, handoffId = null, query = null, timeRange = null, limit = 200 } = {}, authContext) {
      const options = { query, timeRange, limit };
      if (handoffId) return withResolvedArtifact("handoff", handoffId, authContext, PRIVATE_CASE_SCOPES.READ, (store, resolvedCaseId) => store.getHandoffJournalEntries(resolvedCaseId, handoffId, options));
      return read(caseId, authContext, (store) => store.getJournalEntries(caseId, options));
    },
    async loadCaseContext(caseId, authContext, options = {}) {
      return loadCaseContextForId(caseId, authContext, options);
    },
    async loadCaseContextByAlias(caseAlias, authContext, options = {}) {
      const caseId = await resolvedCaseAlias(caseAlias);
      return loadCaseContextForId(caseId, authContext, options);
    }
  });
}

function validateDevelopmentCredentialFile(value, credentialsPath) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schema_version !== 1) throw new ValidationError("Development private-case credential file is invalid.");
  if (!path.isAbsolute(value.root_dir)) throw new ValidationError("Development private-case root_dir must be absolute.");
  if (!Array.isArray(value.grants) || !value.case_keys || typeof value.case_keys !== "object" || Array.isArray(value.case_keys)) throw new ValidationError("Development private-case credential file is incomplete.");
  const grants = value.grants.map((grant, index) => {
    if (!grant || typeof grant !== "object" || Array.isArray(grant)) throw new ValidationError(`Development grant ${index} is invalid.`);
    const tokenSha256 = nonBlank(grant.token_sha256, `grants[${index}].token_sha256`, 64).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(tokenSha256)) throw new ValidationError(`grants[${index}].token_sha256 is invalid.`);
    nonBlank(grant.principal_id, `grants[${index}].principal_id`, 160);
    if (!Array.isArray(grant.case_ids) || grant.case_ids.length === 0 || grant.case_ids.some((id) => typeof id !== "string" || !id.trim())) throw new ValidationError(`grants[${index}].case_ids is invalid.`);
    if (!Array.isArray(grant.scopes) || grant.scopes.some((scope) => !Object.values(PRIVATE_CASE_SCOPES).includes(scope))) throw new ValidationError(`grants[${index}].scopes is invalid.`);
    const purposes = grant.purposes ?? [];
    if (!Array.isArray(purposes) || purposes.some((purpose) => !Object.values(PRIVATE_JOURNAL_PURPOSES).includes(purpose))) {
      throw new ValidationError(`grants[${index}].purposes is invalid.`);
    }
    return { ...structuredClone(grant), purposes: [...new Set(purposes)], tokenDigest: Buffer.from(tokenSha256, "hex") };
  });
  const keys = new Map();
  for (const [caseId, entry] of Object.entries(value.case_keys)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new ValidationError(`case_keys.${caseId} is invalid.`);
    const routineKek = Buffer.from(nonBlank(entry.routine_kek_base64, `case_keys.${caseId}.routine_kek_base64`, 1_000), "base64");
    const recoverySecretBytes = Buffer.from(nonBlank(entry.recovery_secret_base64, `case_keys.${caseId}.recovery_secret_base64`, 1_000), "base64");
    if (routineKek.byteLength !== 32 || recoverySecretBytes.byteLength < 16) throw new ValidationError(`case_keys.${caseId} has invalid key material.`);
    keys.set(caseId, { routineKek, recoverySecretBytes });
  }
  return { credentialsPath, rootDir: value.root_dir, grants, keys };
}

export async function loadDevelopmentPrivateCaseProviders(credentialsPath) {
  if (typeof credentialsPath !== "string" || !path.isAbsolute(credentialsPath)) throw new ValidationError("credentialsPath must be an absolute path outside public repository fixtures.");
  if (isWithin(repositoryRoot, path.resolve(credentialsPath))) throw new ValidationError("Development private-case credentials must be outside the public repository.");
  const parsed = await withOpenedRegularFile(credentialsPath, async (handle, info) => {
    if ((info.mode & 0o077) !== 0) throw new ValidationError("Development private-case credential file must have mode 0600 or stricter.");
    return validateDevelopmentCredentialFile(JSON.parse(await handle.readFile("utf8")), credentialsPath);
  });
  if (isWithin(repositoryRoot, path.resolve(parsed.rootDir))) throw new ValidationError("Development private-case storage root must be outside the public repository.");
  let closed = false;
  const authorizationProvider = Object.freeze({
    async authorize({ caseId, authContext, requiredScope, requiredPurpose = null }) {
      if (closed) throw new PrivateCaseAccessDeniedError();
      const token = authContext?.bearerToken;
      if (typeof token !== "string" || !token) throw new PrivateCaseAccessDeniedError();
      const digest = sha256(token);
      try {
        const grant = parsed.grants.find((candidate) => candidate.tokenDigest.byteLength === digest.byteLength && timingSafeEqual(candidate.tokenDigest, digest));
        const allowed = Boolean(grant && grant.case_ids.includes(caseId) && grant.scopes.includes(requiredScope)
          && (requiredPurpose == null || grant.purposes.includes(requiredPurpose)));
        return allowed ? { allowed: true, principalId: grant.principal_id, scopes: [...grant.scopes], purposes: [...grant.purposes] } : { allowed: false };
      } finally { digest.fill(0); }
    }
  });
  const keyProvider = Object.freeze({
    async getCaseKeyMaterial({ caseId }) {
      if (closed) throw new PrivateCaseKeyUnavailableError();
      const value = parsed.keys.get(caseId);
      if (!value) throw new PrivateCaseKeyUnavailableError();
      return {
        routineKek: Buffer.from(value.routineKek),
        recoverySecretBytes: Buffer.from(value.recoverySecretBytes),
        accessAssurance: "development_external_file",
        provider: "development-file-provider"
      };
    }
  });
  return Object.freeze({
    kind: "development-file-provider",
    productionReady: false,
    journalEnabled: parsed.grants.some((grant) => grant.purposes.length > 0),
    rootDir: parsed.rootDir,
    authorizationProvider,
    keyProvider,
    close() {
      if (closed) return;
      closed = true;
      for (const grant of parsed.grants) grant.tokenDigest.fill(0);
      for (const value of parsed.keys.values()) {
        value.routineKek.fill(0);
        value.recoverySecretBytes.fill(0);
      }
    }
  });
}
