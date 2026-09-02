import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { scanIdentifiability } from "../src/learning/identifiability-warning.mjs";
import { IDENTIFIABILITY_WARNING } from "../src/learning/provider-disclosure.mjs";

const fixture = JSON.parse(await fs.readFile(new URL("../learning-system/fixtures/identifiability-warning.json", import.meta.url), "utf8"));

test("synthetic identifier categories trigger the offline warning helper", () => {
  const categories = new Set(fixture.syntheticInputs.flatMap((value) => scanIdentifiability(value).categories));
  assert.deepEqual([...categories].sort(), [...fixture.expectedCategories].sort());
  for (const value of fixture.syntheticInputs) {
    const result = scanIdentifiability(value);
    assert.equal(result.warningRequired, true);
    assert.equal(result.containsPotentialIdentifiers, true);
    assert.equal(result.anonymous, false);
    assert.equal(result.anonymizer, false);
  }
});

test("a clean scan never claims anonymity or non-identifiability", () => {
  const result = scanIdentifiability(fixture.cleanInput);
  assert.deepEqual(result.categories, []);
  assert.equal(result.containsPotentialIdentifiers, false);
  assert.equal(result.anonymous, fixture.cleanInputAnonymous);
  assert.equal(result.nonIdentifying, false);
  assert.match(result.limitation, /cannot establish anonymity/);
});

test("warning names content-level re-identification risks", () => {
  for (const phrase of ["does not make message content anonymous", "Names", "contact details", "exact locations", "workplaces", "unique events", "health history", "combinations of facts can identify you"]) assert.equal(IDENTIFIABILITY_WARNING.includes(phrase), true, phrase);
  assert.equal(fixture.warningRequiredForBothProviderPaths, true);
});

test("helper rejects non-text input instead of coercing it", () => {
  for (const value of [null, undefined, 42, {}, []]) assert.throws(() => scanIdentifiability(value), /must be a string/);
});
