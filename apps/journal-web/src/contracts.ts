export const JOURNAL_PURPOSE = "organize_search" as const;
export const GRAPH_NODE_LIMIT = 100;
export const GRAPH_EDGE_LIMIT = 200;
// One page of matches seeds one bounded neighborhood, so no match on a page is left out of it.
export const SEARCH_PAGE_SIZE = 50;
export const TIMELINE_PAGE_SIZE = 100;

export type ImportStageName = "archive" | "parse" | "semantic" | "visual" | "session_use";
export type ImportStageState = "not_started" | "waiting" | "running" | "complete" | "failed" | "unavailable";

export interface ImportStage {
  state: ImportStageState;
  completed?: number;
  total?: number;
  detail?: string;
}

export interface ImportStatus {
  job_id: string | null;
  resumable: boolean;
  stages: Record<ImportStageName, ImportStage>;
}

export interface TimelineEntry {
  lane: "known" | "unknown";
  fields: string[];
  from: string | null;
  to: string | null;
}

export interface JournalNode {
  id: string;
  kind: string;
  lifecycle?: string;
  data?: Record<string, unknown>;
  // Present on timeline items: the time field or fields that place the item where it is.
  timeline_entry?: TimelineEntry;
}

export interface JournalEdge {
  id: string;
  relation: string;
  from: string;
  to: string;
  evidence_ids?: string[];
  lifecycle?: string;
}

// The published generation and visibility epoch a response was read from. Responses combined in
// one view must share it.
export interface SnapshotIdentity {
  generation: string;
  visibility_epoch: number;
}

export interface SearchResult {
  items: JournalNode[];
  next_cursor: string | null;
  more_available: boolean;
  snapshot?: SnapshotIdentity;
}

export interface SubgraphResult {
  nodes: JournalNode[];
  edges: JournalEdge[];
  closure_status: string;
  more_available: boolean;
  coverage?: SnapshotIdentity;
}

export interface TimelineResult {
  items: JournalNode[];
  unknown_count: number;
  next_cursor: string | null;
  more_available: boolean;
  snapshot?: SnapshotIdentity;
}

export interface ExactSpan {
  evidence_id: string;
  representation_id: string;
  start_byte: number;
  end_byte: number;
  quote: string;
  quote_sha256: string;
  disclosure?: string;
}

export interface SourceLocator {
  evidence_id: string;
  kind: string;
  page?: number | null;
  bbox?: number[] | null;
  original_object_id?: string;
  interpretation_status?: string;
}

export interface EvidenceResult {
  exact_spans: ExactSpan[];
  source_locators: SourceLocator[];
  snapshot?: SnapshotIdentity;
}

export interface JournalFilters {
  query: string;
  kinds: string[];
  from: string;
  to: string;
  includeUnknown: boolean;
}

export interface JournalContext {
  caseId: string;
  corpusId: string;
  bearerToken: string;
  csrfToken?: string;
}

export interface ReadScope extends JournalContext {
  purpose: typeof JOURNAL_PURPOSE;
  filters: JournalFilters;
}

export interface JournalApi {
  getImportStatus(context: JournalContext): Promise<ImportStatus>;
  startImport(context: JournalContext, file: File): Promise<ImportStatus>;
  resumeImport(context: JournalContext): Promise<ImportStatus>;
  search(scope: ReadScope, cursor?: string | null): Promise<SearchResult>;
  getSubgraph(scope: ReadScope, seedIds: string[]): Promise<SubgraphResult>;
  resolveEvidence(scope: ReadScope, evidenceIds: string[]): Promise<EvidenceResult>;
  getTimeline(scope: ReadScope, cursor?: string | null): Promise<TimelineResult>;
}

export const EMPTY_IMPORT_STATUS: ImportStatus = Object.freeze({
  job_id: null,
  resumable: false,
  stages: Object.freeze({
    archive: Object.freeze({ state: "not_started" }),
    parse: Object.freeze({ state: "waiting" }),
    semantic: Object.freeze({ state: "waiting" }),
    visual: Object.freeze({ state: "waiting" }),
    session_use: Object.freeze({ state: "unavailable" })
  })
});
