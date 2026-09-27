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

function recordDate(node: JournalNode): string | null {
  for (const key of ["event_time", "authored_time"]) {
    const value = node.data?.[key];
    if (!value || typeof value !== "object") continue;
    const date = (value as Record<string, unknown>).from ?? (value as Record<string, unknown>).to;
    if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}/u.test(date)) return date.slice(0, 10);
  }
  const direct = node.data?.date;
  return typeof direct === "string" && /^\d{4}-\d{2}-\d{2}/u.test(direct) ? direct.slice(0, 10) : null;
}

export function matchesFilters(node: JournalNode, filters: JournalFilters): boolean {
  if (filters.kinds.length && !filters.kinds.includes(node.kind)) return false;
  // A timeline item is placed by its own interval, which may be its written or its event time, so
  // it is filtered by that interval rather than by whichever time the record lists first.
  const entry = node.timeline_entry;
  if (entry) {
    if (entry.lane === "unknown") return filters.includeUnknown || (!filters.from && !filters.to);
    const from = entry.from?.slice(0, 10) ?? null;
    const to = entry.to?.slice(0, 10) ?? from;
    if (filters.from && to && to < filters.from) return false;
    if (filters.to && from && from > filters.to) return false;
    return true;
  }
  const date = recordDate(node);
  if (!date) return filters.includeUnknown || (!filters.from && !filters.to);
  if (filters.from && date < filters.from) return false;
  if (filters.to && date > filters.to) return false;
  return true;
}

export interface BoundedGraph {
  nodes: JournalNode[];
  edges: JournalEdge[];
  truncated: boolean;
}

export function boundAndFilterGraph(graph: SubgraphResult, filters: JournalFilters): BoundedGraph {
  const nodes = graph.nodes.filter((node) => matchesFilters(node, filters)).slice(0, GRAPH_NODE_LIMIT);
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
