// The Feedback view of the owner's InnerSignal Inbox (design section 7). The InnerSignal lane copies `renderFeedbackView` into the
// Inbox page (owner-pages innersignal/inbox/index.html) and calls it with the page's own helpers; tests/feedback-inbox-view.test.mjs
// checks it here.
//
// Rules it keeps, because a sender's words are anonymous input shown inside the owner's own page:
// - every word of a message, its address and its kind is set as text (textContent), never as HTML, so markup in a message can't run;
// - links in a message are not made clickable, and the reply address is plain text, never a mailto: link;
// - the only controls are fixed choices written to choices/feedback-<id>: "publish" (only for a review its sender let be shown),
//   "hide", and "delete". Nothing is typed on a feedback item, so no feedback words reach the replies or comments collections that
//   the Inbox sync mirrors to Git.

const KIND_LABELS = { suggestion: "Suggestion", bug: "Something isn't working", praise: "Praise", review: "Review" };
const CHOICE_LABELS = { publish: "Shown publicly once the lane runs", hide: "Not shown", delete: "Deleted once the lane runs" };
// The danger reader's flag (the owner's 5b): flagged messages come first, then those it couldn't check, then the rest.
const DANGER_LINES = {
  flagged: "An AI check says the writer, or someone they mention, may be in danger: read this first.",
  refused: "The AI check declined to read this one, which can mean it describes something serious: read this first.",
  not_checked: "Not checked for danger (the check was off or failed)."
};
const DANGER_ORDER = { flagged: 0, refused: 0, not_checked: 1 };

// doc: the page's document. items: the `feedback` collection's documents ({id, kind, text, reply_address, received_at, via,
// public_review, published}). choices: the `choices` collection as {docId: data}. write(path, data, button, okText): the page's own
// database write.
function renderFeedbackView({ doc, items, choices, write }) {
  const node = (tag, cls, text) => {
    const element = doc.createElement(tag);
    if (cls) element.setAttribute("class", cls);
    if (text !== undefined) element.textContent = String(text);
    return element;
  };
  const section = node("section", "feedback-view");
  const rank = (item) => DANGER_ORDER[item.danger] ?? 2;
  const sorted = [...items].filter((item) => item && typeof item.id === "string")
    .sort((a, b) => rank(a) - rank(b) || String(b.received_at ?? "").localeCompare(String(a.received_at ?? "")));
  if (sorted.length === 0) {
    section.appendChild(node("p", "empty", "No feedback yet."));
    return section;
  }
  for (const item of sorted) {
    const card = node("article", "card feedback");
    const choice = choices?.[`feedback-${item.id}`]?.choice ?? null;
    const header = [
      KIND_LABELS[item.kind] ?? "Feedback",
      String(item.received_at ?? "").slice(0, 16).replace("T", " "),
      item.via === "chat" ? "from a chat (written up by the AI, approved by the sender)" : "from the page",
      ...(item.public_review ? ["the sender lets it be shown publicly"] : []),
      ...(item.published ? ["shown publicly now"] : [])
    ].join(" · ");
    card.appendChild(node("p", "meta", header));
    if (DANGER_LINES[item.danger]) card.appendChild(node("p", item.danger === "not_checked" ? "unchecked" : "danger", DANGER_LINES[item.danger]));
    if (item.reply_address) card.appendChild(node("p", "address", `Answer to: ${item.reply_address}`));
    card.appendChild(node("p", "feedback-text", item.text ?? ""));
    if (choice) card.appendChild(node("p", "status", CHOICE_LABELS[choice] ?? ""));
    const actions = node("div", "actions");
    const button = (label, value) => {
      const element = node("button", "secondary", label);
      element.setAttribute("type", "button");
      element.addEventListener("click", () => write(`choices/feedback-${item.id}`, { choice: value }, element, CHOICE_LABELS[value]));
      actions.appendChild(element);
    };
    if (item.public_review && !item.published) {
      button("Show publicly", "publish");
      button("Don't show", "hide");
    }
    button("Delete", "delete");
    card.appendChild(actions);
    section.appendChild(card);
  }
  return section;
}

export { renderFeedbackView };
