// OWNER-PENDING: this wording is a draft. The owner has not yet approved it, and it is not to be treated as approved copy.
// Change the text here, and nowhere else, when the owner gives final wording; every check below compares against this constant.
//
// It is delivered by code, not by a model, and only when a turn that went through the audit loop ends without any reply that can
// be sent: on the safety-orientation route when the candidate cannot be approved and no authorized question exists to send, and
// on the self-death inquiry route after the second failed repair, in place of the unaudited stored question. It is never produced
// from a state flag alone, and it never replaces an approved candidate.
//
// It is written only while INNER_SIGNAL_OWNER_FALLBACK is on (src/core/config.mjs; off by default, and /health reports the state).
// The sequence is: deploy with the setting off and verify, then switch it on, with the owner's yes, once the owner has approved the
// wording. Reading a saved fallback never depends on the setting: the validators and the store accept it either way, so turning
// the setting off later cannot make a case that already holds one unreadable.
export const OWNER_FALLBACK_MESSAGE = "I couldn’t finish a reply I’m confident in just now, so I’m not sending one. If you’re in danger right now, please reach someone who can be with you: a person you trust, or emergency services where you are. When you’re ready, you can write again here.";

// Recorded on the runtime turn's discriminator and delivery so this message never looks like an approved candidate or a question.
export const OWNER_FALLBACK_KIND = "owner_fallback";

// The routes (the planner's primary job for the turn) on which the fallback may replace the stored question.
export const OWNER_FALLBACK_SAFETY_ROUTE_ID = "IC.SAFETY_ORIENTATION";
export const OWNER_FALLBACK_SELF_DEATH_INQUIRY_ROUTE_ID = "IC.SUICIDAL_SELF_DEATH_INQUIRY";
