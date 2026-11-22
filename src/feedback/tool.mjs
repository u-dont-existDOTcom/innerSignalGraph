import { FeedbackStoreError } from "./store.mjs";
import { FEEDBACK_ADDRESS_MAX, FEEDBACK_KINDS, FEEDBACK_TEXT_MAX } from "./validate.mjs";

// The chat tool, send_feedback (design section 12). Off unless INNER_SIGNAL_FEEDBACK_TOOL is on; while it is off the connector's
// tool list, instructions and health answer are byte-identical to before. No sign-in: a bearer token sent with a call is ignored
// and nothing about any account is kept. The server can't see the chat, so it can't check the person's yes; what it guarantees is
// that the person gets back exactly what was stored, with a code, and that the message waits an hour before the owner can see it.

export const SEND_FEEDBACK_TOOL = "send_feedback";

// The rules stand alone here: with the rules in parts (pull request 232) the section holding the served sentence may arrive later
// in a chat than this tool.
export function sendFeedbackDefinition({ publicUrl }) {
  return Object.freeze({
    name: SEND_FEEDBACK_TOOL,
    title: "Send feedback to InnerSignal's maker",
    description: [
      "Send the person's feedback about InnerSignal (a suggestion, a problem, praise or a review) privately to InnerSignal's maker: it's sealed so that only he can open it, an AI checks each message only for signs that someone may be in danger so that he reads those first, and he reads it in his private inbox, a page in his Claude account.",
      "Call it only after you have shown the person, in the chat, the exact text you will send, its kind and any reply address, and they have said yes to exactly that; send that text unchanged.",
      "Write it from what they told you and leave out private details of their life or therapy unless they ask to include them.",
      "Before they agree, tell them what is kept: the text, its kind, the time and the reply address if they give one, nothing else.",
      "Afterwards show them what the result says was stored, and the deletion code: for the first hour it deletes the message before he can see it, and at any time after.",
      `A review that may be shown publicly can't be sent from a chat: the person writes it on the feedback page (${publicUrl}) in their own words.`,
      "In a conversation where someone has said they want to die or might act, don't offer this tool and don't send anything about that through it, and never present it as reaching a person: it is read by one person, not quickly, and it can't send help. Your crisis reply says who they can reach."
    ].join(" "),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "text", "person_approved_exact_text"],
      properties: {
        kind: { type: "string", enum: [...FEEDBACK_KINDS], description: "suggestion, bug (something isn't working), praise or review." },
        text: { type: "string", minLength: 1, maxLength: FEEDBACK_TEXT_MAX, description: "Exactly the text the person said yes to." },
        reply_address: { type: "string", maxLength: FEEDBACK_ADDRESS_MAX, description: "Only if the person gave one for an answer: an email address or another way to reach them." },
        person_approved_exact_text: { type: "boolean", const: true, description: "True only when the person has seen this exact text in the chat and said yes to sending it." }
      }
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  });
}

function refusals(publicUrl) {
  return Object.freeze({
    FEEDBACK_NOT_APPROVED: "Not sent. Show the person the exact text, its kind and any reply address; send it only after they say yes to that text.",
    FEEDBACK_TEXT_INVALID: `Not sent. The text must have 1 to ${FEEDBACK_TEXT_MAX} characters.`,
    FEEDBACK_KIND_INVALID: "Not sent. The kind must be suggestion, bug, praise or review.",
    FEEDBACK_ADDRESS_INVALID: `Not sent. A reply address can have at most ${FEEDBACK_ADDRESS_MAX} characters, on one line.`,
    FEEDBACK_PUBLIC_ONLY_ON_PAGE: `Not sent. A review that may be shown publicly is written by the person on the feedback page (${publicUrl}) in their own words; from a chat, a review can be sent only privately.`,
    FEEDBACK_INPUT_INVALID: "Not sent. Use only kind, text, reply_address and person_approved_exact_text.",
    FEEDBACK_BUSY: `Not sent: many messages were sent just now. Tell the person to try again in a few minutes, or to use the feedback page (${publicUrl}).`,
    FEEDBACK_FULL: "Not sent: the feedback box is full right now. Tell the person to try again in a few days.",
    FEEDBACK_UNAVAILABLE: "Not sent: the feedback box isn't working right now. Tell the person to try again later."
  });
}

const KIND_WORDS = Object.freeze({ suggestion: "suggestion", bug: "something isn't working", praise: "praise", review: "review (private)" });

// `service` is the feedback service (createFeedbackService); `publicUrl` is the page's address.
export function createSendFeedbackTool({ service, publicUrl }) {
  if (!service || typeof service.sendFromChat !== "function") throw new TypeError("createSendFeedbackTool needs the feedback service.");
  const definition = sendFeedbackDefinition({ publicUrl });
  const deletePage = `${publicUrl.replace(/\/$/u, "")}/delete`;
  const words = refusals(publicUrl);
  const refusal = (code) => ({ toolError: { code, message: words[code] ?? words.FEEDBACK_UNAVAILABLE } });
  const allowed = new Set(["kind", "text", "reply_address", "person_approved_exact_text"]);
  return Object.freeze({
    definitions: Object.freeze([definition]),
    names: new Set([SEND_FEEDBACK_TOOL]),
    instructions: "send_feedback is the one InnerSignal tool that sends something: call it only after the person has said yes to the exact text, as its description says.",
    async call(name, args, { req }) {
      if (name !== SEND_FEEDBACK_TOOL) return refusal("FEEDBACK_UNAVAILABLE");
      if (!args || typeof args !== "object" || Array.isArray(args)) return refusal("FEEDBACK_INPUT_INVALID");
      if (Object.hasOwn(args, "may_show_publicly")) return refusal("FEEDBACK_PUBLIC_ONLY_ON_PAGE");
      if (Object.keys(args).some((key) => !allowed.has(key))) return refusal("FEEDBACK_INPUT_INVALID");
      if (args.person_approved_exact_text !== true) return refusal("FEEDBACK_NOT_APPROVED");
      try {
        const sent = await service.sendFromChat({ kind: args.kind, text: args.text, replyAddress: args.reply_address ?? null, mayShowPublicly: false }, req);
        const stored = sent.stored;
        return {
          value: {
            sent: true,
            stored: { kind: stored.kind, text: stored.text, reply_address: stored.replyAddress },
            deletion_code: sent.code,
            delete_page: deletePage,
            reaches_maker_after: sent.heldUntil,
            kept: "the text, its kind, the time it was sent and the reply address if one was given"
          },
          text: [
            "Sent. Show the person exactly what was stored:",
            `Kind: ${KIND_WORDS[stored.kind]}.`,
            `Reply address: ${stored.replyAddress ?? "none"}.`,
            `Text: """${stored.text}"""`,
            `Deletion code: ${sent.code}. It deletes the message at ${deletePage}; it can't be shown again, so give it to the person now.`,
            "It reaches InnerSignal's maker after about an hour. If it isn't what they agreed to send, this code deletes it before he can see it, and at any time after.",
            "Only he reads it, in his private inbox. Their chat keeps its own copy of what they wrote here."
          ].join("\n")
        };
      } catch (error) {
        return refusal(error instanceof FeedbackStoreError ? error.code : "FEEDBACK_UNAVAILABLE");
      }
    }
  });
}
