# Journal evidence web surface

This is the thin authenticated React/Vite/TypeScript client for the `/journal/` route. It is intentionally separate from the incumbent static client in `apps/web`; it reuses that client’s tokens without changing its routes or unrelated screens.

The host must inject `window.__INNER_SIGNAL_JOURNAL_CONTEXT__` before `src/main.tsx` loads:

```ts
{
  caseId: string;
  corpusId: string;
  bearerToken: string;
  csrfToken?: string;
}
```

The client copies this object into React memory and immediately removes the global reference. It does not use local storage, session storage, a service worker, analytics, or third-party network endpoints. A CSRF token is mandatory for archive import and resume mutations. Read operations always carry the fixed `organize_search` purpose.

The same applied filter snapshot drives search, the bounded graph, its equivalent accessible list, the timeline, and source resolution. The display clamps graph neighborhoods to 100 nodes and 200 edges even if a server violates the response limit. Exact source is rendered through React text nodes only.

The expected same-origin endpoints are:

- `GET /v1/journal/import/status`
- `POST /v1/journal/import`
- `POST /v1/journal/import/resume`
- `POST /v1/journal/search`
- `POST /v1/journal/subgraph`
- `POST /v1/journal/evidence`
- `POST /v1/journal/timeline`

This ticket builds and verifies the client contract. It does not deploy the route or invent authorization for a server integration.
