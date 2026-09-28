import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { ValidationError } from "../core/errors.mjs";
import { validateJournalSchema } from "./contracts.mjs";
import { isAuthenticatedTransportReceipt } from "./audit.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const active = (record) => !["deleted", "revoked"].includes(record.lifecycle);

function invariant(condition, code) {
  if (!condition) throw new ValidationError(code, { code });
}

export function buildEpisodeThemeMatrix(graph) {
  const nodes = new Map(graph.nodes.filter(active).map((node) => [node.id, node]));
  const themeLinks = new Map();
  for (const edge of graph.edges.filter((edge) => active(edge) && edge.relation === "about_theme")) {
    if (nodes.get(edge.from)?.kind !== "assertion" || nodes.get(edge.to)?.kind !== "theme") continue;
    if (!themeLinks.has(edge.from)) themeLinks.set(edge.from, []);
    themeLinks.get(edge.from).push(edge.to);
  }
  const cells = new Map();
  const unclassified = [];
  for (const assertion of graph.nodes.filter((node) => active(node) && node.kind === "assertion")) {
    const themes = themeLinks.get(assertion.id) ?? [];
    if (themes.length === 0) unclassified.push(assertion.id);
    for (const themeId of themes) {
      const episodeId = assertion.data.episode_id ?? "episode:unresolved";
      const key = `${episodeId}\0${themeId}`;
      if (!cells.has(key)) cells.set(key, {
        episode_id: episodeId,
        theme_id: themeId,
        assertion_ids: [],
        support_group_ids: [],
        narrative_modes: [],
        authored_intervals: [],
        event_intervals: [],
        writing_regimes: []
      });
      const cell = cells.get(key);
      cell.assertion_ids.push(assertion.id);
      cell.support_group_ids.push(assertion.data.support_group_id);
      cell.narrative_modes.push(assertion.data.narrative_mode);
      cell.authored_intervals.push(structuredClone(assertion.data.authored_time));
      cell.event_intervals.push(structuredClone(assertion.data.event_time));
      cell.writing_regimes.push(assertion.data.narrative_mode === "dream" ? "dream" : (assertion.data.narrative_mode === "quoted" ? "quoted_material" : "waking_report"));
    }
  }
  const normalized = [...cells.values()].map((cell) => ({
    ...cell,
    assertion_ids: [...new Set(cell.assertion_ids)].sort(),
    support_group_ids: [...new Set(cell.support_group_ids)].sort(),
    narrative_modes: [...new Set(cell.narrative_modes)].sort(),
    writing_regimes: [...new Set(cell.writing_regimes)].sort()
  })).sort((left, right) => left.episode_id.localeCompare(right.episode_id) || left.theme_id.localeCompare(right.theme_id));
  return Object.freeze({
    schema_version: "1.0",
    generation: graph.generation,
    cells: normalized,
    unclassified_assertion_ids: unclassified.sort(),
    observation_note: "Counts describe recorded source density, not life prevalence or improvement."
  });
}

function patternId(generation, localId) {
  return `pattern:${sha256(Buffer.from(`${generation}\0${localId}`, "utf8")).slice(0, 32)}`;
}

export function addProvisionalPatterns({ graph, patternResult, producerReceipt, localIdNamespace = "" }) {
  const result = validateJournalSchema("pattern-result", patternResult);
  invariant(result.target_generation === graph.generation, "PATTERN_GENERATION_MISMATCH");
  invariant(isAuthenticatedTransportReceipt(producerReceipt, { generation: graph.generation }), "PATTERN_PRODUCER_RECEIPT_MISSING");
  const assertions = new Map(graph.nodes.filter((node) => active(node) && node.kind === "assertion" && node.data.review_state !== "disputed").map((node) => [node.id, node]));
  const next = structuredClone(graph);
  const existingNodeIds = new Set(graph.nodes.map(node=>node.id));
  const created = [];
  const createdThemes = [];
  const themeIds = new Set();
  for (const theme of result.themes ?? []) {
    const id = `theme:${sha256(Buffer.from(`${graph.generation}\0${localIdNamespace}\0${theme.local_id}`)).slice(0,32)}`;
    invariant(!themeIds.has(id) && !existingNodeIds.has(id), "THEME_LOCAL_ID_DUPLICATE");
    themeIds.add(id);
    const members = theme.assertion_ids.map(id=>assertions.get(id));
    invariant(members.every(Boolean), "THEME_SUPPORT_MISSING");
    const evidenceIds=[...new Set(members.flatMap(n=>n.data.evidence_ids))];
    next.nodes.push({id,case_id:graph.case_id,corpus_id:graph.corpus_id,version:1,lifecycle:"candidate",kind:"theme",
      data:{label:theme.label,origin:theme.origin,vocabulary_version:`vocabulary:${sha256(Buffer.from(graph.generation)).slice(0,32)}`,evidence_ids:evidenceIds}});
    createdThemes.push(id);
    for(const assertion of members)next.edges.push({id:`edge:${sha256(Buffer.from(`${id}\0${assertion.id}`)).slice(0,32)}`,
      case_id:graph.case_id,corpus_id:graph.corpus_id,version:1,lifecycle:"candidate",relation:"about_theme",from:assertion.id,to:id,
      evidence_ids:[...assertion.data.evidence_ids],basis:"derived_proposal",derivation_ref:producerReceipt.receipt_id});
  }
  const candidateIds = new Set();
  for (const candidate of result.patterns) {
    const data = structuredClone(candidate.data);
    invariant(data.review_state === "provisional" && data.independent_review_ref === null, "PATTERN_PREMATURE_REVIEW_CLAIM");
    invariant(data.disconfirmation.status === "pending" && data.disconfirmation.search_receipt_ref === null, "PATTERN_PREMATURE_DISCONFIRMATION_CLAIM");
    const support = data.support_assertion_ids.map((id) => assertions.get(id));
    invariant(support.every(Boolean), "PATTERN_SUPPORT_MISSING");
    invariant(data.counter_assertion_ids.every((id) => assertions.has(id)), "PATTERN_COUNTEREVIDENCE_MISSING");
    const supportGroups = new Set(support.map((assertion) => assertion.data.support_group_id));
    if (data.pattern_kind === "recurrent") invariant(supportGroups.size >= 2, "PATTERN_RECURRENCE_DUPLICATE_SUPPORT");
    const id = patternId(graph.generation, localIdNamespace ? `${localIdNamespace}\0${candidate.local_id}` : candidate.local_id);
    invariant(!candidateIds.has(id) && !existingNodeIds.has(id), "PATTERN_LOCAL_ID_DUPLICATE");
    candidateIds.add(id);
    const node = {
      id,
      case_id: graph.case_id,
      corpus_id: graph.corpus_id,
      version: 1,
      lifecycle: "candidate",
      kind: "pattern",
      data
    };
    next.nodes.push(node);
    created.push(node);
    for (const assertion of support) next.edges.push({
      id: `edge:${sha256(Buffer.from(`${id}\0support\0${assertion.id}`, "utf8")).slice(0, 32)}`,
      case_id: graph.case_id,
      corpus_id: graph.corpus_id,
      version: 1,
      lifecycle: "candidate",
      relation: "supports_pattern",
      from: assertion.id,
      to: id,
      evidence_ids: [...assertion.data.evidence_ids],
      basis: "derived_proposal",
      derivation_ref: producerReceipt.receipt_id
    });
    for (const assertionId of data.counter_assertion_ids) {
      const assertion = assertions.get(assertionId);
      next.edges.push({
        id: `edge:${sha256(Buffer.from(`${id}\0exception\0${assertion.id}`, "utf8")).slice(0, 32)}`,
        case_id: graph.case_id,
        corpus_id: graph.corpus_id,
        version: 1,
        lifecycle: "candidate",
        relation: "exception_to",
        from: assertion.id,
        to: id,
        evidence_ids: [...assertion.data.evidence_ids],
        basis: "derived_proposal",
        derivation_ref: producerReceipt.receipt_id
      });
    }
  }
  invariant(result.unclassified_assertion_ids.every(id=>assertions.has(id)), "PATTERN_UNCLASSIFIED_ASSERTION_MISSING");
  return Object.freeze({ graph: next, created_pattern_ids: created.map(({ id }) => id), created_theme_ids:createdThemes,
    counterevidence_queries:Object.fromEntries(created.map((node,index)=>[node.id,[...(result.patterns[index].counterevidence_queries??[])]])),
    unclassified_assertion_ids: [...result.unclassified_assertion_ids] });
}

export async function executeCounterevidenceSearch({ reader, patternId: targetPatternId, queries, generation, receiptSecret, maximumBytes = 50_000 }) {
  invariant(reader && typeof reader.search === "function" && Array.isArray(queries) && queries.length > 0, "COUNTEREVIDENCE_SEARCH_INPUT_INVALID");
  invariant(receiptSecret instanceof Uint8Array && receiptSecret.byteLength >= 32, "COUNTEREVIDENCE_RECEIPT_SECRET_INVALID");
  invariant(Number.isSafeInteger(maximumBytes) && maximumBytes >= 2, "COUNTEREVIDENCE_SEARCH_BYTE_BUDGET_INVALID");
  const records = new Map();
  const matchedIds = new Set();
  let retainedBytes = 2;
  for (const query of queries) {
    let cursor = null;
    do {
      const page = await reader.search({ query, graphEnabled: false, pageSize: 200, cursor });
      for (const record of page.records) {
        matchedIds.add(record.id);
        if (!records.has(record.id)) {
          const recordBytes = Buffer.byteLength(JSON.stringify(record), "utf8") + (records.size ? 1 : 0);
          if (retainedBytes + recordBytes <= maximumBytes) {
            records.set(record.id, record);
            retainedBytes += recordBytes;
          }
        }
      }
      cursor = page.next_cursor;
    } while (cursor);
  }
  const body = {
    kind: "counterevidence_search",
    search_receipt_ref: `search:${sha256(Buffer.from(`${generation}\0${targetPatternId}\0${queries.join("\0")}`, "utf8")).slice(0, 40)}`,
    generation,
    pattern_id: targetPatternId,
    query_sha256: queries.map((query) => sha256(Buffer.from(query.normalize("NFKC"), "utf8"))),
    matched_ids: [...records.keys()].sort(),
    matched_count: matchedIds.size,
    complete: true,
    more_available: false
  };
  const authenticationTag = createHmac("sha256", receiptSecret).update(JSON.stringify(body)).digest("base64url");
  return Object.freeze({ records: [...records.values()], receipt: { ...body, authentication_tag: authenticationTag } });
}

function verifyCounterReceipt(receipt, secret, generation, targetPatternId) {
  if (!receipt || receipt.kind !== "counterevidence_search" || receipt.generation !== generation || receipt.pattern_id !== targetPatternId || receipt.complete !== true) return false;
  const { authentication_tag: authenticationTag, ...body } = receipt;
  if (typeof authenticationTag !== "string") return false;
  const expected = createHmac("sha256", secret).update(JSON.stringify(body)).digest();
  const actual = Buffer.from(authenticationTag, "base64url");
  return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
}

export function reviewPatternRegister({
  graph,
  reviewResult,
  reviewReceipt,
  builderReceipt,
  frozenSourceReceipt,
  counterevidenceReceipts,
  counterReceiptSecret
}) {
  const review = validateJournalSchema("review-result", reviewResult);
  invariant(review.target_generation === graph.generation && review.review_role === "pattern_reviewer", "PATTERN_REVIEW_CONTRACT_MISMATCH");
  invariant(counterReceiptSecret instanceof Uint8Array && counterReceiptSecret.byteLength >= 32, "COUNTEREVIDENCE_RECEIPT_SECRET_INVALID");
  const receiptReasons = [];
  for (const [name, receipt] of [["review", reviewReceipt], ["builder", builderReceipt], ["source_freeze", frozenSourceReceipt]]) {
    if (!isAuthenticatedTransportReceipt(receipt, { generation: graph.generation })) receiptReasons.push(`${name.toUpperCase()}_RECEIPT_MISSING`);
  }
  const contexts = [reviewReceipt, builderReceipt, frozenSourceReceipt].map((receipt) => receipt?.request_context_id).filter(Boolean);
  if (new Set(contexts).size !== contexts.length) receiptReasons.push("INFERENCE_CONTEXT_NOT_INDEPENDENT");
  const assessments = new Map(review.assessments.map((assessment) => [assessment.target_id, assessment]));
  const next = structuredClone(graph);
  const decisions = [];
  let counterevidenceVerified = true;
  for (const pattern of next.nodes.filter((node) => active(node) && node.kind === "pattern")) {
    const assessment = assessments.get(pattern.id);
    const counterReceipt = counterevidenceReceipts[pattern.id];
    const counterVerified = verifyCounterReceipt(counterReceipt, counterReceiptSecret, graph.generation, pattern.id);
    counterevidenceVerified &&= counterVerified;
    const unsupported = !assessment || assessment.outcome !== "preserved" || assessment.critical
      || ["unsupported_claim", "causal_promotion", "duplicate_support", "lost_qualifier"].includes(assessment.finding_type);
    if (receiptReasons.length === 0 && counterVerified && !unsupported && review.status === "sufficient_for_stated_scope") {
      pattern.version += 1;
      pattern.lifecycle = "active";
      pattern.data.review_state = "reviewed";
      pattern.data.independent_review_ref = reviewReceipt.receipt_id;
      pattern.data.disconfirmation = { status: "complete", search_receipt_ref: counterReceipt.search_receipt_ref };
      decisions.push({ pattern_id: pattern.id, decision: "reviewed" });
    } else {
      pattern.version += 1;
      pattern.data.review_state = unsupported ? "disputed" : "provisional";
      // An explicit, complete dispute is still a settled independent review. Preserve the
      // authenticated reviewer and counterevidence receipts just as we do for a preserved pattern;
      // otherwise the published node claims a dispute without retaining the evidence that settled it.
      if (unsupported && receiptReasons.length === 0 && counterVerified
        && review.status === "sufficient_for_stated_scope") {
        pattern.data.independent_review_ref = reviewReceipt.receipt_id;
        pattern.data.disconfirmation = { status: "complete", search_receipt_ref: counterReceipt.search_receipt_ref };
      }
      decisions.push({ pattern_id: pattern.id, decision: pattern.data.review_state, reasons: [
        ...receiptReasons,
        ...(counterVerified ? [] : ["COUNTEREVIDENCE_SEARCH_INCOMPLETE_OR_UNAUTHENTICATED"]),
        ...(unsupported ? ["PATTERN_UNSUPPORTED_OR_UNASSESSED"] : [])
      ] });
    }
  }
  return Object.freeze({
    graph: next,
    decisions,
    review_evidence_verified: receiptReasons.length === 0 && counterevidenceVerified,
    patterns_reviewed: decisions.every(({ decision }) => decision === "reviewed") ? "pass" : "partial"
  });
}
