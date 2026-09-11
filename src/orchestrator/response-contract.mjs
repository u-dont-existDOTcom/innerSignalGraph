import {
  romanceReferenceMentions,
  isCanonicalRomanceReferenceToken
} from "../core/romance-reference.mjs";
import { DEVELOPMENTAL_BREAKDOWN_QUESTION, DEVELOPMENTAL_SUCCESS_QUESTION } from "../case-formulation/developmental-capacity.mjs";

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

const ROMANCE_GUIDE_REFERENCE_MARKER = "POLICY.ROMANCE_GUIDE_REFERENCE";
const THREAT_PATHWAY_MARKERS = Object.freeze([
  "POLICY.THREAT_PATHWAY.ENGAGE",
  "POLICY.THREAT_PATHWAY.ASSESS",
  "POLICY.THREAT_PATHWAY.IMMINENT"
]);
const representationMarker = representation => representation?.mode && representation?.channel
  ? `POLICY.REPRESENTATION.${representation.mode}.${representation.channel}` : null;
const SYMBOLIC_OVERCLAIM_PATTERNS = Object.freeze([
  { code: "SYMBOL_AS_TRAUMA_FACT", pattern: /\b(?:your|the)\s+(?:house|monster|colou?r|drawing|image|poem|story|metaphor)\s+(?:means|proves|reveals|confirms|shows)\s+(?:that\s+)?(?:you\s+(?:were|have been)\s+abused|(?:the|your)\s+trauma\s+(?:really\s+)?happened|(?:a\s+)?(?:repressed|recovered)\s+memory\s+is\s+(?:real|true)|you\s+have\s+[a-z -]*trauma)\b/i },
  { code: "UNCONSCIOUS_REVELATION", pattern: /\byour unconscious (?:is )?(?:revealing|telling|showing)\b/i },
  { code: "HIDDEN_MESSAGE_CERTAINTY", pattern: /\b(?:this|the)\s+(?:archetype|synchronicity|symbol|image)\s+(?:is|contains)\s+(?:a\s+)?hidden message\b/i },
  { code: "ONTOLOGICAL_MESSAGE_CERTAINTY", pattern: /\b(?:the universe|an archetype|this synchronicity)\s+(?:is telling|confirms|proves|reveals)\b/i },
  { code: "AI_IMAGE_REVELATION", pattern: /\b(?:the|this|an)\s+AI-generated (?:image|artwork)\s+(?:is|offers|provides|contains)\s+(?:a\s+)?revelation\b/i }
]);
function symbolicOverclaimViolations(answer) {
  return SYMBOLIC_OVERCLAIM_PATTERNS.filter(({ pattern }) => pattern.test(answer)).map(({ code }) => code);
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
  if (plan?.questionContract?.mode === "canonical-pair") {
    const questions = plan.questionContract.questions;
    if (!Array.isArray(questions) || questions.length !== 2 || questions.some(item => !text(item))) {
      throw new TypeError("A canonical-pair question contract requires exactly two non-empty ordered questions.");
    }
    const joined = questions.map(text).join("\n\n");
    if (text(plan.questionContract.question) !== joined) throw new TypeError("Canonical-pair question text must preserve the ordered question unit exactly.");
    return joined;
  }
  return text(plan?.questionContract?.question)
    || text(plan?.nextQuestion)
    || text(adjudication?.next_question);
}

export function enforceResponseContract(realization, { plan, adjudication } = {}) {
  const plannedQuestion = canonicalQuestion({ plan, adjudication });
  const originalAnswer = text(realization?.answer);
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

  const rendererQuestion = text(realization?.next_question);
  const answerBody = paragraphs.join("\n\n").trim();
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
  const requiredThreatPathwayMarker = text(plan?.threatPathwayContract?.marker);
  const missingThreatPathwayMarker = Boolean(requiredThreatPathwayMarker && !realizedNodeIds.includes(requiredThreatPathwayMarker));
  const developmentalContract = plan?.developmentalCapacityContract ?? null;
  const developmentalQuestionRoute = Boolean(developmentalContract
    && ["canonical", "canonical-pair"].includes(plan?.questionContract?.mode)
    && developmentalContract.questionOrder?.length);
  const reportedDevelopmentalQuestions = Array.isArray(realization?.developmental_questions)
    ? realization.developmental_questions.map(item => ({ kind: text(item?.kind), text: text(item?.text) })) : null;
  const expectedDevelopmentalOrder = developmentalContract?.questionOrder ?? [];
  const reportedDevelopmentalQuestion = reportedDevelopmentalQuestions?.map(item => item.text).join("\n\n") ?? "";
  const developmentalQuestionShapePassed = !developmentalQuestionRoute || reportedDevelopmentalQuestions == null || (
    reportedDevelopmentalQuestions.length === expectedDevelopmentalOrder.length
    && reportedDevelopmentalQuestions.every((item, index) => item.kind === expectedDevelopmentalOrder[index] && Boolean(item.text))
    && normalizeQuestion(rendererQuestion) === normalizeQuestion(reportedDevelopmentalQuestion)
  );
  // Historical/mock realizations may omit the structured semantic-question
  // report and use the deterministic English default. Live realizations can
  // supply localized wording while preserving the selected semantic kinds.
  const question = developmentalQuestionRoute && reportedDevelopmentalQuestions?.length && developmentalQuestionShapePassed
    ? reportedDevelopmentalQuestion : plannedQuestion;
  const userFacingAnswer = [answerBody, question].filter(Boolean).join("\n\n");
  const pairedDevelopmentalRoute = developmentalContract?.pairedContrastRequired === true
    && plan?.questionContract?.mode === "canonical-pair";
  const requiredDevelopmentalPolicyMarker = text(developmentalContract?.requiredPolicyMarker);
  const missingDevelopmentalPolicyMarker = Boolean(requiredDevelopmentalPolicyMarker
    && !realizedNodeIds.includes(requiredDevelopmentalPolicyMarker));
  const unexpectedDevelopmentalRouteQuestionCount = developmentalQuestionRoute
    ? (originalAnswer.match(/\?/g) ?? []).length : 0;
  const unexpectedPairedRouteQuestionCount = pairedDevelopmentalRoute
    ? unexpectedDevelopmentalRouteQuestionCount : 0;
  const orderedQuestionByKind = {
    "successful-exception": DEVELOPMENTAL_SUCCESS_QUESTION,
    "breakdown-under-distress": DEVELOPMENTAL_BREAKDOWN_QUESTION
  };
  const pairedOrder = plan?.questionContract?.order ?? [];
  const expectedPairedQuestions = pairedOrder.map(kind => orderedQuestionByKind[kind]);
  const pairedContrastOrderPassed = !pairedDevelopmentalRoute || (
    pairedOrder.length === 2
    && new Set(pairedOrder).size === 2
    && expectedPairedQuestions.every(Boolean)
    && JSON.stringify(plan.questionContract.questions) === JSON.stringify(expectedPairedQuestions)
    && plannedQuestion === expectedPairedQuestions.join("\n\n")
    && developmentalQuestionShapePassed
  );
  const unexpectedThreatPathwayMarkers = realizedNodeIds.filter(id => THREAT_PATHWAY_MARKERS.includes(id) && id !== requiredThreatPathwayMarker);
  const pathContract = plan?.pathPerformanceContract;
  const prohibitedNodeIds = pathContract?.prohibit_prior_exercise
    ? reportedRealizations.map(item => text(item?.id)).filter(id => id && !id.startsWith("POLICY.") && !requiredNodeIds.includes(id)) : [];
  const relational = relationalPolicyMarkers(plan);
  const relationalTracked = Boolean(plan?.pathPerformance?.relational_readiness || relational.required.length || relational.forbidden.length);
  const missingRelationalPolicyMarkers = relational.required.filter(id => !realizedNodeIds.includes(id));
  const forbiddenRelationalPolicyMarkers = relational.forbidden.filter(id => realizedNodeIds.includes(id));
  const representation = pathContract?.representation ?? null;
  const selectedRepresentation = representation?.selected ?? null;
  const observedRepresentation = representation?.observed ?? null;
  const requiredRepresentationPolicyMarker = representationMarker(selectedRepresentation);
  const priorRepresentationPolicyMarker = representationMarker(observedRepresentation);
  const unexpectedRepresentationPolicyMarkers = realizedNodeIds.filter(id => id.startsWith("POLICY.REPRESENTATION.") && id !== requiredRepresentationPolicyMarker);
  const missingRepresentationPolicyMarker = Boolean(requiredRepresentationPolicyMarker && !realizedNodeIds.includes(requiredRepresentationPolicyMarker));
  const forbiddenPriorRepresentationPolicyMarker = Boolean(["SWITCH", "DECLINED", "STABILIZE_CLEAR"].includes(representation?.action) && priorRepresentationPolicyMarker
    && priorRepresentationPolicyMarker !== requiredRepresentationPolicyMarker && realizedNodeIds.includes(priorRepresentationPolicyMarker));
  const symbolicOverclaims = representation ? symbolicOverclaimViolations(answerBody) : [];
  const romanceGuide = plan?.romanceGuide ?? null;
  const romanceReferenceDecision = romanceGuide?.realization?.reference_decision ?? "NOT_AUTHORIZED";
  const romanceReferenceAllowed = romanceReferenceDecision === "OFFER_OPTIONAL_REFERENCE"
    && romanceGuide?.realization?.reference?.url === "https://romance.u-dont-exist.com";
  const romanceReferenceMentionsInAnswer = romanceReferenceMentions(answerBody);
  const romanceReferenceShown = romanceReferenceMentionsInAnswer.length > 0;
  const romanceReferenceCanonical = romanceReferenceShown
    && romanceReferenceMentionsInAnswer.every(isCanonicalRomanceReferenceToken);
  const romanceReferenceMarker = verifiedRealizations.find(item => item.id === ROMANCE_GUIDE_REFERENCE_MARKER);
  const markerMentions = romanceReferenceMentions(romanceReferenceMarker?.evidenceQuote);
  const romanceReferenceMarkerValid = Boolean(romanceReferenceMarker && markerMentions.length
    && markerMentions.every(isCanonicalRomanceReferenceToken));
  const missingRomanceGuideReferenceMarker = romanceReferenceShown && romanceReferenceAllowed
    && romanceReferenceCanonical && !romanceReferenceMarkerValid;
  const forbiddenRomanceGuideReference = romanceReferenceShown && (!romanceReferenceAllowed || !romanceReferenceCanonical);
  const unsupportedRomanceGuideReferenceMarker = realizedNodeIds.includes(ROMANCE_GUIDE_REFERENCE_MARKER)
    && (!romanceReferenceShown || !romanceReferenceAllowed || !romanceReferenceCanonical || !romanceReferenceMarkerValid);
  const romanceGuideAdherence = !missingRomanceGuideReferenceMarker
    && !forbiddenRomanceGuideReference && !unsupportedRomanceGuideReferenceMarker;
  const pathAdherence = (!pathContract || (missingNodeIds.length === 0 && prohibitedNodeIds.length === 0))
    && missingRelationalPolicyMarkers.length === 0 && forbiddenRelationalPolicyMarkers.length === 0
    && !missingRepresentationPolicyMarker && !forbiddenPriorRepresentationPolicyMarker && unexpectedRepresentationPolicyMarkers.length === 0 && symbolicOverclaims.length === 0
    && !missingThreatPathwayMarker && unexpectedThreatPathwayMarkers.length === 0 && romanceGuideAdherence
    && !missingDevelopmentalPolicyMarker && unexpectedDevelopmentalRouteQuestionCount === 0
    && developmentalQuestionShapePassed && pairedContrastOrderPassed;

  return {
    answer: userFacingAnswer,
    answer_body: answerBody,
    next_question: question,
    responseContract: {
      version: "response-question-contract-v4",
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
      ...(requiredThreatPathwayMarker ? {
        requiredThreatPathwayMarker,
        missingThreatPathwayMarker,
        unexpectedThreatPathwayMarkers,
        threatPathwaySemanticLimit: "GROUNDED_MARKER_REQUIRES_SEPARATE_HUMAN_USEFULNESS_AND_HARM_REVIEW"
      } : {}),
      ...(developmentalContract ? {
        requiredDevelopmentalPolicyMarker,
        missingDevelopmentalPolicyMarker,
        pairedContrastRequired: pairedDevelopmentalRoute,
        pairedContrastOrderPassed,
        developmentalQuestionShapePassed,
        reportedDevelopmentalQuestions: reportedDevelopmentalQuestions ?? [],
        unexpectedDevelopmentalRouteQuestionCount,
        unexpectedPairedRouteQuestionCount,
        prohibitedDevelopmentalTangentTopics: developmentalContract.prohibitedTangentTopics ?? [],
        developmentalSemanticLimit: "GROUNDED_MARKER_AND_QUESTION_SHAPE_REQUIRE_SEPARATE_HUMAN_USEFULNESS_AND_HARM_REVIEW"
      } : {}),
      ...(relationalTracked ? { relationalPolicyMarkersRequired: relational.required, missingRelationalPolicyMarkers, forbiddenRelationalPolicyMarkers } : {}),
      ...(representation ? {
        requiredRepresentationPolicyMarker,
        missingRepresentationPolicyMarker,
        forbiddenPriorRepresentationPolicyMarker,
        unexpectedRepresentationPolicyMarkers,
        symbolicOverclaimViolations: symbolicOverclaims,
        representationSemanticLimit: "NARROW_OBVIOUS_OVERCLAIM_BACKSTOP_REQUIRES_SEPARATE_HUMAN_REVIEW"
      } : {}),
      ...(romanceGuide ? {
        romanceGuideReferenceDecision: romanceReferenceDecision,
        romanceGuideReferenceAllowed: romanceReferenceAllowed,
        romanceGuideReferenceShown: romanceReferenceShown,
        romanceGuideReferenceCanonical: romanceReferenceCanonical,
        missingRomanceGuideReferenceMarker,
        forbiddenRomanceGuideReference,
        unsupportedRomanceGuideReferenceMarker
      } : {}),
      ...(pathContract || requiredThreatPathwayMarker || relational.required.length || relational.forbidden.length || romanceGuide || developmentalContract ? {
        pathPerformanceAdherencePassed: pathAdherence,
        prohibitedRealizationNodeIds: [...new Set(prohibitedNodeIds)],
        semanticAdherence: relationalTracked ? "DECLARED_POLICY_MARKERS_ARE_VERBATIM_GROUNDED_BUT_REQUIRE_SEPARATE_HUMAN_USEFULNESS_AND_HARM_REVIEW" : "REQUIRES_SEPARATE_HUMAN_USEFULNESS_AND_HARM_REVIEW"
      } : {})
    }
  };
}
