import { randomUUID } from "node:crypto";
import { ValidationError } from "../core/errors.mjs";
import { sha256Json, sha256Text } from "../supervisor/response-evidence-contract.mjs";
import { createJournalResultCache, openPrivateJournalGraph } from "./retrieval.mjs";

const access = Object.freeze({ requiredScope: "case:read", requiredPurpose: "session_use" });
const filters = Object.freeze({ kinds: ["passage"], lifecycles: ["active", "candidate", "superseded"], from: null, to: null, include_unknown: true });
const empty = (availability, retrieval_status = "not_attempted") => ({
  availability, retrieval_status, source_items: [], receipts: [], coverage: null, more_available: false, omissions: [],
  budget: { max_tokens: 8000, max_bytes: 64000, used_tokens: 0, used_bytes: 0 }
});
const refused = new Set(["PRIVATE_CASE_ACCESS_DENIED", "GRANT_REVOKED", "GRAPH_MANIFEST_SCOPE_MISMATCH", "GRAPH_RECORD_SCOPE_MISMATCH"]);

// Opt-in reader only. No server/CLI constructs this provider. Cached entries are identifiers, never journal text; every call
// reauthorizes and opens the active published snapshot, including a cache hit. No refused source is retried by another route.
export function createSessionUseJournalEvidenceProvider({
  caseAccessService, corpusId, maximumResults = 40, resultCache = createJournalResultCache(), openReader = openPrivateJournalGraph
} = {}) {
  if (!caseAccessService || ["verifyCaseAccess", "inspectJournalCorpus", "withJournalCorpus"].some((name) => typeof caseAccessService[name] !== "function")
      || typeof corpusId !== "string" || !/^[A-Za-z0-9:_-]{1,160}$/.test(corpusId)
      || !Number.isSafeInteger(maximumResults) || maximumResults < 1 || maximumResults > 40) {
    throw new ValidationError("Response evidence journal configuration invalid.", { code: "RESPONSE_EVIDENCE_INVALID" });
  }
  return Object.freeze({
    async freezeResponseEvidenceJournal({ caseId, query, maximumTokens = 8000, maximumBytes = 64000, authContext } = {}) {
      // This check precedes even corpus inspection and argument-dependent retrieval. A grant for search alone is insufficient.
      try { await caseAccessService.verifyCaseAccess(caseId, access, authContext); }
      catch (error) { if (refused.has(error?.code)) return empty("not_authorized"); throw error; }
      if (typeof query !== "string" || !query.trim() || query.length > 4000
          || !Number.isSafeInteger(maximumTokens) || maximumTokens < 0 || maximumTokens > 8000
          || !Number.isSafeInteger(maximumBytes) || maximumBytes < 0 || maximumBytes > 64000) {
        throw new ValidationError("Response evidence journal request invalid.", { code: "RESPONSE_EVIDENCE_INVALID" });
      }
      try {
        const inspected = await caseAccessService.inspectJournalCorpus(caseId, corpusId, access, authContext);
        // A corpus handle from another case opens no objects and reveals no existence information.
        if (!inspected.reference) return empty("not_authorized");
        if (!inspected.reference.active_generation) return empty("unavailable");
        return await caseAccessService.withJournalCorpus(caseId, corpusId, access, async ({ corpusStore, cursorSecret, reference }) => {
          const sameSnapshot = (current) => current?.active_generation === reference.active_generation
            && current?.manifest_object_id === reference.manifest_object_id && current?.visibility_epoch === reference.visibility_epoch;
          if (!sameSnapshot(inspected.reference)) return empty("unavailable", "failed");
          const assertSnapshotCurrent = async () => {
            const current = await caseAccessService.inspectJournalCorpus(caseId, corpusId, access, authContext);
            return sameSnapshot(current.reference);
          };
          const reader = await openReader({ corpusStore, cursorSecret, caseId, corpusId, generation: reference.active_generation,
            manifestObjectId: reference.manifest_object_id, visibilityEpoch: reference.visibility_epoch, purpose: "session_use", resultCache, assertSnapshotCurrent });
          try {
            if (!reader.manifest.permitted_uses?.includes("session_use")) return empty("not_authorized");
            // One bounded search. Its existing result cache includes case, corpus, purpose, generation, epoch, query and filters.
            const found = await reader.search({ query, filters, pageSize: maximumResults });
            const result = empty("available");
            const omit = (reason) => {
              const entry = result.omissions.find((item) => item.reason === reason);
              if (entry) entry.count++; else result.omissions.push({ reason, count: 1 });
            };
            const eligible = [];
            for (const record of found.records) {
              if (record.data.disclosure === "restricted") { omit("restricted_quotation"); continue; }
              if (typeof record.data.quote !== "string" || !record.data.quote.length) { omit("quotation_unavailable"); continue; }
              const bytes = Buffer.byteLength(JSON.stringify(record.data.quote), "utf8"), tokens = Math.ceil(bytes / 3);
              if (result.budget.used_bytes + bytes > maximumBytes || result.budget.used_tokens + tokens > maximumTokens) { omit("journal_budget"); continue; }
              eligible.push(record);
              result.budget.used_bytes += bytes; result.budget.used_tokens += tokens;
            }
            // Verify every returned quotation against the encrypted representation's bytes, not only its record's quote field.
            if (eligible.length) await reader.resolveEvidence(eligible.map((record) => record.id));
            result.source_items = eligible.map((record, index) => ({
              id: `src:journal:${index + 1}`, kind: "journal_quotation", actor: "client", audience: "private_journal",
              time: { at: null, status: "unavailable" }, epistemic_status: "client_written_account",
              exact_excerpt: record.data.quote, excerpt_sha256: sha256Text(record.data.quote), excerpt_bytes: Buffer.byteLength(record.data.quote, "utf8"),
              locator: { kind: "journal", corpus_id: corpusId, generation: reference.active_generation, visibility_epoch: reference.visibility_epoch,
                record_id: record.id, start_byte: record.data.start_byte, end_byte: record.data.end_byte }
            }));
            const omitted = result.omissions.reduce((sum, entry) => sum + entry.count, 0);
            result.more_available = found.more_available || omitted > 0;
            result.retrieval_status = result.source_items.length ? (result.more_available ? "partial" : "returned")
              : result.omissions.some((entry) => entry.reason === "journal_budget") ? "budget_exhausted" : result.more_available ? "partial" : "no_match";
            result.coverage = `One targeted lexical search; ${found.total_matches} matching passages; ${result.source_items.length} exact quotations returned. Coverage is limited to this query and published generation; no full-journal review or independent verification of events is claimed.`;
            result.receipts = [{ operation_id: `journal-evidence:${randomUUID()}`, corpus_id: corpusId, generation: reference.active_generation,
              visibility_epoch: reference.visibility_epoch, purpose: "session_use", query_sha256: sha256Text(query), filters_sha256: sha256Json(filters),
              returned_source_ids: result.source_items.map((item) => item.id), packet_sha256: sha256Json(result.source_items), more_available: result.more_available,
              omitted_count: omitted, budget_used_tokens: result.budget.used_tokens, budget_used_bytes: result.budget.used_bytes }];
            if (!await assertSnapshotCurrent()) return empty("unavailable", "failed");
            return result;
          } finally { reader.close(); }
        }, authContext);
      } catch (error) {
        if (refused.has(error?.code)) return empty("not_authorized");
        return empty("unavailable", "failed");
      }
    }
  });
}
