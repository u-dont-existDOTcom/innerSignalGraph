import { createHash } from "node:crypto";
import { FEEDBACK_ADDRESS_MAX, FEEDBACK_TEXT_MAX } from "./validate.mjs";

// The feedback pages (design sections 9 to 11): plain HTML, no JavaScript, one inline stylesheet allowed by its hash, the crisis
// lines on every page. Every value shown back is escaped. The words are the ones the owner sees in the release question; change
// them only with his yes.

// The owner's approved line (question i62), the same words the runner trial shows (src/runner-trial/notices.mjs on its branch).
export const EMERGENCY_LINE = "In danger right now? Call your local emergency number: 112 in the EU (and from mobiles in many other countries), 911 in the US and Canada, 999 in the UK.";
// New lines, for the owner's yes with the release question: the link is the one his crisis rules give for crisis lines.
export const HELPLINE_LINE = "Not in danger this minute, but thinking of ending your life? https://findahelpline.com lists crisis lines by country.";
const HELPLINE_URL = "https://findahelpline.com";
export const NOT_HELP_LINE = "This box is read by one person, not every day, and it can't send help.";

export const KIND_LABELS = Object.freeze({
  suggestion: "Suggestion",
  bug: "Something isn't working",
  praise: "Praise",
  review: "Review"
});

export const PRIVACY_SECTIONS = Object.freeze([
  ["What's kept:", "your message, what kind it is, whether a review may be shown, the time you sent it and, if you give one, your address for an answer. Nothing else: no account, no name unless you write one, no IP address."],
  ["Who reads it:", "only the person who makes InnerSignal. It's sealed on InnerSignal's server so that only he can open it, and he reads it in his private inbox, a page in his Claude account that Anthropic hosts. No one else is given it. Nothing from it goes into InnerSignal's rules or into anyone's case unless he decides so."],
  ["Deleting:", "after sending you get a code. It deletes your message from the server at once, and from his inbox the next time he opens it. Messages are deleted after a year anyway; a review he shows publicly stays until you or he removes it."]
]);

const STYLE = [
  "body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;line-height:1.5;margin:0;background:#fbfaf7;color:#1d1d1b}",
  "main{max-width:40rem;margin:0 auto;padding:1.5rem 1rem 3rem}",
  "h1{font-size:1.6rem;margin:0 0 .75rem}",
  ".danger{border-left:4px solid #b3261e;background:#fdecea;padding:.75rem 1rem;margin:1rem 0}",
  ".danger p{margin:.25rem 0}",
  ".note{color:#4a4a46;font-size:.95rem}",
  ".error{border-left:4px solid #b3261e;padding:.5rem 1rem;margin:1rem 0;background:#fff}",
  "fieldset{border:1px solid #c9c6bd;padding:.75rem 1rem;margin:1rem 0}",
  "label{display:block;margin:.25rem 0}",
  "textarea,input[type=text]{width:100%;box-sizing:border-box;font:inherit;padding:.5rem;border:1px solid #8d8a82;border-radius:4px;background:#fff;color:inherit}",
  "textarea{min-height:10rem}",
  "button{font:inherit;padding:.6rem 1.2rem;border:0;border-radius:4px;background:#1f5f8b;color:#fff;cursor:pointer}",
  ".code{font-family:ui-monospace,monospace;font-size:1.4rem;letter-spacing:.05em;background:#fff;border:1px solid #c9c6bd;padding:.25rem .5rem}",
  ".trap{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}",
  "blockquote{margin:1rem 0;padding:.5rem 1rem;border-left:4px solid #c9c6bd;background:#fff;white-space:pre-wrap}",
  "@media (prefers-color-scheme:dark){body{background:#1b1b1a;color:#ecebe6}.note{color:#bdbab2}.danger{background:#3a1715}textarea,input[type=text],.code,blockquote,.error{background:#262624;color:#ecebe6}}"
].join("");
export const STYLE_HASH = `sha256-${createHash("sha256").update(STYLE, "utf8").digest("base64")}`;

export function pageHeaders(extra = {}) {
  return {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": `default-src 'none'; style-src '${STYLE_HASH}'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "x-robots-tag": "noindex, nofollow",
    ...extra
  };
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function layout(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
${body}
${crisisLines()}
</main>
</body>
</html>
`;
}

// On every page, below its own content (and on the form, also above it).
export function crisisLines() {
  const helpline = escapeHtml(HELPLINE_LINE).replace(HELPLINE_URL, `<a href="${HELPLINE_URL}">${HELPLINE_URL}</a>`);
  return `<div class="danger" role="note"><p><strong>In danger right now?</strong> ${escapeHtml(EMERGENCY_LINE.replace(/^In danger right now\? /u, ""))}</p><p>${helpline}</p><p>${escapeHtml(NOT_HELP_LINE)}</p></div>`;
}

const ERROR_TEXT = Object.freeze({
  FEEDBACK_TEXT_INVALID: `Please write your message (at most ${FEEDBACK_TEXT_MAX.toLocaleString("en")} characters).`,
  FEEDBACK_KIND_INVALID: "Please choose what it is: a suggestion, something that isn't working, praise or a review.",
  FEEDBACK_ADDRESS_INVALID: `The address for an answer can be at most ${FEEDBACK_ADDRESS_MAX} characters.`,
  FEEDBACK_PUBLIC_ONLY_FOR_REVIEWS: "Only a review can be shown publicly: choose Review, or untick the box.",
  FEEDBACK_FORM_EXPIRED: "This form was open for a long time, or the server restarted. Nothing was sent: please press Send again.",
  FEEDBACK_SEND_AGAIN: "Nothing was sent yet: please press Send once more.",
  FEEDBACK_BUSY: "Many messages were sent just now, so the box is busy. Nothing was sent: please try again in a few minutes.",
  FEEDBACK_FULL: "The feedback box is full right now. Nothing was sent: please try again in a few days.",
  FEEDBACK_UNAVAILABLE: "The feedback box isn't working right now. Nothing was sent: please try again later."
});

export function errorText(code) {
  return ERROR_TEXT[code] ?? ERROR_TEXT.FEEDBACK_UNAVAILABLE;
}

// The form. `values` echoes what the person wrote when the form comes back with a message; `token` is the form token.
export function renderFormPage({ token, values = {}, error = null, basePath = "/feedback" }) {
  const kind = values.kind ?? "";
  const radio = (value) => `<label><input type="radio" name="kind" value="${value}"${kind === value ? " checked" : ""} required> ${escapeHtml(KIND_LABELS[value])}</label>`;
  return layout("Send InnerSignal feedback", `<h1>Send InnerSignal feedback</h1>
<p>A suggestion, something that isn't working, praise or a review: write it here. No account needed.</p>
${crisisLines()}
${error ? `<p class="error" role="alert">${escapeHtml(errorText(error))}</p>` : ""}
<form method="post" action="${escapeHtml(basePath)}">
<input type="hidden" name="form_token" value="${escapeHtml(token)}">
<fieldset>
<legend>What is it?</legend>
${["suggestion", "bug", "praise", "review"].map(radio).join("\n")}
</fieldset>
<label for="text">Your message</label>
<textarea id="text" name="text" maxlength="${FEEDBACK_TEXT_MAX}" required>${escapeHtml(values.text ?? "")}</textarea>
<label for="reply_address">How can he answer you? (optional: an email address or another way to reach you)</label>
<input type="text" id="reply_address" name="reply_address" maxlength="${FEEDBACK_ADDRESS_MAX}" value="${escapeHtml(values.replyAddress ?? "")}">
<label><input type="checkbox" name="may_show_publicly" value="yes"${values.mayShowPublicly ? " checked" : ""}> You may show this review publicly (reviews only: shown exactly as you wrote it, without your address, only if he agrees; it stays until you or he removes it)</label>
<div class="trap" aria-hidden="true"><label for="extra">Leave this empty</label><input type="text" id="extra" name="extra" value="" tabindex="-1" autocomplete="off"></div>
<p><button type="submit">Send</button></p>
</form>
${PRIVACY_SECTIONS.map(([heading, text]) => `<p class="note"><strong>${escapeHtml(heading)}</strong> ${escapeHtml(text)}</p>`).join("\n")}
<p class="note"><a href="${escapeHtml(basePath)}/delete">Delete a message you sent</a> · <a href="${escapeHtml(basePath)}/reviews">Reviews</a></p>`);
}

export function renderThanksPage({ code, basePath = "/feedback" }) {
  return layout("Feedback sent", `<h1>Thank you, it's sent.</h1>
<p>Your deletion code: <span class="code">${escapeHtml(code)}</span></p>
<p>Keep it if you might want this message deleted: enter it on the <a href="${escapeHtml(basePath)}/delete">deletion page</a>. It can't be shown again. If he has already answered you, that answer stays in both your mailboxes.</p>`);
}

export function renderAlreadySentPage({ basePath = "/feedback" }) {
  return layout("Feedback sent", `<h1>This message was already sent.</h1>
<p>It wasn't sent twice. Its deletion code was shown when it was sent. If you didn't keep it and want the message deleted, <a href="${escapeHtml(basePath)}">send a new message</a> asking for that, saying roughly when you sent it and what it was about.</p>`);
}

export function renderDeletePage({ result = null, basePath = "/feedback" }) {
  const outcome = result === "deleted"
    ? "<p role=\"status\"><strong>Deleted.</strong> It's gone from InnerSignal's server, and goes from his inbox the next time he opens it.</p>"
    : result === "unknown"
      ? "<p class=\"error\" role=\"alert\">No message has that code. Check it, or it was already deleted.</p>"
      : result === "invalid"
        ? "<p class=\"error\" role=\"alert\">That isn't a deletion code: it has 16 letters and digits, like 7Q2M-K9TC-XR4H-PN0A.</p>"
        : result === "busy"
          ? `<p class="error" role="alert">${escapeHtml("Too many tries just now. Nothing was deleted: please try again in an hour.")}</p>`
          : "";
  return layout("Delete a message", `<h1>Delete a message you sent</h1>
${outcome}
<form method="post" action="${escapeHtml(basePath)}/delete">
<label for="code">Your deletion code</label>
<input type="text" id="code" name="code" maxlength="64" autocomplete="off" required>
<p><button type="submit">Delete</button></p>
</form>
<p class="note">Lost the code? <a href="${escapeHtml(basePath)}">Send a new message</a> asking for the deletion, saying roughly when you sent it and what it was about.</p>`);
}

export function renderReviewsPage({ reviews, basePath = "/feedback" }) {
  const list = reviews.length
    ? reviews.map((review) => `<blockquote>${escapeHtml(review.text)}<br><span class="note">${escapeHtml(review.month)}</span></blockquote>`).join("\n")
    : "<p>No reviews are shown yet.</p>";
  return layout("InnerSignal reviews", `<h1>InnerSignal reviews</h1>
<p class="note">Each is shown exactly as its sender wrote it on the feedback page, with their agreement and his.</p>
${list}
<p class="note"><a href="${escapeHtml(basePath)}">Send feedback</a></p>`);
}

// While the page is off but the served rules name its address (design section 10): no form, no store, only this.
export function renderClosedPage() {
  return layout("Feedback is closed for now", `<h1>Feedback is closed for now</h1>
<p>Please try again later.</p>`);
}

export function renderNotFoundPage({ basePath = "/feedback" }) {
  return layout("Not found", `<h1>Not found</h1><p><a href="${escapeHtml(basePath)}">Send feedback</a></p>`);
}
