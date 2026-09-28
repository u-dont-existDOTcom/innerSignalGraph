import { ValidationError } from "../core/errors.mjs";
import { PRIVATE_CASE_SCOPES, PRIVATE_JOURNAL_PURPOSES } from "../storage/private-case-access.mjs";
import { openPrivateJournalGraph } from "./retrieval.mjs";

const ID = /^[A-Za-z0-9:_-]{1,160}$/;
const READ_PURPOSES = new Set([PRIVATE_JOURNAL_PURPOSES.ORGANIZE_SEARCH, PRIVATE_JOURNAL_PURPOSES.SESSION_USE]);
const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 200;

function invariant(condition, code) {
  if (!condition) throw new ValidationError(code, { code });
}

function checkedId(value, name) {
  invariant(typeof value === "string" && ID.test(value), `${name.toUpperCase()}_INVALID`);
  return value;
}

function pageSize(value) {
  const result = value ?? PAGE_SIZE_DEFAULT;
  invariant(Number.isSafeInteger(result) && result >= 1 && result <= PAGE_SIZE_MAX, "PAGE_SIZE_INVALID");
  return result;
}

function readPurpose(value) {
  const purpose = value ?? PRIVATE_JOURNAL_PURPOSES.ORGANIZE_SEARCH;
  invariant(READ_PURPOSES.has(purpose), "JOURNAL_READ_PURPOSE_INVALID");
  return purpose;
}

function sameSnapshot(reference, snapshot) {
  return reference.active_generation === snapshot.generation
    && reference.manifest_object_id === snapshot.manifest_object_id
    && reference.visibility_epoch === snapshot.visibility_epoch;
}

async function recheckSnapshot(caseStore, caseId, corpusId, snapshot) {
  const current = await caseStore.getJournalCorpus(caseId, corpusId);
  invariant(sameSnapshot(current.reference, snapshot), "CURSOR_STALE");
}

// A timeline bound, as the reader accepts it: the window includes the whole period each bound names.
const TIME_BOUND_DESCRIPTION = "ISO 8601 calendar value without an offset: YYYY, YYYY-MM, YYYY-MM-DD or YYYY-MM-DDTHH:MM[:SS[.sss]], optionally ending in Z. The window includes the whole period a bound names.";

export const JOURNAL_READ_ONLY_MCP_TOOLS = Object.freeze([
  Object.freeze({
    name: "search_journal_graph",
    title: "Search private journal evidence",
    description: "Search one authorized immutable journal snapshot with bounded, snapshot-bound pagination.",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["case_id", "corpus_id", "query"],
      properties: {
        case_id: { type: "string", pattern: "^[a-z0-9][a-z0-9_-]{0,79}$" },
        corpus_id: { type: "string", pattern: "^[A-Za-z0-9:_-]{1,160}$" },
        query: { type: "string", minLength: 1, maxLength: 4_000 },
        purpose: { enum: [...READ_PURPOSES] },
        graph_enabled: { type: "boolean", default: true },
        filters: {
          type: "object",
          description: "Optional; applied before paging, and bound into the cursor.",
          properties: {
            kinds: { type: "array", items: { type: "string" } },
            lifecycles: { type: "array", items: { type: "string" } },
            from: { type: ["string", "null"], description: TIME_BOUND_DESCRIPTION },
            to: { type: ["string", "null"], description: TIME_BOUND_DESCRIPTION },
            include_unknown: { type: "boolean", default: true, description: "Whether a record with no known time stays in a time window." }
          }
        },
        page_size: { type: "integer", minimum: 1, maximum: PAGE_SIZE_MAX, default: PAGE_SIZE_DEFAULT },
        cursor: { type: ["string", "null"] }
      }
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }),
  Object.freeze({
    name: "get_journal_subgraph",
    title: "Get private journal evidence group",
    description: "Load a bounded evidence group with mandatory correction, qualification, contradiction, exception and source closure.",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["case_id", "corpus_id", "seed_ids"],
      properties: {
        case_id: { type: "string", pattern: "^[a-z0-9][a-z0-9_-]{0,79}$" },
        corpus_id: { type: "string", pattern: "^[A-Za-z0-9:_-]{1,160}$" },
        seed_ids: { type: "array", minItems: 1, maxItems: 50, items: { type: "string" } },
        purpose: { enum: [...READ_PURPOSES] },
        node_limit: { type: "integer", minimum: 1, maximum: 100, default: 100 }
      }
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }),
  Object.freeze({
    name: "resolve_journal_evidence",
    title: "Resolve exact private journal sources",
    description: "Resolve authorized passage IDs to integrity-checked exact source spans and source locators.",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["case_id", "corpus_id", "evidence_ids"],
      properties: {
        case_id: { type: "string", pattern: "^[a-z0-9][a-z0-9_-]{0,79}$" },
        corpus_id: { type: "string", pattern: "^[A-Za-z0-9:_-]{1,160}$" },
        evidence_ids: { type: "array", minItems: 1, maxItems: PAGE_SIZE_MAX, items: { type: "string" } },
        purpose: { enum: [...READ_PURPOSES] }
      }
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }),
  Object.freeze({
    name: "get_journal_timeline",
    title: "Get private journal timeline",
    description: "Read the authorized known-time lane, one entry per record and time interval labeled with the field that places it, plus explicitly separate unknown-time records, with bounded, snapshot-bound pagination.",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["case_id", "corpus_id"],
      properties: {
        case_id: { type: "string", pattern: "^[a-z0-9][a-z0-9_-]{0,79}$" },
        corpus_id: { type: "string", pattern: "^[A-Za-z0-9:_-]{1,160}$" },
        purpose: { enum: [...READ_PURPOSES] },
        from: { type: ["string", "null"], description: TIME_BOUND_DESCRIPTION },
        to: { type: ["string", "null"], description: TIME_BOUND_DESCRIPTION },
        include_unknown: { type: "boolean", default: true },
        page_size: { type: "integer", minimum: 1, maximum: PAGE_SIZE_MAX, default: PAGE_SIZE_DEFAULT },
        cursor: { type: ["string", "null"] }
      }
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  })
]);

export function createJournalPrivateApi({ caseAccessService, jobController = null } = {}) {
  invariant(caseAccessService && typeof caseAccessService.withJournalCorpus === "function", "PRIVATE_CASE_JOURNAL_ACCESS_REQUIRED");

  const withReader = async ({ caseId, corpusId, purpose }, authContext, operation) => caseAccessService.withJournalCorpus(
    checkedId(caseId, "case_id"),
    checkedId(corpusId, "corpus_id"),
    { requiredScope: PRIVATE_CASE_SCOPES.READ, requiredPurpose: readPurpose(purpose) },
    async ({ caseStore, corpusStore, cursorSecret, reference }) => {
      invariant(reference.active_generation != null, "SOURCE_UNAVAILABLE");
      const snapshot = {
        generation: reference.active_generation,
        manifest_object_id: reference.manifest_object_id,
        visibility_epoch: reference.visibility_epoch
      };
      const reader = await openPrivateJournalGraph({
        corpusStore,
        manifestObjectId: snapshot.manifest_object_id,
        caseId,
        corpusId,
        generation: snapshot.generation,
        visibilityEpoch: snapshot.visibility_epoch,
        purpose: readPurpose(purpose),
        cursorSecret,
        assertSnapshotCurrent: async () => {
          await recheckSnapshot(caseStore, caseId, corpusId, snapshot);
          return true;
        }
      });
      try {
        invariant(reader.manifest.permitted_uses?.includes(readPurpose(purpose)), "GRANT_REVOKED");
        const value = await operation(reader, snapshot);
        await recheckSnapshot(caseStore, caseId, corpusId, snapshot);
        return value;
      } finally { reader.close(); }
    },
    authContext
  );

  const api = {
    async commit(input, authContext) {
      const caseId = checkedId(input?.caseId, "case_id");
      const corpusId = checkedId(input?.corpusId, "corpus_id");
      const generation = checkedId(input?.generation, "generation");
      const manifestObjectId = checkedId(input?.manifestObjectId, "manifest_object_id");
      const permittedUses = [...new Set(input?.permittedUses ?? [])].sort();
      invariant(permittedUses.length > 0 && permittedUses.every((use) => ["archive", "organize_search", "session_use"].includes(use)), "PERMITTED_USES_INVALID");
      const requiredPurpose = permittedUses.includes("session_use")
        ? PRIVATE_JOURNAL_PURPOSES.SESSION_USE
        : permittedUses.includes("organize_search")
          ? PRIVATE_JOURNAL_PURPOSES.ORGANIZE_SEARCH
          : PRIVATE_JOURNAL_PURPOSES.ARCHIVE;
      return caseAccessService.withJournalCorpus(
        caseId,
        corpusId,
        { requiredScope: PRIVATE_CASE_SCOPES.WRITE, requiredPurpose },
        async ({ caseStore, corpusStore, reference }) => {
          const manifest = await corpusStore.readJsonObject({ objectId: manifestObjectId });
          invariant(manifest.case_id === caseId && manifest.corpus_id === corpusId && manifest.generation === generation, "GRAPH_MANIFEST_SCOPE_MISMATCH");
          invariant(JSON.stringify(manifest.permitted_uses) === JSON.stringify(permittedUses), "PERMITTED_USES_MISMATCH");
          // A manifest staged before a visibility change belongs to the revoked snapshot: publishing it
          // would activate a generation that every reader then refuses.
          invariant(manifest.visibility_epoch === reference.visibility_epoch, "GRANT_REVOKED");
          const before = await caseStore.load(caseId);
          const result = await caseStore.publishJournalGeneration(caseId, {
            corpusId,
            generation,
            manifestObjectId,
            // Undefined means "whatever is active now"; null asserts that nothing is active yet.
            expectedGeneration: input.expectedGeneration === undefined ? reference.active_generation : input.expectedGeneration,
            expectedCaseRevision: input.expectedCaseRevision ?? before.revision,
            expectedVisibilityEpoch: reference.visibility_epoch
          });
          const after = await caseStore.load(caseId);
          invariant(JSON.stringify(before.case_state) === JSON.stringify(after.case_state), "CASE_STATE_CHANGED_BY_JOURNAL_COMMIT");
          invariant(JSON.stringify(before.raw_transcript) === JSON.stringify(after.raw_transcript), "TRANSCRIPT_CHANGED_BY_JOURNAL_COMMIT");
          invariant(JSON.stringify(before.candidate_responses) === JSON.stringify(after.candidate_responses), "CANDIDATE_CHANGED_BY_JOURNAL_COMMIT");
          return Object.freeze({ active_generation: result.active_generation, visibility_epoch: result.visibility_epoch, case_revision: result.case_revision });
        },
        authContext
      );
    },

    async search(input, authContext) {
      return withReader(input, authContext, async (reader, snapshot) => {
        const result = await reader.search({
          query: input.query,
          graphEnabled: input.graphEnabled !== false,
          filters: input.filters ?? {},
          pageSize: pageSize(input.pageSize),
          cursor: input.cursor ?? null,
          sort: input.sort ?? "source_order"
        });
        return Object.freeze({
          items: result.records,
          next_cursor: result.next_cursor,
          snapshot: { generation: snapshot.generation, visibility_epoch: snapshot.visibility_epoch },
          coverage: result.read_receipt,
          more_available: result.more_available
        });
      });
    },

    async getSubgraph(input, authContext) {
      return withReader(input, authContext, async (reader, snapshot) => {
        const group = await reader.evidenceGroup(input.seedIds, { maximumNodes: Math.min(input.nodeLimit ?? 100, 100), maximumEdges: 200 });
        return Object.freeze({
          nodes: group.nodes,
          edges: group.edges,
          next_cursor: null,
          closure_status: group.status,
          coverage: { generation: snapshot.generation, visibility_epoch: snapshot.visibility_epoch },
          more_available: group.more_available
        });
      });
    },

    async resolveEvidence(input, authContext) {
      return withReader(input, authContext, async (reader, snapshot) => ({
        ...(await reader.resolveEvidence(input.evidenceIds)),
        next_cursor: null,
        snapshot: { generation: snapshot.generation, visibility_epoch: snapshot.visibility_epoch }
      }));
    },

    async timeline(input, authContext) {
      return withReader(input, authContext, async (reader, snapshot) => {
        const result = await reader.timeline({
          from: input.from ?? null,
          to: input.to ?? null,
          includeUnknown: input.includeUnknown !== false,
          pageSize: pageSize(input.pageSize),
          cursor: input.cursor ?? null
        });
        return Object.freeze({
          items: result.records,
          unknown_count: result.unknown_count,
          more_available: result.more_available,
          next_cursor: result.next_cursor,
          snapshot: { generation: snapshot.generation, visibility_epoch: snapshot.visibility_epoch }
        });
      });
    },

    async handoffSnapshot(caseId, authContext) {
      const context = await caseAccessService.loadCaseContext(caseId, authContext, {
        requireContinuationSafe: true,
        requireAuditScope: true,
        journalContinuitySupported: true,
        episodePolicy: { requireCompleteEpisode: true }
      });
      return Object.freeze({
        case_id: context.case_id,
        journal_continuity: context.journal_continuity,
        current_episode: context.current_episode,
        candidate_response: context.candidate_response,
        continuation_safety: context.continuation_safety
      });
    },

    async changeVisibility(input, authContext) {
      return caseAccessService.incrementJournalVisibilityEpoch(input.caseId, {
        corpusId: input.corpusId,
        expectedEpoch: input.expectedEpoch
      }, authContext);
    },

    async rollback(input, authContext) {
      return caseAccessService.rollbackJournalGeneration(input.caseId, {
        corpusId: input.corpusId,
        targetGeneration: input.targetGeneration,
        expectedGeneration: input.expectedGeneration
      }, authContext);
    },

    async createJob(input) { invariant(jobController?.initialize, "JOURNAL_JOB_CONTROLLER_UNAVAILABLE"); return jobController.initialize(input); },
    async start() { invariant(jobController?.runUntilBlocked, "JOURNAL_JOB_CONTROLLER_UNAVAILABLE"); return jobController.runUntilBlocked(); },
    async step() { invariant(jobController?.step, "JOURNAL_JOB_CONTROLLER_UNAVAILABLE"); return jobController.step(); },
    async status() { invariant(jobController?.status, "JOURNAL_JOB_CONTROLLER_UNAVAILABLE"); return jobController.status(); },
    async pause() { throw new ValidationError("JOURNAL_PAUSE_NOT_AVAILABLE_AT_THIS_FRONTIER", { code: "JOURNAL_PAUSE_NOT_AVAILABLE_AT_THIS_FRONTIER" }); },
    async putChunk() { throw new ValidationError("JOURNAL_INTAKE_CONTROLLER_UNAVAILABLE", { code: "JOURNAL_INTAKE_CONTROLLER_UNAVAILABLE" }); },
    async sealSource() { throw new ValidationError("JOURNAL_INTAKE_CONTROLLER_UNAVAILABLE", { code: "JOURNAL_INTAKE_CONTROLLER_UNAVAILABLE" }); },
    async review() { throw new ValidationError("JOURNAL_REVIEW_CONTROLLER_UNAVAILABLE", { code: "JOURNAL_REVIEW_CONTROLLER_UNAVAILABLE" }); },
    async correct() { throw new ValidationError("JOURNAL_CORRECTION_CONTROLLER_UNAVAILABLE", { code: "JOURNAL_CORRECTION_CONTROLLER_UNAVAILABLE" }); },
    async delete() { throw new ValidationError("JOURNAL_DELETE_REQUIRES_SEPARATE_AUTHORITY", { code: "JOURNAL_DELETE_REQUIRES_SEPARATE_AUTHORITY" }); },
    async export() { throw new ValidationError("JOURNAL_EXPORT_CONTROLLER_UNAVAILABLE", { code: "JOURNAL_EXPORT_CONTROLLER_UNAVAILABLE" }); }
  };
  return Object.freeze(api);
}
