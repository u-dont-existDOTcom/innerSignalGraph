import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createHttpJournalApi } from "./api";
import {
  EMPTY_IMPORT_STATUS,
  GRAPH_EDGE_LIMIT,
  GRAPH_NODE_LIMIT,
  type EvidenceResult,
  type ImportStage,
  type ImportStageName,
  type ImportStatus,
  type JournalApi,
  type JournalContext,
  type JournalFilters,
  type JournalNode,
  type ReadScope,
  type SubgraphResult,
  type TimelineResult
} from "./contracts";
import { JournalGraph } from "./JournalGraph";
import { boundAndFilterGraph, createReadScope, emptyFilters, matchesFilters, nodeEvidenceIds, nodeLabel } from "./model";

const defaultApi = createHttpJournalApi();
const stageOrder: ImportStageName[] = ["archive", "parse", "semantic", "visual", "session_use"];
const stageLabels: Record<ImportStageName, string> = Object.freeze({
  archive: "Archive",
  parse: "Parse",
  semantic: "Semantic",
  visual: "Visual",
  session_use: "Session use"
});

const emptyGraph: SubgraphResult = Object.freeze({ nodes: [], edges: [], closure_status: "empty", more_available: false });
const emptyTimeline: TimelineResult = Object.freeze({ items: [], unknown_count: 0, next_cursor: null, more_available: false });

function stageProgress(stage: ImportStage): number | null {
  if (stage.state === "complete") return 100;
  if (stage.total && stage.completed != null) return Math.max(0, Math.min(100, Math.round((stage.completed / stage.total) * 100)));
  return null;
}

function ImportProgress({ status }: { status: ImportStatus }) {
  return (
    <div className="stage-grid" aria-label="Import progress by independent stage">
      {stageOrder.map((name) => {
        const stage = status.stages[name] ?? { state: "unavailable" };
        const value = stageProgress(stage);
        return (
          <article className={`stage-card state-${stage.state}`} key={name} data-stage={name}>
            <p className="stage-name">{stageLabels[name]}</p>
            <p className="stage-state">{stage.state.replace("_", " ")}{value != null && stage.state !== "complete" ? ` · ${value}%` : ""}</p>
            {value != null ? <progress max="100" value={value} aria-label={`${stageLabels[name]} ${value}%`} /> : null}
            {stage.detail ? <p className="stage-detail">{stage.detail}</p> : null}
          </article>
        );
      })}
    </div>
  );
}

function ErrorNotice({ message }: { message: string | null }) {
  return message ? <p className="notice error" role="alert">{message}</p> : null;
}

function nodeDate(node: JournalNode): string {
  for (const key of ["event_time", "authored_time"]) {
    const value = node.data?.[key];
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      const candidate = record.raw ?? record.from ?? record.to;
      if (typeof candidate === "string" && candidate) return candidate;
    }
  }
  return "Time unknown";
}

// A timeline item is labeled with the field that places it, so a record written on one date
// about an event on another never shows one date at the other's position.
function timelineDate(item: JournalNode): string {
  const entry = item.timeline_entry;
  if (!entry) return nodeDate(item);
  if (entry.lane === "unknown") return "Time unknown";
  const field = entry.fields.includes("event_time") ? "event_time" : "authored_time";
  const value = item.data?.[field];
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>).raw : null;
  const date = typeof raw === "string" && raw ? raw : (entry.from ?? entry.to ?? "Time unknown");
  if (entry.fields.length > 1) return date;
  return `${date} · ${field === "event_time" ? "event" : "written"}`;
}

function timelineKey(item: JournalNode): string {
  const entry = item.timeline_entry;
  return entry ? `${item.id}:${entry.lane}:${entry.from ?? ""}:${entry.to ?? ""}` : item.id;
}

function ResultList({ nodes, selectedId, onSelect }: { nodes: JournalNode[]; selectedId: string | null; onSelect(node: JournalNode): void }) {
  if (!nodes.length) return <p className="empty-state">No authorized list results match these filters.</p>;
  return (
    <ul className="result-list" aria-label="Authorized journal result list" data-testid="journal-result-list">
      {nodes.map((node) => (
        <li key={node.id}>
          <button className={selectedId === node.id ? "result-button selected" : "result-button"} type="button" onClick={() => onSelect(node)}>
            <span><strong>{nodeLabel(node)}</strong><small>{node.kind} · {nodeDate(node)}</small></span>
            <span className="result-id">{node.id}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function EvidencePanel({ node, evidence, loading, error }: {
  node: JournalNode | null;
  evidence: EvidenceResult | null;
  loading: boolean;
  error: string | null;
}) {
  return (
    <aside className="evidence-panel" aria-labelledby="evidence-heading">
      <p className="eyebrow">Exact source</p>
      <h3 id="evidence-heading">{node ? nodeLabel(node) : "Select an evidence node"}</h3>
      {!node ? <p className="muted">Choose a graph node or list row to resolve its authorized exact source span.</p> : null}
      {loading ? <p role="status">Resolving exact source…</p> : null}
      <ErrorNotice message={error} />
      {node && !loading && !error && evidence?.exact_spans.length === 0 ? <p className="empty-state">No exact source span is attached to this node.</p> : null}
      {evidence?.exact_spans.map((span) => {
        const locator = evidence.source_locators.find(({ evidence_id }) => evidence_id === span.evidence_id);
        return (
          <article className="exact-source" key={`${span.evidence_id}:${span.start_byte}`}>
            <dl>
              <dt>Evidence</dt><dd>{span.evidence_id}</dd>
              <dt>Bytes</dt><dd>{span.start_byte}–{span.end_byte}</dd>
              <dt>Locator</dt><dd>{locator?.kind ?? "not available"}{locator?.page != null ? ` · page ${locator.page}` : ""}</dd>
              <dt>Status</dt><dd>{locator?.interpretation_status ?? span.disclosure ?? "exact"}</dd>
            </dl>
            <blockquote>{span.quote}</blockquote>
          </article>
        );
      })}
    </aside>
  );
}

export interface AppProps {
  context: JournalContext | null;
  api?: JournalApi;
}

export function App({ context, api = defaultApi }: AppProps) {
  const [importStatus, setImportStatus] = useState<ImportStatus>(EMPTY_IMPORT_STATUS);
  const [importLoading, setImportLoading] = useState(Boolean(context));
  const [importError, setImportError] = useState<string | null>(null);
  const [archive, setArchive] = useState<File | null>(null);
  const [draftFilters, setDraftFilters] = useState<JournalFilters>(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState<JournalFilters>(emptyFilters);
  const [rawGraph, setRawGraph] = useState<SubgraphResult>(emptyGraph);
  const [timeline, setTimeline] = useState<TimelineResult>(emptyTimeline);
  const [searchState, setSearchState] = useState<"idle" | "loading" | "ready" | "empty" | "error">("idle");
  // Which page of matches the graph shows, and the snapshot-bound cursor for the next one.
  const [matchPage, setMatchPage] = useState<{ number: number; nextCursor: string | null }>({ number: 0, nextCursor: null });
  const [pageLoading, setPageLoading] = useState(false);
  // Bumped by each new search, so a page or timeline response for an earlier search is dropped.
  const retrieval = useRef(0);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [view, setView] = useState<"graph" | "list">("graph");
  const [selectedNode, setSelectedNode] = useState<JournalNode | null>(null);
  const [evidence, setEvidence] = useState<EvidenceResult | null>(null);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  // Each selection gets a token; a response for an earlier selection is dropped, so the panel never
  // shows one node's exact source under another node's heading.
  const evidenceRequest = useRef(0);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);

  useEffect(() => {
    if (!context) return;
    let current = true;
    setImportLoading(true);
    api.getImportStatus(context).then((status) => {
      if (current) setImportStatus(status);
    }).catch(() => {
      if (current) setImportError("Import status is unavailable. Check the authenticated service and try again.");
    }).finally(() => {
      if (current) setImportLoading(false);
    });
    return () => { current = false; };
  }, [api, context]);

  const boundedGraph = useMemo(() => boundAndFilterGraph(rawGraph, appliedFilters), [rawGraph, appliedFilters]);
  const visibleTimeline = useMemo(
    () => timeline.items.filter((item) => matchesFilters(item, appliedFilters)),
    [timeline.items, appliedFilters]
  );

  if (!context?.bearerToken) {
    return (
      <main className="auth-gate">
        <section className="panel" aria-labelledby="auth-heading">
          <p className="eyebrow">Private local runtime</p>
          <h1 id="auth-heading">Journal evidence</h1>
          <p className="notice error" role="alert">An in-memory authenticated journal context is required. No credential was stored in this browser.</p>
        </section>
      </main>
    );
  }

  const updateImport = async (operation: () => Promise<ImportStatus>) => {
    setImportLoading(true);
    setImportError(null);
    try { setImportStatus(await operation()); }
    catch { setImportError("The import operation did not complete. Its prior durable progress can be resumed."); }
    finally { setImportLoading(false); }
  };

  const selectNode = async (node: JournalNode) => {
    const request = ++evidenceRequest.current;
    setSelectedNode(node);
    setEvidence(null);
    setEvidenceError(null);
    const evidenceIds = nodeEvidenceIds(node);
    if (!evidenceIds.length) {
      setEvidenceLoading(false);
      return;
    }
    setEvidenceLoading(true);
    try {
      const resolved = await api.resolveEvidence(createReadScope(context, appliedFilters), evidenceIds);
      if (request === evidenceRequest.current) setEvidence(resolved);
    } catch {
      if (request === evidenceRequest.current) setEvidenceError("Exact source is not available for this authorized selection.");
    } finally {
      if (request === evidenceRequest.current) setEvidenceLoading(false);
    }
  };

  // One page of matches and the bounded neighborhood it seeds. Matches whose closure did not fit
  // are still listed, never reported as absent.
  const loadNeighborhood = async (scope: ReadScope, cursor: string | null) => {
    const page = await api.search(scope, cursor);
    if (!page.items.length) return { page, graph: emptyGraph };
    const closure = await api.getSubgraph(scope, page.items.map(({ id }) => id));
    const graph: SubgraphResult = closure.nodes.length
      ? closure
      : { nodes: page.items, edges: [], closure_status: closure.closure_status, more_available: true };
    return { page, graph };
  };

  const clearSelection = () => {
    evidenceRequest.current += 1;
    setSelectedNode(null);
    setEvidence(null);
    setEvidenceLoading(false);
  };

  const submitSearch = async (event: FormEvent) => {
    event.preventDefault();
    const nextFilters = { ...draftFilters, query: draftFilters.query.trim(), kinds: [...draftFilters.kinds] };
    if (!nextFilters.query) {
      setSearchState("error");
      setSearchError("Enter a search term before retrieving journal evidence.");
      return;
    }
    const request = ++retrieval.current;
    setSearchState("loading");
    setSearchError(null);
    setPageLoading(false);
    clearSelection();
    try {
      const scope = createReadScope(context, nextFilters);
      const [{ page, graph }, nextTimeline] = await Promise.all([loadNeighborhood(scope, null), api.getTimeline(scope)]);
      if (request !== retrieval.current) return;
      setAppliedFilters(nextFilters);
      setRawGraph(graph);
      setMatchPage({ number: 1, nextCursor: page.more_available ? page.next_cursor : null });
      setTimeline(nextTimeline);
      setSearchState(graph.nodes.length ? "ready" : "empty");
    } catch {
      if (request !== retrieval.current) return;
      setRawGraph(emptyGraph);
      setMatchPage({ number: 0, nextCursor: null });
      setTimeline(emptyTimeline);
      setSearchState("error");
      setSearchError("Authorized journal retrieval failed. Filters and credentials were not cached.");
    }
  };

  const nextMatches = async () => {
    const cursor = matchPage.nextCursor;
    if (!cursor) return;
    const request = retrieval.current;
    setPageLoading(true);
    setSearchError(null);
    clearSelection();
    try {
      const { page, graph } = await loadNeighborhood(createReadScope(context, appliedFilters), cursor);
      if (request !== retrieval.current) return;
      setRawGraph(graph);
      setMatchPage({ number: matchPage.number + 1, nextCursor: page.more_available ? page.next_cursor : null });
    } catch {
      if (request === retrieval.current) setSearchError("The next matches could not be retrieved. Search again to start over.");
    } finally {
      if (request === retrieval.current) setPageLoading(false);
    }
  };

  const loadMoreTimeline = async () => {
    const cursor = timeline.next_cursor;
    if (!cursor) return;
    const request = retrieval.current;
    setPageLoading(true);
    setSearchError(null);
    try {
      const more = await api.getTimeline(createReadScope(context, appliedFilters), cursor);
      if (request !== retrieval.current) return;
      setTimeline((current) => ({
        items: [...current.items, ...more.items],
        unknown_count: more.unknown_count,
        next_cursor: more.more_available ? more.next_cursor : null,
        more_available: more.more_available
      }));
    } catch {
      if (request === retrieval.current) setSearchError("More timeline records could not be retrieved. Search again to start over.");
    } finally {
      if (request === retrieval.current) setPageLoading(false);
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div><p className="eyebrow">Private local runtime</p><h1>Journal evidence</h1></div>
        <div className="identity-chips" aria-label="Active private context">
          <span className="chip">Corpus {context.corpusId}</span>
          <span className="chip ok">Authenticated</span>
        </div>
      </header>

      <main className="page-content">
        <section className="panel" aria-labelledby="import-heading">
          <div className="panel-heading">
            <div><p className="eyebrow">Restricted intake</p><h2 id="import-heading">Import progress</h2><p className="muted">Archive, parse, semantic, visual, and session-use readiness remain independently visible.</p></div>
            <div className="import-actions">
              <label className="file-button">Choose archive<input type="file" accept="application/pdf,.pdf,application/zip,.zip" onChange={(event) => setArchive(event.target.files?.[0] ?? null)} /></label>
              <button type="button" disabled={!archive || importLoading} onClick={() => archive && updateImport(() => api.startImport(context, archive))}>Start import</button>
              <button className="secondary" type="button" disabled={!importStatus.resumable || importLoading} onClick={() => updateImport(() => api.resumeImport(context))}>Resume import</button>
            </div>
          </div>
          {archive ? <p className="selected-file">Selected: {archive.name}</p> : null}
          {importLoading ? <p role="status" className="notice">Refreshing durable import progress…</p> : null}
          <ErrorNotice message={importError} />
          <ImportProgress status={importStatus} />
        </section>

        <section className="panel" aria-labelledby="explore-heading">
          <div className="panel-heading">
            <div><p className="eyebrow">Authorized retrieval</p><h2 id="explore-heading">Explore bounded evidence</h2><p className="muted">Graph, list, timeline, and source drilldown share one purpose and one applied filter snapshot.</p></div>
            <div className="view-switch" role="group" aria-label="Result view">
              <button type="button" aria-pressed={view === "graph"} onClick={() => setView("graph")}>Graph</button>
              <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")}>Accessible list</button>
            </div>
          </div>

          <form className="filter-grid" onSubmit={submitSearch}>
            <label>Search<input aria-label="Search journal" value={draftFilters.query} onChange={(event) => setDraftFilters({ ...draftFilters, query: event.target.value })} /></label>
            <label>Kind<select aria-label="Evidence kind" value={draftFilters.kinds[0] ?? ""} onChange={(event) => setDraftFilters({ ...draftFilters, kinds: event.target.value ? [event.target.value] : [] })}><option value="">All evidence</option><option value="passage">Passages</option><option value="assertion">Assertions</option><option value="episode">Episodes</option><option value="entity">Entities</option><option value="theme">Themes</option><option value="pattern">Patterns</option></select></label>
            <label>From<input aria-label="From date" type="date" value={draftFilters.from} onChange={(event) => setDraftFilters({ ...draftFilters, from: event.target.value })} /></label>
            <label>To<input aria-label="To date" type="date" value={draftFilters.to} onChange={(event) => setDraftFilters({ ...draftFilters, to: event.target.value })} /></label>
            <label className="unknown-toggle"><input type="checkbox" checked={draftFilters.includeUnknown} onChange={(event) => setDraftFilters({ ...draftFilters, includeUnknown: event.target.checked })} />Include unknown time</label>
            <button className="search-button" type="submit" disabled={searchState === "loading"}>Retrieve evidence</button>
          </form>

          {searchState === "loading" ? <p className="notice" role="status">Retrieving one authorized bounded neighborhood…</p> : null}
          {searchState === "idle" ? <p className="empty-state">Search the authorized corpus to load a bounded graph, equivalent list, timeline, and exact source.</p> : null}
          {searchState === "empty" ? <p className="empty-state" role="status">No evidence was found in the authorized material for this query and filter set.</p> : null}
          <ErrorNotice message={searchError} />

          {searchState === "ready" ? (
            <div className="result-layout">
              <div className="result-main">
                <div className="result-summary">
                  <strong>{boundedGraph.nodes.length} nodes · {boundedGraph.edges.length} links</strong>
                  <span>Bounded to {GRAPH_NODE_LIMIT} / {GRAPH_EDGE_LIMIT}{boundedGraph.truncated ? " · more available" : ""} · Matches page {matchPage.number}{matchPage.nextCursor ? " · more matches available" : ""}</span>
                  {matchPage.nextCursor ? <button className="secondary" type="button" disabled={pageLoading} onClick={nextMatches}>Next matches</button> : null}
                </div>
                {view === "graph"
                  ? <JournalGraph nodes={boundedGraph.nodes} edges={boundedGraph.edges} selectedId={selectedNode?.id ?? null} onSelect={selectNode} />
                  : <ResultList nodes={boundedGraph.nodes} selectedId={selectedNode?.id ?? null} onSelect={selectNode} />}
              </div>
              <EvidencePanel node={selectedNode} evidence={evidence} loading={evidenceLoading} error={evidenceError} />
            </div>
          ) : null}
        </section>

        {searchState === "ready" ? (
          <section className="panel timeline-panel" aria-labelledby="timeline-heading">
            <div><p className="eyebrow">Chronology</p><h2 id="timeline-heading">Timeline</h2><p className="muted">The same authorized purpose and applied filters are used. Ordering is evidence, not causal inference.</p></div>
            <div className="timeline-results">
              {visibleTimeline.length ? <ol className="timeline-list">{visibleTimeline.map((item) => <li key={timelineKey(item)}><button type="button" onClick={() => selectNode(item)}><time>{timelineDate(item)}</time><strong>{nodeLabel(item)}</strong><span>{item.kind}</span></button></li>)}</ol> : <p className="empty-state">No timeline records match the applied filter snapshot.</p>}
              {timeline.next_cursor ? <button className="secondary" type="button" disabled={pageLoading} onClick={loadMoreTimeline}>Load more timeline</button> : null}
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
