import { RuntimeError } from "../core/errors.mjs";
import { appOwnedCopy, ROUTE_IDS } from "./app-owned-copy.mjs";

function clean(parts) {
  return parts.map((part) => String(part || "").trim()).filter(Boolean).join("\n\n");
}

export function buildHypnosisPlaybackPlan(draft) {
  const copy = appOwnedCopy(draft.language);
  return Object.freeze({
    contractVersion: draft.contract_version,
    language: draft.language,
    relationship: draft.relationship,
    target: draft.target,
    premise: draft.premise,
    preGateTranscript: String(draft.orientation).trim(),
    gate: Object.freeze({
      ...copy.gate,
      labels: copy.labels,
      routeIds: ROUTE_IDS
    }),
    components: Object.freeze({
      continue_inward: Object.freeze({ ...draft.continue_inward }),
      stay_external: Object.freeze({ ...draft.stay_external })
    }),
    aftercare: String(draft.aftercare).trim(),
    appOwned: Object.freeze({
      announcements: copy.announcements,
      endBody: copy.endBody,
      wakingReturn: copy.wakingReturn
    })
  });
}

export function renderHypnosisRoute(plan, routeId) {
  if (!ROUTE_IDS.includes(routeId)) {
    throw new RuntimeError(`Unknown hypnosis route: ${routeId}`, { code: "BAD_HYPNOSIS_ROUTE" });
  }
  if (!plan || !plan.gate || !plan.appOwned) {
    throw new RuntimeError("A valid hypnosis playback plan is required.", { code: "BAD_HYPNOSIS_PLAN" });
  }

  const announcement = plan.appOwned.announcements[routeId];
  let body;
  if (routeId === "continue_inward") {
    const route = plan.components.continue_inward;
    body = clean([route.induction, route.deepening, route.target_work, route.integration, route.return_lead]);
  } else if (routeId === "stay_external") {
    const route = plan.components.stay_external;
    body = clean([route.grounding, route.ordinary_choice]);
  } else {
    body = plan.appOwned.endBody;
  }

  return clean([announcement, body, plan.appOwned.wakingReturn]);
}
