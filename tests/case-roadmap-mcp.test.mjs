import test from "node:test";
import assert from "node:assert/strict";
import { applyRoadmapDecision } from "../src/case-formulation/case-roadmap.mjs";
import { applyCaseStatePatch, createEmptyCaseState } from "../src/case-state/longitudinal-state.mjs";
import { listenPrivateCaseMcp } from "../src/server/private-case-mcp.mjs";
import { PrivateCaseAccessDeniedError } from "../src/storage/private-case-access.mjs";

// Issue #172, change B, over the connector: every opened case carries its plan (or a reconstruction labeled a proposal), and
// a read-only tool shows where the record already holds a point. Synthetic cases only.

const RESOURCE = "https://private-mcp.synthetic.example";
const ISSUER = "https://identity.synthetic.example";
const AT = new Date(Date.UTC(2026, 9, 17, 12, 0)).toISOString();

const withoutPlan = applyCaseStatePatch(createEmptyCaseState({ caseId: "synthetic-case-a" }), {});
const withPlan = applyCaseStatePatch(withoutPlan, {
  roadmap: applyRoadmapDecision(null, {
    decision_id: "plan-a-1", source: "client", at: AT, evidence_refs: ["turn:synthetic-1"],
    changes: [{ op: "add", goal: { id: "goal:felt-safety", kind: "primary_aim", title: "Feel safe inside while keeping boundaries" } }]
  })
});

function service({ state, calls = [] }) {
  return Object.freeze({
    // A handoff packet holds the state as `canonical_state`, as compiled in src/storage/private-case-handoff.mjs.
    async loadHandoff() { return { handoff_id: "handoff:synthetic", case_id: "synthetic-case-a", canonical_state: state }; },
    async loadCaseContext() { return { case_id: "synthetic-case-a", case_state: state }; },
    async loadCaseContextByAlias() { return { case_id: "synthetic-case-a", case_state: state }; },
    async retrieveCaseEvidence() { throw new PrivateCaseAccessDeniedError(); },
    async checkCaseKnownVersusNew(caseId, criteria, authContext) {
      calls.push({ caseId, criteria, authContext });
      return { case_id: caseId, points: [] };
    }
  });
}

async function post(url, method, params = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  });
  return { response, body: await response.json() };
}

async function listen(t, options) {
  const listener = await listenPrivateCaseMcp({ therapyProtocol: null, ...options });
  t.after(() => listener.close());
  return listener;
}

test("every opened case carries its plan: the recorded view, or a reconstruction labeled a proposal", async (t) => {
  for (const [state, status] of [[withPlan, "recorded"], [withoutPlan, "proposed_reconstruction"]]) {
    const listener = await listen(t, { caseAccessService: service({ state }) });
    for (const [name, args] of [["load_handoff", { handoff_id: "handoff:00000000-0000-4000-8000-000000000172" }], ["load_case_context", { case_id: "synthetic-case-a" }], ["load_case_context_by_alias", { case_alias: "synthetic" }]]) {
      const { response, body } = await post(listener.url, "tools/call", { name, arguments: args });
      assert.equal(response.status, 200, name);
      const plan = body.result.structuredContent.case_plan;
      assert.equal(plan.status, status, name);
      if (status === "recorded") assert.deepEqual(plan.primary.map((goal) => [goal.id, goal.priority_source]), [["goal:felt-safety", "client"]]);
      else assert.equal(plan.priority_source, "provisional");
    }
  }
  // The rules and the plan come first, and a stand-in plan in the case's own data is ignored.
  const standIn = Object.freeze({ ...service({ state: withPlan }), async loadCaseContext() { return { case_id: "synthetic-case-a", case_state: withPlan, case_plan: { status: "recorded", note: "synthetic stand-in" } }; } });
  const guarded = await listen(t, { caseAccessService: standIn });
  const first = await post(guarded.url, "tools/call", { name: "load_case_context", arguments: { case_id: "synthetic-case-a" } });
  assert.deepEqual(Object.keys(first.body.result.structuredContent).slice(0, 2), ["therapy_rules", "case_plan"]);
  assert.equal(JSON.stringify(first.body).includes("synthetic stand-in"), false);
  // A plan that can't be read never keeps the case from loading.
  const broken = await listen(t, { caseAccessService: service({ state: { case_id: "synthetic-case-a" } }) });
  const opened = await post(broken.url, "tools/call", { name: "load_case_context", arguments: { case_id: "synthetic-case-a" } });
  assert.equal(opened.response.status, 200);
  assert.equal(opened.body.result.structuredContent.case_plan.status, "unavailable");
});

test("the known-versus-new tool is read-only, case-scoped and passes its points through", async (t) => {
  const calls = [];
  const listener = await listen(t, {
    caseAccessService: service({ state: withPlan, calls }),
    oauth: { resource: RESOURCE, authorizationServers: [ISSUER], scopesSupported: ["case:read", "case:audit"] },
    productionAuthReady: true
  });
  const listed = await post(listener.url, "tools/list");
  const tool = listed.body.result.tools.find((candidate) => candidate.name === "check_case_known_vs_new");
  assert.deepEqual(tool.securitySchemes, [{ type: "oauth2", scopes: ["case:read"] }]);
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.deepEqual(tool.inputSchema.required, ["case_id", "points"]);
  assert.match(tool.description, /judges no meaning/u);
  for (const name of ["load_handoff", "load_case_context", "load_case_context_by_alias"]) {
    assert.match(listed.body.result.tools.find((candidate) => candidate.name === name).description, /case_plan/u, name);
  }
  const called = await post(listener.url, "tools/call", { name: "check_case_known_vs_new", arguments: { case_id: "synthetic-case-a", points: ["A synthetic point"] } });
  assert.equal(called.response.status, 200);
  assert.deepEqual(calls.map(({ caseId, criteria }) => [caseId, criteria]), [["synthetic-case-a", { points: ["A synthetic point"], limit: 5 }]]);
  assert.equal(Object.hasOwn(called.body.result.structuredContent, "case_plan"), false, "only opening a case adds the plan");
});
