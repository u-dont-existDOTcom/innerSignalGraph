import type {
  EvidenceResult,
  ImportStatus,
  JournalApi,
  JournalContext,
  ReadScope,
  SearchResult,
  SubgraphResult,
  TimelineResult
} from "./contracts";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const routes = Object.freeze({
  importStatus: "/v1/journal/import/status",
  startImport: "/v1/journal/import",
  resumeImport: "/v1/journal/import/resume",
  search: "/v1/journal/search",
  subgraph: "/v1/journal/subgraph",
  evidence: "/v1/journal/evidence",
  timeline: "/v1/journal/timeline"
});

function authHeaders(context: JournalContext, mutation = false): Headers {
  const headers = new Headers({ accept: "application/json", authorization: `Bearer ${context.bearerToken}` });
  if (mutation) {
    if (!context.csrfToken) throw new Error("A CSRF token is required for import operations.");
    headers.set("x-csrf-token", context.csrfToken);
  }
  return headers;
}

function query(scope: Pick<JournalContext, "caseId" | "corpusId">): string {
  const values = new URLSearchParams({ case_id: scope.caseId, corpus_id: scope.corpusId });
  return values.toString();
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let code = `HTTP_${response.status}`;
    try {
      const body = await response.json() as { error?: { code?: unknown } | string; code?: unknown };
      const candidate = typeof body.code === "string"
        ? body.code
        : typeof body.error === "object" && body.error && typeof body.error.code === "string"
          ? body.error.code
          : null;
      if (candidate && /^[A-Z0-9_:-]{1,120}$/u.test(candidate)) code = candidate;
    } catch {
      // Response bodies may contain private text. Never reflect or log them.
    }
    throw new Error(`Journal request failed (${code}).`);
  }
  return response.json() as Promise<T>;
}

function readBody(scope: ReadScope, additional: Record<string, unknown> = {}): string {
  return JSON.stringify({
    caseId: scope.caseId,
    corpusId: scope.corpusId,
    purpose: scope.purpose,
    filters: {
      kinds: scope.filters.kinds,
      from: scope.filters.from || null,
      to: scope.filters.to || null,
      include_unknown: scope.filters.includeUnknown
    },
    ...additional
  });
}

function postJson(fetcher: FetchLike, context: JournalContext, path: string, body: string): Promise<Response> {
  const headers = authHeaders(context);
  headers.set("content-type", "application/json");
  return fetcher(path, { method: "POST", credentials: "same-origin", headers, body });
}

export function createHttpJournalApi(fetcher: FetchLike = globalThis.fetch.bind(globalThis)): JournalApi {
  const api: JournalApi = {
    async getImportStatus(context) {
      const response = await fetcher(`${routes.importStatus}?${query(context)}`, {
        credentials: "same-origin",
        headers: authHeaders(context)
      });
      return readJson<ImportStatus>(response);
    },

    async startImport(context, file) {
      const form = new FormData();
      form.set("case_id", context.caseId);
      form.set("corpus_id", context.corpusId);
      form.set("archive", file, file.name);
      const response = await fetcher(routes.startImport, {
        method: "POST",
        credentials: "same-origin",
        headers: authHeaders(context, true),
        body: form
      });
      return readJson<ImportStatus>(response);
    },

    async resumeImport(context) {
      const headers = authHeaders(context, true);
      headers.set("content-type", "application/json");
      const response = await fetcher(routes.resumeImport, {
        method: "POST",
        credentials: "same-origin",
        headers,
        body: JSON.stringify({ caseId: context.caseId, corpusId: context.corpusId })
      });
      return readJson<ImportStatus>(response);
    },

    async search(scope) {
      const response = await postJson(fetcher, scope, routes.search, readBody(scope, {
        query: scope.filters.query,
        graphEnabled: true,
        pageSize: 100
      }));
      return readJson<SearchResult>(response);
    },

    async getSubgraph(scope, seedIds) {
      const response = await postJson(fetcher, scope, routes.subgraph, readBody(scope, {
        seedIds,
        nodeLimit: 100
      }));
      return readJson<SubgraphResult>(response);
    },

    async resolveEvidence(scope, evidenceIds) {
      const response = await postJson(fetcher, scope, routes.evidence, readBody(scope, { evidenceIds }));
      return readJson<EvidenceResult>(response);
    },

    async getTimeline(scope) {
      const response = await postJson(fetcher, scope, routes.timeline, readBody(scope, {
        from: scope.filters.from || null,
        to: scope.filters.to || null,
        includeUnknown: scope.filters.includeUnknown,
        pageSize: 100
      }));
      return readJson<TimelineResult>(response);
    }
  };
  return Object.freeze(api);
}

export const JOURNAL_API_ROUTES = routes;
