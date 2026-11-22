import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { loadTherapyProtocol } from "../src/protocol/therapy-protocol.mjs";
import { FEEDBACK_PAGE_URL, feedbackAddressInRules } from "../src/feedback/address.mjs";

// The served sentence for the feedback place (design section 12). It lives on its own branch and goes into main only with the
// release that turns the page on, so the served rules never point to a page that isn't there.
const SKILL = new URL("../plugins/inner-signal-therapy/skills/inner-signal-therapy/SKILL.md", import.meta.url);

test("the served rules name the feedback page's one address, after the guide-comment sentence, which is unchanged", async () => {
  const skill = await fs.readFile(SKILL, "utf8");
  const comment = "they can leave a comment on the owner's guide (https://innerchild.u-dont-exist.com, or the guide the question is about), and he answers there.";
  const sentence = `To send InnerSignal a suggestion, a problem, praise or a review privately, without an account, there is its feedback page (${FEEDBACK_PAGE_URL})`;
  assert.ok(skill.includes(`${comment} ${sentence}`), "right after the guide-comment sentence");
  assert.equal(skill.split(FEEDBACK_PAGE_URL).length - 1, 1, "named once");
  assert.equal(feedbackAddressInRules(loadTherapyProtocol()), FEEDBACK_PAGE_URL, "the connector finds the address the rules name");
});

test("the served sentence carries the approval rule, no public reviews from a chat, and the crisis boundary", async () => {
  const skill = await fs.readFile(SKILL, "utf8");
  const start = skill.indexOf("To send InnerSignal a suggestion");
  const paragraph = skill.slice(start, skill.indexOf("\n", start));
  assert.match(paragraph, /send it unchanged only after they say yes to that text/u);
  assert.match(paragraph, /leave out private details of their life or therapy unless they ask to include them/u);
  assert.match(paragraph, /A review that may be shown publicly is written by the person on the page, in their own words/u);
  assert.match(paragraph, /in a conversation where someone has said they want to die or might act, don't offer it, don't send anything about that through it, and never present it as reaching a person/u);
  assert.match(paragraph, /only InnerSignal's maker can open it, an AI checks each message only for signs that someone may be in danger so that he reads those first, and he reads it in his private inbox, a page in his Claude account/u);
  assert.doesNotMatch(FEEDBACK_PAGE_URL, /\d/u, "no digits: the rules' phone-number check passes");
});
