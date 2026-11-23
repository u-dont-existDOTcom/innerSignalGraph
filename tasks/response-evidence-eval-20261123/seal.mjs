import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { applyCaseStatePatch, createEmptyCaseState } from "../../src/case-state/longitudinal-state.mjs";
import { createEncryptedPrivateCaseStore } from "../../src/storage/private-case-store.mjs";
import { createPrivateCaseAccessService } from "../../src/storage/private-case-access.mjs";
import { chunkExactSourceText } from "../../src/storage/exact-source-artifact.mjs";
import { createPrivateSupervisorDraftService, supervisorOperationKeyForIdempotencyKey } from "../../src/supervisor/private-supervisor-draft.mjs";
import { createPrivateTherapyModelRuntime } from "../../src/supervisor/private-therapy-model-runtime.mjs";
import { createCandidateAuditEvidence } from "../../src/supervisor/private-candidate-lifecycle.mjs";
import { PRIVATE_CANDIDATE_AUDIT_VERSION } from "../../src/supervisor/private-candidate-audit.mjs";
import { RESPONSE_EVIDENCE_DIMENSIONS, buildEvidenceModelView, sha256Json } from "../../src/supervisor/response-evidence-contract.mjs";
import { MANIFEST_SCHEMA, HARD_CAP, head, isolation, json, loadCorpus, outsideRepository, packetId, privateDirectory, sha256 } from "./common.mjs";

export const emptyReview = () => ({ coverage: RESPONSE_EVIDENCE_DIMENSIONS.map((dimension) => ({ dimension, status: "no_applicable_items", reason: "Scripted placeholder; no semantic assessment." })), items: [], missing_material_history: [] });
const AUTH = Object.freeze({});
const EPISODE = "episode:synthetic";

function caseState(caseId, firstText) {
  // Continuation-safe scaffolding points to the first *actual* client turn, even for a first-message case.
  // It adds no invented historical turn, diagnosis or earlier event.
  return applyCaseStatePatch(createEmptyCaseState({ caseId }), {
    items: [{ id: "evidence:first", domain: "long_term_target", statement: firstText, status: "direct_report", confidence: "high",
      source: { kind: "synthetic_turn", ref: "turn:user:1", turn_id: "turn:user:1", recorded_at: "2026-11-23T12:00:00.000Z" }, still_current: true, supersedes: [], decision_relevance: "high" }],
    current_episode: { id: EPISODE, target: "Listen to the synthetic client's current message.", route: "IC.PROTECTOR_ACTION", prediction: "The client can choose what to discuss.", next_question: "What matters now?",
      started_turn_id: "turn:user:1", constitutional_aim_ids: ["CARE", "PROTECTION"], adverse_signs: ["less choice"], stay_conditions: ["more choice"], switch_conditions: ["no useful movement"], stop_conditions: ["decline"], source_item_ids: ["evidence:first"] }
  });
}

function accessFor(rootDir, keys, policy, now, caseId) {
  return createPrivateCaseAccessService({ rootDir, responseEvidencePolicy: policy, now,
    authorizationProvider: { async authorize({ caseId: requested, requiredScope, requiredPurpose }) {
      return { allowed: requested === caseId, principalId: "synthetic-evaluation", scopes: [requiredScope], purposes: requiredPurpose ? [requiredPurpose] : [] };
    } }, keyProvider: { async getCaseKeyMaterial() { return { routineKek: Buffer.from(keys.routineKek), recoverySecretBytes: Buffer.from(keys.recoverySecretBytes), accessAssurance: "managed_secret_provider", managedSecretProvider: true }; } }
  });
}

async function journalPart(store, caseId, part) {
  if (!part) return { availability: "not_configured" };
  const { items, ...metadata } = part;
  if (part.availability !== "available") return { ...metadata, source_items: [] };
  const corpusId = "corpus:synthetic", generation = "generation:synthetic";
  await store.createJournalCorpus(caseId, { corpusId, manifestObjectId: "manifest:synthetic" });
  await store.publishJournalGeneration(caseId, { corpusId, generation, manifestObjectId: "manifest:synthetic" });
  const record = await store.load(caseId), epoch = record.journal_corpora[0].visibility_epoch;
  const sources = items.map((item, i) => ({ id: `src:journal:synthetic:${i + 1}`, kind: "journal_quotation", actor: "client", audience: "private_journal",
    time: { at: item.written_at, status: "known" }, epistemic_status: "client_written_account", excerpt_sha256: sha256(item.text), excerpt_bytes: Buffer.byteLength(item.text), exact_excerpt: item.text,
    locator: { kind: "journal", corpus_id: corpusId, generation, visibility_epoch: epoch, record_id: `record:${i + 1}`, start_byte: 0, end_byte: Buffer.byteLength(item.text) } }));
  return { ...metadata, source_items: sources, receipts: [{ operation_id: "retrieval:synthetic:1", corpus_id: corpusId, generation, visibility_epoch: epoch, purpose: "session_use",
    query_sha256: sha256("synthetic frozen retrieval"), filters_sha256: sha256Json({}), returned_source_ids: sources.map((s) => s.id), packet_sha256: sha256Json(sources),
    more_available: part.more_available, omitted_count: 0, budget_used_tokens: sources.reduce((sum, s) => sum + Math.ceil(Buffer.byteLength(JSON.stringify(s.exact_excerpt)) / 3), 0),
    budget_used_bytes: sources.reduce((sum, s) => sum + Buffer.byteLength(JSON.stringify(s.exact_excerpt)), 0) }] };
}

// One fresh encrypted store per case AND arm. Every history action uses the product's methods.
export async function buildCasePacket(spec, arm) {
  if (!["G", "E"].includes(arm)) throw new Error("Unknown arm.");
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-response-eval-"));
  await fs.chmod(rootDir, 0o700);
  const keys = { routineKek: randomBytes(32), recoverySecretBytes: randomBytes(32) };
  const caseId = `synthetic-${spec.id.toLowerCase()}`;
  let tick = 0, store;
  const now = () => new Date(Date.parse("2026-11-23T12:00:00.000Z") + tick++ * 1000).toISOString();
  const open = (policy) => createEncryptedPrivateCaseStore({ rootDir, ...keys, responseEvidencePolicy: policy, developmentExternalCredentialAuthorized: true, now });
  const requests = [];
  const provider = { id: "synthetic-packet-capture", model: "scripted-placeholder", privateInferenceIsolation: isolation,
    async generate(input) {
      if (input.sealed !== true || input.metadata?.freshContext !== true) throw new Error("Expected packet-only sealed audit.");
      requests.push({ system: input.system, user: input.user, outputSchema: input.outputSchema });
      const packet = JSON.parse(input.user.slice("AUTHORIZED AUDIT PACKET\n".length));
      return { responseId: `synthetic-capture:${requests.length}`, text: JSON.stringify({ findings: [], repair_induced_checks: packet.repair_induced_error_checks, ...(packet.response_evidence ? { evidence_review: emptyReview() } : {}) }) };
    } };
  // This consumer supplies the frozen, authorized journal itself. Declare that capability through
  // the existing access-service option; keep the real authorization and continuation checks active.
  const runtimeFor = (access) => createPrivateTherapyModelRuntime({ privateCaseSource: { ...access,
    loadCaseContext: (id, auth, options) => access.loadCaseContext(id, auth, { ...options, journalContinuitySupported: true })
  }, providers: { anthropic: provider }, config: {} });
  try {
    store = open("advisory");
    const access = accessFor(rootDir, keys, "advisory", now, caseId), runtime = runtimeFor(access);
    const drafts = createPrivateSupervisorDraftService({ privateCaseSource: access, modelRuntime: runtime, maximumInvocationAttempts: 1 });
    if (spec.history[0]?.step !== "client") throw new Error("History must start with the exact first client message.");
    await store.saveCaseState(caseId, caseState(caseId, spec.history[0].text));
    await store.saveCaseDiff(caseId, { schema_version: 1, additions: ["evidence:first"], current_episode_changed: true }, { turnId: "turn:user:1", diffId: "diff:synthetic" });
    // The continuation guard requires a retrievable provenance artifact when the entire episode is recent.
    // Preserve only the corpus's first message, not an invented older exchange. This artifact is not added to the audit packet.
    await access.saveSourceArtifact(caseId, "source:synthetic:first-message", chunkExactSourceText(spec.history[0].text), { kind: "exact_current_message_copy" }, AUTH);
    let latestClient, userCount = 0;
    for (const [index, step] of spec.history.entries()) {
      const key = `history:${index}`;
      switch (step.step) {
        case "client":
          userCount++;
          latestClient = { id: `turn:user:${userCount}`, exchange_id: `exchange:${userCount}`, role: "user", text: step.text, at: now(), episode_id: EPISODE };
          await access.appendTranscriptTurn(caseId, latestClient, AUTH);
          break;
        case "delivered_reply": {
          const id = `candidate:history:${index}`;
          await access.saveCandidateResponse(caseId, id, step.text, { producer_context_id: `writer:history:${index}` }, AUTH);
          const result = await runtime.auditCandidate({ caseId, candidateId: id, authContext: AUTH, attemptContextId: `setup:${index}` });
          const candidate = await store.getCandidateResponse(caseId, id);
          const audit = createCandidateAuditEvidence({ auditId: `audit:history:${index}`, candidate, auditVersion: PRIVATE_CANDIDATE_AUDIT_VERSION,
            auditorContext: { kind: "independent", context_id: result.contextId }, findings: result.value.findings, repairInducedChecks: result.value.repair_induced_checks });
          await access.recordCandidateAudit(caseId, id, audit, AUTH);
          await access.approveCandidateForDelivery(caseId, id, audit.id, AUTH);
          await access.deliverCandidateResponse(caseId, id, { auditId: audit.id, assistantTurnId: `turn:assistant:${index}`, inReplyToTurnId: latestClient.id }, AUTH);
          break;
        }
        case "supervisor_draft": {
          const approved = await drafts.submitCandidateForReview({ caseId, source: "external_draft", text: step.text, idempotencyKey: key, authContext: AUTH, channel: "owner_ui" });
          if (approved.status !== "approved") throw new Error("Scripted setup draft was not approved.");
          const artifactId = approved.artifact.artifact_id;
          if (step.export) {
            const exported = await drafts.getApprovedResponseArtifact({ caseId, artifactId, authContext: AUTH, channel: "owner_ui" });
            if (exported.client_text !== step.text) throw new Error("Setup export changed exact text.");
          }
          if (step.report != null) {
            if (!["owner_action", "agent_relayed"].includes(step.report)) throw new Error("Unknown report origin.");
            await drafts.recordReportedDelivery({ caseId, artifactId, idempotencyKey: key, authContext: AUTH, channel: step.report === "owner_action" ? "owner_ui" : "authenticated_agent" });
          }
          break;
        }
        case "supervisor_input":
          await drafts.prepareResponseContext({ caseId, inputs: [{ type: step.type, text: step.text, idempotencyKey: key }], authContext: AUTH, channel: "owner_ui" });
          break;
        default: throw new Error(`Unsupported frozen history step: ${step.step}`);
      }
    }
    store.close();
    store = open(arm === "E" ? "enforced" : "advisory");
    const finalAccess = accessFor(rootDir, keys, arm === "E" ? "enforced" : "advisory", now, caseId);
    const operationKey = supervisorOperationKeyForIdempotencyKey(caseId, "final");
    let snapshot = null;
    if (arm === "E") {
      const journal = await journalPart(store, caseId, spec.journal);
      snapshot = await finalAccess.freezeResponseEvidence(caseId, { snapshotId: `snapshot:supervisor:${operationKey}:r1`, owner: { kind: "supervisor_draft", operation_key: operationKey }, candidateOrigin: "external_draft",
        inbound: { turn_id: latestClient.id, exact_text_sha256: sha256(latestClient.text), audience: "client", source_kind: "exact_client_turn" }, historyRequirements: [], journal }, AUTH);
    }
    await finalAccess.submitSupervisorDraft(caseId, { operationKey, source: "external_draft", exactText: spec.candidate, producerContextId: `context:external:${operationKey}`,
      ...(snapshot ? { responseEvidence: { snapshotId: snapshot.id, writerInclusionSha256: null } } : {}), channel: "owner_ui" }, AUTH, { ownerChannel: true });
    const record = await store.load(caseId), candidate = record.candidate_responses.at(-1);
    const resolved = snapshot ? buildEvidenceModelView(record, snapshot) : null;
    const responseEvidence = snapshot ? { snapshot, view: resolved.view, viewSha256: resolved.view_sha256 } : null;
    // Today's runtime has a journal_evidence slot only when a provider exists; with none configured the generic audit sees no slot.
    const journalPacket = spec.journal && spec.journal.availability !== "not_configured" ? { schema_version: 1, availability: spec.journal.availability, retrieval_status: spec.journal.retrieval_status,
      coverage: spec.journal.coverage, more_available: spec.journal.more_available, excerpts: structuredClone(spec.journal.items) } : null;
    await runtimeFor(finalAccess).auditCandidate({ caseId, candidateId: candidate.id, authContext: AUTH, attemptContextId: `capture:${spec.id}:${arm}`,
      ...(snapshot ? { responseEvidence } : journalPacket ? { journalEvidence: { packet: journalPacket, sha256: sha256Json(journalPacket) } } : {}) });
    const request = requests.at(-1), packet = JSON.parse(request.user.slice("AUTHORIZED AUDIT PACKET\n".length));
    const expectedTurns = spec.history.filter((s) => ["client", "delivered_reply"].includes(s.step)).map((s) => s.text);
    if (JSON.stringify(packet.recent_verbatim.turns.map((t) => t.text)) !== JSON.stringify(expectedTurns)) throw new Error("The exact recent episode does not contain every history turn.");
    if (packet.candidate_response !== spec.candidate) throw new Error("Candidate bytes changed.");
    if (arm === "G" && record.response_evidence_snapshots.length !== 0) throw new Error("Advisory arm unexpectedly has a snapshot.");
    return { request, packet, snapshot, candidateText: candidate.exact_text };
  } catch (error) {
    throw new Error(`${spec.id} ${arm}: cannot build the frozen case exactly: ${error.message}`, { cause: error });
  } finally {
    store?.close(); keys.routineKek.fill(0); keys.recoverySecretBytes.fill(0);
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

export async function seal({ outDir, corpus: corpusName = "main" }) {
  const started = performance.now();
  outDir = await outsideRepository(outDir);
  const { corpus, bytes, entry: frozenCorpus } = await loadCorpus(corpusName);
  // Exclusive creation refuses even an existing empty folder. Partial seals are never reused.
  await fs.mkdir(outDir, { mode: 0o700 });
  await privateDirectory(outDir);
  const packets = [];
  const save = async (file, data) => {
    await fs.writeFile(path.join(outDir, file), data, { flag: "wx", mode: 0o600 });
    return { file, sha256: sha256(data), bytes: Buffer.byteLength(data) };
  };
  const corpusFile = await save("corpus.json", bytes);
  for (const spec of corpus.cases) for (const arm of ["G", "E"]) {
    const built = await buildCasePacket(spec, arm), id = packetId(spec.id, arm);
    packets.push({ id, case_id: spec.id, arm,
      packet: await save(`${id}.packet.json`, json(built.packet)), system: await save(`${id}.system.txt`, built.request.system),
      user: await save(`${id}.user.txt`, built.request.user), output_schema: await save(`${id}.schema.json`, json(built.request.outputSchema)),
      ...(arm === "E" ? { snapshot: await save(`${id}.snapshot.json`, json(built.snapshot)), candidate: await save(`${id}.candidate.txt`, built.candidateText) } : {}) });
  }
  const manifest = { schema: MANIFEST_SCHEMA, sealed_at: new Date().toISOString(), repository_head: await head(), node: process.version,
    corpus_name: corpusName, corpus_commit: frozenCorpus.commit, corpus_sha256: frozenCorpus.sha256, corpus_file: corpusFile, status: corpus.status,
    design: { arms: ["G", "E"], samples: 2, hard_cap: HARD_CAP },
    cases: corpus.cases.map(({ id, pair, language, role, dimension, expected, why }) => ({ id, pair, language, role, dimension, expected, why })), packets };
  const manifestFile = await save("manifest.json", json(manifest));
  await save("manifest.sha256", `${manifestFile.sha256}\n`);
  return { out: outDir, cases: corpus.cases.length, packets: packets.length, manifest_sha256: manifestFile.sha256, seconds: (performance.now() - started) / 1000 };
}
