import { ValidationError } from "../core/errors.mjs";

// The statistics that decide whether a pointer pass is published (plan 2026-10-09-journal-quote-first.md, Part 3,
// "Measuring it, with the floors fixed in advance"): recall's design-based lower bound on the random unit sample,
// the Clopper-Pearson bound on tag precision, the two judges' agreement, and the floors. Everything here is
// arithmetic on counts, so no journal text comes in. The special functions are written out here, so nothing beyond
// Node is needed.

// The floors, stated in the plan before anything is measured. Only the owner can change them.
export const POINTER_FLOORS = Object.freeze({
  recall_lower_bound: 0.85,
  critical_recall_point_estimate: 0.85,
  gain_point_estimate: 0.25,
  precision_lower_bound: 0.90,
  max_untagged_share: 0.02,
  event_check_max_unanswered_share: 0.02,
  event_check_recall_lower_bound: 0.90,
  event_coverage_point_estimate: 0.75,
  confidence: 0.95
});

// Precision is gated for every tag kind, each on its own fixed sample, so pairs of one kind can't carry another. A
// kind with no more pairs than a sample holds is judged in full: that census gives its exact precision, so it needs no
// bound, and no kind is left out for being small. The event pairs the event check dropped get a sample of the same size.
export const POINTER_PRECISION_SAMPLES = Object.freeze({
  kinds: Object.freeze(["person", "place", "organization", "topic", "event"]),
  pairs_per_kind: 150,
  dropped_event_pairs: 150
});

const HALF_LOG_TWO_PI = 0.5 * Math.log(2 * Math.PI);
// The incomplete beta's continued fraction stops when a step changes it by less than this, and gives up after
// this many steps; a value closer to zero than TINY is moved away from it so no step divides by zero.
const FRACTION_EPSILON = 1e-15;
const FRACTION_STEPS = 10000;
const TINY = 1e-300;
// How close the Clopper-Pearson bisection gets to the bound.
const BOUND_TOLERANCE = 1e-12;

function invariant(condition, code) {
  if (!condition) throw new ValidationError(code, { code });
}

const isNumber = (value) => typeof value === "number" && Number.isFinite(value);
const isProbability = (value) => isNumber(value) && value >= 0 && value <= 1;
// Strictly between 0 and 1, as a confidence level or a quantile's probability must be.
const isOpenProbability = (value) => isNumber(value) && value > 0 && value < 1;
const isCount = (value) => Number.isSafeInteger(value) && value >= 0;
const isObject = (value) => value !== null && typeof value === "object";
const sum = (values) => values.reduce((total, value) => total + value, 0);

// log Γ(x) less Stirling's approximation, for x ≥ 10, where these terms of the series reach double precision.
function stirlingCorrection(x) {
  const r = 1 / (x * x);
  return (1 / 12 - r * (1 / 360 - r * (1 / 1260 - r * (1 / 1680 - r * (1 / 1188 - r * (691 / 360360
    - r * (1 / 156 - r * 3617 / 122400))))))) / x;
}

// log Γ(x) for x > 0, from Γ(x) = Γ(x + k) / (x (x + 1) … (x + k − 1)) with x + k ≥ 10.
function logGamma(x) {
  let shifted = x;
  let product = 1;
  while (shifted < 10) {
    product *= shifted;
    shifted += 1;
  }
  return (shifted - 0.5) * Math.log(shifted) - shifted + HALF_LOG_TWO_PI + stirlingCorrection(shifted)
    - Math.log(product);
}

// log B(a, b). With a large argument, Stirling's formula is taken for each Γ and the large terms are combined by
// hand, so no two large logs are subtracted from each other.
function logBeta(a, b) {
  const p = Math.min(a, b);
  const q = Math.max(a, b);
  const share = p / (p + q);
  if (p >= 10) {
    return -0.5 * Math.log(q) + HALF_LOG_TWO_PI + stirlingCorrection(p) + stirlingCorrection(q)
      - stirlingCorrection(p + q) + (p - 0.5) * Math.log(share) + q * Math.log1p(-share);
  }
  if (q >= 10) {
    return logGamma(p) + stirlingCorrection(q) - stirlingCorrection(p + q) + p - p * Math.log(p + q)
      + (q - 0.5) * Math.log1p(-share);
  }
  return logGamma(p) + logGamma(q) - logGamma(p + q);
}

const awayFromZero = (value) => (Math.abs(value) < TINY ? TINY : value);

// The continued fraction for I_x(a, b), by the modified Lentz method. It converges fast for x < (a + 1) / (a + b + 2).
function betaFraction(x, a, b) {
  let c = 1;
  let d = 1 / awayFromZero(1 - (a + b) * x / (a + 1));
  let fraction = d;
  for (let m = 1; m <= FRACTION_STEPS; m += 1) {
    const even = m * (b - m) * x / ((a + 2 * m - 1) * (a + 2 * m));
    d = 1 / awayFromZero(1 + even * d);
    c = awayFromZero(1 + even / c);
    fraction *= d * c;
    const odd = -(a + m) * (a + b + m) * x / ((a + 2 * m) * (a + 2 * m + 1));
    d = 1 / awayFromZero(1 + odd * d);
    c = awayFromZero(1 + odd / c);
    const step = d * c;
    fraction *= step;
    if (Math.abs(step - 1) < FRACTION_EPSILON) return fraction;
  }
  invariant(false, "INCOMPLETE_BETA_NOT_CONVERGED");
}

// The regularized incomplete beta function I_x(a, b), for 0 ≤ x ≤ 1 and a, b > 0. Above (a + 1) / (a + b + 2) it is
// computed as 1 − I_{1−x}(b, a), where the fraction converges fast.
export function regularizedIncompleteBeta(x, a, b) {
  invariant(isProbability(x) && isNumber(a) && a > 0 && isNumber(b) && b > 0, "INCOMPLETE_BETA_INPUT_INVALID");
  if (x === 0) return 0;
  if (x === 1) return 1;
  // x^a (1 − x)^b / B(a, b), in front of either fraction.
  const front = Math.exp(a * Math.log(x) + b * Math.log1p(-x) - logBeta(a, b));
  const value = x < (a + 1) / (a + b + 2)
    ? front * betaFraction(x, a, b) / a
    : 1 - front * betaFraction(1 - x, b, a) / b;
  return Math.min(1, Math.max(0, value));
}

// The one-sided lower confidence bound for a binomial proportion: the p with P(X ≥ successes | trials, p) equal to
// 1 − confidence. That tail is I_p(successes, trials − successes + 1), so p is the (1 − confidence) quantile of
// Beta(successes, trials − successes + 1). The bisection returns its lower end, so the bound is never above the exact
// one by more than the incomplete beta's error. No successes, or no trials, give 0.
export function clopperPearsonLower({ successes, trials, confidence = 0.95 } = {}) {
  invariant(Number.isSafeInteger(successes) && Number.isSafeInteger(trials) && successes >= 0 && successes <= trials,
    "CLOPPER_PEARSON_INPUT_INVALID");
  invariant(isOpenProbability(confidence), "CLOPPER_PEARSON_CONFIDENCE_INVALID");
  if (successes === 0) return 0;
  const alpha = 1 - confidence;
  let low = 0;
  let high = 1;
  while (high - low > BOUND_TOLERANCE) {
    const middle = (low + high) / 2;
    if (regularizedIncompleteBeta(middle, successes, trials - successes + 1) < alpha) low = middle;
    else high = middle;
  }
  return low;
}

// The one-sided upper confidence bound for a binomial proportion: one less the lower bound for the other outcome. All
// successes, or no trials, give 1.
export function clopperPearsonUpper({ successes, trials, confidence = 0.95 } = {}) {
  invariant(Number.isSafeInteger(successes) && Number.isSafeInteger(trials) && successes >= 0 && successes <= trials,
    "CLOPPER_PEARSON_INPUT_INVALID");
  if (trials === 0) return 1;
  return 1 - clopperPearsonLower({ successes: trials - successes, trials, confidence });
}

// Whether t ≥ 0 is below the point whose upper tail under Student's t is `tail`. Above t² = df it compares
// P(T > t) = I_{df/(df+t²)}(df/2, 1/2) / 2 with tail; below, P(0 < T < t) = I_{t²/(df+t²)}(1/2, df/2) / 2 with
// 1/2 − tail. Each form passes the incomplete beta a small argument, so the comparison keeps its precision both
// far out and near 0.
function belowTQuantile(t, df, tail) {
  const square = t * t;
  if (square < df) return 0.5 * regularizedIncompleteBeta(square / (df + square), 0.5, df / 2) < 0.5 - tail;
  return 0.5 * regularizedIncompleteBeta(df / (df + square), df / 2, 0.5) > tail;
}

// The p-quantile of Student's t with df > 0 degrees of freedom. It finds t ≥ 0 whose upper tail is the smaller of p
// and 1 − p, by bisection to the last bit, and gives it p's sign. Using p itself when it is small keeps its precision.
export function studentTQuantile(p, df) {
  invariant(isOpenProbability(p), "STUDENT_T_PROBABILITY_INVALID");
  invariant(isNumber(df) && df > 0, "STUDENT_T_DEGREES_INVALID");
  if (p === 0.5) return 0;
  const tail = Math.min(p, 1 - p);
  let low = 0;
  let high = 1;
  while (belowTQuantile(high, df, tail)) {
    low = high;
    high *= 2;
  }
  for (;;) {
    const middle = low + (high - low) / 2;
    if (middle <= low || middle >= high) break;
    if (belowTQuantile(middle, df, tail)) low = middle;
    else high = middle;
  }
  return p < 0.5 ? -high : high;
}

// Two judges' agreement on the same yes/no items: raw agreement and Cohen's kappa, (p_o − p_e) / (1 − p_e), with p_e
// the agreement expected from each judge's own rate of yes answers. Kappa is undefined (null) with no items, or when
// p_e is 1, which happens only when both judges gave the same single answer throughout. It is never a gate.
export function cohenKappa(scores) {
  invariant(Array.isArray(scores), "COHEN_KAPPA_SCORES_INVALID");
  for (const score of scores) {
    invariant(isObject(score) && typeof score.first === "boolean" && typeof score.second === "boolean",
      "COHEN_KAPPA_SCORES_INVALID");
  }
  const items = scores.length;
  const agreements = scores.filter((score) => score.first === score.second).length;
  const firstYes = scores.filter((score) => score.first).length;
  const secondYes = scores.filter((score) => score.second).length;
  // In whole numbers, scaled by items²: chance is p_e · items², so p_e is 1 exactly when chance is items².
  const chance = firstYes * secondYes + (items - firstYes) * (items - secondYes);
  const square = items * items;
  return Object.freeze({
    items,
    agreements,
    disagreements: items - agreements,
    raw_agreement: items === 0 ? null : agreements / items,
    kappa: items === 0 || chance === square ? null : (agreements * items - chance) / (square - chance)
  });
}

// Strata in order, each as a group of units, split in two. A stratum whose units were all taken (inclusion
// probability 1, as when a journal is too short to give a stretch its full draw) is a census: it adds no sampling
// variance and no degree of freedom, and it is never merged. Among the other strata, one with a single sampled unit is
// merged with its nearest such neighbour (the next one, or the previous one when it is the last), until none has a
// single unit: the standard collapsed-strata estimator, conservative in expectation. A lone single-unit stratum with
// no such neighbour stays as it is, and the bound then can't be computed.
function collapseStrata(units) {
  const byStratum = new Map();
  for (const unit of units) {
    if (!byStratum.has(unit.stratum)) byStratum.set(unit.stratum, []);
    byStratum.get(unit.stratum).push(unit);
  }
  const ordered = [...byStratum.keys()].sort((left, right) => left - right)
    .map((stratum) => ({ strata: [stratum], units: byStratum.get(stratum) }));
  const census = ordered.filter((group) => group.units.every((unit) => unit.inclusion_probability === 1));
  const sampled = ordered.filter((group) => !census.includes(group));
  for (;;) {
    const single = sampled.findIndex((group) => group.units.length === 1);
    if (single === -1 || sampled.length === 1) return { census, sampled };
    const first = single + 1 < sampled.length ? single : single - 1;
    const [left, right] = [sampled[first], sampled[first + 1]];
    sampled.splice(first, 2, { strata: [...left.strata, ...right.strata], units: [...left.units, ...right.units] });
  }
}

// The design-based ratio estimate for a stratified sample of clusters (sampled units, whose questions move together)
// and its one-sided lower bound. Each unit is weighted by 1 / inclusion_probability; the estimate is weighted found
// over weighted asked. The variance is linearized, z = w · (found − R · asked), from how z varies within each stratum,
// with each stratum's finite population correction from its units' mean inclusion probability. Census strata add
// nothing to it. Student's t has as many degrees of freedom as sampled units less strata, over the strata that add
// variance, after collapsing. When every unit was taken with certainty the estimate is exact and the bound is the
// estimate. `strata` counts the strata as drawn; `census_strata` lists the ones taken whole; `collapsed_strata` lists
// each group of strata merged for the variance.
export function designRatioBound({ units, confidence = 0.95 } = {}) {
  invariant(Array.isArray(units), "DESIGN_RATIO_UNITS_INVALID");
  invariant(isOpenProbability(confidence), "DESIGN_RATIO_CONFIDENCE_INVALID");
  const seen = new Set();
  for (const unit of units) {
    invariant(isObject(unit) && typeof unit.unit_id === "string" && unit.unit_id.length > 0, "DESIGN_RATIO_UNITS_INVALID");
    invariant(!seen.has(unit.unit_id), "DESIGN_RATIO_UNIT_DUPLICATE");
    seen.add(unit.unit_id);
    invariant(Number.isSafeInteger(unit.stratum) && unit.stratum >= 0, "DESIGN_RATIO_STRATUM_INVALID");
    invariant(isNumber(unit.inclusion_probability) && unit.inclusion_probability > 0 && unit.inclusion_probability <= 1,
      "DESIGN_RATIO_INCLUSION_PROBABILITY_INVALID");
    invariant(isCount(unit.asked) && isCount(unit.found) && unit.found <= unit.asked, "DESIGN_RATIO_COUNTS_INVALID");
  }
  const weight = (unit) => 1 / unit.inclusion_probability;
  const weightedAsked = sum(units.map((unit) => weight(unit) * unit.asked));
  const weightedFound = sum(units.map((unit) => weight(unit) * unit.found));
  const estimate = weightedAsked > 0 ? weightedFound / weightedAsked : null;
  const { census, sampled } = collapseStrata(units);
  const result = {
    estimate,
    standard_error: null,
    degrees_of_freedom: sum(sampled.map((group) => group.units.length - 1)),
    lower_bound: null,
    sampled_units: units.length,
    strata: new Set(units.map((unit) => unit.stratum)).size,
    census_strata: Object.freeze(census.map((group) => group.strata[0])),
    collapsed_strata: Object.freeze(sampled.filter((group) => group.strata.length > 1)
      .map((group) => Object.freeze([...group.strata]))),
    reason: null
  };
  if (units.length === 0) return Object.freeze({ ...result, reason: "no sampled unit" });
  if (estimate === null) return Object.freeze({ ...result, reason: "no question asked" });
  // Every unit taken with certainty, however few: nothing was sampled, so the estimate is exact.
  if (sampled.length === 0) return Object.freeze({ ...result, standard_error: 0, lower_bound: estimate });
  let spread = 0;
  for (const group of sampled) {
    const size = group.units.length;
    if (size < 2) continue;
    const z = group.units.map((unit) => weight(unit) * (unit.found - estimate * unit.asked));
    const mean = sum(z) / size;
    const sampledFraction = sum(group.units.map((unit) => unit.inclusion_probability)) / size;
    spread += (1 - sampledFraction) * size / (size - 1) * sum(z.map((value) => (value - mean) ** 2));
  }
  const standardError = Math.sqrt(spread) / weightedAsked;
  // Units drawn with probability below 1 that leave no degree of freedom (a single one, or a lone single-unit
  // stratum): the variance can't be estimated, so there is no bound.
  if (result.degrees_of_freedom < 1) {
    return Object.freeze({ ...result, reason: "no degrees of freedom" });
  }
  const bound = estimate - studentTQuantile(confidence, result.degrees_of_freedom) * standardError;
  return Object.freeze({ ...result, standard_error: standardError, lower_bound: Math.min(estimate, Math.max(0, bound)) });
}

// A sample's counts: the population it was drawn from (`pairs`), how many were judged (`sampled`, all of them up to
// the sample's size) and how many of those were judged real or correct (`real`).
const sampleShaped = (sample, size, field) => isObject(sample) && isCount(sample.pairs) && isCount(sample.sampled)
  && isCount(sample[field]) && sample[field] <= sample.sampled && sample.sampled === Math.min(size, sample.pairs);

/**
 * Event-check recall: of the event pairs the tagger kept that are real events, the share the event check kept. `kept`
 * is the event kind's precision sample of the pairs the check kept, where a pair is real only when both judges say so;
 * `dropped` is the sample of the pairs it rejected or left unanswered, where a pair is real when either judge accepts
 * it or one leaves it unscored. With A kept and R dropped, and shares p and q real among them, recall is
 * A·p / (A·p + R·q). Its lower bound puts p's lower bound and q's upper bound, each one-sided at 1 − (1 − confidence) / 2
 * (Clopper-Pearson), into the formula, so the two hold together at `confidence`; a sample that is a census uses its
 * exact share. It is not applicable with no event pair, or when both samples are censuses with no pair judged real:
 * then there is no real event to keep.
 */
export function eventCheckRecall({ kept, dropped, confidence = 0.95 } = {}) {
  const size = POINTER_PRECISION_SAMPLES.pairs_per_kind;
  invariant(sampleShaped(kept, size, "real") && sampleShaped(dropped, POINTER_PRECISION_SAMPLES.dropped_event_pairs, "real"),
    "EVENT_CHECK_RECALL_INPUT_INVALID");
  invariant(isOpenProbability(confidence), "EVENT_CHECK_RECALL_CONFIDENCE_INVALID");
  const side = 1 - (1 - confidence) / 2;
  const census = (sample) => sample.sampled === sample.pairs;
  const share = (sample) => (sample.sampled === 0 ? 0 : sample.real / sample.sampled);
  const lower = census(kept) ? share(kept) : clopperPearsonLower({ successes: kept.real, trials: kept.sampled, confidence: side });
  const upper = census(dropped) ? share(dropped)
    : clopperPearsonUpper({ successes: dropped.real, trials: dropped.sampled, confidence: side });
  const base = { kept_pairs: kept.pairs, dropped_pairs: dropped.pairs, kept_real: kept.real, kept_sampled: kept.sampled,
    dropped_real: dropped.real, dropped_sampled: dropped.sampled };
  if (kept.pairs + dropped.pairs === 0) {
    return Object.freeze({ ...base, applicable: false, estimate: null, lower_bound: null, reason: "no event pair" });
  }
  const pointKept = kept.pairs * share(kept);
  const pointDropped = dropped.pairs * share(dropped);
  if (census(kept) && census(dropped) && kept.real === 0 && dropped.real === 0) {
    return Object.freeze({ ...base, applicable: false, estimate: null, lower_bound: null, reason: "no event pair judged real" });
  }
  const estimate = pointKept + pointDropped === 0 ? null : pointKept / (pointKept + pointDropped);
  const boundKept = kept.pairs * lower;
  const boundDropped = dropped.pairs * upper;
  const lowerBound = boundKept + boundDropped === 0 ? 0 : boundKept / (boundKept + boundDropped);
  return Object.freeze({ ...base, applicable: true, estimate, lower_bound: lowerBound, reason: null });
}

const isEstimate = (value) => value === null || isProbability(value);
const isRatioResult = (value) => isObject(value) && isEstimate(value.estimate) && isEstimate(value.lower_bound);

// The publication floors. `recall`, `critical_recall` and `gain` are designRatioBound results at
// POINTER_FLOORS.confidence (`recall` is null when a sampled unit is a nonresponse; `critical_recall`, recall with words
// and tags on the critical questions, is null when the sample has none; `gain` is null when word search misses no
// sampled question). The four recall estimates use the same weights; the critical pair is null when the sample has no
// critical question, and its first is `critical_recall`'s estimate. `event_coverage`, also a designRatioBound result,
// is the share of the sampled quotes that report an event with a kept event tag, null when no sampled quote reports one.
// `precision` holds each kind's sample (`pairs`, `sampled`, `correct`); `event_check` the event pairs checked and how
// many went unanswered; `event_recall` the samples eventCheckRecall takes, the kept one being the event kind's
// precision sample. The pass is published only when every floor holds.
export function pointerFloors(input) {
  invariant(isObject(input), "POINTER_FLOORS_INPUT_INVALID");
  const { recall, gain, precision, coverage, anchors, event_check: eventCheck, event_recall: eventRecall } = input;
  invariant(recall === null || isRatioResult(recall), "POINTER_FLOORS_RECALL_INVALID");
  invariant(isEstimate(input.recall_estimate) && isEstimate(input.recall_words_only_estimate),
    "POINTER_FLOORS_NO_LOSS_INVALID");
  const critical = [input.critical_recall_estimate, input.critical_recall_words_only_estimate];
  invariant(critical.every((value) => value === null) || critical.every(isProbability), "POINTER_FLOORS_NO_LOSS_INVALID");
  const criticalRecall = input.critical_recall;
  invariant((criticalRecall === null && input.critical_recall_estimate === null)
    || (isRatioResult(criticalRecall) && criticalRecall.estimate === input.critical_recall_estimate), "POINTER_FLOORS_CRITICAL_RECALL_INVALID");
  invariant(gain === null || isRatioResult(gain), "POINTER_FLOORS_GAIN_INVALID");
  invariant(isObject(precision)
    && POINTER_PRECISION_SAMPLES.kinds.every((kind) => sampleShaped(precision[kind], POINTER_PRECISION_SAMPLES.pairs_per_kind, "correct")),
    "POINTER_FLOORS_PRECISION_INVALID");
  invariant(isObject(eventCheck) && isCount(eventCheck.pairs) && isCount(eventCheck.unanswered) && eventCheck.unanswered <= eventCheck.pairs,
    "POINTER_FLOORS_EVENT_CHECK_INVALID");
  invariant(isObject(eventRecall), "POINTER_FLOORS_EVENT_RECALL_INVALID");
  invariant(input.event_coverage === null || isRatioResult(input.event_coverage), "POINTER_FLOORS_EVENT_COVERAGE_INVALID");
  // The kept event pairs are the event kind's precision sample, and a kept pair is real exactly when it is correct there:
  // when both judges say so.
  invariant(isObject(eventRecall.kept) && eventRecall.kept.pairs === precision.event.pairs && eventRecall.kept.sampled === precision.event.sampled
    && eventRecall.kept.real === precision.event.correct, "POINTER_FLOORS_EVENT_RECALL_INVALID");
  invariant(isObject(coverage) && isCount(coverage.untagged_pages) && isCount(coverage.pages_with_quotes)
    && coverage.untagged_pages <= coverage.pages_with_quotes, "POINTER_FLOORS_COVERAGE_INVALID");
  invariant(isObject(anchors) && isCount(anchors.broken), "POINTER_FLOORS_ANCHORS_INVALID");

  // Recall unknown, or a bound that can't be computed, fails.
  const recallBound = recall === null ? null : recall.lower_bound;
  const recallFloor = Object.freeze({
    holds: recallBound !== null && recallBound >= POINTER_FLOORS.recall_lower_bound,
    estimate: recall === null ? null : recall.estimate,
    lower_bound: recallBound,
    minimum: POINTER_FLOORS.recall_lower_bound,
    reason: recall === null ? "recall unknown: a sampled unit is a nonresponse"
      : recallBound === null ? recall.reason ?? "no lower bound" : null
  });

  // Point estimates on the same sampled questions: all of them, and the critical ones when there are any.
  const known = input.recall_estimate !== null && input.recall_words_only_estimate !== null;
  const hasCritical = input.critical_recall_estimate !== null;
  const noLossFloor = Object.freeze({
    holds: known && input.recall_estimate >= input.recall_words_only_estimate
      && (!hasCritical || input.critical_recall_estimate >= input.critical_recall_words_only_estimate),
    recall_estimate: input.recall_estimate,
    recall_words_only_estimate: input.recall_words_only_estimate,
    critical_recall_estimate: input.critical_recall_estimate,
    critical_recall_words_only_estimate: input.critical_recall_words_only_estimate,
    critical: hasCritical ? null : "no critical question in the sample",
    reason: known ? null : "recall unknown"
  });

  // Recall on the critical questions, on the point estimate with the lower bound reported, so the other questions can't
  // carry a pass that misses them, even when word search misses the same ones.
  const criticalFloor = Object.freeze(criticalRecall === null
    ? { holds: true, applicable: false, estimate: null, lower_bound: null, minimum: POINTER_FLOORS.critical_recall_point_estimate,
      reason: "no critical question in the sample" }
    : { holds: criticalRecall.estimate >= POINTER_FLOORS.critical_recall_point_estimate, applicable: true,
      estimate: criticalRecall.estimate, lower_bound: criticalRecall.lower_bound, minimum: POINTER_FLOORS.critical_recall_point_estimate,
      reason: null });

  // On the point estimate; the lower bound is only reported.
  const gainFloor = Object.freeze(gain === null
    ? { holds: true, applicable: false, estimate: null, lower_bound: null, minimum: POINTER_FLOORS.gain_point_estimate,
      reason: "word search misses no sampled question" }
    : { holds: gain.estimate !== null && gain.estimate >= POINTER_FLOORS.gain_point_estimate, applicable: true,
      estimate: gain.estimate, lower_bound: gain.lower_bound, minimum: POINTER_FLOORS.gain_point_estimate,
      reason: gain.estimate === null ? gain.reason ?? "no estimate" : null });

  // Pairs both judges marked correct, of each kind's fixed sample. A kind with no pairs has nothing to gate; a kind
  // judged in full (a census) is gated on its exact share, and a sampled one on its Clopper-Pearson lower bound.
  const kindFloor = (sample) => {
    if (sample.pairs === 0) return Object.freeze({ holds: true, applicable: false, pairs: 0, correct: 0, sampled: 0,
      census: true, lower_bound: null, reason: "no pairs of this kind" });
    const census = sample.sampled === sample.pairs;
    const lowerBound = census ? sample.correct / sample.sampled
      : clopperPearsonLower({ successes: sample.correct, trials: sample.sampled, confidence: POINTER_FLOORS.confidence });
    return Object.freeze({ holds: lowerBound >= POINTER_FLOORS.precision_lower_bound, applicable: true,
      pairs: sample.pairs, correct: sample.correct, sampled: sample.sampled, census, lower_bound: lowerBound, reason: null });
  };
  const kinds = Object.fromEntries(POINTER_PRECISION_SAMPLES.kinds.map((kind) => [kind, kindFloor(precision[kind])]));
  const precisionFloor = Object.freeze({
    holds: Object.values(kinds).every((kind) => kind.holds),
    minimum: POINTER_FLOORS.precision_lower_bound,
    ...kinds
  });

  const untaggedShare = coverage.pages_with_quotes === 0 ? null : coverage.untagged_pages / coverage.pages_with_quotes;
  const coverageFloor = Object.freeze({
    holds: untaggedShare !== null && untaggedShare <= POINTER_FLOORS.max_untagged_share,
    untagged_pages: coverage.untagged_pages,
    pages_with_quotes: coverage.pages_with_quotes,
    untagged_share: untaggedShare,
    maximum: POINTER_FLOORS.max_untagged_share
  });

  const anchorsFloor = Object.freeze({ holds: anchors.broken === 0, broken: anchors.broken });

  // Event checks left unanswered, after their retry or at the deadline, of the event pairs the tagger kept.
  const unansweredShare = eventCheck.pairs === 0 ? null : eventCheck.unanswered / eventCheck.pairs;
  const eventCheckFloor = Object.freeze({
    holds: unansweredShare === null || unansweredShare <= POINTER_FLOORS.event_check_max_unanswered_share,
    applicable: eventCheck.pairs > 0,
    pairs: eventCheck.pairs,
    unanswered: eventCheck.unanswered,
    unanswered_share: unansweredShare,
    maximum: POINTER_FLOORS.event_check_max_unanswered_share,
    reason: eventCheck.pairs === 0 ? "no event pair to check" : null
  });

  const recallOfEvents = eventCheckRecall({ kept: eventRecall.kept, dropped: eventRecall.dropped, confidence: POINTER_FLOORS.confidence });
  const eventRecallFloor = Object.freeze({
    holds: !recallOfEvents.applicable || recallOfEvents.lower_bound >= POINTER_FLOORS.event_check_recall_lower_bound,
    minimum: POINTER_FLOORS.event_check_recall_lower_bound,
    ...recallOfEvents
  });

  // Event tags on the sampled quotes that report an event, measured against the reference, so a pass that tags no event
  // fails even though the event floors above, which see only the tagger's pairs, have nothing to gate. On the point
  // estimate, with the lower bound reported.
  const eventCoverage = input.event_coverage;
  const eventCoverageFloor = Object.freeze(eventCoverage === null
    ? { holds: true, applicable: false, estimate: null, lower_bound: null, minimum: POINTER_FLOORS.event_coverage_point_estimate,
      reason: "no sampled quote reports an event" }
    : { holds: eventCoverage.estimate !== null && eventCoverage.estimate >= POINTER_FLOORS.event_coverage_point_estimate,
      applicable: true, estimate: eventCoverage.estimate, lower_bound: eventCoverage.lower_bound,
      minimum: POINTER_FLOORS.event_coverage_point_estimate, reason: eventCoverage.estimate === null ? "no estimate" : null });

  const floors = Object.freeze({
    recall: recallFloor,
    no_loss: noLossFloor,
    critical_recall: criticalFloor,
    gain: gainFloor,
    precision: precisionFloor,
    event_check: eventCheckFloor,
    event_check_recall: eventRecallFloor,
    event_coverage: eventCoverageFloor,
    coverage: coverageFloor,
    anchors: anchorsFloor
  });
  return Object.freeze({ publish: Object.values(floors).every((floor) => floor.holds), floors });
}
