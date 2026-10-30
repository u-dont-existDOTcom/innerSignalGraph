import { RuntimeError } from "../core/errors.mjs";
import { journalContinuityUnsupported } from "../case-state/journal-continuity.mjs";

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
  const historicalDelivery = context?.historical_delivery_completion;
  const historicalDeliveryValid = historicalDelivery?.kind === "owner-supplied-historical-delivery-v1"
    && typeof historicalDelivery.source_artifact_id === "string" && historicalDelivery.source_artifact_id.length > 0
    && typeof historicalDelivery.assistant_turn_id === "string" && historicalDelivery.assistant_turn_id.length > 0
    && typeof historicalDelivery.in_reply_to_turn_id === "string" && historicalDelivery.in_reply_to_turn_id.length > 0
    && ["known", "unavailable"].includes(historicalDelivery.reported_sent_at_status)
    && (historicalDelivery.reported_sent_at_status === "known"
      ? typeof historicalDelivery.reported_sent_at === "string" && historicalDelivery.reported_sent_at.length > 0
      : historicalDelivery.reported_sent_at == null);
  if (historicalDelivery && !historicalDeliveryValid) failures.push("historical delivery completion is invalid");
  if (!candidate?.exact_text && !delivery && !historicalDeliveryValid) failures.push("exact candidate response or historical delivery checkpoint is missing");
  else if (candidate?.status === "sent") {
    if (!delivery || delivery.candidate_id !== candidate.id || delivery.candidate_version !== candidate.version) {
      failures.push("sent candidate is missing exact transcript-bound delivery evidence");
    }
  } else if (candidate && candidate.status === "superseded") failures.push("candidate response is not the current unsent candidate");
  const olderTurnAvailable = (context?.targeted_older_evidence ?? []).some((entry) => entry?.turn?.text);
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
    exact_delivery_available: Boolean(delivery || historicalDeliveryValid),
    historical_delivery_available: historicalDeliveryValid,
    exact_recent_verbatim_available: episodeCompleteness?.complete === true,
    journal_continuity_available: Boolean(context?.journal_continuity?.corpora?.length),
    journal_continuity_supported: context?.journal_continuity?.consumer_capability_supported === true,
    hidden_reasoning_included: false
  });
}
