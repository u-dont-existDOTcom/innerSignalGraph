import test from "node:test";
import assert from "node:assert/strict";
import { replayReviewRequiresRetry } from "../src/dev/replay-review-admission.mjs";

const verdicts = ["improved", "not-improved", "human-decision"];

for (const verdict of verdicts) {
  for (const addresses_feedback of [false, true]) {
    for (const preserves_prior_strengths of [false, true]) {
      for (const introduces_new_overclaim of [false, true]) {
        test(`replay admission: ${verdict}; feedback=${addresses_feedback}; preservation=${preserves_prior_strengths}; overclaim=${introduces_new_overclaim}`, () => {
          const expected = verdict === "not-improved"
            || (verdict !== "human-decision" && addresses_feedback !== true)
            || preserves_prior_strengths !== true
            || introduces_new_overclaim === true;
          assert.equal(replayReviewRequiresRetry({ verdict, addresses_feedback, preserves_prior_strengths, introduces_new_overclaim }), expected);
        });
      }
    }
  }
}

for (const invalid of [undefined, null, 0, 1, "true", "false", {}, []]) {
  test(`replay admission rejects non-true preservation value ${JSON.stringify(invalid)}`, () => {
    assert.equal(replayReviewRequiresRetry({ verdict: "improved", addresses_feedback: true, preserves_prior_strengths: invalid, introduces_new_overclaim: false }), true);
  });
}
