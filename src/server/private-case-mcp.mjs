import http from "node:http";
import { RUNTIME_VERSION } from "../core/runtime-version.mjs";
import { CaseNotContinuationSafeError, PRIVATE_CASE_SCOPES, PrivateCaseAccessDeniedError, PrivateCaseKeyUnavailableError } from "../storage/private-case-access.mjs";
import { TherapyProtocolUnavailableError, loadTherapyProtocol, therapyProtocolManifest, therapyProtocolPayload } from "../protocol/therapy-protocol.mjs";

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
    description: "Call before any InnerSignal therapy response (inner-child, younger-self, or self-relationship work). Returns the complete current therapy instructions and every reference file, including the therapy map, with version and hashes.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }
]);
const PROTOCOL_TOOLS = new Set(PROTOCOL_TOOL_DEFINITIONS.map((tool) => tool.name));

const SERVER_INSTRUCTIONS = [
  "InnerSignal. Before any inner-child, younger-self, or self-relationship therapy response, call load_therapy_protocol and follow its instructions and files; do not mention the map to the user.",
  "If the protocol cannot be loaded, say that InnerSignal's therapy protocol is unavailable right now instead of improvising it from memory.",
  "To continue from an InnerSignal handoff, call load_handoff first. The private case tools are read-only.",
  "Authorization is transport-owned; never put bearer tokens or key material in tool arguments."
].join(" ");

const AUDIT_TOOLS = new Set(["load_handoff", "load_case_context", "get_pending_candidate", "get_candidate_response", "get_source_artifact"]);

function advertisedTools(oauthEnabled) {
  if (!oauthEnabled) return [...PROTOCOL_TOOL_DEFINITIONS, ...TOOL_DEFINITIONS];
  const protocolTools = PROTOCOL_TOOL_DEFINITIONS.map((tool) => Object.freeze({
    ...tool,
    securitySchemes: Object.freeze([Object.freeze({ type: "noauth" })])
  }));
  return [...protocolTools, ...TOOL_DEFINITIONS.map((tool) => Object.freeze({
    ...tool,
    securitySchemes: Object.freeze([Object.freeze({
      type: "oauth2",
      scopes: Object.freeze(AUDIT_TOOLS.has(tool.name)
        ? [PRIVATE_CASE_SCOPES.READ, PRIVATE_CASE_SCOPES.AUDIT]
        : [PRIVATE_CASE_SCOPES.READ])
    })])
  }))];
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

export function createPrivateCaseMcpServer({ caseAccessService, oauth = null, productionAuthReady = false, therapyProtocol = undefined } = {}) {
  if (!caseAccessService || typeof caseAccessService.loadCaseContext !== "function") throw new TypeError("caseAccessService is required.");
  const normalizedOauth = normalizeOauth(oauth);
  if (productionAuthReady === true && !normalizedOauth) throw new TypeError("Production auth readiness requires OAuth metadata.");
  const tools = advertisedTools(Boolean(normalizedOauth));
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
        instructions: SERVER_INSTRUCTIONS
      }));
    }
    if (request.method === "tools/list") return send(res, 200, success(request.id, { tools }));
    if (request.method !== "tools/call") return send(res, 200, failure(request.id, -32601, "Method not found."));

    const name = request.params?.name;
    const args = request.params?.arguments ?? {};
    if (PROTOCOL_TOOLS.has(name)) {
      try {
        const value = protocolToolResult(protocol, name);
        return send(res, 200, success(request.id, { ...toolResult(value), content: [{ type: "text", text: protocolText(value) }] }));
      } catch {
        return send(res, 200, failure(request.id, -32003, "InnerSignal therapy protocol is unavailable; do not improvise it.", { code: "THERAPY_PROTOCOL_UNAVAILABLE" }));
      }
    }

    const token = bearerToken(req);
    try {
      const value = await callTool(caseAccessService, name, args, { bearerToken: token });
      return send(res, 200, success(request.id, toolResult(value)));
    } catch (error) {
      if (error instanceof PrivateCaseAccessDeniedError) {
        const challenge = oauthChallenge(normalizedOauth, "invalid_token", "The access token is missing, invalid, or is not authorized for this case and scope.");
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

export async function listenPrivateCaseMcp({ caseAccessService, oauth = null, productionAuthReady = false, therapyProtocol = undefined, port = 0, host = "127.0.0.1" } = {}) {
  const server = createPrivateCaseMcpServer({ caseAccessService, oauth, productionAuthReady, therapyProtocol });
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
