import { createHash } from "node:crypto";
import { ValidationError } from "../core/errors.mjs";

export const TURN_EVIDENCE_POLICY_VERSION = "turn-bound-continuity-v1";

const SHA256 = /^[a-f0-9]{64}$/;
const TOKEN_ALIASES = Object.freeze({
  bruit: ["noise", "noisy", "quiet", "quieter"],
  bruyant: ["noise", "noisy", "quiet", "quieter"],
  calme: ["quiet", "quieter", "noise"],
  silence: ["quiet", "quieter", "noise"],
  noise: ["bruit", "bruyant", "calme", "silence"],
  noisy: ["bruit", "bruyant", "calme", "silence"],
  quiet: ["bruit", "bruyant", "calme", "silence"],
  quieter: ["bruit", "bruyant", "calme", "silence"],
  sommeil: ["sleep", "sleeping"],
  sleep: ["sommeil"],
  douleur: ["pain"],
  pain: ["douleur"],
  lecture: ["read", "reading"],
  reading: ["lecture", "read"],
  lire: ["read", "reading"],
  read: ["lire", "lecture"]
});

const sha256Hex = (value) => createHash("sha256").update(value).digest("hex");

function canonicalize(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new ValidationError("Continuity manifests must contain only JSON-compatible plain values.");
  }
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function digestJson(value) {
  return sha256Hex(canonicalJson(value));
}

function normalizedTokens(value) {
  const base = String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLocaleLowerCase()
    .match(/[\p{Letter}\p{Number}]+/gu) ?? [];
  const tokens = new Set(base.filter((token) => token.length > 2));
  for (const token of [...tokens]) for (const alias of TOKEN_ALIASES[token] ?? []) tokens.add(alias);
  return tokens;
}

function lexicalScore(queryTokens, text) {
  const textTokens = normalizedTokens(text);
  let overlap = 0;
  for (const token of queryTokens) if (textTokens.has(token)) overlap += 1;
  return overlap;
}

export function selectIncomingMessageEvidence({
  transcriptEntries = [],
  currentUserMessage = "",
  recentTurnIds = [],
  caseState = null,
  limit = 12
} = {}) {
  if (!Array.isArray(transcriptEntries) || !Array.isArray(recentTurnIds)) throw new ValidationError("Continuity retrieval inputs are invalid.");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new ValidationError("Continuity retrieval limit is invalid.");
  const queryTokens = normalizedTokens(currentUserMessage);
  if (!queryTokens.size) return Object.freeze([]);
  const recent = new Set(recentTurnIds);
  const stateItems = [...(caseState?.items ?? []), ...(caseState?.intervention_history ?? [])];
  const stateBoostByTurn = new Map();
  for (const item of stateItems) {
    if (!item?.source?.turn_id) continue;
    const score = lexicalScore(queryTokens, `${item.domain ?? ""} ${item.statement ?? ""}`);
    if (score > 0) stateBoostByTurn.set(item.source.turn_id, Math.max(score, stateBoostByTurn.get(item.source.turn_id) ?? 0));
  }
  const ranked = transcriptEntries.flatMap((turn, index) => {
    if (!turn?.id || recent.has(turn.id)) return [];
    const direct = lexicalScore(queryTokens, turn.text);
    const stateBoost = stateBoostByTurn.get(turn.id) ?? 0;
    if (direct === 0 && stateBoost === 0) return [];
    return [{
      turn_id: turn.id,
      item_id: `raw-source:${turn.id}`,
      reason: direct > 0 ? "incoming-message-raw-source" : "incoming-message-state-alias",
      score: (direct * 10) + (stateBoost * 4),
      transcript_index: index
    }];
  }).sort((left, right) => right.score - left.score || right.transcript_index - left.transcript_index);
  return Object.freeze(ranked.slice(0, limit).map(({ transcript_index: _index, ...value }) => Object.freeze(value)));
}

export function createPreparedContext({
  packetId,
  caseId,
  turnId,
  inboundText,
  recordRevision,
  evidenceRevision,
  sourceWatermark,
  indexWatermark,
  effectiveTranscript,
  authorizationEpoch,
  preparedAt,
  expiresAt = null,
  guideBundleRef = null,
  durableContext,
  spine,
  coverage = {}
} = {}) {
  for (const [name, value] of Object.entries({ packetId, caseId, turnId, authorizationEpoch, preparedAt })) {
    if (typeof value !== "string" || !value.trim()) throw new ValidationError(`Prepared context ${name} is required.`);
  }
  if (typeof inboundText !== "string" || inboundText.length === 0) throw new ValidationError("Prepared context inboundText is required.");
  if (!Number.isSafeInteger(recordRevision) || recordRevision < 1 || !Number.isSafeInteger(evidenceRevision) || evidenceRevision < 1) {
    throw new ValidationError("Prepared context revisions are invalid.");
  }
  if (!durableContext || typeof durableContext !== "object" || !spine || typeof spine !== "object") throw new ValidationError("Prepared context evidence is required.");
  const expectedEpisodeComplete = durableContext.recent_verbatim_window?.episode_completeness?.complete;
  const packet = {
    schema_version: 1,
    packet_id: packetId,
    case_id: caseId,
    turn_id: turnId,
    inbound_sha256: sha256Hex(Buffer.from(inboundText, "utf8")),
    record_revision_at_prepare: recordRevision,
    evidence_revision: evidenceRevision,
    source_watermark: sourceWatermark,
    index_watermark: indexWatermark,
    effective_transcript_digest: digestJson(effectiveTranscript),
    constitution_ref: structuredClone(durableContext.constitution_ref),
    guide_bundle_ref: guideBundleRef == null ? null : structuredClone(guideBundleRef),
    retrieval_policy_version: TURN_EVIDENCE_POLICY_VERSION,
    authorization_epoch: authorizationEpoch,
    prepared_at: preparedAt,
    expires_at: expiresAt,
    coverage: {
      episode_complete: expectedEpisodeComplete !== false,
      unresolved_source_ids: durableContext.targeted_older_evidence.filter((entry) => entry.turn == null).map((entry) => entry.turn_id),
      omitted_required_source_ids: [],
      chunks_expected: 1,
      chunks_supplied: 1,
      index_current: sourceWatermark === indexWatermark,
      budget_mode: durableContext.full_history_baseline?.included ? "full_history" : "spine_episode_targeted",
      ...structuredClone(coverage)
    },
    spine: structuredClone(spine),
    recent_episode: structuredClone(durableContext.recent_verbatim_window),
    older_evidence: structuredClone(durableContext.targeted_older_evidence),
    relevance_links: structuredClone(durableContext.relevance_links ?? []),
    question_state: structuredClone(durableContext.case_state?.answered_questions ?? []),
    full_history_baseline: structuredClone(durableContext.full_history_baseline ?? { included: false, reason: "not_available" })
  };
  packet.manifest_digest = digestJson(packet);
  return Object.freeze(validatePreparedContext(packet));
}

export function validatePreparedContext(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schema_version !== 1) throw new ValidationError("Prepared context is invalid.");
  for (const field of ["packet_id", "case_id", "turn_id", "inbound_sha256", "effective_transcript_digest", "retrieval_policy_version", "authorization_epoch", "prepared_at", "manifest_digest"]) {
    if (typeof value[field] !== "string" || !value[field].trim()) throw new ValidationError(`Prepared context ${field} is invalid.`);
  }
  for (const field of ["inbound_sha256", "effective_transcript_digest", "manifest_digest"]) if (!SHA256.test(value[field])) throw new ValidationError(`Prepared context ${field} is invalid.`);
  if (!Number.isSafeInteger(value.record_revision_at_prepare) || value.record_revision_at_prepare < 1
      || !Number.isSafeInteger(value.evidence_revision) || value.evidence_revision < 1) throw new ValidationError("Prepared context revisions are invalid.");
  if (!value.coverage || typeof value.coverage !== "object" || Array.isArray(value.coverage)) throw new ValidationError("Prepared context coverage is invalid.");
  const withoutDigest = structuredClone(value);
  delete withoutDigest.manifest_digest;
  if (value.manifest_digest !== digestJson(withoutDigest)) throw new ValidationError("Prepared context manifest digest does not match its immutable content.");
  return value;
}
