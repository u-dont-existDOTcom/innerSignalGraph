function normalizedResultText(result) {
  return [
    result?.answer,
    result?.next_question,
    ...(result?.what_is_clear ?? []),
    ...(result?.uncertainties ?? []),
    ...(result?.accepted_insights ?? []),
    ...(result?.rejected_claims ?? []),
    result?.decision_summary
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

function normalizeConcepts(acceptance = {}) {
  if (Array.isArray(acceptance.requiredConcepts)) return acceptance.requiredConcepts;
  return (acceptance.requiredPatterns ?? []).map((pattern) => ({
    id: String(pattern),
    description: String(pattern),
    anyPatterns: [String(pattern)]
  }));
}

function normalizeForbidden(acceptance = {}) {
  if (Array.isArray(acceptance.forbiddenClaims)) return acceptance.forbiddenClaims;
  return (acceptance.forbiddenPatterns ?? []).map((pattern) => ({
    id: String(pattern),
    description: String(pattern),
    anyPatterns: [String(pattern)]
  }));
}

function findFirstMatch(text, patterns = []) {
  for (const rawPattern of patterns) {
    const pattern = String(rawPattern).toLowerCase();
    if (pattern && text.includes(pattern)) return rawPattern;
  }
  return null;
}

/**
 * Text acceptance is intentionally limited to claims that truly need to survive
 * into the user-visible answer.  Planning obligations belong to the structured
 * intervention contract, not to lexical phrase requirements on prose.
 */
export function evaluateTextBenchmark(result, acceptance = {}) {
  const text = normalizedResultText(result);
  const requiredConcepts = normalizeConcepts(acceptance);
  const forbiddenClaims = normalizeForbidden(acceptance);

  const required = requiredConcepts.map((concept) => {
    const matchedPattern = findFirstMatch(text, concept.anyPatterns ?? []);
    return {
      id: concept.id,
      description: concept.description ?? concept.id,
      ok: Boolean(matchedPattern),
      matchedPattern: matchedPattern ?? null
    };
  });

  const forbidden = forbiddenClaims.map((claim) => {
    const matchedPattern = findFirstMatch(text, claim.anyPatterns ?? []);
    return {
      id: claim.id,
      description: claim.description ?? claim.id,
      present: Boolean(matchedPattern),
      matchedPattern: matchedPattern ?? null
    };
  });

  const missingRequired = required.filter((item) => !item.ok).map((item) => item.id);
  const presentForbidden = forbidden.filter((item) => item.present).map((item) => item.id);

  return {
    ok: missingRequired.length === 0 && presentForbidden.length === 0,
    missingRequired,
    presentForbidden,
    required,
    forbidden
  };
}

function idsFrom(items = []) {
  return new Set(items.map((item) => typeof item === "string" ? item : item?.id).filter(Boolean));
}

function containsAllPatterns(items = [], patterns = []) {
  const text = items.filter(Boolean).join("\n").toLowerCase();
  return patterns.every((pattern) => text.includes(String(pattern).toLowerCase()));
}

/**
 * Evaluate a difficult-case result across both layers of the new architecture:
 *   1. deterministic plan/route obligations, and
 *   2. user-visible semantic and epistemic obligations.
 *
 * This prevents a good answer from failing merely because it did not restate a
 * secondary planning insight, while still proving that the planner retained it.
 */
export function evaluateStructuredBenchmark(result, acceptance = {}) {
  const responseAcceptance = acceptance.response ?? acceptance;
  const text = evaluateTextBenchmark(result, responseAcceptance);
  const plan = result?.interventionContract ?? null;
  const planAcceptance = acceptance.plan ?? {};

  const selectedIds = idsFrom(plan?.selectedNodes ?? []);
  const secondaryIds = idsFrom(plan?.secondaryJobs ?? []);
  const deferredIds = idsFrom(plan?.deferredNodes ?? []);
  const blockedIds = idsFrom(plan?.blockedNodes ?? []);
  const allSelected = new Set([...selectedIds, ...secondaryIds]);

  const planChecks = [];
  if (planAcceptance.primary) {
    planChecks.push({
      id: `primary:${planAcceptance.primary}`,
      ok: plan?.primaryJob?.id === planAcceptance.primary,
      actual: plan?.primaryJob?.id ?? null
    });
  }
  for (const id of planAcceptance.selectedIncludes ?? []) {
    planChecks.push({ id: `selected:${id}`, ok: allSelected.has(id), actual: [...allSelected] });
  }
  for (const id of planAcceptance.selectedExcludes ?? []) {
    planChecks.push({ id: `selected-excludes:${id}`, ok: !allSelected.has(id), actual: [...allSelected] });
  }
  for (const id of planAcceptance.deferredIncludes ?? []) {
    planChecks.push({ id: `deferred:${id}`, ok: deferredIds.has(id), actual: [...deferredIds] });
  }
  for (const id of planAcceptance.blockedIncludes ?? []) {
    planChecks.push({ id: `blocked:${id}`, ok: blockedIds.has(id), actual: [...blockedIds] });
  }
  if (planAcceptance.nextQuestion) {
    planChecks.push({
      id: "next-question",
      ok: plan?.nextQuestion === planAcceptance.nextQuestion && result?.next_question === planAcceptance.nextQuestion,
      actual: { plan: plan?.nextQuestion ?? "", result: result?.next_question ?? "" }
    });
  }
  if ((planAcceptance.requiredNuancePatterns ?? []).length) {
    planChecks.push({
      id: "required-nuance",
      ok: containsAllPatterns(plan?.requiredNuance ?? [], planAcceptance.requiredNuancePatterns),
      actual: plan?.requiredNuance ?? []
    });
  }

  const missingPlan = planChecks.filter((item) => !item.ok).map((item) => item.id);
  return {
    ok: Boolean(plan) && text.ok && missingPlan.length === 0,
    response: text,
    plan: {
      present: Boolean(plan),
      checks: planChecks,
      missing: missingPlan,
      primary: plan?.primaryJob?.id ?? null,
      selected: [...allSelected],
      deferred: [...deferredIds],
      blocked: [...blockedIds]
    }
  };
}
