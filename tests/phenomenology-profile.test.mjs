import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { caseSnapshotSchema, caseSnapshotGenerationSchema } from "../src/case-formulation/schemas.mjs";
import { validateInnerSpeechProfile, validateObservationPhenomenology } from "../src/case-formulation/phenomenology.mjs";
import { longitudinalClinicalRules } from "../src/prompts/common.mjs";

const profile = () => ({
  spontaneous_frequency: "RARE_OR_ABSENT",
  deliberate_speech: "EASY",
  usual_form: "NONE_OR_RARE",
  context_variation: "Silent wording is easier when deliberately rehearsing than during ordinary spontaneous thought.",
  source: "EXPLICIT_USER_REPORT"
});

const retrospectiveBodyAlarm = () => ({
  direct_modes: ["BODY_SENSATION", "URGE_ACTION_TENDENCY"],
  literal_inner_words: null,
  appraisal_or_meaning: "Something about this person felt dangerous.",
  verbalization_relation: "RETROSPECTIVE_TRANSLATION",
  claim_scope: "EXTERNAL_PERSON_OR_EVENT"
});

test("inner-speech profile keeps spontaneous frequency separate from deliberate ability", () => {
  assert.deepEqual(validateInnerSpeechProfile(profile()), profile());
});

test("inner-speech profile accepts only explicit user report", () => {
  assert.throws(() => validateInnerSpeechProfile({ ...profile(), source: "MODEL_INFERENCE" }), /explicit user report/i);
});

test("episode phenomenology can preserve a nonverbal alarm without inventing inner words", () => {
  assert.deepEqual(validateObservationPhenomenology(retrospectiveBodyAlarm()), retrospectiveBodyAlarm());
});

test("literal inner words must actually be reported as inner words", () => {
  assert.throws(() => validateObservationPhenomenology({
    ...retrospectiveBodyAlarm(),
    literal_inner_words: "That person is evil."
  }), /require INNER_WORDS/i);
});

test("literal-at-time wording requires the literal wording", () => {
  assert.throws(() => validateObservationPhenomenology({
    ...retrospectiveBodyAlarm(),
    verbalization_relation: "LITERAL_AT_TIME"
  }), /requires the reported literal inner words/i);
});

test("provider generation requires explicit phenomenology/profile while historical snapshots may omit them", () => {
  assert.equal(caseSnapshotSchema.required.includes("inner_speech_profile"), false);
  assert.equal(caseSnapshotSchema.properties.direct_observations.items.required.includes("phenomenology"), false);
  assert.equal(caseSnapshotGenerationSchema.required.includes("inner_speech_profile"), true);
  assert.equal(caseSnapshotGenerationSchema.properties.direct_observations.items.required.includes("phenomenology"), true);
});

test("clinical rules reject both verbal-default and nonverbal-privilege errors", () => {
  assert.match(longitudinalClinicalRules, /trait-level inner-speech frequency/i);
  assert.match(longitudinalClinicalRules, /Nonverbal is not inherently deeper/i);
  assert.match(longitudinalClinicalRules, /Do not assume that everyone first has a feeling/i);
  assert.match(longitudinalClinicalRules, /literal words present at the time/i);
  assert.match(longitudinalClinicalRules, /Language and analysis can make an implicit appraisal inspectable/i);
  assert.match(longitudinalClinicalRules, /revisable prior, never a global representation/i);
});

test("ChatGPT skill preserves host-native multimodal input and separate inner-speech screening", async () => {
  const skill = await fs.readFile(new URL("../plugins/inner-signal-therapy/skills/inner-signal-therapy/SKILL.md", import.meta.url), "utf8");
  assert.match(skill, /silent words or sentences/i);
  assert.match(skill, /deliberately think a sentence silently/i);
  assert.match(skill, /image, drawing, audio, song, or other file/i);
  assert.match(skill, /first-class communication/i);
  assert.match(skill, /do not require.*translate.*prose/i);
  assert.match(skill, /Nonverbal is not deeper or truer/i);
});
