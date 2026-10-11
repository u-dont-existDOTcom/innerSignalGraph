import test from "node:test";
import assert from "node:assert/strict";
import { POINTER_FLOORS, POINTER_PRECISION_SAMPLES, clopperPearsonLower, cohenKappa, designRatioBound, pointerFloors, regularizedIncompleteBeta,
  studentTQuantile } from "../src/journal-import/pointer-measure.mjs";

// The pointer pass's measurement (plan 2026-10-09-journal-quote-first.md, Part 3, "Measuring it, with the floors
// fixed in advance"): the special functions, the Clopper-Pearson bound on precision, the judges' kappa, recall's
// design-based bound and the publication floors. Every number here is synthetic.

function near(actual, expected, tolerance, label = "") {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} is not within ${tolerance} of ${expected}`);
}

// P(X ≥ k) for X ~ Binomial(n, p), term by term.
function binomialUpperTail(k, n, p) {
  let total = 0;
  let coefficient = 1;
  for (let j = 0; j <= n; j += 1) {
    if (j >= k) total += coefficient * p ** j * (1 - p) ** (n - j);
    coefficient = coefficient * (n - j) / (j + 1);
  }
  return total;
}

// One stratum's part of the linearized variance, written out here rather than taken from the module:
// (1 − f) · n / (n − 1) · Σ (z − z̄)².
function stratumPart(z, f) {
  const mean = z.reduce((total, value) => total + value, 0) / z.length;
  return (1 - f) * z.length / (z.length - 1) * z.reduce((total, value) => total + (value - mean) ** 2, 0);
}

const unit = (unit_id, stratum, inclusion_probability, asked, found) => ({ unit_id, stratum, inclusion_probability, asked, found });

test("the incomplete beta function matches its closed forms", () => {
  for (const x of [0, 1e-9, 0.01, 0.2, 0.5, 0.77, 0.999, 1]) {
    near(regularizedIncompleteBeta(x, 1, 1), x, 1e-12, `I_${x}(1, 1)`);
    for (const a of [0.5, 2, 7.3, 40, 300]) near(regularizedIncompleteBeta(x, a, 1), x ** a, 1e-10, `I_${x}(${a}, 1)`);
    for (const b of [0.5, 3, 12.5, 300]) near(regularizedIncompleteBeta(x, 1, b), 1 - (1 - x) ** b, 1e-10, `I_${x}(1, ${b})`);
  }
});

test("the incomplete beta function is symmetric, and a binomial tail for whole numbers", () => {
  for (const [a, b] of [[2.3, 4.7], [0.5, 42], [42, 0.5], [15, 15], [120, 30]]) {
    for (const x of [0.05, 0.3, 0.5, 0.8, 0.97]) {
      near(regularizedIncompleteBeta(x, a, b), 1 - regularizedIncompleteBeta(1 - x, b, a), 1e-12, `I_${x}(${a}, ${b})`);
    }
  }
  near(regularizedIncompleteBeta(0.5, 2.5, 2.5), 0.5, 1e-12, "I_0.5(a, a)");
  near(regularizedIncompleteBeta(0.5, 400, 400), 0.5, 1e-10, "I_0.5(a, a) for large a");
  // I_x(a, b) = P(X ≥ a) for X ~ Binomial(a + b − 1, x).
  for (const [a, b, x] of [[3, 5, 0.3], [8, 3, 0.62], [12, 9, 0.5], [1, 20, 0.01], [19, 2, 0.97]]) {
    near(regularizedIncompleteBeta(x, a, b), binomialUpperTail(a, a + b - 1, x), 1e-12, `I_${x}(${a}, ${b})`);
  }
});

test("the incomplete beta function refuses arguments outside its domain", () => {
  for (const args of [[-0.1, 1, 1], [1.1, 1, 1], [0.5, 0, 1], [0.5, 1, -2], [Number.NaN, 1, 1], [0.5, Infinity, 1], ["0.5", 1, 1]]) {
    assert.throws(() => regularizedIncompleteBeta(...args), { code: "INCOMPLETE_BETA_INPUT_INVALID" }, String(args));
  }
});

test("the Clopper-Pearson lower bound", () => {
  // All 300 correct: P(X ≥ 300) = p³⁰⁰ = 0.05.
  near(clopperPearsonLower({ successes: 300, trials: 300 }), 0.05 ** (1 / 300), 1e-9, "300 of 300");
  near(clopperPearsonLower({ successes: 300, trials: 300 }), 0.990064, 1e-6, "300 of 300");
  // 8 of 10: the 0.05 quantile of Beta(8, 3). (0.506901 is 1 minus this: the upper bound for 2 of 10.)
  near(clopperPearsonLower({ successes: 8, trials: 10 }), 0.493099, 1e-5, "8 of 10");
  // At the bound, at least this many successes have probability 1 − confidence.
  for (const [successes, trials] of [[8, 10], [17, 20], [1, 12], [20, 20]]) {
    near(binomialUpperTail(successes, trials, clopperPearsonLower({ successes, trials })), 0.05, 1e-10, `${successes} of ${trials}`);
  }
  assert.equal(clopperPearsonLower({ successes: 0, trials: 50 }), 0);
  assert.equal(clopperPearsonLower({ successes: 0, trials: 0 }), 0);
  let previous = -1;
  for (let successes = 0; successes <= 40; successes += 1) {
    const bound = clopperPearsonLower({ successes, trials: 40 });
    assert.ok(bound > previous, `the bound rises with successes at ${successes}`);
    previous = bound;
  }
  assert.ok(clopperPearsonLower({ successes: 45, trials: 50, confidence: 0.99 }) < clopperPearsonLower({ successes: 45, trials: 50 }));
});

test("the Clopper-Pearson bound refuses counts that aren't a sample", () => {
  for (const counts of [{ successes: 11, trials: 10 }, { successes: 2.5, trials: 10 }, { successes: -1, trials: 10 },
    { successes: 1 }, {}]) {
    assert.throws(() => clopperPearsonLower(counts), { code: "CLOPPER_PEARSON_INPUT_INVALID" }, JSON.stringify(counts));
  }
  assert.throws(() => clopperPearsonLower(), { code: "CLOPPER_PEARSON_INPUT_INVALID" });
  for (const confidence of [0, 1, 1.5, Number.NaN]) {
    assert.throws(() => clopperPearsonLower({ successes: 1, trials: 10, confidence }),
      { code: "CLOPPER_PEARSON_CONFIDENCE_INVALID" });
  }
});

test("Student's t quantiles match the tables and the closed forms", () => {
  near(studentTQuantile(0.95, 1), 6.313752, 1e-5, "t(0.95, 1)");
  near(studentTQuantile(0.95, 10), 1.812461, 1e-5, "t(0.95, 10)");
  near(studentTQuantile(0.95, 84), 1.663196, 1e-5, "t(0.95, 84)");
  near(studentTQuantile(0.975, 30), 2.042272, 1e-5, "t(0.975, 30)");
  for (const p of [0.001, 0.1, 0.3, 0.5000001, 0.6, 0.9, 0.95, 0.999]) {
    // One degree of freedom is the Cauchy distribution; with two, t = (2p − 1) / √(2p(1 − p)).
    const cauchy = Math.tan(Math.PI * (p - 0.5));
    near(studentTQuantile(p, 1), cauchy, 1e-9 * Math.max(1, Math.abs(cauchy)), `t(${p}, 1)`);
    const two = (2 * p - 1) / Math.sqrt(2 * p * (1 - p));
    near(studentTQuantile(p, 2), two, 1e-9 * Math.max(1e-6, Math.abs(two)), `t(${p}, 2)`);
    near(studentTQuantile(p, 7), -studentTQuantile(1 - p, 7), 1e-12, `t(${p}, 7) is symmetric`);
  }
  assert.equal(studentTQuantile(0.5, 3), 0);
  for (const p of [0, 1, -0.5, Number.NaN]) assert.throws(() => studentTQuantile(p, 5), { code: "STUDENT_T_PROBABILITY_INVALID" });
  for (const df of [0, -1, Infinity, Number.NaN]) assert.throws(() => studentTQuantile(0.95, df), { code: "STUDENT_T_DEGREES_INVALID" });
});

test("Cohen's kappa on a two-by-two table", () => {
  // 20 pairs:          second yes   second no
  //   first yes            12            3
  //   first no              2            3
  // They agree on 15 of 20, 0.75. The yes rates are 15/20 and 14/20, so chance agreement is
  // 0.75 · 0.7 + 0.25 · 0.3 = 0.6, and kappa = (0.75 − 0.6) / (1 − 0.6) = 0.375.
  const scores = [
    ...Array(12).fill({ first: true, second: true }),
    ...Array(3).fill({ first: true, second: false }),
    ...Array(2).fill({ first: false, second: true }),
    ...Array(3).fill({ first: false, second: false })
  ];
  const result = cohenKappa(scores);
  assert.deepEqual(result, { items: 20, agreements: 15, disagreements: 5, raw_agreement: 0.75, kappa: 0.375 });
  assert.ok(Object.isFrozen(result));
  // Full agreement with both answers in use is 1; a judge who always says yes against one who varies is 0.
  assert.equal(cohenKappa([{ first: true, second: true }, { first: false, second: false }]).kappa, 1);
  assert.equal(cohenKappa([{ first: true, second: true }, { first: true, second: false }]).kappa, 0);
});

test("Cohen's kappa is undefined when the judges give one answer throughout, or there are no items", () => {
  assert.deepEqual(cohenKappa(Array(10).fill({ first: true, second: true })),
    { items: 10, agreements: 10, disagreements: 0, raw_agreement: 1, kappa: null });
  assert.equal(cohenKappa(Array(4).fill({ first: false, second: false })).kappa, null);
  assert.deepEqual(cohenKappa([]), { items: 0, agreements: 0, disagreements: 0, raw_agreement: null, kappa: null });
  for (const scores of [null, [{ first: "yes", second: true }], [{ first: true }], [null], Array(2)]) {
    assert.throws(() => cohenKappa(scores), { code: "COHEN_KAPPA_SCORES_INVALID" });
  }
});

test("recall's weighted estimate and design-based bound match a hand-worked example", () => {
  // Three stretches. Stretch 0: 2 of 4 units drawn (π = 0.5). Stretch 1: 3 of 12 (π = 0.25). Stretch 2: two units with
  // unequal probabilities, 0.6 and 0.4, so its finite population correction uses their mean, 0.5.
  const units = [
    unit("u1", 0, 0.5, 4, 4), unit("u2", 0, 0.5, 3, 2),
    unit("u3", 1, 0.25, 5, 5), unit("u4", 1, 0.25, 2, 2), unit("u5", 1, 0.25, 4, 3),
    unit("u6", 2, 0.6, 3, 3), unit("u7", 2, 0.4, 6, 5)
  ];
  // Weights 1/π are 2, 2, 4, 4, 4, 5/3 and 2.5. Weighted found: 8 + 4 + 20 + 8 + 12 + 5 + 12.5 = 69.5. Weighted
  // asked: 8 + 6 + 20 + 8 + 16 + 5 + 15 = 78. So R = 69.5 / 78 = 139/156 ≈ 0.891026.
  const askedTotal = 2 * 4 + 2 * 3 + 4 * 5 + 4 * 2 + 4 * 4 + 3 / 0.6 + 6 / 0.4;
  const R = (2 * 4 + 2 * 2 + 4 * 5 + 4 * 2 + 4 * 3 + 3 / 0.6 + 5 / 0.4) / askedTotal;
  near(askedTotal, 78, 1e-12, "weighted asked");
  near(R, 139 / 156, 1e-15, "R");
  // z = w · (found − R · asked). In 156ths: 136 and −210; 340, 136 and −352; 85 and −135. They sum to 0.
  const z = [
    [2 * (4 - R * 4), 2 * (2 - R * 3)],
    [4 * (5 - R * 5), 4 * (2 - R * 2), 4 * (3 - R * 4)],
    [(3 - R * 3) / 0.6, (5 - R * 6) / 0.4]
  ];
  near(z[2][1], -135 / 156, 1e-14, "z of u7");
  const variance = (stratumPart(z[0], 0.5) + stratumPart(z[1], 0.25) + stratumPart(z[2], (0.6 + 0.4) / 2)) / askedTotal ** 2;
  // By hand, in 156ths: stretch 0 deviates ±173 from its mean, so Σ(z − z̄)² = 59858; stretch 1 deviates 896/3, 284/3
  // and −1180/3, Σ = 2275872/9; stretch 2 deviates ±110, Σ = 24200. Each is times (1 − f) · n / (n − 1).
  near(variance, (0.5 * 2 * 59858 + 0.75 * 1.5 * 2275872 / 9 + 0.5 * 2 * 24200) / 156 ** 2 / 78 ** 2, 1e-15, "variance");
  const standardError = Math.sqrt(variance);
  // 7 units less 3 stretches: 4 degrees of freedom, where the t quantile has a closed form (Shaw 2006):
  // t = 2√(q − 1), q = cos(arccos(√α) / 3) / √α, α = 4p(1 − p).
  const alpha = 4 * 0.95 * 0.05;
  const t = 2 * Math.sqrt(Math.cos(Math.acos(Math.sqrt(alpha)) / 3) / Math.sqrt(alpha) - 1);
  near(t, 2.131847, 1e-6, "t(0.95, 4)");

  const result = designRatioBound({ units });
  near(result.estimate, R, 1e-15, "estimate");
  near(result.standard_error, standardError, 1e-14, "standard error");
  assert.equal(result.degrees_of_freedom, 4);
  near(result.lower_bound, R - t * standardError, 1e-12, "lower bound");
  near(result.estimate, 0.891026, 1e-6, "estimate by hand");
  near(result.standard_error, 0.049891, 1e-6, "standard error by hand");
  near(result.lower_bound, 0.784665, 1e-6, "lower bound by hand");
  assert.equal(result.sampled_units, 7);
  assert.equal(result.strata, 3);
  assert.deepEqual(result.collapsed_strata, []);
  assert.equal(result.reason, null);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.collapsed_strata));
});

test("a stretch with a single sampled unit is merged with its neighbour for the variance", () => {
  // Stretch 1 has one unit, so it merges with stretch 2, the next one. The merged group's correction uses the mean
  // inclusion probability of its three units, (0.2 + 0.4 + 0.4) / 3.
  const units = [unit("a", 0, 0.5, 4, 4), unit("b", 0, 0.5, 3, 1), unit("c", 1, 0.2, 5, 2), unit("d", 2, 0.4, 2, 2),
    unit("e", 2, 0.4, 6, 5)];
  const merged = designRatioBound({ units });
  assert.deepEqual(merged.collapsed_strata, [[1, 2]]);
  assert.equal(merged.strata, 3);
  assert.equal(merged.degrees_of_freedom, 5 - 2);
  const askedTotal = 2 * 4 + 2 * 3 + 5 / 0.2 + 2 / 0.4 + 6 / 0.4;
  const R = (2 * 4 + 2 * 1 + 2 / 0.2 + 2 / 0.4 + 5 / 0.4) / askedTotal;
  const z0 = [2 * (4 - R * 4), 2 * (1 - R * 3)];
  const z1 = [(2 - R * 5) / 0.2, (2 - R * 2) / 0.4, (5 - R * 6) / 0.4];
  near(merged.estimate, R, 1e-15, "estimate");
  const variance = (stratumPart(z0, 0.5) + stratumPart(z1, (0.2 + 0.4 + 0.4) / 3)) / askedTotal ** 2;
  near(merged.standard_error, Math.sqrt(variance), 1e-14, "standard error");
  near(merged.lower_bound, R - studentTQuantile(0.95, 3) * merged.standard_error, 1e-12, "lower bound");

  // The last stretch, with one unit, merges with the one before it.
  const last = designRatioBound({ units: [unit("a", 0, 0.5, 4, 4), unit("b", 0, 0.5, 3, 1), unit("c", 1, 0.2, 5, 2)] });
  assert.deepEqual(last.collapsed_strata, [[0, 1]]);
  assert.equal(last.degrees_of_freedom, 3 - 1);
  // Merging repeats until no group has a single unit.
  const ends = designRatioBound({ units: [unit("a", 0, 0.5, 2, 2), unit("b", 1, 0.5, 2, 1), unit("c", 1, 0.5, 2, 2),
    unit("d", 2, 0.5, 2, 0)] });
  assert.deepEqual(ends.collapsed_strata, [[0, 1, 2]]);
  assert.equal(ends.degrees_of_freedom, 4 - 1);
  // Strata numbers need not be consecutive: 3 and 5 each have one unit, and 3 merges with 5, the next.
  const twoSingles = designRatioBound({ units: [unit("a", 3, 0.5, 2, 2), unit("b", 5, 0.5, 2, 1), unit("c", 9, 0.5, 2, 2),
    unit("d", 9, 0.5, 2, 0)] });
  assert.deepEqual(twoSingles.collapsed_strata, [[3, 5]]);
  assert.equal(twoSingles.degrees_of_freedom, 4 - 2);
});

test("a stretch taken whole stays on its own and adds no variance or degree of freedom", () => {
  // Stretch 0 is a census of one unit (a short journal): it is never merged. Stretch 1 is sampled with three units.
  const units = [unit("a", 0, 1, 4, 1), unit("b", 1, 0.5, 4, 4), unit("c", 1, 0.5, 3, 1), unit("d", 1, 0.5, 5, 4)];
  const result = designRatioBound({ units });
  assert.deepEqual(result.census_strata, [0]);
  assert.deepEqual(result.collapsed_strata, []);
  assert.equal(result.degrees_of_freedom, 3 - 1, "only the sampled stretch counts");
  const askedTotal = 4 + 2 * 4 + 2 * 3 + 2 * 5;
  const R = (1 + 2 * 4 + 2 * 1 + 2 * 4) / askedTotal;
  near(result.estimate, R, 1e-15, "estimate, the census unit included");
  // The census unit's z is left out of the variance entirely.
  const z = [2 * (4 - R * 4), 2 * (1 - R * 3), 2 * (4 - R * 5)];
  near(result.standard_error, Math.sqrt(stratumPart(z, 0.5)) / askedTotal, 1e-14, "standard error");
  near(result.lower_bound, R - studentTQuantile(0.95, 2) * result.standard_error, 1e-12, "lower bound");
  // A census stretch between two sampled singletons doesn't stop them merging with each other.
  const around = designRatioBound({ units: [unit("a", 0, 0.5, 2, 2), unit("b", 1, 1, 2, 1), unit("c", 1, 1, 2, 2),
    unit("d", 2, 0.5, 2, 0)] });
  assert.deepEqual(around.census_strata, [1]);
  assert.deepEqual(around.collapsed_strata, [[0, 2]]);
  assert.equal(around.degrees_of_freedom, 1);
  // A lone sampled unit beside census stretches leaves no degree of freedom, so no bound.
  const lone = designRatioBound({ units: [unit("a", 0, 1, 3, 3), unit("b", 1, 0.5, 3, 1), unit("c", 2, 1, 3, 2)] });
  assert.equal(lone.degrees_of_freedom, 0);
  assert.equal(lone.lower_bound, null);
  assert.equal(lone.reason, "no degrees of freedom");
});

test("units whose questions all fail together widen the bound", () => {
  // Two stretches of four units, five questions each, 30 of 40 found either way. Together: a unit finds all its
  // questions or none. Spread: every unit misses one or two.
  const sample = (found) => found.map((count, index) => unit(`u${index}`, Math.floor(index / 4), 0.25, 5, count));
  const together = designRatioBound({ units: sample([5, 5, 5, 0, 5, 0, 5, 5]) });
  const spread = designRatioBound({ units: sample([4, 4, 4, 3, 4, 3, 4, 4]) });
  assert.equal(together.estimate, 0.75);
  assert.equal(spread.estimate, 0.75);
  assert.ok(together.standard_error > spread.standard_error);
  assert.ok(together.lower_bound < spread.lower_bound);
  assert.equal(together.degrees_of_freedom, 6);
});

test("the bound stays between 0 and the estimate, and a stretch taken whole adds no variance", () => {
  const wide = designRatioBound({ units: [unit("a", 0, 0.5, 5, 0), unit("b", 0, 0.5, 5, 5)] });
  assert.equal(wide.estimate, 0.5);
  assert.ok(wide.estimate - studentTQuantile(0.95, 1) * wide.standard_error < 0);
  assert.equal(wide.lower_bound, 0);
  // Every unit taken with certainty: nothing was sampled, so recall is exact and its bound is the estimate.
  const census = designRatioBound({ units: [unit("a", 0, 1, 5, 2), unit("b", 0, 1, 5, 5), unit("c", 1, 1, 4, 4)] });
  assert.equal(census.standard_error, 0);
  assert.equal(census.lower_bound, census.estimate);
  assert.equal(census.degrees_of_freedom, 0);
  assert.deepEqual(census.census_strata, [0, 1]);
  assert.equal(census.reason, null);
  // A census of a single unit is exact too.
  const single = designRatioBound({ units: [unit("a", 0, 1, 4, 3)] });
  assert.equal(single.lower_bound, 0.75);
  assert.equal(single.estimate, 0.75);
  assert.equal(single.reason, null);
  const lowConfidence = designRatioBound({ units: [unit("a", 0, 0.5, 5, 3), unit("b", 0, 0.5, 5, 5)], confidence: 0.3 });
  assert.equal(lowConfidence.lower_bound, lowConfidence.estimate);
});

test("a single unit drawn with probability below 1 gives no bound, and nothing asked has no estimate", () => {
  const one = designRatioBound({ units: [unit("a", 0, 0.5, 3, 2)] });
  assert.equal(one.estimate, 2 / 3);
  assert.equal(one.standard_error, null);
  assert.equal(one.lower_bound, null);
  assert.equal(one.degrees_of_freedom, 0);
  assert.equal(one.reason, "no degrees of freedom");
  const none = designRatioBound({ units: [] });
  assert.deepEqual(none, { estimate: null, standard_error: null, degrees_of_freedom: 0, lower_bound: null, sampled_units: 0,
    strata: 0, census_strata: [], collapsed_strata: [], reason: "no sampled unit" });
  const nothingAsked = designRatioBound({ units: [unit("a", 0, 0.5, 0, 0), unit("b", 0, 0.5, 0, 0), unit("c", 1, 0.5, 0, 0),
    unit("d", 1, 0.5, 0, 0)] });
  assert.equal(nothingAsked.estimate, null);
  assert.equal(nothingAsked.standard_error, null);
  assert.equal(nothingAsked.lower_bound, null);
  assert.equal(nothingAsked.reason, "no question asked");
  // A unit with no question is still a sampled unit.
  const partly = designRatioBound({ units: [unit("a", 0, 0.5, 0, 0), unit("b", 0, 0.5, 4, 3), unit("c", 1, 0.5, 2, 2),
    unit("d", 1, 0.5, 3, 3)] });
  assert.equal(partly.sampled_units, 4);
  assert.equal(partly.degrees_of_freedom, 2);
  assert.equal(partly.estimate, 8 / 9);
  assert.equal(typeof partly.lower_bound, "number");
});

test("the design-based bound refuses units that aren't a sample", () => {
  const good = [unit("a", 0, 0.5, 3, 2), unit("b", 0, 0.5, 3, 3)];
  const cases = [
    [[good[0], { ...good[1], unit_id: "a" }], "DESIGN_RATIO_UNIT_DUPLICATE"],
    [[good[0], { ...good[1], found: 4 }], "DESIGN_RATIO_COUNTS_INVALID"],
    [[good[0], { ...good[1], asked: -1, found: 0 }], "DESIGN_RATIO_COUNTS_INVALID"],
    [[good[0], { ...good[1], asked: 2.5 }], "DESIGN_RATIO_COUNTS_INVALID"],
    [[good[0], { ...good[1], inclusion_probability: 0 }], "DESIGN_RATIO_INCLUSION_PROBABILITY_INVALID"],
    [[good[0], { ...good[1], inclusion_probability: 1.2 }], "DESIGN_RATIO_INCLUSION_PROBABILITY_INVALID"],
    [[good[0], { ...good[1], stratum: -1 }], "DESIGN_RATIO_STRATUM_INVALID"],
    [[good[0], { ...good[1], stratum: "0" }], "DESIGN_RATIO_STRATUM_INVALID"],
    [[good[0], { ...good[1], unit_id: undefined }], "DESIGN_RATIO_UNITS_INVALID"],
    [[good[0], null], "DESIGN_RATIO_UNITS_INVALID"],
    [null, "DESIGN_RATIO_UNITS_INVALID"]
  ];
  for (const [units, code] of cases) assert.throws(() => designRatioBound({ units }), { code }, code);
  assert.throws(() => designRatioBound({ units: good, confidence: 1 }), { code: "DESIGN_RATIO_CONFIDENCE_INVALID" });
});

// A sample shaped like the owner's journal: 12 stretches of 8 units, three questions each.
const sampleOf96 = (asked, found) => Array.from({ length: 96 }, (_, index) => unit(`unit-${index}`, Math.floor(index / 8), 8 / 94,
  asked(index), found(index)));
const RECALL = designRatioBound({ units: sampleOf96(() => 3, (index) => (index % 7 === 0 ? 2 : 3)) });
// Of the 32 units whose one question word search missed, words and tags find half.
const GAIN = designRatioBound({ units: sampleOf96((index) => (index % 3 === 0 ? 1 : 0), (index) => (index % 6 === 0 ? 1 : 0)) });

function passingInput() {
  return {
    recall: RECALL,
    recall_estimate: RECALL.estimate,
    recall_words_only_estimate: 0.8,
    critical_recall_estimate: 1,
    critical_recall_words_only_estimate: 0.9,
    gain: GAIN,
    precision: {
      person: { pairs: 1500, correct: 150, sampled: 150 },
      place: { pairs: 400, correct: 149, sampled: 150 },
      organization: { pairs: 60, correct: 60, sampled: 60 },
      topic: { pairs: 800, correct: 148, sampled: 150 },
      event: { pairs: 300, correct: 145, sampled: 150 }
    },
    coverage: { untagged_pages: 2, pages_with_quotes: 1122 },
    anchors: { broken: 0 }
  };
}

const failing = (result) => Object.entries(result.floors).filter(([, floor]) => !floor.holds).map(([name]) => name);

test("the floors are the plan's", () => {
  assert.deepEqual(POINTER_FLOORS, { recall_lower_bound: 0.85, gain_point_estimate: 0.25, precision_lower_bound: 0.90,
    max_untagged_share: 0.02, confidence: 0.95 });
  assert.ok(Object.isFrozen(POINTER_FLOORS));
  assert.deepEqual(POINTER_PRECISION_SAMPLES, { kinds: ["person", "place", "organization", "topic", "event"],
    pairs_per_kind: 150, minimum_kind_pairs: 29 });
  assert.ok(Object.isFrozen(POINTER_PRECISION_SAMPLES) && Object.isFrozen(POINTER_PRECISION_SAMPLES.kinds));
  // 29 is the fewest pairs whose bound can reach the floor when every pair is right.
  assert.ok(clopperPearsonLower({ successes: 29, trials: 29 }) >= 0.9);
  assert.ok(clopperPearsonLower({ successes: 28, trials: 28 }) < 0.9);
});

test("a pass is published when every floor holds", () => {
  assert.equal(RECALL.degrees_of_freedom, 84, "96 units in 12 stretches");
  near(GAIN.estimate, 0.5, 1e-15, "gain");
  const result = pointerFloors(passingInput());
  assert.equal(result.publish, true);
  assert.deepEqual(Object.keys(result.floors), ["recall", "no_loss", "gain", "precision", "coverage", "anchors"]);
  assert.deepEqual(failing(result), []);
  const { recall, no_loss: noLoss, gain, precision, coverage, anchors } = result.floors;
  assert.ok(recall.lower_bound >= 0.85 && recall.lower_bound < recall.estimate);
  assert.equal(recall.minimum, 0.85);
  assert.equal(noLoss.critical, null);
  assert.equal(gain.applicable, true);
  assert.equal(gain.estimate, GAIN.estimate);
  assert.equal(gain.lower_bound, GAIN.lower_bound);
  near(precision.topic.lower_bound, 0.958625, 1e-6, "148 of 150");
  near(precision.event.lower_bound, 0.931195, 1e-6, "145 of 150");
  assert.equal(precision.organization.sampled, 60, "all of a kind's pairs when it has fewer than 150");
  assert.deepEqual(Object.keys(precision), ["holds", "minimum", "person", "place", "organization", "topic", "event"]);
  assert.equal(coverage.untagged_share, 2 / 1122);
  assert.deepEqual(anchors, { holds: true, broken: 0 });
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.floors) && Object.values(result.floors).every(Object.isFrozen));
});

test("each floor fails on its own", () => {
  const cases = [
    ["recall unknown", { recall: null }, "recall"],
    ["recall bound 0.84", { recall: { ...RECALL, lower_bound: 0.84 } }, "recall"],
    ["recall bound not computable", { recall: designRatioBound({ units: [unit("a", 0, 0.5, 3, 3)] }) }, "recall"],
    ["a loss on all questions", { recall_words_only_estimate: RECALL.estimate + 0.01 }, "no_loss"],
    ["a loss on critical questions only", { critical_recall_estimate: 0.85 }, "no_loss"],
    ["gain 0.24", { gain: { ...GAIN, estimate: 0.24 } }, "gain"],
    ["topics 130 of 150", { precision: { ...passingInput().precision, topic: { pairs: 800, correct: 130, sampled: 150 } } },
      "precision"],
    ["places 135 of 150", { precision: { ...passingInput().precision, place: { pairs: 400, correct: 135, sampled: 150 } } },
      "precision"],
    ["events 140 of 150", { precision: { ...passingInput().precision, event: { pairs: 300, correct: 140, sampled: 150 } } },
      "precision"],
    ["a kind with too few pairs", { precision: { ...passingInput().precision, event: { pairs: 20, correct: 20, sampled: 20 } } },
      "precision"],
    ["3% of pages untagged", { coverage: { untagged_pages: 3, pages_with_quotes: 100 } }, "coverage"],
    ["no page with quotes", { coverage: { untagged_pages: 0, pages_with_quotes: 0 } }, "coverage"],
    ["a broken anchor", { anchors: { broken: 1 } }, "anchors"]
  ];
  for (const [label, change, floor] of cases) {
    const result = pointerFloors({ ...passingInput(), ...change });
    assert.deepEqual(failing(result), [floor], label);
    assert.equal(result.publish, false, label);
  }
});

test("recall fails when it is unknown or its bound is below the floor", () => {
  const unknown = pointerFloors({ ...passingInput(), recall: null }).floors.recall;
  assert.deepEqual(unknown, { holds: false, estimate: null, lower_bound: null, minimum: 0.85,
    reason: "recall unknown: a sampled unit is a nonresponse" });
  const low = pointerFloors({ ...passingInput(), recall: { ...RECALL, lower_bound: 0.84 } }).floors.recall;
  assert.equal(low.holds, false);
  assert.equal(low.lower_bound, 0.84);
  const single = pointerFloors({ ...passingInput(), recall: designRatioBound({ units: [unit("a", 0, 0.5, 3, 3)] }) }).floors.recall;
  assert.equal(single.reason, "no degrees of freedom");
  assert.equal(pointerFloors({ ...passingInput(), recall: { ...RECALL, lower_bound: 0.85 } }).floors.recall.holds, true);
});

test("no loss is judged on all questions alone when the sample has no critical question", () => {
  const noCritical = { ...passingInput(), critical_recall_estimate: null, critical_recall_words_only_estimate: null };
  const holds = pointerFloors(noCritical).floors.no_loss;
  assert.equal(holds.holds, true);
  assert.equal(holds.critical, "no critical question in the sample");
  const loss = pointerFloors({ ...noCritical, recall_words_only_estimate: RECALL.estimate + 0.01 }).floors.no_loss;
  assert.equal(loss.holds, false);
  assert.equal(loss.critical, "no critical question in the sample");
  const critical = pointerFloors({ ...passingInput(), critical_recall_estimate: 0.85 }).floors.no_loss;
  assert.deepEqual(critical, { holds: false, recall_estimate: RECALL.estimate, recall_words_only_estimate: 0.8,
    critical_recall_estimate: 0.85, critical_recall_words_only_estimate: 0.9, critical: null, reason: null });
  // Equal is no loss; unknown estimates can't show there is none.
  assert.equal(pointerFloors({ ...passingInput(), recall_words_only_estimate: RECALL.estimate }).floors.no_loss.holds, true);
  const unknown = pointerFloors({ ...passingInput(), recall_estimate: null, recall_words_only_estimate: null }).floors.no_loss;
  assert.equal(unknown.holds, false);
  assert.equal(unknown.reason, "recall unknown");
});

test("gain is on the point estimate, and not applicable when word search misses nothing", () => {
  const nothingMissed = pointerFloors({ ...passingInput(), gain: null });
  assert.equal(nothingMissed.publish, true);
  assert.deepEqual(nothingMissed.floors.gain, { holds: true, applicable: false, estimate: null, lower_bound: null, minimum: 0.25,
    reason: "word search misses no sampled question" });
  assert.equal(pointerFloors({ ...passingInput(), gain: { ...GAIN, estimate: 0.24 } }).floors.gain.holds, false);
  assert.equal(pointerFloors({ ...passingInput(), gain: { ...GAIN, estimate: 0.25 } }).floors.gain.holds, true);
  // The lower bound is only reported.
  const lowBound = pointerFloors({ ...passingInput(), gain: { ...GAIN, estimate: 0.3, lower_bound: 0.05 } }).floors.gain;
  assert.equal(lowBound.holds, true);
  assert.equal(lowBound.lower_bound, 0.05);
});

test("precision is gated for every kind, each on its own sample", () => {
  const withKinds = (kinds) => pointerFloors({ ...passingInput(), precision: { ...passingInput().precision, ...kinds } }).floors.precision;
  // Perfect pairs of other kinds can't carry a failing kind.
  const carried = withKinds({ topic: { pairs: 800, correct: 130, sampled: 150 } });
  assert.equal(carried.holds, false);
  assert.equal(carried.topic.holds, false);
  near(carried.topic.lower_bound, 0.812176, 1e-6, "130 of 150");
  assert.equal(carried.person.holds, true);
  // A name of the wrong kind ("Apple" the fruit as an organization) fails its own kind.
  const wrongKind = withKinds({ organization: { pairs: 60, correct: 40, sampled: 60 } });
  assert.equal(wrongKind.holds, false);
  assert.equal(wrongKind.organization.holds, false);
  // A kind the generation has no pairs of has nothing to gate.
  const noEvents = withKinds({ event: { pairs: 0, correct: 0, sampled: 0 } });
  assert.equal(noEvents.holds, true);
  assert.deepEqual(noEvents.event, { holds: true, applicable: false, pairs: 0, correct: 0, sampled: 0, lower_bound: null,
    reason: "no pairs of this kind" });
  // A kind with fewer than 29 pairs should have been left out of the generation, so it fails even when all are right.
  const tooFew = withKinds({ event: { pairs: 20, correct: 20, sampled: 20 } });
  assert.equal(tooFew.event.holds, false);
  assert.match(tooFew.event.reason, /should have been left out/);
  near(tooFew.event.lower_bound, 0.860892, 1e-6, "20 of 20");
  // A kind with fewer pairs than its sample size is judged on all of them.
  const small = withKinds({ event: { pairs: 40, correct: 40, sampled: 40 } });
  assert.equal(small.event.holds, true);
});

test("coverage allows at most 2% of the pages with quotes untagged", () => {
  const over = pointerFloors({ ...passingInput(), coverage: { untagged_pages: 3, pages_with_quotes: 100 } }).floors.coverage;
  assert.deepEqual(over, { holds: false, untagged_pages: 3, pages_with_quotes: 100, untagged_share: 0.03, maximum: 0.02 });
  const atLimit = pointerFloors({ ...passingInput(), coverage: { untagged_pages: 2, pages_with_quotes: 100 } }).floors.coverage;
  assert.equal(atLimit.holds, true);
  const empty = pointerFloors({ ...passingInput(), coverage: { untagged_pages: 0, pages_with_quotes: 0 } }).floors.coverage;
  assert.equal(empty.holds, false);
  assert.equal(empty.untagged_share, null);
});

test("a pass with no tags fails", () => {
  const none = { pairs: 0, correct: 0, sampled: 0 };
  const result = pointerFloors({ ...passingInput(), recall_estimate: 0.8, gain: { ...GAIN, estimate: 0, lower_bound: 0 },
    precision: { person: none, place: none, organization: none, topic: none, event: none },
    coverage: { untagged_pages: 1122, pages_with_quotes: 1122 } });
  assert.equal(result.publish, false);
  // Coverage catches it even when word search misses nothing.
  assert.deepEqual(failing(result), ["gain", "coverage"]);
  assert.deepEqual(failing(pointerFloors({ ...passingInput(), gain: null,
    precision: { person: none, place: none, organization: none, topic: none, event: none },
    coverage: { untagged_pages: 1122, pages_with_quotes: 1122 } })), ["coverage"]);
});

test("the floors refuse malformed input", () => {
  const cases = [
    [{ recall: undefined }, "POINTER_FLOORS_RECALL_INVALID"],
    [{ recall: { estimate: 0.9, lower_bound: "0.86" } }, "POINTER_FLOORS_RECALL_INVALID"],
    [{ recall_estimate: 1.2 }, "POINTER_FLOORS_NO_LOSS_INVALID"],
    [{ recall_words_only_estimate: undefined }, "POINTER_FLOORS_NO_LOSS_INVALID"],
    [{ critical_recall_estimate: null }, "POINTER_FLOORS_NO_LOSS_INVALID"],
    [{ gain: undefined }, "POINTER_FLOORS_GAIN_INVALID"],
    [{ precision: { ...passingInput().precision, topic: { pairs: 800, correct: 151, sampled: 150 } } }, "POINTER_FLOORS_PRECISION_INVALID"],
    // The sample is 150 of a kind's pairs, or all of them when there are fewer.
    [{ precision: { ...passingInput().precision, topic: { pairs: 800, correct: 100, sampled: 100 } } }, "POINTER_FLOORS_PRECISION_INVALID"],
    [{ precision: { ...passingInput().precision, event: { pairs: 40, correct: 30, sampled: 30 } } }, "POINTER_FLOORS_PRECISION_INVALID"],
    [{ precision: { ...passingInput().precision, person: { pairs: 2000, correct: 40, sampled: 40 } } }, "POINTER_FLOORS_PRECISION_INVALID"],
    [{ precision: { topic: { pairs: 0, correct: 0, sampled: 0 }, event: { pairs: 0, correct: 0, sampled: 0 } } }, "POINTER_FLOORS_PRECISION_INVALID"],
    [{ precision: null }, "POINTER_FLOORS_PRECISION_INVALID"],
    [{ coverage: { untagged_pages: 5, pages_with_quotes: 4 } }, "POINTER_FLOORS_COVERAGE_INVALID"],
    [{ anchors: { broken: -1 } }, "POINTER_FLOORS_ANCHORS_INVALID"]
  ];
  for (const [change, code] of cases) assert.throws(() => pointerFloors({ ...passingInput(), ...change }), { code }, code);
  assert.throws(() => pointerFloors(null), { code: "POINTER_FLOORS_INPUT_INVALID" });
});
