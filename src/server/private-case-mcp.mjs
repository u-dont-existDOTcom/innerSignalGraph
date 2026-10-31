import http from "node:http";
import { RUNTIME_VERSION } from "../core/runtime-version.mjs";
import { CaseNotContinuationSafeError, PRIVATE_CASE_SCOPES, PrivateCaseAccessDeniedError, PrivateCaseKeyUnavailableError } from "../storage/private-case-access.mjs";
import { TherapyProtocolUnavailableError, loadTherapyProtocol, therapyProtocolManifest, therapyProtocolPayload } from "../protocol/therapy-protocol.mjs";
import { JOURNAL_READ_ONLY_MCP_TOOLS } from "../journal-import/http.mjs";
import { projectCasePlan } from "../case-formulation/case-roadmap.mjs";
import { KNOWN_VS_NEW_LIMITS } from "../case-formulation/known-vs-new.mjs";

const MCP_PROTOCOL_VERSION = "2025-06-18";
const MAX_BODY_BYTES = 1_000_000;
const CASE_ID_SCHEMA = Object.freeze({ type: "string", pattern: "^[a-z0-9][a-z0-9_-]{0,79}$" });
const HANDOFF_ID_SCHEMA = Object.freeze({ type: "string", pattern: "^handoff:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" });

const headers = (extra = {}) => ({
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  ...extra
});

function send(res, status, payload, extraHeaders = {}) {
  const body = payload == null ? "" : `${JSON.stringify(payload)}\n`;
  const bytes = Buffer.byteLength(body);
  res.writeHead(status, headers({ "content-length": String(bytes), ...extraHeaders }));
  res.end(body);
  return bytes;
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("MCP request is too large."), { code: "MCP_REQUEST_TOO_LARGE" });
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function bearerToken(req) {
  const authorization = req.headers.authorization;
  if (typeof authorization !== "string") return null;
  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  return match?.[1] ?? null;
}

function success(id, result) { return { jsonrpc: "2.0", id, result }; }
function failure(id, code, message, data = undefined) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

function toolResult(value) {
  const text = JSON.stringify(value);
  return {
    content: [{ type: "text", text }],
    structuredContent: value,
    isError: false
  };
}

const TOOL_DEFINITIONS = Object.freeze([
  {
    name: "load_handoff",
    title: "Load private InnerSignal handoff",
    description: "Primary fresh-session bootstrap. Resolve and verify an authorized immutable encrypted handoff using only its stable handoff identifier. The result also carries case_plan, the case's recorded plan (what is primary, what is being worked on now, what waits and why, when priorities would change, whose priority each one is) or, when none is recorded, a reconstruction that is only a proposal; and therapy_rules: the protocol's rules for reparenting and exercises and for telling an established point from a new one; call load_therapy_protocol for the complete rules before advising.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["handoff_id"],
      properties: { handoff_id: HANDOFF_ID_SCHEMA }
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: "load_case_context",
    title: "Load private InnerSignal case context",
    description: "Load a continuation-safe private case bundle for an authorized fresh supervisor session, including exact recent verbatim turns and the exact pending candidate response. The result also carries case_plan, the case's recorded plan (what is primary, what is being worked on now, what waits and why, when priorities would change, whose priority each one is) or, when none is recorded, a reconstruction that is only a proposal; and therapy_rules: the protocol's rules for reparenting and exercises and for telling an established point from a new one; call load_therapy_protocol for the complete rules before advising.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["case_id"],
      properties: {
        case_id: { type: "string", pattern: "^[a-z0-9][a-z0-9_-]{0,79}$" },
        candidate_id: { type: "string", default: "current_pending" }
      }
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: "load_case_context_by_alias",
    title: "Load private InnerSignal case context by alias",
    description: "Resolve a non-enumerable private case alias and load that authorized continuation-safe case context. Use this when the user names a known case but does not provide an opaque case or handoff ID. The result also carries case_plan, the case's recorded plan (what is primary, what is being worked on now, what waits and why, when priorities would change, whose priority each one is) or, when none is recorded, a reconstruction that is only a proposal; and therapy_rules: the protocol's rules for reparenting and exercises and for telling an established point from a new one; call load_therapy_protocol for the complete rules before advising.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["case_alias"],
      properties: {
        case_alias: { type: "string", minLength: 1, maxLength: 160 },
        candidate_id: { type: "string", default: "current_pending" }
      }
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: "get_state_diff",
    title: "Get private case state diff",
    description: "Load the current case diff or the exact diff frozen into a private handoff.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { case_id: CASE_ID_SCHEMA, handoff_id: HANDOFF_ID_SCHEMA },
      oneOf: [{ required: ["case_id"] }, { required: ["handoff_id"] }]
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: "get_recent_verbatim",
    title: "Inspect exact recent private episode",
    description: "Load the exact authorized active therapy episode from its declared start through the latest turn, without a fixed exchange-count threshold.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { case_id: CASE_ID_SCHEMA, handoff_id: HANDOFF_ID_SCHEMA },
      oneOf: [{ required: ["case_id"] }, { required: ["handoff_id"] }]
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: "retrieve_case_evidence",
    title: "Retrieve older private case evidence",
    description: "Retrieve authorized exact raw transcript turns by query, stable provenance/item IDs, or time range.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["case_id"],
      properties: {
        case_id: { type: "string", pattern: "^[a-z0-9][a-z0-9_-]{0,79}$" },
        query: { type: "string" },
        provenance_ids: { type: "array", items: { type: "string" }, maxItems: 200 },
        time_range: {
          type: "object",
          additionalProperties: false,
          properties: { from: { type: "string" }, to: { type: "string" } }
        },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 24 }
      }
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: "get_pending_candidate",
    title: "Get exact pending private candidate",
    description: "Resolve an exact pending candidate by candidate identifier or from an immutable handoff; never returns a summary or hash substitute.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        candidate_id: { type: "string", pattern: "^[A-Za-z0-9:_-]{1,160}$" },
        handoff_id: HANDOFF_ID_SCHEMA
      },
      oneOf: [{ required: ["candidate_id"] }, { required: ["handoff_id"] }]
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: "get_tracker_window",
    title: "Get private tracker window",
    description: "Load exact authorized tracker entries and a descriptive, non-causal summary from a case or frozen handoff.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        case_id: CASE_ID_SCHEMA,
        handoff_id: HANDOFF_ID_SCHEMA,
        variables: { type: "array", items: { type: "string" }, maxItems: 26 },
        time_range: { type: "object", additionalProperties: false, properties: { from: { type: "string" }, to: { type: "string" } } },
        limit: { type: "integer", minimum: 1, maximum: 180, default: 180 }
      },
      oneOf: [{ required: ["case_id"] }, { required: ["handoff_id"] }]
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: "get_journal_entries",
    title: "Get private journal entries",
    description: "Search exact authorized journal or dream entries by query and time range without promoting them into settled case facts.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        case_id: CASE_ID_SCHEMA,
        handoff_id: HANDOFF_ID_SCHEMA,
        query: { type: "string" },
        time_range: { type: "object", additionalProperties: false, properties: { from: { type: "string" }, to: { type: "string" } } },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 200 }
      },
      oneOf: [{ required: ["case_id"] }, { required: ["handoff_id"] }]
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: "get_candidate_response",
    title: "Get exact private candidate response",
    description: "Resolve an authorized exact candidate response by stable candidate ID or current_pending; never returns a summary or hash substitute.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["case_id"],
      properties: {
        case_id: { type: "string", pattern: "^[a-z0-9][a-z0-9_-]{0,79}$" },
        candidate_id: { type: "string", default: "current_pending" }
      }
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: "get_source_artifact",
    title: "Get exact private source artifact",
    description: "Resolve an authorized exact private source artifact by stable source identifier, including its lossless byte-range manifest.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["case_id", "source_artifact_id"],
      properties: {
        case_id: { type: "string", pattern: "^[a-z0-9][a-z0-9_-]{0,79}$" },
        source_artifact_id: { type: "string", pattern: "^[A-Za-z0-9:_-]{1,160}$" }
      }
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: "check_case_known_vs_new",
    title: "Check what the private case record already holds",
    description: "Before presenting a pattern, insight or recommendation as new in a review of an authorized case across sessions, records or journal material, check it here: for each point, the record's facts and hypotheses, settled answers, interventions, plan goals, current episode and parked questions that share the most word forms with it, best first, with the share of the point's words each holds and where each came from (its source's kind, reference and turn). It counts shared words and judges no meaning, so a point the record holds in other words can come back with close_word_match false: no match never makes a point new by itself. Read the matches, and the record's own items for the same meaning, then say whether the point is already established (and where), a new example of it, a contradiction, a new actionable lever, or a change to what comes first. When the case's stored plan can't be read, its goals are left out and plan_problem says so.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["case_id", "points"],
      properties: {
        case_id: { type: "string", pattern: "^[a-z0-9][a-z0-9_-]{0,79}$" },
        points: { type: "array", minItems: 1, maxItems: KNOWN_VS_NEW_LIMITS.points, items: { type: "string", minLength: 1, maxLength: KNOWN_VS_NEW_LIMITS.point_text } },
        limit: { type: "integer", minimum: 1, maximum: KNOWN_VS_NEW_LIMITS.matches_max, default: KNOWN_VS_NEW_LIMITS.matches_default }
      }
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }
]);

// Public, read-only protocol tools. Their content is the public packaged skill, so they
// need no case authorization; hosts load the current map from the deployed build instead
// of a bundled plugin copy.
const PROTOCOL_TOOL_DEFINITIONS = Object.freeze([
  {
    name: "get_therapy_protocol_manifest",
    title: "Get InnerSignal therapy protocol manifest",
    description: "Return the version and SHA-256 hashes of the InnerSignal therapy protocol this server currently serves, without the file contents.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: "load_therapy_protocol",
    title: "Load InnerSignal therapy protocol",
    description: "Call before any InnerSignal therapy response (inner-child, younger-self, reparenting, or self-relationship work), including advice to a supervisor about that work or a review of case records or the person's own writing for it. Returns the complete current therapy instructions and every reference file, including the therapy map, with version and hashes.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }
]);
const PROTOCOL_TOOLS = new Set(PROTOCOL_TOOL_DEFINITIONS.map((tool) => tool.name));

const THERAPY_INSTRUCTIONS = [
  "InnerSignal. Before any inner-child, younger-self, reparenting, or self-relationship therapy response, including advice to a supervisor about that work or a review of case records or the person's own writing for it, call load_therapy_protocol and follow its instructions and files; do not mention the map to the user.",
  "If the protocol cannot be loaded, say that InnerSignal's therapy protocol is unavailable right now instead of improvising it from memory."
];
const AUTHORIZATION_INSTRUCTION = "Authorization is transport-owned; never put bearer tokens or key material in tool arguments.";

// Keep the ordinary and journal-enabled continuity instructions aligned; journal mode adds only its mutation exception and journal-specific instructions.
// The reply-draft tools, when enabled, add their own exception and instructions the same way.
function serverInstructions(journalWork, supervisorReply = null) {
  const writers = [...(journalWork ? ["submit_journal_work_result"] : []), ...(supervisorReply ? ["the reply-draft tools"] : [])];
  return [
    ...THERAPY_INSTRUCTIONS,
    `To continue from an InnerSignal handoff, call load_handoff first. If the user names a known private case but supplies no opaque ID, call load_case_context_by_alias before searching or reconstructing prior conversation. ${writers.length ? `The private case tools are read-only, except ${writers.join(" and ")}.` : "The private case tools are read-only."}`,
    ...(journalWork ? [journalWork.instructions] : []),
    ...(supervisorReply ? [supervisorReply.instructions] : []),
    AUTHORIZATION_INSTRUCTION
  ].join(" ");
}

const AUDIT_TOOLS = new Set(["load_handoff", "load_case_context", "load_case_context_by_alias", "get_pending_candidate", "get_candidate_response", "get_source_artifact"]);
const toolScopes = (name, journalWork = null, supervisorReply = null) => {
  if (supervisorReply?.names.has(name)) return [...supervisorReply.scopes(name)];
  if (journalWork?.names.has(name)) return [...journalWork.scopes(name)];
  return AUDIT_TOOLS.has(name)
    ? [PRIVATE_CASE_SCOPES.READ, PRIVATE_CASE_SCOPES.AUDIT]
    : [PRIVATE_CASE_SCOPES.READ];
};

function advertisedTools(oauthEnabled, journalWork = null, journalApi = null, supervisorReply = null) {
  const privateTools = [
    ...TOOL_DEFINITIONS,
    ...(journalApi ? JOURNAL_READ_ONLY_MCP_TOOLS : []),
    ...(journalWork ? journalWork.definitions : []),
    ...(supervisorReply ? supervisorReply.definitions : [])
  ];
  if (!oauthEnabled) return [...PROTOCOL_TOOL_DEFINITIONS, ...privateTools];
  const protocolTools = PROTOCOL_TOOL_DEFINITIONS.map((tool) => Object.freeze({
    ...tool,
    securitySchemes: Object.freeze([Object.freeze({ type: "noauth" })])
  }));
  return [...protocolTools, ...privateTools.map((tool) => Object.freeze({
    ...tool,
    securitySchemes: Object.freeze([Object.freeze({
      type: "oauth2",
      scopes: Object.freeze(toolScopes(tool.name, journalWork, supervisorReply))
    })])
  }))];
}

// A journal answer that fails its schema, or a reply-draft call the draft service refuses, is an ordinary tool error the model
// can read and act on, not a transport failure.
function extensionToolError({ code, message, details }) {
  return {
    content: [{ type: "text", text: details ? `${message}\n${JSON.stringify(details)}` : message }],
    structuredContent: { code, ...(details ?? {}) },
    isError: true
  };
}

function protocolToolResult(protocol, name) {
  if (!protocol) throw new TherapyProtocolUnavailableError("The InnerSignal therapy protocol is unavailable on this server.");
  if (name === "get_therapy_protocol_manifest") return therapyProtocolManifest(protocol);
  return therapyProtocolPayload(protocol);
}

// Model-facing text. Each block carries its exact packaged bytes between its BEGIN and END lines, so
// the text matches the advertised hashes; a newline is added before END only when a block lacks one.
function protocolBlock(label, sha256, content) {
  const bytes = Buffer.byteLength(content, "utf8");
  return `<<<BEGIN ${label} sha256=${sha256} bytes=${bytes}>>>\n${content}${content.endsWith("\n") ? "" : "\n"}<<<END ${label}>>>`;
}

function protocolText(value) {
  const header = `InnerSignal therapy protocol ${value.version} (sha256 ${value.protocol_sha256})`;
  if (!value.instructions) {
    return [header, ...value.files.map((file) => `- ${file.path}: ${file.bytes} bytes, sha256 ${file.sha256}`)].join("\n");
  }
  return [
    header,
    value.usage,
    protocolBlock("instructions", value.instructions_sha256, value.instructions),
    ...value.files.map((file) => protocolBlock(file.path, file.sha256, file.content))
  ].join("\n\n");
}

// The therapy rules a review of a case needs, carried in the results that open a case (issue #172): a session that loads a
// case has them even if it never calls load_therapy_protocol. The protocol's own served files, byte for byte, with its
// identity; the complete protocol stays one call away.
const CASE_RULE_FILES = Object.freeze(["references/PROTOCOL-STATE-PROVENANCE.md", "references/LONGITUDINAL-SYNTHESIS.md"]);
const CASE_OPENING_TOOLS = new Set(["load_handoff", "load_case_context", "load_case_context_by_alias"]);
// The case's plan as a session reads it first (issue #172): the recorded roadmap's view, or a reconstruction labeled a
// proposal. Computed from the opened case's own state (a case context's `case_state`, a handoff's `canonical_state`); a
// failure here never keeps the case from loading.
export function casePlanFor(value) {
  const state = value?.case_state ?? value?.canonical_state ?? null;
  if (!state) return null;
  try {
    return projectCasePlan(state);
  } catch {
    return { status: "unavailable", note: "The case's plan could not be read; read the case state directly and do not present a plan as recorded." };
  }
}

export function caseTherapyRules(protocol) {
  if (!protocol) {
    return { available: false, note: "The InnerSignal therapy protocol is unavailable on this server; do not improvise it." };
  }
  return {
    available: true,
    protocol_id: protocol.protocolId,
    version: protocol.version,
    protocol_sha256: protocol.protocolSha256,
    note: "Two of the therapy protocol's reference files, carried with this case so any review of it has them: reparenting and exercises, and telling an established point from a new one across sessions, records and journal material. Before advising on this case, call load_therapy_protocol for the complete rules and follow them.",
    files: protocol.files.filter((file) => CASE_RULE_FILES.includes(file.path))
      .map(({ path, sha256: digest, bytes, content }) => ({ path, sha256: digest, bytes, content }))
  };
}

// The smallest power of two at least `bytes`: enough to see a result's scale or a truncation, not to tell cases apart.
const sizeClass = (bytes) => 2 ** Math.ceil(Math.log2(Math.max(1, bytes)));

// Error codes are fixed identifiers; anything else is traced as OTHER, so no text can reach the trace through a code.
const traceCode = (code) => code === null ? null : typeof code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : "OTHER";

// What this connector offers now (ChatGPT's post-deploy audit on #172, 17 Oct 2026): a host keeps the tool list it fetched
// for the connector, and this server can't tell it of a change (it keeps no sessions, so tools.listChanged is false). In
// ChatGPT a new chat kept the old list; refreshing the plugin's tools brought in the new one (the owner, 17 Oct, 23:15 UTC).
// With the names in an opened case, a chat whose app holds an older list can see the gap and say so. Names only, no case data.
export function connectorTools(names) {
  return {
    names: [...names],
    note: "The tools this InnerSignal connector offers now. If one of them isn't among the tools you can call, the app is holding an older tool list for this connector: tell the user to refresh the connector's tools in the app's settings (in ChatGPT, refresh the tools of the InnerSignal plugin; a new chat keeps the old list), rather than doing without it silently."
  };
}

// The rules, the plan and the connector's tools go first in an opened case's result, so a host that shortens a long result
// keeps them; fields of the same names in the case's own data never stand in for them.
function withCaseRules(value, protocol, toolNames) {
  const { therapy_rules: _rules, case_plan: _plan, connector_tools: _tools, ...rest } = value ?? {};
  return { therapy_rules: caseTherapyRules(protocol), case_plan: casePlanFor(value), connector_tools: connectorTools(toolNames), ...rest };
}

function loadProtocolOrNull() {
  try { return loadTherapyProtocol(); }
  catch (error) {
    if (error instanceof TherapyProtocolUnavailableError) return null;
    throw error;
  }
}

function normalizeOauth(value) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("oauth must be an object.");
  const resource = new URL(value.resource);
  if (resource.protocol !== "https:") throw new TypeError("oauth.resource must use HTTPS.");
  resource.hash = "";
  resource.search = "";
  resource.pathname = resource.pathname.replace(/\/$/u, "");
  if (!Array.isArray(value.authorizationServers) || value.authorizationServers.length === 0) throw new TypeError("oauth.authorizationServers is required.");
  const authorizationServers = value.authorizationServers.map((entry) => {
    const url = new URL(entry);
    if (url.protocol !== "https:") throw new TypeError("OAuth authorization servers must use HTTPS.");
    return url.toString().replace(/\/$/u, "");
  });
  const scopesSupported = Array.isArray(value.scopesSupported) && value.scopesSupported.length
    ? [...new Set(value.scopesSupported)]
    : [PRIVATE_CASE_SCOPES.READ, PRIVATE_CASE_SCOPES.AUDIT];
  if (scopesSupported.some((scope) => !Object.values(PRIVATE_CASE_SCOPES).includes(scope))) throw new TypeError("OAuth scopes are invalid.");
  return Object.freeze({
    resource: resource.toString().replace(/\/$/u, ""),
    authorizationServers: Object.freeze(authorizationServers),
    scopesSupported: Object.freeze(scopesSupported),
    resourceDocumentation: value.resourceDocumentation == null ? null : new URL(value.resourceDocumentation).toString()
  });
}

function protectedResourceMetadata(oauth) {
  return {
    resource: oauth.resource,
    authorization_servers: oauth.authorizationServers,
    scopes_supported: oauth.scopesSupported,
    ...(oauth.resourceDocumentation ? { resource_documentation: oauth.resourceDocumentation } : {})
  };
}

function oauthChallenge(oauth, error = "invalid_token", description = "Authenticate to access the authorized private case.", scopes = null) {
  if (!oauth) return "Bearer realm=\"inner-signal-private-case\"";
  const metadataUrl = new URL("/.well-known/oauth-protected-resource", `${oauth.resource}/`).toString();
  return `Bearer resource_metadata="${metadataUrl}", scope="${(scopes ?? oauth.scopesSupported).join(" ")}", error="${error}", error_description="${description}"`;
}

// A challenge asks only for what the called tool needs. The journal submission scope is requested
// only by the journal work tools, never by the ordinary read-only tools, so ordinary sign-ins are
// unaffected when the exchange is enabled. Both journal tools ask for the import pair (read and
// submit), so the import account signs in once instead of once per tool. The reply-draft scope is likewise requested only by
// the reply-draft tools, never by the ordinary read-only tools.
function challengeScopes(oauth, name, journalWork, supervisorReply = null) {
  if (!oauth) return null;
  if (supervisorReply?.names.has(name)) return [...new Set(supervisorReply.scopes(name))];
  if (journalWork?.names.has(name)) {
    return [...new Set([PRIVATE_CASE_SCOPES.READ, ...[...journalWork.names].flatMap((tool) => toolScopes(tool, journalWork))])];
  }
  return oauth.scopesSupported.filter((scope) => scope !== PRIVATE_CASE_SCOPES.JOURNAL_SUBMIT && scope !== PRIVATE_CASE_SCOPES.SUPERVISOR_DRAFT);
}

function authenticationRequiredResult(challenge) {
  return {
    content: [{ type: "text", text: "Authentication required for this private case tool." }],
    _meta: { "mcp/www_authenticate": [challenge] },
    isError: true
  };
}

// A denial keeps its sign-in challenge whenever signing in again could cure it: no token, an
// invalid one, a token missing a scope this tool needs, or a deployment whose case ACL grants
// more than one account (another account might open the case). Only when the ACL grants a single
// account, this valid token is that account's and it carries every scope the tool needs, was the
// request refused for the case or handoff itself (a wrong ID). That gets a tool error instead of
// a challenge that would send the host into a pointless re-authentication. The error is the same
// whether or not the case exists.
async function deniedForSignedInAccount(service, token, name, journalWork = null, supervisorReply = null) {
  if (!token || typeof service?.authenticate !== "function") return false;
  try {
    const identity = await service.authenticate({ bearerToken: token });
    return identity?.onlyGrantedAccount === true && toolScopes(name, journalWork, supervisorReply).every((scope) => identity.scopes.includes(scope));
  } catch {
    return false;
  }
}

function caseNotAuthorizedResult() {
  return {
    content: [{ type: "text", text: "This account cannot open that case, alias, or handoff, or it does not exist. Check the case reference with the user; signing in again will not change this." }],
    structuredContent: { code: "PRIVATE_CASE_NOT_AUTHORIZED" },
    isError: true
  };
}

async function callTool(service, name, args, authContext, journalApi = null) {
  if (name === "load_handoff") return service.loadHandoff(args.handoff_id, authContext, {
    requireContinuationSafe: true,
    journalContinuitySupported: Boolean(journalApi)
  });
  if (name === "load_case_context") {
    return service.loadCaseContext(args.case_id, authContext, {
      candidateId: args.candidate_id ?? "current_pending",
      requireContinuationSafe: true,
      requireAuditScope: true,
      journalContinuitySupported: Boolean(journalApi),
      episodePolicy: { requireCompleteEpisode: true }
    });
  }
  if (name === "load_case_context_by_alias") {
    return service.loadCaseContextByAlias(args.case_alias, authContext, {
      candidateId: args.candidate_id ?? "current_pending",
      requireContinuationSafe: true,
      requireAuditScope: true,
      journalContinuitySupported: Boolean(journalApi),
      episodePolicy: { requireCompleteEpisode: true }
    });
  }
  if (name === "retrieve_case_evidence") {
    return service.retrieveCaseEvidence(args.case_id, {
      query: args.query ?? null,
      provenanceIds: args.provenance_ids ?? [],
      timeRange: args.time_range ?? null,
      limit: args.limit ?? 24
    }, authContext);
  }
  if (name === "get_state_diff") {
    return service.getStateDiffByReference({ caseId: args.case_id ?? null, handoffId: args.handoff_id ?? null }, authContext);
  }
  if (name === "get_recent_verbatim") {
    return service.getRecentVerbatimByReference({ caseId: args.case_id ?? null, handoffId: args.handoff_id ?? null }, authContext);
  }
  if (name === "get_pending_candidate") {
    const candidate = await service.getPendingCandidateByReference({ candidateId: args.candidate_id ?? null, handoffId: args.handoff_id ?? null }, authContext);
    if (!candidate) throw Object.assign(new Error("Candidate response was not found."), { code: "PRIVATE_CANDIDATE_NOT_FOUND" });
    return candidate;
  }
  if (name === "get_tracker_window") {
    return service.getTrackerWindowByReference({
      caseId: args.case_id ?? null,
      handoffId: args.handoff_id ?? null,
      variables: args.variables ?? [],
      timeRange: args.time_range ?? null,
      limit: args.limit ?? 180
    }, authContext);
  }
  if (name === "get_journal_entries") {
    return service.getJournalEntriesByReference({
      caseId: args.case_id ?? null,
      handoffId: args.handoff_id ?? null,
      query: args.query ?? null,
      timeRange: args.time_range ?? null,
      limit: args.limit ?? 200
    }, authContext);
  }
  if (name === "get_candidate_response") {
    const candidate = await service.getCandidateResponse(args.case_id, args.candidate_id ?? "current_pending", authContext);
    if (!candidate) throw Object.assign(new Error("Candidate response was not found."), { code: "PRIVATE_CANDIDATE_NOT_FOUND" });
    return candidate;
  }
  if (name === "check_case_known_vs_new") {
    return service.checkCaseKnownVersusNew(args.case_id, { points: args.points, limit: args.limit ?? KNOWN_VS_NEW_LIMITS.matches_default }, authContext);
  }
  if (name === "get_source_artifact") {
    const artifact = await service.getSourceArtifact(args.case_id, args.source_artifact_id, authContext);
    if (!artifact) throw Object.assign(new Error("Exact source artifact was not found."), { code: "PRIVATE_SOURCE_ARTIFACT_NOT_FOUND" });
    return artifact;
  }
  if (name === "find_journal_quotes" && journalApi) {
    return journalApi.findQuotes({
      caseId: args.case_id,
      corpusId: args.corpus_id,
      query: args.query,
      purpose: args.purpose,
      from: args.from,
      to: args.to,
      includeUndated: args.include_undated,
      limit: args.limit,
      byteBudget: args.byte_budget,
      cursor: args.cursor,
      kinds: args.kinds ?? null
    }, authContext);
  }
  if (name === "search_journal_graph" && journalApi) {
    return journalApi.search({
      caseId: args.case_id,
      corpusId: args.corpus_id,
      query: args.query,
      purpose: args.purpose,
      graphEnabled: args.graph_enabled,
      filters: args.filters,
      pageSize: args.page_size,
      cursor: args.cursor
    }, authContext);
  }
  if (name === "get_journal_subgraph" && journalApi) {
    return journalApi.getSubgraph({
      caseId: args.case_id,
      corpusId: args.corpus_id,
      seedIds: args.seed_ids,
      purpose: args.purpose,
      nodeLimit: args.node_limit
    }, authContext);
  }
  if (name === "resolve_journal_evidence" && journalApi) {
    return journalApi.resolveEvidence({
      caseId: args.case_id,
      corpusId: args.corpus_id,
      evidenceIds: args.evidence_ids,
      purpose: args.purpose
    }, authContext);
  }
  if (name === "get_journal_timeline" && journalApi) {
    return journalApi.timeline({
      caseId: args.case_id,
      corpusId: args.corpus_id,
      purpose: args.purpose,
      from: args.from,
      to: args.to,
      includeUnknown: args.include_unknown,
      pageSize: args.page_size,
      cursor: args.cursor
    }, authContext);
  }
  throw Object.assign(new Error(`Unknown MCP tool ${name}.`), { code: "MCP_TOOL_NOT_FOUND" });
}

// `callLog`, when given, receives one content-free record per tool call: the tool's name (an advertised one, else "unknown"),
// whether the call carried a bearer token, whether it answered, its safe error code, the time it took and the response's size
// class (the next power of two, so a case's exact size can't be followed across lines). Never its arguments, a case
// reference or any content: the trace shows which tools were called and when, not what was read. A sink that throws or
// rejects never affects a call.
export function createPrivateCaseMcpServer({ caseAccessService, journalApi = null, oauth = null, productionAuthReady = false, therapyProtocol = undefined, journalWork = null, supervisorReply = null, callLog = null } = {}) {
  if (!caseAccessService || typeof caseAccessService.loadCaseContext !== "function" || typeof caseAccessService.loadCaseContextByAlias !== "function") throw new TypeError("caseAccessService with exact-ID and alias continuity is required.");
  if (journalWork !== null && (typeof journalWork?.call !== "function" || !(journalWork.names instanceof Set))) {
    throw new TypeError("journalWork must come from createJournalWorkTools.");
  }
  // Tools added by the reply-draft feature, which is off unless a caller passes them (see createSupervisorReplyTools).
  if (supervisorReply !== null) {
    if (typeof supervisorReply?.call !== "function" || !(supervisorReply.names instanceof Set) || !Array.isArray(supervisorReply.definitions)
        || typeof supervisorReply.scopes !== "function" || typeof supervisorReply.instructions !== "string") {
      throw new TypeError("supervisorReply must come from createSupervisorReplyTools.");
    }
    const taken = new Set([...TOOL_DEFINITIONS, ...PROTOCOL_TOOL_DEFINITIONS, ...JOURNAL_READ_ONLY_MCP_TOOLS, ...(journalWork ? journalWork.definitions : [])].map((tool) => tool.name));
    if ([...supervisorReply.names].some((name) => taken.has(name))) throw new TypeError("supervisorReply tool names collide with existing tools.");
  }
  const normalizedOauth = normalizeOauth(oauth);
  // The scope is advertised only when the feature is on.
  if (normalizedOauth?.scopesSupported.includes(PRIVATE_CASE_SCOPES.SUPERVISOR_DRAFT) && supervisorReply === null) {
    throw new TypeError("oauth.scopesSupported names the reply-draft scope but the reply-draft tools are not enabled.");
  }
  if (journalApi != null && typeof journalApi.search !== "function") throw new TypeError("journalApi is invalid.");
  if (productionAuthReady === true && !normalizedOauth) throw new TypeError("Production auth readiness requires OAuth metadata.");
  if (callLog !== null && typeof callLog !== "function") throw new TypeError("callLog must be a function.");
  const tools = advertisedTools(Boolean(normalizedOauth), journalWork, journalApi, supervisorReply);
  const toolNames = new Set(tools.map((tool) => tool.name));
  const instructions = serverInstructions(journalWork, supervisorReply);
  const serveRoot = !normalizedOauth || new URL(normalizedOauth.resource).pathname === "/";
  // Loaded once per process: a redeploy is what changes the served protocol.
  const protocol = therapyProtocol === undefined ? loadProtocolOrNull() : therapyProtocol;
  return http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/health") {
      return send(res, 200, {
        ok: true,
        service: "inner-signal-private-case-mcp",
        runtimeVersion: RUNTIME_VERSION,
        productionAuthReady: productionAuthReady === true,
        therapyProtocol: protocol ? { version: protocol.version, protocolSha256: protocol.protocolSha256 } : null
      });
    }
    if (req.method === "GET" && normalizedOauth && ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"].includes(url.pathname)) {
      return send(res, 200, protectedResourceMetadata(normalizedOauth));
    }
    // MCP is served at "/mcp". The root is an MCP endpoint too only when the protected-resource
    // identifier is the bare origin, so a host whose connector URL must equal that identifier exactly
    // (Claude) can connect there; a pathful resource never gets a second, divergent endpoint.
    if (url.pathname !== "/mcp" && !(url.pathname === "/" && serveRoot)) return send(res, 404, { error: "Not found." });
    if (req.method !== "POST") return send(res, 405, { error: "Method not allowed." }, { allow: "POST" });

    let request;
    try { request = await readJson(req); }
    catch { return send(res, 400, failure(null, -32700, "Invalid JSON.")); }
    if (!request || request.jsonrpc !== "2.0" || typeof request.method !== "string") return send(res, 400, failure(request?.id, -32600, "Invalid Request."));
    if (request.method === "notifications/initialized") return send(res, 202, null);
    if (request.method === "initialize") {
      return send(res, 200, success(request.id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "inner-signal-private-case", version: RUNTIME_VERSION },
        instructions
      }));
    }
    if (request.method === "tools/list") return send(res, 200, success(request.id, { tools }));
    if (request.method !== "tools/call") return send(res, 200, failure(request.id, -32601, "Method not found."));

    const name = request.params?.name;
    const args = request.params?.arguments ?? {};
    const started = performance.now();
    const answer = await answerToolCall(req, request, name, args);
    const bytes = send(res, answer.status, answer.payload, answer.headers);
    if (callLog) {
      try {
        const traced = callLog({ event: "tool_call", at: new Date().toISOString(), tool: toolNames.has(name) ? name : "unknown",
          bearer: bearerToken(req) !== null, ok: answer.code === null, code: traceCode(answer.code), ms: Math.round(performance.now() - started),
          bytes_at_most: sizeClass(bytes) });
        if (typeof traced?.then === "function") traced.then(undefined, () => {});
      } catch { /* the trace never breaks a call */ }
    }
  });

  async function answerToolCall(req, request, name, args) {
    const reply = (status, payload, code = null, extraHeaders = {}) => ({ status, payload, code, headers: extraHeaders });
    if (PROTOCOL_TOOLS.has(name)) {
      try {
        const value = protocolToolResult(protocol, name);
        return reply(200, success(request.id, { ...toolResult(value), content: [{ type: "text", text: protocolText(value) }] }));
      } catch {
        return reply(200, failure(request.id, -32003, "InnerSignal therapy protocol is unavailable; do not improvise it.", { code: "THERAPY_PROTOCOL_UNAVAILABLE" }), "THERAPY_PROTOCOL_UNAVAILABLE");
      }
    }

    const token = bearerToken(req);
    try {
      if (journalWork?.names.has(name)) {
        const outcome = await journalWork.call(name, args, { bearerToken: token });
        return outcome.toolError
          ? reply(200, success(request.id, extensionToolError(outcome.toolError)), outcome.toolError.code ?? "JOURNAL_WORK_TOOL_ERROR")
          : reply(200, success(request.id, toolResult(outcome.value)));
      }
      if (supervisorReply?.names.has(name)) {
        const outcome = await supervisorReply.call(name, args, { bearerToken: token });
        if (outcome.toolError) return reply(200, success(request.id, extensionToolError(outcome.toolError)), outcome.toolError.code ?? "REPLY_DRAFT_TOOL_ERROR");
        // A tool may state its result in words of its own; the structured result stays the same value.
        return reply(200, success(request.id, { ...toolResult(outcome.value), ...(typeof outcome.text === "string" ? { content: [{ type: "text", text: outcome.text }] } : {}) }));
      }
      const value = await callTool(caseAccessService, name, args, { bearerToken: token }, journalApi);
      return reply(200, success(request.id, toolResult(CASE_OPENING_TOOLS.has(name) ? withCaseRules(value, protocol, toolNames) : value)));
    } catch (error) {
      if (error instanceof PrivateCaseAccessDeniedError) {
        if (await deniedForSignedInAccount(caseAccessService, token, name, journalWork, supervisorReply)) {
          return reply(200, success(request.id, caseNotAuthorizedResult()), "PRIVATE_CASE_NOT_AUTHORIZED");
        }
        const challenge = oauthChallenge(normalizedOauth, "invalid_token", "The access token is missing, invalid, or is not authorized for this case and scope.", challengeScopes(normalizedOauth, name, journalWork, supervisorReply));
        return reply(401, success(request.id, authenticationRequiredResult(challenge)), "AUTHENTICATION_REQUIRED", { "www-authenticate": challenge });
      }
      const safeCode = error instanceof PrivateCaseKeyUnavailableError
        ? "PRIVATE_CASE_KEY_UNAVAILABLE"
        : error instanceof CaseNotContinuationSafeError
          ? "CASE_NOT_CONTINUATION_SAFE"
          : error?.code ?? "PRIVATE_CASE_TOOL_FAILED";
      return reply(422, failure(request.id, -32002, "Private case tool failed safely.", { code: safeCode }), safeCode);
    }
  }
}

export async function listenPrivateCaseMcp({ caseAccessService, journalApi = null, oauth = null, productionAuthReady = false, therapyProtocol = undefined, journalWork = null, supervisorReply = null, callLog = null, port = 0, host = "127.0.0.1" } = {}) {
  const server = createPrivateCaseMcpServer({ caseAccessService, journalApi, oauth, productionAuthReady, therapyProtocol, journalWork, supervisorReply, callLog });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  return Object.freeze({
    server,
    url: `http://${host}:${address.port}/mcp`,
    async close() { await new Promise((resolve) => server.close(resolve)); }
  });
}
