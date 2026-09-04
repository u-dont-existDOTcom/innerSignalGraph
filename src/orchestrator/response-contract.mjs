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

function wordCount(value) {
  return text(value).split(/\s+/).filter(Boolean).length;
}

function constrainBrevity(paragraphs, presentation = {}) {
  const maxParagraphs = Number.isSafeInteger(presentation.maxAnswerParagraphs)
    ? Math.max(1, presentation.maxAnswerParagraphs)
    : 3;
  const maxWords = Number.isSafeInteger(presentation.maxAnswerWords)
    ? Math.max(20, presentation.maxAnswerWords)
    : 180;
  const internalMapPattern = /\b(?:case variables?|winning route|rejected routes?|next-question (?:source|logic)|ROUTE\.[A-Z_]+|IC\.[A-Z_]+|SOM\.[A-Z_]+)\b/i;
  const withoutMapLeakage = paragraphs.filter((paragraph) => !internalMapPattern.test(paragraph));
  const selected = withoutMapLeakage.slice(0, maxParagraphs);
  const constrained = [];
  let remaining = maxWords;
  for (const paragraph of selected) {
    if (remaining <= 0) break;
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length <= remaining) {
      constrained.push(paragraph);
      remaining -= words.length;
      continue;
    }
    constrained.push(`${words.slice(0, remaining).join(" ").replace(/[,:;.!?]+$/, "")}…`);
    remaining = 0;
  }
  return {
    paragraphs: constrained,
    removedInternalMapParagraphs: paragraphs.filter((paragraph) => internalMapPattern.test(paragraph)),
    trimmed: constrained.join("\n\n") !== paragraphs.join("\n\n"),
    maxParagraphs,
    maxWords
  };
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

export function enforceResponseContract(realization, { plan, adjudication, presentation } = {}) {
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

  const originalAnswerBody = paragraphs.join("\n\n").trim();
  const brevity = constrainBrevity(paragraphs, presentation);
  const answerBody = brevity.paragraphs.join("\n\n").trim();
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
      presentation: {
        mode: presentation?.mode ?? "default",
        paragraphCount: brevity.paragraphs.length,
        wordCount: wordCount(answerBody),
        maxParagraphs: brevity.maxParagraphs,
        maxWords: brevity.maxWords,
        brevityPassed: !brevity.trimmed,
        trimmedForBrevity: brevity.trimmed,
        removedInternalMapParagraphs: brevity.removedInternalMapParagraphs,
        originalParagraphCount: splitParagraphs(originalAnswerBody).length,
        originalWordCount: wordCount(originalAnswerBody)
      }
    }
  };
}
