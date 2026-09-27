import test from "node:test";
import assert from "node:assert/strict";
import { runSavedProfileColdConsumer } from "../src/journal-import/cold-profile-runner.mjs";

test("cold process opens only a saved session-use profile snapshot and closes its reader", async () => {
  const reference = { active_generation: "generation:synthetic",
    manifest_object_id: "manifest:synthetic", visibility_epoch: 0 };
  const checks = [], calls = [], saved = new Map();
  let inspections = 0;
  const service = {
    async verifyCaseAccess(id, request) {
      assert.equal(id, "case:synthetic");
      checks.push(request);
    },
    async inspectJournalCorpus(id, corpus, request) {
      assert.deepEqual([id, corpus], ["case:synthetic", "corpus:synthetic"]);
      assert.deepEqual(request, { requiredScope: "case:write", requiredPurpose: "session_use" });
      inspections += 1;
      return { reference };
    },
    async withJournalCorpus(id, corpus, request, callback) {
      assert.deepEqual(request, { requiredScope: "case:write", requiredPurpose: "session_use" });
      return callback({ corpusStore: { saved: true }, cursorSecret: Buffer.alloc(32, 7), reference });
    }
  };
  let closed = false;
  const openReader = async options => {
    assert.equal(options.manifestObjectId, reference.manifest_object_id);
    assert.equal(options.purpose, "session_use");
    assert.deepEqual(Object.keys(options).sort(), [
      "assertSnapshotCurrent", "caseId", "corpusId", "corpusStore", "cursorSecret",
      "generation", "manifestObjectId", "purpose", "visibilityEpoch"
    ]);
    assert.equal(await options.assertSnapshotCurrent(), true);
    return {
      async search() {
        assert.equal(await options.assertSnapshotCurrent(), true);
        return { records: [{ id: "passage:synthetic", kind: "passage" }],
          total_matches: 1, next_cursor: null };
      },
      close() { closed = true; }
    };
  };
  const port = { async invoke({ packet }) {
    calls.push(packet);
    assert.equal(Object.hasOwn(packet, "source_upload"), false);
    assert.equal(packet.grant_purpose, "session_use");
    return { output: { schema_version: "1.0", question_id: packet.frozen_question.id,
      answer: "Synthetic saved passage.", answerability: "supported",
      evidence_ids: ["passage:synthetic"], qualifier_ids: [],
      snapshot_generation: reference.active_generation,
      coverage_note: "Only the saved synthetic passage.", more_available: false },
      receipt: { receipt_id: "receipt:synthetic" } };
  } };
  const readIfPresent = async id => saved.get(id) ?? null;
  const writeOnce = async (id, value) => { saved.set(id, value); return value; };
  const result = await runSavedProfileColdConsumer({
    service, auth: { bearerToken: "synthetic" },
    caseId: "case:synthetic", corpusId: "corpus:synthetic",
    expectedGeneration: reference.active_generation,
    questions: [{ id: "question:synthetic", question: "Invented detail?" }],
    port, grant: { purpose: "session_use", allowed_roles: ["cold_consumer"] },
    readIfPresent, writeOnce, openReader, requiredScope: "case:write"
  });
  assert.equal(result[0].variants.length, 2);
  assert.equal(calls.length, 2);
  assert.equal(closed, true);
  assert.ok(checks.length >= 3);
  assert.ok(inspections >= 3);
  assert.ok(checks.every(check => check.requiredPurpose === "session_use"
    && check.requiredScope === "case:write"));
});

test("cold process refuses an unpublished or changed generation before inference", async () => {
  let invoked = false;
  const service = {
    async verifyCaseAccess() {},
    async inspectJournalCorpus(_case, _corpus, request) {
      assert.deepEqual(request, { requiredScope: "case:read", requiredPurpose: "session_use" });
      return { reference: { active_generation: "generation:old",
        manifest_object_id: "manifest:old", visibility_epoch: 0 } };
    },
    async withJournalCorpus() { invoked = true; }
  };
  await assert.rejects(() => runSavedProfileColdConsumer({
    service, auth: {}, caseId: "case:synthetic", corpusId: "corpus:synthetic",
    expectedGeneration: "generation:new", questions: [{ id: "q", question: "Detail?" }],
    grant: { purpose: "session_use", allowed_roles: ["cold_consumer"] }
  }), { code: "COLD_PROFILE_GENERATION_NOT_SAVED" });
  assert.equal(invoked, false);
});

test("cold retrieval refreshes expiring session credentials before each saved-profile search", async () => {
  const reference = { active_generation: "generation:synthetic",
    manifest_object_id: "manifest:synthetic", visibility_epoch: 0 };
  const seen = [], auth = {}, saved = new Map();
  let issued = 0;
  const service = {
    async verifyCaseAccess(_case, _request, credentials) {
      assert.ok(credentials.bearerToken?.startsWith("refreshed:"));
      seen.push(credentials.bearerToken);
    },
    async inspectJournalCorpus() { return { reference }; },
    async withJournalCorpus(_case, _corpus, _request, callback) {
      return callback({ corpusStore: {}, cursorSecret: Buffer.alloc(32), reference });
    }
  };
  const results = await runSavedProfileColdConsumer({
    service, auth, caseId: "case:synthetic", corpusId: "corpus:synthetic",
    expectedGeneration: reference.active_generation,
    questions: [{ id: "q", question: "Which synthetic detail?" }],
    grant: { purpose: "session_use", allowed_roles: ["cold_consumer"] },
    authContextProvider: async () => ({ bearerToken: `refreshed:${++issued}` }),
    openReader: async options => ({
      async search() {
        assert.equal(await options.assertSnapshotCurrent(), true);
        return { records: [], total_matches: 0, next_cursor: null };
      },
      close() {}
    }),
    port: { async invoke({ packet }) {
      return { output: { question_id: packet.frozen_question.id,
        snapshot_generation: reference.active_generation, answerability: "not_found",
        evidence_ids: [], qualifier_ids: [] }, receipt: {} };
    } },
    readIfPresent: async key => saved.get(key) ?? null,
    writeOnce: async (key, value) => { saved.set(key, value); return value; },
    requiredScope: "case:write"
  });
  assert.equal(results[0].variants.length, 2);
  assert.ok(new Set(seen).size > 2);
});

test("cold process refuses a corpus that was never created before inference", async () => {
  let invoked = false;
  const service = {
    async verifyCaseAccess() {},
    async inspectJournalCorpus() { return { reference: null }; },
    async withJournalCorpus() { invoked = true; }
  };
  await assert.rejects(() => runSavedProfileColdConsumer({
    service, auth: {}, caseId: "case:synthetic", corpusId: "corpus:synthetic",
    expectedGeneration: "generation:new", questions: [{ id: "q", question: "Detail?" }],
    grant: { purpose: "session_use", allowed_roles: ["cold_consumer"] }
  }), { code: "COLD_PROFILE_GENERATION_NOT_SAVED" });
  assert.equal(invoked, false);
});
