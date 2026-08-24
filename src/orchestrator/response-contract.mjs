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


export function requiredRealizationNodeIds(plan = {}) {
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
  return text(plan?.questionContract?.question)
    || text(plan?.nextQuestion)
    || text(adjudication?.next_question);
}

export function enforceResponseContract(realization, { plan, adjudication, authorityMode = "current", authority = null } = {}) {
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
  const diagnosticNodeIds = requiredRealizationNodeIds(plan);
  const requiredNodeIds = authorityMode === "current" ? diagnosticNodeIds : [];
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
  const missingDiagnosticNodeIds = diagnosticNodeIds.filter((id) => !realizedNodeIds.includes(id));
  const blockedIds = new Set((authority?.HARD?.blockedNodes ?? []).map((item) => item.id));
  const blockedRealizationClaims = [...new Set(reportedRealizations.map((item) => text(item?.id)).filter((id) => blockedIds.has(id)))];
  const responseContract = {
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
    realizationCoveragePassed: missingNodeIds.length === 0
  };
  if (authorityMode !== "current") Object.assign(responseContract, {
    authorityMode,
    diagnosticCoverageNodeIds: diagnosticNodeIds,
    missingDiagnosticNodeIds,
    diagnosticCoveragePassed: missingDiagnosticNodeIds.length === 0,
    blockedRealizationClaims,
    hardAuthorityPassed: blockedRealizationClaims.length === 0,
    realizationCoveragePassed: missingNodeIds.length === 0 && blockedRealizationClaims.length === 0
  });

  return {
    answer: userFacingAnswer,
    answer_body: answerBody,
    next_question: question,
    responseContract
  };
}
