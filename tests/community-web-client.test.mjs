import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Commons UI makes privacy, response contracts, consent, delayed outcomes, and non-activation visible", async () => {
  const html = await fs.readFile(path.join(root, "apps/community/index.html"), "utf8");
  const js = await fs.readFile(path.join(root, "apps/community/app.js"), "utf8");
  const css = await fs.readFile(path.join(root, "apps/community/styles.css"), "utf8");

  assert.match(html, /Your private InnerSignal sessions are not imported/);
  assert.match(html, /login-adult/);
  assert.match(html, /at least 18 years old/);
  assert.match(html, /login-agreement/);
  assert.match(html, /Conversation-only by default/i);
  assert.match(html, /Listen or witness only/);
  assert.match(html, /Challenge my interpretation/);
  assert.match(html, /Following 2–3 days/);
  assert.match(html, /No box is preselected/);
  assert.match(html, /delete-my-data/);
  assert.match(html, /Delete my Commons account and data/);
  assert.match(html, /No card can activate InnerSignal runtime behavior/);
  assert.match(html, /no direct messages/i);
  assert.match(js, /SOCIAL_LABELS/);
  assert.match(js, /EVIDENCE_LABELS/);
  assert.match(js, /Turn my post into a Field Note/);
  assert.match(js, /\/v1\/field-notes/);
  assert.match(js, /\/v1\/proposals\/export/);
  assert.match(js, /learning cannot activate runtime/);
  assert.match(css, /\.adverse-list/);
  assert.match(css, /\.consent-scopes/);
});
