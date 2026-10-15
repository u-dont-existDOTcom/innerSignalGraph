import { sharedHypnosisCompilerRules } from "./hypnosis-common.mjs";

// The owner's purpose principle for hypnosis during fresh grief (question 37, 15 Oct 2026;
// AMEND.IC.HYPNOSIS_GRIEF_ALTERED_20261015), the same sentence as the map's IC.GENTLE_SELF_HYPNOSIS nuance. There is
// no fixed line: the writer judges the purpose from the person's own words.
export const FRESH_GRIEF_HYPNOSIS_PURPOSE = "During grief, what matters most is the purpose: hypnosis to reach feelings someone can’t access, for example “my dad just died, but I can’t feel anything about it… can we do a little hypnosis so I can access my feelings better?”, can help; hypnosis to get away from or escape what they need to face is less beneficial.";

// Empty unless the case record says fresh grief is present, so every other prompt stays as it was. Every stage that
// writes the script gets it (the writer and the repairer); the reviewers don't, since a purpose check at release would
// be the fixed line the owner ruled out.
export function freshGriefWriterSection(record, { where = "in the request and the transcript" } = {}) {
  if (record?.status !== "present") return "";
  const since = typeof record.since_at === "string" && record.since_at ? `, recorded ${record.since_at}` : "";
  return `\n\nFRESH GRIEF (case record):\nPresent${since}. Hypnosis isn’t held back by grief itself. ${FRESH_GRIEF_HYPNOSIS_PURPOSE} Judge the purpose from the person’s own words ${where}, and write what is appropriate for them now.`;
}

export function hypnosisDraftPrompt(context, providerName) {
  const system = `You are the ${providerName} hypnosis writer.${sharedHypnosisCompilerRules}
Write a coherent structured draft for the exact request. Use rich, permissive hypnosis craft without filler. Command may be more direct only inside the already-authorized low-risk process; Communion must not imply a response began before choice.

Return exactly one JSON object with this shape:
{
  "contract_version": "hypnosis-components-v1",
  "language": "en",
  "relationship": "command|communion",
  "target": "exact target",
  "premise": "one governing premise",
  "orientation": "brief non-deepening pre-gate orientation",
  "continue_inward": {
    "induction": "...",
    "deepening": "...",
    "target_work": "...",
    "integration": "...",
    "return_lead": "..."
  },
  "stay_external": {
    "grounding": "...",
    "ordinary_choice": "..."
  },
  "aftercare": "one brief separate question or observation",
  "scope": {
    "memory": "no-memory-recovery",
    "identity": "ordinary-adult-identity",
    "post_session": "no-automatic-cues",
    "substances": "no-substance-guidance"
  },
  "design_notes": ["brief auditable notes"]
}`;

  const user = `GUIDE VERSION: ${context.guideManifest.version}

RELEVANT GUIDE EXCERPTS:
${context.guideExcerpts}

REQUEST CONTRACT:
${JSON.stringify(context.hypnosisRequest, null, 2)}

RECENT TRANSCRIPT:
${context.recentTranscript || "(none supplied)"}

CURRENT USER REQUEST:
${context.userMessage}

DURABLE PROTECTIVE COMPATIBILITY STATE:
${JSON.stringify(context.durableCaseState?.protective_compatibility ?? null, null, 2)}${freshGriefWriterSection(context.durableCaseState?.fresh_grief)}

AUTOPILOT FEEDBACK FROM PRIOR ATTEMPTS:
${context.autopilotFeedback ? JSON.stringify(context.autopilotFeedback, null, 2) : "(none)"}`;
  return { system, user };
}
