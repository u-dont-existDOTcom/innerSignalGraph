import { ValidationError } from "../core/errors.mjs";

function requiredString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new ValidationError(`${label} must be nonempty text.`);
  return value;
}

export function normalizePendingReplyRevision(value) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value) || value.status !== "unsent") {
    throw new ValidationError("A reply may be revised only while explicitly unsent; delivery or unknown status cannot be inferred.");
  }
  const draftText = requiredString(value.draftText, "pending reply draftText");
  const ownerFeedback = requiredString(value.ownerFeedback, "pending reply ownerFeedback");
  return Object.freeze({status: "unsent", draftText, ownerFeedback});
}

export function applyPendingReplyEdits({draftText, status, operations}) {
  if (status !== "unsent") throw new ValidationError("Cannot edit a delivered reply as if it were unsent.");
  let text = requiredString(draftText, "draftText");
  if (!Array.isArray(operations) || operations.length === 0) throw new ValidationError("At least one explicit edit is required.");
  for (const [index, operation] of operations.entries()) {
    if (!operation || !["replace", "insert_after", "delete"].includes(operation.kind)) throw new ValidationError(`Invalid edit operation ${index}.`);
    const anchor = requiredString(operation.anchor, `operation[${index}].anchor`);
    const first = text.indexOf(anchor);
    if (first < 0 || text.indexOf(anchor, first + anchor.length) >= 0) throw new ValidationError(`Edit anchor ${index} must occur exactly once in the current full draft.`);
    if (operation.kind === "replace") text = text.slice(0, first) + requiredString(operation.text, "replacement") + text.slice(first + anchor.length);
    else if (operation.kind === "insert_after") text = text.slice(0, first + anchor.length) + requiredString(operation.text, "insertion") + text.slice(first + anchor.length);
    else text = text.slice(0, first) + text.slice(first + anchor.length);
  }
  return text;
}

export function assertUnchangedReplyPassages({oldDraft, newDraft, unchangedPassages}) {
  requiredString(oldDraft, "oldDraft");
  requiredString(newDraft, "newDraft");
  if (!Array.isArray(unchangedPassages)) throw new ValidationError("unchangedPassages must be an array.");
  for (const passage of unchangedPassages) {
    requiredString(passage, "unchanged passage");
    if (!oldDraft.includes(passage) || !newDraft.includes(passage)) throw new ValidationError("A protected unchanged reply passage was lost.");
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
