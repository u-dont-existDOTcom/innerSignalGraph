import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { protocolProvenanceRules } from "../src/prompts/protocol-provenance.mjs";
import { caseExtractionPrompt } from "../src/prompts/case-extract.mjs";
import { caseAuditPrompt } from "../src/prompts/case-audit.mjs";
import { candidatePrompt } from "../src/prompts/candidate.mjs";
import { realizationPrompt } from "../src/prompts/realize.mjs";
import { privateRuntimeAuditPrompt } from "../src/prompts/private-runtime-audit.mjs";
import { privateRuntimeRepairPrompt } from "../src/prompts/private-runtime-repair.mjs";

// Synthetic contrast cases for subsequent model evaluation. These tests establish
// consumer delivery and preservation, not semantic model success on the cases.
const cases = JSON.parse(await fs.readFile(new URL("../corpus/protocol-provenance-cases.json", import.meta.url), "utf8"));
for (const fixture of cases) {
  test(`protocol evidence reaches extraction and response consumers: ${fixture.id}`, () => {
    const context = { guideManifest: { version: "synthetic" }, guideExcerpts: "", userFacts: [],
      recentTranscript: fixture.precedingPrompt, userMessage: fixture.reply };
    const prompts = [caseExtractionPrompt(context), caseAuditPrompt(context, {}),
      candidatePrompt(context, "test"), realizationPrompt(context, {}, "test")];
    for (const prompt of prompts) {
      assert.ok(prompt.system.includes(protocolProvenanceRules));
      assert.ok(prompt.user.includes(fixture.precedingPrompt));
      assert.ok(prompt.user.includes(fixture.reply));
    }
    const packet = { recent_transcript: fixture.precedingPrompt, current_user_message: fixture.reply };
    for (const prompt of [privateRuntimeAuditPrompt(packet), privateRuntimeRepairPrompt(packet)]) {
      assert.ok(prompt.system.includes(protocolProvenanceRules));
      assert.ok(prompt.user.includes(JSON.stringify(packet, null, 2)));
    }
  });
}

test("plugin loads the exact shared protocol rules and current generated map", async () => {
  const base = new URL("../plugins/inner-signal-therapy/skills/inner-signal-therapy/", import.meta.url);
  const skill = await fs.readFile(new URL("SKILL.md", base), "utf8");
  const reference = await fs.readFile(new URL("references/PROTOCOL-STATE-PROVENANCE.md", base), "utf8");
  assert.ok(skill.includes("references/PROTOCOL-STATE-PROVENANCE.md"));
  assert.ok(reference.endsWith(protocolProvenanceRules));
  const map = await fs.readFile(new URL("../docs/INNER-CHILD-THERAPY-MAP.md", import.meta.url), "utf8");
  assert.equal(await fs.readFile(new URL("references/INNER-CHILD-THERAPY-MAP.md", base), "utf8"), map);
  assert.ok(map.includes("OVERLAY.IC.PROTOCOL_STATE_PROVENANCE"));
});
