import { RuntimeError } from "../core/errors.mjs";
import { journalContinuityUnsupported } from "../case-state/journal-continuity.mjs";
import { SELF_DIRECTED_RISK_RETRIEVAL_ITEM_ID } from "../case-state/self-directed-risk.mjs";
import { validateHistoricalDeliveryCheckpoint } from "./private-case-communication.mjs";

export class CaseNotContinuationSafeError extends RuntimeError {
  constructor(failures) {
    super(`Case is not continuation-safe for a fresh session: ${failures.join("; ")}`, {
      code: "CASE_NOT_CONTINUATION_SAFE",
      details: { failures: [...failures] }
    });
    this.name = "CaseNotContinuationSafeError";
  }
}

export function assessContinuationSafety(context) {
  const failures = [];
  if (!context?.case_state) failures.push("current structured case state is missing");
  if (!context?.last_state_diff) failures.push("last state diff is missing");
  if (!context?.current_episode) failures.push("current therapeutic episode is missing");
  if (!context?.constitution_ref?.version) failures.push("constitution reference is missing");
  const candidate = context?.candidate_response;
  const delivery = context?.delivery_completion;
  // An owner-reported delivery of the stored pair that ends the transcript can stand in only when no candidate governs. It is
  // continuity provenance: it records no audit and approves nothing.
  let historicalDelivery = false;
  if (context?.historical_delivery_completion != null) {
    try {
      validateHistoricalDeliveryCheckpoint(context.historical_delivery_completion);
      historicalDelivery = true;
    } catch { failures.push("historical delivery completion is invalid"); }
  }
  if (!candidate?.exact_text && !delivery && !historicalDelivery) failures.push("exact candidate response is missing");
  else if (candidate?.status === "sent") {
    if (!delivery || delivery.candidate_id !== candidate.id || delivery.candidate_version !== candidate.version) {
      failures.push("sent candidate is missing exact transcript-bound delivery evidence");
    }
  } else if (candidate && candidate.status === "superseded") failures.push("candidate response is not the current unsent candidate");
  // The self-directed-risk record asks for an older turn only so the reply check can read it. It is not provenance for the case, so an
  // entry that exists for that reason alone never stands in for the older raw evidence this check requires.
  const onlyForRiskRecord = (entry) => Array.isArray(entry?.item_ids) && entry.item_ids.length > 0 && entry.item_ids.every((id) => id === SELF_DIRECTED_RISK_RETRIEVAL_ITEM_ID);
  const olderTurnAvailable = (context?.targeted_older_evidence ?? []).some((entry) => entry?.turn?.text && !onlyForRiskRecord(entry));
  const olderSourceAvailable = (context?.source_artifact_refs ?? []).length > 0;
  if (!olderTurnAvailable && !olderSourceAvailable) failures.push("targeted older raw evidence has no retrievable private provenance source");
  if (context?.journal_continuity && journalContinuityUnsupported(context.journal_continuity)) {
    failures.push("journal continuity capability is unsupported by this consumer");
  }
  const episodeCompleteness = context?.recent_verbatim?.episode_completeness;
  if (episodeCompleteness?.required !== true || episodeCompleteness?.complete !== true) {
    const reasons = episodeCompleteness?.failures?.length
      ? `: ${episodeCompleteness.failures.join(", ")}`
      : "";
    failures.push(`exact active therapy episode is incomplete${reasons}`);
  }
  return Object.freeze({
    continuation_safe: failures.length === 0,
    failures: Object.freeze(failures),
    exact_candidate_available: Boolean(candidate?.exact_text && candidate.status !== "sent"),
    exact_delivery_available: Boolean(delivery || historicalDelivery),
    historical_delivery_available: historicalDelivery,
    exact_recent_verbatim_available: episodeCompleteness?.complete === true,
    journal_continuity_available: Boolean(context?.journal_continuity?.corpora?.length),
    journal_continuity_supported: context?.journal_continuity?.consumer_capability_supported === true,
    hidden_reasoning_included: false
  });
}
