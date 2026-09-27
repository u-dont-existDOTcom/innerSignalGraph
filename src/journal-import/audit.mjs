import { createHash, createHmac } from "node:crypto";
import { ValidationError } from "../core/errors.mjs";
import { JOURNAL_GRAPH_CONTRACT, resolveExactQuote, validateJournalSchema } from "./contracts.mjs";
import { buildJournalRolePacket } from "./provider-port.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function invariant(condition, code) {
  if (!condition) throw new ValidationError(code, { code });
}

function contextId(receipt) {
  return typeof receipt?.request_context_id === "string" ? receipt.request_context_id : null;
}

export function isAuthenticatedTransportReceipt(receipt, { generation = null, grantId = null } = {}) {
  if (!receipt || typeof receipt !== "object") return false;
  if (receipt.transport === "model_output" || receipt.completion_status !== "completed") return false;
  if (typeof receipt.authentication_tag !== "string" || receipt.authentication_tag.length < 16) return false;
  if (typeof receipt.request_id !== "string" || typeof receipt.request_context_id !== "string" || typeof receipt.input_manifest_sha256 !== "string") return false;
  if (grantId !== null && receipt.grant_id !== grantId) return false;
  if (generation !== null && receipt.target_generation !== generation) return false;
  return true;
}

export function createDeterministicAuditSample({
  units,
  seed,
  strata = JOURNAL_GRAPH_CONTRACT.audit_defaults.probability_strata,
  unitsPerStratum = JOURNAL_GRAPH_CONTRACT.audit_defaults.units_per_stratum
}) {
  invariant(Array.isArray(units) && units.length > 0 && typeof seed === "string" && seed.length > 0, "AUDIT_SAMPLE_INPUT_INVALID");
  invariant(Number.isSafeInteger(strata) && strata > 0 && Number.isSafeInteger(unitsPerStratum) && unitsPerStratum > 0, "AUDIT_SAMPLE_BOUNDS_INVALID");
  const ordered = [...units].sort((left, right) => (left.source_order ?? left.start_byte ?? 0) - (right.source_order ?? right.start_byte ?? 0) || left.unit_id.localeCompare(right.unit_id));
  const groups = new Map();
  for (const unit of ordered) {
    const groupId = unit.duplicate_group_id ?? `unique:${unit.unit_id}`;
    if (!groups.has(groupId)) groups.set(groupId, []);
    groups.get(groupId).push(unit);
  }
  const groupEntries = [...groups.entries()].map(([groupId, members]) => ({ group_id: groupId, members, order: ordered.indexOf(members[0]) }));
  const buckets = Array.from({ length: strata }, () => []);
  groupEntries.forEach((group, index) => buckets[Math.min(strata - 1, Math.floor(index * strata / groupEntries.length))].push(group));
  const selected = [];
  const inclusionLedger = [];
  for (const [stratum, bucket] of buckets.entries()) {
    const ranked = [...bucket].sort((left, right) => sha256(Buffer.from(`${seed}\0${left.group_id}`, "utf8")).localeCompare(sha256(Buffer.from(`${seed}\0${right.group_id}`, "utf8"))));
    const take = Math.min(unitsPerStratum, ranked.length);
    const probability = ranked.length === 0 ? 0 : Math.min(1, unitsPerStratum / ranked.length);
    for (const group of ranked.slice(0, take)) {
      const member = [...group.members].sort((left, right) => sha256(Buffer.from(`${seed}\0${group.group_id}\0${left.unit_id}`, "utf8")).localeCompare(sha256(Buffer.from(`${seed}\0${group.group_id}\0${right.unit_id}`, "utf8"))))[0];
      selected.push(member);
      inclusionLedger.push({
        unit_id: member.unit_id,
        duplicate_group_id: group.group_id,
        duplicate_group_size: group.members.length,
        stratum,
        inclusion_probability: probability,
        inclusion_reason: "probability_sample"
      });
    }
  }
  const challenge = ordered.filter((unit) => Array.isArray(unit.hazard_types) && unit.hazard_types.length > 0).map((unit) => ({
    unit_id: unit.unit_id,
    hazard_types: [...new Set(unit.hazard_types)].sort(),
    inclusion_reason: "targeted_challenge_not_population_estimate"
  }));
  return Object.freeze({
    seed_sha256: sha256(Buffer.from(seed, "utf8")),
    strata,
    units_per_stratum: unitsPerStratum,
    selected_units: selected,
    inclusion_ledger: inclusionLedger,
    substitutions: [],
    targeted_challenge: challenge,
    targeted_is_population_estimate: false
  });
}

export function selectCalibrationWindows(units, count = JOURNAL_GRAPH_CONTRACT.audit_defaults.calibration_windows) {
  invariant(Array.isArray(units) && units.length > 0 && Number.isSafeInteger(count) && count > 0, "CALIBRATION_INPUT_INVALID");
  const ordered = [...units].sort((left, right) => (left.source_order ?? left.start_byte ?? 0) - (right.source_order ?? right.start_byte ?? 0) || left.unit_id.localeCompare(right.unit_id));
  const positions = new Set();
  if (ordered.length <= count) ordered.forEach((_, index) => positions.add(index));
  else for (let index = 0; index < count; index += 1) positions.add(Math.round(index * (ordered.length - 1) / (count - 1)));
  ordered.forEach((unit, index) => { if (unit.hazard_types?.length) positions.add(index); });
  return Object.freeze([...positions].sort((left, right) => left - right).map((index) => ({
    unit_id: ordered[index].unit_id,
    source_order: ordered[index].source_order ?? index,
    reason: ordered[index].hazard_types?.length ? "position_and_or_hazard" : "document_position"
  })));
}

export function scoreReferenceReview({ referenceResult, reviewResult, candidateIds = [] }) {
  const reference = validateJournalSchema("reference-result", referenceResult);
  const review = validateJournalSchema("review-result", reviewResult);
  const assessmentById = new Map(review.assessments.map((assessment) => [assessment.target_id, assessment]));
  const counts = { preserved: 0, omitted: 0, distorted: 0, unassessed: 0 };
  let criticalMisses = 0;
  let qualifierErrors = 0;
  for (const item of reference.reference_items) {
    const assessment = assessmentById.get(item.id);
    const outcome = assessment?.outcome ?? "unassessed";
    counts[outcome] += 1;
    if (item.critical && outcome !== "preserved") criticalMisses += 1;
    if (assessment?.finding_type === "lost_qualifier") qualifierErrors += 1;
  }
  const candidateAssessments = candidateIds.map((id) => assessmentById.get(id));
  const candidatePreserved = candidateAssessments.filter(({ outcome } = {}) => outcome === "preserved").length;
  const total = reference.reference_items.length;
  return Object.freeze({
    reference_total: total,
    reference_counts: counts,
    reference_recall: total === 0 ? null : counts.preserved / total,
    candidate_total: candidateIds.length,
    candidate_precision: candidateIds.length === 0 ? null : candidatePreserved / candidateIds.length,
    qualifier_error_count: qualifierErrors,
    critical_miss_count: criticalMisses,
    unassessed_in_denominator: true,
    provisional_reference_target: JOURNAL_GRAPH_CONTRACT.audit_defaults.reference_set_recall_target,
    provisional_target_met: total > 0 && counts.preserved / total >= JOURNAL_GRAPH_CONTRACT.audit_defaults.reference_set_recall_target,
    global_recall_claim: false
  });
}

export function certifyIndependentAudit({ generation, referenceFreeze, fidelityOutput, fidelityReceipt, producerReceipt = null, grantId }) {
  const reasons = [];
  let review;
  try { review = validateJournalSchema("review-result", fidelityOutput); }
  catch { reasons.push("FIDELITY_OUTPUT_INVALID"); }
  if (referenceFreeze?.generation !== generation) reasons.push("REFERENCE_GENERATION_STALE");
  if (review?.target_generation !== generation) reasons.push("FIDELITY_GENERATION_STALE");
  if (review?.review_role !== "fidelity_auditor") reasons.push("FIDELITY_ROLE_INVALID");
  if (review?.status === "incomplete") reasons.push("FIDELITY_INCOMPLETE");
  if (!isAuthenticatedTransportReceipt(referenceFreeze?.receipt, { generation, grantId })) reasons.push("REFERENCE_RECEIPT_UNAUTHENTICATED");
  if (!isAuthenticatedTransportReceipt(fidelityReceipt, { generation, grantId })) reasons.push("FIDELITY_RECEIPT_UNAUTHENTICATED");
  const contexts = [contextId(referenceFreeze?.receipt), contextId(fidelityReceipt), contextId(producerReceipt)].filter(Boolean);
  if (new Set(contexts).size !== contexts.length) reasons.push("INFERENCE_CONTEXT_NOT_INDEPENDENT");
  if (referenceFreeze?.reference?.source_only_first_pass !== true) reasons.push("REFERENCE_NOT_SOURCE_FIRST");
  return Object.freeze({
    status: reasons.length === 0 ? "complete_for_stated_scope" : "unavailable",
    semantically_audited: reasons.length === 0 ? "pass" : "unavailable",
    reasons,
    generation,
    reference_freeze_ref: referenceFreeze?.freeze_ref ?? null,
    fidelity_receipt_ref: fidelityReceipt?.receipt_id ?? null
  });
}

export function createJournalAuditPipeline({ inferencePort, grant, auditSecret, generation }) {
  invariant(inferencePort && typeof inferencePort.invoke === "function", "INFERENCE_PORT_INVALID");
  invariant(auditSecret instanceof Uint8Array && auditSecret.byteLength >= 32, "AUDIT_SECRET_INVALID");
  const secret = Buffer.from(auditSecret);
  const invoke = async (role, packet, operationKey) => inferencePort.invoke({
    role,
    packet: buildJournalRolePacket(role, packet),
    outputSchema: packet.output_schema_id,
    operationKey,
    grant
  });
  return Object.freeze({
    async freezeReference({ assignedCoreIds, sourceLocators, sourceWindows, adjacentContext = {}, visualContext = [], neutralReadingInstructions = [] }) {
      const packet = {
        protocol_version: "1.0",
        output_schema_id: "reference-result",
        assigned_core_ids: cloneArray(assignedCoreIds),
        source_locators: cloneArray(sourceLocators),
        expected_generation: generation,
        controller_provenance_tag: `reference:${sha256(Buffer.from(JSON.stringify(assignedCoreIds), "utf8")).slice(0, 32)}`,
        grant_purpose: grant.purpose,
        source_windows: structuredClone(sourceWindows),
        adjacent_context: structuredClone(adjacentContext),
        visual_context: structuredClone(visualContext),
        neutral_reading_instructions: structuredClone(neutralReadingInstructions)
      };
      const operationKey = `audit:reference:${createHmac("sha256", secret).update(JSON.stringify(packet)).digest("hex").slice(0, 48)}`;
      const { output, receipt } = await invoke("reference_reader", packet, operationKey);
      const reference = validateJournalSchema("reference-result", output);
      const sourceByUnit = new Map(sourceWindows.map((window) => [window.unit_id, window.text]));
      for (const item of reference.reference_items) for (const anchor of item.anchors) {
        invariant(sourceByUnit.has(anchor.unit_id), "REFERENCE_ANCHOR_OUTSIDE_SOURCE_PACKET");
        resolveExactQuote(sourceByUnit.get(anchor.unit_id), anchor.quote, anchor.occurrence);
      }
      invariant(isAuthenticatedTransportReceipt(receipt, { generation, grantId: grant.grant_id }), "REFERENCE_RECEIPT_UNAUTHENTICATED");
      const freezeRef = `freeze:${createHmac("sha256", secret).update(JSON.stringify({ generation, reference, receipt_id: receipt.receipt_id })).digest("hex").slice(0, 48)}`;
      return Object.freeze({ generation, reference, receipt: structuredClone(receipt), freeze_ref: freezeRef });
    },
    async auditCandidates({ referenceFreeze, supportingPassages, candidateIds, assignedCoreIds, sourceLocators, producerReceipt = null }) {
      invariant(referenceFreeze?.generation === generation, "REFERENCE_GENERATION_STALE");
      const packet = {
        protocol_version: "1.0",
        output_schema_id: "review-result",
        assigned_core_ids: cloneArray(assignedCoreIds),
        source_locators: cloneArray(sourceLocators),
        expected_generation: generation,
        controller_provenance_tag: `fidelity:${referenceFreeze.freeze_ref.slice(7, 39)}`,
        grant_purpose: grant.purpose,
        frozen_reference: structuredClone(referenceFreeze.reference),
        supporting_passages: structuredClone(supportingPassages),
        imported_generation: generation
      };
      const operationKey = `audit:fidelity:${createHmac("sha256", secret).update(JSON.stringify(packet)).digest("hex").slice(0, 48)}`;
      const { output, receipt } = await invoke("fidelity_auditor", packet, operationKey);
      const score = scoreReferenceReview({ referenceResult: referenceFreeze.reference, reviewResult: output, candidateIds });
      const certification = certifyIndependentAudit({ generation, referenceFreeze, fidelityOutput: output, fidelityReceipt: receipt, producerReceipt, grantId: grant.grant_id });
      return Object.freeze({ review: output, receipt, score, certification });
    },
    close() { secret.fill(0); }
  });
}

function cloneArray(value) {
  invariant(Array.isArray(value), "AUDIT_ASSIGNMENT_INVALID");
  return structuredClone(value);
}
