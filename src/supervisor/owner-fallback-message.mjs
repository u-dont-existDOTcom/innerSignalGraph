// Approved by the owner: question 54, answer A, 1 Nov 2026, 12:00 UTC.
// Change the text here, and nowhere else, when the owner gives new wording; every check compares against this constant.
//
// It is delivered by code, not by a model, and only when a turn that went through the audit loop ends without any reply that can
// be sent, on the four routes in OWNER_FALLBACK_ROUTE_IDS (owner question 55, answer A):
//   - IC.SUICIDAL_SELF_DEATH_INQUIRY, IC.SUICIDAL_ADULT_SEAT and IC.PRECIOUS_HUMAN_OPPORTUNITY, after the second failed repair, in
//     place of the unaudited stored question;
//   - IC.SAFETY_ORIENTATION, after the second failed repair, when no sendable stored question exists to send (before, nothing was
//     delivered);
//   - any of the four, when an unresolved role or belief finding would otherwise stop the turn as
//     PRIVATE_DISCRIMINATOR_ROLE_BELIEF_BLOCKED. This text cannot carry the error that block guards against, and delivering it ends
//     a turn that would otherwise stay unfinished. On every other route that block is unchanged.
// It is never produced from a state flag alone, and it never replaces an approved candidate.
//
// It is written only while INNER_SIGNAL_OWNER_FALLBACK is on (src/core/config.mjs; off by default, and /health reports the state).
// The sequence is: deploy with the setting off and verify, then switch it on, with the owner's yes. Reading a saved fallback never
// depends on the setting: the validators and the store accept it either way, so turning the setting off later cannot make a case
// that already holds one unreadable.
export const OWNER_FALLBACK_MESSAGE = "I couldn’t finish a reply I’m confident in just now, so I’m not sending one. If you’re in danger right now, please reach someone who can be with you: a person you trust, or emergency services where you are. When you’re ready, you can write again here.";

// Recorded on the runtime turn's discriminator and delivery so this message never looks like an approved candidate or a question.
export const OWNER_FALLBACK_KIND = "owner_fallback";

// The routes (the planner's primary job for the turn) on which the fallback may be delivered. This is the only list of them, so the
// set of routes is one edit. The safety-orientation route keeps its stored question when that question can be sent; on the other
// three the stored question is not sent after the second failed repair.
export const OWNER_FALLBACK_SAFETY_ROUTE_ID = "IC.SAFETY_ORIENTATION";
export const OWNER_FALLBACK_ROUTE_IDS = Object.freeze([
  OWNER_FALLBACK_SAFETY_ROUTE_ID,
  "IC.SUICIDAL_SELF_DEATH_INQUIRY",
  "IC.SUICIDAL_ADULT_SEAT",
  "IC.PRECIOUS_HUMAN_OPPORTUNITY"
]);
