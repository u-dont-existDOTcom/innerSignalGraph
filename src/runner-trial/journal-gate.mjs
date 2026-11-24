import { coldTestReceiptMatches, coldTestReceiptNames, journalConsentCurrent, readColdTestReceipt, readRunnerClients } from "./clients.mjs";

// The runner trial's journal gate (docs/superpowers/specs/2026-11-23-runner-client-cases-design.md, point 5; the owner's answer 1a
// to question i73): a client's journal reaches a turn only through pull request 241's session-use reader, and only when all three
// hold for that client at that moment:
//   (a) the owner has confirmed the client's consent and not withdrawn it (clients.json, read at every retrieval and again after the
//       read, because a grant is read only when the server starts);
//   (b) the client's journal copy in their runner case has an active generation published for session_use (the reader's own check,
//       under the client's own grant, which holds the session_use purpose only after a consent);
//   (c) a passing cold-test receipt names exactly the snapshot the reader read (the case, corpus, generation, manifest and visibility
//       epoch: a pass on another generation, the server's included, doesn't carry over), the version of the reader that reads it (a pass
//       of another reader's search doesn't either) and the pass rule as it is (nor does a pass by an earlier rule).
// Short of any of them, the turn's snapshot records a journal part with no quotations and the reason, and the reply is made from
// the conversation alone, as without a journal. Only quotations the reader verified against the stored bytes are ever returned.
// Nothing here copies or tests a journal: the copy step (an export where the journal lives, on the owner's go, and an import into the
// client's runner case) and the cold test are their own commands (src/cli/journal-import.mjs, scripts/runner-trial-journal.mjs).

const closed = (availability, reason) => ({
  availability,
  retrieval_status: availability === "unavailable" ? "failed" : "not_attempted",
  source_items: [], receipts: [], coverage: null, more_available: false,
  omissions: [{ reason, count: 1 }],
  budget: { max_tokens: 8000, max_bytes: 64000, used_tokens: 0, used_bytes: 0 }
});

// The replies' reader as the trial builds it and asks it: for this gate, a reply's evidence, and for the cold test, what its consumer is
// given (src/runner-trial/journal-cold-test.mjs). One function for both, so that the test can't give it anything but what a reply gets.
// `read` with a message alone is the message's own search; a repair's expansion adds its questions and the part they add to. `version`
// names what the reader gives, for the receipt.
//
// The reader needs an installed package (the journal contracts' ajv), and the app's server starts without any
// (tests/runtime-service-liveness.test.mjs): so it is loaded when a client's journal is first read or its receipt first checked, never at
// the start. One that can't be loaded is a failed retrieval like any other (the turn controller's journalPart): the reply is made from the
// conversation alone.
// How long a reply waits for a journal search (the turn controller's limit, and the cold test's).
export const JOURNAL_SEARCH_TIMEOUT_MS = 4000;

export async function openSessionUseReader({ caseAccessService, corpusId }) {
  const { SESSION_USE_READER_VERSION, createSessionUseJournalEvidenceProvider } = await import("../journal-import/response-evidence-journal.mjs");
  // It gives each quotation its note (when it was written, its wording cues, its lifecycle): no other build opens the trial's vault.
  const provider = createSessionUseJournalEvidenceProvider({ caseAccessService, corpusId, journalNotes: true });
  return Object.freeze({
    version: SESSION_USE_READER_VERSION,
    read: ({ caseId, query, questions = null, addsTo = null, maximumTokens = 8000, maximumBytes = 64000, authContext }) =>
      provider.freezeResponseEvidenceJournal({ caseId, query, questions, addsTo, maximumTokens, maximumBytes, authContext })
  });
}

export function createRunnerJournalGate({ trialDir, caseAccessService, readerFor = openSessionUseReader, clientsFor = () => readRunnerClients(trialDir) }) {
  const readers = new Map();
  const readerOf = async (corpusId) => {
    if (!readers.has(corpusId)) readers.set(corpusId, await readerFor({ caseAccessService, corpusId }));
    return readers.get(corpusId);
  };
  const clientFor = async (caseId) => {
    try { return (await clientsFor()).clients.find((client) => client.case_id === caseId) ?? null; }
    catch { return undefined; }
  };
  return Object.freeze({
    async freezeResponseEvidenceJournal({ caseId, query, questions, addsTo, maximumTokens, maximumBytes, authContext } = {}) {
      const client = await clientFor(caseId);
      if (client === undefined) return closed("unavailable", "client_list_unreadable");
      if (!client || client.journal.corpus_id === null) return closed("not_configured", "no_journal_copy");
      if (!journalConsentCurrent(client)) return closed("not_authorized", "journal_consent_missing");
      const receipt = await readColdTestReceipt(trialDir, caseId);
      if (!receipt || receipt.corpus_id !== client.journal.corpus_id) return closed("unavailable", "cold_test_receipt_missing");
      const reader = await readerOf(client.journal.corpus_id);
      // Before anything of the journal is read: a receipt that names no reader (an earlier test's), another than this one, or another rule.
      if (!coldTestReceiptNames(receipt, reader.version)) return closed("unavailable", "cold_test_receipt_mismatch");
      const result = await reader.read({ caseId, query, questions, addsTo, maximumTokens, maximumBytes, authContext });
      if (result?.availability !== "available") return result;
      const read = result.receipts?.[0];
      const matches = (named) => coldTestReceiptMatches(named, { caseId, corpusId: read.corpus_id, generation: read.generation, manifestObjectId: read.manifest_object_id,
        visibilityEpoch: read.visibility_epoch, readerVersion: reader.version });
      if (!read || !matches(receipt)) return closed("unavailable", "cold_test_receipt_mismatch");
      // The consent and the receipt again, now that the read is done: one withdrawn or replaced during it keeps every quotation out.
      const after = await clientFor(caseId);
      if (!journalConsentCurrent(after) || after.journal.corpus_id !== client.journal.corpus_id) return closed("not_authorized", "journal_consent_missing");
      if (!matches(await readColdTestReceipt(trialDir, caseId))) return closed("unavailable", "cold_test_receipt_mismatch");
      return result;
    },
    // Whether the client's journal gate is open now (design, point 5): the owner's confirmation of the consent stands, the client
    // list names the copy, the client's current grant opens it for session_use, and a passing cold-test receipt names exactly its
    // current publication (generation, manifest, epoch), the reader it would be read with and the pass rule as it is. A case that has read
    // its journal makes no model call and delivers nothing while this is false (the trial's runtime), so a withdrawal, a lost or replaced
    // receipt, a new publication without its own receipt, a reader other than the one tested (or one that can't be loaded), a changed rule
    // or a grant without the purpose stops everything of that case at once.
    // The consent is read again last, after the copy's publication and the receipt, so that a withdrawal that completes while those
    // are read is seen (Codex's review 3): what the caller then does (a worker's send, a delivery) follows with no further wait.
    async openNow({ caseId, authContext } = {}) {
      const client = await clientFor(caseId);
      if (!client || !journalConsentCurrent(client) || client.journal.corpus_id === null) return false;
      let reference = null, reader = null;
      try {
        ({ reference } = await caseAccessService.inspectJournalCorpus(caseId, client.journal.corpus_id, { requiredScope: "case:read", requiredPurpose: "session_use" }, authContext));
        reader = await readerOf(client.journal.corpus_id);
      } catch { return false; }
      if (!reference?.active_generation) return false;
      const receipt = await readColdTestReceipt(trialDir, caseId);
      if (!coldTestReceiptMatches(receipt, { caseId, corpusId: client.journal.corpus_id, generation: reference.active_generation, manifestObjectId: reference.manifest_object_id,
        visibilityEpoch: reference.visibility_epoch, readerVersion: reader.version })) return false;
      const last = await clientFor(caseId);
      return journalConsentCurrent(last) && last.journal.corpus_id === client.journal.corpus_id;
    }
  });
}
