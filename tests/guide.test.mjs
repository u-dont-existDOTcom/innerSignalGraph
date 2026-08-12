import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { projectRoot } from "../src/core/config.mjs";
import { splitGuideIntoSections, selectGuideExcerpts } from "../src/guide/load-guide.mjs";

test("guide parser finds a useful section set", async () => {
  const text = await fs.readFile(path.join(projectRoot, "guides/inner-child-guide.txt"), "utf8");
  const sections = splitGuideIntoSections(text);
  assert.ok(sections.length >= 20, `expected at least 20 sections, got ${sections.length}`);
  const excerpt = selectGuideExcerpts(text, "angry inner child love feels fake unsafe relaxation", 18000);
  assert.match(excerpt, /When the Adult Voice Feels Fake/i);
  assert.match(excerpt, /Make the Protector Visible/i);
});
