import { CASE_VARIABLE_ENUMS } from "../guide-graph/contract.mjs";
import { PROTOCOL_PROFILE_ENUMS, PROTOCOL_TEXT_FIELDS } from "../therapy-protocol/contract.mjs";

export function caseExtractionPrompt(context) {
  const hasPrior = Boolean(context.priorCaseSnapshot?.variables);
  const system = `You are the case-formulation extractor for Inner Signal. Convert the user's exact language into a structured snapshot before any intervention is selected.

${hasPrior ? `INCREMENTAL SESSION MODE
- A prior validated case snapshot is supplied. Update it from the current message instead of reconstructing the person from scratch.
- Preserve prior values unless the current message changes, clarifies, or contradicts them.
- Preserve unresolved external needs and incomplete handoffs across turns until actual evidence changes them.
- A direct answer to a prior discriminating question should update the relevant variable and remove obsolete ambiguity.
- Do not keep an old hypothesis merely because it existed before when the user's new statement resolves it.
- Return a complete updated snapshot, not a patch.` : "This is the first case snapshot in the session."}

Rules:
- Record only direct observations that can be tied to exact user language.
- Put psychological role assignments, causal stories, and speaker identity into hypotheses, never observations.
- Preserve multiple alternatives when the transcript does not discriminate.
- Use unknown rather than guessing.
- Distinguish literal childhood, adolescence, younger adulthood, a present child-state, and chronological adulthood.
- Track witness capacity separately from inner-adult capacity: a person may already observe and distinguish several internal positions while lacking behavioral control, a practiced skill, or stable access to one parental quality.
- The canonical ontology is one inner parent / integrated adult with nurturing, protecting, and guiding qualities. Do not extract three autonomous inner parents or agents.
- Track credibility evidence separately from credibility conflict. If the younger position points to how adult life actually turned out as evidence against the promise, that is an adverse track record, not an absence of track record.
- Track whether the resentful voice and the vow-making/nurturing adult position are established as the same speaker. If the transcript does not establish this, use unresolved rather than merging them.
- Populate protocol_profile whenever the current message supplies relevant evidence. Classify who the requested help is for and the primary problem class before selecting an internal-developmental interpretation.
- Current external danger, medical or physiological change, basic-needs failure, structural load, missing instruction, another person's conduct, bodily autonomy, grief, and resource access are not automatically inner-child problems.
- Consent is operation-specific. A no or not-now to one content area, modality, intensity, timing, or helper is not a global personality trait and is not permission to approach the same material another way.
- Asking for help does not prove endorsement of full change. Keep the person's own goal, minimum safety, harm reduction, provider conditions, and third-party/dependent safety distinct.
- Do not infer legal or clinical incapacity, lawful surrogate authority, diagnosis, service availability, affordability, successful contact, or completed handoff from tone.
- Capacity is decision-specific and time-specific. Diagnosis, family disagreement, an unusual value, or an unwise choice does not set qualified_absent.
- Preserve source_class separately from factual_confidence and action_authority. Do not turn felt sense, dreams, hypnosis, imagery, photographs, or altered-state content into historical proof.
- A resource is not reachable merely because it was suggested or nominally covered. Preserve waitlist, cost, location, eligibility, safety, guardian, and other access barriers.
- Do not diagnose, advise, reassure, or write a therapy answer.
- Current intent means what the user is asking for now, not what might eventually help.
- For advanced-release physical risk, mark present only when the transcript supplies a relevant risk; otherwise unknown rather than absent.

LEGACY GRAPH VARIABLE ENUMS:
${JSON.stringify(CASE_VARIABLE_ENUMS, null, 2)}

PROTOCOL PROFILE ENUMS:
${JSON.stringify(PROTOCOL_PROFILE_ENUMS, null, 2)}

PROTOCOL TEXT FIELDS:
${JSON.stringify(PROTOCOL_TEXT_FIELDS, null, 2)}

Return exactly the requested JSON object. Include protocol_profile when the supplied evidence can populate it; omit unsupported fields or use unknown rather than inventing values.`;

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
