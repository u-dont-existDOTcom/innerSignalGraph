import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyCaseStatePatch, createEmptyCaseState } from "../../src/case-state/longitudinal-state.mjs";
import { listenPrivateCaseMcp } from "../../src/server/private-case-mcp.mjs";
import { createSupervisorReplyTools } from "../../src/server/supervisor-reply-tools.mjs";
import { createPrivateCaseAccessService } from "../../src/storage/private-case-access.mjs";
import { createEncryptedPrivateCaseStore } from "../../src/storage/private-case-store.mjs";
import { createPrivateSupervisorDraftService } from "../../src/supervisor/private-supervisor-draft.mjs";
import { createSupervisorReviewRunner } from "../../src/supervisor/private-supervisor-review-runner.mjs";
import { createPrivateTherapyModelRuntime } from "../../src/supervisor/private-therapy-model-runtime.mjs";

// Synthetic only. A real connector, a real access service and a real encrypted store on a temporary directory, with the real
// private model runtime driven by a scripted provider in place of a model service. The one thing scripted is what the reviewing
// model says; everything that decides what is stored, approved or released is the product's own code.

export const CASE_ID = "synthetic-reply-case";
export const OTHER_CASE_ID = "synthetic-reply-other";
export const START = Date.parse("2026-10-02T12:00:00.000Z");
export const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
export const NEW_SCOPE = "case:supervisor_draft";
export const REPLY_TOOLS = Object.freeze(["get_reply_draft_context", "submit_reply_draft", "get_reply_draft_status", "export_approved_reply", "report_reply_sent"]);

// Who can do what. Tokens are opaque strings; each maps to the scopes its holder was granted.
export const ACCOUNTS = Object.freeze({
  "token-reply-only": Object.freeze([NEW_SCOPE]),
  "token-read-audit": Object.freeze(["case:read", "case:audit"]),
  "token-writer": Object.freeze(["case:read", "case:write", "case:audit", "journal:submit"]),
  "token-everything": Object.freeze(["case:read", "case:write", "case:audit", "journal:submit", NEW_SCOPE])
});

const turn = (exchange, role, text, day, episode = null) => ({
  id: `${exchange}-${role}`,
  exchange_id: exchange,
  role,
  text,
  at: `2026-09-${String(day).padStart(2, "0")}T12:00:00.000Z`,
  episode_id: episode
});

// A case a fresh reviewer may load: structured state with one older piece of evidence, a current episode that starts at the
// newest client message, and a stored state diff. Without these the real runtime refuses to review (the case is not
// continuation-safe), which is also what a real unfinished case does.
function syntheticState(caseId) {
  return applyCaseStatePatch(createEmptyCaseState({ caseId }), {
    items: [{
      id: "evidence:older:critical",
      domain: "long_term_target",
      statement: "Synthetic older evidence remains decision relevant.",
      status: "direct_report",
      confidence: "high",
      source: { kind: "synthetic_turn", ref: "E1-user", turn_id: "E1-user", recorded_at: "2026-09-01T12:00:00.000Z" },
      still_current: true,
      supersedes: [],
      decision_relevance: "high"
    }],
    current_episode: {
      id: "episode:active",
      target: "Continue the synthetic developmental episode.",
      route: "IC.PROTECTOR_ACTION",
      prediction: "A bounded protective action increases choice.",
      next_question: "What changed?",
      started_turn_id: "E2-user",
      constitutional_aim_ids: ["CARE", "PROTECTION"],
      adverse_signs: ["less choice"],
      stay_conditions: ["more choice"],
      switch_conditions: ["no useful movement"],
      stop_conditions: ["decline"],
      source_item_ids: ["evidence:older:critical"]
    }
  });
}

// One answered exchange, then one client message still waiting for a reply.
export async function seedReplyCase(store, caseId) {
  await store.saveCaseState(caseId, syntheticState(caseId));
  await store.saveCaseDiff(caseId, { schema_version: 1, additions: ["evidence:older:critical"], current_episode_changed: true }, { turnId: "E2-user", diffId: "diff:E2" });
  await store.appendTranscriptTurn(caseId, turn("E1", "user", "Synthetic earlier client message.", 1));
  await store.appendTranscriptTurn(caseId, turn("E1", "assistant", "Synthetic earlier reply.", 1));
  await store.appendTranscriptTurn(caseId, turn("E2", "user", "Synthetic newest client message waiting for a reply.", 2, "episode:active"));
}

// A newer client message: the case moves on, so a draft written against the earlier state is out of date.
export const appendClientMessage = (store, caseId, text = "Synthetic newer client message.") => store.appendTranscriptTurn(caseId, turn("E3", "user", text, 3, "episode:active"));

// A packet-only provider that stands in for the reviewing model. `verdicts` is what each successive audit finds ("pass" or
// "fail"); `hooks` can hold a call up or make it fail; `calls` records what the model was asked, including everything it was shown.
export function scriptedProvider({ verdicts = ["pass"], hooks = {} } = {}) {
  const calls = [];
  const counts = { audit: 0, repair: 0 };
  let inFlight = 0;
  const peak = { audits: 0 };
  return {
    id: "synthetic-reviewer",
    model: "synthetic-reviewer-1",
    privateInferenceIsolation: { packetOnly: true, freshContextPerGenerate: true, tools: false, filesystem: false, sessionPersistence: false },
    calls,
    counts,
    peak,
    async generate(input) {
      const stage = input.metadata.stage;
      if (stage === "private_candidate_audit") {
        const packet = JSON.parse(input.user.slice("AUTHORIZED AUDIT PACKET\n".length));
        counts.audit += 1;
        const index = counts.audit;
        calls.push({ stage, index, candidateId: packet.candidate_binding.id, candidateText: packet.candidate_response, shown: input.user });
        inFlight += 1;
        peak.audits = Math.max(peak.audits, inFlight);
        try {
          if (hooks.beforeAudit) await hooks.beforeAudit({ index, packet });
        } finally { inFlight -= 1; }
        const verdict = verdicts[index - 1] ?? verdicts.at(-1);
        return {
          text: JSON.stringify({
            findings: verdict === "pass" ? [] : [{ id: `finding:${index}`, code: "SYNTHETIC_UNCERTAINTY", severity: "substantive", summary: "Synthetic repair is required." }],
            repair_induced_checks: packet.repair_induced_error_checks
          }),
          responseId: `response:audit:${index}`
        };
      }
      if (stage === "private_candidate_repair") {
        counts.repair += 1;
        calls.push({ stage, index: counts.repair });
        if (hooks.beforeRepair) await hooks.beforeRepair({ index: counts.repair });
        return { text: JSON.stringify({ exact_text: `Synthetic repaired reply ${counts.repair}.` }), responseId: `response:repair:${counts.repair}` };
      }
      throw new Error(`Unexpected synthetic stage ${stage}.`);
    }
  };
}

// The real runtime, except that a backend-produced draft's text is scripted: the full therapy pipeline is not what these tests are
// about. The producer still reads the case through the runtime's own source, so it proves the source works for it.
export function reviewRuntime({ source, provider, produced = "Synthetic backend reply.\n\nWhich signal changed first?" }) {
  const real = createPrivateTherapyModelRuntime({ privateCaseSource: source, providers: { anthropic: provider, renderer: provider }, config: {} });
  const producedCalls = [];
  return Object.freeze({
    producedCalls,
    auditCandidate: real.auditCandidate,
    repairCandidate: real.repairCandidate,
    async produceCandidate({ caseId, runtimeTurn, authContext, attemptContextId }) {
      const record = await source.loadPrivateRuntimeCase(caseId, authContext);
      producedCalls.push({ caseId, turnCount: record.raw_transcript.length, userTurnId: runtimeTurn.user_turn_id, attemptContextId });
      return { exactText: produced, contextId: "context:producer:backend" };
    }
  });
}

export async function fingerprintOf(rootDir) {
  const hash = createHash("sha256");
  const walk = async (directory) => {
    for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) hash.update(path.relative(rootDir, full)).update("\0").update(await fs.readFile(full)).update("\0");
    }
  };
  await walk(rootDir);
  return hash.digest("hex");
}

export async function rpc(url, method, params = {}, token = null) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  });
  return { status: response.status, headers: response.headers, body: await response.json() };
}

// The text between two markers of an export block.
export function between(text, begin, end) {
  const from = text.indexOf(begin);
  assert.ok(from >= 0, `${begin} is missing`);
  const start = text.indexOf("\n", from) + 1;
  const to = text.indexOf(`\n${end}`, start);
  assert.ok(to >= 0, `${end} is missing`);
  return text.slice(start, to);
}

// A listener in front of an access service, serving the reply-draft `tools` (or none), and the calls a test makes through it over
// HTTP as a connector client would. `defaultToken` is the bearer a call uses unless it names another.
export async function serveReplyTools(t, { access, tools, oauth = null, defaultToken = "token-reply-only" }) {
  const listener = await listenPrivateCaseMcp({ caseAccessService: access, therapyProtocol: null, supervisorReply: tools, oauth, port: 0 });
  t.after(() => listener.close());
  const call = async (name, args, token = defaultToken) => {
    const { status, headers, body } = await rpc(listener.url, "tools/call", { name, arguments: args }, token);
    return { status, headers, body, result: body.result ?? null, structured: body.result?.structuredContent ?? null, text: body.result?.content?.[0]?.text ?? null, isError: body.result?.isError === true };
  };
  // A call that worked: its structured result.
  const ok = async (name, args, token) => {
    const answer = await call(name, args, token);
    assert.equal(answer.status, 200, `${name} answered ${answer.status}: ${JSON.stringify(answer.body).slice(0, 300)}`);
    assert.equal(answer.isError, false, `${name} was a tool error: ${answer.text}`);
    return answer.structured;
  };
  // A call the tool refused in fixed words: its structured error.
  const refused = async (name, args, token) => {
    const answer = await call(name, args, token);
    assert.equal(answer.status, 200, `${name} answered ${answer.status}`);
    assert.equal(answer.isError, true, `${name} was not refused: ${answer.text}`);
    return answer.structured;
  };
  const submit = (args, token) => ok("submit_reply_draft", { case_id: CASE_ID, source: "external_draft", idempotency_key: "key-default", ...args }, token);
  const list = async () => (await rpc(listener.url, "tools/list", {}, null)).body.result.tools;
  return { listener, url: listener.url, call, ok, refused, submit, list };
}

// The connector over an access service the caller built: the draft service and runner, the tools, and a listener. `provider`
// is the scripted reviewer; `reviewAvailable: false` builds the connector without any review runtime.
export async function buildReplyConnector(t, {
  access,
  verdicts = ["pass"],
  hooks = {},
  provider = scriptedProvider({ verdicts, hooks }),
  reviewAvailable = true,
  runnerOptions = {},
  produced = undefined,
  attempts = 1,
  withTools = true,
  oauth = null,
  defaultToken = "token-reply-only"
}) {
  const source = access.supervisorDraftAccess.source;
  const runtime = reviewAvailable ? reviewRuntime({ source, provider, ...(produced === undefined ? {} : { produced }) }) : null;
  const drafts = createPrivateSupervisorDraftService({ privateCaseSource: source, modelRuntime: runtime, maximumInvocationAttempts: attempts });
  const runner = createSupervisorReviewRunner({ budgetMs: 5_000, cooldownMs: 0, ...runnerOptions });
  const tools = createSupervisorReplyTools({ draftAccess: access.supervisorDraftAccess, drafts, runner, reviewAvailable });
  const served = await serveReplyTools(t, { access, tools: withTools ? tools : null, oauth, defaultToken });
  return { source, runtime, drafts, runner, tools, provider, ...served };
}

// Builds two cases, each with one client message waiting for a reply, and the connector in front of them. `rootDir` reuses an
// earlier environment's storage (a restart): nothing is seeded again. `withTools: false` leaves the reply-draft tools out, which is
// how the connector ships unless the feature is turned on.
export async function makeReplyEnvironment(t, {
  rootDir: existingRoot = null,
  accounts = ACCOUNTS,
  cases = [CASE_ID, OTHER_CASE_ID],
  ...connectorOptions
} = {}) {
  const rootDir = existingRoot ?? await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-reply-"));
  if (!existingRoot) t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  let tick = 0;
  const now = () => new Date(START + (tick += 1) * 1000).toISOString();
  const revoked = new Set();
  const authorizationLog = [];
  const scopesOf = (token) => (typeof token === "string" && Object.hasOwn(accounts, token) && !revoked.has(token) ? accounts[token] : null);
  const authorizationProvider = {
    async authorize({ caseId, authContext, requiredScope }) {
      authorizationLog.push({ caseId, requiredScope });
      const scopes = scopesOf(authContext?.bearerToken);
      if (!scopes || !cases.includes(caseId)) return { allowed: false };
      return { allowed: true, principalId: `principal:${authContext.bearerToken}`, scopes: [...scopes], purposes: [] };
    },
    async authenticate({ authContext }) {
      const scopes = scopesOf(authContext?.bearerToken);
      if (!scopes) throw new Error("denied");
      return { onlyGrantedAccount: false, scopes: [...scopes] };
    }
  };
  const keyProvider = {
    async getCaseKeyMaterial() {
      return { routineKek: Buffer.alloc(32, 71), recoverySecretBytes: Buffer.alloc(32, 72), accessAssurance: "development_external_file", provider: "development-file-provider" };
    }
  };
  const access = createPrivateCaseAccessService({ rootDir, authorizationProvider, keyProvider, allowDevelopmentFileProvider: true, now });
  const store = createEncryptedPrivateCaseStore({
    rootDir,
    routineKek: Buffer.alloc(32, 71),
    recoverySecretBytes: Buffer.alloc(32, 72),
    developmentExternalCredentialAuthorized: true,
    now
  });
  t.after(() => store.close());
  if (!existingRoot) for (const caseId of cases) await seedReplyCase(store, caseId);
  const connector = await buildReplyConnector(t, { access, ...connectorOptions });
  return {
    rootDir,
    access,
    store,
    revoked,
    authorizationLog,
    ...connector,
    reload: (caseId = CASE_ID) => store.load(caseId),
    fingerprint: () => fingerprintOf(rootDir),
    appendClientMessage: (caseId = CASE_ID, text) => appendClientMessage(store, caseId, text)
  };
}
