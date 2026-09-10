import http from "node:http";
import { RUNTIME_VERSION } from "../core/runtime-version.mjs";
import { CaseNotContinuationSafeError, PRIVATE_CASE_SCOPES, PrivateCaseAccessDeniedError, PrivateCaseKeyUnavailableError } from "../storage/private-case-access.mjs";

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
  res.writeHead(status, headers({ "content-length": String(Buffer.byteLength(body)), ...extraHeaders }));
  res.end(body);
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
    description: "Primary fresh-session bootstrap. Resolve and verify an authorized immutable encrypted handoff using only its stable handoff identifier.",
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
    description: "Load a continuation-safe private case bundle for an authorized fresh supervisor session, including exact recent verbatim turns and the exact pending candidate response.",
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
  }
]);

const AUDIT_TOOLS = new Set(["load_handoff", "load_case_context", "get_pending_candidate", "get_candidate_response", "get_source_artifact"]);

function advertisedTools(oauthEnabled) {
  if (!oauthEnabled) return TOOL_DEFINITIONS;
  return TOOL_DEFINITIONS.map((tool) => Object.freeze({
    ...tool,
    securitySchemes: Object.freeze([Object.freeze({
      type: "oauth2",
      scopes: Object.freeze(AUDIT_TOOLS.has(tool.name)
        ? [PRIVATE_CASE_SCOPES.READ, PRIVATE_CASE_SCOPES.AUDIT]
        : [PRIVATE_CASE_SCOPES.READ])
    })])
  }));
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

function oauthChallenge(oauth, error = "invalid_token", description = "Authenticate to access the authorized private case.") {
  if (!oauth) return "Bearer realm=\"inner-signal-private-case\"";
  const metadataUrl = new URL("/.well-known/oauth-protected-resource", `${oauth.resource}/`).toString();
  return `Bearer resource_metadata="${metadataUrl}", scope="${oauth.scopesSupported.join(" ")}", error="${error}", error_description="${description}"`;
}

function authenticationRequiredResult(challenge) {
  return {
    content: [{ type: "text", text: "Authentication required for this private case tool." }],
    _meta: { "mcp/www_authenticate": [challenge] },
    isError: true
  };
}

async function callTool(service, name, args, authContext) {
  if (name === "load_handoff") return service.loadHandoff(args.handoff_id, authContext, { requireContinuationSafe: true });
  if (name === "load_case_context") {
    return service.loadCaseContext(args.case_id, authContext, {
      candidateId: args.candidate_id ?? "current_pending",
      requireContinuationSafe: true,
      requireAuditScope: true,
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
  if (name === "get_source_artifact") {
    const artifact = await service.getSourceArtifact(args.case_id, args.source_artifact_id, authContext);
    if (!artifact) throw Object.assign(new Error("Exact source artifact was not found."), { code: "PRIVATE_SOURCE_ARTIFACT_NOT_FOUND" });
    return artifact;
  }
  throw Object.assign(new Error(`Unknown MCP tool ${name}.`), { code: "MCP_TOOL_NOT_FOUND" });
}

export function createPrivateCaseMcpServer({ caseAccessService, oauth = null, productionAuthReady = false } = {}) {
  if (!caseAccessService || typeof caseAccessService.loadCaseContext !== "function") throw new TypeError("caseAccessService is required.");
  const normalizedOauth = normalizeOauth(oauth);
  if (productionAuthReady === true && !normalizedOauth) throw new TypeError("Production auth readiness requires OAuth metadata.");
  const tools = advertisedTools(Boolean(normalizedOauth));
  return http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/health") {
      return send(res, 200, { ok: true, service: "inner-signal-private-case-mcp", runtimeVersion: RUNTIME_VERSION, productionAuthReady: productionAuthReady === true });
    }
    if (req.method === "GET" && normalizedOauth && ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"].includes(url.pathname)) {
      return send(res, 200, protectedResourceMetadata(normalizedOauth));
    }
    if (url.pathname !== "/mcp") return send(res, 404, { error: "Not found." });
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
        instructions: "Read-only private InnerSignal continuation tools. Authorization is transport-owned; never put bearer tokens or key material in tool arguments."
      }));
    }
    if (request.method === "tools/list") return send(res, 200, success(request.id, { tools }));
    if (request.method !== "tools/call") return send(res, 200, failure(request.id, -32601, "Method not found."));

    const token = bearerToken(req);
    if (!token) {
      const challenge = oauthChallenge(normalizedOauth);
      return send(res, 401, success(request.id, authenticationRequiredResult(challenge)), {
        "www-authenticate": challenge
      });
    }
    try {
      const name = request.params?.name;
      const args = request.params?.arguments ?? {};
      const value = await callTool(caseAccessService, name, args, { bearerToken: token });
      return send(res, 200, success(request.id, toolResult(value)));
    } catch (error) {
      if (error instanceof PrivateCaseAccessDeniedError) {
        const challenge = oauthChallenge(normalizedOauth, "insufficient_scope", "The access token is invalid or is not authorized for this case and scope.");
        return send(res, 401, success(request.id, authenticationRequiredResult(challenge)), {
          "www-authenticate": challenge
        });
      }
      const safeCode = error instanceof PrivateCaseKeyUnavailableError
        ? "PRIVATE_CASE_KEY_UNAVAILABLE"
        : error instanceof CaseNotContinuationSafeError
          ? "CASE_NOT_CONTINUATION_SAFE"
          : error?.code ?? "PRIVATE_CASE_TOOL_FAILED";
      return send(res, 422, failure(request.id, -32002, "Private case tool failed safely.", { code: safeCode }));
    }
  });
}

export async function listenPrivateCaseMcp({ caseAccessService, oauth = null, productionAuthReady = false, port = 0, host = "127.0.0.1" } = {}) {
  const server = createPrivateCaseMcpServer({ caseAccessService, oauth, productionAuthReady });
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
