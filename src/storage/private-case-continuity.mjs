import { RuntimeError } from "../core/errors.mjs";

export class CaseNotContinuationSafeError extends RuntimeError {
  constructor(failures) {
    super(`Case is not continuation-safe for a fresh session: ${failures.join("; ")}`, {
      code: "CASE_NOT_CONTINUATION_SAFE",
      details: { failures: [...failures] }
    });
    this.name = "CaseNotContinuationSafeError";
  }
}

export function assessContinuationSafety(context, { minimumCompleteExchanges = 3 } = {}) {
  const failures = [];
  if (!context?.case_state) failures.push("current structured case state is missing");
  if (!context?.last_state_diff) failures.push("last state diff is missing");
  if (!context?.current_episode) failures.push("current therapeutic episode is missing");
  if (!context?.constitution_ref?.version) failures.push("constitution reference is missing");
  if (!context?.candidate_response?.exact_text) failures.push("exact candidate response is missing");
  else if (context.candidate_response.status !== "pending_audit") failures.push("candidate response is not pending audit");
  const olderTurnAvailable = (context?.targeted_older_evidence ?? []).some((entry) => entry?.turn?.text);
  const olderSourceAvailable = (context?.source_artifact_refs ?? []).length > 0;
  if (!olderTurnAvailable && !olderSourceAvailable) failures.push("targeted older raw evidence has no retrievable private provenance source");
  const turns = context?.recent_verbatim?.turns ?? [];
  const exchanges = new Map();
  for (const turn of turns) {
    const roles = exchanges.get(turn.exchange_id) ?? new Set();
    roles.add(turn.role);
    exchanges.set(turn.exchange_id, roles);
  }
  const complete = [...exchanges.values()].filter((roles) => roles.has("user") && roles.has("assistant")).length;
  if (complete < minimumCompleteExchanges) failures.push(`recent verbatim contains ${complete} complete exchanges; ${minimumCompleteExchanges} required`);
  return Object.freeze({
    continuation_safe: failures.length === 0,
    failures: Object.freeze(failures),
    exact_candidate_available: Boolean(context?.candidate_response?.exact_text),
    exact_recent_verbatim_available: complete >= minimumCompleteExchanges,
    hidden_reasoning_included: false
  });
}
