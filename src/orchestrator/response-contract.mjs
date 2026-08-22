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

function canonicalQuestionPlacement(plan = {}) {
  const variable = text(plan?.questionContract?.source?.variable)
    || text(plan?.nextQuestionSource?.variable);
  return /(?:suicid|self[_\s-]?harm|personal.*safety|safety.*personal|acute.*(?:danger|risk)|medical.*(?:danger|risk)|current.*safety)/i.test(variable)
    ? "before-answer"
    : "after-answer";
}

export function enforceResponseContract(realization, { plan, adjudication } = {}) {
  const question = canonicalQuestion({ plan, adjudication });
  const questionPlacement = canonicalQuestionPlacement(plan);
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
  const answerParts = questionPlacement === "before-answer"
    ? [question, answerBody]
    : [answerBody, question];
  const userFacingAnswer = answerParts.filter(Boolean).join("\n\n");
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

  return {
    answer: userFacingAnswer,
    answer_body: answerBody,
    next_question: question,
    responseContract: {
      version: "response-question-contract-v3",
      canonicalQuestion: question,
      canonicalQuestionPlacement: questionPlacement,
      rendererQuestion,
      rendererQuestionMatched: normalizeQuestion(rendererQuestion) === normalizeQuestion(question),
      strippedUnauthorizedFinalQuestion: strippedQuestion || "",
      requiredRealizationNodeIds: requiredNodeIds,
      realizedNodeIds,
      verifiedRealizations,
      rejectedRealizations,
      missingRealizationNodeIds: missingNodeIds,
      realizationCoveragePassed: missingNodeIds.length === 0
    }
  };
}
