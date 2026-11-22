import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { renderFeedbackView } from "../scripts/feedback-inbox-view.js";

// A minimal document: elements keep text only; anything that would parse HTML throws.
function fakeDocument() {
  const make = (tag) => {
    const element = {
      tag,
      attributes: {},
      children: [],
      listeners: {},
      text: "",
      set textContent(value) { this.text = String(value); },
      get textContent() { return this.text + this.children.map((child) => child.textContent).join(""); },
      setAttribute(name, value) { this.attributes[name] = String(value); },
      appendChild(child) { this.children.push(child); return child; },
      addEventListener(type, handler) { this.listeners[type] = handler; }
    };
    for (const forbidden of ["innerHTML", "outerHTML"]) {
      Object.defineProperty(element, forbidden, { set() { throw new Error(`${forbidden} used`); }, get() { throw new Error(`${forbidden} used`); } });
    }
    element.insertAdjacentHTML = () => { throw new Error("insertAdjacentHTML used"); };
    return element;
  };
  return { createElement: make };
}

const walk = (element, out = []) => { out.push(element); element.children.forEach((child) => walk(child, out)); return out; };

test("the Inbox's Feedback view shows a sender's words as text only, with fixed choices", () => {
  const writes = [];
  const hostile = "<img src=x onerror=alert(1)> https://phish.example/login \u0000 synthetic";
  const section = renderFeedbackView({
    doc: fakeDocument(),
    items: [
      { id: "fb_AAAAAAAAAAAAAAAAAAAA", kind: "review", text: hostile, reply_address: "<b>mailto:x@example.invalid</b>", received_at: "2026-11-22T01:00:00Z", via: "page", public_review: true, published: false },
      { id: "fb_BBBBBBBBBBBBBBBBBBBB", kind: "bug", text: "It froze.", reply_address: null, received_at: "2026-11-22T02:00:00Z", via: "chat", public_review: false, published: false }
    ],
    choices: { "feedback-fb_BBBBBBBBBBBBBBBBBBBB": { choice: "delete", at: "2026-11-22T03:00:00Z" } },
    write: (...args) => writes.push(args)
  });
  const all = walk(section);
  assert.equal(all.some((element) => element.tag === "a"), false, "no links");
  assert.ok(all.some((element) => element.text === hostile), "the hostile text is kept as text, unchanged");
  assert.ok(all.some((element) => element.text === "Answer to: <b>mailto:x@example.invalid</b>"));
  const cards = section.children;
  assert.equal(cards.length, 2);
  assert.match(cards[0].children[0].text, /^Something isn't working · 2026-11-22 02:00 · from a chat/u, "newest first");
  assert.equal(cards[0].children.some((child) => child.text === "Deleted once the lane runs"), true);

  const buttons = all.filter((element) => element.tag === "button");
  assert.deepEqual(buttons.map((element) => element.text), ["Delete", "Show publicly", "Don't show", "Delete"]);
  buttons[1].listeners.click();
  assert.deepEqual(writes[0].slice(0, 2), ["choices/feedback-fb_AAAAAAAAAAAAAAAAAAAA", { choice: "publish" }]);
  assert.equal(all.some((element) => element.tag === "textarea" || element.tag === "input"), false, "nothing is typed on a feedback item");
});

test("the view's source never builds HTML from data", async () => {
  const source = await fs.readFile(new URL("../scripts/feedback-inbox-view.js", import.meta.url), "utf8");
  const code = source.split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
  for (const forbidden of ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "mailto:", "href"]) {
    assert.equal(code.includes(forbidden), false, forbidden);
  }
});
