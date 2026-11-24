import { randomUUID } from "node:crypto";
import { ValidationError } from "../core/errors.mjs";
import { sha256Json, sha256Text } from "../supervisor/response-evidence-contract.mjs";
import { EVIDENCE_QUOTE_SEARCH, createJournalResultCache, openPrivateJournalGraph } from "./retrieval.mjs";

const access = Object.freeze({ requiredScope: "case:read", requiredPurpose: "session_use" });
// How many quotations a snapshot holds at most: the message's own search, and a snapshot that the evidence expansion adds to; and how
// many of an expansion's questions are searched. Quotations go with every call of the writer and the checker, so there are few.
export const SESSION_USE_READER_LIMITS = Object.freeze({ message: 6, expanded: 12, questions: 4 });
// What a message or a question gets from a journal, by name: change it whenever this reader would return something else for the same
// words and the same publication. The search's own version is part of it. (A cold test's pass can be bound to it; it isn't yet.)
export const SESSION_USE_READER_VERSION = `session-use-reader-v2:${EVIDENCE_QUOTE_SEARCH.version}`;
const empty = (availability, retrieval_status = "not_attempted") => ({
  availability, retrieval_status, source_items: [], receipts: [], coverage: null, more_available: false, omissions: [],
  budget: { max_tokens: 8000, max_bytes: 64000, used_tokens: 0, used_bytes: 0 }
});
const refused = new Set(["PRIVATE_CASE_ACCESS_DENIED", "GRANT_REVOKED", "GRAPH_MANIFEST_SCOPE_MISMATCH", "GRAPH_RECORD_SCOPE_MISMATCH"]);
const bounded = (value) => typeof value === "string" && value.length <= EVIDENCE_QUOTE_SEARCH.queryCharacters;
const searchable = (value) => bounded(value) && value.trim().length > 0;

// What was searched and what that can't show, for the models that read the quotations. `matched` counts the passages kept, without those
// looked at that may not be used; with none left, it says why, so that a message whose words many passages hold isn't told as one the
// journal says nothing about.
function coverageOf({ expansion, searches, found, returned }) {
  const kept = found.reduce((sum, search) => sum + search.kept, 0);
  const matched = kept - found.reduce((sum, search) => sum + search.omitted.reduce((count, entry) => count + entry.count, 0), 0);
  const shared = found.reduce((sum, search) => sum + search.shared, 0);
  const onlyCommon = found.length > 0 && found.every((search) => search.terms.chosen.length === 0 && search.terms.dropped.some((entry) => entry.reason === "common"));
  const usable = matched === 0 && kept > 0 ? " that may be used" : "";
  const none = kept > 0 || found.length === 0 ? "" : shared > 0 ? `; ${shared} passages share one of those words, none specifically enough to be returned`
    : onlyCommon ? "; every word of it that the journal holds is in too many passages to search by" : "; no passage holds any of them";
  const search = expansion
    ? `${searches} ranked ${searches === 1 ? "search" : "searches, each"} for the less common words of one missing-history question; ${matched} matching passages${usable}, counted for each question${none}; ${returned} exact quotations added.`
    : `One ranked search for the message's less common words; ${matched} matching passages${usable}${none}; ${returned} exact quotations returned.`;
  return `${search} Sharing words doesn't make a quotation relevant to the ${expansion ? "question" : "message"}, and wording cues are found for English wording only. Coverage is limited to ${expansion ? "these searches" : "this search"} and the published generation; no review of the whole journal and no independent verification of events is claimed.`;
}

// Opt-in reader only: the runner trial's journal gate constructs it; no server or CLI does. Cached entries are identifiers and counts,
// never journal text; every call reauthorizes and opens the active published snapshot, including a cache hit. No refused source is
// retried by another route.
// `journalNotes` gives each quotation its journal_note (when it was written, its wording cues, its lifecycle). Only the trial asks for
// it: a record that holds one can't be read by a build without the field, and the trial's vault is opened by no other build.
export function createSessionUseJournalEvidenceProvider({
  caseAccessService, corpusId, maximumResults = SESSION_USE_READER_LIMITS.expanded, journalNotes = false, resultCache = createJournalResultCache(), openReader = openPrivateJournalGraph
} = {}) {
  if (!caseAccessService || ["verifyCaseAccess", "inspectJournalCorpus", "withJournalCorpus"].some((name) => typeof caseAccessService[name] !== "function")
      || typeof corpusId !== "string" || !/^[A-Za-z0-9:_-]{1,160}$/.test(corpusId)
      || !Number.isSafeInteger(maximumResults) || maximumResults < 1 || maximumResults > SESSION_USE_READER_LIMITS.expanded || typeof journalNotes !== "boolean") {
    throw new ValidationError("Response evidence journal configuration invalid.", { code: "RESPONSE_EVIDENCE_INVALID" });
  }
  return Object.freeze({
    // `query` is the message. For an evidence expansion, `questions` are the missing-history questions, each searched on its own in place
    // of it, and `addsTo` the journal part of the snapshot it adds to, with its quotations.
    async freezeResponseEvidenceJournal({ caseId, query, questions = null, addsTo = null, maximumTokens = 8000, maximumBytes = 64000, authContext } = {}) {
      // This check precedes even corpus inspection and argument-dependent retrieval. A grant for search alone is insufficient.
      try { await caseAccessService.verifyCaseAccess(caseId, access, authContext); }
      catch (error) { if (refused.has(error?.code)) return empty("not_authorized"); throw error; }
      if (!(questions === null ? searchable(query) : bounded(query)) || (questions !== null && (!Array.isArray(questions) || !questions.length || !questions.every(bounded)))
          || (addsTo !== null && (questions === null || !Array.isArray(addsTo?.source_items) || !Array.isArray(addsTo.receipts) || !Array.isArray(addsTo.omissions)))
          || !Number.isSafeInteger(maximumTokens) || maximumTokens < 0 || maximumTokens > 8000
          || !Number.isSafeInteger(maximumBytes) || maximumBytes < 0 || maximumBytes > 64000) {
        throw new ValidationError("Response evidence journal request invalid.", { code: "RESPONSE_EVIDENCE_INVALID" });
      }
      const expansion = questions !== null;
      const asked = expansion ? questions.filter(searchable) : [query];
      const searches = expansion ? asked.slice(0, SESSION_USE_READER_LIMITS.questions) : asked;
      const limit = Math.min(maximumResults, expansion ? SESSION_USE_READER_LIMITS.expanded : SESSION_USE_READER_LIMITS.message);
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
            const result = empty("available"), returned = [];
            const omit = (reason, count = 1) => {
              const entry = result.omissions.find((item) => item.reason === reason);
              if (entry) entry.count += count; else result.omissions.push({ reason, count });
            };
            // A whole quotation within what is left of the budget, or an omission: none is ever cut.
            const admit = (item) => {
              const bytes = Buffer.byteLength(JSON.stringify(item.exact_excerpt), "utf8"), tokens = Math.ceil(bytes / 3);
              if (result.budget.used_bytes + bytes > maximumBytes || result.budget.used_tokens + tokens > maximumTokens) { omit("journal_budget"); return false; }
              result.source_items.push(item);
              result.budget.used_bytes += bytes; result.budget.used_tokens += tokens;
              return true;
            };
            // What an expansion adds to stays as it was: its quotations under their ids, so that a draft resting on one still can, the
            // receipts that returned them, its coverage and what it left out. Only what belongs to this very publication stays, and each
            // quotation is checked again as a search checks one; one that may no longer be used is left out, not the others.
            const prior = addsTo?.availability === "available" ? addsTo : null;
            const published = (entry) => entry?.corpus_id === corpusId && entry.generation === reference.active_generation && entry.visibility_epoch === reference.visibility_epoch;
            const receipts = (prior?.receipts ?? []).filter((receipt) => published(receipt) && receipt.manifest_object_id === reference.manifest_object_id);
            const bound = (prior?.source_items ?? []).filter((item) => published(item.locator) && receipts.some((receipt) => receipt.returned_source_ids.includes(item.id)));
            const texts = bound.length ? await reader.checkEvidenceQuotes(bound.map((item) => item.locator.record_id)) : [];
            const kept = bound.filter((item, index) => texts[index] === item.exact_excerpt);
            for (const item of kept) admit(structuredClone(item));
            // One ranked search for the message, or one for each question, for as many quotations as there is room for beside those the
            // snapshot has. The search's result cache includes case, corpus, purpose, generation, epoch, the words searched and the method
            // with its numbers.
            const found = [];
            const room = limit - result.source_items.length;
            const exclude = result.source_items.map((item) => item.locator.record_id);
            if (room > 0) for (const search of searches) found.push(await reader.findEvidenceQuotes({ query: search, limit: room, exclude }));
            // Why a passage may not be used (restricted, deleted, revoked) isn't told, only that some can't be.
            for (const { omitted } of found) for (const { count } of omitted) omit("quotation_not_usable", count);
            if (expansion && asked.length < questions.length) omit("question_not_searchable", questions.length - asked.length);
            if (expansion && asked.length > found.length) omit("question_limit", asked.length - found.length);
            // The best of each search in turn, without repeats.
            const taken = new Set(result.source_items.map((item) => item.locator.record_id));
            const queues = found.map(({ quotes }) => [...quotes]);
            const picked = [];
            while (queues.some((queue) => queue.length)) {
              for (const queue of queues) {
                while (queue.length && taken.has(queue[0].record_id)) queue.shift();
                if (!queue.length) continue;
                const quote = queue.shift();
                taken.add(quote.record_id);
                if (result.source_items.length + picked.length < limit) picked.push(quote);
              }
            }
            // A new quotation never takes an id that any earlier part, or a receipt of one, gave to other words.
            const usedIds = [...(addsTo?.source_items ?? []).map((item) => item.id), ...(addsTo?.receipts ?? []).flatMap((receipt) => receipt.returned_source_ids ?? [])];
            const firstNumber = 1 + Math.max(0, ...usedIds.map((id) => Number(/^src:journal:(\d+)$/u.exec(id)?.[1] ?? 0)));
            const before = { ...result.budget };
            for (const quote of picked) {
              const item = {
                id: `src:journal:${firstNumber + returned.length}`, kind: "journal_quotation", actor: "client", audience: "private_journal",
                time: { at: null, status: "unavailable" }, epistemic_status: "client_written_account",
                exact_excerpt: quote.text, excerpt_sha256: sha256Text(quote.text), excerpt_bytes: Buffer.byteLength(quote.text, "utf8"),
                locator: { kind: "journal", corpus_id: corpusId, generation: reference.active_generation, visibility_epoch: reference.visibility_epoch,
                  record_id: quote.record_id, start_byte: quote.start_byte, end_byte: quote.end_byte },
                ...(journalNotes ? { journal_note: structuredClone({ written: quote.written, cues: quote.cues, lifecycle: quote.lifecycle }) } : {})
              };
              if (admit(item)) returned.push(item);
            }
            const omitted = result.omissions.reduce((sum, entry) => sum + entry.count, 0);
            const included = new Set(result.source_items.map((item) => item.locator.record_id));
            // More was there to return: what the budget or the number of quotations or questions left out, never a passage that may not be used.
            const more = result.omissions.some((entry) => entry.reason !== "quotation_not_usable")
              || found.some((search) => search.kept - search.excluded > search.examined || search.quotes.some((quote) => !included.has(quote.record_id)));
            result.receipts = [{ operation_id: `journal-evidence:${randomUUID()}`, corpus_id: corpusId, generation: reference.active_generation,
              visibility_epoch: reference.visibility_epoch, manifest_object_id: reference.manifest_object_id,
              purpose: "session_use", query_sha256: sha256Text(searches.join("\n")), filters_sha256: sha256Json({ reader: SESSION_USE_READER_VERSION, limit }),
              returned_source_ids: returned.map((item) => item.id), packet_sha256: sha256Json(returned), more_available: more,
              omitted_count: omitted, budget_used_tokens: result.budget.used_tokens - before.used_tokens, budget_used_bytes: result.budget.used_bytes - before.used_bytes }, ...structuredClone(receipts)];
            const lost = (prior?.source_items.length ?? 0) - kept.length;
            for (const { reason, count } of prior?.omissions ?? []) omit(reason, count);
            if (lost > 0) omit("journal_binding_changed", lost);
            result.more_available = more || prior?.more_available === true || lost > 0;
            result.retrieval_status = result.source_items.length ? (result.more_available ? "partial" : "returned")
              : result.omissions.some((entry) => entry.reason === "journal_budget") ? "budget_exhausted" : result.more_available ? "partial" : "no_match";
            result.coverage = [prior?.coverage, coverageOf({ expansion, searches: found.length, found, returned: returned.length })]
              .filter(Boolean).join(" ");
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
