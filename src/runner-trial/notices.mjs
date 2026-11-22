// Fixed words the runner trial shows without a model writing them.

// The owner's 4a (question i62, 21 Nov 2026): when no checked reply can be made, "the page says InnerSignal can't answer right
// now". Stored as the closing of a turn that ends without a reply, so the record holds what the person saw.
export const RUNNER_UNAVAILABLE_NOTICE = "InnerSignal can't answer right now.";

// The line always on the trial page, in the words the owner saw in question i62 and answered on 21 Nov 2026 (the numbers his
// crisis rules name). In a crisis turn whose provisional reply can't be shown, or that ends without a reply, the page also puts
// these words into the conversation.
export const EMERGENCY_LINE = "In danger right now? Call your local emergency number: 112 in the EU (and from mobiles in many other countries), 911 in the US and Canada, 999 in the UK.";

// The owner's 3 (question i62): the heading of a reply shown before the full checked one, and the line shown while it is written.
export const PROVISIONAL_PREFIX = "Provisional urgent response: ";
export const THINKING_LINE = "Thinking more about the full response...";

// The plan kept for next time (the owner's 5b, question i62; design, section 9), behind INNER_SIGNAL_RUNNER_KEPT_PLAN, off until
// the owner has seen these words (/home/joel/askrigor-releases/20261121-innersignal-runner-note/kept-plan-rule-draft.md).
//
// The runner-only rule, in its exact words. It is shown to the owner before use, and it is given to the writer and the crisis
// checker (the whole checker in its arm) only when a kept plan is in their packet: after the person chose "Yes" to picking up where
// they left off, with a kept plan that isn't deleted or past its 30 days.
export const KEPT_PLAN_RULE = "A kept plan is a reason to ask one question about the message, never a sign of risk now, never a reason for numbers or safety questions.";
// The question a new conversation opens with whenever an earlier one exists, kept plan or not, so the question itself tells no one
// that a plan exists; and its two answers.
export const RESUME_QUESTION = "Pick up where we left off?";
export const RESUME_YES = "Yes";
export const RESUME_FRESH = "Start fresh";
// What the page says when the person deletes the kept plan with its button, before they confirm.
export const KEPT_PLAN_DELETE_NOTE = "This removes the kept plan. Its words are still in the stored conversation, which can't be edited; deleting them too means deleting the case.";
// What the page says, outside the reply, after a turn kept a plan, or after the kept plan was deleted (in the conversation or with
// the button). The writer can't know whether the program keeps the lines it returns, so the page says it.
export const KEPT_PLAN_KEPT_LINE = "Kept for next time: the lines of your plan and today's date, encrypted on this computer for 30 days.";
export const KEPT_PLAN_GONE_LINE = "No kept plan remains.";

// Why a turn closed without a reply. Fixed words, never case content; the page shows a plain-language reason beside the notice.
export const CLOSING_REASONS = Object.freeze({
  checks_failed: "No reply passed its checks.",
  plan_limit: "The model plan's limit is reached.",
  sign_in_needed: "A model sign-in needs renewing.",
  timeout: "It took too long.",
  refused: "A model declined to answer.",
  provider_failed: "A model call failed.",
  interrupted: "The app stopped before the reply was finished."
});

// The operational failures after which, in a conversation about wanting to die or getting safe, the owner's fixed message is shown
// in place of the notice while INNER_SIGNAL_RUNNER_FIXED_MESSAGE_ON_FAILURE and INNER_SIGNAL_OWNER_FALLBACK are both on (design,
// section 7): his answer 3b to question i67, part 3, 22 Nov 2026, "On, and also when the plan's limit, the sign-in or the time ends
// a turn in such a conversation". The time is one reason code: a call that ran past its limit and the turn's deadline both close
// as timeout. A refusal, a failed call and an interruption keep the notice: his words named only these three.
export const FIXED_MESSAGE_FAILURE_REASONS = Object.freeze(["plan_limit", "sign_in_needed", "timeout"]);
// Every reason a closing may show his fixed message for: failed checks (switched on by INNER_SIGNAL_OWNER_FALLBACK alone) and the
// three above. The store creates such a closing for any of them whatever the switches say now, and reads one back by shape, so a
// record written with a switch on stays readable after it is turned off.
export const OWNER_FALLBACK_CLOSING_REASONS = Object.freeze(["checks_failed", ...FIXED_MESSAGE_FAILURE_REASONS]);
