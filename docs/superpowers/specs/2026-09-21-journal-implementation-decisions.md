# Journal importer implementation decisions and execution contract

Version 1.0, 2026-09-21. Status: protocol authored; production implementation and profile import remain OPEN.

This document records the implementation decisions from the owner-requested Pro protocol turn. The complete owner-delivered machine packet also contains JSON Schemas, role prompts, a pure reference kernel, invented fixtures, tests and an exact file manifest. Its controlling entrypoint is `START-WORK.md`. The private execution bundle additionally contains the original source, private run binding and earlier calibration inputs. Those private files must never enter this repository. This Git document is a durable decision record, not a claim that the entire downloadable packet or any real journal has been committed to Git.

## Owner outcome and source authority

Build a high-retention private journal importer with an explicit temporal evidence graph, discover and audit key patterns without asking the owner to read the whole source, and support twenty-calendar-year archives. The current requested deliverable is a complete implementation protocol for mechanical Work execution. Completing that protocol does not complete live extraction, graph construction, independent review, profile commitment or capacity measurement.

Verified development baseline: `038f7ee61e0ddbb760e8263dbc6de3c06a56bfcf`. Prior archive design: `db431085f5d8ea1b6e3b24aa1c6efa7247f025b9`; audit extension: `06e4c63120d51fec0490a8c9f89207e394c664ab`. Read live UDA/project authority and refresh main before implementation. Use a new isolated implementation branch, preserve unrelated changes and active integration ownership. Do not use draft designs as installed behavior.

## 1. Fixed architecture

Four layers remain distinct: exact encrypted originals; versioned readable source units; private temporal evidence graph; bounded session/pattern projections. The personal graph is a required data and product deliverable. It is not the therapeutic-method graph, an architectural diagram, a keyword list or a force-directed picture.

Reuse the existing Node 24 runtime, authorization-before-keys boundary and encrypted case store. Follow the selected React/Vite/TypeScript frontend direction incrementally. Do not introduce a graph server, paid memory service, second backend, Firebase, new provider or a whole-app rewrite. Typed adjacency records and encrypted index shards are sufficient for v1. The renderer is replaceable, not canonical memory.

Originals remain available when extraction misses a detail. Raw lexical/time/exact-source retrieval is an independent fallback. Graph importance controls attention, not source deletion. Imported history does not automatically become current facts, a diagnosis, current threat state, a changed therapy route or an approved response.

## 2. Code ownership

- `src/storage/private-case-access.mjs`: add journal methods and purpose grants; preserve authorization before keys. Replace independently instantiated mutation Maps with a shared case coordinator for every legacy/new mutation in journal-enabled mode.
- `src/storage/private-case-store.mjs`: v7 compatible corpus pointers and encrypted corpus-key entries, not the entire archive or a raised current-state limit.
- `src/storage/vault-crypto.mjs`: preserve existing case envelope and routine/recovery wraps; add separately versioned object encryption, not repeated recovery KDF per assertion.
- `src/storage/exact-source-artifact.mjs`: retain existing text limits; binary originals use the new archive path.
- `src/case-state/longitudinal-state.mjs`: retain bounded working state and current episode. Import is a corpus attachment, not biography overwrite.
- `src/supervisor/private-therapy-turn-controller.mjs`: add bounded evidence through model-runtime/context assembly; preserve the complete active episode and exact candidate/audit/delivery lifecycle. Bind the same frozen journal packet to therapy producer and auditor.
- Private MCP and operation/service composition: new version-negotiated read-only source/graph capabilities; backend mutations remain separately authenticated. No private inspector on an unauthenticated development endpoint.

New modules are `src/journal-import/{contracts,source-manifest,partition,anchors,graph,reconcile,retrieval,audit,controller,provider-port,http,report}.mjs`, parser/pattern submodules as needed, `src/storage/{private-journal-corpus,journal-object-crypto}.mjs`, shared coordinator, `src/cli/journal-import.mjs`, and `schemas/journal-import/`. These are implementation requirements, not existing baseline files.

## 3. Storage and commit

V7 adds small `journal_corpora` references: corpus ID, active generation, visibility epoch and manifest object ID. Existing v6 content loads unchanged with empty extensions. Legacy writers unable to preserve v7 reject journal-enabled writes. Existing immutable handoffs are not silently rewritten.

Generate a random 32-byte corpus key and store it inside the existing encrypted case envelope, recoverable through the existing case recovery path. Each immutable object has a random 32-byte data key wrapped by the corpus key. Encrypt with the project's AES-256-GCM convention: 12-byte random nonce, 16-byte tag, separate key-wrap and payload domains. AAD is the exact UTF-8 JSON array `["inner-signal-journal-object-v1", purpose, case_id, corpus_id, object_id, object_version, chunk_index]`; purpose is `key-wrap` or `payload`. Expected identity/version must match before accepting plaintext. Test swapped headers/cases/objects/versions/purposes. Do not change the existing case cryptosystem or claim new crypto certified by this design.

Use random storage IDs, regular files only, 0600 files/0700 private roots, no traversal/symlinks. Original chunks default to 4 MiB; text/graph/index shards target 1 MiB with a configurable 4 MiB object bound. Split oversized logical records rather than truncate. All persistent lexical, temporal, alias, adjacency, reverse-dependency and optional vector indexes are encrypted. Never assume a plaintext database can transparently search application-encrypted content. Clear key buffers and close handles without promising perfect managed-memory erasure.

One process owns a private root in v1. Enforce an OS-held exclusive lock at startup for the supported host and keep its file descriptor for process lifetime. A second writer fails closed. A stale PID or age-deleted file is not a distributed lock. All case factories use the same coordinator; long parsing/inference holds no case mutex.

Commit order: write objects; reopen/authenticate; fsync objects/directories; write/fsync immutable manifest; acquire shared case coordinator; reauthorize and recheck epoch; load latest case revision; compare expected corpus generation; atomically replace only corpus pointer through normal durable case write; fsync; release; acknowledge. Conflicts rebase the pointer change without replaying an old whole-case snapshot. Orphan staging is invisible; delayed garbage collection respects references and leases. Rollback restores the previous pointer without deleting evidence. Test every crash boundary and a concurrent therapy mutation.

## 4. Source parsing, units and visuals

Implement PDF and UTF-8 text first. Use a pinned, tested PDF.js production adapter after compatibility/license/security checks; prior PyMuPDF/Poppler diagnostics do not silently become production dependency choices. Parser subprocess has no network, active content or external link fetching and bounded resources. Initial per-file proposals are 128 MiB/20,000 pages; exceeding a cap pauses with explicit status, never silently cuts the file. These are testable provisional resource bounds, not evidence for all twenty-year journals.

Inventory every page, image, attachment and text region, including geometry/rotation/order and warnings. Native extraction and visual/table interpretation are separate representations. A no-text page is visual_pending, not blank. Visually inspect no-text pages, material reading-order disagreements, replacement glyphs and content-bearing figures. Preserve table headers, units, dates and cells; flag illegibility. Do not identify people from faces. OCR is last resort, not bulk default.

Partition representations into nonoverlapping ownership units, preserving every UTF-8 byte. Core target 12,000 bytes/max20,000, with up to8,000 bytes neighboring context on each side. Prefer entry/paragraph boundaries; split oversized paragraphs safely. Token fit is verified with the actual provider tokenizer; bytes/words are not tokens. Neighbors do not count as processed core. Cross-page narrative boundaries can request more context; unresolved boundaries retain scope uncertainty.

Models return local IDs and exact quote/occurrence anchors; code computes UTF-8 ranges, hashes and stable IDs. Ambiguous/unmatched quotes fail admission, never fuzzy-repair silently. A two-pass ID map allocates candidate IDs then resolves entity/episode/time/source references. For restricted graphic source material use a non-graphic assertion and a controller-bound source-unit/region pointer. Its range/digest is computed by code; quote is null and disclosure restricted. Original bytes remain private. This is not an excuse to hide unassessed meaning.

## 5. Explicit evidence graph

Node types: source, passage, entity, episode, assertion, theme, pattern. Common identity includes case/corpus/ID/version/lifecycle. Assertions retain speaker, subjects, episode, original-language statement, polarity, qualifiers, authored time, event time, source evidence, extraction provenance, review state and currentness. Imported `still_current` is null. Time retains original expression, interval, precision, timezone/basis and evidence. Unknown time has null bounds/timezone. Import order/file name is not event time.

Assertion kinds: direct_report, belief, quoted_other, dream, imaginal_experience, intention, reported_action, reported_outcome, hypothesis, explicit_correction, uncertain_memory. Narrative mode separately distinguishes waking/dream/imaginal/quoted/uncertain. A page may contain several modes, including an awake correction in a dream account. A plan does not establish action; action does not establish successful effect. A stated belief about another person is not external truth.

Typed directions:

- source `contains` passage;
- assertion `supported_by` passage;
- passage/assertion `mentions` entity;
- assertion `in_episode` episode;
- assertion/pattern `about_theme` theme;
- assertion `supports_pattern` pattern;
- assertion `contradicts`, `qualifies` or `corrects` assertion;
- assertion `exception_to` assertion/pattern;
- episode `retells` or `precedes` episode;
- entity `possible_same_entity` entity;
- reported-outcome assertion `reported_effect_of` reported-action assertion, with basis author_attribution only.

Every substantive relation has evidence plus derivation provenance when inferred. No `causes`, `cures`, `proves` or `diagnoses` edges. Graph proximity/centrality never establishes cause. Contradictions are query-symmetric while keeping original edge provenance. Same-name aliases remain proposals absent explicit compatible source evidence. A new differing assertion does not retire an old one. Explicit corrections still need a correctly matched proposition/subject/time before retiring an interpretation; keep both originals.

Copies/retellings share support groups without removing their acquisition records. A recurrent pattern requires more than one distinct occurrence by definition, not as a significance threshold; important single events remain first-class. No fixed fact or pattern quota discards sources.

Required structural checks: duplicate IDs, dangling references, foreign-case/corpus data, wrong endpoint kinds, out-of-range or mismatched passages, unsupported assertions, inconsistent supports edges, currentness promotion, invalid time precision, active dependencies on revoked evidence and unsupported causal types fail. JSON shape alone does not prove source entailment or authentic review.

## 6. Inference and recovery

`JournalInferencePort.invoke({role,packet,outputSchema,operationKey,grant})` returns output plus a separate trusted transport receipt. Bind actual request/context identity, packet manifest, requested model/effort, completion and available cost/usage. A model-written identity/status is not a receipt. Resolve the existing source-authorized semantic route; it is not the engineering Work model. Missing effective readback is null, not invented. Default external spend is0; credentials do not authorize spending or a new disclosure destination. Use mock inference for implementation until an authorized real route exists.

Nine roles: visual_reader, extractor, omission_checker, reference_reader, fidelity_auditor, reconciler, pattern_builder, pattern_reviewer, cold_consumer. Each receives only its role-specific source packet and schema, not UDA/engineering instructions. Fresh packet-only semantic contexts are required where independence is claimed. The engineering worker cannot role-play its own independent auditor. A subscription chat with memories/history is not automatically isolated. Unavailable isolation blocks that claim, not raw source indexing.

Stages: INTAKE, PARSE, PARTITION, EXTRACT, OMISSION_CHECK, RECONCILE, GRAPH_VALIDATE, REFERENCE_AUDIT, PATTERN_BUILD, PATTERN_REVIEW, COMMIT, COLD_TEST, REPORT. Run state is separately ready/running/paused_quota/retryable_error/needs_context/blocked_authority/completed/cancelled/revoked. Every unfinished state exposes its exact next action and actor. Archive/raw search may be published before semantics, labelled separately.

Key each work item by case/corpus/representation/core range/role/prompt version/model profile/grant purpose using a controller-generated private digest. Persist intent before send and exact output before advancing. Ambiguous submission timeout first reconciles provider state; no blind resubmission or duplicated spend. Known retryable failure gets two attempts; malformed output gets one schema reserialization attempt, not silent regex repair. Output truncation stays incomplete and splits unfinished core. Two semantic repair cycles are a practical default, then unresolved/source-only plus Chat review while independent units continue. These defaults do not modify the separate therapy-candidate lifecycle.

## 7. Role instructions and audit

Visual reader transcribes only supplied images/regions, preserves report attribution/table units and flags uncertainty or restricted material. Extractor starts from source without prior case formulation, covers every core unit, emits local source-grounded proposals and unfinished/context requests. Omission checker sees source plus candidates and checks both lost meaning and added distortion; it is not blind. Repairs are emitted by an extractor/reasoning call, not hand-edited into truth by the worker.

Reference reader sees source and necessary neighbors only, excluding imported claims, prior hypotheses, verdicts and answer keys. It freezes propositions, required qualifiers and questions before candidate reveal. Fidelity auditor then compares exact imported generation to that frozen reference and checks candidate→source support. Reconciler proposes scoped aliases, retellings, time and relation changes without automatic retirement. Pattern builder starts bottom-up from validated evidence and coverage, not a predetermined therapeutic explanation. Pattern reviewer freezes its source-first observations before receiving cards, then searches for counterexamples. Cold consumer answers only from the actual saved-profile facade, never the original upload, producer history or answer key.

Separate full-source extraction/omission coverage from independent sampled audit. Previous windows/questions are calibration/challenge, not untouched evaluation. Default initial calibration12 windows plus identified visual/parser hazards. Final probability sample12 position strata×up to8 distinct source units with recorded seed/probabilities; use all when fewer. Add targeted challenges separately. Do not estimate population error from targeted cases. Held out means questions/judgments, not withholding source from the memory importer. Report reference incompleteness and correlated blind spots.

Each reference item is preserved/omitted/distorted/unassessed; unassessed stays in denominators. Report source-supported precision, omission recall, qualifier/time/mode errors, critical and ordinary misses separately. Missing reference gives unknown recall, not100%. The earlier95% reference-set target remains provisional, not a global performance guarantee or an archive-only blocker. Counterevidence and citations require semantic interpretation; existence of a hash or link does not certify it.

Pattern cards include scope/status, distinct support IDs, contrary/exception IDs, supported time, immediate/later/functional consequences, alternatives, missingness, counterevidence search receipt, disconfirming question and versioned review. Counts describe writing unless episode denominators justify more. Writing purpose/density changes are not life changes. Joy and distress may coexist. Writer causal attributions and observational associations are not treatment efficacy or dose guidance.

## 8. Retrieval and view

Exact source, lexical/time and optional semantic paths remain independent. Initial50 candidates/path with reciprocal-rank fusion k60 and two bounded semantic hops are configurable search defaults, not storage caps. Mandatory correction/qualifier/contradiction/exception closure must accompany selected claims. Return a smaller complete group or insufficient_context when it cannot fit; never silently drop the reversal.

Authorize before decrypt/search and check current visibility epoch before return. Cursors are server-MAC bound to case, purpose, filter digest, generation, epoch, stable order and expiry. Unknown dates have a separate traversable lane. Later imports do not reorder a frozen cursor; revocation overrides snapshot validity. POST queries avoid URL leaks; bodies also excluded from logging.

Reserve complete active therapy episode and mandatory audit context first; journal allocation default maximum8,000 tokens within actual remaining budget. Pass one frozen journal packet to the relevant producer/auditor. Graph storage is not restricted to this context size.

UI: thin authenticated import/history view, source panel, time/theme filters, bounded neighborhood graph and equivalent accessible list. Initial100nodes/200edges with visible remaining count and expansion. Edge click shows evidence/status; pattern click shows exceptions. No whole-archive hairball, private browser persistent storage, service-worker cache or labels in third-party telemetry. Render text safely. Cytoscape.js is a candidate replaceable renderer, not a required host or domain authority. Verify keyboard/mobile/long text/error recovery and no private network leakage.

## 9. Proposed API/CLI

Controller methods: createJob, putChunk, sealSource, start, step, pause, status, review, commit, search, getSubgraph, resolveEvidence, correct, changeVisibility, delete, export. Existing case scope plus current journal-purpose grant is required. Audit persistence uses audit scope; ordinary user corrections use write. Source-only/raw-search commitment does not require session-use permission; enabling future sessions does. Cancellation is not deletion.

Implement authenticated `/v1/journal-imports` create; chunk PUT under job/object/chunks; job seal/start/pause/review/commit; GET job status. POST `/v1/journals/search`, `/subgraph`, `/evidence`, `/corrections`, `/visibility`, `/deletions`, `/export`. IDs never grant access. Protect cookie-auth routes from CSRF where used; transport-owned bearer tokens never become model arguments. Return content-free errors, identical foreign/missing object denial shapes, bounds/cursors and exact generation metadata.

Create `npm run journal:import -- <command> --config /absolute/private/run.json`. Commands doctor, inventory, stage, run, status, verify, audit, patterns, commit, cold-test, report, export, delete-plan. This command does not exist at baseline. Doctor tests actual directed read/write/isolated/private capabilities without real-case mutation. Run resumes authorized unfinished work but never implicitly commits/deletes. A write canary uses a separate authorized synthetic case, never invented data in the real profile. Public stdout is allowlisted status only; private receipts remain encrypted.

## 10. Implementation tickets and completion

J01 contracts/schema/CLI; J02 encrypted objects/coordinator/CAS; J03 PDF/text/visual inventory/UTF8 coverage; J04 stored graph/source indexes/snapshot retrieval; J05 controller/inference recovery; J06 blind reference/fidelity/pattern orchestration; J07 authenticated API/profile/continuity/cold test; J08 graph/list/import frontend; J09 capacity/deletion/recovery; J10 authorized real-source calibration/full processing/profile readback. Run in dependency order; J08 and J09 may proceed independently after J07. First complete a synthetic encrypted vertical slice with mocked meaning before any full-corpus real inference spend.

Use Node24 for application tests, actual repository commands and canonical test-cost observer. Focused ticket tests inside iteration; existing private-case acceptance after integration. Repository/publication audits and full verify at their actual authorized merge/release boundary. Therapeutic `graph:test` is not personal-graph correctness evidence. No public deployment/stable promotion or automatic protected merge is granted by this document.

For one recovery-sensitive end-to-end worker request GPT-5.6 Sol XHigh per live policy; per bounded ticket Sol Medium, exact copy/test Low. Requested setters and effective identity are distinct. Do not silently substitute Astra, enable Fast or buy credits. Work is justified by sustained dependent execution, not absence of Chat/GitHub/terminal tools. Mechanical workers implement and operate frozen semantics; unresolved substantive interpretation returns to the reasoning role.

Capacity tests use unique invented20-calendar-year histories, separately increasing1/10/50million UTF8 bytes, sparse/dense periods, changed names/roles, late corrections, gaps, imagery and mixed modes. Test >100sources, >2MiB original, >40k-JS-unit entry and >1001retrievalmatches. Stream test data; repeating real journals is not semantic scale validation. Measure RSS/latency/storage/time/token usage where actually run; no theoretical capacity claims. Incremental append must not re-extract all prior units or run all-pairs entity comparisons.

Before real commitment resolve correct profile from authenticated subject mapping, not a guessed name slug. Preserve all existing episode/candidate/transcript/current facts. Commit only an authorized corpus generation. Fresh consumer receives profile access and frozen questions only, with no upload/history/key; recover early/middle/late, correction, visual, rare exception, unknown date and absent/false-premise cases. Score retrieval separately from answer reasoning; compare graph on/off under matched conditions.

Corrections/revocation/deletion propagate reverse dependencies through graph, vectors, summaries, state projections and server-held handoffs. Tombstone/hide before purge; recompute mixed projections. Restore must reconcile current tombstones before serving. Exports and in-flight provider disclosures cannot reliably be recalled. Do not claim cryptographic erasure while recovery/backup copies can decrypt. Destructive deletion is separately authorized.

Owner receipt has independent archive_verified, raw_search_available, graph_built, semantically_audited, patterns_reviewed, profile_committed, cold_retrieval_verified, capacity_tested fields, each with exact evidence/status. Deliver navigable private graph/list, coverage report, matrix, source-linked pattern register and concise findings brief. The owner is not expected to certify the source or shuttle audit outputs. Only genuinely irreducible consequential ambiguities/authentication/spend gates require owner involvement.

## 11. Current delivered evidence and limits

The downloadable protocol includes a synthetic21-node/21-edge graph, nine role prompts, ten schemas, ten ordered tickets and a pure reference kernel. Actual reference tests passed41/41 after fixing locator/schema mismatches;16 schema/packet checks passed. Tests cover byte preservation, quote ambiguity, typed graph constraints, currentness/mode errors, correction closure, dependency impact and review-receipt metadata. They do not implement persistence/authentication/encryption or prove semantic fidelity. Receipt compatibility is not authenticity.

The generic machine packet and private worker bundle are actual owner-delivered attachments with verified manifests; they are not repository path placeholders. This public document deliberately omits the real source identity/hash/statistics. The complete machine packet is delivered alongside it rather than falsely claimed to exist in this Git tree.

Actual ChatGPT Work dispatch has not occurred. The creating surface did not resolve the originating Chat URL from allowed current metadata; a browser-history lookup was blocked and was not bypassed. The native launcher must supply the exact source title/URL and require it in every receipt, or accept the owner's explicit source URL. No fabricated backlink. This dispatch binding does not change implementation semantics or justify repeating the design work.

## Primary concept reuse

Disposition compose/adapt; reuse prior source-first scholarly scan and refresh primary implementation documentation. No new memory theory or demonstrated graph advantage claimed.

Microsoft GraphRAG local search: https://microsoft.github.io/graphrag/query/local_search/
LongMemEval: https://arxiv.org/abs/2410.10813
FActScore: https://aclanthology.org/2023.emnlp-main.741/
W3C PROV: https://www.w3.org/TR/prov-overview/
PDF.js official examples: https://mozilla.github.io/pdf.js/examples/
Cytoscape.js: https://js.cytoscape.org/
Node24 crypto: https://nodejs.org/docs/latest-v24.x/api/crypto.html

Public scores are not transferred to this system. Existing-code constraints, actual private grants and the direct saved-profile endpoint remain controlling.
