# Verification: source retrieval, reasoning use, and actual delivery

## Claims are tested separately

The isolated reference proves only the predicates listed in its test report. The integrated application, native host, independent model reasoning and clinical usefulness require different evidence. No result in one column substitutes for another.

| Layer | Probe | Failure that must remain visible |
|---|---|---|
| Exact data | Original text, Unicode, metadata, provenance, source amendments | Silent normalization, missing amendment, draft promoted to report |
| Selection | Old unindexed source + changed present condition | Static high-relevance list never retrieves it |
| Coverage | Full active episode; required references; budgets; source/index watermarks | Oversized/incomplete history reported complete |
| Reasoning | Older relation + new fact without an operator hint | Writer retrieves both but does not connect them, or invents the outcome |
| Review | Adversarial candidate against independently prepared sources | Reviewer shares writer's omissions, approves unsupported facts, or self-certifies |
| Admission | Exact candidate AND evidence binding | Old audit survives an edit, new evidence, revocation or language change |
| Host input | Real component submit and tool exposure | Backend passes but ordinary user's input never reaches it |
| Output | Server artifact, copy bytes, re-open state | Native rewrite or empty-composer recovery substitutes for approved output |
| Longitudinal outcome | Repeated fresh/compacted sessions | Operator must repeatedly supply already recorded history |

## Offline reference

Run `python reference/run_checks.py` from the package root. It measures the Node unit test and artifact validation, preserving command output and timing. It does not run the repository, external model providers or a live private case. Results are written to `evidence/`.

The reference test suite covers identity, source isolation, incoming-message retrieval, relationship links, update chains, bilingual aliasing, draft provenance, full-history baseline, incomplete sources/episode/budget, index lag, effective-amendment admission, citations, packet tampering, stale evidence, grants, exact candidate identity, review independence/provenance, language variants, expiry and scope. Read the actual test names and output for the executed count.

Not demonstrated by the reference: real amendment compilation, encrypted migration, model selection, multi-process transactions, production idempotence, host routing, native reviewer availability, or whether a generated reply is useful. Those remain integration tests.

## Required integrated consumer cases

**A. Historical evidence absent from the short summary.** Put the relevant original source earlier than the active episode, without a high-relevance flag. Supply only a new changed-condition message. Assert that the writer's actual assembled input contains the exact older evidence and appropriate uncertainty. Do not only inspect the retrieval helper's return value.

**B. Full active episode.** Use enough turns to cross legacy recent-window limits. Verify exact contiguous episode order at the provider boundary, including amendments. When the provider budget is insufficient, require an explicit unresolved state or verified staged-reading protocol; do not claim every source was read from archive existence alone.

**C. Source corrections and attempted poisoning.** Preserve original and later correction, distinct speakers and timestamps. Inject a fake instruction inside a source and a writer-generated assertion that looks like a historical fact. Neither may acquire instruction authority or verified provenance.

**D. Currentness and atomic release.** Pause a synthetic audit, append a new source/correction, resume. Old evidence must not pass the current release check. An audit-bookkeeping-only change must not invalidate itself. Exercise overlapping processes against the actual persistence boundary, not merely sequential mocks.

**E. Durable retries.** Repeat exact input/key; same turn and outcome. Repeat key/different bytes; conflict. Restart after capture, preparation, candidate, review and release. Recover recorded results before making another potentially billable call. Stop after existing bounded retry/repair ceilings.

**F. Native surface.** In an actual eligible ChatGPT host, verify controlled input reaches the tool before native drafting, all case-related component turns are captured, source packet bound to that turn, and exact native candidate submitted. Deliberately type an off-path native message: coverage must become unknown/uncontrolled rather than falsely complete.

**G. Reviewer.** Use actual separate context under admitted native/external profile; no same-chat self-review. Missing reviewer must stay pending and must not silently call an API. Retain incumbent accepted external provenance. Verify reviewer packet contains candidate, writer packet identity, independently selected extra evidence and the same source revision.

**H. Output and bilingual use.** Approved artifact renders directly, canonical copy text matches, late translation/edit requires new version, and render/copy/operator-send/external delivery states remain separate. Reconnect must restore stage, not guess based on draft absence.

**I. Profile/billing guard.** Configure native-only; mock every API boundary to throw on call and prove native work never calls it. An API profile requires explicit allowed configuration. One successful native tool call does not prove future automatic invocation.

## Behavioral evaluation procedure

`evals/prompts.json` contains only synthetic history and new input. `evals/gold.json` contains evaluator expectations. Never pass the gold file to the writer. The pair is a seed suite, not a validated benchmark or clinical test.

Compare the incumbent state-based selector, full-history input when feasible, and proposed retrieval on the same approved writer/model/settings. Keep these variables fixed. Begin with a small pass of the frozen cases rather than a large tournament. Do not make paid calls without explicit authorization.

The reviewer assesses more than whether a particular sentence appears: correct historical connection, evidence status/currentness, appropriate recheck versus already answered question, preserved agenda, absent invented facts, and conversational burden. Several different replies may be correct. A case with an urgent current issue may justifiably defer the old relationship while retaining it in state; rigidly asking the same historical question is a failure.

After the first implementation pass, use new paraphrases and held-out variants to distinguish general behavior from fixture keyword matching. Test a fresh session, a continued session, and a context-compaction recovery. Do not assert that changing one test string proves broad reliability.

## Acceptance and reporting

Critical mechanical violations must be absent from the agreed synthetic suite. Report per-case model/host outcomes, not just an averaged score. For behavioral acceptance, the reasoning supervisor reviews actual outputs and unresolved ambiguity. There is no invented universal percentage threshold in this design.

Record: controlled inputs received; off-path coverage known/unknown; relevant evidence recalled; factual/recheck errors; operator reminders; preparation/generation/review/display latency; token/call counts and monetary cost when supplied; retry count; outage rate; and time spent testing. Missing measurements remain unknown.

A synthetic proof is evidence for a bounded workflow, not clinical validation. Real-case use requires the separate existing consent/privacy/deployment boundary and prospective monitoring. This packet does not authorize automated medical decisions or unattended crisis management.
