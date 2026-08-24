import { RuntimeError } from "../core/errors.mjs";

export const THERAPY_SCAFFOLD_MODES = Object.freeze(["current", "advisory", "model-first"]);

export function normalizeTherapyScaffoldMode(value = "current") {
  const mode = String(value || "current").trim().toLowerCase();
  if (!THERAPY_SCAFFOLD_MODES.includes(mode)) {
    throw new RuntimeError("THERAPY_SCAFFOLD_MODE must be current, advisory, or model-first.", { code: "BAD_CONFIG" });
  }
  return mode;
}

const SAFETY_BLOCKS = Object.freeze([
  ["present_safety", "unsafe"],
  ["orientation", "disoriented"],
  ["ability_to_stop", "no"],
  ["ability_to_return", "no"],
  ["dissociation", "high"],
  ["altered_state", "altered"],
  ["memory_source_risk", "present"]
]);

export function deterministicSafetyTrigger(snapshotOrPlan = {}) {
  const variables = snapshotOrPlan.variables ?? snapshotOrPlan;
  return SAFETY_BLOCKS.some(([field, value]) => variables?.[field] === value);
}

function nodeRecord(node) {
  return { id: node.id, title: node.title ?? "", tier: node.tier ?? null };
}

export function classifyInterventionAuthority({ snapshot = {}, plan = {} } = {}) {
  const variables = plan.variables ?? snapshot.variables ?? {};
  const safety = SAFETY_BLOCKS
    .filter(([field, value]) => variables[field] === value)
    .map(([field, value]) => ({ id: `safety:${field}`, field, value }));
  const blockedNodes = (plan.blockedNodes ?? []).map(nodeRecord);
  const prohibitedOverclaims = [...(plan.forbiddenOverclaims ?? [])];
  const prerequisites = [
    ...(plan.deferredNodes ?? []).map(nodeRecord),
    ...((plan.graphTrace?.sequencingNotes ?? []).map((statement) => ({ statement })))
  ];
  const selectedNodes = (plan.selectedNodes ?? []).map((node) => ({
    ...nodeRecord(node),
    recommendations: [...(node.recommendations ?? [])]
  }));
  const diagnosticNodeIds = [
    plan.primaryJob?.id,
    ...(plan.displayTrace?.secondaryJobs ?? []).map((node) => node.id)
  ].filter((id, index, all) => id && all.indexOf(id) === index);

  return Object.freeze({
    version: "therapy-scaffold-authority-v1",
    HARD: Object.freeze({
      safety: Object.freeze(safety),
      blockedNodes: Object.freeze(blockedNodes),
      prohibitedOverclaims: Object.freeze(prohibitedOverclaims),
      prohibitedDiagnosisOrCertainty: true
    }),
    PREREQUISITE: Object.freeze(prerequisites),
    ADVISORY: Object.freeze({ selectedNodes: Object.freeze(selectedNodes) }),
    DIAGNOSTIC_COVERAGE: Object.freeze({ nodeIds: Object.freeze(diagnosticNodeIds) }),
    canonicalQuestion: plan.questionContract?.question || plan.nextQuestion || ""
  });
}

export function hardDeterministicGateReasons(authority = {}) {
  return [
    ...(authority.HARD?.safety ?? []).map((item) => item.id),
    ...(authority.HARD?.blockedNodes ?? []).map((item) => `blocked:${item.id}`)
  ];
}

export function hardDeterministicGateActive(authority = {}) {
  return hardDeterministicGateReasons(authority).length > 0;
}

export function assertHardAuthorityPreserved(responseContract = {}, authority = {}) {
  const blocked = responseContract.blockedRealizationClaims ?? [];
  if (blocked.length) {
    throw new RuntimeError("The renderer claimed an intervention blocked by deterministic safety routing.", {
      code: "SCAFFOLD_HARD_AUTHORITY_VIOLATION",
      details: { blockedNodeIds: blocked, authorityVersion: authority.version ?? null }
    });
  }
}
