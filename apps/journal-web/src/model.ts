import {
  GRAPH_EDGE_LIMIT,
  GRAPH_NODE_LIMIT,
  JOURNAL_PURPOSE,
  type JournalContext,
  type JournalEdge,
  type JournalFilters,
  type JournalNode,
  type ReadScope,
  type SubgraphResult
} from "./contracts";

export function createReadScope(context: JournalContext, filters: JournalFilters): ReadScope {
  return Object.freeze({ ...context, purpose: JOURNAL_PURPOSE, filters: Object.freeze({ ...filters, kinds: [...filters.kinds] }) });
}

export function nodeLabel(node: JournalNode): string {
  for (const key of ["label", "statement", "quote", "title"]) {
    const value = node.data?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return node.id;
}

export function nodeEvidenceIds(node: JournalNode): string[] {
  if (node.kind === "passage") return [node.id];
  const candidates = node.data?.evidence_ids;
  return Array.isArray(candidates)
    ? [...new Set(candidates.filter((value): value is string => typeof value === "string" && value.length > 0))]
    : [];
}

interface Interval {
  from: string | null;
  to: string | null;
}

// The reader's rule for time bounds (src/journal-import/contracts.mjs): a bound is an ISO 8601
// calendar value that names a period at its own precision ("2021-05" is the whole of May 2021),
// and without a trailing "Z" its text order is time order.
function orderKey(bound: string): string {
  return bound.endsWith("Z") ? bound.slice(0, -1) : bound;
}

function startsByEndOf(earlier: string, later: string): boolean {
  const end = orderKey(later);
  return orderKey(earlier).slice(0, end.length) <= end;
}

// Periods overlap the window, whole: a window ending on a day includes that day, and a record
// dated "2021-05" is in a window starting May 10, 2021. An interval may be open at one end: no
// start is the unbounded past, no end the unbounded future.
function overlapsWindow(interval: Interval, filters: JournalFilters): boolean {
  if (filters.from && interval.to && !startsByEndOf(filters.from, interval.to)) return false;
  if (filters.to && interval.from && !startsByEndOf(interval.from, filters.to)) return false;
  return true;
}

// A record's known times, written and event, as the service reads them when it filters a search.
function recordIntervals(node: JournalNode): Interval[] {
  const bound = (value: unknown) => (typeof value === "string" && /^\d{4}/u.test(value) ? value : null);
  const intervals = ["authored_time", "event_time"]
    .map((key) => node.data?.[key])
    .filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object")
    .map((value) => ({ from: bound(value.from), to: bound(value.to) }))
    .filter((interval) => interval.from || interval.to);
  if (intervals.length) return intervals;
  const direct = bound(node.data?.date);
  return direct ? [{ from: direct, to: direct }] : [];
}

export function matchesFilters(node: JournalNode, filters: JournalFilters): boolean {
  if (filters.kinds.length && !filters.kinds.includes(node.kind)) return false;
  // A timeline item is placed by its own interval, which may be its written or its event time, so
  // it is filtered by that interval rather than by whichever time the record lists first.
  const entry = node.timeline_entry;
  if (entry) {
    if (entry.lane === "unknown") return filters.includeUnknown || (!filters.from && !filters.to);
    return overlapsWindow(entry, filters);
  }
  const intervals = recordIntervals(node);
  if (!intervals.length) return filters.includeUnknown || (!filters.from && !filters.to);
  return intervals.some((interval) => overlapsWindow(interval, filters));
}

export interface BoundedGraph {
  nodes: JournalNode[];
  edges: JournalEdge[];
  truncated: boolean;
}

// Filters choose which matches seed a neighborhood. The neighborhood itself is shown whole: its
// closure (supporting passages, corrections, qualifications, exceptions) is what makes a match
// readable, whatever kind or date those companions have, and the service returns it bounded.
export function boundGraph(graph: SubgraphResult): BoundedGraph {
  const nodes = graph.nodes.slice(0, GRAPH_NODE_LIMIT);
  const ids = new Set(nodes.map(({ id }) => id));
  const edges = graph.edges
    .filter((edge) => ids.has(edge.from) && ids.has(edge.to))
    .slice(0, GRAPH_EDGE_LIMIT);
  return Object.freeze({
    nodes,
    edges,
    truncated: graph.more_available || graph.nodes.length > nodes.length || graph.edges.length > edges.length
  });
}

export function emptyFilters(): JournalFilters {
  return { query: "", kinds: [], from: "", to: "", includeUnknown: true };
}
