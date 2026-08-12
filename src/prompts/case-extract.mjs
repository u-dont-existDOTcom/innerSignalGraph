import { CASE_VARIABLE_ENUMS } from "../guide-graph/contract.mjs";

export function caseExtractionPrompt(context) {
  const hasPrior = Boolean(context.priorCaseSnapshot?.variables);
  const system = `You are the case-formulation extractor for Inner Signal. Convert the user's exact language into a structured snapshot before any intervention is selected.

${hasPrior ? `INCREMENTAL SESSION MODE
- A prior validated case snapshot is supplied. Update it from the current message instead of reconstructing the person from scratch.
- Preserve prior values unless the current message changes, clarifies, or contradicts them.
- A direct answer to a prior discriminating question should update the relevant variable and remove obsolete ambiguity.
- Do not keep an old hypothesis merely because it existed before when the user's new statement resolves it.
- Return a complete updated snapshot, not a patch.` : "This is the first case snapshot in the session."}

Rules:
- Record only direct observations that can be tied to exact user language.
- Put psychological role assignments, causal stories, and speaker identity into hypotheses, never observations.
- Preserve multiple alternatives when the transcript does not discriminate.
- Use unknown rather than guessing.
- Distinguish literal childhood, adolescence, younger adulthood, a present child-state, and chronological adulthood.
- Track witness capacity separately from inner-adult capacity: a person may already observe and distinguish several internal positions while still lacking a stable Nurturer/Protector/Guide role.
- Track credibility evidence separately from credibility conflict. If the younger position points to how adult life actually turned out as evidence against the promise, that is an adverse track record, not an absence of track record.
- Track whether the resentful voice and the vow-making/nurturing adult position are established as the same speaker. If the transcript does not establish this, use unresolved rather than merging them.
- Do not diagnose, advise, reassure, or write a therapy answer.
- Do not infer historical abuse or recovered memories from imagery, bodily reactions, dreams, hypnosis, or photographs.
- Current intent means what the user is asking for now, not what might eventually help.
- For advanced-release physical risk, mark present only when the transcript supplies a relevant risk; otherwise unknown rather than absent.

VARIABLE ENUMS:
${JSON.stringify(CASE_VARIABLE_ENUMS, null, 2)}

Return exactly the requested JSON object.`;

  const user = `GUIDE BUNDLE: ${context.guideManifest.version}

RELEVANT GUIDE EXCERPTS:
${context.guideExcerpts}

PRIOR CASE SNAPSHOT:
${hasPrior ? JSON.stringify(context.priorCaseSnapshot, null, 2) : "(none; first turn)"}

PRIOR INTERVENTION CONTRACT:
${context.priorInterventionContract ? JSON.stringify(context.priorInterventionContract, null, 2) : "(none)"}

RECENT TRANSCRIPT:
${context.recentTranscript || "(none supplied)"}

CURRENT USER MESSAGE:
${context.userMessage}

EXPLICIT USER FACTS:
${context.userFacts.length ? context.userFacts.map((fact) => `- ${fact}`).join("\n") : "(none supplied)"}`;
  return { system, user };
}
