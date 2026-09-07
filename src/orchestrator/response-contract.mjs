function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeQuestion(value) {
  return text(value)
    .replace(/[“”‘’]/g, '"')
    .replace(/\s+/g, " ")
    .replace(/\s*\?+\s*$/, "?")
    .toLowerCase();
}

function splitParagraphs(answer) {
  return text(answer).split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
}

function stripFinalQuestionSentence(paragraph) {
  const value = text(paragraph);
  if (!value.endsWith("?")) return { text: value, removed: "" };

  // The renderer contract reserves the final substantive question for the
  // deterministic plan.  Remove only the last question sentence/paragraph,
  // preserving explanatory prose that came before it.
  const boundaries = [];
  for (let i = 0; i < value.length - 1; i += 1) {
    const char = value[i];
    if ((char === "." || char === "!" || char === "?") && /\s/.test(value[i + 1] ?? "")) boundaries.push(i + 1);
  }
  const start = boundaries.length ? boundaries[boundaries.length - 1] : 0;
  const removed = value.slice(start).trim();
  const kept = value.slice(0, start).trim();
  return { text: kept, removed };
}

function relationalPolicyMarkers(plan = {}) {
  const trace = plan.pathPerformance ?? {};
  const readiness = trace.relational_readiness;
  const required = [];
  const forbidden = [];
  const effectivePause = readiness?.status === "PAUSE_ROMANCE" || trace.goal_substitution?.romance_pause === true;
  const pauseControlsTurn = effectivePause && trace.route === "action"
    && (text(trace.reason).includes("pausing active romance-seeking")
      || trace.goal_substitution?.narrow_romance_pause === true);
  const assessControlsTurn = readiness?.status === "ASSESS_BEFORE_ROMANCE" && trace.route === "reconsider"
    && text(trace.reason).includes("Romantic readiness is unresolved");
  const supportControlsTurn = trace.goal_substitution?.instrumental_socializing === true && trace.route === "action";

  // Preserve the decision constraint even when a higher-priority safety/external/leave
  // route controls the current response, but do not force the renderer to re-announce
  // romance policy during an unrelated or more urgent turn.
  if (effectivePause) {
    if (pauseControlsTurn) required.push("POLICY.RELATIONAL_PAUSE");
    forbidden.push("POLICY.RELATIONAL_NOT_BLOCKED");
  } else if (readiness?.status === "ASSESS_BEFORE_ROMANCE") {
    if (assessControlsTurn) required.push("POLICY.RELATIONAL_ASSESS");
    forbidden.push("POLICY.RELATIONAL_PAUSE", "POLICY.RELATIONAL_NOT_BLOCKED");
  } else if (readiness?.status === "NOT_BLOCKED") {
    // NOT_BLOCKED prevents an invented prohibition; it need not become a repeated
    // user-facing declaration when romance is not the live job.
    forbidden.push("POLICY.RELATIONAL_PAUSE");
  }
  if (supportControlsTurn) required.push("POLICY.NONROMANTIC_SUPPORT_TARGET");
  return { required: [...new Set(required)], forbidden: [...new Set(forbidden)] };
}

export function requiredRealizationNodeIds(plan = {}) {
  if (plan.executionContract?.version === 1) {
    const required = plan.executionContract.requiredNodeIds;
    if (!Array.isArray(required) || required.some(id => typeof id !== "string" || !id.trim())) throw new TypeError("Invalid execution-contract node list.");
    const primary = text(plan.primaryJob?.id);
    return [...new Set([primary, ...required].filter(Boolean))];
  }
  const ids = [];
  const primary = text(plan?.primaryJob?.id);
  if (primary) ids.push(primary);
  for (const item of plan?.displayTrace?.secondaryJobs ?? []) {
    const id = text(item?.id);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function canonicalQuestion({ plan, adjudication } = {}) {
  if (plan?.questionContract?.mode === "none") return "";
  if (plan?.questionContract?.mode === "canonical") return text(plan.questionContract.question);
  return text(plan?.questionContract?.question)
    || text(plan?.nextQuestion)
    || text(adjudication?.next_question);
}

export function enforceResponseContract(realization, { plan, adjudication } = {}) {
  const question = canonicalQuestion({ plan, adjudication });
  const paragraphs = splitParagraphs(realization?.answer);
  let strippedQuestion = "";

  if (paragraphs.length) {
    const lastIndex = paragraphs.length - 1;
    const final = stripFinalQuestionSentence(paragraphs[lastIndex]);
    if (final.removed) {
      strippedQuestion = final.removed;
      if (final.text) paragraphs[lastIndex] = final.text;
      else paragraphs.pop();
    }
  }

  const answerBody = paragraphs.join("\n\n").trim();
  const userFacingAnswer = [answerBody, question].filter(Boolean).join("\n\n");
  const rendererQuestion = text(realization?.next_question);
  const requiredNodeIds = requiredRealizationNodeIds(plan);
  const normalizedAnswer = answerBody.replace(/\s+/g, " ").trim();
  const reportedRealizations = Array.isArray(realization?.realized_nodes) ? realization.realized_nodes : [];
  const verifiedRealizations = [];
  const rejectedRealizations = [];
  for (const item of reportedRealizations) {
    const id = text(item?.id);
    const evidenceQuote = text(item?.evidence_quote);
    const normalizedQuote = evidenceQuote.replace(/\s+/g, " ").trim();
    const verified = Boolean(id && normalizedQuote.length >= 8 && normalizedAnswer.includes(normalizedQuote));
    const record = { id, evidenceQuote, verified };
    if (verified) verifiedRealizations.push(record);
    else rejectedRealizations.push(record);
  }
  const realizedNodeIds = [...new Set(verifiedRealizations.map((item) => item.id))];
  const missingNodeIds = requiredNodeIds.filter((id) => !realizedNodeIds.includes(id));
  const pathContract = plan?.pathPerformanceContract;
  const prohibitedNodeIds = pathContract?.prohibit_prior_exercise
    ? reportedRealizations.map(item => text(item?.id)).filter(id => id && !id.startsWith("POLICY.") && !requiredNodeIds.includes(id)) : [];
  const relational = relationalPolicyMarkers(plan);
  const relationalTracked = Boolean(plan?.pathPerformance?.relational_readiness || relational.required.length || relational.forbidden.length);
  const missingRelationalPolicyMarkers = relational.required.filter(id => !realizedNodeIds.includes(id));
  const forbiddenRelationalPolicyMarkers = relational.forbidden.filter(id => realizedNodeIds.includes(id));
  const pathAdherence = (!pathContract || (missingNodeIds.length === 0 && prohibitedNodeIds.length === 0))
    && missingRelationalPolicyMarkers.length === 0 && forbiddenRelationalPolicyMarkers.length === 0;

  return {
    answer: userFacingAnswer,
    answer_body: answerBody,
    next_question: question,
    responseContract: {
      version: "response-question-contract-v3",
      canonicalQuestion: question,
      rendererQuestion,
      rendererQuestionMatched: normalizeQuestion(rendererQuestion) === normalizeQuestion(question),
      strippedUnauthorizedFinalQuestion: strippedQuestion || "",
      requiredRealizationNodeIds: requiredNodeIds,
      realizedNodeIds,
      verifiedRealizations,
      rejectedRealizations,
      missingRealizationNodeIds: missingNodeIds,
      realizationCoveragePassed: missingNodeIds.length === 0,
      ...(relationalTracked ? { relationalPolicyMarkersRequired: relational.required, missingRelationalPolicyMarkers, forbiddenRelationalPolicyMarkers } : {}),
      ...(pathContract || relational.required.length || relational.forbidden.length ? {
        pathPerformanceAdherencePassed: pathAdherence,
        prohibitedRealizationNodeIds: [...new Set(prohibitedNodeIds)],
        semanticAdherence: relationalTracked ? "DECLARED_POLICY_MARKERS_ARE_VERBATIM_GROUNDED_BUT_REQUIRE_SEPARATE_HUMAN_USEFULNESS_AND_HARM_REVIEW" : "REQUIRES_SEPARATE_HUMAN_USEFULNESS_AND_HARM_REVIEW"
      } : {})
    }
  };
}
