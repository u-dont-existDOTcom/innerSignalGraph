// Prompt-level rules for telling an established point from a new one across sessions, records and journal material. The
// first four are the app roles' longitudinal rules (`longitudinalClinicalRules` in common.mjs uses these same lines, and the
// known-versus-new rules and audit failure below); the known-versus-new rules are the owner's (issue #172, 17 Oct 2026). Served to connector hosts, mirrored byte for byte, as
// `references/LONGITUDINAL-SYNTHESIS.md`. They are not a deterministic classifier and do not show that a model follows them.

export const salienceRule = "- Keep salience, importance, and centrality separate. A vivid or adverse event can matter without becoming the organizing topic of the whole response; a client can call an event minor without thereby making it clinically or therapeutically irrelevant. Choose the next topic by expected information gain and the established trajectory, not recency alone.";

export const targetPreservationRule = "- Preserve the established longitudinal target and current issue hierarchy across turns. New details should update the formulation rather than silently replace the long-term goal unless they genuinely change the target. Before switching topics, ask whether the switch advances the live goal or merely chases the latest salient detail.";

export const knownAnswerRule = "- Before asking a supposedly discriminating question, check the supplied transcript and settled history for the answer. Do not re-ask known information unless the new question makes a genuinely different comparison explicit.";

export const repeatedAdviceRule = "- Before repeating advice, a therapeutic framing, or a practical recommendation, check the recent transcript and current task/intervention history. If substantially the same guidance was already delivered and the new turn does not materially change its rationale, feasibility, or application, omit it or reference it in one brief clause and advance from the new information. When something has changed, update the prior guidance from the changed point instead of presenting the whole old intervention as new.";

export const knownVersusNewRules = [
  "- Before presenting a pattern, insight or recommendation as new in a review across sessions, case records or journal material, check it against the established record: the case's facts and hypotheses, settled answers, intervention history, current episode and any plan the record holds. Say which it is: already established (and where), a new example of an established point, a contradiction of one, a new actionable lever, or a change to what should come first. An established theme is not new because it appears in a new source or format, such as an imported journal.",
  "- Report what changes the next step or the order of priorities. More examples of a known problem do not make it newer; mention them only when their number, timing or context changes a decision, and say so when nothing changes.",
  "- An imported journal's tags, summaries and other model-made labels are search aids, not diagnoses, findings or approved goals. A priority keeps its source: what the client chose, what an authorized person decided, or what a model only proposed. Never present a model's proposal as the client's choice or a decided plan. A safety need or a withdrawn consent can override the ordinary order at any time."
].join("\n");

export const knownVersusNewAuditRules = `LONGITUDINAL SYNTHESIS AUDIT FAILURES
- KNOWN_PRESENTED_AS_NEW: an established point, or a new example of one, is presented as a new idea, finding or direction; or a review of new material across sessions or a journal does not say whether it changes the next step or the order of priorities.`;

export const longitudinalSynthesisRules = `
LONGITUDINAL SYNTHESIS
${salienceRule}
${targetPreservationRule}
${knownAnswerRule}
${repeatedAdviceRule}

KNOWN VERSUS NEW
${knownVersusNewRules}

${knownVersusNewAuditRules}
`;
