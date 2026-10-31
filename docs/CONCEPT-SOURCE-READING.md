# Reading the canonical guide before declaring missing techniques

Status: developer-only method. No client-facing therapy rule, independent clinical efficacy claim, or authority to publish.

## Authority and observed failure

The active inner-child guide is chosen through `guides/manifest.json`; earlier numbered guides and `guides/inner-child-guide.txt` are historical. Reading an older file and reporting that the current guide lacks a concept is a source-selection failure. Searching for "shame" alone also misses substantial material under belonging, inherited criticism, forgiveness, and companion practices.

The current executable graph and current AI guide are different authorities. A passage being in the guide does not prove the planner routes to it, and a graph node does not prove the model follows it. The public humanized article is another derivative and may be organized differently. Check each exact target separately.

## Mechanically bound evidence read

```bash
node scripts/guide-concept-read.mjs --check
node scripts/guide-concept-read.mjs --concept social-vs-moral
node scripts/guide-concept-read.mjs
```

The validator binds the concept ledger `authoring/concepts/shame.json` to the active manifest's exact source file and SHA-256, the generated section source map, exact source quotations, and existing development graph nodes. A stale version, missing quote, orphan graph node or unsupported non-equivalence label is an error. This gate is used for source citations, not as a semantic completeness score. It also does not imply a live client response was tested.

## Reading contract for substantive comparisons

1. Resolve registered source authority and log the exact file/version, hash and read mode before judging novelty.
2. Reconstruct the author's argument across every relevant explanation, example, exception and qualifying passage. A conceptual synonym or a contrasting example may not contain the user's keyword.
3. Use an evidence card per requested concept: direct passage(s), qualifications/countercases, exact source spans, cross-guide references, candidate graph nodes and the user's precise claim. Preserve statuses: **present**, **partial**, **related but not equivalent**, **unknown** or **genuinely unsupported after a complete source-wide review**. No fixed minimum number of alleged gaps.
4. Separate **missing content**, **present but hard to discover**, **present but not executable/routed**, **same purpose with different technique**, **unverified live behavior**, and **model misunderstanding**. Do not call conceptually similar techniques identical or add duplicates to make progress visible.
5. If an outside technique has something new, define the *additional function and success criterion* against the current material and counterexamples. Distinguish an optional method from a new mandatory precondition.
6. Report search/read method honestly. A full file fetch followed by selected-section inspection is not a complete article-wide semantic review; a grep hit is not a finding of conceptual coverage; mechanical citations are not a clinical validation.

## Shame examples already covered

The semantic index binds independent social versus moral judgment; repeated unfair exclusion and possible departure; dialogue with guards; developmental and real responsibility; compassion barriers; secondary self-shaming; unchosen experience versus chosen action; reparability without guaranteed trust; selective disclosure rather than compulsory exposure; and reciprocal relational support. It explicitly refuses to identify general imagery-based reparenting with the exact formal scene-rescripting protocol.

The exact current authority is the October 31 r9 AI-guide candidate (registered in its manifest; the October 29 r7 text plus the owner-approved additions of r8 and r9, and the issue 215 refinements about a critical voice and an optional anger-drawing practice, made inside r9), not a humanized Substack edition. The small shame summary section, added in r7, connects the existing dispersed teachings rather than replacing them.

## Operational regression cases

- A client is correctly predicting rejection from an intolerant group: preserve that evidence without treating the group as morally right or prescribing a disclosure experiment.
- A client has caused actual harm and seeks a moral ruling from strangers: recognize conduct and an attainable repair step independently of public acceptance.
- A person attacks themselves for experiencing shame: distinguish the initial feeling and secondary attack.
- A protective part expects compassion to be weak or dangerous: hear that expectation instead of escalating imagery.
- A critical inner voice insults the person: reject the contempt and any degrading wording, keep whatever in it is useful and truly theirs to answer for, and do not assume the voice is a protector, or make an enemy of the part producing it, before a boundary or relief.
- Someone is rejected repeatedly by a community that requires self-betrayal: support differentiation or departure, not forced reconciliation.
- Memory work is framed as a brand-new method despite existing reparenting imagery: distinguish exact procedure from related function and do not invent a missing component.
- A reviewer accidentally selects September 7 rather than the registered guide: refuse the evidence receipt before evaluating concepts.
- A concept is stated in a middle section using a different term: retrieve the cross-section evidence and relevant countercase before making an absence claim.

All client scenes are synthetic. Reviews of sensitive personal writing or records stay within their actual privacy boundary, not in this public repository.

## Synchronization and remaining limits

After a legitimate guide edit: retain the old immutable revision, register the new version/hash, update the source layout, compile source maps and graphs, refresh the concept ledger, run tests and regenerate projections. Follow the standard owner decision and stable-promotion paths. Never treat passing these deterministic checks as proof of complete understanding or effective clinical behavior. Any substantive method change remains owner-gated at release; currently open neighboring shame and relational-sequence PRs must be reconciled before merging.

Upstream transferable lesson: manifest-first exact source authority + cross-cutting concept evidence cards + countercase search + honest read receipts + absence/novelty gate + source-drift validation.
