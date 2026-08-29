import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildCompleteDecisionCards,
  buildCompleteSemanticDiff
} from "../src/authoring/semantic-diff-policy.mjs";
import { assessRegressionCoverage } from "../src/authoring/proposal-builder.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseline = JSON.parse(fs.readFileSync(path.join(root, "guide-graphs", "compiled", "bundle.json"), "utf8"));

function clone() {
  return structuredClone(baseline);
}

function firstNode(bundle) {
  return bundle.graphs[0].nodes[0];
}

function refreshDerivedStats(bundle) {
  bundle.stats.graphCount = bundle.graphs.length;
  bundle.stats.nodeCount = bundle.graphs.reduce((sum, graph) => sum + graph.nodes.length, 0);
  bundle.stats.edgeCount = bundle.graphs.reduce((sum, graph) => sum + graph.edges.length, 0);
  bundle.stats.sourceSectionCount = (bundle.sourceMaps ?? []).reduce((sum, map) => sum + (map.sections?.length ?? 0), 0);
  return bundle;
}

const nodeMutations = [
  ["title", "reviewed-substantive", (node) => { node.title += " revised"; }],
  ["kind", "substantive-structural", (node) => { node.kind += "-revised"; }],
  ["tier", "substantive-routing", (node) => { node.tier = node.tier === 9 ? 8 : node.tier + 1; }],
  ["priority", "substantive-routing", (node) => { node.priority = node.priority === 100 ? 99 : node.priority + 1; }],
  ["activation", "substantive-routing-safety", (node) => { node.activation.any = [{ field: "activation", op: "eq", value: "moderate" }]; }],
  ["sourceRefs", "provenance-policy", (node) => { node.sourceRefs = [...node.sourceRefs, "OWNER.2025-12-20.02"]; }],
  ["authority", "provenance-policy", (node) => { node.authority += "-reviewed"; }],
  ["recommendations", "therapeutic-response", (node) => { node.recommendations = [...node.recommendations, "A reviewed response."]; }],
  ["avoid", "therapeutic-safety", (node) => { node.avoid = [...node.avoid, "A reviewed caution."]; }],
  ["successSignals", "therapeutic-evaluation", (node) => { node.successSignals = [...node.successSignals, "A reviewed signal."]; }],
  ["tags", "reviewed-metadata", (node) => { node.tags = [...node.tags, "reviewed-tag"]; }],
  ["effects.deferNodes", "substantive-gating", (node) => { node.effects.deferNodes = [...node.effects.deferNodes, "IC.DEEP_CHILD_DIALOGUE"]; }],
  ["effects.blockNodes", "substantive-gating-safety", (node) => { node.effects.blockNodes = [...node.effects.blockNodes, "IC.DEEP_CHILD_DIALOGUE"]; }],
  ["effects.requiredNuance", "response-semantics", (node) => { node.effects.requiredNuance = [...node.effects.requiredNuance, "Preserve this nuance."]; }],
  ["effects.forbiddenOverclaims", "response-safety", (node) => { node.effects.forbiddenOverclaims = [...node.effects.forbiddenOverclaims, "Do not overclaim this."]; }],
  ["defaultQuestion", "substantive-response-routing", (node) => { node.defaultQuestion += " Now?"; }]
];

for (const [fieldPath, classification, mutate] of nodeMutations) {
  test(`complete semantic diff classifies ${fieldPath}`, () => {
    const candidate = clone();
    mutate(firstNode(candidate));
    const diff = buildCompleteSemanticDiff(baseline, candidate);
    assert.equal(diff.changes.length, 1);
    assert.equal(diff.changes[0].fieldPath, fieldPath);
    assert.equal(diff.changes[0].classification, classification);
    assert.equal(diff.changes[0].substantive, true);
    const cards = buildCompleteDecisionCards(diff);
    assert.equal(cards.length, 1);
    assert.equal(cards[0].pros.length, 1);
    assert.equal(cards[0].cons.length, 1);
    assert.doesNotMatch(cards[0].cons[0], /current value is harmful|old rule/i);
  });
}

test("complete semantic diff classifies graph description and graph membership", () => {
  const candidate = clone();
  candidate.graphs[0].description += " reviewed";
  const description = buildCompleteSemanticDiff(baseline, candidate);
  assert.deepEqual(description.changes.map((item) => [item.fieldPath, item.classification]), [["description", "reviewed-metadata"]]);
  assert.equal(buildCompleteDecisionCards(description).length, 1);

  const removed = clone();
  removed.graphs.pop();
  refreshDerivedStats(removed);
  assert.ok(buildCompleteSemanticDiff(baseline, removed).changes.some((item) => item.classification === "substantive-graph-membership"));
});

test("complete semantic diff classifies node and edge additions/removals", () => {
  const addedNode = clone();
  const node = structuredClone(firstNode(addedNode));
  node.id = "IC.TEST_ONLY_ADD";
  addedNode.graphs[0].nodes.push(node);
  refreshDerivedStats(addedNode);
  assert.deepEqual(buildCompleteSemanticDiff(baseline, addedNode).changes.map((item) => item.classification), ["substantive-node-membership"]);

  const removedNode = clone();
  const removedId = removedNode.graphs[0].nodes.pop().id;
  removedNode.graphs[0].edges = removedNode.graphs[0].edges.filter((edge) => edge.from !== removedId && edge.to !== removedId);
  refreshDerivedStats(removedNode);
  assert.ok(buildCompleteSemanticDiff(baseline, removedNode).changes.some((item) => item.classification === "substantive-node-membership"));

  const addedEdge = clone();
  const [from, to] = addedEdge.graphs[0].nodes.slice(0, 2).map((item) => item.id);
  addedEdge.graphs[0].edges.push({ from, relation: "test-only", to });
  refreshDerivedStats(addedEdge);
  assert.ok(buildCompleteSemanticDiff(baseline, addedEdge).changes.some((item) => item.classification === "substantive-topology"));

  const removedEdge = clone();
  removedEdge.graphs[0].edges.pop();
  refreshDerivedStats(removedEdge);
  assert.ok(buildCompleteSemanticDiff(baseline, removedEdge).changes.some((item) => item.classification === "substantive-topology"));
});

test("complete semantic diff includes affected cases and stable decision ids", () => {
  const candidate = clone();
  const node = firstNode(candidate);
  node.priority = node.priority === 100 ? 99 : node.priority + 1;
  const cases = [{ id: "T001", title: "Synthetic", affectedNodeIds: [node.id] }];
  const first = buildCompleteSemanticDiff(baseline, candidate, { regressionCases: cases });
  const second = buildCompleteSemanticDiff(baseline, candidate, { affectedCases: cases });
  assert.deepEqual(first, second);
  assert.deepEqual(first.affectedCases, cases);
  assert.deepEqual(buildCompleteDecisionCards(first), buildCompleteDecisionCards(second));
});

test("complete semantic diff rejects generated, immutable, and unclassified changes", () => {
  for (const mutate of [
    (bundle) => { bundle.graphs[0].version += "-edited"; },
    (bundle) => { bundle.graphs[0].contractVersion = "future-contract"; },
    (bundle) => { bundle.graphs[0].bundleVersion += "-edited"; }
  ]) {
    const candidate = clone();
    mutate(candidate);
    assert.throws(() => buildCompleteSemanticDiff(baseline, candidate), { code: "PROHIBITED_SEMANTIC_CHANGE" });
  }

  const unknownNode = clone();
  firstNode(unknownNode).futureField = true;
  assert.throws(() => buildCompleteSemanticDiff(baseline, unknownNode), { code: "UNCLASSIFIED_SEMANTIC_CHANGE" });

  const unknownBundle = clone();
  unknownBundle.futureField = true;
  assert.throws(() => buildCompleteSemanticDiff(baseline, unknownBundle), { code: "UNCLASSIFIED_SEMANTIC_CHANGE" });

  const unknownStats = clone();
  unknownStats.stats.futureField = true;
  assert.throws(() => buildCompleteSemanticDiff(baseline, unknownStats), { code: "UNCLASSIFIED_SEMANTIC_CHANGE" });

  const changedSources = clone();
  changedSources.sourceMaps[0].sections[0].heading += " changed";
  assert.throws(() => buildCompleteSemanticDiff(baseline, changedSources), { code: "PROHIBITED_SEMANTIC_CHANGE" });
});

function coverageRow({ id, nodeId, matched = [], expected = {}, variables = {} }) {
  return { id, title: id, declared: true, affectedNodeIds: [nodeId], definition: { id, expected, variables }, baseline: { matched: [], selected: [], blocked: [] }, candidate: { ok: true, matched, selected: matched, blocked: [] } };
}

test("coverage policy requires both sides of activation and gating boundaries", () => {
  const nodeId = "IC.TEST";
  const diff = { changedNodeIds: [nodeId], changes: [{ entityType: "node", entityId: nodeId, fieldPath: "activation", classification: "substantive-routing-safety" }] };
  const matching = coverageRow({ id: "MATCH", nodeId, matched: [nodeId] });
  const oneSided = assessRegressionCoverage(diff, [matching]);
  assert.equal(oneSided.ok, false);
  assert.ok(oneSided.gaps.some((item) => /matching and non-matching/.test(item.requirement)));
  const nonMatchingNegative = coverageRow({ id: "NO_MATCH", nodeId, variables: { present_safety: "unsafe" } });
  assert.equal(assessRegressionCoverage(diff, [matching, nonMatchingNegative]).ok, true);
});

test("coverage policy requires exact questions and response realization assertions", () => {
  const nodeId = "IC.TEST";
  const question = { changedNodeIds: [nodeId], changes: [{ entityType: "node", entityId: nodeId, fieldPath: "defaultQuestion", classification: "substantive-response-routing", after: "Exact candidate question?" }] };
  assert.equal(assessRegressionCoverage(question, [coverageRow({ id: "Q", nodeId, expected: { nextQuestion: "Different?" } })]).ok, false);
  assert.equal(assessRegressionCoverage(question, [coverageRow({ id: "Q", nodeId, expected: { nextQuestion: "Exact candidate question?" } })]).ok, true);

  for (const [fieldPath, expectation] of [["effects.requiredNuance", "requiredNuancePatterns"], ["effects.forbiddenOverclaims", "forbiddenOverclaimPatterns"]]) {
    const diff = { changedNodeIds: [nodeId], changes: [{ entityType: "node", entityId: nodeId, fieldPath, classification: "response-semantics" }] };
    assert.equal(assessRegressionCoverage(diff, [coverageRow({ id: "R", nodeId })]).ok, false);
    assert.equal(assessRegressionCoverage(diff, [coverageRow({ id: "R", nodeId, expected: { [expectation]: ["exact pattern"] } })]).ok, true);
  }
});
