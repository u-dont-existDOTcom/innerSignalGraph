// How repeated model reviews settle. Reviews vary from run to run, so a gate that waits for a whole-unit
// review with zero findings can fail correct work indefinitely. Three mechanical rules replace it:
// - after a repair, a review counts only for what the repair could have affected (scopeReviewAfterRepair);
// - when repairs run out, what is still flagged is withheld and the rest of the unit is kept
//   (withholdFlaggedItems, reviewAfterWithholding);
// - calibration is judged on pooled totals with a hard floor for critical misses (pooledCalibration).
// No model output decides its own scope: every rule here reads IDs and canonical content only.

const canonicalJson = (value) => JSON.stringify(value, (_key, item) =>
  item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);
const ITEM_FIELDS = Object.freeze([["assertions", "assertion"], ["entities", "entity"], ["episodes", "episode"]]);
const contentKey = ({ local_id: _localId, ...rest }) => canonicalJson(rest);
const anchorUnitIds = (item) => [...new Set((item.anchors ?? []).map((anchor) => anchor.unit_id))];
const localTarget = (_kind, localId) => localId;

// A verdict that asks for work: anything other than preserved without a finding.
export const assessmentIsFinding = (assessment) => assessment.outcome !== "preserved" || assessment.finding_type !== "none";

// Every target a review leaves open: its findings, its unassessed IDs and the targets of its proposed repairs.
export function reviewFindingTargets(review) {
  if (!review) return new Set();
  return new Set([
    ...review.assessments.filter(assessmentIsFinding).map((assessment) => assessment.target_id),
    ...review.unassessed_ids,
    ...review.proposed_repairs.map((repair) => repair.target_id)
  ]);
}

// How a repair changed an extraction's entities, episodes and assertions. An item with exactly the content of
// an earlier item is unchanged, even under a new local ID; `previousId` names the earlier item it matches. An
// item kept under its local ID with different content is changed and replaces that earlier item.
export function extractionItemChanges(previous, current) {
  const items = [], removed = [];
  for (const [field, kind] of ITEM_FIELDS) {
    const before = previous?.[field] ?? [];
    const byId = new Map(before.map((item) => [item.local_id, item]));
    const byContent = new Map();
    for (const item of before) {
      const key = contentKey(item);
      byContent.set(key, [...(byContent.get(key) ?? []), item.local_id]);
    }
    const used = new Set();
    const pending = [];
    for (const item of current?.[field] ?? []) {
      const prior = byId.get(item.local_id);
      if (prior && canonicalJson(prior) === canonicalJson(item)) {
        used.add(item.local_id);
        items.push({ kind, localId: item.local_id, unitIds: anchorUnitIds(item), changed: false,
          previousId: item.local_id, previousUnitIds: anchorUnitIds(prior) });
      } else pending.push(item);
    }
    for (const item of pending) {
      const match = (byContent.get(contentKey(item)) ?? []).find((id) => !used.has(id));
      if (match !== undefined) {
        used.add(match);
        items.push({ kind, localId: item.local_id, unitIds: anchorUnitIds(item), changed: false,
          previousId: match, previousUnitIds: anchorUnitIds(byId.get(match)) });
        continue;
      }
      const replaced = byId.has(item.local_id) && !used.has(item.local_id);
      if (replaced) used.add(item.local_id);
      items.push({ kind, localId: item.local_id, unitIds: anchorUnitIds(item), changed: true,
        previousId: replaced ? item.local_id : null,
        previousUnitIds: replaced ? anchorUnitIds(byId.get(item.local_id)) : [] });
    }
    for (const item of before) {
      if (!used.has(item.local_id)) removed.push({ kind, localId: item.local_id, unitIds: anchorUnitIds(item) });
    }
  }
  return { items, removed };
}

// After a repair, the new review counts for the targets of the earlier review's open findings, for the items
// the repair added or changed, for units it removed an item from, and for any target it can't place (such as a
// frozen reference item). Every other verdict carries forward: an item that passed and didn't change keeps the
// earlier verdict, under its current ID. `previousReview` is the earlier effective review, so a finding that
// was out of scope then doesn't come back as an earlier finding now. `targetOf(kind, localId, unitIds)` gives
// the ID a reviewer uses for an item: the local ID for the omission checker, the bound graph ID for the
// fidelity auditor.
export function scopeReviewAfterRepair({ review, previousReview, previousExtraction, extraction, unitIds,
  targetOf = localTarget }) {
  if (!review || !previousReview || !previousExtraction || !extraction) return { review: review ?? null, scope: null };
  const { items, removed } = extractionItemChanges(previousExtraction, extraction);
  const earlier = reviewFindingTargets(previousReview);
  const units = new Set(unitIds);
  const unitsWithRemovals = new Set(removed.flatMap((item) => item.unitIds));
  const byTarget = new Map();
  for (const item of items) {
    const target = targetOf(item.kind, item.localId, item.unitIds);
    const previousTarget = item.previousId === null ? null : targetOf(item.kind, item.previousId, item.previousUnitIds);
    byTarget.set(target, [...(byTarget.get(target) ?? []), { ...item, previousTarget }]);
  }
  const previousAssessments = new Map(previousReview.assessments.map((assessment) => [assessment.target_id, assessment]));
  const placement = new Map();
  const place = (target) => {
    if (placement.has(target)) return placement.get(target);
    let value;
    if (units.has(target)) value = { inScope: earlier.has(target) || unitsWithRemovals.has(target), carriedFrom: target };
    else if (byTarget.has(target)) {
      const entries = byTarget.get(target);
      const inScope = earlier.has(target) || entries.some((entry) => entry.changed
        || (entry.previousTarget !== null && earlier.has(entry.previousTarget)));
      value = { inScope, carriedFrom: entries.find((entry) => entry.previousTarget !== null)?.previousTarget ?? target };
    } else value = { inScope: true, carriedFrom: target };
    placement.set(target, value);
    return value;
  };
  let carried = 0;
  const assessments = [];
  for (const assessment of review.assessments) {
    const { inScope, carriedFrom } = place(assessment.target_id);
    if (inScope) { assessments.push(assessment); continue; }
    if (assessmentIsFinding(assessment)) carried += 1;
    const prior = previousAssessments.get(carriedFrom);
    if (prior) assessments.push({ ...prior, target_id: assessment.target_id });
  }
  const unassessed = review.unassessed_ids.filter((id) => {
    if (place(id).inScope) return true;
    carried += 1;
    return false;
  });
  const proposedRepairs = review.proposed_repairs.filter((repair) => place(repair.target_id).inScope);
  const open = assessments.some(assessmentIsFinding) || unassessed.length > 0 || proposedRepairs.length > 0;
  // An incomplete review that names nothing it left can't be placed, so it stays incomplete.
  const unplacedIncomplete = review.status === "incomplete" && review.unassessed_ids.length === 0;
  const status = unplacedIncomplete || (review.status === "incomplete" && unassessed.length > 0) ? "incomplete"
    : open ? "repair_required" : "sufficient_for_stated_scope";
  return {
    review: { ...review, assessments, unassessed_ids: unassessed, proposed_repairs: proposedRepairs, status },
    scope: { carried, changed: items.filter((item) => item.changed).length, removed: removed.length,
      earlier_findings: earlier.size }
  };
}

// When repairs run out: withhold the items the final reviews still flag and keep the rest of the extraction.
// A flagged entity or episode withholds the assertions that depend on it. A finding on a unit, or on a target
// that isn't an item (such as a frozen reference item, attributed to the unit when there is only one), is an
// omission gap: the unit is marked needs_review and its archived source stays available. A kept item's time
// evidence that pointed at a withheld item points at that item's unit instead, so the rest still binds.
// Each entry of `reviews` is `{ review, targetOf }`, with `targetOf` as in scopeReviewAfterRepair (local IDs by
// default). Returns null when the extraction isn't complete, or a review is incomplete without naming what it
// left.
export function withholdFlaggedItems({ extraction, reviews, unitIds }) {
  if (extraction?.status !== "complete") return null;
  const units = new Set(unitIds);
  const withheld = { assertions: new Set(), entities: new Set(), episodes: new Set() };
  const gaps = new Map();
  let unassessed = 0, unlocated = 0;
  const addGap = (unitId) => gaps.set(unitId, (gaps.get(unitId) ?? 0) + 1);
  for (const { review, targetOf = localTarget } of reviews) {
    if (!review) continue;
    if (review.status === "incomplete" && review.unassessed_ids.length === 0) return null;
    const located = new Map();
    for (const [field, kind] of ITEM_FIELDS) {
      for (const item of extraction[field]) located.set(targetOf(kind, item.local_id, anchorUnitIds(item)), { field, item });
    }
    const targets = [...review.assessments.filter(assessmentIsFinding).map((assessment) => assessment.target_id),
      ...review.unassessed_ids];
    unassessed += review.unassessed_ids.length;
    for (const target of new Set(targets)) {
      const found = located.get(target);
      if (found) withheld[found.field].add(found.item.local_id);
      else if (units.has(target)) addGap(target);
      else if (unitIds.length === 1) addGap(unitIds[0]);
      else unlocated += 1;
    }
  }
  const dependsOnWithheld = (assertion) => withheld.entities.has(assertion.speaker_local_id)
    || assertion.subject_local_ids.some((id) => withheld.entities.has(id))
    || (assertion.episode_local_id !== null && withheld.episodes.has(assertion.episode_local_id));
  const dependent = extraction.assertions.filter((assertion) => !withheld.assertions.has(assertion.local_id)
    && dependsOnWithheld(assertion));
  for (const assertion of dependent) withheld.assertions.add(assertion.local_id);
  const withheldUnit = new Map();
  for (const [field] of ITEM_FIELDS) {
    for (const item of extraction[field]) {
      if (withheld[field].has(item.local_id)) withheldUnit.set(item.local_id, anchorUnitIds(item)[0]);
    }
  }
  const retime = (time) => ({ ...time, evidence_ids: [...new Set(time.evidence_ids.map((id) => withheldUnit.get(id) ?? id))] });
  const assertions = extraction.assertions.filter((item) => !withheld.assertions.has(item.local_id))
    .map((item) => ({ ...item, authored_time: retime(item.authored_time), event_time: retime(item.event_time) }));
  const entities = extraction.entities.filter((item) => !withheld.entities.has(item.local_id));
  const episodes = extraction.episodes.filter((item) => !withheld.episodes.has(item.local_id))
    .map((item) => ({ ...item, authored_time: retime(item.authored_time), event_time: retime(item.event_time) }));
  const residualsByUnit = new Map(unitIds.map((unitId) => [unitId, { withheld_assertions: 0, withheld_entities: 0,
    withheld_episodes: 0, omission_gaps: gaps.get(unitId) ?? 0 }]));
  for (const [field] of ITEM_FIELDS) {
    for (const item of extraction[field]) {
      const counts = residualsByUnit.get(anchorUnitIds(item)[0]);
      if (withheld[field].has(item.local_id) && counts) counts[`withheld_${field}`] += 1;
    }
  }
  const withheldByUnit = new Map([...residualsByUnit].map(([unitId, counts]) => [unitId, counts.withheld_assertions]));
  const kept = new Set(assertions.map((item) => item.local_id));
  const coverage = extraction.coverage.map((item) => {
    const held = withheldByUnit.get(item.unit_id) ?? 0, open = gaps.get(item.unit_id) ?? 0;
    const assertionLocalIds = item.assertion_local_ids.filter((id) => kept.has(id));
    if (!held && !open) return { ...item, assertion_local_ids: assertionLocalIds };
    return { ...item, disposition: "needs_review", assertion_local_ids: assertionLocalIds,
      reason: `After the repair attempts, review still flagged ${held} assertion(s), which were withheld, and found ${open} possible omission(s); the archived source keeps this unit's full text.` };
  });
  const withheldItems = ITEM_FIELDS.flatMap(([field, kind]) => extraction[field]
    .filter((item) => withheld[field].has(item.local_id))
    .map((item) => ({ kind, localId: item.local_id, unitIds: anchorUnitIds(item) })));
  return {
    extraction: { ...extraction, assertions, entities, episodes, coverage },
    withheldItems,
    // Per unit, for its record; a unit with nothing withheld and no gap has all zeros.
    residualsByUnit,
    residuals: {
      withheld_assertions: withheld.assertions.size,
      withheld_dependent: dependent.length,
      withheld_entities: withheld.entities.size,
      withheld_episodes: withheld.episodes.size,
      omission_gaps: [...gaps.values()].reduce((sum, count) => sum + count, 0) + unlocated,
      unassessed
    }
  };
}

// A fidelity review after withholding: withheld candidates leave it, and a reference item it counted preserved
// only through withheld candidates now counts omitted. A preserved item with no candidate evidence keeps its
// verdict, since nothing withheld can be shown to have carried it.
export function reviewAfterWithholding({ review, withheldTargets, candidateTargets }) {
  const assessments = review.assessments.filter((assessment) => !withheldTargets.has(assessment.target_id))
    .map((assessment) => {
      if (candidateTargets.has(assessment.target_id) || assessment.outcome !== "preserved") return assessment;
      const support = assessment.evidence_ids.filter((id) => candidateTargets.has(id));
      if (!support.length || !support.every((id) => withheldTargets.has(id))) return assessment;
      return { ...assessment, outcome: "omitted", finding_type: "missing_evidence",
        explanation: "Every saved assertion that carried this item was withheld after review." };
    });
  const unassessed = review.unassessed_ids.filter((id) => !withheldTargets.has(id));
  const proposedRepairs = review.proposed_repairs.filter((repair) => !withheldTargets.has(repair.target_id));
  const open = assessments.some(assessmentIsFinding) || unassessed.length > 0;
  return { ...review, assessments, unassessed_ids: unassessed, proposed_repairs: proposedRepairs,
    status: review.status === "incomplete" && unassessed.length > 0 ? "incomplete"
      : open ? "repair_required" : "sufficient_for_stated_scope" };
}

// A unit's own reference result, used for reporting: every reference item kept apart from the recall
// allowance, nothing critical missed, no lost qualifier and nothing unassessed.
export const referenceScorePasses = (score) => score.critical_miss_count === 0
  && score.qualifier_error_count === 0
  && score.reference_counts.unassessed === 0
  && (score.reference_total === 0 || score.provisional_target_met);

// The counts a calibration score keeps: totals and outcomes only.
export const calibrationScoreCounts = (score) => ({
  reference_total: score.reference_total,
  preserved: score.reference_counts.preserved,
  omitted: score.reference_counts.omitted,
  distorted: score.reference_counts.distorted,
  unassessed: score.reference_counts.unassessed,
  critical_miss_count: score.critical_miss_count,
  qualifier_error_count: score.qualifier_error_count
});

// A source-only calibration batch keeps none of its reference items: each counts omitted, and each critical
// one counts as a critical miss.
export const sourceOnlyCalibrationCounts = (reference) => ({
  reference_total: reference.reference_items.length,
  preserved: 0,
  omitted: reference.reference_items.length,
  distorted: 0,
  unassessed: 0,
  critical_miss_count: reference.reference_items.filter((item) => item.critical).length,
  qualifier_error_count: 0
});

// Calibration passes when pooled recall across the scored batches meets the target and no critical reference
// item is missed after repairs. Failed units and qualifier errors are reported, not gated.
export function pooledCalibration(counts, target) {
  const total = (field) => counts.reduce((sum, item) => sum + item[field], 0);
  const referenceTotal = total("reference_total"), preserved = total("preserved");
  const criticalMisses = total("critical_miss_count");
  const recallTargetMet = referenceTotal === 0 || preserved / referenceTotal >= target;
  return {
    scored_batches: counts.length,
    reference_total: referenceTotal,
    preserved,
    omitted: total("omitted"),
    distorted: total("distorted"),
    unassessed: total("unassessed"),
    critical_miss_count: criticalMisses,
    qualifier_error_count: total("qualifier_error_count"),
    recall_target_met: recallTargetMet,
    calibration_pass: recallTargetMet && criticalMisses === 0
  };
}
