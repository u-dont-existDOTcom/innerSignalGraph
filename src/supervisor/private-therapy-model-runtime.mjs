import { createHash } from "node:crypto";
import { ValidationError } from "../core/errors.mjs";
import { parseModelJson } from "../core/json.mjs";
import { buildContext } from "../orchestrator/context-builder.mjs";
import { runTieredTherapyPipeline } from "../orchestrator/run-tiered-pipeline.mjs";
import { diffCaseStates, mergeRuntimeSnapshotIntoCaseState } from "../case-state/longitudinal-state.mjs";
import { assessContinuationSafety } from "../storage/private-case-continuity.mjs";
import { buildPrivateCandidateAuditInput } from "./private-candidate-audit.mjs";
import { REPAIR_INDUCED_ERROR_CHECKS } from "./private-candidate-lifecycle.mjs";
import {
  privateRuntimeAuditResultSchema,
  privateRuntimeRepairResultSchema,
  validatePrivateRuntimeAuditResult,
  validatePrivateRuntimeRepairResult
} from "../schemas/private-runtime.mjs";
import { privateRuntimeAuditPrompt } from "../prompts/private-runtime-audit.mjs";
import { privateRuntimeRepairPrompt } from "../prompts/private-runtime-repair.mjs";
import { assembleCanonicalCandidateText } from "./canonical-candidate-text.mjs";
import { applyTranscriptAmendments } from "../storage/transcript-amendments.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");

function providerContextId(provider, raw) {
  const providerResponseId = raw?.responseId ?? raw?.requestId;
  if (typeof providerResponseId !== "string" || !providerResponseId.trim()) throw new ValidationError("Private inference provider did not return an actual response/session identifier.");
  return `context:${hash(`${provider.id}:${provider.model}:${providerResponseId}`)}`;
}

function assertPacketOnlyProvider(provider, role) {
  const isolation = provider?.privateInferenceIsolation;
  if (typeof provider?.generate !== "function" || isolation?.packetOnly !== true || isolation.freshContextPerGenerate !== true
      || isolation.tools !== false || isolation.filesystem !== false || isolation.sessionPersistence !== false) {
    throw new ValidationError(`${role} provider cannot guarantee a fresh packet-only inference context.`, { code: "PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE" });
  }
}

async function generatePacketOnly(provider, { prompt, outputSchema, metadata, validate }) {
  assertPacketOnlyProvider(provider, metadata.stage);
  const raw = await provider.generate({ ...prompt, outputSchema, metadata: { ...metadata, freshContext: true }, sealed: true });
  const parsed = parseModelJson(raw.text, `private ${metadata.stage}`);
  const value = validate(parsed);
  return {
    value,
    contextId: providerContextId(provider, raw),
    providerReceipt: {
      provider: provider.id,
      model: provider.model,
      response_id: raw.responseId ?? raw.requestId,
      isolation: structuredClone(provider.privateInferenceIsolation)
    }
  };
}

function sealAuditPacket(input) {
  return Object.freeze({
    schema_version: 1,
    role: "AUTHORIZED_PRIVATE_CANDIDATE_AUDIT",
    candidate_binding: Object.freeze({
      id: input.candidate_id,
      version: input.candidate_version,
      status: input.candidate_status,
      parent_candidate_id: input.candidate_parent_candidate_id
    }),
    candidate_response: input.candidate_response,
    context_binding: Object.freeze({
      turn_id: input.turn_id,
      evidence_revision: input.evidence_revision,
      writer_packet_digest: input.writer_packet_digest,
      audit_packet_digest: input.audit_packet_digest
    }),
    constitution_ref: input.constitution_ref,
    case_state: input.case_state,
    last_state_diff: input.last_state_diff,
    recent_verbatim: input.recent_verbatim,
    targeted_older_evidence: input.targeted_older_evidence,
    current_episode: input.current_episode,
    binding_rule: input.binding_rule,
    reconstruction_audit_required: input.reconstruction_audit_required,
    repair_induced_error_checks: input.repair_induced_error_checks,
    instructions: input.instructions,
    disclosure_manifest: Object.freeze({
      exact_candidate_included: true,
      authorized_case_context_included: true,
      producer_hidden_reasoning_included: false,
      producer_trace_included: false,
      repair_rationale_history_included: false,
      prior_verdicts_included: false,
      tools_available: false,
      filesystem_available: false
    })
  });
}

function directAuditAccess(privateCaseSource) {
  if (typeof privateCaseSource.loadPrivateRuntimeCase === "function") return privateCaseSource;
  return {
    async loadCaseContext(caseId, _authContext, options) {
      const context = await privateCaseSource.loadCaseContext(caseId, options);
      return { ...context, continuation_safety: assessContinuationSafety(context) };
    }
  };
}

async function loadRuntimeCase(privateCaseSource, caseId, authContext) {
  if (typeof privateCaseSource.loadPrivateRuntimeCase === "function") return privateCaseSource.loadPrivateRuntimeCase(caseId, authContext);
  return privateCaseSource.loadOrCreate(caseId);
}

export function createPrivateTherapyModelRuntime({ privateCaseSource, providers, config } = {}) {
  if (!privateCaseSource || !providers || !config) throw new ValidationError("Private therapy model runtime requires case source, providers, and config.");
  const auditProvider = providers.privateAuditor ?? providers.anthropic;
  const repairProvider = providers.privateRepairer ?? providers.renderer ?? providers.anthropic;

  return Object.freeze({
    async produceCandidate({ caseId, runtimeTurn, userInput, authContext, attemptContextId }) {
      const record = await loadRuntimeCase(privateCaseSource, caseId, authContext);
      const previousCaseState = record.case_state;
      const preparedContext = record.prepared_contexts?.find((entry) => entry.packet_id === runtimeTurn.preparation_id) ?? null;
      if (!preparedContext) throw new ValidationError("Private therapy candidate requires a server-recorded prepared context.", { code: "CONTEXT_REQUIRED" });
      if (preparedContext.evidence_revision !== record.evidence_revision || preparedContext.inbound_sha256 !== runtimeTurn.inbound.sha256) {
        throw new ValidationError("Private therapy prepared context is stale.", { code: "EVIDENCE_CHANGED" });
      }
      const effectiveTranscript = applyTranscriptAmendments(record.raw_transcript, record.transcript_amendments, { sourceArtifacts: record.source_artifacts });
      const context = await buildContext({
        caseId,
        userMessage: runtimeTurn.inbound.exact_text,
        recentTranscriptEntries: effectiveTranscript,
        durableCaseState: previousCaseState,
        trackerEntries: record.tracker_entries,
        preparedContext
      }, { ...config, ledgerMode: "off", devAutomationEnabled: false });
      const result = await runTieredTherapyPipeline({
        context,
        providers,
        config: { ...config, ledgerMode: "off", devAutomationEnabled: false },
        processingMode: userInput.processingMode ?? config.therapyProcessingMode ?? "auto"
      });
      if (typeof result.producerContextId !== "string" || !result.producerContextId.trim()) throw new ValidationError("Therapy candidate lacks final renderer session provenance.");
      const producerContextId = `context:${hash(`${result.rendererProvider}:${result.rendererModel}:${result.producerContextId}`)}`;
      const caseState = mergeRuntimeSnapshotIntoCaseState(previousCaseState, result.caseFormulation, {
        turnId: runtimeTurn.user_turn_id,
        recordedAt: runtimeTurn.inbound.received_at,
        interventionContract: result.interventionContract
      });
      return {
        exactText: assembleCanonicalCandidateText(result),
        contextId: producerContextId,
        caseState,
        stateDiff: diffCaseStates(previousCaseState, caseState),
        contextUse: {
          source_ids: preparedContext.older_evidence.flatMap((entry) => entry.turn ? [entry.turn.id] : []),
          historical_relationship_now_relevant: preparedContext.relevance_links,
          uncertainty_and_currentness: preparedContext.relevance_links.length ? "historical links are proposed relevance and require current confirmation" : "no older relationship selected",
          answered_question_disposition: preparedContext.question_state.map((entry) => ({ id: entry.id, still_current: entry.still_current !== false })),
          next_focus_relation_to_agenda: previousCaseState.current_episode?.next_question ?? null
        },
        result: {
          mode: result.mode,
          processingTier: result.processingTier,
          routingReason: result.routingReason,
          graphBundleVersion: result.graphBundleVersion,
          caseFormulation: result.caseFormulation,
          interventionContract: result.interventionContract,
          responseContract: result.responseContract,
          processingMs: result.processingMs,
          producerAttemptContextId: attemptContextId
        }
      };
    },

    async auditCandidate({ caseId, candidateId, authContext, attemptContextId }) {
      const auditInput = await buildPrivateCandidateAuditInput({
        caseAccessService: directAuditAccess(privateCaseSource),
        caseId,
        candidateId,
        authContext
      });
      const packet = sealAuditPacket(auditInput);
      const generated = await generatePacketOnly(auditProvider, {
        prompt: privateRuntimeAuditPrompt(packet),
        outputSchema: privateRuntimeAuditResultSchema,
        metadata: { stage: "private_candidate_audit", fixtureKey: "private_candidate_audit", attemptContextId },
        validate: (value) => validatePrivateRuntimeAuditResult(value, { reconstructed: auditInput.reconstruction_audit_required })
      });
      return {
        value: generated.value,
        contextId: generated.contextId,
        providerReceipt: generated.providerReceipt,
        disclosureManifest: packet.disclosure_manifest,
        contextBinding: packet.context_binding
      };
    },

    async repairCandidate({ caseId, candidate, authContext, attemptContextId }) {
      const context = await directAuditAccess(privateCaseSource).loadCaseContext(caseId, authContext, {
        candidateId: candidate.id,
        requireContinuationSafe: true,
        requireAuditScope: true,
        episodePolicy: { requireCompleteEpisode: true }
      });
      const failedAudit = candidate.audit_history.at(-1);
      if (!failedAudit || failedAudit.verdict !== "fail") throw new ValidationError("Private runtime repair requires the exact failed audit.");
      const packet = Object.freeze({
        schema_version: 1,
        role: "AUTHORIZED_PRIVATE_CANDIDATE_REPAIR",
        candidate_binding: { id: candidate.id, version: candidate.version, parent_candidate_id: candidate.parent_candidate_id, repair_cycle: candidate.repair_cycle },
        failed_candidate_response: candidate.exact_text,
        binding_audit: { id: failedAudit.id, candidate_id: failedAudit.candidate_id, candidate_version: failedAudit.candidate_version, findings: failedAudit.findings },
        constitution_ref: context.constitution_ref,
        case_state: context.case_state,
        last_state_diff: context.last_state_diff,
        recent_verbatim: context.recent_verbatim,
        targeted_older_evidence: context.targeted_older_evidence,
        current_episode: context.current_episode,
        repair_induced_error_checks: REPAIR_INDUCED_ERROR_CHECKS,
        disclosure_manifest: { producer_hidden_reasoning_included: false, provider_trace_included: false, tools_available: false, filesystem_available: false }
      });
      const generated = await generatePacketOnly(repairProvider, {
        prompt: privateRuntimeRepairPrompt(packet),
        outputSchema: privateRuntimeRepairResultSchema,
        metadata: { stage: "private_candidate_repair", fixtureKey: "private_candidate_repair", attemptContextId },
        validate: validatePrivateRuntimeRepairResult
      });
      return { exactText: generated.value.exact_text, contextId: generated.contextId, providerReceipt: generated.providerReceipt };
    },

    async produceDiscriminator({ caseId, runtimeTurn, authContext, attemptContextId }) {
      const record = await loadRuntimeCase(privateCaseSource, caseId, authContext);
      const question = record.case_state.current_episode?.next_question;
      if (typeof question !== "string" || !question.trim()) {
        throw new ValidationError("The current episode has no authorized discriminating question; delivery remains blocked.", { code: "PRIVATE_DISCRIMINATOR_UNAVAILABLE" });
      }
      return {
        exactText: question.trim(),
        contextId: `context:${hash(`deterministic-discriminator:${attemptContextId}:${runtimeTurn.id}`)}`,
        providerReceipt: { provider: "deterministic-current-episode", model: null, response_id: attemptContextId, isolation: { packetOnly: true, freshContextPerGenerate: true, tools: false, filesystem: false, sessionPersistence: false } }
      };
    }
  });
}
