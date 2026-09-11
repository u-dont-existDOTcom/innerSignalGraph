import { createHash, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RuntimeError, ValidationError } from "../core/errors.mjs";
import { withOpenedRegularFile } from "../core/opened-regular-file.mjs";
import { createEncryptedPrivateCaseStore } from "./private-case-store.mjs";
import { assessContinuationSafety, CaseNotContinuationSafeError } from "./private-case-continuity.mjs";
import { resolvePrivateArtifactCaseId } from "./private-artifact-locator.mjs";

export { assessContinuationSafety, CaseNotContinuationSafeError } from "./private-case-continuity.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const PRIVATE_CASE_SCOPES = Object.freeze({
  READ: "case:read",
  WRITE: "case:write",
  AUDIT: "case:audit"
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
const isWithin = (parent, candidate) => {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

function assertProvider(provider, method, name) {
  if (!provider || typeof provider[method] !== "function") throw new ValidationError(`${name} must implement ${method}().`);
}

export function createPrivateCaseAccessService({
  rootDir,
  authorizationProvider,
  keyProvider,
  allowDevelopmentFileProvider = false,
  now = () => new Date().toISOString()
} = {}) {
  if (typeof rootDir !== "string" || !path.isAbsolute(rootDir)) throw new ValidationError("rootDir must be an absolute private storage path.");
  assertProvider(authorizationProvider, "authorize", "authorizationProvider");
  assertProvider(keyProvider, "getCaseKeyMaterial", "keyProvider");
  const mutationTails = new Map();

  const withStore = async (caseId, authContext, requiredScope, operation) => {
    let authorization;
    try {
      authorization = await authorizationProvider.authorize({ caseId, authContext, requiredScope });
    } catch {
      throw new PrivateCaseAccessDeniedError();
    }
    if (!authorization?.allowed || !authorization?.principalId) throw new PrivateCaseAccessDeniedError();
    if (!Array.isArray(authorization.scopes) || !authorization.scopes.includes(requiredScope)) throw new PrivateCaseAccessDeniedError();

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
  const mutate = async (caseId, authContext, requiredScope, operation) => {
    const previousTail = mutationTails.get(caseId) ?? Promise.resolve();
    let release;
    const currentTail = new Promise((resolve) => { release = resolve; });
    mutationTails.set(caseId, currentTail);
    await previousTail;
    try { return await withStore(caseId, authContext, requiredScope, operation); }
    finally {
      release();
      if (mutationTails.get(caseId) === currentTail) mutationTails.delete(caseId);
    }
  };
  const write = (caseId, authContext, operation) => mutate(caseId, authContext, PRIVATE_CASE_SCOPES.WRITE, operation);
  const auditWrite = (caseId, authContext, operation) => mutate(caseId, authContext, PRIVATE_CASE_SCOPES.AUDIT, operation);
  const withResolvedArtifact = async (kind, artifactId, authContext, requiredScope, operation) => {
    let caseId;
    try { caseId = await resolvePrivateArtifactCaseId({ rootDir, kind, artifactId }); }
    catch { throw new PrivateCaseAccessDeniedError(); }
    return withStore(caseId, authContext, requiredScope, (store, authorization) => operation(store, caseId, authorization));
  };

  return Object.freeze({
    rootDir,
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
    async getCandidateResponse(caseId, selector, authContext) { return read(caseId, authContext, (store) => store.getCandidateResponse(caseId, selector)); },
    async getCandidateLifecycle(caseId, authContext) { return read(caseId, authContext, (store) => store.getCandidateLifecycle(caseId)); },
    async saveSourceArtifact(caseId, sourceArtifactId, chunks, metadata, authContext) {
      return write(caseId, authContext, (store) => store.saveSourceArtifact(caseId, sourceArtifactId, chunks, metadata));
    },
    async getSourceArtifact(caseId, sourceArtifactId, authContext) { return read(caseId, authContext, (store) => store.getSourceArtifact(caseId, sourceArtifactId)); },
    async retrieveCaseEvidence(caseId, criteria, authContext) { return read(caseId, authContext, (store) => store.retrieveCaseEvidence(caseId, criteria)); },
    async getTrackerWindow(caseId, options, authContext) { return read(caseId, authContext, (store) => store.getTrackerWindow(caseId, options)); },
    async getJournalEntries(caseId, options, authContext) { return read(caseId, authContext, (store) => store.getJournalEntries(caseId, options)); },
    async appendTracker(caseId, entry, authContext) { return write(caseId, authContext, (store) => store.appendTracker(caseId, entry)); },
    async appendJournal(caseId, entry, authContext) { return write(caseId, authContext, (store) => store.appendJournal(caseId, entry)); },
    async getCurrentEpisode(caseId, authContext) { return read(caseId, authContext, (store) => store.getCurrentEpisode(caseId)); },
    async createHandoff(caseId, options, authContext) { return write(caseId, authContext, (store) => store.createHandoff(caseId, options)); },
    async loadHandoff(handoffId, authContext, { requireContinuationSafe = true } = {}) {
      const packet = await withResolvedArtifact("handoff", handoffId, authContext, PRIVATE_CASE_SCOPES.AUDIT, (store, caseId) => store.loadHandoff(caseId, handoffId));
      if (requireContinuationSafe && !packet.continuation_safety.continuation_safe) throw new CaseNotContinuationSafeError(packet.continuation_safety.failures);
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
    return { ...structuredClone(grant), tokenDigest: Buffer.from(tokenSha256, "hex") };
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
    async authorize({ caseId, authContext, requiredScope }) {
      if (closed) throw new PrivateCaseAccessDeniedError();
      const token = authContext?.bearerToken;
      if (typeof token !== "string" || !token) throw new PrivateCaseAccessDeniedError();
      const digest = sha256(token);
      try {
        const grant = parsed.grants.find((candidate) => candidate.tokenDigest.byteLength === digest.byteLength && timingSafeEqual(candidate.tokenDigest, digest));
        const allowed = Boolean(grant && grant.case_ids.includes(caseId) && grant.scopes.includes(requiredScope));
        return allowed ? { allowed: true, principalId: grant.principal_id, scopes: [...grant.scopes] } : { allowed: false };
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
