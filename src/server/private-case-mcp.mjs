import http from "node:http";
import { RUNTIME_VERSION } from "../core/runtime-version.mjs";
import { CaseNotContinuationSafeError, PrivateCaseAccessDeniedError, PrivateCaseKeyUnavailableError } from "../storage/private-case-access.mjs";

const MCP_PROTOCOL_VERSION = "2025-06-18";
const MAX_BODY_BYTES = 1_000_000;

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

const TOOLS = Object.freeze([
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
    name: "get_recent_verbatim",
    title: "Inspect exact recent private episode",
    description: "Load exact authorized recent user-assistant turns, with at least three complete exchanges and the complete active therapeutic episode.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["case_id"],
      properties: {
        case_id: { type: "string", pattern: "^[a-z0-9][a-z0-9_-]{0,79}$" }
      }
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
  }
]);

async function callTool(service, name, args, authContext) {
  if (name === "load_case_context") {
    return service.loadCaseContext(args.case_id, authContext, {
      candidateId: args.candidate_id ?? "current_pending",
      requireContinuationSafe: true,
      requireAuditScope: true,
      episodePolicy: { minimumCompleteExchanges: 3, requireCompleteEpisode: true }
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
  if (name === "get_recent_verbatim") {
    return service.getRecentVerbatim(args.case_id, { minimumCompleteExchanges: 3, requireCompleteEpisode: true }, authContext);
  }
  if (name === "get_candidate_response") {
    const candidate = await service.getCandidateResponse(args.case_id, args.candidate_id ?? "current_pending", authContext);
    if (!candidate) throw Object.assign(new Error("Candidate response was not found."), { code: "PRIVATE_CANDIDATE_NOT_FOUND" });
    return candidate;
  }
  throw Object.assign(new Error(`Unknown MCP tool ${name}.`), { code: "MCP_TOOL_NOT_FOUND" });
}

export function createPrivateCaseMcpServer({ caseAccessService } = {}) {
  if (!caseAccessService || typeof caseAccessService.loadCaseContext !== "function") throw new TypeError("caseAccessService is required.");
  return http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/health") {
      return send(res, 200, { ok: true, service: "inner-signal-private-case-mcp", runtimeVersion: RUNTIME_VERSION, productionAuthReady: false });
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
    if (request.method === "tools/list") return send(res, 200, success(request.id, { tools: TOOLS }));
    if (request.method !== "tools/call") return send(res, 200, failure(request.id, -32601, "Method not found."));

    const token = bearerToken(req);
    if (!token) {
      return send(res, 401, failure(request.id, -32001, "Authorization required."), {
        "www-authenticate": "Bearer realm=\"inner-signal-private-case\""
      });
    }
    try {
      const name = request.params?.name;
      const args = request.params?.arguments ?? {};
      const value = await callTool(caseAccessService, name, args, { bearerToken: token });
      return send(res, 200, success(request.id, toolResult(value)));
    } catch (error) {
      if (error instanceof PrivateCaseAccessDeniedError) {
        return send(res, 401, failure(request.id, -32001, "Authorization required."), {
          "www-authenticate": "Bearer realm=\"inner-signal-private-case\""
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

export async function listenPrivateCaseMcp({ caseAccessService, port = 0, host = "127.0.0.1" } = {}) {
  const server = createPrivateCaseMcpServer({ caseAccessService });
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
