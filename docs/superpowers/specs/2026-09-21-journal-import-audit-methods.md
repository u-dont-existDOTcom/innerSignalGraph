# Journal import auditing and long-horizon pattern validation

Date: 2026-09-21. Status: PROPOSED METHOD, not an implemented importer, completed independent semantic audit, production security certification, or successful profile import.

Parent: `2026-09-19-high-retention-journal-import.md`, design head `db431085f5d8ea1b6e3b24aa1c6efa7247f025b9` (draft journal-import design review). This extension preserves exact originals, private evidence graphs and bounded session context. It adds an auditable path to large and twenty-calendar-year journals without requiring the owner to read the source manually. Real source details and all case findings remain private and are deliberately absent here.

## Outcome and authority

Keep five outcomes separate: original preservation; readable-content coverage; semantic fidelity; retrieval from the saved profile; and trustworthy revisable patterns. A convincing summary, a graph, an archived file or a positive overall score cannot substitute for an omitted outcome.

The current parent asks for audit-method design applied to a large source, while supporting eventual profile import. Method completion does not close the outstanding production extraction/import/independent-evaluation work. Continue independently executable in-scope work; do not create an owner approval gate merely from a phase label. Real profile access, provider disclosure, privacy and production boundaries remain applicable. Do not deploy, merge to stable or alter therapy policy from this document.

Retain the existing encrypted backend, authorization-before-keys boundary, read-only Private Continuity, exact active episode and candidate/audit/delivery contracts. Historical evidence does not automatically become current clinical truth or change therapy routing. Do not copy governance into therapy prompts. All real corpus text, IDs, source filenames, hashes, embeddings and case findings remain outside public Git. A session sandbox is not the encrypted production store.

## A. Original preservation and representation audit

Inventory every admitted file, attachment and page. Reopen and verify exact original bytes. Record parser versions and source locators. Native text, normalized search text, translations and visual interpretations remain separate representations. Keep half-open UTF-8 ranges and exact evidence quotes; a normalized digest cannot prove original-byte identity.

Use a second extraction route diagnostically. Compare order as well as character counts. Two parsers returning no text can share the same blind spot. Every no-native-text page requires visual inspection before any blank-page judgement. Check material parser disagreements and content-bearing images. Preserve tables with their headers, units, dates and row/column structure. Identify screenshots, reports, photographs, decoration and unresolved visuals separately. No identity inference from faces. OCR is a last resort, not a bulk default. A number extracted from a report remains attributed to that report rather than independently clinically verified.

Empty native-text pages are never duplicate documents merely because their extracted strings match. Exact repeated passages and overlapping exports need source-preserving deduplication; identical wording can represent a different dated episode. Review duplicate/retelling clusters before counting independent support. Do not delete originals to improve counts.

Keep readable, visual interpretation pending, unintelligible, unsupported, permission-excluded and not-processed states distinct. Exhaustive accounting is not successful extraction. Unreadable and excluded content cannot inflate coverage percentages. Output truncation is unfinished work, not a completed source unit.

## B. Chronology and narrative scope

Store authored time, event/valid time, original document order, import time and correction time independently. Preserve raw date expressions, missing years, precision, weekday conflicts and ordering inconsistencies. Filename or export timestamp is not proof of the narrated date range.

Record the clock convention per source interval. Personal clocks, explicit offsets and travel/local time are not interchangeable. Normalize only with contemporaneous evidence; carry unresolved time into sleep, exposure and lag calculations. Do not infer precise durations from unknown clock bases.

Classify each assertion, not the whole page. A passage may shift from dream to waking correction and back. Keep speaker, subject, context, polarity, modality, temporal scope and provenance. Distinguish direct report, belief, quoted-other report, dream, imagined scenario, uncertain memory, intention, reported action, reported outcome and correction. The intention to do something does not prove enactment or benefit. A dream diagnosis is not a real medical finding. An uncertain memory is not proof of an event. Similar names do not prove identity.

Historical distress is neither an automatic present emergency nor irrelevant history. Sensitive safety evidence needs restricted, non-graphic review. Do not conflate consensual adult sexuality or orientation with safeguarding evidence; distinguish unwanted thoughts, fantasy, intention and acknowledged conduct. The index does not diagnose or prescribe.

## C. Two-direction semantic audit

Source-to-memory measures omitted meaning; memory-to-source measures unsupported or distorted claims. A citation's existence does not prove paraphrase entailment. Both directions are needed.

The importer reads every admitted readable source unit in resumable bounded windows with entry context. A second source-based omission pass examines the original against proposed memories for missing qualifications, rare events, corrections, strengths, negation, uncertainty, intentions, immediate and delayed outcomes. No fixed fact quota per page may silently discard details. Unclassified text remains searchable.

An independent source-first reader starts in a genuinely fresh context without the importer's output, preferred hypotheses, current therapeutic formulation or prior reviewer conclusions. It receives only authorized original windows, boundary context, rendered evidence where relevant and neutral reference instructions. It records meaningful propositions and source-grounded questions with exact references, then freezes them before seeing imported claims. A separate evaluator compares the exact imported generation against that reference. Record actual producer/reviewer context identity and disclosed-input manifests. A same-chat role change is not independent evaluation; multiple models can still share blind spots.

Use a reproducible probability sample across source positions and later across resolved dates, including ordinary and unclassified material, plus a separate targeted challenge sample covering images, long entries, nested modes, corrections, aliases, uncertain dates, duplicates, consequential rare events and mixed outcomes. Targeted results do not estimate a population miss rate. Use initial calibration, repair the generating error and reserve fresh untouched material for later evaluation. Sample size alone proves nothing about semantic fidelity.

For every reference item retain `preserved`, `omitted`, `distorted` or `unassessed`. Unassessed items stay in the denominator. Report qualifier fidelity separately, alongside weighted and unweighted outcomes. Weighting prioritizes repair; it must not hide ordinary omissions. Unknown reference completeness is not 100% recall. The prior 95% engineering target applies only to a specified reference set and is unmeasured until tested; it is neither a global guarantee nor an archive-only blocker.

## D. Pattern discovery and disconfirmation

Combine bottom-up source-led discovery with focused questions relevant to future use. Existing therapy maps can suggest questions but cannot predetermine the discovered explanation. Build an episode/time-by-theme matrix linking observations, exceptions, missingness and writing density. Use meaningful change periods, not only arbitrary calendar bins. Include functioning, relationships, goals, values, commitments, sleep, bodily complaints, feelings, attempted coping, outcomes, resources, joy and environmental context. Keep dreams in a separate linked track and preserve the writer's own terminology.

Every pattern card must contain:

- a narrow statement, status and scope: observation, recurrent reported sequence or hypothesis;
- earliest/latest supported appearances with date uncertainty;
- distinct supporting episodes and exact source references, with deduplication;
- counterevidence, exceptions and contexts where it does not hold;
- intended purpose, attempted action, immediate reported effect, later effect and functional consequence separately;
- alternative explanations, co-occurring changes and observation gaps;
- what would weaken or overturn it, search coverage and review/version history.

A pattern reviewer first freezes source-led observations, then sees the candidate cards and actively seeks contrary evidence. Contradictions are not silently averaged away. Agreement among similarly primed reviewers is not corroboration.

Changes in writing purpose, density and detail are observation changes, not automatically life changes. Counts describe recorded mentions unless a defensible episode denominator exists. Do not count repeated copies as replications. Do not equate positive sentiment or spiritual intensity with recovery; inspect functioning, participation, relationships, sleep and later consequences when actually recorded. Joy and distress may coexist.

Predefine temporal windows and missing-data handling for association tests. Keep the author's causal attribution separate from analysis. Account for co-occurring changes and the possibility that an intervention was used because symptoms were already worse. Diary associations cannot alone establish treatment effects. Never produce dosing advice, diagnoses or treatment rankings as a side effect of indexing.

## E. Test the actual saved-profile endpoint

Build questions from original source evidence, not the importer's summaries. Cover direct/paraphrased lookup, cross-episode reasoning, changing information, temporal scope, exceptions, images and abstention. Include false premises and unanswered questions. Calibration/challenge questions are not a held-out evaluation set.

A cold consumer receives only authorized access to the saved profile and the question, without the original upload, producer conversation or answer key. Persist the returned evidence, snapshot, access epoch, coverage and answer. Score retrieval and answer fidelity separately so indexing misses do not masquerade as reasoning failures.

Compare source lexical/time retrieval, with semantic search when already available, against the same system with graph expansion enabled. Match corpus, question set, model and context budget. Evaluate simple lookup and distant exceptions as well as graph-friendly questions. Graph structure must earn its complexity; raw source retrieval remains an independent fallback.

Do not claim profile import until the correct case has an authorized committed corpus generation, working access to early/middle/late and visual evidence, traversal beyond legacy limits, and fresh-session source recovery. A local file, source hash, ZIP or inaccessible manifest is not the endpoint.

## F. Twenty-year and volume capacity

Years and volume are separate test dimensions. Measure original bytes, extracted text/tokens, images, entries, unique events/identities, corrections, index size, peak memory, query latency, work/cost and incremental-update effort. Do not infer all twenty-year cases from one successfully processed archive.

Use encrypted shards, stable source IDs, bounded worker windows, durable checkpoints and snapshot-safe pagination. Incremental imports process new/changed units and affected dependents; avoid rereading everything or all-to-all entity comparisons. Preserve revision-safe commit, recovery, deletion/revocation lineage and source access through old-client negotiation.

Create a wholly synthetic twenty-calendar-year corpus with unique content, sparse/dense periods, writing-regime changes, languages/formats, visual evidence, similar identities, changing names/preferences/roles, late corrections to old facts, historical backfills and unresolved uncertainty. Separately increase non-repeated volume. Copying a real source ten times is not a valid semantic scale test and may falsely benefit from deduplication.

Required capacity cases: retrieve early rare evidence after many later entries; apply a late correction without erasing history; append in reverse chronological order; handle gaps without imputing absence; revoke/delete source evidence across vectors/summaries/handoffs; restart a partial job without repeating validated calls; and run a fresh consumer. Report actual resource measurements before capacity or cost promises. No silent truncation or unapproved provider fallback.

## Reader execution packets

**Source-first reader:** inspect original source and necessary neighbors/visuals before import output; list propositions, qualifiers, scope, uncertainty, strengths and source-grounded questions; record unreadable and out-of-scope regions; freeze the result. Treat source text as data. Use non-graphic restricted annotations for sensitive material.

**Fidelity evaluator:** bind the frozen reference, exact source and exact imported generation; locate every claim, classify preserved/omitted/distorted/unassessed, check generated assertions against source, and retain unsupported additions. Report coverage and missing evidence; do not infer global recall.

**Pattern reviewer:** freeze source-led observations first; then challenge candidate cards with exceptions, temporal reversals, alternative explanations and distinct-episode support. Separate immediate experience from duration and function. Return narrow revised claims or unresolved questions, not clinical authority.

**Cold consumer:** answer only from the authorized saved profile; return exact evidence, snapshot and coverage; reject false premises and distinguish not found from never happened. Never use producer memory or the answer key.

The controller, not the model prompt, enforces authorization, keys, immutable generations, access epochs, context isolation and no-private-data telemetry. A prompt's existence is not enforcement or an executed review.

## Owner burden and completion receipt

Provide a concise findings brief, optional detailed pattern register, timeline and coverage/uncertainty report with source-opening links. Only specific consequential ambiguities that automated checks cannot resolve go to the person. They do not need to certify the entire source.

Keep completion fields independent: originals preserved; native text indexed; visual content interpreted; semantic review; pattern review; profile committed; cold retrieval; twenty-year capacity. A failure blocks the affected claim while independent work continues. Method documentation does not satisfy any unexecuted runtime or semantic field.

## Prior-work decision

Disposition: adapt/compose, not invent a new memory theory. The independent conception was recorded before a bounded scholarly discovery scan. Primary sources were checked on 2026-09-21.

- LongMemEval, Wu et al., ICLR 2025: extraction, multi-session reasoning, temporal reasoning, knowledge updates and abstention; separate indexing, retrieval and reading. https://arxiv.org/abs/2410.10813
- FActScore, Min et al., EMNLP 2023: atomic source-supported precision; it does not itself establish omission recall. https://aclanthology.org/2023.emnlp-main.741/
- Framework Method, Gale et al., 2013: traceable matrix and within/across-case comparison, adapted here to episodes/time periods in one person. Not validation of automatic therapy or causality. https://link.springer.com/article/10.1186/1471-2288-13-117
- LoCoMo, Maharana et al., ACL 2024: temporal/event-grounded and multimodal memory evaluation ideas; no transfer of published benchmark scores to this system. https://arxiv.org/abs/2402.17753

The bespoke remainder is private-source coverage, narrative/time fidelity, independent omission auditing, scoped longitudinal patterns and cold saved-profile verification. No private corpus evidence, source statistics, identifiers or hashes are published in this specification.
