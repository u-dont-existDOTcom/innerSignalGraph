import { HYPNOSIS_CONTRACT_VERSION } from "./app-owned-copy.mjs";

const MODEL_OWNED_FIELDS = Object.freeze([
  ["orientation"],
  ["continue_inward", "induction"],
  ["continue_inward", "deepening"],
  ["continue_inward", "target_work"],
  ["continue_inward", "integration"],
  ["continue_inward", "return_lead"],
  ["stay_external", "grounding"],
  ["stay_external", "ordinary_choice"],
  ["aftercare"]
]);

const APP_OWNED_MARKERS = /\[\[(?:PLAN|AUDIT|BRANCH_|AFTERCARE|PREFLIGHT|OFFER|ACTION)/i;
const APP_OWNED_GATE_PHRASES = /protector choice point|playback pauses here|continued presence, silence|you selected continue inward|you selected remain at this distance|you selected finish here/i;
const APP_OWNED_RETURN_PHRASES = /fully awake, clear, and present|this session is complete|press your feet into the floor and move your hands/i;
const EARLY_DEEPENING = /\b(close your eyes|eyes closing|count(?:ing)? down|deeper|trance|drift inward|you are becoming hypnotized)\b/i;
const EXTERNAL_DEEPENING = /\b(close your eyes|count(?:ing)? down|deeper|trance|younger child|inner child|go inside|move inward)\b/i;
const FORBIDDEN_MEMORY = /\b(recover(?:ed)? memor|hidden memor|body remembers exactly|must have happened|what really happened)\b/i;
const FORBIDDEN_AUTHORITY = /\b(you have no choice|you cannot resist|must obey|the app knows|i know what your unconscious wants)\b/i;

function getPath(value, path) {
  return path.reduce((current, key) => current?.[key], value);
}

function wordCount(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

export function auditHypnosisDraft(draft) {
  const issues = [];
  if (!draft || draft.contract_version !== HYPNOSIS_CONTRACT_VERSION) {
    issues.push({ code: "contract_version_mismatch", field: "contract_version" });
    return { ok: false, issues };
  }

  for (const path of MODEL_OWNED_FIELDS) {
    const field = path.join(".");
    const text = String(getPath(draft, path) || "");
    if (!text.trim()) issues.push({ code: "missing_component", field });
    if (APP_OWNED_MARKERS.test(text)) issues.push({ code: "model_emitted_control_marker", field });
    if (APP_OWNED_GATE_PHRASES.test(text)) issues.push({ code: "model_emitted_gate_copy", field });
    if (APP_OWNED_RETURN_PHRASES.test(text)) issues.push({ code: "model_emitted_waking_return", field });
    if (FORBIDDEN_MEMORY.test(text)) issues.push({ code: "memory_certainty_or_recovery", field });
    if (FORBIDDEN_AUTHORITY.test(text)) issues.push({ code: "coercive_authority", field });
  }

  if (EARLY_DEEPENING.test(draft.orientation)) {
    issues.push({ code: "orientation_deepens_before_gate", field: "orientation" });
  }
  const stayText = `${draft.stay_external?.grounding || ""}\n${draft.stay_external?.ordinary_choice || ""}`;
  if (EXTERNAL_DEEPENING.test(stayText)) {
    issues.push({ code: "stay_external_advances_inward", field: "stay_external" });
  }

  const continueWords = wordCount([
    draft.continue_inward?.induction,
    draft.continue_inward?.deepening,
    draft.continue_inward?.target_work,
    draft.continue_inward?.integration,
    draft.continue_inward?.return_lead
  ].join(" "));
  if (continueWords < 120) issues.push({ code: "continue_route_too_short", field: "continue_inward", detail: continueWords });
  if (wordCount(stayText) < 35) issues.push({ code: "stay_external_too_short", field: "stay_external" });
  if (wordCount(draft.aftercare) > 80) issues.push({ code: "aftercare_too_long", field: "aftercare" });

  if (draft.scope?.memory !== "no-memory-recovery") issues.push({ code: "memory_scope_not_locked", field: "scope.memory" });
  if (draft.scope?.identity !== "ordinary-adult-identity") issues.push({ code: "identity_scope_not_locked", field: "scope.identity" });
  if (draft.scope?.post_session !== "no-automatic-cues") issues.push({ code: "post_session_scope_not_locked", field: "scope.post_session" });
  if (draft.scope?.substances !== "no-substance-guidance") issues.push({ code: "substance_scope_not_locked", field: "scope.substances" });

  return {
    ok: issues.length === 0,
    issues,
    metrics: {
      continueRouteWords: continueWords,
      stayExternalWords: wordCount(stayText),
      aftercareWords: wordCount(draft.aftercare)
    }
  };
}
