import { UNAVAILABLE_RESOURCE_STATES } from "./contract.mjs";
import { routeTherapyProtocol } from "./router.mjs";
import { validateProtocolProfile } from "./validate.mjs";

export const LONGITUDINAL_PROTOCOL_VERSION = "therapy-protocol-longitudinal-v1";

function priorProfile(previousState) {
  if (!previousState || typeof previousState !== "object") return null;
  const candidate = previousState.profile ?? previousState;
  try {
    return validateProtocolProfile(candidate).profile;
  } catch {
    return null;
  }
}

function unknown(value) {
  return value === undefined || value === null || value === "" || value === "unknown";
}

function carryIfUnknown(next, previous, field) {
  if (unknown(next[field]) && !unknown(previous[field])) next[field] = previous[field];
}

export function transitionProtocolProfile({ previousState = null, protocolProfile = null } = {}) {
  const previous = priorProfile(previousState);
  const explicitCurrent = protocolProfile !== null && protocolProfile !== undefined;
  const currentRaw = protocolProfile && typeof protocolProfile === "object" && !Array.isArray(protocolProfile) ? protocolProfile : {};
  const current = validateProtocolProfile(currentRaw).profile;
  if (!previous) {
    return {
      profile: current,
      explicit: explicitCurrent,
      transition: { version: LONGITUDINAL_PROTOCOL_VERSION, index: 1, carriedFields: [], detectedTrajectories: [] }
    };
  }

  const next = { ...current };
  const carriedFields = [];
  const carry = (field) => {
    const before = next[field];
    carryIfUnknown(next, previous, field);
    if (next[field] !== before) carriedFields.push(field);
  };

  if (previous.original_concern_pending === "yes" && next.original_concern_pending !== "no") {
    for (const field of ["original_concern", "original_concern_pending"]) carry(field);
  }

  if (previous.unmet_external_need === "present" && next.unmet_external_need !== "resolved") {
    next.unmet_external_need = "present";
    if (!carriedFields.includes("unmet_external_need")) carriedFields.push("unmet_external_need");
    for (const field of [
      "required_external_resource",
      "resource_access_status",
      "access_barrier",
      "handoff_state",
      "fallback_available",
      "fallback_action",
      "fallback_limit",
      "unmet_external_need_detail",
      "retry_or_advocacy_trigger"
    ]) carry(field);
  }

  if (previous.historical_provenance_stable === "no" && next.historical_provenance_stable !== "yes") {
    next.historical_provenance_stable = "no";
    if (!carriedFields.includes("historical_provenance_stable")) carriedFields.push("historical_provenance_stable");
    carry("source_class");
    if (["bounded", "high_impact_supported"].includes(next.action_authority)) next.action_authority = "reversible_only";
  }

  const detectedTrajectories = [];
  const previousUnavailable = previous.resource_required === "yes"
    && (UNAVAILABLE_RESOURCE_STATES.has(previous.resource_access_status)
      || ["unavailable", "failed"].includes(previous.handoff_state));
  const sameResource = previous.required_external_resource
    && previous.required_external_resource === next.required_external_resource;
  if (previousUnavailable && sameResource && ["suggested", "unavailable", "failed"].includes(next.handoff_state)) {
    next.repeated_referral = "yes";
    next.adverse_trajectory = "repeated_unavailable_referral";
    detectedTrajectories.push("repeated_unavailable_referral");
  }

  const previousIndex = Number(previousState?.transition?.index ?? previousState?.index ?? 1);
  return {
    profile: next,
    explicit: true,
    transition: {
      version: LONGITUDINAL_PROTOCOL_VERSION,
      index: Number.isFinite(previousIndex) ? previousIndex + 1 : 2,
      carriedFields,
      detectedTrajectories
    }
  };
}

export function routeTherapyProtocolLongitudinal({ previousState = null, protocolProfile = null, variables = {}, unknowns = [], currentMessage = "", ablationVariant = "production" } = {}) {
  const transitioned = transitionProtocolProfile({ previousState, protocolProfile });
  const route = routeTherapyProtocol({
    protocolProfile: transitioned.explicit ? transitioned.profile : null,
    variables,
    unknowns,
    currentMessage,
    ablationVariant
  });
  return {
    ...route,
    longitudinalState: {
      contractVersion: LONGITUDINAL_PROTOCOL_VERSION,
      profile: route.profile,
      transition: transitioned.transition
    }
  };
}
