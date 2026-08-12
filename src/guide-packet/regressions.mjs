import { readZipEntries } from "../core/zip.mjs";
import { planFromGraphs } from "../guide-graph/planner.mjs";
import { appOwnedCopy, ROUTE_IDS } from "../hypnosis/app-owned-copy.mjs";

function parseJson(entries, name) {
  const data = entries.get(name);
  if (!data) throw new Error(`Affected-case regression member is missing: ${name}.`);
  return JSON.parse(data.toString("utf8"));
}

function collectCases(entries) {
  return [...entries.keys()]
    .filter((name) => name.startsWith("tests/decision-cases/") && name.endsWith(".json"))
    .sort()
    .map((name) => parseJson(entries, name));
}

function includesText(values, expected) {
  return values.some((value) => String(value).toLowerCase().includes(String(expected).toLowerCase()));
}

function failUnless(failures, condition, message) {
  if (!condition) failures.push(message);
}

function runPlannerCase(testCase, graphBundle) {
  const failures = [];
  const plan = planFromGraphs({ variables: testCase.variables ?? {}, unknowns: testCase.unknowns ?? [], graphs: graphBundle.graphs ?? [] });
  const expected = testCase.expectations ?? {};
  if (expected.primaryJobId) failUnless(failures, plan.primaryJob?.id === expected.primaryJobId, `Expected primary job ${expected.primaryJobId}, received ${plan.primaryJob?.id ?? "none"}.`);
  const selected = new Set(plan.selectedNodes.map((node) => node.id));
  for (const id of expected.selectedNodeIds ?? []) failUnless(failures, selected.has(id), `Expected selected node ${id}.`);
  for (const id of expected.excludedNodeIds ?? []) failUnless(failures, !selected.has(id), `Node ${id} must not be selected.`);
  const deferred = new Set(plan.deferredNodes.map((node) => node.id));
  for (const id of expected.deferredNodeIds ?? []) failUnless(failures, deferred.has(id), `Expected deferred node ${id}.`);
  for (const text of expected.nextQuestionIncludes ?? []) failUnless(failures, String(plan.nextQuestion).toLowerCase().includes(String(text).toLowerCase()), `Next question must include ${JSON.stringify(text)}.`);
  for (const text of expected.requiredNuanceIncludes ?? []) failUnless(failures, includesText(plan.requiredNuance, text), `Required nuance must include ${JSON.stringify(text)}.`);
  for (const text of expected.forbiddenOverclaimIncludes ?? []) failUnless(failures, includesText(plan.forbiddenOverclaims, text), `Forbidden overclaims must include ${JSON.stringify(text)}.`);
  return { failures, evidence: { primaryJobId: plan.primaryJob?.id ?? null, selectedNodeIds: [...selected], deferredNodeIds: [...deferred], nextQuestion: plan.nextQuestion } };
}

function graphByNodeId(graphBundle, id) {
  return (graphBundle.graphs ?? []).find((graph) => (graph.nodes ?? []).some((node) => node.id === id));
}

function runGraphStructureCase(testCase, graphBundle) {
  const failures = [];
  const expected = testCase.expectations ?? {};
  const graph = graphByNodeId(graphBundle, expected.nodeId);
  const node = graph?.nodes?.find((item) => item.id === expected.nodeId);
  failUnless(failures, Boolean(node), `Expected graph node ${expected.nodeId}.`);
  if (!node) return { failures, evidence: {} };
  for (const text of expected.recommendationIncludes ?? []) failUnless(failures, includesText(node.recommendations ?? [], text), `${expected.nodeId} recommendations must include ${JSON.stringify(text)}.`);
  for (const text of expected.defaultQuestionIncludes ?? []) failUnless(failures, String(node.defaultQuestion ?? "").toLowerCase().includes(String(text).toLowerCase()), `${expected.nodeId} default question must include ${JSON.stringify(text)}.`);
  for (const edgeFrom of expected.inboundEdgesFrom ?? []) {
    const present = (graph.edges ?? []).some((edge) => edge.from === edgeFrom && edge.to === expected.nodeId);
    failUnless(failures, present, `Expected edge ${edgeFrom} -> ${expected.nodeId}.`);
  }
  for (const condition of expected.activationIncludes ?? []) {
    const present = (node.activation?.[condition.group] ?? []).some((item) => item.field === condition.field && item.op === condition.op && JSON.stringify(item.value) === JSON.stringify(condition.value));
    failUnless(failures, present, `${expected.nodeId} activation.${condition.group} must include ${condition.field} ${condition.op} ${JSON.stringify(condition.value)}.`);
  }
  const nodes = new Map((graphBundle.graphs ?? []).flatMap((item) => item.nodes ?? []).map((item) => [item.id, item]));
  for (const id of expected.relatedNodeIds ?? []) failUnless(failures, nodes.has(id), `Expected related node ${id}.`);
  if (expected.relatedForbiddenOverclaimIncludes?.length) {
    const relatedText = (expected.relatedNodeIds ?? []).flatMap((id) => nodes.get(id)?.effects?.forbiddenOverclaims ?? []);
    for (const text of expected.relatedForbiddenOverclaimIncludes) failUnless(failures, includesText(relatedText, text), `Related EMDR constraints must include ${JSON.stringify(text)}.`);
  }
  return { failures, evidence: { nodeId: node.id, inboundEdges: (graph.edges ?? []).filter((edge) => edge.to === expected.nodeId).map((edge) => edge.from) } };
}

function runGraphSafetyBlockCase(testCase, graphBundle) {
  const failures = [];
  const expected = testCase.expectations ?? {};
  const nodes = new Map((graphBundle.graphs ?? []).flatMap((graph) => graph.nodes ?? []).map((node) => [node.id, node]));
  const blocker = nodes.get(expected.blockingNodeId);
  failUnless(failures, Boolean(blocker), `Expected graph safety blocker ${expected.blockingNodeId}.`);
  const graphBlocked = new Set(blocker?.effects?.blockNodes ?? []);
  for (const id of expected.blockedNodeIds ?? []) {
    failUnless(failures, graphBlocked.has(id), `${expected.blockingNodeId} effects.blockNodes must include ${id}.`);
  }

  const plan = planFromGraphs({ variables: testCase.variables ?? {}, unknowns: testCase.unknowns ?? [], graphs: graphBundle.graphs ?? [] });
  const plannedBlocked = new Set(plan.blockedNodes.map((node) => node.id));
  const selected = new Set(plan.selectedNodes.map((node) => node.id));
  for (const id of expected.blockedNodeIds ?? []) {
    failUnless(failures, plannedBlocked.has(id), `Planner must report ${id} as blocked.`);
    failUnless(failures, !selected.has(id), `Planner must not select blocked node ${id}.`);
  }
  return {
    failures,
    evidence: {
      blockingNodeId: blocker?.id ?? null,
      graphBlockNodes: [...graphBlocked],
      plannedBlockedNodeIds: [...plannedBlocked],
      selectedNodeIds: [...selected]
    }
  };
}

function runHypnosisContractCase(testCase, ownerAmendments) {
  const failures = [];
  const expected = testCase.expectations ?? {};
  const amendment = (ownerAmendments.items ?? []).find((item) => item.id === expected.ownerAmendmentId);
  failUnless(failures, Boolean(amendment), `Expected owner amendment ${expected.ownerAmendmentId}.`);
  failUnless(failures, amendment?.sourceIntegrated === false, `${expected.ownerAmendmentId} must remain a product-only operational rule.`);
  failUnless(failures, JSON.stringify(ROUTE_IDS) === JSON.stringify(expected.routeIds ?? []), `App-owned route IDs must remain ${JSON.stringify(expected.routeIds ?? [])}.`);
  const copy = appOwnedCopy("en");
  const gateText = `${copy.gate.title} ${copy.gate.intro} ${copy.gate.note}`;
  for (const text of expected.gateIncludes ?? []) failUnless(failures, gateText.toLowerCase().includes(String(text).toLowerCase()), `App-owned hypnosis gate must include ${JSON.stringify(text)}.`);
  for (const text of expected.wakingReturnIncludes ?? []) failUnless(failures, copy.wakingReturn.toLowerCase().includes(String(text).toLowerCase()), `App-owned waking return must include ${JSON.stringify(text)}.`);
  return { failures, evidence: { routeIds: [...ROUTE_IDS], amendmentId: amendment?.id ?? null, wakingReturn: copy.wakingReturn } };
}

function runCase(testCase, graphBundle, ownerAmendments) {
  if (testCase.contractVersion !== "guide-decision-case-v1") return { failures: [`${testCase.id} uses unsupported decision-case contract ${testCase.contractVersion ?? "missing"}.`], evidence: {} };
  if (testCase.type === "planner") return runPlannerCase(testCase, graphBundle);
  if (testCase.type === "graph-structure") return runGraphStructureCase(testCase, graphBundle);
  if (testCase.type === "graph-safety-block") return runGraphSafetyBlockCase(testCase, graphBundle);
  if (testCase.type === "hypnosis-contract") return runHypnosisContractCase(testCase, ownerAmendments);
  return { failures: [`${testCase.id} uses unsupported regression type ${testCase.type ?? "missing"}.`], evidence: {} };
}

export function runGuidePacketRegressionSuite(buffer) {
  const entries = readZipEntries(buffer);
  const graphBundle = parseJson(entries, "graphs/bundle.json");
  const ownerAmendments = parseJson(entries, "policy/owner-amendments.json");
  const cases = collectCases(entries);
  const results = cases.map((testCase) => {
    try {
      const { failures, evidence } = runCase(testCase, graphBundle, ownerAmendments);
      return { id: testCase.id, title: testCase.title, status: failures.length ? "fail" : "pass", failures, evidence, affectedNodeIds: testCase.affectedNodeIds ?? [] };
    } catch (error) {
      return { id: testCase.id, title: testCase.title, status: "fail", failures: [error.message], evidence: {}, affectedNodeIds: testCase.affectedNodeIds ?? [] };
    }
  }).sort((a, b) => a.id.localeCompare(b.id));
  const passed = results.filter((item) => item.status === "pass").length;
  return {
    contractVersion: "guide-packet-regression-v1",
    ok: results.length > 0 && passed === results.length,
    count: results.length,
    passed,
    failed: results.length - passed,
    graphBundleVersion: graphBundle.version ?? null,
    results
  };
}
