import { ValidationError } from "../core/errors.mjs";
import { createHash } from "node:crypto";

function requiredString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new ValidationError(`${label} must be nonempty text.`);
  return value;
}

function insertionText(value) {
  if (typeof value !== "string" || value.length === 0) throw new ValidationError("Insertion requires explicit nonempty text.");
  return value;
}

export function normalizePendingReplyRevision(value) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value) || value.status !== "unsent") {
    throw new ValidationError("A reply may be revised only while explicitly unsent; delivery or unknown status cannot be inferred.");
  }
  const draftText = requiredString(value.draftText, "pending reply draftText");
  const ownerFeedback = requiredString(value.ownerFeedback, "pending reply ownerFeedback");
  if (value.operations != null && (!Array.isArray(value.operations) || value.operations.length === 0)) {
    throw new ValidationError("Pending reply operations must be a nonempty array when supplied.");
  }
  return Object.freeze({status: "unsent", draftText, ownerFeedback, operations: value.operations ?? null});
}

export function applyPendingReplyEdits({draftText, status, operations}) {
  if (status !== "unsent") throw new ValidationError("Cannot edit a delivered reply as if it were unsent.");
  let text = requiredString(draftText, "draftText");
  if (!Array.isArray(operations) || operations.length === 0) throw new ValidationError("At least one explicit edit is required.");
  for (const [index, operation] of operations.entries()) {
    if (!operation || !["replace", "insert_after", "delete"].includes(operation.kind)) throw new ValidationError(`Invalid edit operation ${index}.`);
    const anchor = requiredString(operation.anchor, `operation[${index}].anchor`);
    const first = text.indexOf(anchor);
    if (first < 0 || text.indexOf(anchor, first + 1) >= 0) throw new ValidationError(`Edit anchor ${index} must occur exactly once in the current full draft.`);
    if (operation.kind === "replace") text = text.slice(0, first) + requiredString(operation.text, "replacement") + text.slice(first + anchor.length);
    else if (operation.kind === "insert_after") text = text.slice(0, first + anchor.length) + insertionText(operation.text) + text.slice(first + anchor.length);
    else text = text.slice(0, first) + text.slice(first + anchor.length);
  }
  return text;
}

export function assertUnchangedReplyPassages({oldDraft, newDraft, unchangedPassages}) {
  requiredString(oldDraft, "oldDraft");
  requiredString(newDraft, "newDraft");
  if (!Array.isArray(unchangedPassages) || unchangedPassages.length === 0) throw new ValidationError("unchangedPassages must contain protected passages.");
  let oldIndex = 0, newIndex = 0;
  for (const passage of unchangedPassages) {
    requiredString(passage, "unchanged passage");
    const i = oldDraft.indexOf(passage, oldIndex);
    const j = newDraft.indexOf(passage, newIndex);
    if (i < 0 || j < 0) throw new ValidationError("A protected unchanged reply passage was lost or reordered.");
    oldIndex = i + passage.length;
    newIndex = j + passage.length;
  }
  return true;
}

export function pendingReplyRevisionPromptBlock(revision) {
  const value = normalizePendingReplyRevision(revision);
  if (!value) return "";
  return `
ACTIVE SUPERVISOR REPLY REVISION (status: UNSENT)
The supervisor's new instruction edits this exact full outbound candidate. It is not an inbound from the recipient. Replace only affected passages and retain the rest, then output one COMPLETE ready-to-send reply. Do not mark it sent.
CURRENT COMPLETE UNSENT DRAFT:
${JSON.stringify(value.draftText)}
SUPERVISOR EDIT INSTRUCTION:
${JSON.stringify(value.ownerFeedback)}
`;
}

// Supervisor-only, deterministic exact-anchor editor. Never labels revised text as
// sent or independently approved, and never routes owner feedback into a therapy
// user's case extraction, risk classifier, or clinical model context.
export function reviseUnsentSupervisorCandidate(input) {
  const revision = normalizePendingReplyRevision(input);
  if (!revision) throw new ValidationError("An explicit unsent supervisor revision is required.");
  if (!revision.operations) {
    throw new ValidationError("Free-form owner feedback cannot be applied as a deterministic edit. Provide explicit anchored operations; never reinterpret it as client speech.");
  }
  const revised = applyPendingReplyEdits({
    draftText: revision.draftText, status: revision.status, operations: revision.operations
  });
  return Object.freeze({
    kind: "supervisor_reply_revision",
    delivery_status: "unsent",
    requires_independent_audit: true,
    recipient_delivery_performed: false,
    previous_draft_sha256: createHash("sha256").update(revision.draftText).digest("hex"),
    draft_text: revised
  });
}

export function rejectSupervisorRevisionInTherapyPipeline(context) {
  if (context?.pendingReplyRevision) {
    throw new ValidationError("Unsent supervisor revisions require the explicit anchored editing operation and independent review, not ordinary therapy case extraction or client delivery.");
  }
}
