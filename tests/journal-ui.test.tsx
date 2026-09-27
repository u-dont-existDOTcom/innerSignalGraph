import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { App } from "../apps/journal-web/src/App";
import { createHttpJournalApi } from "../apps/journal-web/src/api";
import {
  JOURNAL_PURPOSE,
  type ImportStatus,
  type JournalApi,
  type JournalContext,
  type JournalEdge,
  type JournalNode,
  type ReadScope
} from "../apps/journal-web/src/contracts";
import { boundAndFilterGraph, emptyFilters, matchesFilters } from "../apps/journal-web/src/model";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const context: JournalContext = Object.freeze({
  caseId: "synthetic-case",
  corpusId: "synthetic-corpus",
  bearerToken: "memory-only-token",
  csrfToken: "memory-only-csrf"
});

const status: ImportStatus = Object.freeze({
  job_id: "job:synthetic",
  resumable: true,
  stages: Object.freeze({
    archive: Object.freeze({ state: "complete", completed: 1, total: 1, detail: "1 source verified" }),
    parse: Object.freeze({ state: "complete", completed: 382, total: 382 }),
    semantic: Object.freeze({ state: "running", completed: 72, total: 100 }),
    visual: Object.freeze({ state: "waiting" }),
    session_use: Object.freeze({ state: "unavailable", detail: "Review required" })
  })
});

const passage: JournalNode = Object.freeze({
  id: "p1",
  kind: "passage",
  lifecycle: "active",
  data: Object.freeze({
    quote: "Je me sens mieux — pas complètement.",
    event_time: Object.freeze({ from: "2024-06-03", to: "2024-06-03", raw: "3 juin 2024" })
  })
});

const assertion: JournalNode = Object.freeze({
  id: "a1",
  kind: "assertion",
  lifecycle: "active",
  data: Object.freeze({ statement: "Une frontière familiale a été décrite.", evidence_ids: ["p1"], event_time: Object.freeze({ from: "2024-06-03" }) })
});

const edge: JournalEdge = Object.freeze({ id: "e1", relation: "supported_by", from: "a1", to: "p1", evidence_ids: ["p1"] });
const longFrench = "Je me suis rendu compte que la limite n’était pas un rejet de l’autre personne. ".repeat(14) + "<img src=x onerror=alert(1)>";

function fakeApi(overrides: Partial<JournalApi> = {}) {
  const api: JournalApi = {
    getImportStatus: vi.fn(async () => status),
    startImport: vi.fn(async () => status),
    resumeImport: vi.fn(async () => status),
    search: vi.fn(async () => ({ items: [assertion], next_cursor: null, more_available: false })),
    getSubgraph: vi.fn(async () => ({ nodes: [assertion, passage], edges: [edge], closure_status: "complete", more_available: false })),
    resolveEvidence: vi.fn(async () => ({
      exact_spans: [{
        evidence_id: "p1", representation_id: "repr", start_byte: 0, end_byte: 860,
        quote: longFrench, quote_sha256: "a".repeat(64), disclosure: "exact"
      }],
      source_locators: [{ evidence_id: "p1", kind: "visual_transcript", page: 7, interpretation_status: "verified" }]
    })),
    getTimeline: vi.fn(async () => ({ items: [passage, assertion], unknown_count: 0, next_cursor: null, more_available: false })),
    ...overrides
  };
  return api;
}

async function search(api: JournalApi, query = "frontière familiale") {
  const user = userEvent.setup();
  render(<App context={context} api={api} />);
  await screen.findByText("1 source verified");
  await user.type(screen.getByRole("textbox", { name: "Search journal" }), query);
  await user.click(screen.getByRole("button", { name: "Retrieve evidence" }));
  await screen.findByText("2 nodes · 1 links");
  return user;
}

describe("authenticated journal surface", () => {
  test("shows five independent durable import stages and a recoverable resume failure", async () => {
    const api = fakeApi({ resumeImport: vi.fn(async () => { throw new Error("private response that must not surface"); }) });
    const user = userEvent.setup();
    render(<App context={context} api={api} />);

    await screen.findByText("1 source verified");
    for (const label of ["Archive", "Parse", "Semantic", "Visual", "Session use"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByRole("progressbar", { name: "Semantic 72%" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Resume import" }));
    expect((await screen.findByRole("alert")).textContent).toContain("prior durable progress can be resumed");
    expect(screen.queryByText(/private response/i)).toBeNull();
  });

  test("uses one permission/filter snapshot for graph, equivalent list, timeline, and drilldown", async () => {
    const api = fakeApi();
    const user = await search(api);

    const searchScope = vi.mocked(api.search).mock.calls[0][0];
    const graphScope = vi.mocked(api.getSubgraph).mock.calls[0][0];
    const timelineScope = vi.mocked(api.getTimeline).mock.calls[0][0];
    expect(searchScope.purpose).toBe(JOURNAL_PURPOSE);
    expect(graphScope).toEqual(searchScope);
    expect(timelineScope).toEqual(searchScope);
    expect(searchScope.bearerToken).toBe("memory-only-token");

    const graph = screen.getByTestId("journal-graph");
    expect(within(graph).getAllByRole("button")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Accessible list" }));
    const list = screen.getByTestId("journal-result-list");
    expect(within(list).getAllByRole("button")).toHaveLength(2);

    await user.click(within(list).getByRole("button", { name: /Une frontière familiale/ }));
    const evidenceScope = vi.mocked(api.resolveEvidence).mock.calls[0][0];
    expect(evidenceScope).toEqual(searchScope);
    expect(await screen.findByText(longFrench)).toBeTruthy();
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText("visual_transcript · page 7")).toBeTruthy();
  });

  test("keeps the latest selection's exact source when an earlier response arrives late", async () => {
    let releaseFirst: (value: Awaited<ReturnType<JournalApi["resolveEvidence"]>>) => void = () => {};
    const span = (quote: string) => ({
      exact_spans: [{ evidence_id: "p1", representation_id: "repr", start_byte: 0, end_byte: 10, quote, quote_sha256: "b".repeat(64), disclosure: "exact" }],
      source_locators: []
    });
    const resolveEvidence = vi.fn<JournalApi["resolveEvidence"]>()
      .mockImplementationOnce(() => new Promise((resolve) => { releaseFirst = resolve; }))
      .mockImplementationOnce(async () => span("Current selection source."));
    const api = fakeApi({ resolveEvidence });
    const user = await search(api);
    await user.click(screen.getByRole("button", { name: "Accessible list" }));
    const list = screen.getByTestId("journal-result-list");
    await user.click(within(list).getByRole("button", { name: /Une frontière familiale/ }));
    await user.click(within(list).getByRole("button", { name: /Je me sens mieux/ }));
    expect(await screen.findByText("Current selection source.")).toBeTruthy();
    releaseFirst(span("Earlier selection source."));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText("Earlier selection source.")).toBeNull();
    expect(screen.getByText("Current selection source.")).toBeTruthy();
  });

  test("opens exact evidence from a keyboard-focused SVG node", async () => {
    const api = fakeApi();
    const user = await search(api, "aide");
    const node = screen.getByRole("button", { name: /Open exact source for Une frontière familiale/ });
    node.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByText(longFrench)).toBeTruthy();
    expect(vi.mocked(api.resolveEvidence)).toHaveBeenCalledTimes(1);
  });

  test("supports file intake without enabling mutation before a file is selected", async () => {
    const api = fakeApi();
    const user = userEvent.setup();
    render(<App context={context} api={api} />);
    await screen.findByText("1 source verified");
    const start = screen.getByRole("button", { name: "Start import" }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    const file = new File(["synthetic"], "synthetic.pdf", { type: "application/pdf" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);
    expect(start.disabled).toBe(false);
    await user.click(start);
    expect(api.startImport).toHaveBeenCalledWith(context, file);
  });

  test("pages through matches and the timeline with their snapshot-bound cursors", async () => {
    const secondAssertion: JournalNode = { id: "a2", kind: "assertion", lifecycle: "active", data: { statement: "Une seconde page de résultats.", evidence_ids: ["p2"] } };
    const secondPassage: JournalNode = { id: "p2", kind: "passage", lifecycle: "active", data: { quote: "Deuxième passage exact." } };
    const searchPages = vi.fn<JournalApi["search"]>()
      .mockImplementationOnce(async () => ({ items: [assertion], next_cursor: "cursor:search:2", more_available: true }))
      .mockImplementationOnce(async () => ({ items: [secondAssertion], next_cursor: null, more_available: false }));
    const getSubgraph = vi.fn<JournalApi["getSubgraph"]>(async (_scope, seeds) => seeds.includes("a2")
      ? { nodes: [secondAssertion, secondPassage], edges: [{ id: "e2", relation: "supported_by", from: "a2", to: "p2", evidence_ids: ["p2"] }], closure_status: "complete", more_available: false }
      : { nodes: [assertion, passage], edges: [edge], closure_status: "complete", more_available: false });
    const getTimeline = vi.fn<JournalApi["getTimeline"]>()
      .mockImplementationOnce(async () => ({ items: [passage], unknown_count: 0, next_cursor: "cursor:timeline:2", more_available: true }))
      .mockImplementationOnce(async () => ({ items: [secondPassage], unknown_count: 0, next_cursor: null, more_available: false }));
    const api = fakeApi({ search: searchPages, getSubgraph, getTimeline });
    const user = await search(api);
    expect(screen.getByText(/Matches page 1 · more matches available/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Next matches" }));
    expect(await screen.findByText(/Matches page 2/)).toBeTruthy();
    expect(searchPages.mock.calls[1][1]).toBe("cursor:search:2");
    expect(searchPages.mock.calls[1][0]).toEqual(searchPages.mock.calls[0][0]);
    expect(screen.queryByRole("button", { name: "Next matches" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Accessible list" }));
    expect(within(screen.getByTestId("journal-result-list")).getByRole("button", { name: /Une seconde page/ })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Load more timeline" }));
    const timelineList = await screen.findByText("Deuxième passage exact.", { selector: ".timeline-list strong" });
    expect(timelineList).toBeTruthy();
    expect(getTimeline.mock.calls[1][1]).toBe("cursor:timeline:2");
    expect(screen.queryByRole("button", { name: "Load more timeline" })).toBeNull();
  });

  test("labels each timeline item with the time that places it", async () => {
    const written = { raw: "1 janvier 2020", from: "2020-01-01T00:00:00.000Z", to: "2020-01-01T23:59:59.999Z" };
    const happened = { raw: "juin 2024", from: "2024-06-01T00:00:00.000Z", to: "2024-06-30T23:59:59.999Z" };
    const record: JournalNode = { id: "a9", kind: "assertion", lifecycle: "active", data: { statement: "Un souvenir daté deux fois.", authored_time: written, event_time: happened } };
    const api = fakeApi({
      getTimeline: vi.fn(async () => ({
        items: [
          { ...record, timeline_entry: { lane: "known" as const, fields: ["authored_time"], from: written.from, to: written.to } },
          { ...record, timeline_entry: { lane: "known" as const, fields: ["event_time"], from: happened.from, to: happened.to } }
        ],
        unknown_count: 0, next_cursor: null, more_available: false
      }))
    });
    await search(api);
    const labels = [...document.querySelectorAll(".timeline-list time")].map((node) => node.textContent);
    expect(labels).toEqual(["1 janvier 2020 · written", "juin 2024 · event"]);
  });

  test("rebuilds the view once when a generation is published mid-load, and never mixes snapshots", async () => {
    const g = (generation: string) => ({ generation, visibility_epoch: 0 });
    const searchResults = vi.fn<JournalApi["search"]>()
      .mockImplementationOnce(async () => ({ items: [assertion], next_cursor: null, more_available: false, snapshot: g("generation-1") }))
      .mockImplementation(async () => ({ items: [assertion], next_cursor: null, more_available: false, snapshot: g("generation-2") }));
    const getSubgraph = vi.fn<JournalApi["getSubgraph"]>()
      .mockImplementationOnce(async () => ({ nodes: [assertion, passage], edges: [edge], closure_status: "complete", more_available: false, coverage: g("generation-1") }))
      .mockImplementation(async () => ({ nodes: [assertion, passage], edges: [edge], closure_status: "complete", more_available: false, coverage: g("generation-2") }));
    const getTimeline = vi.fn<JournalApi["getTimeline"]>(async () => ({ items: [passage], unknown_count: 0, next_cursor: null, more_available: false, snapshot: g("generation-2") }));
    const resolveEvidence = vi.fn<JournalApi["resolveEvidence"]>(async () => ({ exact_spans: [], source_locators: [], snapshot: g("generation-3") }));
    const api = fakeApi({ search: searchResults, getSubgraph, getTimeline, resolveEvidence });
    const user = await search(api);
    expect(searchResults).toHaveBeenCalledTimes(2);
    // An exact source from a later generation isn't shown under this view.
    await user.click(screen.getByRole("button", { name: "Accessible list" }));
    await user.click(within(screen.getByTestId("journal-result-list")).getByRole("button", { name: /Une frontière familiale/ }));
    expect(await screen.findByText(/The journal changed since this search/)).toBeTruthy();
  });

  test("reports a snapshot change that persists instead of combining the responses", async () => {
    const g = (generation: string) => ({ generation, visibility_epoch: 0 });
    const api = fakeApi({
      search: vi.fn(async () => ({ items: [assertion], next_cursor: null, more_available: false, snapshot: g("generation-1") })),
      getTimeline: vi.fn(async () => ({ items: [passage], unknown_count: 0, next_cursor: null, more_available: false, snapshot: g("generation-2") }))
    });
    const user = userEvent.setup();
    render(<App context={context} api={api} />);
    await screen.findByText("1 source verified");
    await user.type(screen.getByRole("textbox", { name: "Search journal" }), "frontière");
    await user.click(screen.getByRole("button", { name: "Retrieve evidence" }));
    expect((await screen.findByRole("alert")).textContent).toContain("The journal changed while it was loading");
    expect(screen.queryByText(/nodes ·/)).toBeNull();
  });

  test("lists matches whose evidence closure did not fit instead of reporting none", async () => {
    const api = fakeApi({
      getSubgraph: vi.fn(async () => ({ nodes: [], edges: [], closure_status: "insufficient_context", more_available: true }))
    });
    const user = userEvent.setup();
    render(<App context={context} api={api} />);
    await screen.findByText("1 source verified");
    await user.type(screen.getByRole("textbox", { name: "Search journal" }), "frontière");
    await user.click(screen.getByRole("button", { name: "Retrieve evidence" }));
    expect(await screen.findByText("1 nodes · 0 links")).toBeTruthy();
    expect(screen.getByText(/more available/)).toBeTruthy();
    expect(screen.queryByText(/No evidence was found/)).toBeNull();
  });

  test("fails closed when no in-memory authenticated context is supplied", () => {
    const api = fakeApi();
    render(<App context={null} api={api} />);
    expect(screen.getByRole("alert").textContent).toContain("in-memory authenticated journal context is required");
    expect(api.getImportStatus).not.toHaveBeenCalled();
  });
});

describe("private HTTP boundary", () => {
  test("keeps authentication in request memory, requires CSRF for import, and only calls same-origin routes", async () => {
    const requests: Array<{ input: string; init: RequestInit | undefined }> = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ input: String(input), init });
      return new Response(JSON.stringify(status), { status: 200, headers: { "content-type": "application/json" } });
    });
    const storageSpy = vi.spyOn(Storage.prototype, "setItem");
    const api = createHttpJournalApi(fetcher);
    await api.getImportStatus(context);
    await api.startImport(context, new File(["x"], "journal.pdf", { type: "application/pdf" }));

    expect(requests.every(({ input }) => input.startsWith("/"))).toBe(true);
    expect(new Headers(requests[0].init?.headers).get("authorization")).toBe("Bearer memory-only-token");
    expect(new Headers(requests[1].init?.headers).get("x-csrf-token")).toBe("memory-only-csrf");
    expect(storageSpy).not.toHaveBeenCalled();

    await expect(api.startImport({ ...context, csrfToken: undefined }, new File(["x"], "journal.pdf"))).rejects.toThrow(/CSRF token/);
    storageSpy.mockRestore();
  });
});

describe("timeline filtering", () => {
  test("filters a timeline item by the interval that places it, not by the record's first-listed time", () => {
    const record: JournalNode = { id: "a9", kind: "assertion", data: {
      authored_time: { from: "2020-01-01T00:00:00.000Z", to: "2020-01-01T23:59:59.999Z" },
      event_time: { from: "2024-06-01T00:00:00.000Z", to: "2024-06-01T23:59:59.999Z" }
    } };
    const written = { ...record, timeline_entry: { lane: "known" as const, fields: ["authored_time"], from: "2020-01-01T00:00:00.000Z", to: "2020-01-01T23:59:59.999Z" } };
    const window2020 = { ...emptyFilters(), from: "2020-01-01", to: "2020-12-31" };
    expect(matchesFilters(written, window2020)).toBe(true);
    expect(matchesFilters(written, { ...emptyFilters(), from: "2024-01-01" })).toBe(false);
    const unknown = { ...record, timeline_entry: { lane: "unknown" as const, fields: ["authored_time", "event_time"], from: null, to: null } };
    expect(matchesFilters(unknown, { ...window2020, includeUnknown: false })).toBe(false);
    expect(matchesFilters(unknown, { ...window2020, includeUnknown: true })).toBe(true);
  });
});

describe("bounded and hardened rendering", () => {
  test("enforces the 100-node and 200-edge visual limits before rendering", () => {
    const nodes = Array.from({ length: 140 }, (_, index): JournalNode => ({ id: `n${index}`, kind: "passage", data: { quote: `Node ${index}` } }));
    const edges = Array.from({ length: 260 }, (_, index): JournalEdge => ({ id: `e${index}`, relation: "related", from: `n${index % 100}`, to: `n${(index + 1) % 100}` }));
    const bounded = boundAndFilterGraph({ nodes, edges, closure_status: "complete", more_available: true }, emptyFilters());
    expect(bounded.nodes).toHaveLength(100);
    expect(bounded.edges).toHaveLength(200);
    expect(bounded.truncated).toBe(true);
  });

  test("contains mobile and long-French-text protections with no private browser cache or telemetry hooks", () => {
    const sourceFiles = ["src/App.tsx", "src/api.ts", "src/main.tsx", "src/styles.css"]
      .map((name) => fs.readFileSync(path.join(root, "apps/journal-web", name), "utf8"))
      .join("\n");
    expect(sourceFiles).toMatch(/@media \(max-width: 620px\)/);
    expect(sourceFiles).toMatch(/overflow-wrap: anywhere/);
    expect(sourceFiles).toMatch(/word-break: break-word/);
    expect(sourceFiles).not.toMatch(/localStorage|sessionStorage|serviceWorker|dangerouslySetInnerHTML|console\.|analytics|telemetry/i);
    const index = fs.readFileSync(path.join(root, "apps/journal-web/index.html"), "utf8");
    expect(index).toMatch(/connect-src 'self'/);
    expect(index).not.toMatch(/https?:\/\//);
  });

  test("renders at a narrow viewport without removing the accessible result path", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    fireEvent(window, new Event("resize"));
    const api = fakeApi();
    const user = await search(api, "correction");
    await user.click(screen.getByRole("button", { name: "Accessible list" }));
    expect(screen.getByRole("list", { name: "Authorized journal result list" })).toBeTruthy();
    expect(screen.getAllByText("Je me sens mieux — pas complètement.").length).toBeGreaterThanOrEqual(1);
  });
});
