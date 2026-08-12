import { sharedHypnosisCompilerRules } from "./hypnosis-common.mjs";

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

AUTOPILOT FEEDBACK FROM PRIOR ATTEMPTS:
${context.autopilotFeedback ? JSON.stringify(context.autopilotFeedback, null, 2) : "(none)"}`;
  return { system, user };
}
