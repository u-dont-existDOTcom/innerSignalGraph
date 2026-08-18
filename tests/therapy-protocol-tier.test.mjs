import test from "node:test";
import assert from "node:assert/strict";
import { mergeProtocolTier } from "../src/orchestrator/run-tiered-pipeline.mjs";

test("protocol review raises fast routing to reviewed without losing delta count", () => {
  const merged = mergeProtocolTier(
    { tier: "fast", reason: "low ambiguity", forced: false, deltaCount: 3 },
    { tier: "reviewed", reason: "protocol authority review", forced: false }
  );
  assert.equal(merged.tier, "reviewed");
  assert.equal(merged.deltaCount, 3);
  assert.match(merged.reason, /protocol authority review/);
  assert.match(merged.reason, /low ambiguity/);
});

test("protocol forensic override defeats requested fast routing", () => {
  const merged = mergeProtocolTier(
    { tier: "fast", reason: "user-selected fast mode", forced: false, deltaCount: 1 },
    { tier: "forensic", reason: "protocol safety override", forced: true }
  );
  assert.equal(merged.tier, "forensic");
  assert.equal(merged.forced, true);
});

test("protocol review never downgrades a deep or forensic base route", () => {
  const deep = { tier: "deep", reason: "user-selected deep review", forced: false, deltaCount: 0 };
  const forensic = { tier: "forensic", reason: "safety-sensitive formulation", forced: true, deltaCount: 0 };
  const override = { tier: "reviewed", reason: "protocol review", forced: false };
  assert.strictEqual(mergeProtocolTier(deep, override), deep);
  assert.strictEqual(mergeProtocolTier(forensic, override), forensic);
});
