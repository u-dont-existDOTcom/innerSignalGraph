// What a feedback message may hold, shared by the page and the chat tool (design sections 5 and 12). Every check here is exact and
// structural (which kind, how long, which characters); none judges what the text means, in any language.

export const FEEDBACK_KINDS = Object.freeze(["suggestion", "bug", "praise", "review"]);
export const FEEDBACK_TEXT_MAX = 5_000;
export const FEEDBACK_ADDRESS_MAX = 200;

const codePoints = (value) => [...value].length;

// Control characters other than newline and tab are removed; line breaks become "\n"; the text is put in Unicode's composed form.
function cleanText(value, { singleLine }) {
  let text = value.normalize("NFC").replace(/\r\n?/gu, "\n").replace(/[\u2028\u2029]/gu, "\n");
  text = text.replace(singleLine ? /[\u0000-\u001F\u007F-\u009F]/gu : /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/gu, singleLine ? " " : "");
  return text.trim();
}

function refused(code, field) {
  return { ok: false, code, field };
}

// `input`: { kind, text, replyAddress, mayShowPublicly }. Returns { ok: true, value } or { ok: false, code, field }.
export function readFeedbackInput(input) {
  const kind = input?.kind;
  if (typeof kind !== "string" || !FEEDBACK_KINDS.includes(kind)) return refused("FEEDBACK_KIND_INVALID", "kind");
  if (typeof input.text !== "string") return refused("FEEDBACK_TEXT_INVALID", "text");
  const text = cleanText(input.text, { singleLine: false });
  if (!text || codePoints(text) > FEEDBACK_TEXT_MAX) return refused("FEEDBACK_TEXT_INVALID", "text");
  let replyAddress = null;
  if (input.replyAddress != null) {
    if (typeof input.replyAddress !== "string") return refused("FEEDBACK_ADDRESS_INVALID", "replyAddress");
    const cleaned = cleanText(input.replyAddress, { singleLine: true });
    if (codePoints(cleaned) > FEEDBACK_ADDRESS_MAX) return refused("FEEDBACK_ADDRESS_INVALID", "replyAddress");
    replyAddress = cleaned || null;
  }
  const mayShowPublicly = input.mayShowPublicly === true;
  if (input.mayShowPublicly != null && typeof input.mayShowPublicly !== "boolean") return refused("FEEDBACK_PUBLIC_ONLY_FOR_REVIEWS", "mayShowPublicly");
  if (mayShowPublicly && kind !== "review") return refused("FEEDBACK_PUBLIC_ONLY_FOR_REVIEWS", "mayShowPublicly");
  return { ok: true, value: Object.freeze({ kind, text, replyAddress, mayShowPublicly }) };
}
