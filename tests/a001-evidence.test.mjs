import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

async function readJson(path) {
  return JSON.parse(await fs.readFile(path, "utf8"));
}

const expectedFollowUps = [
  "I don't know what the younger part wants.",
  "It says nothing I do will count.",
  "I made the caring agreement and missed it.",
  "Now I feel I owe a week of perfect care.",
  "The resentment gets stronger when the child is unimpressed.",
  "I think the younger adult actually did have choices.",
  "My present life still contains the same unsafe conditions.",
  "I don't experience these as parts; that framing feels artificial.",
  "I kept the agreement, but I don't feel any more trust.",
  "Relaxation helped me feel calmer, but the conflict is unchanged."
];

test("A001 trajectory scope remains exactly the ten owner-directed branches", async () => {
  const evidence = await readJson("analysis/a001/trajectory-cases.json");
  assert.equal(evidence.scope, "A001-only independent one-question longitudinal branches");
  assert.deepEqual(evidence.trajectories.map((item) => item.followUp), expectedFollowUps);
  assert.deepEqual(evidence.trajectories.map((item) => item.id), [
    "T01", "T02", "T03", "T04", "T05", "T06", "T07", "T08", "T09", "T10"
  ]);
});

test("tracked A001 artifacts retain the privacy-minimized boundary", async () => {
  const baseline = await readJson("analysis/a001/baseline-live.json");
  const candidates = await readJson("analysis/a001/candidates/manifest.json");
  const blind = await readJson("analysis/a001/blind-evaluation.json");
  const trajectories = await readJson("analysis/a001/trajectory-evaluation.json");

  assert.equal(baseline.privacyBoundary.verbatimInputDuplicated, false);
  assert.equal(baseline.privacyBoundary.generatedTherapyProseStored, false);
  assert.equal(candidates.privacyBoundary.candidateProseStoredInGit, false);
  assert.equal(blind.privacyBoundary.verbatimInputStoredHere, false);
  assert.equal(blind.privacyBoundary.candidateProseStoredHere, false);
  assert.equal(trajectories.privacyBoundary.verbatimInputStoredHere, false);
  assert.equal(trajectories.privacyBoundary.candidateOrContinuationProseStoredHere, false);
});

test("actual production remains blocked before A001 transmission and is never substituted", async () => {
  const baseline = await readJson("analysis/a001/baseline-live.json");
  const blind = await readJson("analysis/a001/blind-evaluation.json");
  const access = Object.fromEntries(baseline.actualProduction.modelAccess.map((item) => [item.requestedModel, item.ok]));

  assert.equal(baseline.actualProduction.status, "blocked-before-user-transmission");
  assert.equal(access["gpt-5.6-sol"], true);
  assert.equal(access["claude-opus-5"], false);
  assert.equal(access["claude-sonnet-4-6"], false);
  assert.match(baseline.actualProduction.executionBoundaryDiagnosis.questionTransmission, /was not sent/);
  assert.equal(blind.actualProductionBaseline.evaluated, false);
  assert.equal(blind.actualProductionBaseline.substituted, false);
  assert.equal(blind.evaluators.opus.substituted, false);
});

test("hard failures stay visible in the blind first-response filter", async () => {
  const evidence = await readJson("analysis/a001/blind-evaluation.json");
  const byId = Object.fromEntries(evidence.results.map((item) => [item.sourceId, item]));

  assert.deepEqual(byId.S.hardFailureIds, ["ignores_external_reality"]);
  assert.equal(byId.S.verdict, "filter_out");
  for (const id of ["B", "C", "D"]) {
    assert.deepEqual(byId[id].hardFailureIds, []);
    assert.equal(byId[id].verdict, "advance");
  }
  assert.equal(evidence.rubric.hardFailureCanWin, false);
});

test("only B and D qualify in coherent ten-trajectory Codex rounds", async () => {
  const evidence = await readJson("analysis/a001/trajectory-evaluation.json");
  const expectedIds = ["T01", "T02", "T03", "T04", "T05", "T06", "T07", "T08", "T09", "T10"];
  const qualified = Object.fromEntries(evidence.qualifiedByCodex.map((item) => [item.sourceId, item]));

  assert.deepEqual(Object.keys(qualified).sort(), ["B", "D"]);
  for (const [id, revision] of [["B", "v3"], ["D", "v5"]]) {
    assert.equal(qualified[id].trajectoryRevision, revision);
    const round = evidence.rounds.find((item) => item.revision === revision);
    const result = round.results.find((item) => item.sourceId === id);
    assert.equal(result.allTrajectoriesPass, true);
    assert.deepEqual(result.passedTrajectoryIds, expectedIds);
    assert.deepEqual(result.failedTrajectoryIds, []);
    assert.equal(qualified[id].generatorResponseIds.length, 10);
  }

  const cRounds = evidence.rounds.flatMap((round) => round.results
    .filter((item) => item.sourceId === "C")
    .map((item) => ({ revision: round.revision, ...item })));
  assert.equal(cRounds.some((item) => item.allTrajectoriesPass === true), false);
  assert.deepEqual(cRounds.at(-1).failedTrajectoryIds, ["T05"]);
});

test("engineering filters cannot open the owner or production gate", async () => {
  const task = await readJson("tasks/ACTIVE-TASK.json");
  const blind = await readJson("analysis/a001/blind-evaluation.json");
  const trajectories = await readJson("analysis/a001/trajectory-evaluation.json");

  assert.equal(task.status, "active");
  assert.equal(task.ownerGate.noPolicyEncodingBeforeGate, true);
  assert.equal(blind.engineeringFilter.ownerGateReady, false);
  assert.equal(trajectories.ownerGate.ready, false);
  assert.equal(trajectories.ownerGate.automatedScoresAreFinalAuthority, false);
});
