# InnerSignal — high-retention journal import

**Design version:** 1.0 • **Date:** 2026-09-19  
**Status:** implementation-ready proposal; importer not implemented, deployed, or tested against real journals.  
**Scope:** private multi-year journals, preserving important information without turning historical writing into unquestioned current truth.

## 1. Decision

Build an **exact private archive plus a temporal evidence graph**, with direct source search as an independent retrieval path. The graph organizes what the journal says, when it says it, what changed, and where each interpretation came from. It does not replace the journal, become the therapy-policy graph, or automatically rewrite the current case formulation.

Use four layers:

| Layer | Stores | Authority |
|---|---|---|
| Original archive | Exact uploaded file bytes, attachments, private integrity manifests | Original evidence, retained until authorized deletion |
| Readable sources | Versioned parsed text, entry boundaries, dates, source locators | A representation of the original, not an invisible rewrite |
| Personal evidence graph | Source-linked assertions, entities, events, corrections, exceptions, relationships | Revisable evidence and interpretations, not objective truth |
| Session memory packet | A small query-specific selection of exact passages, relevant assertions, counterevidence and unknowns | Context for existing therapy reasoning; never a new policy authority |

**Retention, extraction and retrieval are three separate outcomes.** Exact bytes can be checked exhaustively. Whether an important meaning was extracted and whether it is recalled for a particular question require separate evaluation. Never advertise “100% remembered” because every file was saved or every paragraph was processed.

### What counts as important

Preserve circumstances, relationships, boundaries, goals, commitments, values, preferences, meaningful events, recurring difficulties, attempted solutions, actual outcomes, strengths, enjoyment, supportive people, exceptions, corrections and unresolved questions. Preserve a rare turning point even when a mundane complaint appears a hundred times. Preserve content that does not fit the initial taxonomy: unclassified text remains searchable.

Importance controls **attention**, not deletion. Automatic ranking must not discard low-ranked source material. The person can pin, correct, hide from session use, or remove material. Repeated descriptions of one event are linked as retellings rather than counted as independent corroboration.

## 2. Fit with the current application

Inspection is bound to development commit `038f7ee61e0ddbb760e8263dbc6de3c06a56bfcf`. These are current-code observations, not assumptions about the deployed service. See §13.

- `src/storage/private-case-access.mjs` already authorizes a case and scope before requesting encryption keys; it exposes journal/source reads and backend writes. Preserve this boundary.
- `src/storage/private-case-store.mjs` currently stores journals in the encrypted case record. Journal search uses AND substring matching and returns the last matching entries in insertion order, with a maximum of 200 and no pagination cursor. Backfilled history therefore needs explicit event-time ordering and complete traversal.
- The same store limits journal text to 40,000 JavaScript string units per entry, 20,000 journal entries, and portable handoff envelopes to 12,000,000 bytes. These guards are not a sizing guarantee for an arbitrary two-year export.
- `src/storage/exact-source-artifact.mjs` supports exact **text**, at most 100 artifacts and 2,000,000 UTF-8 bytes per artifact. It is not an original-binary PDF/DOCX archive.
- `src/case-state/longitudinal-state.mjs` bounds current state to 500 items. Do not pour the imported corpus into that array or raise its limit to fit everything.
- Private Continuity is deliberately read-only. Existing exact active-episode, candidate, independent-audit and delivery rules remain intact.
- Follow the owner-selected React/Vite/TypeScript PWA, existing Node 24 backend, Railway target and encrypted private storage. No second backend, new graph host, or new paid memory service is required by this design.

## 3. User experience and permissions

Add **Journal → Import history**. The default surface is a readable timeline and searchable entry list. A focused graph view is optional; nobody must navigate a sprawling graph to import or correct an entry.

### A. Select and authorize

Choose the target private case and files/folder export. Bind the operation to the actual journal subject and an authorized uploader. An existing case-read grant is not permission to upload another person's journals, send them to a provider, or expose them to other case collaborators.

Present three separable permissions: **archive**, **organize/search**, and **use in future sessions**. Indexing/extraction must name whether data leaves the server, which already-authorized provider route receives it, and which operations are included. Archive-only never invokes a model. Provider retention settings must be verified for the selected route; do not promise zero retention without evidence. Default to no sharing, publication, training, or cross-case use.

Do not ask for thousands of individual approvals. Obtain one clear authorization for the selected files, recipient/provider boundary and operations; reuse it for retries that stay within those bounds. A changed destination, materially changed purpose, broader file selection, or revoked grant requires a new applicable authorization.

### B. Inventory before processing

Show actual file count, bytes, detected formats, date range when known, language hints, duplicate candidates, unreadable items and permissions. Keep **not supplied**, **not readable**, **not processed**, and **not authorized** distinct. Empty months do not prove that no events occurred.

Planned adapters: TXT/Markdown; JSON/JSONL and CSV with explicit column mapping; HTML; DOCX; and text-bearing PDF. Implement and verify adapters incrementally. The UI advertises only installed, tested adapters. Scans/handwriting require a separately authorized OCR/transcription path; preserve page images and mark uncertain passages. Do not silently treat a PDF with missing scanned pages as fully parsed. Audio and proprietary app formats remain unsupported until an adapter is tested.

### C. Process with visible progress

Show separate progress for files archived, pages/entries parsed, source units examined, extraction checked and material ready for session use. Counts come from the work ledger. Unknown totals remain unknown. The interface must not display “all memories saved” when only upload completed.

Prefer **high-retention processing** for an authorized historical import: full source coverage, an omission-focused second pass, and cross-entry reconciliation. Before external calls, estimate work from actual text volume, record the approved provider/cost boundary, and use the existing authorized provider policy. No API-spend fallback, silent model substitution or repeated full-corpus rerun after an outage. Exhausted quota pauses unfinished work without losing archived sources or completed results.

### D. Review exceptions, then activate

Show the extracted timeline with exact-source access and a small exception queue: ambiguous dates, uncertain identities, low-quality text, incompatible reports and potentially misleading interpretations. The user can correct these without rewriting the original. Ambiguous identity merges stay separate until resolved; ordinary labelled historical reports can remain usable without manual confirmation of every sentence.

Commit the selected generation to search and/or session use only within the authorized permission. Allow explicit partial activation with a visible exclusion manifest; never label a partially processed import fully indexed. Review can finish without enabling therapy use.

### E. Inspect and change later

Every memory card offers **See original**, **See what changed**, **Pin**, **Correct**, **Exclude from sessions** and **Delete**. Ordinary explanations show date and epistemic status, not opaque IDs. The optional graph opens a selected person's/event's neighborhood and has an equivalent accessible list. Preserve keyboard navigation, screen-reader progress announcements, mobile layouts, long French/English text and reduced motion. No graph-only controls.

These are interaction requirements, not claims of completed visual or usability testing. The incumbent app is being extended, not redesigned.

## 4. Ingestion pipeline and completeness

The controller owns this durable stage sequence:

`UPLOAD → INVENTORY → PARSE → EXTRACT → CHECK_OMISSIONS → RECONCILE → REVIEW → COMMIT → AVAILABLE`

Store stage independently from run status (`running`, `paused`, `needs_input`, `retryable_error`, `failed`, `cancelled`, `revoked`, `complete`). Archive-only completes after inventory and byte verification. A paused job retains its precise stage; it is not a new untracked job.

1. **Archive exact bytes.** Stream each original into encrypted storage, compute private integrity digests, and verify reopening. Preserve the original filename privately; use opaque server-owned storage keys. Retain attachments even when analysis is unsupported, with a visible status.
2. **Parse without replacing.** Version each text representation by source and parser version. Record encoding decisions, parsing warnings, file/page/paragraph/row locators and omissions. For a binary document, text offsets refer to the extracted UTF-8 representation, not fictitious offsets in the PDF/DOCX binary.
3. **Form entries and source units.** Prefer original entry boundaries and paragraphs; keep neighboring context where needed. Long entries split into linked parts, not truncated records. Preserve complete source text and a non-overlapping unit coverage map. Overlapping model windows point back to those units and do not multiply evidence.
4. **Extract source-backed observations.** Each assertion must link to exact spans and carry uncertainty and temporal scope. Do not impose a fixed number of retained facts per entry. If output limits are reached, split the unfinished source window and resume; a truncated model response cannot mark the window complete.
5. **Check omissions against the source.** A separate pass receives original source units plus candidate extraction and searches for missing meaningful details, qualifications, exceptions, negation and action/outcome distinctions. It must not receive only the summary and ask whether the summary sounds complete. Keep its versioned additions and disagreements. This improves review coverage; it is not proof of independent semantic correctness.
6. **Reconcile across entries.** Resolve clear aliases, connect retellings, locate corrections and changing circumstances, and propose temporal patterns. Uncertain entity merges remain proposals. Reconciliation cannot delete an awkward source or convert a hypothesis into fact.
7. **Build disposable navigation aids.** Entry/month/topic summaries help browse; every substantive summary claim has traceable supporting and qualifying spans. A source or interpretation correction invalidates dependent summaries. No summary-of-summary becomes the only surviving representation.
8. **Commit a generation.** Atomically publish an authorized snapshot after integrity checks, retaining the prior usable generation. The live therapy episode is not restarted or overwritten.

### Completeness ledger

Every admitted file, attachment, page when enumerable, entry and text unit has a terminal disposition or pending stage. Each source unit records `extracted`, `no_assertion`, `needs_review`, `unreadable`, `excluded` or `pending`, its parser/extractor versions and a reason where applicable. `No_assertion` does not remove raw-search access. Headers/formatting can be classified separately, never invisibly dropped.

Report upload byte fidelity, inventory accounting, parse coverage, extraction pass coverage and audited semantic recall **separately**, with their own denominators. Accounting for an unreadable page is not extracting it. Units that are excluded or unreadable do not inflate successful parse/extraction percentages.

## 5. Data model: an evidence graph, not a biography verdict

All objects are case-scoped, permission-scoped and versioned. Public source code contains only schemas and invented fixtures. Real IDs, filenames, text and content-derived hashes remain private.

| Record | Required information |
|---|---|
| Corpus / import job | Case binding, grant/version, selected-source manifest, operations, stage/status, completed work keys, versions, budgets and exclusions |
| Original object | Opaque ID, media type, exact byte length/private digest, encrypted chunks, private source locator, acquisition time |
| Representation / entry | Original reference, parser version, UTF-8 text/private digest, entry boundary, original order, authored-time metadata, language, source map and warnings |
| Evidence span | Representation ID/version, half-open UTF-8 byte range, exact quote/private digest and human-readable source locator |
| Entity / event | Case-local ID, type, source-backed names/aliases, uncertain-match links; events have interval/precision and participants |
| Assertion | Statement, epistemic kind, polarity, subject/context, evidence IDs, temporal scope, currentness, review state, extraction provenance and importance reasons |
| Relation | Typed endpoints, evidence/derivation references, temporal scope, confidence in extraction, review state and lifecycle |
| Projection | Summary or session/state view, complete dependency IDs, corpus generation, algorithm/prompt version, authorization epoch |

**Assertions are first-class nodes**, not bare triples stripped of qualifications. Distinguish `direct_report`, `belief`, `quoted_other`, `dream`, `imaginal_experience`, `intention`, `reported_action`, `reported_outcome`, `hypothesis` and `explicit_correction`. These are proposed import types; map only selected compatible projections to existing case-state types through a checked adapter.

Confidence in having extracted a statement correctly is not the probability that the statement is objectively true. A diary's certainty about another person's motives remains an attributed belief. Dreams are preserved as dreams, not evidence that the external event occurred. Planned action, imagined enactment, reported completion and perceived outcome remain separate.

Use a small relation vocabulary initially: `supported_by`, `mentions`, `part_of`, `retells`, `precedes`, `contradicts`, `qualifies`, `exception_to`, `corrects`, `supersedes`, `possible_same_entity`, and `reported_effect_of`. The latter records the writer's attribution, not established causation. A substantive relation must be supported by source spans or explicit versioned derivation; graph proximity cannot prove a cause.

A model may propose a correction or supersession link, but automatic retirement of a prior assertion requires an explicit source correction with matching subject, proposition and temporal scope, or a user-approved correction. A newer differing statement alone is not enough. Historical assertions stay inspectable unless deletion is requested. A person's name alone never establishes identity.

### Example — entirely invented

An early entry says, “I never feel comfortable asking for help.” A later entry says, “I asked a colleague for help today and felt relieved.” Keep both dated reports, link the latter as an exception or change candidate, and retain the actual passages. Do not overwrite the earlier experience, conclude the problem is cured, or encode “cannot ask for help” as a permanent trait. The same principle applies to supportive relationships, boundaries and unsuccessful or successful attempts to cope.

## 6. Time, contradiction and importance

Keep these times separate: **authored time**, **event/valid-time interval**, **ingestion/system time**, and **correction/retirement time**. Store the original time expression, precision, timezone when actually known and resolution basis. A file modification timestamp is not a journal event date. “Last winter” or a month-only heading may remain an interval or unresolved phrase; do not invent a day, midnight timestamp or timezone.

Historical import order must not determine “latest in the person's life.” Query order is an explicit stable tuple of resolved event/entry interval and entry ID; undated material has a visible separate bucket. A claim about childhood written yesterday has yesterday's authored date and a distinct historical event interval.

Default `still_current` to **unknown** for imported historical assertions. Selective continuity projections may preserve an explicitly reaffirmed value, preference or open commitment, with its source and review date. Import does not set current threat, protective-compatibility or therapy-route state. Historical risk language remains historical evidence unless present context independently makes it current.

Keep contradictory reports linked rather than voting by frequency or retaining only the latest. Distinguish genuine incompatibility, different contexts, change over time, explicitly corrected error, and unresolved identity/date ambiguity. Absence of a later mention is not resolution. A journal is an observed writing record, not a complete sampling of the person's life; frequency charts describe recorded mentions, not symptom prevalence.

Importance reasons remain inspectable: user-pinned, correction, major transition, open commitment, relevant to present question, rare counterexample, resource/strength or repeated theme. No single hidden salience score defines what is worth retaining.

## 7. Storage, atomicity and compatibility

Extend the existing encrypted private store with a **sidecar corpus object store**; do not replace the backend or lift existing safeguards indiscriminately. Original binaries, text shards, evidence records and index shards live as encrypted objects outside Git. A compact case-record reference points to the active corpus generation. Proposed case schema v7 adds that reference while v6 remains readable; version negotiation must reject unsupported writes rather than strip new fields.

Reuse the existing reviewed encryption/key-provider boundary. Source objects need independently wrapped object keys or an equivalently reviewed object-encryption design, authenticated case/object/version binding, unique encryption nonces and routine/recovery access. Do not invent a new cryptographic primitive. Key material, journal text and embeddings never enter public logs. New object crypto and migration require focused security review before real data; this document does not certify them.

Within the first deployment, retain **one mutation-owning service per private store**. Route journal commits and existing case mutations through the same durable case coordinator; the current in-process Map is not a multi-process or distributed lock. Do not scale writers horizontally until transactional coordination is implemented and tested. Long extraction runs hold no case lock.

Commit protocol: write and verify new encrypted objects; durably write the immutable generation manifest; acquire the shared case coordinator; recheck authorization, grant epoch and expected case/corpus revisions; atomically replace the case record with the new pointer; then acknowledge. A revision conflict rebases the pointer update without replacing unrelated therapy changes. Never acknowledge before durable publication. Orphan staging objects are invisible and later collected by a bounded recovery pass. Crash/restart tests cover every publication boundary.

Store typed adjacency and search indexes inside this private object boundary. The initial implementation can build bounded in-memory indexes from authorized encrypted shards. Persisted caches, vectors and entity indexes are encrypted too. No plaintext database is introduced merely to make search convenient. Multi-user PostgreSQL remains a later implementation option under the selected stack; database indexing does not magically search application-encrypted plaintext.

Never duplicate every imported entry into legacy `journal_entries`. A versioned journal facade combines legacy entries and committed corpus entries, deduplicated by origin identity. Legacy readers keep their current response contract and an honest truncation indicator. New readers negotiate the paginated interface below.

## 8. Search and session use

Search the raw text **and** structured evidence. Exact/source/time search must work when extraction is incomplete or the graph misses a detail. Optional semantic embeddings use only an authorized route and can fail without disabling lexical search or exact retrieval.

Retrieval sequence:

1. Authorize the case, journal scope, purpose and current grant epoch before decrypting/searching permitted material.
2. Retrieve source candidates by lexical terms, entity aliases and time; optionally combine semantic matches. Preserve an explicit unknown-date lane.
3. Expand the selected graph neighborhood by a small bounded number of hops; follow corrections, qualifying passages and relevant contrary evidence.
4. Rank for the current question, diversity over relevant periods, user pins and exact source quality. Do not let duplicate retellings or recent entries monopolize the budget.
5. Recheck visibility/deletion epoch, then produce the bounded evidence packet. A correction and its target should travel together when both are relevant. Missing or excluded contradictory evidence must not become a false confident answer.

The packet carries snapshot identity, search coverage, exact excerpts, assertion types, temporal applicability, source references, counterevidence, unresolved issues and `more_available`. It says “not found in the searched/authorized material” rather than “never happened.” Topic-wide answers use time/topic summaries to locate sources, not as a substitute for original supporting evidence.

Protect the complete active therapy episode and existing candidate/audit context budgets. Journal evidence is an additional bounded input, not a giant system prompt. It cannot promote itself to instructions, execute tools, set a diagnosis, change guides, or approve a therapy response. The existing case formulation/planning and independent audit still decide how current evidence matters.

Queries should support “What changed?”, “What had already been tried, and what was actually reported afterward?”, “When did this first appear in the available journal?”, “Which exceptions or resources have we overlooked?” and direct exact-entry lookup. The graph is useful only if it improves these tasks beyond a strong source-search baseline.

## 9. Proposed API and continuity contract

All routes below are **new proposals**, not existing deployed endpoints. Integrate into the authenticated private API, never the unauthenticated development inspector. Use ordinary transport-owned auth; tokens and key material are not model tool arguments.

| Operation | Contract |
|---|---|
| `POST /v1/journal-imports` | Create scoped job from case, granted operations and selected-file manifest; client idempotency key |
| `PUT /v1/journal-imports/{job}/objects/{object}/chunks/{n}` | Bounded resumable chunks with private digest and server-owned object identity; conflicting replay is rejected |
| `POST /v1/journal-imports/{job}/start` | Verify inventory and grant/provider boundary; enqueue only unfinished work |
| `GET /v1/journal-imports/{job}` | Stage/status, exact counters, warnings, exclusions, next action and retryability; no raw text in generic status |
| `POST /v1/journal-imports/{job}/review` | Idempotent explicit correction/identity decision bound to exact revision |
| `POST /v1/journal-imports/{job}/commit` | Expected generation/case revision, selected entry set and permitted uses; atomic activation |
| `POST /v1/journal-imports/{job}/pause` or `/cancel` | Stop future work; cancellation does not silently mean deletion |
| `POST /v1/journals/search` | Purpose, case or frozen handoff reference, query/filter, bounded page size, opaque cursor |
| `POST /v1/journals/spans` | Resolve exact authorized entry/span IDs and adjacent context, with bounded pagination |
| `POST /v1/journals/corrections` | Add source-linked user correction; no edit of original bytes |
| `POST /v1/journals/visibility` | Change session-use permission without pretending to erase originals |
| `POST /v1/journals/deletions` | Confirmed deletion scope and affected-derived-data inventory; immediately invalidate visibility |
| `POST /v1/journals/export` | Authorized portable original/derived archive; explicit destination and sensitivity warning |

POST search keeps private query text out of URL logs; bodies must also be excluded from request logging. Cursors are integrity-protected and bound to case, filter, snapshot generation, purpose, authorization epoch and stable ordering. Recheck the principal on every page. Changing filters invalidates the cursor. A source snapshot must remain usable for a valid cursor unless revoked/deleted; new imports do not reorder it.

Use explicit errors such as `CONSENT_REQUIRED`, `CONSENT_REVOKED`, `UNSUPPORTED_FORMAT`, `PARSE_INCOMPLETE`, `OUTPUT_INCOMPLETE`, `REVISION_CONFLICT`, `CURSOR_STALE`, `SOURCE_REVOKED`, `QUOTA_PAUSED` and `RETRYABLE_PROVIDER_FAILURE`. All errors are content-free. Authentication/authorization failures must not reveal whether another case's object exists.

Private Continuity remains read-only. Add a version-negotiated paginated journal search/source-read bridge or extend existing read tools with negotiated options; never expose import, correction or deletion mutations to an auditor. Existing handoff versions remain immutable and readable under current permission.

A new handoff version may reference an immutable corpus snapshot rather than embed a multi-year corpus, but **a manifest is not the content**. Negotiate source-read capability, provide executable paginated access, bind authorization/deletion checks, and validate fresh-session retrieval of early, middle, recent and corrected evidence. Preserve the complete exact active therapy episode, exact candidate and approval semantics unchanged. Older clients unable to read the corpus must see journal continuity as unavailable, not a falsely complete handoff. Handoff export must include required encrypted corpus objects for portable recovery, or explicitly declare itself a non-self-contained reference export.

## 10. Privacy, hostile input and deletion

Treat all journal text, filenames, embedded instructions and imported links as untrusted data. Parsers run with restricted resources and no network. Reject traversal paths, symlinks, archives exceeding expansion limits, dangerous nesting and unsupported active content. Inspect media signatures, disable HTML execution/external entities/macros, and do not fetch linked URLs or remote images. Quotas are explicit configuration; exceeding one yields a recoverable exclusion/error, never silent truncation.

Model workers receive only the authorized source window and task schema. Journal passages saying “ignore instructions” cannot select tools, providers, recipients, system prompts or storage paths. Case-scoped authorization is enforced by code, not a prompt. Cross-case identities, deduplication, embeddings and caches never mix.

Exact duplicate file bytes may share storage **within the same authorized case** while preserving every acquisition/source reference. Repeated identical text on different diary dates remains separate events. Near duplicates and edited re-exports are version/overlap candidates, not automatic deletions. Work-item identity includes source identity, representation version, source-unit range, extractor version and grant scope. A completed validated call is reused; a provider timeout after ambiguous submission is reconciled before resubmission.

Every derived graph item, vector, summary and session/state projection records dependency lineage. Revocation immediately blocks new provider calls and retrieval; queued workers recheck the grant before each call, checkpoint, commit and return. In-flight external disclosure cannot be undone, and its result cannot be activated after revocation. Read access and provider consent are separate grants.

Deletion first creates a durable tombstone and increments the visibility epoch, then removes or regenerates all dependent indexes, summaries, caches, state projections and server-held handoff copies. Mixed summaries are regenerated from surviving sources. A projection that also has independent surviving support is recomputed rather than blindly deleted. Immutable historical originals are not exempt from the subject's authorized deletion request.

Delete live ciphertext and applicable key wraps; purge backups according to a documented retention schedule. A restored backup cannot become accessible until current tombstones and grants are reconciled. Per-object deletion must not destroy the key for the whole case. “Cryptographically erased” is not claimed while a recovery key/wrap or backup can still decrypt the object.

Already downloaded exports, copied quotations, sent responses and provider-held copies cannot reliably be recalled. Make those limits clear. Session exclusion is reversible and distinct from deletion. Reimport of a tombstoned source requires explicit authorization, not an unnoticed resurrection through backup or duplicate detection.

## 11. Validation and acceptance

### Mechanical, release-relevant invariants

Verify exact original-byte reopening, exhaustive file/page disposition accounting, contiguous UTF-8 source coverage, exact quote resolution, no orphan evidence/relation references, stable snapshot pagination beyond 200 matches, revision-safe commit/restart, idempotent retry, current-grant enforcement, cross-case denial and deletion propagation. Unsupported/unreadable material must remain visible as such. These are testable requirements, not claims that runtime tests have passed.

The companion `contract.json` and `acceptance-cases.json` make key fields, boundaries and hostile cases explicit. `validate_design.py` checks only the internal consistency of this design packet and invented examples. It does not test the app, perform model extraction, certify security, or establish retention on real journals.

### Semantic pilot

Before claiming effective memory, use a small authorized sample spanning the available date range, languages, long/short entries, mundane and salient material, revisions and exceptions. Annotate important assertions directly from sources before inspecting generated answers. Keep an untouched held-out portion. Include subject-identified must-not-miss information without requiring the subject to reread two years of material.

Compare **the same source search, corpus, model and context budget with graph expansion disabled versus enabled**. Score extraction recall, source-faithful precision, retrieval of rare/old facts, correction handling, dates/currentness, action-versus-outcome distinctions, justified abstention, duplicate inflation and unsupported inference. Record both weighted and unweighted results with denominators; aggregate accuracy must not hide missing qualifiers or safety/privacy errors.

A useful provisional improvement target is at least 95% important-assertion recall on the held-out pilot and retrieval of every annotated must-not-miss item for the questions designed to require it. This is an engineering target, not an achieved result, scientific claim, universal guarantee or new blocker to archive-only use. Report uncertainty and inspect misses. Exact citation mismatch or privacy leakage is a defect, not a tradeoff to average away.

If the graph adds no material retrieval benefit, retain the exact archive, source index and temporal assertions; defer complex clustering rather than forcing a graph database. Measure actual processing work, peak memory, latency and recovery overhead before setting a full-corpus limit. No corpus-size estimate can substitute for inspecting the actual export.

## 12. Implementation sequence and evidence boundaries

| Slice | Concrete work | Exit evidence |
|---|---|---|
| 1. Archive-only | New encrypted corpus objects, resumable intake, source inventory, text/JSON adapters, shared mutation coordinator, grant checks and exact export | Synthetic original-byte round trip, hostile upload denial, pause/resume and no model calls |
| 2. Searchable sources | Versioned representations, entry/source maps, lexical/time search, stable pagination and unknown-date handling | Early/middle/late exact retrieval beyond legacy limits; no silent parse loss |
| 3. Evidence graph | Assertion schema, scoped extractor adapter, omission pass, lineage, aliases, contradictions and corrections | Source-backed invented fixtures plus authorized source-level pilot; no automatic state/route changes |
| 4. Product review | React import flow, status/review/visibility/deletion controls and optional neighborhood graph | Keyboard/mobile/long-text/error recovery checks; complete list alternative |
| 5. Continuity integration | Bounded memory packet, selective compatible state projections, read-only MCP pagination and negotiated handoff snapshot | Fresh isolated reader retrieves distant original evidence while existing episode/candidate audit gates remain green |
| 6. Private pilot | Source-format-specific adapter validation, high-retention sample, comparison with graph disabled, then scoped full import | Actual coverage and miss report; separate archive/index/session-use completion receipts |

Proposed modules: `src/journal-import/{controller,inventory,parsers,coverage,extraction,reconciliation}.mjs`, `src/storage/private-journal-corpus.mjs`, `src/case-state/journal-evidence-context.mjs`, and schemas under `schemas/journal-import/`. These paths are proposals, not files already implemented. Extend existing private-case access/store and handoff adapters rather than inventing parallel authentication. New frontend components belong in the incremental React app direction, not an uncontrolled expansion of the legacy monolith.

Implementation should start from this branch's source evidence, refresh current main and reconcile changes before coding. Use focused tests per slice. Before real-data migration, hosted writes, merge/release or installation, run the corresponding existing project security, package, publication, continuity and rollback gates. The present design does not authorize deployment, stable promotion, paid model calls, or real-case mutation.

No owner answer is needed to complete this generic design. A representative export and appropriate subject authorization are needed for source-specific adapter verification and actual import. They are not a reason to leave architecture, recovery or acceptance requirements unfinished.

## 13. Evidence, reuse decision and limitations

**Research disposition: compose/adapt.** The independent idea—exact sources plus a personal evidence graph—was checkpointed before the external scan. Microsoft GraphRAG documents combining graph data with original text for local retrieval [R1], and summary-based global retrieval [R2]. Graphiti documents incremental temporal graphs and hybrid search [R3]. W3C PROV describes attribution, derivation and versioning [R4]. Reuse those concepts, not their entire runtime or any unverified performance claim. No claim of a novel memory theory or demonstrated therapeutic benefit is made.

The project-specific work is permission-bound journal ingestion, evidence-preserving temporal semantics, omission accounting and compatibility with existing private continuity. Graphiti/GraphRAG are external architectural references; the strongest economical comparison is the application's own source-search baseline under matched conditions. A managed graph service, RDF stack, extra reviewer tournament and multi-model benchmark are not prerequisites.

### Primary references (read 2026-09-19)

- **R1** Microsoft GraphRAG, Local Search: https://microsoft.github.io/graphrag/query/local_search/
- **R2** Microsoft GraphRAG, Global Search: https://microsoft.github.io/graphrag/query/global_search/
- **R3** Graphiti official documentation: https://help.getzep.com/graphiti/getting-started/welcome
- **R4** W3C PROV Overview: https://www.w3.org/TR/prov-overview/

### Current-code evidence at the pinned development commit

- **P1** `src/storage/private-case-access.mjs`: authorization/key order, scope and mutation coordination, journal and handoff facade.
- **P2** `src/storage/private-case-store.mjs`: record v6, journal bounds and selector, append and handoff storage.
- **P3** `src/storage/exact-source-artifact.mjs`: exact-text limits and byte-preserving chunk validation.
- **P4** `src/case-state/longitudinal-state.mjs`: bounded current state, epistemic types and contradiction/provenance fields.
- **P5** `docs/PRIVATE-CASE-CONTINUITY.md` and `docs/INSTRUCTION-CONSUMER-MAP.md`: exact private continuity and consumer isolation.
- **P6** `docs/superpowers/specs/2026-09-19-web-app-stack-direction.md`: owner-selected frontend/backend/storage direction.

The live Design OS skill and its authority/perception guidance were read for the interaction flow; its referenced root `references/operations.md` returned 404. No missing rule was reconstructed. No rendered UI, browser usability test, independent semantic review or production security review was performed in this design task. Real source format, volume, language mix, processing grants and empirical recall remain unverified.
