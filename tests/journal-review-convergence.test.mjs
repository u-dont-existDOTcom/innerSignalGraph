// Unit tests for src/journal-import/review-convergence.mjs, the pure rules that settle repeated model reviews.
// Every extraction, review and reference below is invented, and each is checked against its versioned schema
// so the fixtures stay shaped like what the providers return.
import test from "node:test";
import assert from "node:assert/strict";
import { scoreReferenceReview } from "../src/journal-import/audit.mjs";
import { JOURNAL_GRAPH_CONTRACT, validateExtractionReferences, validateJournalSchema } from "../src/journal-import/contracts.mjs";
import { journalLocalNodeId } from "../src/journal-import/graph.mjs";
import {
  assessmentIsFinding,
  calibrationScoreCounts,
  extractionItemChanges,
  pooledCalibration,
  referenceScorePasses,
  reviewAfterWithholding,
  reviewFindingTargets,
  scopeReviewAfterRepair,
  sourceOnlyCalibrationCounts,
  withholdFlaggedItems
} from "../src/journal-import/review-convergence.mjs";

const U1 = "u1";
const U2 = "u2";
const U3 = "u3";
const TARGET = JOURNAL_GRAPH_CONTRACT.audit_defaults.reference_set_recall_target;

const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

// ---------------------------------------------------------------------------------------------------------
// Extraction fixtures. A small invented story spread over two units; `second` names where its later half lives,
// so storyItems(U1) puts everything in one unit.
// ---------------------------------------------------------------------------------------------------------

const unknownTime = (evidenceIds = []) => ({ raw: null, from: null, to: null, precision: "unknown", timezone: null,
  basis: "unresolved", evidence_ids: evidenceIds });
const anchor = (unitId, quote) => ({ unit_id: unitId, quote, occurrence: null });
const entity = (localId, unitId, label, entityKind = "person") => ({ local_id: localId, label, entity_kind: entityKind,
  anchors: [anchor(unitId, label)] });
const episode = (localId, unitId, label) => ({ local_id: localId, label, authored_time: unknownTime(),
  event_time: unknownTime(), anchors: [anchor(unitId, label)] });
const assertion = (localId, unitId, statement, { speaker = "e-maren", subjects = [], episodeId = null } = {}) => ({
  local_id: localId, statement, assertion_kind: "direct_report", narrative_mode: "waking", speaker_local_id: speaker,
  subject_local_ids: subjects, episode_local_id: episodeId, polarity: "affirmed", qualifiers: [],
  authored_time: unknownTime(), event_time: unknownTime(), anchors: [anchor(unitId, statement)],
  importance_reasons: ["first-hand account"], extraction_confidence: "high" });

const coverageFor = (unitIds, assertions) => unitIds.map((unitId) => {
  const ids = assertions.filter((item) => item.anchors.some((a) => a.unit_id === unitId)).map((item) => item.local_id);
  return { unit_id: unitId, disposition: ids.length ? "extracted" : "no_assertion", assertion_local_ids: ids, reason: null };
});
const extraction = ({ unitIds = [U1, U2], entities = [], episodes = [], assertions = [], status = "complete",
  coverage = coverageFor(unitIds, assertions) } = {}) => {
  const value = validateJournalSchema("extraction-result", { schema_version: "1.0", status, assertions, entities, episodes,
    coverage, requested_context: [] });
  return validateExtractionReferences(value, unitIds); // every speaker, subject, episode and unit resolves
};

const storyItems = (second = U2) => ({
  entities: [
    entity("e-maren", U1, "Maren"),
    entity("e-lamp", U1, "the lamp at the point", "object"),
    entity("e-keeper", second, "the keeper"),
    entity("e-boat", second, "the ferry boat", "object"),
    entity("e-dock", second, "the dock", "place")
  ],
  episodes: [
    episode("ep-walk", U1, "the walk out to Pell Point"),
    episode("ep-ferry", second, "the ferry home"),
    episode("ep-storm", second, "the storm that week")
  ],
  assertions: [
    assertion("a1", U1, "Maren walked out to Pell Point before breakfast.", { subjects: ["e-maren"], episodeId: "ep-walk" }),
    assertion("a2", U1, "The lamp at the point was dark.", { subjects: ["e-lamp"], episodeId: "ep-walk" }),
    assertion("a3", second, "The keeper said the lamp would be lit by dusk.", { speaker: "e-keeper", subjects: ["e-lamp"] }),
    assertion("a4", second, "Maren crossed on the ferry boat.", { subjects: ["e-boat"], episodeId: "ep-ferry" })
  ]
});
const story = (items = storyItems(), unitIds = [U1, U2]) => extraction({ ...items, unitIds });
const oneUnitStory = () => story(storyItems(U1), [U1]);

const edited = (items, field, localId, patch) => ({ ...items,
  [field]: items[field].map((item) => item.local_id === localId ? { ...item, ...patch } : item) });
const renamed = (items, field, from, to) => edited(items, field, from, { local_id: to });
const added = (items, field, item) => ({ ...items, [field]: [...items[field], item] });
const without = (items, field, localId) => ({ ...items, [field]: items[field].filter((item) => item.local_id !== localId) });
const ids = (items) => items.map((item) => item.local_id);

// ---------------------------------------------------------------------------------------------------------
// Review fixtures. `tag` goes into the explanation so a test can tell the earlier verdict from the later one.
// ---------------------------------------------------------------------------------------------------------

const verdict = (targetId, outcome = "preserved", findingType = "none",
  { critical = false, evidenceIds = [], explanation = `later verdict on ${targetId}.` } = {}) => ({
  target_id: targetId, outcome, critical, finding_type: findingType, explanation, evidence_ids: evidenceIds });
const ok = (targetId, tag) => verdict(targetId, "preserved", "none", { explanation: `${tag} verdict on ${targetId}.` });
const flag = (targetId, tag, findingType = "missing_evidence") => verdict(targetId, "omitted", findingType,
  { explanation: `${tag} verdict on ${targetId}.` });
const repairFor = (targetId) => ({ target_id: targetId, repair: `Say what the source says about ${targetId}.`, evidence_ids: [] });
const review = ({ assessments = [], unassessed = [], repairs = [], status, role = "omission_checker" } = {}) => {
  const open = assessments.some((item) => item.outcome !== "preserved" || item.finding_type !== "none")
    || unassessed.length > 0 || repairs.length > 0;
  return validateJournalSchema("review-result", { schema_version: "1.0", target_generation: "gen-1", review_role: role,
    assessments, proposed_repairs: repairs, unassessed_ids: unassessed,
    status: status ?? (open ? "repair_required" : "sufficient_for_stated_scope") });
};
const earlierClean = (targets = ["a1", "a2", "a3", "a4"]) => review({ assessments: targets.map((id) => ok(id, "earlier")) });

const scope = ({ review: later, previousReview = earlierClean(), previousExtraction = story(), extraction: repaired,
  unitIds = [U1, U2], targetOf }) => {
  const result = scopeReviewAfterRepair({ review: later, previousReview, previousExtraction, extraction: repaired,
    unitIds, targetOf });
  validateJournalSchema("review-result", result.review);
  return result;
};
const verdictOn = (result, targetId) => result.review.assessments.find((item) => item.target_id === targetId);
const targetsIn = (result) => result.review.assessments.map((item) => item.target_id);
const explanations = (result) => Object.fromEntries(result.review.assessments.map((item) => [item.target_id, item.explanation]));

// ---------------------------------------------------------------------------------------------------------
// extractionItemChanges
// ---------------------------------------------------------------------------------------------------------

const KIND_CASES = [
  { kind: "assertion", field: "assertions", id: "a2", unit: U1, text: "statement",
    fresh: () => assertion("a5", U1, "A gull sat on the rail.", { subjects: ["e-maren"] }) },
  { kind: "entity", field: "entities", id: "e-dock", unit: U2, text: "label",
    fresh: () => entity("e-gull", U1, "the gull", "object") },
  { kind: "episode", field: "episodes", id: "ep-storm", unit: U2, text: "label",
    fresh: () => episode("ep-fog", U2, "the fog on the second day") }
];
const record = (result, kind, localId) => result.items.find((item) => item.kind === kind && item.localId === localId);

test("extractionItemChanges: an extraction compared with itself has no changes and loses nothing", () => {
  const result = extractionItemChanges(story(), story());
  assert.equal(result.items.length, 12);
  assert.ok(result.items.every((item) => item.changed === false && item.previousId === item.localId));
  assert.deepEqual(result.removed, []);
});

for (const { kind, field, id, unit, text, fresh } of KIND_CASES) {
  test(`extractionItemChanges: an unchanged ${kind} is not changed and names itself as the earlier item`, () => {
    const result = extractionItemChanges(story(), story());
    assert.deepEqual(record(result, kind, id),
      { kind, localId: id, unitIds: [unit], changed: false, previousId: id, previousUnitIds: [unit] });
    assert.deepEqual(result.removed, []);
  });

  test(`extractionItemChanges: an ${kind} with the same content under a new local ID is unchanged and names the old ID`, () => {
    const result = extractionItemChanges(story(), story(renamed(storyItems(), field, id, `${id}-v2`)));
    assert.deepEqual(record(result, kind, `${id}-v2`),
      { kind, localId: `${id}-v2`, unitIds: [unit], changed: false, previousId: id, previousUnitIds: [unit] });
    assert.equal(record(result, kind, id), undefined);
    assert.deepEqual(result.removed, [], "the old ID was matched, so nothing was lost");
  });

  test(`extractionItemChanges: an ${kind} modified under its own ID is changed and replaces the old one`, () => {
    const result = extractionItemChanges(story(), story(edited(storyItems(), field, id, { [text]: "A revised wording." })));
    assert.deepEqual(record(result, kind, id),
      { kind, localId: id, unitIds: [unit], changed: true, previousId: id, previousUnitIds: [unit] });
    assert.deepEqual(result.removed, [], "a replaced item is not also a removed one");
    assert.equal(result.items.filter((item) => item.kind === kind && item.changed).length, 1);
  });

  test(`extractionItemChanges: an added ${kind} is changed and has no earlier item`, () => {
    const addition = fresh();
    const result = extractionItemChanges(story(), story(added(storyItems(), field, addition)));
    assert.deepEqual(record(result, kind, addition.local_id), { kind, localId: addition.local_id,
      unitIds: [addition.anchors[0].unit_id], changed: true, previousId: null, previousUnitIds: [] });
    assert.deepEqual(result.removed, []);
  });

  test(`extractionItemChanges: a removed ${kind} is reported with its units and is no longer an item`, () => {
    // Nothing else in the story cites a2, e-dock or ep-storm, so the shorter extraction still binds.
    const result = extractionItemChanges(story(), story(without(storyItems(), field, id)));
    assert.deepEqual(result.removed, [{ kind, localId: id, unitIds: [unit] }]);
    assert.equal(record(result, kind, id), undefined);
    assert.ok(result.items.every((item) => !item.changed));
  });
}

test("extractionItemChanges: items that trade local IDs are matched by content, so none is changed", () => {
  const before = storyItems();
  const [a1, a2] = before.assertions;
  const swapped = { ...before, assertions: [{ ...a2, local_id: "a1" }, { ...a1, local_id: "a2" }, ...before.assertions.slice(2)] };
  const result = extractionItemChanges(story(before), story(swapped));
  assert.deepEqual(record(result, "assertion", "a1"), { kind: "assertion", localId: "a1", unitIds: [U1],
    changed: false, previousId: "a2", previousUnitIds: [U1] });
  assert.deepEqual(record(result, "assertion", "a2"), { kind: "assertion", localId: "a2", unitIds: [U1],
    changed: false, previousId: "a1", previousUnitIds: [U1] });
  assert.deepEqual(result.removed, []);
});

test("extractionItemChanges: key order does not matter, but a different value does", () => {
  const before = storyItems();
  const reversedKeys = (value) => Array.isArray(value) ? value.map(reversedKeys) : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reversedKeys(child)])) : value;
  const reordered = { ...before, assertions: before.assertions.map(reversedKeys) };
  assert.ok(extractionItemChanges(story(before), story(reordered)).items.every((item) => !item.changed));
  const requalified = edited(before, "assertions", "a1", { qualifiers: ["as far as she remembers"] });
  assert.equal(record(extractionItemChanges(story(before), story(requalified)), "assertion", "a1").changed, true);
  const retimed = edited(before, "assertions", "a1", { event_time: unknownTime([U1]) });
  assert.equal(record(extractionItemChanges(story(before), story(retimed)), "assertion", "a1").changed, true);
});

test("extractionItemChanges: renaming an entity changes the assertions that cite it, not the entity", () => {
  const before = storyItems();
  const cite = (item) => ({ ...item, subject_local_ids: item.subject_local_ids.map((id) => id === "e-lamp" ? "e-lamp-v2" : id) });
  const after = { ...renamed(before, "entities", "e-lamp", "e-lamp-v2"), assertions: before.assertions.map(cite) };
  const result = extractionItemChanges(story(before), story(after));
  assert.equal(record(result, "entity", "e-lamp-v2").changed, false);
  assert.equal(record(result, "entity", "e-lamp-v2").previousId, "e-lamp");
  assert.deepEqual(result.items.filter((item) => item.changed).map((item) => item.localId).sort(), ["a2", "a3"]);
});

test("extractionItemChanges: each earlier item matches at most one current item", () => {
  const twin = (id) => ({ ...assertion(id, U1, "The same sentence, written twice.", { subjects: ["e-maren"] }) });
  const base = { ...storyItems(), assertions: [twin("t1"), twin("t2")] };
  const result = extractionItemChanges(story(base), story({ ...base, assertions: [twin("t7"), twin("t8"), twin("t9")] }));
  const byId = Object.fromEntries(result.items.map((item) => [item.localId, item]));
  assert.deepEqual([byId.t7.changed, byId.t8.changed, byId.t9.changed], [false, false, true]);
  assert.deepEqual([byId.t7.previousId, byId.t8.previousId, byId.t9.previousId], ["t1", "t2", null]);
  assert.deepEqual(result.removed, []);
});

test("extractionItemChanges: an item anchored in several units lists each of them once, in anchor order", () => {
  const spanning = [anchor(U2, "second quote"), anchor(U1, "first quote"), anchor(U2, "another quote")];
  const items = edited(storyItems(), "assertions", "a2", { anchors: spanning });
  const result = extractionItemChanges(story(items), story(items));
  assert.deepEqual(record(result, "assertion", "a2").unitIds, [U2, U1]);
});

test("extractionItemChanges: a missing extraction counts as empty", () => {
  const added = extractionItemChanges(null, story());
  assert.ok(added.items.every((item) => item.changed && item.previousId === null));
  assert.equal(added.items.length, 12);
  assert.deepEqual(added.removed, []);
  const lost = extractionItemChanges(story(), null);
  assert.deepEqual(lost.items, []);
  assert.equal(lost.removed.length, 12);
});

test("extractionItemChanges: an earlier item matched by content is not also replaced by an item that reuses its ID", () => {
  const before = storyItems();
  const original = before.assertions[1];
  const moved = { ...original, local_id: "a2-moved" };
  const reused = { ...original, statement: "The lamp at the point stayed dark all night." };
  const after = { ...before, assertions: [before.assertions[0], moved, reused, ...before.assertions.slice(2)] };
  const result = extractionItemChanges(story(before), story(after));
  assert.deepEqual(record(result, "assertion", "a2-moved"), { kind: "assertion", localId: "a2-moved", unitIds: [U1],
    changed: false, previousId: "a2", previousUnitIds: [U1] });
  assert.deepEqual(record(result, "assertion", "a2"), { kind: "assertion", localId: "a2", unitIds: [U1],
    changed: true, previousId: null, previousUnitIds: [] }, "the old a2 already went to a2-moved, so this one is new");
  assert.deepEqual(result.removed, []);
});

test("extractionItemChanges: the classification does not depend on the order of the repaired items", () => {
  const before = storyItems();
  const original = before.assertions[1];
  const rewritten = { ...original, statement: "The lamp at the point stayed dark all night." };
  const oldWording = { ...original, local_id: "a2-old" };
  const withOrder = (pair) => ({ ...before, assertions: [before.assertions[0], ...pair, ...before.assertions.slice(2)] });
  const normalise = (result) => ({ items: [...result.items].sort((left, right) => left.localId.localeCompare(right.localId)),
    removed: result.removed });
  const forward = extractionItemChanges(story(before), story(withOrder([rewritten, oldWording])));
  const backward = extractionItemChanges(story(before), story(withOrder([oldWording, rewritten])));
  assert.deepEqual(normalise(forward), normalise(backward));
});

// ---------------------------------------------------------------------------------------------------------
// assessmentIsFinding and reviewFindingTargets
// ---------------------------------------------------------------------------------------------------------

test("assessmentIsFinding: anything but a preserved verdict without a finding asks for work", () => {
  assert.equal(assessmentIsFinding(verdict("a1")), false);
  assert.equal(assessmentIsFinding(verdict("a1", "preserved", "lost_qualifier")), true);
  assert.equal(assessmentIsFinding(verdict("a1", "omitted", "none")), true);
  assert.equal(assessmentIsFinding(verdict("a1", "distorted", "wrong_time")), true);
  assert.equal(assessmentIsFinding(verdict("a1", "unassessed", "none")), true);
});

test("reviewFindingTargets: collects findings, unassessed IDs and proposed repair targets, not clean verdicts", () => {
  const open = review({
    assessments: [ok("a1", "later"), flag("a2", "later"), verdict("a3", "preserved", "wrong_time")],
    unassessed: ["a4", "u2"],
    repairs: [repairFor("a2"), repairFor("e-lamp")]
  });
  assert.deepEqual([...reviewFindingTargets(open)].sort(), ["a2", "a3", "a4", "e-lamp", "u2"]);
  assert.deepEqual([...reviewFindingTargets(earlierClean())], []);
  assert.deepEqual([...reviewFindingTargets(null)], []);
  assert.deepEqual([...reviewFindingTargets(undefined)], []);
});

// ---------------------------------------------------------------------------------------------------------
// scopeReviewAfterRepair
// ---------------------------------------------------------------------------------------------------------

test("scopeReviewAfterRepair: returns the review unscoped when there is no previous review or extraction", () => {
  const later = review({ assessments: [flag("a1", "later"), ok("a2", "later")] });
  const base = story();
  const inputs = {
    "no previous review": { previousReview: null, previousExtraction: base, extraction: base },
    "no previous extraction": { previousReview: earlierClean(), previousExtraction: null, extraction: base },
    "no repaired extraction": { previousReview: earlierClean(), previousExtraction: base, extraction: null }
  };
  for (const [name, rest] of Object.entries(inputs)) {
    assert.deepEqual(scopeReviewAfterRepair({ review: later, unitIds: [U1, U2], ...rest }), { review: later, scope: null }, name);
  }
  for (const missing of [null, undefined]) {
    assert.deepEqual(scopeReviewAfterRepair({ review: missing, previousReview: earlierClean(), previousExtraction: base,
      extraction: base, unitIds: [U1, U2] }), { review: null, scope: null });
  }
});

test("scopeReviewAfterRepair: a finding on an unchanged item that passed earlier is carried, not counted", () => {
  const repaired = story(edited(storyItems(), "assertions", "a3", { statement: "The keeper said the lamp would be lit by night." }));
  const later = review({ assessments: [flag("a1", "later"), ok("a2", "later"), flag("a3", "later"), ok("a4", "later")] });
  const result = scope({ review: later, extraction: repaired });
  assert.deepEqual(explanations(result), {
    a1: "earlier verdict on a1.",
    a2: "earlier verdict on a2.",
    a3: "later verdict on a3.",
    a4: "earlier verdict on a4."
  });
  assert.equal(verdictOn(result, "a1").outcome, "preserved", "the earlier verdict replaced the finding");
  assert.equal(verdictOn(result, "a3").outcome, "omitted", "the finding on the changed item still counts");
  assert.deepEqual(result.scope, { carried: 1, changed: 1, removed: 0, earlier_findings: 0 });
  assert.equal(result.review.status, "repair_required");
});

test("scopeReviewAfterRepair: carrying the only findings leaves nothing open and the review sufficient", () => {
  const repaired = story(edited(storyItems(), "assertions", "a3", { statement: "The keeper said the lamp would be lit by night." }));
  const later = review({ assessments: [flag("a1", "later"), ok("a3", "later"), flag("a4", "later", "wrong_time")] });
  const result = scope({ review: later, extraction: repaired });
  // a2, unchanged and left out of the new review, keeps its earlier clean verdict too.
  assert.deepEqual(explanations(result), { a1: "earlier verdict on a1.", a2: "earlier verdict on a2.",
    a3: "later verdict on a3.", a4: "earlier verdict on a4." });
  assert.deepEqual(result.scope, { carried: 2, changed: 1, removed: 0, earlier_findings: 0 });
  assert.equal(result.review.status, "sufficient_for_stated_scope");
});

test("scopeReviewAfterRepair: an out-of-scope finding with no earlier verdict is dropped", () => {
  const repaired = story(edited(storyItems(), "assertions", "a3", { statement: "The keeper said the lamp would be lit by night." }));
  const later = review({ assessments: [flag("a2", "later"), ok("a3", "later")] });
  const result = scope({ review: later, previousReview: earlierClean(["a1"]), extraction: repaired });
  // a2's finding goes; a1, unchanged and left out of the new review, keeps its earlier clean verdict.
  assert.deepEqual(targetsIn(result), ["a3", "a1"]);
  assert.equal(result.scope.carried, 1);
  assert.equal(result.review.status, "sufficient_for_stated_scope");
});

test("scopeReviewAfterRepair: findings on a changed or an added item count in full", () => {
  const items = added(edited(storyItems(), "assertions", "a2", { statement: "The lamp at the point was dark and cold." }),
    "assertions", assertion("a5", U1, "A gull sat on the rail.", { subjects: ["e-maren"] }));
  const detailed = verdict("a2", "distorted", "wrong_time", { critical: true, evidenceIds: ["a1"], explanation: "Later: wrong day." });
  const later = review({ assessments: [detailed, flag("a5", "later"), flag("a1", "later")] });
  const result = scope({ review: later, extraction: story(items) });
  assert.deepEqual(verdictOn(result, "a2"), detailed, "an in-scope verdict is kept exactly as the reviewer gave it");
  assert.equal(verdictOn(result, "a5").explanation, "later verdict on a5.");
  assert.equal(verdictOn(result, "a1").explanation, "earlier verdict on a1.");
  assert.deepEqual(result.scope, { carried: 1, changed: 2, removed: 0, earlier_findings: 0 });
  assert.equal(result.review.status, "repair_required");
});

test("scopeReviewAfterRepair: entities and episodes are scoped like assertions", () => {
  const items = added(edited(storyItems(), "entities", "e-lamp", { label: "the lamp on the point" }),
    "episodes", episode("ep-fog", U2, "the fog on the second day"));
  const earlier = review({ assessments: [ok("e-lamp", "earlier"), ok("ep-walk", "earlier"), ok("ep-ferry", "earlier")] });
  const later = review({ assessments: [flag("e-lamp", "later"), flag("ep-walk", "later"), flag("ep-fog", "later"),
    flag("e-keeper", "later")] });
  const result = scope({ review: later, previousReview: earlier, extraction: story(items) });
  assert.deepEqual(explanations(result), {
    "e-lamp": "later verdict on e-lamp.",
    "ep-walk": "earlier verdict on ep-walk.",
    "ep-fog": "later verdict on ep-fog.",
    "ep-ferry": "earlier verdict on ep-ferry." // unchanged and left out of the new review
  });
  // e-lamp and ep-fog changed, and so did a2 and a3, which name e-lamp as their subject.
  assert.deepEqual(result.scope, { carried: 2, changed: 4, removed: 0, earlier_findings: 0 });
});

test("scopeReviewAfterRepair: a finding on an item that was flagged earlier counts, even if nothing changed", () => {
  const earlier = review({ assessments: [flag("a2", "earlier"), ok("a1", "earlier")] });
  const later = review({ assessments: [flag("a2", "later"), flag("a1", "later")] });
  const result = scope({ review: later, previousReview: earlier, extraction: story() });
  assert.deepEqual(explanations(result), { a2: "later verdict on a2.", a1: "earlier verdict on a1." });
  assert.deepEqual(result.scope, { carried: 1, changed: 0, removed: 0, earlier_findings: 1 });
  assert.equal(result.review.status, "repair_required");
});

test("scopeReviewAfterRepair: an item renamed with identical content keeps its earlier standing", () => {
  const items = renamed(renamed(storyItems(), "assertions", "a2", "a2-v2"), "assertions", "a1", "a1-v2");
  const earlier = review({ assessments: [flag("a2", "earlier"), ok("a1", "earlier")] });
  const later = review({ assessments: [flag("a2-v2", "later"), flag("a1-v2", "later")] });
  const result = scope({ review: later, previousReview: earlier, extraction: story(items) });
  assert.equal(verdictOn(result, "a2-v2").explanation, "later verdict on a2-v2.", "flagged earlier under the old ID, so it counts");
  assert.equal(verdictOn(result, "a2-v2").outcome, "omitted");
  assert.deepEqual(verdictOn(result, "a1-v2"), { ...ok("a1", "earlier"), target_id: "a1-v2" },
    "the earlier verdict of the old ID is carried under the new one");
  assert.deepEqual(result.scope, { carried: 1, changed: 0, removed: 0, earlier_findings: 1 });
  assert.equal(result.review.status, "repair_required");
});

test("scopeReviewAfterRepair: a finding on an ID flagged earlier counts even when another item's content now sits under that ID", () => {
  const items = renamed(without(storyItems(), "assertions", "a2"), "assertions", "a1", "a2");
  const earlier = review({ assessments: [ok("a1", "earlier"), flag("a2", "earlier")] });
  const later = review({ assessments: [flag("a2", "later")] });
  const result = scope({ review: later, previousReview: earlier, extraction: story(items) });
  assert.deepEqual(explanations(result), { a2: "later verdict on a2." });
  assert.deepEqual(result.scope, { carried: 0, changed: 0, removed: 1, earlier_findings: 1 });
  assert.equal(result.review.status, "repair_required");
});

test("scopeReviewAfterRepair: a unit-level finding counts when the unit had an earlier finding", () => {
  const earlier = review({ assessments: [flag("u1", "earlier"), ok("u2", "earlier")] });
  const later = review({ assessments: [flag("u1", "later"), flag("u2", "later")] });
  const result = scope({ review: later, previousReview: earlier, extraction: story() });
  assert.deepEqual(explanations(result), { u1: "later verdict on u1.", u2: "earlier verdict on u2." });
  assert.deepEqual(result.scope, { carried: 1, changed: 0, removed: 0, earlier_findings: 1 });
});

test("scopeReviewAfterRepair: a unit-level finding counts when the repair removed an item from the unit", () => {
  const earlier = review({ assessments: [ok("u1", "earlier"), ok("u2", "earlier")] });
  const later = review({ assessments: [flag("u1", "later"), flag("u2", "later")] });
  const result = scope({ review: later, previousReview: earlier, extraction: story(without(storyItems(), "assertions", "a4")) });
  assert.deepEqual(explanations(result), { u1: "earlier verdict on u1.", u2: "later verdict on u2." });
  assert.deepEqual(result.scope, { carried: 1, changed: 0, removed: 1, earlier_findings: 0 });
  assert.equal(result.review.status, "repair_required");
});

test("scopeReviewAfterRepair: removing an item that spans units opens each of them to a unit-level finding", () => {
  const spanning = [anchor(U1, "first quote"), anchor(U2, "second quote")];
  const before = edited(storyItems(), "assertions", "a1", { anchors: spanning });
  const earlier = review({ assessments: [ok("u1", "earlier"), ok("u2", "earlier")] });
  const later = review({ assessments: [flag("u1", "later"), flag("u2", "later")] });
  const result = scope({ review: later, previousReview: earlier, previousExtraction: story(before),
    extraction: story(without(before, "assertions", "a1")) });
  assert.deepEqual(explanations(result), { u1: "later verdict on u1.", u2: "later verdict on u2." });
  assert.deepEqual(result.scope, { carried: 0, changed: 0, removed: 1, earlier_findings: 0 });
});

test("scopeReviewAfterRepair: a unit-level finding is carried when the unit only gained or changed items", () => {
  const earlier = review({ assessments: [ok("u1", "earlier"), ok("u2", "earlier")] });
  const gained = added(edited(storyItems(), "assertions", "a3", { statement: "The keeper said the lamp would be lit by night." }),
    "assertions", assertion("a5", U2, "Gulls had taken the dock.", { subjects: ["e-dock"] }));
  const later = review({ assessments: [flag("u1", "later"), flag("u2", "later")] });
  const result = scope({ review: later, previousReview: earlier, extraction: story(gained) });
  assert.deepEqual(explanations(result), { u1: "earlier verdict on u1.", u2: "earlier verdict on u2." });
  assert.deepEqual(result.scope, { carried: 2, changed: 2, removed: 0, earlier_findings: 0 });
  assert.equal(result.review.status, "sufficient_for_stated_scope");
});

test("scopeReviewAfterRepair: a unit that lost an item by having it re-anchored elsewhere keeps its unit-level finding", () => {
  const before = { entities: [entity("e-maren", U1, "Maren")], episodes: [],
    assertions: [assertion("a1", U1, "Maren walked out to Pell Point.", { subjects: ["e-maren"] }),
      assertion("a2", U2, "Maren crossed on the ferry boat.", { subjects: ["e-maren"] })] };
  const moved = edited(before, "assertions", "a1", { anchors: [anchor(U2, "Maren walked out to Pell Point.")] });
  const earlier = review({ assessments: [ok("u1", "earlier"), ok("u2", "earlier")] });
  const later = review({ assessments: [flag("u1", "later")] });
  const result = scope({ review: later, previousReview: earlier, previousExtraction: story(before), extraction: story(moved) });
  assert.equal(result.review.status, "repair_required");
  assert.equal(verdictOn(result, "u1").explanation, "later verdict on u1.");
});

test("scopeReviewAfterRepair: a target that is neither an item nor a unit always counts", () => {
  const later = review({ assessments: [flag("ref-1", "later"), ok("ref-2", "later")], unassessed: ["ref-3"],
    repairs: [repairFor("ref-4")] });
  const result = scope({ review: later, previousReview: review({ assessments: [] }), extraction: story() });
  assert.deepEqual(explanations(result), { "ref-1": "later verdict on ref-1.", "ref-2": "later verdict on ref-2." });
  assert.deepEqual(result.review.unassessed_ids, ["ref-3"]);
  assert.deepEqual(result.review.proposed_repairs.map((item) => item.target_id), ["ref-4"]);
  assert.deepEqual(result.scope, { carried: 0, changed: 0, removed: 0, earlier_findings: 0 });
  assert.equal(result.review.status, "repair_required");
});

test("scopeReviewAfterRepair: out-of-scope unassessed IDs and proposed repairs are dropped, in-scope ones stay", () => {
  const repaired = story(edited(storyItems(), "assertions", "a3", { statement: "The keeper said the lamp would be lit by night." }));
  const later = review({ assessments: [ok("a1", "later"), ok("a3", "later")], unassessed: ["a1", "a3"],
    repairs: [repairFor("a1"), repairFor("a3")] });
  const result = scope({ review: later, extraction: repaired });
  assert.deepEqual(result.review.unassessed_ids, ["a3"]);
  assert.deepEqual(result.review.proposed_repairs, [repairFor("a3")]);
  assert.equal(result.scope.carried, 1, "the unassessed ID that was left out of scope counts as carried");
  assert.equal(result.review.status, "repair_required");
});

test("scopeReviewAfterRepair: the status becomes sufficient when only out-of-scope findings were open", () => {
  const repaired = story(edited(storyItems(), "assertions", "a3", { statement: "The keeper said the lamp would be lit by night." }));
  const later = review({ assessments: [flag("a1", "later"), flag("a2", "later"), ok("a3", "later")], unassessed: ["a4"],
    repairs: [repairFor("a1")] });
  assert.equal(later.status, "repair_required");
  const result = scope({ review: later, extraction: repaired });
  assert.equal(result.review.status, "sufficient_for_stated_scope");
  assert.deepEqual(result.review.unassessed_ids, []);
  assert.deepEqual(result.review.proposed_repairs, []);
});

test("scopeReviewAfterRepair: the status is repair_required while anything in scope is open", () => {
  const repaired = story(edited(storyItems(), "assertions", "a3", { statement: "The keeper said the lamp would be lit by night." }));
  const cases = {
    "a finding": review({ assessments: [flag("a3", "later")] }),
    "a distorted verdict": review({ assessments: [verdict("a3", "distorted", "wrong_time")] }),
    "a preserved verdict that still names a finding": review({ assessments: [verdict("a3", "preserved", "lost_qualifier")] }),
    "an unassessed ID": review({ assessments: [ok("a3", "later")], unassessed: ["a3"] }),
    "a proposed repair": review({ assessments: [ok("a3", "later")], repairs: [repairFor("a3")] })
  };
  for (const [name, later] of Object.entries(cases)) {
    assert.equal(scope({ review: later, extraction: repaired }).review.status, "repair_required", name);
  }
  const claimedSufficient = review({ assessments: [flag("a3", "later")], status: "sufficient_for_stated_scope" });
  assert.equal(scope({ review: claimedSufficient, extraction: repaired }).review.status, "repair_required",
    "the status is recomputed, whatever the reviewer claimed");
});

test("scopeReviewAfterRepair: an incomplete review stays incomplete while an in-scope unassessed ID remains", () => {
  const repaired = story(edited(storyItems(), "assertions", "a3", { statement: "The keeper said the lamp would be lit by night." }));
  const later = review({ assessments: [ok("a3", "later")], unassessed: ["a1", "a3"], status: "incomplete" });
  const result = scope({ review: later, extraction: repaired });
  assert.deepEqual(result.review.unassessed_ids, ["a3"]);
  assert.equal(result.review.status, "incomplete");
});

test("scopeReviewAfterRepair: an incomplete review that names nothing it left stays incomplete", () => {
  const later = review({ assessments: [ok("a3", "later")], status: "incomplete" });
  const result = scope({ review: later, extraction: story() });
  assert.equal(result.review.status, "incomplete");
  assert.deepEqual(result.review.unassessed_ids, []);
});

test("scopeReviewAfterRepair: an incomplete review whose unassessed IDs were all out of scope is no longer incomplete", () => {
  const repaired = story(edited(storyItems(), "assertions", "a3", { statement: "The keeper said the lamp would be lit by night." }));
  const clean = review({ assessments: [ok("a3", "later")], unassessed: ["a1"], status: "incomplete" });
  assert.equal(scope({ review: clean, extraction: repaired }).review.status, "sufficient_for_stated_scope");
  const open = review({ assessments: [flag("a3", "later")], unassessed: ["a1"], status: "incomplete" });
  assert.equal(scope({ review: open, extraction: repaired }).review.status, "repair_required");
});

test("scopeReviewAfterRepair: scope counts changed items, removed items and distinct earlier open targets", () => {
  const items = without(added(edited(storyItems(), "assertions", "a2", { statement: "The lamp at the point stayed dark." }),
    "assertions", assertion("a5", U2, "Gulls had taken the dock.", { subjects: ["e-dock"] })), "assertions", "a4");
  const earlier = review({ assessments: [flag("a2", "earlier"), ok("a1", "earlier")], unassessed: ["a3"],
    repairs: [repairFor("a2"), repairFor("a4")] });
  const later = review({ assessments: [ok("a1", "later")] });
  const result = scope({ review: later, previousReview: earlier, extraction: story(items) });
  assert.deepEqual(result.scope, { carried: 0, changed: 2, removed: 1, earlier_findings: 3 });
});

test("scopeReviewAfterRepair: keeps the new review's identity and passes it through the review schema", () => {
  const later = review({ assessments: [flag("a1", "later")], role: "omission_checker" });
  const result = scope({ review: { ...later, target_generation: "gen-7" }, extraction: story() });
  assert.equal(result.review.target_generation, "gen-7");
  assert.equal(result.review.review_role, "omission_checker");
  assert.equal(result.review.schema_version, "1.0");
});

test("scopeReviewAfterRepair: scoping an already scoped review again changes nothing", () => {
  const repaired = story(edited(storyItems(), "assertions", "a3", { statement: "The keeper said the lamp would be lit by night." }));
  const later = review({ assessments: [flag("a1", "later"), ok("a2", "later"), flag("a3", "later")], unassessed: ["a2"],
    repairs: [repairFor("a1"), repairFor("a3")] });
  const first = scope({ review: later, extraction: repaired });
  const second = scope({ review: first.review, extraction: repaired });
  assert.deepEqual(second.review, first.review);
  assert.equal(second.scope.carried, 0);
});

test("scopeReviewAfterRepair: a custom targetOf maps items to the reviewer's own IDs", () => {
  // The fidelity auditor names an item by its bound graph ID; here a readable stand-in: kind, first unit, local ID.
  const graphId = (kind, localId, unitIds) => `${kind}:${unitIds[0]}:${localId}`;
  const items = renamed(edited(storyItems(), "assertions", "a3", { statement: "The keeper said the lamp would be lit by night." }),
    "assertions", "a2", "a2-v2");
  const earlier = review({ role: "fidelity_auditor", assessments: [
    flag(graphId("assertion", "a2", [U1]), "earlier"),
    ok(graphId("assertion", "a1", [U1]), "earlier"),
    ok(graphId("assertion", "a3", [U2]), "earlier"),
    ok("ref-1", "earlier")
  ] });
  const later = review({ role: "fidelity_auditor", assessments: [
    flag(graphId("assertion", "a1", [U1]), "later"),
    flag(graphId("assertion", "a3", [U2]), "later"),
    flag(graphId("assertion", "a2-v2", [U1]), "later"),
    flag("ref-1", "later"),
    flag("a1", "later") // a bare local ID is not what this mapper produces, so it names no item and stays in scope
  ] });
  const result = scope({ review: later, previousReview: earlier, extraction: story(items), targetOf: graphId });
  assert.deepEqual(explanations(result), {
    "assertion:u1:a1": "earlier verdict on assertion:u1:a1.",
    "assertion:u2:a3": "later verdict on assertion:u2:a3.",
    "assertion:u1:a2-v2": "later verdict on assertion:u1:a2-v2.",
    "ref-1": "later verdict on ref-1.",
    a1: "later verdict on a1."
  });
  assert.deepEqual(result.scope, { carried: 1, changed: 1, removed: 0, earlier_findings: 1 });
  assert.equal(result.review.status, "repair_required");
});

test("scopeReviewAfterRepair: bound graph IDs from journalLocalNodeId scope the fidelity review the same way", () => {
  const bound = (kind, localId, unitId) => journalLocalNodeId({ caseId: "case-1", corpusId: "corpus-1", generation: "gen-1",
    localIdNamespace: unitId, kind, localId });
  const targetOf = (kind, localId, unitIds) => bound(kind, localId, unitIds[0] ?? "");
  const items = renamed(edited(storyItems(), "entities", "e-lamp", { label: "the lamp on the point" }), "assertions", "a2", "a2-v2");
  const earlier = review({ role: "fidelity_auditor", assessments: [
    flag(bound("assertion", "a2", U1), "earlier"),
    ok(bound("assertion", "a1", U1), "earlier"),
    ok(bound("entity", "e-keeper", U2), "earlier")
  ] });
  const later = review({ role: "fidelity_auditor", assessments: [
    flag(bound("assertion", "a2-v2", U1), "later"),
    flag(bound("assertion", "a1", U1), "later"),
    flag(bound("entity", "e-lamp", U1), "later"),
    flag(bound("entity", "e-keeper", U2), "later"),
    flag("ref-1", "later"),
    flag("u2", "later")
  ] });
  const result = scope({ review: later, previousReview: earlier, extraction: story(items), targetOf });
  assert.deepEqual(explanations(result), {
    [bound("assertion", "a2-v2", U1)]: `later verdict on ${bound("assertion", "a2-v2", U1)}.`,
    [bound("assertion", "a1", U1)]: `earlier verdict on ${bound("assertion", "a1", U1)}.`,
    [bound("entity", "e-lamp", U1)]: `later verdict on ${bound("entity", "e-lamp", U1)}.`,
    [bound("entity", "e-keeper", U2)]: `earlier verdict on ${bound("entity", "e-keeper", U2)}.`,
    "ref-1": "later verdict on ref-1."
  });
  // e-lamp changed, and so did a2-v2 and a3, which name it as their subject.
  assert.deepEqual(result.scope, { carried: 3, changed: 3, removed: 0, earlier_findings: 1 });
  assert.equal(result.review.status, "repair_required");
});

test("scopeReviewAfterRepair: leaves its inputs untouched", () => {
  const repaired = story(edited(storyItems(), "assertions", "a3", { statement: "The keeper said the lamp would be lit by night." }));
  const inputs = { review: review({ assessments: [flag("a1", "later"), flag("a3", "later")], unassessed: ["a2"],
    repairs: [repairFor("a1")] }), previousReview: earlierClean(), previousExtraction: story(), extraction: repaired,
  unitIds: [U1, U2] };
  const snapshot = structuredClone(inputs);
  scopeReviewAfterRepair(deepFreeze(inputs));
  assert.deepEqual(inputs, snapshot);
});

// ---------------------------------------------------------------------------------------------------------
// withholdFlaggedItems
// ---------------------------------------------------------------------------------------------------------

const withhold = ({ source = oneUnitStory(), unitIds = [U1], reviews }) => {
  const result = withholdFlaggedItems({ extraction: source, reviews, unitIds });
  if (result) validateExtractionReferences(result.extraction, unitIds);
  return result;
};
const reviewOf = (...assessments) => ({ review: review({ assessments }) });
const coverageOf = (result, unitId) => result.extraction.coverage.find((item) => item.unit_id === unitId);
const unitCounts = (result) => Object.fromEntries(result.residualsByUnit);
const byKey = (items) => [...items].sort((left, right) => `${left.kind}:${left.localId}`.localeCompare(`${right.kind}:${right.localId}`));
// The reason a unit gets is fixed text with two counts in it: assertions withheld, then possible omissions.
const COUNTS_ONLY = /flagged (\d+) assertion\(s\).*found (\d+) possible omission\(s\)/u;

test("withholdFlaggedItems: withholds a flagged assertion and keeps the rest of the extraction", () => {
  const source = oneUnitStory();
  const result = withhold({ source, reviews: [reviewOf(ok("a1", "later"), flag("a2", "later"))] });
  assert.deepEqual(ids(result.extraction.assertions), ["a1", "a3", "a4"]);
  assert.deepEqual(result.extraction.assertions, source.assertions.filter((item) => item.local_id !== "a2"),
    "kept assertions are untouched");
  assert.deepEqual(result.extraction.entities, source.entities);
  assert.deepEqual(result.extraction.episodes, source.episodes);
  assert.equal(result.extraction.status, "complete");
  assert.deepEqual(result.withheldItems, [{ kind: "assertion", localId: "a2", unitIds: [U1] }]);
  assert.deepEqual(result.residuals, { withheld_assertions: 1, withheld_dependent: 0, withheld_entities: 0,
    withheld_episodes: 0, omission_gaps: 0, unassessed: 0 });
});

test("withholdFlaggedItems: any finding withholds, and so does an unassessed ID", () => {
  const findings = review({ assessments: [verdict("a1", "distorted", "wrong_time"), verdict("a2", "preserved", "lost_qualifier"),
    verdict("a3", "unassessed", "none"), ok("a4", "later")] });
  const result = withhold({ reviews: [{ review: findings }] });
  assert.deepEqual(ids(result.extraction.assertions), ["a4"]);
  const unassessed = withhold({ reviews: [{ review: review({ assessments: [ok("a1", "later")], unassessed: ["a3"], status: "incomplete" }) }] });
  assert.deepEqual(ids(unassessed.extraction.assertions), ["a1", "a2", "a4"]);
  assert.equal(unassessed.residuals.unassessed, 1);
});

test("withholdFlaggedItems: an item the review still asks to repair is withheld even when its verdict reads preserved", () => {
  const result = withhold({ reviews: [{ review: review({ assessments: [ok("a2", "later")], repairs: [repairFor("a2")] }) }] });
  assert.deepEqual(ids(result.extraction.assertions), ["a1", "a3", "a4"]);
  assert.deepEqual(result.withheldItems.map((item) => item.localId), ["a2"]);
});

test("withholdFlaggedItems: a flagged speaker entity withholds the assertions it speaks and is dropped", () => {
  const source = oneUnitStory();
  const result = withhold({ source, reviews: [reviewOf(flag("e-keeper", "later"))] });
  assert.deepEqual(ids(result.extraction.assertions), ["a1", "a2", "a4"]);
  assert.deepEqual(ids(result.extraction.entities), ["e-maren", "e-lamp", "e-boat", "e-dock"]);
  assert.deepEqual(byKey(result.withheldItems), [{ kind: "assertion", localId: "a3", unitIds: [U1] },
    { kind: "entity", localId: "e-keeper", unitIds: [U1] }]);
  assert.deepEqual(result.residuals, { withheld_assertions: 1, withheld_dependent: 1, withheld_entities: 1,
    withheld_episodes: 0, omission_gaps: 0, unassessed: 0 });
});

test("withholdFlaggedItems: a flagged subject entity withholds every assertion about it and is dropped", () => {
  const single = withhold({ reviews: [reviewOf(flag("e-boat", "later"))] });
  assert.deepEqual(ids(single.extraction.assertions), ["a1", "a2", "a3"]);
  assert.deepEqual(ids(single.extraction.entities), ["e-maren", "e-lamp", "e-keeper", "e-dock"]);
  const shared = withhold({ reviews: [reviewOf(flag("e-lamp", "later"))] });
  assert.deepEqual(ids(shared.extraction.assertions), ["a1", "a4"], "a2 and a3 both have the lamp as a subject");
  assert.deepEqual(shared.residuals, { withheld_assertions: 2, withheld_dependent: 2, withheld_entities: 1,
    withheld_episodes: 0, omission_gaps: 0, unassessed: 0 });
});

test("withholdFlaggedItems: an entity left with no assertions is kept when nothing flagged it", () => {
  const result = withhold({ reviews: [reviewOf(flag("a4", "later"))] });
  assert.ok(ids(result.extraction.entities).includes("e-boat"));
  assert.ok(ids(result.extraction.episodes).includes("ep-ferry"));
});

test("withholdFlaggedItems: a flagged episode withholds the assertions in it and is dropped", () => {
  const result = withhold({ reviews: [reviewOf(flag("ep-walk", "later"))] });
  assert.deepEqual(ids(result.extraction.assertions), ["a3", "a4"]);
  assert.deepEqual(ids(result.extraction.episodes), ["ep-ferry", "ep-storm"]);
  assert.deepEqual(byKey(result.withheldItems), [{ kind: "assertion", localId: "a1", unitIds: [U1] },
    { kind: "assertion", localId: "a2", unitIds: [U1] }, { kind: "episode", localId: "ep-walk", unitIds: [U1] }]);
  assert.deepEqual(result.residuals, { withheld_assertions: 2, withheld_dependent: 2, withheld_entities: 0,
    withheld_episodes: 1, omission_gaps: 0, unassessed: 0 });
});

test("withholdFlaggedItems: an assertion that is flagged and also depends on a flagged entity counts once", () => {
  const result = withhold({ reviews: [reviewOf(flag("a2", "later"), flag("e-lamp", "later"))] });
  assert.deepEqual(ids(result.extraction.assertions), ["a1", "a4"]);
  assert.deepEqual(result.residuals, { withheld_assertions: 2, withheld_dependent: 1, withheld_entities: 1,
    withheld_episodes: 0, omission_gaps: 0, unassessed: 0 });
  assert.equal(result.withheldItems.filter((item) => item.localId === "a2").length, 1);
});

test("withholdFlaggedItems: time evidence that pointed at a withheld item now points at its unit ID", () => {
  const items = edited(edited(edited(storyItems(), "assertions", "a4", { event_time: unknownTime(["a2", "a3"]) }),
    "episodes", "ep-ferry", { authored_time: unknownTime(["a2", "u1"]) }),
  "assertions", "a1", { event_time: unknownTime(["ep-storm"]) });
  const source = story(items);
  const result = withhold({ source, unitIds: [U1, U2], reviews: [reviewOf(flag("a2", "later"), flag("ep-storm", "later"))] });
  const kept = (id) => result.extraction.assertions.find((item) => item.local_id === id);
  assert.deepEqual(kept("a4").event_time.evidence_ids, ["u1", "a3"], "a2 became its unit; a3 was kept, so it stays");
  assert.deepEqual(result.extraction.episodes.find((item) => item.local_id === "ep-ferry").authored_time.evidence_ids, ["u1"],
    "an ID that now duplicates the unit ID collapses into it");
  assert.deepEqual(kept("a1").event_time.evidence_ids, ["u2"], "the withheld episode's own unit, not the holder's");
  assert.deepEqual(kept("a4").authored_time, source.assertions[3].authored_time, "other time fields are untouched");
});

test("withholdFlaggedItems: time evidence pointing at a withheld entity is re-pointed too", () => {
  const items = edited(storyItems(), "assertions", "a1", { authored_time: unknownTime(["e-boat"]) });
  const result = withhold({ source: story(items), unitIds: [U1, U2], reviews: [reviewOf(flag("e-boat", "later"))] });
  assert.deepEqual(result.extraction.assertions.find((item) => item.local_id === "a1").authored_time.evidence_ids, ["u2"]);
  assert.ok(!result.extraction.assertions.some((item) => item.local_id === "a4"), "a4 is about the boat, so it went too");
});

test("withholdFlaggedItems: time evidence pointing at a withheld item that spans units points at one of its units", () => {
  const spanning = [anchor(U1, "first quote"), anchor(U2, "second quote")];
  const items = edited(edited(storyItems(), "assertions", "a1", { anchors: spanning }),
    "assertions", "a4", { event_time: unknownTime(["a1"]) });
  const result = withhold({ source: story(items), unitIds: [U1, U2], reviews: [reviewOf(flag("a1", "later"))] });
  const evidence = result.extraction.assertions.find((item) => item.local_id === "a4").event_time.evidence_ids;
  assert.equal(evidence.length, 1);
  assert.ok([U1, U2].includes(evidence[0]), `${evidence[0]} is neither of the withheld item's units`);
});

test("withholdFlaggedItems: a unit with something withheld becomes needs_review and lists only the kept assertions", () => {
  const source = oneUnitStory();
  const result = withhold({ source, reviews: [reviewOf(flag("a2", "later"))] });
  const coverage = coverageOf(result, U1);
  assert.equal(coverage.disposition, "needs_review");
  assert.deepEqual(coverage.assertion_local_ids, ["a1", "a3", "a4"]);
  const [, held, open] = COUNTS_ONLY.exec(coverage.reason);
  assert.deepEqual([held, open], ["1", "0"]);
  for (const item of source.assertions) {
    assert.ok(!coverage.reason.includes(item.statement), "the reason carries counts, never source or statement text");
  }
  assert.deepEqual(unitCounts(result), { u1: { withheld_assertions: 1, withheld_entities: 0, withheld_episodes: 0, omission_gaps: 0 } });
});

test("withholdFlaggedItems: a finding on the unit itself is a gap, and the unit becomes needs_review", () => {
  const source = story();
  const result = withhold({ source, unitIds: [U1, U2], reviews: [reviewOf(flag("u2", "later"))] });
  assert.deepEqual(ids(result.extraction.assertions), ids(source.assertions), "nothing is withheld for a gap");
  assert.deepEqual(coverageOf(result, U1), source.coverage[0]);
  const coverage = coverageOf(result, U2);
  assert.equal(coverage.disposition, "needs_review");
  assert.deepEqual(coverage.assertion_local_ids, ["a3", "a4"]);
  assert.deepEqual(COUNTS_ONLY.exec(coverage.reason).slice(1), ["0", "1"]);
  assert.equal(unitCounts(result).u2.omission_gaps, 1);
  assert.equal(result.residuals.omission_gaps, 1);
  assert.deepEqual(result.withheldItems, []);
});

test("withholdFlaggedItems: a unit that is both flagged and left unassessed is one gap and one unassessed ID", () => {
  const both = review({ assessments: [flag("u2", "later")], unassessed: ["u2"], status: "repair_required" });
  const result = withhold({ source: story(), unitIds: [U1, U2], reviews: [{ review: both }] });
  assert.equal(unitCounts(result).u2.omission_gaps, 1);
  assert.equal(result.residuals.omission_gaps, 1);
  assert.equal(result.residuals.unassessed, 1);
});

test("withholdFlaggedItems: a unit with nothing withheld and no gap keeps its coverage as it was", () => {
  const source = story(storyItems(), [U1, U2, U3]);
  const result = withhold({ source, unitIds: [U1, U2, U3], reviews: [reviewOf(flag("a2", "later"))] });
  assert.deepEqual(coverageOf(result, U2), source.coverage[1]);
  assert.deepEqual(coverageOf(result, U3), { unit_id: U3, disposition: "no_assertion", assertion_local_ids: [], reason: null });
  assert.equal(coverageOf(result, U1).disposition, "needs_review");
  assert.deepEqual(coverageOf(result, U1).assertion_local_ids, ["a1"]);
});

test("withholdFlaggedItems: counts the residuals per unit and in total", () => {
  const source = story(storyItems(), [U1, U2, U3]);
  const result = withhold({ source, unitIds: [U1, U2, U3], reviews: [{ review: review({
    assessments: [flag("a1", "later"), flag("e-boat", "later"), flag("ep-storm", "later"), ok("a3", "later")],
    unassessed: ["u2"], status: "incomplete" }) }] });
  assert.deepEqual(unitCounts(result), {
    u1: { withheld_assertions: 1, withheld_entities: 0, withheld_episodes: 0, omission_gaps: 0 },
    u2: { withheld_assertions: 1, withheld_entities: 1, withheld_episodes: 1, omission_gaps: 1 },
    u3: { withheld_assertions: 0, withheld_entities: 0, withheld_episodes: 0, omission_gaps: 0 }
  });
  assert.deepEqual(result.residuals, { withheld_assertions: 2, withheld_dependent: 1, withheld_entities: 1,
    withheld_episodes: 1, omission_gaps: 1, unassessed: 1 });
  assert.deepEqual(ids(result.extraction.assertions), ["a2", "a3"]);
  assert.deepEqual(coverageOf(result, U1).assertion_local_ids, ["a2"]);
  assert.deepEqual(COUNTS_ONLY.exec(coverageOf(result, U1).reason).slice(1), ["1", "0"]);
  assert.deepEqual(coverageOf(result, U2).assertion_local_ids, ["a3"]);
  assert.deepEqual(COUNTS_ONLY.exec(coverageOf(result, U2).reason).slice(1), ["1", "1"]);
  assert.equal(coverageOf(result, U3).disposition, "no_assertion");
});

test("withholdFlaggedItems: lists each withheld item with every unit it is anchored in", () => {
  const spanning = [anchor(U1, "first quote"), anchor(U2, "second quote")];
  const items = edited(storyItems(), "assertions", "a1", { anchors: spanning });
  const result = withhold({ source: story(items), unitIds: [U1, U2], reviews: [reviewOf(flag("a1", "later"))] });
  assert.deepEqual(result.withheldItems, [{ kind: "assertion", localId: "a1", unitIds: [U1, U2] }]);
  assert.equal(unitCounts(result).u1.withheld_assertions, 1, "it counts in every unit it is anchored in");
  assert.equal(unitCounts(result).u2.withheld_assertions, 1);
  assert.equal(result.residuals.withheld_assertions, 1, "the batch total counts it once");
});

test("withholdFlaggedItems: every unit that listed a withheld assertion is marked needs_review, not only its first anchor's", () => {
  const items = storyItems();
  const spanning = { ...assertion("a-span", U1, "The lamp stayed dark from dusk to dawn.", { subjects: ["e-lamp"] }),
    anchors: [anchor(U1, "first quote"), anchor(U2, "second quote")] };
  const result = withhold({ source: story({ ...items, assertions: [items.assertions[0], spanning] }), unitIds: [U1, U2],
    reviews: [reviewOf(flag("a-span", "later"))] });
  assert.deepEqual(coverageOf(result, U2).assertion_local_ids, []);
  assert.equal(coverageOf(result, U2).disposition, "needs_review");
});

test("withholdFlaggedItems: an unplaceable target is a gap on the unit when the batch has one unit", () => {
  const source = oneUnitStory();
  const result = withhold({ source, reviews: [reviewOf(flag("ref-1", "later"))] });
  assert.deepEqual(result.extraction.assertions, source.assertions);
  const coverage = coverageOf(result, U1);
  assert.equal(coverage.disposition, "needs_review");
  assert.deepEqual(COUNTS_ONLY.exec(coverage.reason).slice(1), ["0", "1"]);
  assert.equal(unitCounts(result).u1.omission_gaps, 1);
  assert.equal(result.residuals.omission_gaps, 1);
});

test("withholdFlaggedItems: with several units an unplaceable target is only counted, not given to a unit", () => {
  const source = story();
  const result = withhold({ source, unitIds: [U1, U2], reviews: [reviewOf(flag("ref-1", "later"))] });
  assert.deepEqual(result.extraction.coverage, source.coverage);
  assert.deepEqual(unitCounts(result).u1.omission_gaps + unitCounts(result).u2.omission_gaps, 0);
  assert.equal(result.residuals.omission_gaps, 1);
});

test("withholdFlaggedItems: reads each review with its own targetOf, so graph IDs and local IDs mix in one call", () => {
  const graphId = (kind, localId, unitIds) => `${kind}:${unitIds[0]}:${localId}`;
  const omission = { review: review({ assessments: [flag("a1", "later"), flag("a3", "later")] }) };
  const fidelity = { review: review({ role: "fidelity_auditor", assessments: [
    flag(graphId("assertion", "a3", [U1]), "later"),
    flag(graphId("entity", "e-boat", [U1]), "later"),
    flag("ref-1", "later"),
    flag("a2", "later")
  ] }), targetOf: graphId };
  const result = withhold({ reviews: [omission, fidelity] });
  assert.deepEqual(ids(result.extraction.assertions), ["a2"],
    "a1 and a3 were flagged and a4 is about the flagged boat; the fidelity review's bare a2 is not one of its graph IDs");
  assert.ok(result.withheldItems.some((item) => item.kind === "entity" && item.localId === "e-boat"));
  assert.deepEqual(result.residuals, { withheld_assertions: 3, withheld_dependent: 1, withheld_entities: 1,
    withheld_episodes: 0, omission_gaps: 2, unassessed: 0 });
});

test("withholdFlaggedItems: an item flagged by two reviews is withheld once", () => {
  const graphId = (kind, localId, unitIds) => `${kind}:${unitIds[0]}:${localId}`;
  const result = withhold({ reviews: [reviewOf(flag("a2", "later")),
    { review: review({ assessments: [flag(graphId("assertion", "a2", [U1]), "later")] }), targetOf: graphId }] });
  assert.deepEqual(ids(result.extraction.assertions), ["a1", "a3", "a4"]);
  assert.equal(result.residuals.withheld_assertions, 1);
  assert.equal(result.withheldItems.length, 1);
});

test("withholdFlaggedItems: sums the unassessed IDs of every review", () => {
  const first = { review: review({ assessments: [], unassessed: ["a1", "a2"], status: "incomplete" }) };
  const second = { review: review({ assessments: [], unassessed: ["a2"], status: "incomplete" }) };
  const result = withhold({ reviews: [first, second] });
  assert.equal(result.residuals.unassessed, 3);
  assert.deepEqual(ids(result.extraction.assertions), ["a3", "a4"]);
});

test("withholdFlaggedItems: returns null for an extraction that is not complete", () => {
  for (const status of ["incomplete", "needs_context"]) {
    const source = extraction({ ...storyItems(U1), unitIds: [U1], status });
    assert.equal(withholdFlaggedItems({ extraction: source, unitIds: [U1], reviews: [reviewOf(flag("a1", "later"))] }), null, status);
  }
  assert.equal(withholdFlaggedItems({ extraction: null, unitIds: [U1], reviews: [] }), null);
});

test("withholdFlaggedItems: returns null for an incomplete review that names no unassessed ID", () => {
  const vague = review({ assessments: [ok("a1", "later")], status: "incomplete" });
  assert.equal(withholdFlaggedItems({ extraction: oneUnitStory(), unitIds: [U1], reviews: [{ review: vague }] }), null);
  assert.equal(withholdFlaggedItems({ extraction: oneUnitStory(), unitIds: [U1],
    reviews: [reviewOf(flag("a1", "later")), { review: vague }] }), null, "any review in the call can make it null");
  const named = review({ assessments: [ok("a1", "later")], unassessed: ["a2"], status: "incomplete" });
  assert.deepEqual(ids(withhold({ reviews: [{ review: named }] }).extraction.assertions), ["a1", "a3", "a4"]);
});

test("withholdFlaggedItems: skips an absent review and withholds nothing when nothing is flagged", () => {
  const source = oneUnitStory();
  for (const reviews of [[], [{ review: null }], [{ review: earlierClean() }]]) {
    const result = withhold({ source, reviews });
    assert.deepEqual(result.extraction, source);
    assert.deepEqual(result.withheldItems, []);
    assert.deepEqual(result.residuals, { withheld_assertions: 0, withheld_dependent: 0, withheld_entities: 0,
      withheld_episodes: 0, omission_gaps: 0, unassessed: 0 });
    assert.equal(unitCounts(result).u1.withheld_assertions, 0);
  }
});

test("withholdFlaggedItems: the withheld extraction keeps every reference intact", () => {
  const source = story();
  const everything = reviewOf(flag("a1", "later"), flag("e-keeper", "later"), flag("ep-ferry", "later"), flag("u1", "later"));
  const result = withhold({ source, unitIds: [U1, U2], reviews: [everything] });
  assert.deepEqual(ids(result.extraction.assertions), ["a2"]);
  validateExtractionReferences(result.extraction, [U1, U2]);
});

test("withholdFlaggedItems: leaves its inputs untouched", () => {
  const inputs = { extraction: story(), unitIds: [U1, U2],
    reviews: [reviewOf(flag("a2", "later"), flag("e-keeper", "later")), { review: null }] };
  const snapshot = structuredClone(inputs);
  withholdFlaggedItems(deepFreeze(inputs));
  assert.deepEqual(inputs, snapshot);
});

// ---------------------------------------------------------------------------------------------------------
// Reference fixtures for the fidelity audit, the score and the calibration counts
// ---------------------------------------------------------------------------------------------------------

const referenceItem = (id, critical = false) => ({ id, statement: `The source says ${id}.`, required_qualifiers: [],
  anchors: [anchor(U1, `source phrase for ${id}`)], importance_reason: "Invented for the test.", critical });
const referenceResult = (total, criticalIds = []) => validateJournalSchema("reference-result", {
  schema_version: "1.0", source_only_first_pass: true,
  reference_items: Array.from({ length: total }, (_, index) => referenceItem(`ref-${index + 1}`, criticalIds.includes(`ref-${index + 1}`))),
  questions: [], unassessed_unit_ids: [] });
const OUTCOMES = {
  omitted: ["omitted", "missing_evidence"],
  distorted: ["distorted", "wrong_time"],
  lost_qualifier: ["distorted", "lost_qualifier"]
};
// Scores `total` reference items against a fidelity review; `outcomes` maps a reference ID to how it fared
// ("omitted", "distorted", "lost_qualifier", "unassessed"), and every other item is preserved.
const scored = ({ total, critical = [], outcomes = {} }) => {
  const reference = referenceResult(total, critical);
  const assessments = reference.reference_items.filter((item) => outcomes[item.id] !== "unassessed").map((item) => {
    const [outcome, findingType] = OUTCOMES[outcomes[item.id]] ?? ["preserved", "none"];
    return verdict(item.id, outcome, findingType, { critical: item.critical });
  });
  return scoreReferenceReview({ referenceResult: reference, candidateIds: [],
    reviewResult: review({ role: "fidelity_auditor", assessments }) });
};

test("the reference recall target these fixtures are built around is 0.95", () => {
  assert.equal(TARGET, 0.95);
});

// ---------------------------------------------------------------------------------------------------------
// reviewAfterWithholding
// ---------------------------------------------------------------------------------------------------------

const candidate = (id) => `assertion:${id}`;
const LAMP = "entity:e-lamp"; // a withheld entity's bound ID: withheld like a candidate, but never one itself
const fidelityAudit = () => review({ role: "fidelity_auditor", status: "repair_required",
  assessments: [
    verdict(candidate("a1"), "preserved", "none", { evidenceIds: [candidate("a2")], explanation: "Says the same as a2." }),
    flag(candidate("a2"), "later"),
    verdict(candidate("a3"), "distorted", "wrong_time"),
    ok(LAMP, "later"),
    verdict("ref-1", "preserved", "none", { critical: true, evidenceIds: [candidate("a2")], explanation: "Carried by a2." }),
    verdict("ref-2", "preserved", "none", { evidenceIds: [candidate("a1"), candidate("a2")] }),
    verdict("ref-3", "preserved", "none", { evidenceIds: [] }),
    verdict("ref-4", "preserved", "none", { evidenceIds: ["passage:p1"] }),
    verdict("ref-5", "omitted", "missing_evidence", { evidenceIds: [candidate("a2")] }),
    verdict("ref-6", "preserved", "none", { evidenceIds: [LAMP] })
  ],
  unassessed: [candidate("a2"), "ref-9"],
  repairs: [repairFor(candidate("a2")), repairFor("ref-9")] });
const CANDIDATES = new Set(["a1", "a2", "a3"].map(candidate));
const WITHHELD = new Set([candidate("a2"), LAMP]);

test("reviewAfterWithholding: a reference item preserved only through withheld candidates becomes omitted", () => {
  const result = reviewAfterWithholding({ review: fidelityAudit(), withheldTargets: WITHHELD, candidateTargets: CANDIDATES });
  validateJournalSchema("review-result", result);
  const converted = result.assessments.find((item) => item.target_id === "ref-1");
  assert.equal(converted.outcome, "omitted");
  assert.equal(converted.finding_type, "missing_evidence");
  assert.equal(converted.critical, true, "it stays critical, so it scores as a critical miss");
  assert.deepEqual(converted.evidence_ids, [candidate("a2")]);
  assert.notEqual(converted.explanation, "Carried by a2.");
  assert.ok(converted.explanation.length > 0);
  assert.equal(result.target_generation, "gen-1");
  assert.equal(result.review_role, "fidelity_auditor");
});

test("reviewAfterWithholding: a reference item keeps its verdict with other kept support, no candidate evidence, or no preserved verdict", () => {
  const original = fidelityAudit();
  const result = reviewAfterWithholding({ review: original, withheldTargets: WITHHELD, candidateTargets: CANDIDATES });
  // ref-2 keeps a1 as support; ref-3 and ref-4 cite no candidate; ref-5 was already omitted; ref-6 cites only a withheld
  // entity, which is not a candidate, so nothing withheld can be shown to have carried it.
  for (const id of ["ref-2", "ref-3", "ref-4", "ref-5", "ref-6"]) {
    assert.deepEqual(result.assessments.find((item) => item.target_id === id), original.assessments.find((item) => item.target_id === id), id);
  }
});

test("reviewAfterWithholding: withheld candidate assessments, unassessed IDs and proposed repairs leave the review", () => {
  const result = reviewAfterWithholding({ review: fidelityAudit(), withheldTargets: WITHHELD, candidateTargets: CANDIDATES });
  assert.ok(!result.assessments.some((item) => item.target_id === candidate("a2")));
  assert.deepEqual(result.unassessed_ids, ["ref-9"]);
  assert.deepEqual(result.proposed_repairs.map((item) => item.target_id), ["ref-9"]);
  assert.deepEqual(result.assessments.map((item) => item.target_id).sort(),
    [candidate("a1"), candidate("a3"), "ref-1", "ref-2", "ref-3", "ref-4", "ref-5", "ref-6"].sort(),
    "the withheld assertion's and the withheld entity's own assessments are gone");
  assert.deepEqual(result.assessments.filter((item) => CANDIDATES.has(item.target_id)), fidelityAudit().assessments.filter((item) =>
    [candidate("a1"), candidate("a3")].includes(item.target_id)),
  "kept candidate verdicts are unchanged, even a1's, which cites the withheld a2");
});

test("reviewAfterWithholding: withholding turns a counted preservation into a critical miss in the score", () => {
  const reference = referenceResult(3, ["ref-1"]);
  const audit = review({ role: "fidelity_auditor", assessments: [
    ok(candidate("a1"), "later"),
    ok(candidate("a2"), "later"),
    verdict("ref-1", "preserved", "none", { critical: true, evidenceIds: [candidate("a2")] }),
    verdict("ref-2", "preserved", "none", { evidenceIds: [candidate("a1")] }),
    verdict("ref-3", "preserved", "none", { evidenceIds: [candidate("a1"), candidate("a2")] })
  ] });
  const before = scoreReferenceReview({ referenceResult: reference, reviewResult: audit,
    candidateIds: [candidate("a1"), candidate("a2")] });
  assert.equal(before.critical_miss_count, 0);
  const after = reviewAfterWithholding({ review: audit, withheldTargets: new Set([candidate("a2")]),
    candidateTargets: new Set([candidate("a1"), candidate("a2")]) });
  const rescored = scoreReferenceReview({ referenceResult: reference, reviewResult: after, candidateIds: [candidate("a1")] });
  assert.deepEqual(rescored.reference_counts, { preserved: 2, omitted: 1, distorted: 0, unassessed: 0 });
  assert.equal(rescored.critical_miss_count, 1);
});

test("reviewAfterWithholding: the status follows what is left", () => {
  const withheld = new Set([candidate("a2")]);
  const candidates = new Set([candidate("a1"), candidate("a2")]);
  const call = (value) => reviewAfterWithholding({ review: value, withheldTargets: withheld, candidateTargets: candidates });
  const onlyWithheld = review({ role: "fidelity_auditor", assessments: [ok(candidate("a1"), "later"), flag(candidate("a2"), "later")] });
  assert.equal(onlyWithheld.status, "repair_required");
  assert.equal(call(onlyWithheld).status, "sufficient_for_stated_scope", "the only finding was on a withheld candidate");
  const converted = review({ role: "fidelity_auditor", assessments: [
    verdict("ref-1", "preserved", "none", { evidenceIds: [candidate("a2")] })] });
  assert.equal(converted.status, "sufficient_for_stated_scope");
  assert.equal(call(converted).status, "repair_required", "the converted reference item is now a finding");
  const stillUnassessed = review({ role: "fidelity_auditor", assessments: [], unassessed: [candidate("a2"), "ref-9"], status: "incomplete" });
  assert.equal(call(stillUnassessed).status, "incomplete");
  const nowComplete = review({ role: "fidelity_auditor", assessments: [], unassessed: [candidate("a2")], status: "incomplete" });
  assert.equal(call(nowComplete).status, "sufficient_for_stated_scope", "the only unassessed ID was withheld");
  assert.equal(call(review({ role: "fidelity_auditor", assessments: [flag("ref-1", "later")], unassessed: [candidate("a2")],
    status: "incomplete" })).status, "repair_required");
  const unassessedLeft = review({ role: "fidelity_auditor", assessments: [ok(candidate("a1"), "later")], unassessed: ["ref-9"],
    status: "repair_required" });
  assert.equal(call(unassessedLeft).status, "repair_required", "an unassessed ID that is left keeps the review open");
});

test("reviewAfterWithholding: with nothing withheld the review comes back as it was", () => {
  const original = fidelityAudit();
  const result = reviewAfterWithholding({ review: original, withheldTargets: new Set(), candidateTargets: CANDIDATES });
  assert.deepEqual(result.assessments, original.assessments);
  assert.deepEqual(result.unassessed_ids, original.unassessed_ids);
  assert.deepEqual(result.proposed_repairs, original.proposed_repairs);
});

test("reviewAfterWithholding: leaves its inputs untouched", () => {
  const inputs = { review: fidelityAudit(), withheldTargets: new Set(WITHHELD), candidateTargets: new Set(CANDIDATES) };
  const snapshot = structuredClone(inputs.review);
  reviewAfterWithholding(deepFreeze(inputs));
  assert.deepEqual(inputs.review, snapshot);
});

// ---------------------------------------------------------------------------------------------------------
// referenceScorePasses, calibrationScoreCounts, sourceOnlyCalibrationCounts
// ---------------------------------------------------------------------------------------------------------

test("referenceScorePasses: passes when every reference item is preserved", () => {
  assert.equal(referenceScorePasses(scored({ total: 20 })), true);
});

test("referenceScorePasses: passes with recall exactly at the target and one ordinary loss inside the allowance", () => {
  for (const loss of ["omitted", "distorted"]) {
    const score = scored({ total: 20, outcomes: { "ref-20": loss } });
    assert.equal(score.reference_recall, TARGET, "the fixture sits exactly on the target");
    assert.equal(referenceScorePasses(score), true, loss);
  }
});

test("referenceScorePasses: fails when recall is below the target", () => {
  const score = scored({ total: 20, outcomes: { "ref-19": "omitted", "ref-20": "omitted" } });
  assert.ok(score.reference_recall < TARGET);
  assert.equal(referenceScorePasses(score), false);
});

test("referenceScorePasses: fails on a critical miss even when recall meets the target", () => {
  const score = scored({ total: 20, critical: ["ref-20"], outcomes: { "ref-20": "omitted" } });
  assert.equal(score.reference_recall, TARGET);
  assert.equal(score.critical_miss_count, 1);
  assert.equal(referenceScorePasses(score), false);
});

test("referenceScorePasses: fails on a lost qualifier even when recall meets the target", () => {
  const score = scored({ total: 20, outcomes: { "ref-20": "lost_qualifier" } });
  assert.equal(score.reference_recall, TARGET);
  assert.equal(score.qualifier_error_count, 1);
  assert.equal(referenceScorePasses(score), false);
});

test("referenceScorePasses: fails when a reference item was left unassessed, even at the target", () => {
  const score = scored({ total: 20, outcomes: { "ref-20": "unassessed" } });
  assert.equal(score.reference_recall, TARGET);
  assert.equal(score.reference_counts.unassessed, 1);
  assert.equal(referenceScorePasses(score), false);
});

test("referenceScorePasses: passes when the reference has no items, though the scorer reports the target as not met", () => {
  const score = scored({ total: 0 });
  assert.equal(score.provisional_target_met, false);
  assert.equal(referenceScorePasses(score), true);
});

test("referenceScorePasses: reads the four conditions off a hand-built score", () => {
  const passing = { reference_total: 20, reference_counts: { preserved: 19, omitted: 1, distorted: 0, unassessed: 0 },
    critical_miss_count: 0, qualifier_error_count: 0, provisional_target_met: true };
  assert.equal(referenceScorePasses(passing), true);
  assert.equal(referenceScorePasses({ ...passing, critical_miss_count: 1 }), false);
  assert.equal(referenceScorePasses({ ...passing, qualifier_error_count: 1 }), false);
  assert.equal(referenceScorePasses({ ...passing, reference_counts: { ...passing.reference_counts, unassessed: 1 } }), false);
  assert.equal(referenceScorePasses({ ...passing, provisional_target_met: false }), false);
  assert.equal(referenceScorePasses({ ...passing, reference_total: 0, provisional_target_met: false }), true);
});

const COUNT_KEYS = ["critical_miss_count", "distorted", "omitted", "preserved", "qualifier_error_count", "reference_total", "unassessed"];

test("calibrationScoreCounts: keeps totals and outcomes only", () => {
  const score = scored({ total: 20, critical: ["ref-1", "ref-2"], outcomes: { "ref-1": "omitted", "ref-2": "distorted",
    "ref-3": "omitted", "ref-4": "lost_qualifier", "ref-5": "unassessed", "ref-6": "omitted" } });
  const counts = calibrationScoreCounts(score);
  assert.deepEqual(counts, { reference_total: 20, preserved: 14, omitted: 3, distorted: 2, unassessed: 1,
    critical_miss_count: 2, qualifier_error_count: 1 });
  assert.deepEqual(Object.keys(counts).sort(), COUNT_KEYS, "no recall ratio, candidate figure or item text comes along");
});

test("sourceOnlyCalibrationCounts: every reference item counts omitted and each critical one a critical miss", () => {
  const counts = sourceOnlyCalibrationCounts(referenceResult(5, ["ref-2", "ref-4"]));
  assert.deepEqual(counts, { reference_total: 5, preserved: 0, omitted: 5, distorted: 0, unassessed: 0,
    critical_miss_count: 2, qualifier_error_count: 0 });
  assert.deepEqual(Object.keys(counts).sort(), COUNT_KEYS, "the same keys as a scored batch");
  assert.equal(sourceOnlyCalibrationCounts(referenceResult(3)).critical_miss_count, 0);
  assert.deepEqual(sourceOnlyCalibrationCounts(referenceResult(0)), { reference_total: 0, preserved: 0, omitted: 0,
    distorted: 0, unassessed: 0, critical_miss_count: 0, qualifier_error_count: 0 });
});

// ---------------------------------------------------------------------------------------------------------
// pooledCalibration
// ---------------------------------------------------------------------------------------------------------

const batch = (total, preserved, rest = {}) => ({ reference_total: total, preserved, omitted: total - preserved, distorted: 0,
  unassessed: 0, critical_miss_count: 0, qualifier_error_count: 0, ...rest });

test("pooledCalibration: passes with pooled recall exactly at the target", () => {
  const result = pooledCalibration([batch(10, 10), batch(10, 9)], TARGET);
  assert.equal(result.preserved / result.reference_total, TARGET);
  assert.equal(result.recall_target_met, true);
  assert.equal(result.calibration_pass, true);
  assert.equal(result.scored_batches, 2);
});

test("pooledCalibration: fails with pooled recall below the target", () => {
  const result = pooledCalibration([batch(10, 10), batch(10, 8)], TARGET);
  assert.equal(result.recall_target_met, false);
  assert.equal(result.calibration_pass, false);
});

test("pooledCalibration: pools the counts across batches instead of averaging each batch's recall", () => {
  const result = pooledCalibration([batch(19, 19), batch(1, 0)], TARGET);
  assert.equal(result.reference_total, 20);
  assert.equal(result.recall_target_met, true, "19 of 20 pooled, though one batch kept nothing");
  assert.equal(result.calibration_pass, true);
  assert.equal(pooledCalibration([batch(1, 0), batch(19, 19)], TARGET).calibration_pass, true, "the order of batches does not matter");
  assert.equal(pooledCalibration([batch(5, 5), batch(5, 0), batch(40, 40)], TARGET).recall_target_met, false, "45 of 50 pooled is 0.9");
});

test("pooledCalibration: passes vacuously when there are no reference items", () => {
  for (const counts of [[], [batch(0, 0)], [batch(0, 0), batch(0, 0)]]) {
    const result = pooledCalibration(counts, TARGET);
    assert.equal(result.reference_total, 0);
    assert.equal(result.recall_target_met, true);
    assert.equal(result.calibration_pass, true);
    assert.equal(result.scored_batches, counts.length);
  }
});

test("pooledCalibration: a single critical miss fails the gate however high recall is", () => {
  const result = pooledCalibration([batch(50, 49, { critical_miss_count: 1 }), batch(50, 50)], TARGET);
  assert.equal(result.recall_target_met, true);
  assert.equal(result.critical_miss_count, 1);
  assert.equal(result.calibration_pass, false);
});

test("pooledCalibration: lost qualifiers are reported but do not gate", () => {
  const result = pooledCalibration([batch(20, 20, { qualifier_error_count: 2 })], TARGET);
  assert.equal(result.qualifier_error_count, 2);
  assert.equal(result.calibration_pass, true);
});

test("pooledCalibration: reports every pooled count", () => {
  const result = pooledCalibration([
    batch(10, 7, { omitted: 1, distorted: 1, unassessed: 1, critical_miss_count: 1, qualifier_error_count: 1 }),
    batch(6, 6),
    batch(4, 2, { omitted: 1, distorted: 0, unassessed: 1, critical_miss_count: 2, qualifier_error_count: 2 })
  ], TARGET);
  assert.deepEqual(result, { scored_batches: 3, reference_total: 20, preserved: 15, omitted: 2, distorted: 1, unassessed: 2,
    critical_miss_count: 3, qualifier_error_count: 3, recall_target_met: false, calibration_pass: false });
});

test("pooledCalibration: a source-only failure pools as omitted items and fails on its critical ones", () => {
  const failed = sourceOnlyCalibrationCounts(referenceResult(5, ["ref-2"]));
  const result = pooledCalibration([calibrationScoreCounts(scored({ total: 95 })), failed], TARGET);
  assert.equal(result.preserved / result.reference_total, 0.95);
  assert.equal(result.recall_target_met, true);
  assert.equal(result.critical_miss_count, 1);
  assert.equal(result.calibration_pass, false);
});

test("pooledCalibration: judges recall against the target it is given", () => {
  const counts = [batch(10, 10), batch(10, 9)];
  assert.equal(pooledCalibration(counts, 1).calibration_pass, false);
  assert.equal(pooledCalibration(counts, 0.9).calibration_pass, true);
  assert.equal(pooledCalibration([batch(10, 9), batch(10, 9)], 0.9).calibration_pass, true, "90 percent meets a 0.9 target exactly");
});

test("pooledCalibration: leaves its inputs untouched", () => {
  const counts = [batch(10, 9, { critical_miss_count: 1 }), batch(10, 10)];
  const snapshot = structuredClone(counts);
  pooledCalibration(deepFreeze(counts), TARGET);
  assert.deepEqual(counts, snapshot);
});

test("withholdFlaggedItems: a flagged local ID shared by an assertion, an entity and an episode withholds all three", () => {
  // Local IDs need only be unique within one kind, so one finding can name items of every kind.
  const items = {
    entities: [entity("e-maren", U1, "Maren"), entity("x", U1, "the shed", "place")],
    episodes: [episode("x", U1, "the night of the gale")],
    assertions: [
      assertion("x", U1, "Maren slept in the shed.", { subjects: ["e-maren"] }),
      assertion("a-kept", U1, "Maren walked out to Pell Point before breakfast.", { subjects: ["e-maren"] })
    ]
  };
  const source = extraction({ ...items, unitIds: [U1] });
  const result = withholdFlaggedItems({ extraction: source, unitIds: [U1],
    reviews: [{ review: review({ assessments: [flag("x", "later")] }) }] });
  assert.deepEqual(ids(result.extraction.assertions), ["a-kept"]);
  assert.deepEqual(ids(result.extraction.entities), ["e-maren"]);
  assert.deepEqual(ids(result.extraction.episodes), []);
  assert.deepEqual(result.withheldItems.map((item) => item.kind).sort(), ["assertion", "entity", "episode"]);
  validateExtractionReferences(result.extraction, [U1]);
});

test("extractionItemChanges: an entity rewritten under its own ID changes the assertions that cite it", () => {
  // a3's own text is unchanged, but its speaker now names someone else, so a new finding on a3 must count.
  const repaired = story(edited(storyItems(), "entities", "e-keeper", { label: "the harbour master" }));
  const result = extractionItemChanges(story(), repaired);
  assert.equal(record(result, "entity", "e-keeper").changed, true);
  assert.equal(record(result, "assertion", "a3").changed, true, "a3's speaker changed");
  assert.equal(record(result, "assertion", "a4").changed, false, "a4 cites nothing that changed");
  const scoped = scope({ review: review({ assessments: [flag("a3", "later", "wrong_identity"), flag("a4", "later")] }),
    extraction: repaired });
  assert.equal(verdictOn(scoped, "a3").outcome, "omitted");
  assert.equal(verdictOn(scoped, "a4").outcome, "preserved", "a4's earlier verdict carries forward");
  assert.equal(scoped.review.status, "repair_required");
});

test("extractionItemChanges: an assertion whose time evidence names a changed or removed item counts as changed", () => {
  const items = storyItems();
  const before = story(edited(items, "assertions", "a4", { event_time: { ...items.assertions[3].event_time, evidence_ids: ["a3"] } }));
  const rewritten = story(edited(edited(items, "assertions", "a4", { event_time: { ...items.assertions[3].event_time,
    evidence_ids: ["a3"] } }), "assertions", "a3", { statement: "The keeper said the lamp would be lit by nine." }));
  const result = extractionItemChanges(before, rewritten);
  assert.equal(record(result, "assertion", "a3").changed, true);
  assert.equal(record(result, "assertion", "a4").changed, true, "a4's time came from a3");
  assert.equal(record(result, "assertion", "a1").changed, false);
});

test("scopeReviewAfterRepair: an earlier finding on an item stays open when the new review leaves the item out", () => {
  const earlier = review({ assessments: [flag("a2", "earlier"), ok("a1", "earlier")] });
  const later = review({ assessments: [ok("a1", "later")] }); // a2 unchanged and not mentioned
  const result = scope({ review: later, previousReview: earlier, extraction: story() });
  assert.equal(verdictOn(result, "a2").explanation, "earlier verdict on a2.");
  assert.equal(result.review.status, "repair_required");
});

test("scopeReviewAfterRepair: an earlier finding on a renamed item stays open under its new ID", () => {
  const earlier = review({ assessments: [flag("a2", "earlier")] });
  const result = scope({ review: review({ assessments: [] }), previousReview: earlier,
    extraction: story(renamed(storyItems(), "assertions", "a2", "a2-v2")) });
  assert.deepEqual(targetsIn(result), ["a2-v2"]);
  assert.equal(result.review.status, "repair_required");
});

test("scopeReviewAfterRepair: an earlier finding goes with an item the repair removed", () => {
  const earlier = review({ assessments: [flag("a2", "earlier")] });
  const result = scope({ review: review({ assessments: [] }), previousReview: earlier,
    extraction: story(without(storyItems(), "assertions", "a2")) });
  assert.equal(verdictOn(result, "a2"), undefined);
  assert.equal(result.review.status, "sufficient_for_stated_scope");
});

test("scopeReviewAfterRepair: an earlier unit-level omission closes when the repair adds content there, unless the review names the unit again", () => {
  const earlier = review({ assessments: [flag(U2, "earlier")] });
  const repaired = story(added(storyItems(), "assertions", assertion("a5", U2, "The ferry boat was late.", { subjects: ["e-boat"] })));
  const result = scope({ review: review({ assessments: [ok("a5", "later")] }), previousReview: earlier, extraction: repaired });
  assert.equal(verdictOn(result, U2), undefined);
  assert.equal(result.review.status, "sufficient_for_stated_scope");
});

test("scopeReviewAfterRepair: an earlier unassessed item stays unassessed until the review assesses it", () => {
  const earlier = review({ unassessed: ["a3"] });
  const result = scope({ review: review({ assessments: [ok("a1", "later")] }), previousReview: earlier, extraction: story() });
  assert.deepEqual(result.review.unassessed_ids, ["a3"]);
  assert.equal(result.review.status, "repair_required");
});

test("withholdFlaggedItems: a flagged entity with no dependent assertion still marks its unit needs_review", () => {
  const source = story();
  const result = withholdFlaggedItems({ extraction: source, unitIds: [U1, U2],
    reviews: [{ review: review({ assessments: [flag("e-dock", "later")] }) }] });
  assert.deepEqual(ids(result.extraction.assertions), ids(source.assertions));
  assert.equal(ids(result.extraction.entities).includes("e-dock"), false);
  const coverage = coverageOf(result, U2);
  assert.equal(coverage.disposition, "needs_review");
  assert.match(coverage.reason, /flagged 0 assertion\(s\) and 1 other item\(s\), which were withheld/u);
});

test("extractionItemChanges: a removed assertion that shares its ID with a kept entity leaves that entity's assertions unchanged", () => {
  const items = storyItems();
  const before = story(added(items, "assertions", assertion("e-lamp", U1, "The lamp at the point was lit by nine.",
    { subjects: ["e-maren"] })));
  const result = extractionItemChanges(before, story(items));
  assert.deepEqual(result.removed.map((item) => [item.kind, item.localId]), [["assertion", "e-lamp"]]);
  assert.equal(record(result, "assertion", "a2").changed, false, "a2's subject is the kept entity e-lamp");
  assert.equal(record(result, "assertion", "a3").changed, false);
});

test("withholdFlaggedItems: time evidence follows the graph's precedence when IDs repeat across kinds", () => {
  // The graph resolves a kindless evidence ID to an assertion first, then an episode, then an entity.
  const base = storyItems();
  const timed = (item, ids) => ({ ...item, event_time: { ...item.event_time, evidence_ids: ids } });
  const items = {
    entities: base.entities,
    episodes: [...base.episodes, episode("x", U2, "the ferry home")],
    assertions: [...base.assertions.slice(0, 3), timed(base.assertions[3], ["x"]),
      assertion("x", U1, "Maren walked out to Pell Point before breakfast.", { subjects: ["e-maren"] })]
  };
  // Episode x is flagged but assertion x is kept: "x" still means the kept assertion, so nothing moves.
  const episodeOnly = withholdFlaggedItems({ extraction: story(items), unitIds: [U1, U2],
    reviews: [{ review: review({ assessments: [flag("episode:x", "later")] }), targetOf: (kind, id) => `${kind}:${id}` }] });
  assert.deepEqual(ids(episodeOnly.extraction.episodes).includes("x"), false);
  assert.deepEqual(episodeOnly.extraction.assertions.find((item) => item.local_id === "a4").event_time.evidence_ids, ["x"]);
  // Both are withheld: "x" pointed at the assertion, so it moves to the assertion's unit.
  const both = withholdFlaggedItems({ extraction: story(items), unitIds: [U1, U2],
    reviews: [{ review: review({ assessments: [flag("x", "later")] }) }] });
  assert.deepEqual(both.extraction.assertions.find((item) => item.local_id === "a4").event_time.evidence_ids, [U1]);
});

test("scopeReviewAfterRepair: a repair the earlier review asked for stays asked for until the item is reassessed", () => {
  const earlier = review({ assessments: [ok("a2", "earlier")], repairs: [repairFor("a2")] });
  const omitted = scope({ review: review({ assessments: [ok("a1", "later")] }), previousReview: earlier, extraction: story() });
  assert.deepEqual(omitted.review.proposed_repairs.map((repair) => repair.target_id), ["a2"]);
  assert.equal(omitted.review.status, "repair_required");
  const reassessed = scope({ review: review({ assessments: [ok("a2", "later")] }), previousReview: earlier, extraction: story() });
  assert.deepEqual(reassessed.review.proposed_repairs, []);
  assert.equal(reassessed.review.status, "sufficient_for_stated_scope");
  const removed = scope({ review: review({ assessments: [] }), previousReview: earlier,
    extraction: story(without(storyItems(), "assertions", "a2")) });
  assert.deepEqual(removed.review.proposed_repairs, [], "the request goes with the removed item");
});

test("reviewAfterWithholding: a reference item the review still proposes to repair scores as distorted", () => {
  const audit = review({ role: "fidelity_auditor", assessments: [ok("ref-1", "later"), ok("ref-2", "later")],
    repairs: [repairFor("ref-2")] });
  const result = reviewAfterWithholding({ review: audit, withheldTargets: new Set(), candidateTargets: new Set() });
  validateJournalSchema("review-result", result);
  assert.equal(result.assessments.find((item) => item.target_id === "ref-2").finding_type, "other");
  assert.equal(result.assessments.find((item) => item.target_id === "ref-1").finding_type, "none");
  assert.equal(result.status, "repair_required");
  const score = scoreReferenceReview({ referenceResult: referenceResult(2, ["ref-2"]), reviewResult: result });
  assert.equal(score.reference_counts.preserved, 1);
  assert.equal(score.reference_counts.distorted, 1);
  assert.equal(score.critical_miss_count, 1);
  assert.equal(referenceScorePasses(score), false);
});

test("scopeReviewAfterRepair: after an earlier review that stopped without naming what it left, the new review counts whole", () => {
  const earlier = review({ assessments: [ok("a1", "earlier")], status: "incomplete" });
  const later = review({ assessments: [flag("a3", "later")] }); // a3 unchanged and never assessed before
  const result = scope({ review: later, previousReview: earlier, extraction: story() });
  assert.equal(result.scope, null);
  assert.equal(verdictOn(result, "a3").explanation, "later verdict on a3.");
  assert.equal(result.review.status, "repair_required");
});

test("scopeReviewAfterRepair: a reference item the new review leaves out keeps its clean verdict while its carriers are unchanged", () => {
  const bound = (kind, localId, unitId) => journalLocalNodeId({ caseId: "case-1", corpusId: "corpus-1", generation: "gen-1",
    localIdNamespace: unitId, kind, localId });
  const targetOf = (kind, localId, unitIds) => bound(kind, localId, unitIds[0] ?? "");
  const keptRef = verdict("ref-1", "preserved", "none", { evidenceIds: [bound("assertion", "a1", U1)], explanation: "earlier verdict on ref-1." });
  const earlier = review({ role: "fidelity_auditor", assessments: [keptRef] });
  const later = review({ role: "fidelity_auditor", assessments: [ok("ref-2", "later")] });
  // Only a3 changes: ref-1's carrier a1 is untouched, so its verdict carries forward.
  const a3Changed = story(edited(storyItems(), "assertions", "a3", { statement: "The keeper said the lamp would be lit by night." }));
  const carried = scope({ review: later, previousReview: earlier, extraction: a3Changed, targetOf });
  assert.equal(verdictOn(carried, "ref-1").explanation, "earlier verdict on ref-1.");
  // a1 itself changes: the earlier verdict no longer vouches for what is there, so ref-1 is left to the new review.
  const a1Changed = story(edited(storyItems(), "assertions", "a1", { statement: "Maren walked out to Pell Point after breakfast." }));
  const dropped = scope({ review: later, previousReview: earlier, extraction: a1Changed, targetOf });
  assert.equal(verdictOn(dropped, "ref-1"), undefined);
});

test("extractionItemChanges: time evidence follows the graph's precedence when an entity and an assertion share an ID", () => {
  const base = storyItems();
  const timed = (item, ids) => ({ ...item, event_time: { ...item.event_time, evidence_ids: ids } });
  const make = (entityLabel, keepAssertion) => story({
    entities: [...base.entities, entity("x", U2, entityLabel)],
    episodes: base.episodes,
    assertions: [...base.assertions.slice(0, 3), timed(base.assertions[3], ["x"]),
      ...(keepAssertion ? [assertion("x", U1, "Maren walked out to Pell Point before breakfast.", { subjects: ["e-maren"] })] : [])]
  });
  // The entity x changes but the assertion x, which the evidence resolves to, doesn't: a4 is unchanged.
  const entityOnly = extractionItemChanges(make("the keeper", true), make("the harbour master", true));
  assert.equal(record(entityOnly, "entity", "x").changed, true);
  assert.equal(record(entityOnly, "assertion", "a4").changed, false);
  // The assertion x goes, so "x" now resolves to the entity: a4's time evidence means something else.
  const resolvedElsewhere = extractionItemChanges(make("the keeper", true), make("the keeper", false));
  assert.equal(record(resolvedElsewhere, "assertion", "a4").changed, true);
});

// a4 takes its time from a2. A repair that drops a2 and renames a3 to a2 leaves "a2" naming the keeper's words.
const timedFromA2 = (items) => edited(items, "assertions", "a4",
  { event_time: { ...items.assertions[3].event_time, evidence_ids: ["a2"] } });
const a3RenamedOntoA2 = () => renamed(without(timedFromA2(storyItems()), "assertions", "a2"), "assertions", "a3", "a2");

test("extractionItemChanges: time evidence naming an ID that another item now carries counts as changed", () => {
  const before = story(timedFromA2(storyItems()));
  const reused = extractionItemChanges(before, story(a3RenamedOntoA2()));
  assert.deepEqual(record(reused, "assertion", "a2"), { kind: "assertion", localId: "a2", unitIds: [U2],
    changed: false, previousId: "a3", previousUnitIds: [U2] });
  assert.deepEqual(reused.removed, [{ kind: "assertion", localId: "a2", unitIds: [U1] }]);
  assert.equal(record(reused, "assertion", "a4").changed, true, "a4's time evidence now resolves to other passages");
  assert.equal(record(reused, "assertion", "a1").changed, false);
  // Two items that trade IDs: nothing is removed, but "a2" still names different passages than before.
  const items = timedFromA2(storyItems());
  const traded = { ...items, assertions: items.assertions.map((item) => item.local_id === "a2" ? { ...item, local_id: "a3" }
    : item.local_id === "a3" ? { ...item, local_id: "a2" } : item) };
  const swapped = extractionItemChanges(before, story(traded));
  assert.deepEqual(swapped.removed, []);
  assert.equal(record(swapped, "assertion", "a4").changed, true);
});

test("extractionItemChanges: entities that trade IDs change the assertions that cite them", () => {
  const before = storyItems();
  const traded = { ...before, entities: before.entities.map((item) => item.local_id === "e-keeper" ? { ...item, local_id: "e-lamp" }
    : item.local_id === "e-lamp" ? { ...item, local_id: "e-keeper" } : item) };
  const result = extractionItemChanges(story(before), story(traded));
  assert.deepEqual([record(result, "entity", "e-lamp").changed, record(result, "entity", "e-lamp").previousId], [false, "e-keeper"]);
  // a2 and a3 cite the lamp, and a3's speaker is the keeper: each now points at the other entity.
  assert.deepEqual(result.items.filter((item) => item.changed).map((item) => item.localId).sort(), ["a2", "a3"]);
});

test("scopeReviewAfterRepair: a dependent whose time evidence ID now names another item is reviewed again", () => {
  const later = review({ assessments: [verdict("a4", "distorted", "wrong_time")] });
  const result = scope({ review: later, previousExtraction: story(timedFromA2(storyItems())),
    extraction: story(a3RenamedOntoA2()) });
  assert.equal(verdictOn(result, "a4").explanation, "later verdict on a4.", "the new wrong-time finding counts");
  assert.equal(verdictOn(result, "a2").explanation, "earlier verdict on a3.", "the renamed item keeps its own verdict");
  assert.equal(result.review.status, "repair_required");
});

test("scopeReviewAfterRepair: what an earlier review left open on a removed item stays with it when another item takes its ID", () => {
  const reused = story(renamed(without(storyItems(), "assertions", "a2"), "assertions", "a3", "a2"));
  const flagged = review({ assessments: [flag("a2", "earlier"), ok("a1", "earlier"), ok("a3", "earlier"), ok("a4", "earlier")],
    repairs: [repairFor("a2")] });
  const afterFlag = scope({ review: review({ assessments: [] }), previousReview: flagged, extraction: reused });
  assert.equal(verdictOn(afterFlag, "a2").explanation, "earlier verdict on a3.", "the item now called a2 keeps a3's verdict");
  assert.deepEqual(afterFlag.review.proposed_repairs, []);
  assert.equal(afterFlag.review.status, "sufficient_for_stated_scope");
  const gap = review({ assessments: [ok("a1", "earlier"), ok("a3", "earlier"), ok("a4", "earlier")], unassessed: ["a2"],
    status: "incomplete" });
  const afterGap = scope({ review: review({ assessments: [] }), previousReview: gap, extraction: reused });
  assert.deepEqual(afterGap.review.unassessed_ids, []);
  assert.equal(afterGap.review.status, "sufficient_for_stated_scope");
});

test("scopeReviewAfterRepair: carried evidence drops an item the repair removed", () => {
  const targetOf = (_kind, localId) => localId;
  // ref-1 was vouched for by a1 and a2. The repair removes a2 and renames a3 onto its ID, so the verdict no
  // longer carries: the item now called a2 is not the one that carried ref-1.
  const earlier = review({ role: "fidelity_auditor", assessments: [{ ...ok("ref-1", "earlier"), evidence_ids: ["a1", "a2"] }] });
  const later = review({ role: "fidelity_auditor", assessments: [] });
  const reused = story(renamed(without(storyItems(), "assertions", "a2"), "assertions", "a3", "a2"));
  assert.equal(verdictOn(scope({ review: later, previousReview: earlier, extraction: reused, targetOf }), "ref-1"), undefined);
  const removedA2 = story(without(storyItems(), "assertions", "a2"));
  // An out-of-scope verdict replaced by its earlier one keeps only evidence that is still there.
  const flaggedA1 = review({ role: "fidelity_auditor",
    assessments: [{ ...ok("a1", "earlier"), evidence_ids: ["a1", "a2", U1] }] });
  const laterA1 = review({ role: "fidelity_auditor", assessments: [flag("a1", "later")] });
  const carried = scope({ review: laterA1, previousReview: flaggedA1, extraction: removedA2, targetOf });
  assert.deepEqual(verdictOn(carried, "a1").evidence_ids, ["a1", U1]);
});

test("scopeReviewAfterRepair: a carried repair proposal points its evidence at current items", () => {
  // The earlier review asked for a repair on a2 citing a1 and a3; the repair renames a1 and removes a3.
  const earlier = review({ assessments: [ok("a1", "earlier"), ok("a2", "earlier"), ok("a4", "earlier")],
    repairs: [{ ...repairFor("a2"), evidence_ids: ["a1", "a3", U1] }] });
  const repaired = story(renamed(without(storyItems(), "assertions", "a3"), "assertions", "a1", "a1-v2"));
  const result = scope({ review: review({ assessments: [] }), previousReview: earlier, extraction: repaired });
  assert.deepEqual(result.review.proposed_repairs.map((repair) => [repair.target_id, repair.evidence_ids]),
    [["a2", ["a1-v2", U1]]]);
});

test("scopeReviewAfterRepair: open work on a local ID two items shared stays on both when one is renamed", () => {
  const base = storyItems();
  // An entity and an assertion share the local ID x; the repair renames the entity to x2 and keeps the assertion.
  const shared = (entityId) => story({ entities: [...base.entities, entity(entityId, U2, "the harbour master")],
    episodes: base.episodes,
    assertions: [...base.assertions, assertion("x", U1, "The harbour master waved from the quay.", { subjects: ["e-maren"] })] });
  const flagged = review({ assessments: [flag("x", "earlier")], repairs: [repairFor("x")] });
  const result = scope({ review: review({ assessments: [] }), previousReview: flagged, previousExtraction: shared("x"),
    extraction: shared("x2") });
  assert.deepEqual(targetsIn(result).sort(), ["x", "x2"]);
  assert.deepEqual(result.review.proposed_repairs.map((repair) => repair.target_id).sort(), ["x", "x2"]);
  assert.equal(result.review.status, "repair_required");
  const gap = review({ assessments: [], unassessed: ["x"], status: "incomplete" });
  const afterGap = scope({ review: review({ assessments: [] }), previousReview: gap, previousExtraction: shared("x"),
    extraction: shared("x2") });
  assert.deepEqual([...afterGap.review.unassessed_ids].sort(), ["x", "x2"]);
});

test("scopeReviewAfterRepair: an earlier unit-level omission stays open while the repair adds nothing there", () => {
  const earlier = review({ assessments: [flag(U2, "earlier")], unassessed: [U1], repairs: [repairFor(U2)], status: "incomplete" });
  const result = scope({ review: review({ assessments: [ok("a1", "later")] }), previousReview: earlier, extraction: story() });
  assert.equal(verdictOn(result, U2).explanation, "earlier verdict on u2.");
  assert.deepEqual(result.review.unassessed_ids, [U1]);
  assert.deepEqual(result.review.proposed_repairs.map((repair) => repair.target_id), [U2]);
  assert.equal(result.review.status, "repair_required");
  // A rewrite elsewhere doesn't answer an omission in u2.
  const elsewhere = story(edited(storyItems(), "assertions", "a1", { statement: "Maren walked out to Pell Point at dawn." }));
  assert.equal(verdictOn(scope({ review: review({ assessments: [] }), previousReview: earlier, extraction: elsewhere }), U2)
    .explanation, "earlier verdict on u2.");
});

test("scopeReviewAfterRepair: a unit-level finding counts when the repair changed only the unit's coverage record", () => {
  const items = storyItems();
  const relabelled = extraction({ ...items, unitIds: [U1, U2], coverage: coverageFor([U1, U2], items.assertions)
    .map((record) => record.unit_id === U2 ? { ...record, disposition: "needs_review", reason: "Part of the page is hard to read." } : record) });
  const earlier = review({ assessments: [ok("u1", "earlier"), ok("u2", "earlier")] });
  const later = review({ assessments: [flag("u1", "later"), flag("u2", "later")] });
  const result = scope({ review: later, previousReview: earlier, extraction: relabelled });
  assert.deepEqual(explanations(result), { u1: "earlier verdict on u1.", u2: "later verdict on u2." });
  assert.equal(result.review.status, "repair_required");
});

test("validateExtractionReferences: a local ID may not equal an assigned unit ID", () => {
  assert.throws(() => story(renamed(storyItems(), "episodes", "ep-storm", U2)), /LOCAL_ID_IS_UNIT_ID/);
  assert.throws(() => story(renamed(storyItems(), "assertions", "a4", U1)), /LOCAL_ID_IS_UNIT_ID/);
  assert.doesNotThrow(() => story(renamed(storyItems(), "episodes", "ep-storm", U3)), "only assigned units count");
});
