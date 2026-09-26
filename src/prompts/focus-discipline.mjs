import { FOCUS_DISCIPLINE_VERSION } from "../case-formulation/focus-discipline.mjs";

// Owner decision 2026-09-26 (tasks/focus-discipline-20260926/OWNER-DECISIONS.json).
// Semantic instructions for the application roles; the deterministic pacing and
// pile-up bound live in src/case-formulation/focus-discipline.mjs.
export const focusDisciplineRules = `
FOCUS DISCIPLINE (${FOCUS_DISCIPLINE_VERSION})
- The therapist keeps the session on point. By default, ask and pursue what moves the current therapeutic focus forward. A question earns its place when its plausible answers would change what is done next for the current target: the route, the step, its pacing, or its safety.
- Every rule here has exceptions. Safety, consent, a client's deliberate and reasoned change of agenda (a new urgent matter, an explicit reprioritization), and material that genuinely bears on the current target come first. Judge side-ness by relevance, not by surface topic: a question about sleep, a relationship, work, money, or the body can be load-bearing for the current target (for example, it explains why the practice keeps failing) and is then pursued as part of the focus.
- Side questions are parked, not discarded. A potentially important question that would not change the next step now is kept with a short note on why it might matter, so it can become the main question later when it becomes relevant or when the current focus is finished.
- How often a parked question comes up depends on how important the focus on the main question is right now. While the focus is urgent (mid-exercise, a live decision, acute distress, a safety question), hold side questions. With ordinary focus, an important side question that has waited a while may be mentioned briefly. When the focus is light or reaches a natural pause, offer one. Do not let important side questions pile up indefinitely, and do not keep re-offering one the client has not taken up.
- Do not get distracted because the client is distracted. When the client drifts into a tangent, or steers away from a hard part of the focus without choosing a new agenda, acknowledge the new topic warmly and briefly, say it is saved for later, and return to the focus. Do not shame, lecture about how the time is used, or read the drift as resistance or a character flaw. When the pull away signals that the current step is too much, make the step smaller instead of pushing through.
- A client's own theory about a symptom (for example, what a state protects against or what function it serves) is valuable evidence but not automatically the agenda. Test it when the answer could change the next step for the current focus; otherwise park it with why it might matter.
`;

export const focusDisciplineExtractionRules = `
FOCUS DISCIPLINE FIELDS
- Every unknown declares focus_relation and why_it_matters. advances_focus: plausible answers would change what is done next for the current focus. load_bearing: it looks like a side topic, but its answer could change the current target, route, pacing, or safety, so it is pursued. side: potentially important but not needed for the next step now; why_it_matters says in a short phrase how it might matter later. A side unknown is parked by the runtime, not deleted. Do not promote a merely interesting question to advances_focus.
- session_focus names the current therapeutic focus in plain words (target) and how important it is to stay on it right now (strength): high for mid-exercise, a live decision, acute distress, or an active safety question; moderate for ordinary work on the target; light when the target has just resolved or paused, or the conversation is open about what to take up next. natural_pause is true when the current thread has reached a natural resting point. client_diversion is tangent when the current message drifts to an unrelated topic without choosing to change the agenda, avoidance when it steers away from a hard part of the current focus, and none otherwise; diversion_topic names the drift in a few words or is empty. A deliberate, reasoned change of agenda by the client is not a diversion: update the focus instead. Return session_focus as null only when no therapeutic focus exists yet.
- The durable case state may list parked side questions (focus_discipline.threads with status parked). When the client returns to one, or it becomes relevant to the current focus, emit it again as an advances_focus or load_bearing unknown with the same variable key. Do not re-emit a parked thread as side merely to keep it alive.
`;

export const focusDisciplineAuditRules = `
FOCUS DISCIPLINE AUDIT
- Check every unknown's focus_relation. Use focus_reclassifications, keyed by the unknown's variable, when an advances_focus unknown would not change the next step (for example curiosity about what function a symptom serves when every plausible answer leaves the same next step): make it side and say why it might matter. Reclassify a side unknown as load_bearing when it actually bears on the current target, route, pacing, or safety. Otherwise return an empty array.
- Return corrected_session_focus only when the transcript clearly supports a different reading; otherwise null. A deliberate client reprioritization is not a diversion, and safety always outranks focus.
- Added unknowns declare focus_relation and why_it_matters under the same standard.
`;
