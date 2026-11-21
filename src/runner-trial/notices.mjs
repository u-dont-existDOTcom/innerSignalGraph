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
