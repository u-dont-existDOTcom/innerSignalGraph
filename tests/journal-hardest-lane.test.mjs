import test from "node:test";
import assert from "node:assert/strict";
import { applyHardestDailyLimit } from "../src/journal-import/private-runtime.mjs";

test("the hardest daily limit pauses, resets on the next UTC day, and replay does not count", () => {
  const state = { blocker: null };
  let instant = "2026-09-28T23:59:00.000Z";
  const now = () => new Date(instant);
  assert.equal(applyHardestDailyLimit(state, { now, dailyLimit: 1 }), true);
  assert.deepEqual(state.hardest_lane, { day: "2026-09-28", sent: 1 });
  assert.equal(applyHardestDailyLimit(state, { now, dailyLimit: 1, newlySent: false }), true);
  assert.equal(state.hardest_lane.sent, 1, "a replayed hardest answer is not a new send");
  assert.equal(applyHardestDailyLimit(state, { now, dailyLimit: 1 }), false);
  assert.equal(state.blocker, "HARDEST_DAILY_LIMIT");
  instant = "2026-09-29T00:00:00.000Z";
  assert.equal(applyHardestDailyLimit(state, { now, dailyLimit: 1 }), true);
  assert.deepEqual(state.hardest_lane, { day: "2026-09-29", sent: 1 });
  assert.equal(state.blocker, null);
});
