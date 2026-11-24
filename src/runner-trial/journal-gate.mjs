import { coldTestReceiptMatches, journalConsentCurrent, readColdTestReceipt, readRunnerClients } from "./clients.mjs";

// The runner trial's journal gate (docs/superpowers/specs/2026-11-23-runner-client-cases-design.md, point 5; the owner's answer 1a
// to question i73): a client's journal reaches a turn only through pull request 241's session-use reader, and only when all three
// hold for that client at that moment:
//   (a) the owner has confirmed the client's consent and not withdrawn it (clients.json, read at every retrieval and again after the
//       read, because a grant is read only when the server starts);
//   (b) the client's journal copy in their runner case has an active generation published for session_use (the reader's own check,
//       under the client's own grant, which holds the session_use purpose only after a consent);
//   (c) a passing cold-test receipt names exactly the snapshot the reader read: the case, corpus, generation, manifest and
//       visibility epoch (a pass on another generation, the server's included, doesn't carry over).
// Short of any of them, the turn's snapshot records a journal part with no quotations and the reason, and the reply is made from
// the conversation alone, as without a journal. Only quotations the reader verified against the stored bytes are ever returned.
// Nothing here copies a journal: the copy step (an export on the server, on the owner's go, and an import into the client's runner
// case) isn't built yet, and neither is the cold test, so for now no client's journal passes this gate.

const closed = (availability, reason) => ({
  availability,
  retrieval_status: availability === "unavailable" ? "failed" : "not_attempted",
  source_items: [], receipts: [], coverage: null, more_available: false,
  omissions: [{ reason, count: 1 }],
  budget: { max_tokens: 8000, max_bytes: 64000, used_tokens: 0, used_bytes: 0 }
});

// The reader needs an installed package (the journal contracts' ajv), and the app's server starts without any
// (tests/runtime-service-liveness.test.mjs): so it is loaded when a client's journal is first read, never at the start. One that
// can't be loaded is a failed retrieval like any other (the turn controller's journalPart): the reply is made from the conversation
// alone.
async function sessionUseReader(options) {
  const { createSessionUseJournalEvidenceProvider } = await import("../journal-import/response-evidence-journal.mjs");
  return createSessionUseJournalEvidenceProvider(options);
}

export function createRunnerJournalGate({ trialDir, caseAccessService, readerFor = null, clientsFor = () => readRunnerClients(trialDir) }) {
  const readers = new Map();
  const reader = async (corpusId) => {
    if (!readers.has(corpusId)) readers.set(corpusId, readerFor ? readerFor(corpusId) : await sessionUseReader({ caseAccessService, corpusId }));
    return readers.get(corpusId);
  };
  const clientFor = async (caseId) => {
    try { return (await clientsFor()).clients.find((client) => client.case_id === caseId) ?? null; }
    catch { return undefined; }
  };
  return Object.freeze({
    async freezeResponseEvidenceJournal({ caseId, query, maximumTokens = 8000, maximumBytes = 64000, authContext } = {}) {
      const client = await clientFor(caseId);
      if (client === undefined) return closed("unavailable", "client_list_unreadable");
      if (!client || client.journal.corpus_id === null) return closed("not_configured", "no_journal_copy");
      if (!journalConsentCurrent(client)) return closed("not_authorized", "journal_consent_missing");
      const receipt = await readColdTestReceipt(trialDir, caseId);
      if (!receipt || receipt.corpus_id !== client.journal.corpus_id) return closed("unavailable", "cold_test_receipt_missing");
      const result = await (await reader(client.journal.corpus_id)).freezeResponseEvidenceJournal({ caseId, query, maximumTokens, maximumBytes, authContext });
      if (result?.availability !== "available") return result;
      const read = result.receipts?.[0];
      if (!read || !coldTestReceiptMatches(receipt, { caseId, corpusId: read.corpus_id, generation: read.generation, manifestObjectId: read.manifest_object_id, visibilityEpoch: read.visibility_epoch })) {
        return closed("unavailable", "cold_test_receipt_mismatch");
      }
      // The consent and the receipt again, now that the read is done: one withdrawn or replaced during it keeps every quotation out.
      const after = await clientFor(caseId);
      if (!journalConsentCurrent(after) || after.journal.corpus_id !== client.journal.corpus_id) return closed("not_authorized", "journal_consent_missing");
      const receiptAfter = await readColdTestReceipt(trialDir, caseId);
      if (!coldTestReceiptMatches(receiptAfter, { caseId, corpusId: read.corpus_id, generation: read.generation, manifestObjectId: read.manifest_object_id, visibilityEpoch: read.visibility_epoch })) {
        return closed("unavailable", "cold_test_receipt_mismatch");
      }
      return result;
    },
    // Whether the client's journal gate is open now (design, point 5): the owner's confirmation of the consent stands, the client
    // list names the copy, the client's current grant opens it for session_use, and a passing cold-test receipt names exactly its
    // current publication (generation, manifest, epoch). A case that has read its journal makes no model call and delivers nothing
    // while this is false (the trial's runtime), so a withdrawal, a lost or replaced receipt, a new publication without its own
    // receipt or a grant without the purpose stops everything of that case at once.
    // The consent is read again last, after the copy's publication and the receipt, so that a withdrawal that completes while those
    // are read is seen (Codex's review 3): what the caller then does (a worker's send, a delivery) follows with no further wait.
    async openNow({ caseId, authContext } = {}) {
      const client = await clientFor(caseId);
      if (!client || !journalConsentCurrent(client) || client.journal.corpus_id === null) return false;
      let reference = null;
      try { ({ reference } = await caseAccessService.inspectJournalCorpus(caseId, client.journal.corpus_id, { requiredScope: "case:read", requiredPurpose: "session_use" }, authContext)); }
      catch { return false; }
      if (!reference?.active_generation) return false;
      const receipt = await readColdTestReceipt(trialDir, caseId);
      if (!coldTestReceiptMatches(receipt, { caseId, corpusId: client.journal.corpus_id, generation: reference.active_generation, manifestObjectId: reference.manifest_object_id, visibilityEpoch: reference.visibility_epoch })) return false;
      const last = await clientFor(caseId);
      return journalConsentCurrent(last) && last.journal.corpus_id === client.journal.corpus_id;
    }
  });
}
