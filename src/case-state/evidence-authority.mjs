// Source-based authority rule, not a classifier of a statement's meaning.
// Projection never mutates the historical record supplied by the caller.
export function projectEvidenceAuthority(caseState) {
  if (caseState == null) return caseState;
  const projected = structuredClone(caseState);
  if (!Array.isArray(projected.items)) return projected;
  projected.items = projected.items.map((item) => {
    const modelObservation = item?.source?.kind === "current_turn_model_extraction"
      && item.domain === "runtime_observation";
    if (!modelObservation && item?.source?.assertion_scope !== "model_interpretation_only") return item;
    return {
      ...item,
      status: "inference",
      confidence: "low",
      source: {
        ...item.source,
        assertion_scope: "model_interpretation_only",
        ...(item.status === "inference" && item.confidence === "low" ? {} : {
          legacy_asserted_status: item.source.legacy_asserted_status ?? item.status,
          legacy_asserted_confidence: item.source.legacy_asserted_confidence ?? item.confidence
        })
      }
    };
  });
  return projected;
}
