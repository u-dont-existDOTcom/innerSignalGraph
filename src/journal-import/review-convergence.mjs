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
    // Content matches are settled before any ID is treated as rewritten in place, so the result doesn't depend
    // on the order the extractor listed its items in.
    const rewritten = [];
    for (const item of pending) {
      const match = (byContent.get(contentKey(item)) ?? []).find((id) => !used.has(id));
      if (match === undefined) { rewritten.push(item); continue; }
      used.add(match);
      items.push({ kind, localId: item.local_id, unitIds: anchorUnitIds(item), changed: false,
        previousId: match, previousUnitIds: anchorUnitIds(byId.get(match)) });
    }
    for (const item of rewritten) {
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
  // An item that changed or went away also changes what points at it: an assertion through its speaker,
  // subjects, episode or time evidence, and an episode through its time evidence. Those count as changed too,
  // until nothing more changes.
  const changedIds = { assertion: new Set(), entity: new Set(), episode: new Set() };
  for (const item of items) if (item.changed) changedIds[item.kind].add(item.localId);
  // Local IDs are unique only within a kind, so removals are tracked per kind too. Time evidence can name any kind.
  const goneIds = { assertion: new Set(), entity: new Set(), episode: new Set() };
  for (const item of removed) goneIds[item.kind].add(item.localId);
  const touched = (id) => ["assertion", "entity", "episode"].some((kind) => goneIds[kind].has(id) || changedIds[kind].has(id));
  const entityTouched = (id) => goneIds.entity.has(id) || changedIds.entity.has(id);
  const timeIds = (item) => [...(item.authored_time?.evidence_ids ?? []), ...(item.event_time?.evidence_ids ?? [])];
  const sources = { assertion: new Map((current?.assertions ?? []).map((item) => [item.local_id, item])),
    episode: new Map((current?.episodes ?? []).map((item) => [item.local_id, item])) };
  for (let grew = true; grew;) {
    grew = false;
    for (const record of items) {
      if (record.changed || record.kind === "entity") continue;
      const source = sources[record.kind].get(record.localId);
      const depends = timeIds(source).some(touched) || (record.kind === "assertion"
        && (entityTouched(source.speaker_local_id) || source.subject_local_ids.some(entityTouched)
          || (source.episode_local_id !== null && (goneIds.episode.has(source.episode_local_id)
            || changedIds.episode.has(source.episode_local_id)))));
      if (!depends) continue;
      record.changed = true;
      changedIds[record.kind].add(record.localId);
      grew = true;
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
  // An earlier review that stopped without naming what it left can't vouch for anything it didn't mention, so the
  // new review counts whole until a whole review has covered the unit.
  if (previousReview.status === "incomplete" && previousReview.unassessed_ids.length === 0) return { review, scope: null };
  const { items, removed } = extractionItemChanges(previousExtraction, extraction);
  const earlier = reviewFindingTargets(previousReview);
  const units = new Set(unitIds);
  // A unit lost an item when one anchored in it was removed, or rewritten so that it no longer is.
  const unitsWithRemovals = new Set([...removed.flatMap((item) => item.unitIds),
    ...items.filter((item) => item.changed).flatMap((item) => item.previousUnitIds
      .filter((unitId) => !item.unitIds.includes(unitId)))]);
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
  // An earlier open finding on an item that is still there stays open until the new review reassesses that item: a
  // review that leaves a flagged item out hasn't shown the defect is gone. A finding on an item the repair removed
  // goes with the item. A finding on a unit or on a target that isn't an item is different: a repair answers an
  // omission with new items, which the review assesses under their own IDs, so it stays open only if the review
  // names that target again. (The fidelity score already counts a reference item the review leaves out as
  // unassessed.)
  const mentioned = new Set([...review.assessments.map((assessment) => assessment.target_id), ...review.unassessed_ids,
    ...review.proposed_repairs.map((repair) => repair.target_id)]);
  const currentTarget = new Map();
  for (const [target, entries] of byTarget) {
    for (const entry of entries) if (entry.previousTarget !== null) currentTarget.set(entry.previousTarget, target);
  }
  const stillThere = (target) => currentTarget.has(target) || byTarget.has(target);
  const counted = new Set(assessments.map((assessment) => assessment.target_id));
  for (const prior of previousReview.assessments.filter(assessmentIsFinding)) {
    const target = currentTarget.get(prior.target_id) ?? prior.target_id;
    if (mentioned.has(target) || counted.has(target) || !stillThere(prior.target_id)) continue;
    assessments.push({ ...prior, target_id: target });
    counted.add(target);
  }
  for (const id of previousReview.unassessed_ids) {
    const target = currentTarget.get(id) ?? id;
    if (mentioned.has(target) || unassessed.includes(target) || !stillThere(id)) continue;
    unassessed.push(target);
  }
  const proposedRepairs = review.proposed_repairs.filter((repair) => place(repair.target_id).inScope);
  // A repair the earlier review asked for on an item that is still there stays asked for until the new review
  // reassesses that item, like its findings.
  for (const prior of previousReview.proposed_repairs) {
    const target = currentTarget.get(prior.target_id) ?? prior.target_id;
    if (mentioned.has(target) || proposedRepairs.some((repair) => repair.target_id === target)
      || !stillThere(prior.target_id)) continue;
    proposedRepairs.push({ ...prior, target_id: target });
  }
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

// When repairs run out: withhold the items the final reviews still flag (a finding, an unassessed ID or a proposed
// repair) and keep the rest of the extraction.
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
    // Local IDs need only be unique within one kind, so a target can name several items; each is withheld.
    const located = new Map();
    for (const [field, kind] of ITEM_FIELDS) {
      for (const item of extraction[field]) {
        const target = targetOf(kind, item.local_id, anchorUnitIds(item));
        located.set(target, [...(located.get(target) ?? []), { field, item }]);
      }
    }
    // A target the review still asks to repair is flagged too, even when its verdict reads preserved.
    const targets = [...review.assessments.filter(assessmentIsFinding).map((assessment) => assessment.target_id),
      ...review.unassessed_ids, ...review.proposed_repairs.map((repair) => repair.target_id)];
    unassessed += review.unassessed_ids.length;
    for (const target of new Set(targets)) {
      const found = located.get(target);
      if (found) for (const { field, item } of found) withheld[field].add(item.local_id);
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
  // Time evidence names a local ID without its kind; the graph resolves it to an assertion first, then an episode,
  // then an entity. Only an ID whose resolved item is withheld points at that item's unit instead.
  const resolved = new Map();
  for (const field of ["entities", "episodes", "assertions"]) {
    for (const item of extraction[field]) resolved.set(item.local_id, { field, item });
  }
  const withheldUnit = new Map([...resolved].filter(([, { field, item }]) => withheld[field].has(item.local_id))
    .map(([id, { item }]) => [id, anchorUnitIds(item)[0]]));
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
      if (!withheld[field].has(item.local_id)) continue;
      for (const unitId of anchorUnitIds(item)) {
        const counts = residualsByUnit.get(unitId);
        if (counts) counts[`withheld_${field}`] += 1;
      }
    }
  }
  const kept = new Set(assertions.map((item) => item.local_id));
  // A unit that lost any item to withholding, or has a gap, is marked for review.
  const coverage = extraction.coverage.map((item) => {
    const counts = residualsByUnit.get(item.unit_id);
    const held = counts?.withheld_assertions ?? 0, open = gaps.get(item.unit_id) ?? 0;
    const others = (counts?.withheld_entities ?? 0) + (counts?.withheld_episodes ?? 0);
    const assertionLocalIds = item.assertion_local_ids.filter((id) => kept.has(id));
    if (!held && !others && !open) return { ...item, assertion_local_ids: assertionLocalIds };
    return { ...item, disposition: "needs_review", assertion_local_ids: assertionLocalIds,
      reason: `After the repair attempts, review still flagged ${held} assertion(s)${others ? ` and ${others} other item(s)` : ""}, which were withheld, and found ${open} possible omission(s); the archived source keeps this unit's full text.` };
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

// A fidelity review after withholding: withheld candidates leave it, a reference item it counted preserved only
// through withheld candidates now counts omitted, and one it still proposes to repair counts distorted. A preserved
// item with no candidate evidence and no proposal keeps its verdict, since nothing withheld can be shown to have
// carried it.
export function reviewAfterWithholding({ review, withheldTargets, candidateTargets }) {
  const proposedRepairs = review.proposed_repairs.filter((repair) => !withheldTargets.has(repair.target_id));
  // A reference item the review still proposes to repair isn't kept as is: it scores as distorted.
  const stillProposed = new Set(proposedRepairs.map((repair) => repair.target_id));
  const assessments = review.assessments.filter((assessment) => !withheldTargets.has(assessment.target_id))
    .map((assessment) => {
      if (candidateTargets.has(assessment.target_id) || assessment.outcome !== "preserved") return assessment;
      const support = assessment.evidence_ids.filter((id) => candidateTargets.has(id));
      if (support.length && support.every((id) => withheldTargets.has(id))) {
        return { ...assessment, outcome: "omitted", finding_type: "missing_evidence",
          explanation: "Every saved assertion that carried this item was withheld after review." };
      }
      if (stillProposed.has(assessment.target_id) && assessment.finding_type === "none") {
        return { ...assessment, finding_type: "other", explanation: "The review still proposes a repair for this item." };
      }
      return assessment;
    });
  const unassessed = review.unassessed_ids.filter((id) => !withheldTargets.has(id));
  const open = assessments.some(assessmentIsFinding) || unassessed.length > 0 || proposedRepairs.length > 0;
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
