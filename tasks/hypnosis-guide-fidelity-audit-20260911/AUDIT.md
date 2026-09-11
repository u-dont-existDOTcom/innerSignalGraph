# Inner Signal hypnosis graph: fidelity and completeness audit

**Decision: do not promote this candidate into the runtime. Preserve it as an incomplete conceptual map and a repair baseline.**

The guide is not the failed artifact here. The conversion into a graph retains many useful summaries but does not reliably preserve their conditions, exceptions, timing, or supporting teaching. The current map can look coherent while the encoded selector does something else.

Audit ID: `hypnosis-guide-fidelity-20260911-r1`. Mode: **P0, report only**. This is a source-based **self-audit in a non-isolated context**, not an independent review, clinical review, or test of human usefulness. No guide, graph, source map, production bundle, or installed policy was changed.

## 1. Exact scope and authority

Graph baseline: `u-dont-existDOTcom/innerSignalGraph` at `ad441affd378e06d6395e0ba4ec0760eaaea5d52`, containing merged PR #51. The target is `guide-graphs/candidates/inner-signal-hypnosis.graph.json`, version `2026-09-11-r1-candidate`, SHA-256 `7f75487ab6146e912b0d9c3fb3abff193d12c7f9196313302dde10cd94df3b5c`.

Guide baseline: `u-dont-existDOTcom/joel-articles` at `defc51d43fa291dcb00c93468e111c967094164a`, branch `research/hypnosis-bottom-up-six-books-20260910`, open draft PR #76. Its branch registry identifies `articles/inner-signal/master.html` as the working r02 candidate, SHA-256 `06987f70e7264a5ac72d132e4b8420cf75cda60f33bbb430c83a0146e612adf9`. It is **not** a main-branch publication or an owner-final article. The PR description is older than its article-local state; the exact registry and current-state record control this audit.

The audit covers every substantive node field across **26 nodes**, all **35 edges**, all **41 mapped source spans**, and a reverse reading of the complete **723-block reader projection with 151 headings**. The first 15 blocks, preceding the first selected source span, were also reviewed. They supply framing, introduction, and orientation; their main practical/whole-mind functions recur later. Their absence from the selected map is not automatically a defect.

Source identifiers such as `B0322` mean the 322nd line/block of the reproduced reader projection. These are revision-bound locators, not new article authority. The source projection is reproducible from the exact upstream HTML; the complete node/source/edge dispositions are preserved in the companion review ledger.

### What passed

The exact guide and graph identities match their declared hashes. The reader projection was reproduced at SHA-256 `35532449c0bccb2de357c35f675a7a48c4a5ba8ba322456bdd1924e204aef678`, and **all 41 section hashes match**. No competing master or corrupted source snapshot was found.

There are 37 unique source refs cited by nodes; four mapped spans are not cited: `HYP.HYPNOSIS_MODEL`, `HYP.SELF_HYPNOSIS`, `HYP.TROUBLESHOOT`, and `HYP.SLEEP`. This is an inventory fact, **not** a fidelity percentage. Some uncited material appropriately belongs in a reference layer rather than a routing node.

The generated surface is derived from the candidate, but this audit did not rerun the complete Node 24 package gate. Its previously passing test is examined below for what it establishes.

### What did not pass

The candidate does not pass source-to-behavior fidelity or completeness for a usable teaching/consultation system. The most serious defects are missing session/task state, inverted deferrals, and translating broad associations into relevance conditions. A few additional defects are direct changes of meaning or omitted source functions.

## 2. Findings

Severity here means importance **before candidate runtime promotion**, not an observed live-user incident. All findings remain open; the repair directions below are proposals, not edits or owner approval of changed behavior.

### F01 — Safeguards are deferred while some exploratory work remains eligible

**High; graph effects and their relationship to the map.**

`HYP.CAPACITY_BEFORE_CONTENT.effects.deferNodes` contains `HYP.MEMORY_CAUTION` and `HYP.ALTERED_STATE_GATE`. `HYP.SAFETY_ORIENTATION` also defers `HYP.ALTERED_STATE_GATE`. But these target nodes advise caution and stabilization; they are not instructions to uncover memories or deepen an altered state. The source says to stabilize before interpretation and retain uncertainty about imagery, including when capacity is low (`B0268`, `B0290–99`, `B0363`, `B0624–51`).

Conversely, `HYP.INDUCTION` excludes unsafe/disoriented states but not an inability to stop or return. Neither safety nor capacity explicitly defers that node. When an oriented person cannot stop, induction therefore remains initially eligible even though the safety node wins primary selection. Eligibility is not proof the deployed app would actually induce them; it is still inconsistent with the intended guard.

The map’s edge `CAPACITY_BEFORE_CONTENT —gates→ INNER_MEETING` also lacks a corresponding deferral. Low `body_capacity` activates the capacity node, yet `INNER_MEETING` remains eligible. The general planner’s extra deep-work suppression names IC/SOM nodes, not this new HYP node.

**Repair direction:** distinguish protective information/actions from the exploratory actions they constrain. Apply guards to relevant actions; do not suppress epistemic caution or stabilization. Check both matching and non-matching cases. A correct first recommendation is insufficient if incompatible actions remain eligible beside it.

### F02 — The candidate lacks enough task and phase information to enact its claimed journeys

**High; activation and execution semantics.**

`HYP.PRACTITIONER_VETTING.activation` and `HYP.APP_BRIDGE.activation` are `{}`. The inspected planner explicitly returns false for an activation with no conditions. These two nodes **never match**, rather than being unconditional consultation routes.

`HYP.CHOOSE_PURPOSE` has only exclusions for unsafe/disoriented states. It keeps winning ordinary initial selection when the purpose has already been chosen, during ongoing practice, after a request to finish, or during a question about a hypnotist. Those distinct situations cannot be faithfully expressed by the candidate’s current input conditions.

`HYP.FULL_RETURN` is triggered by `altered_state=altered` or `ability_to_return=no/unknown`, not by a waking session ending. Unknown return ability can select a return before a session is known to exist. Known return ability does not itself select return when the person finishes. Marking every ongoing trance “altered” would create the inverse problem: return becomes immediately eligible throughout the session. The missing distinction is phase/intent, not a better name for the same variable.

The guide explicitly teaches preparation, listening, changing direction, stopping new questions, and full return, with an early exit available (`B0018`, `B0199–200`, `B0255–64`, `B0278–80`). All 26 node `defaultQuestion` values are empty, and the candidate has neither `taskPolicyVersion` nor `pathPerformancePolicyVersion`. This does not prove a wider model cannot formulate questions; it means the graph has not authored or demonstrated the relevant investigative choices.

**Repair direction:** adapt the repository’s existing task-aware approach to distinguish teaching, consultation, preparing, entering, exploring, adjusting, closing, and reviewing. Preserve free movement and early stopping; do not turn the guide into a compulsory linear checklist. Do not simply set a version flag without supplying the required state, contracts, and tests.

### F03 — Shared features are being used where discriminating evidence is needed

**High; relevance and boundary fidelity.**

The clearest controlled example is `HYP.SUPPORT_WITH_TRAINED_PERSON`: `support_available=present` alone activates a tier-1 support route. With otherwise identical stable gentle-practice inputs, the support route becomes primary when help exists, but not when help is absent. **Availability is not need.** The node’s prose correctly says “when the method, current response, or risk exceeds self-guided capacity”; its activation does not encode that condition (`B0367–68`).

Other instances share the same underlying fault:

- High activation is enough to trigger anxiety/body-first work, although the guide distinguishes wanted difficulty while present from panic or inability to shift (`B0020`, `B0260–68`).
- The presence of an influence domain triggers de-hypnosis without establishing unwanted influence or a live choice problem. The source explicitly does not reject all influence (`B0165–71`).
- Readiness alone matches weekly/deeper practice without a selected purpose or request.
- Ordinary hypnosis intent does not match positive-resource work unless additional love-access information happens to be present. Love, play, curiosity and rehearsal can themselves be the chosen purpose (`B0017`, `B0276`).
- The body-is-not-a-verdict rule is conditional on tension/protective response/moderate-high activation, although an appealing low-activation response can also be mistaken for truth (`B0279`).
- Any memory-processing/photo intent defers the weekly node, without distinguishing resourcing, known recollection, unknown-origin inquiry, or a procedure beyond self-guided capacity (`B0367`).

These predicates do not prove that every final answer would be restrictive: some node prose supplies qualifications. They do show that correct prose and discriminating selection have been separated.

**Repair direction:** represent the actual task, procedure, willingness/refusal, response, and relevant capacity. Keep `unknown` distinct from evidence of impairment. Explain a method without assuming the user wants it performed. Use negative comparisons so a guard does not activate merely because a feature also appears in a tolerated case.

### F04 — The dissociation node changes the source’s immediate instruction

**High; direct source conflict.**

Under “You dissociate or feel unreal,” `B0322` says:

> Open your eyes. Move. Touch something textured. Name five objects. End the deeper practice for the day.

The graph instead recommends shortening or ending “as needed,” adds fractionation/return practice, and makes being able to choose whether to continue a success signal. It does not preserve the source’s no-further-deeper-practice-today endpoint.

The guide **does** teach fractionation separately (`B0219–21`), as an openly named and deliberately chosen learning exercise. The defect is its **timing and scope in this node**, not the mere presence of fractionation in the method. Its acute-response refs do not cite the separate training section either.

**Repair direction:** retain the source’s immediate endpoint; keep optional fractionation training in its own properly contextualized branch. No new clinical claim or general ban on fractionation is needed.

### F05 — Some success criteria quietly change the purpose of practice

**Medium; meaning and outcome preservation.**

`HYP.WEEKLY_DEEPER.successSignals` says “Depth increases…” while `B0287` explicitly says **“More time needn’t mean greater intensity.”** The node’s own avoid clause rejects automatic intensification, so the candidate is internally mixed. A successful longer session may simply allow more time for the same kind of contact.

The daily summary always names one grounded follow-through, whereas the source qualifies action: **“When action is needed”** (`B0285`), and says there need not be action when none is called for (`B0278`). Positive-resource success is also narrowed toward increased capacity or useful action. Love, play, curiosity and a pleasant experience are legitimate purposes in the source, not merely instrumental preparation (`B0276`).

**Repair direction:** measure success against the chosen purpose and actual effects, without requiring more depth, a revelation, a part’s appearance, or an action every time. Preserve real-world follow-through when it is called for.

### F06 — The developmental bridge is mostly lost

**High for the guide’s stated method; completeness.**

The graph says to keep the Nurturer, Protector and Leader available and offer wanted care. It largely omits the guide’s answer to **what to do when those capacities are not available yet**.

`B0080–86` explicitly differentiates witnessing, borrowing one credible function, carrying part of the response as an adult apprentice, and handing the capacity back. `B0273` invokes that fallback in the core practice. The same source distinguishes inherited parental rules from chosen adult care, credibility built through evidence rather than persuasive declarations, and a Protector that performs a bounded action and then stops scanning (`B0106–22`).

Identity/preference experiments when no child appears (`B0316`), and the distinction between being oneself and rebelling against another’s influence (`B0146–63`), also lack functional representation. Naming the inner-child source ref does not carry these operations into the graph.

**Repair direction:** preserve the actual developmental alternatives without forcing a cast of parts. Reuse the existing inner-child implementation only after checking its exact guide/version and making the dependency explicit; its existence elsewhere is not proof that this separate graph invokes it.

### F07 — Reference pointers do not supply a teaching library

**High for teaching/consultation completeness; not a demand for a node per paragraph.**

“Use a fitting induction,” “make a fitting invitation,” and a list of NLP patterns are good summaries for someone who already knows the method. They are not enough for a novice to learn it. The source map contains headings, ranges and hashes—not usable section text or a demonstrated retrieval integration.

Important source content that is missing or only named includes:

- the actual induction/contact choices, including active-alert work, containment and no-trance contact; the optional use of recordings as skill develops;
- preferred spacious/warm/firm guidance and the distinct **Stop / less / quiet** controls, without making the listener inspect every moment (`B0199–200`);
- question formation and no-answer/fake/unclear-child alternatives, rather than interpreting silence as an invisible success;
- the complete cue-learning, selectivity and retirement lesson, including not pairing the cue with peak emotional intensity or a traumatic scene;
- sensory, state and strategy NLP beyond the indirect-language subset: submodalities, anchoring, reframing, perspectives, future pacing, if-then actions, swish and negotiation;
- small voluntary movement or imagined movement, with no obligation to enact an impulse or produce a release;
- recording what was present before, what was deliberately tried, what followed, and what remains uncertain;
- creative versus avoidant daydreaming, consequence-sensitive outside counsel, and forgiveness without surrendering boundaries/accountability.

These need **usable source-derived content and appropriate access**, not necessarily more intervention nodes. Some examples, testimony, empirical claims and the Appendix J anecdote should remain attributed reference material rather than becoming rules.

**Repair direction:** give teaching/consultation a source-linked reference layer and keep its relationship to executable steps explicit. This audit is limited to material already in the guide. The separate book/research reference library remains a later, provenance-labeled addition; it was not silently imported here.

### F08 — The map hides the fields most likely to fail

**Medium for inspection; high if mistaken for validation.**

The generated Mermaid surface displays node titles, labeled arrows and five prose journeys. It does not display the activation predicates, suppression lists, success criteria, or the fact that two nodes never match. An arrow labeled “gates” or “must-end-with” can therefore be visually reassuring without implementing that constraint.

The inspected planner ranks matching nodes first; it uses edges afterward for display/context and sequencing notes. The arrow labels do not by themselves implement transitions, prerequisites, or exits. Several arrows are sound **conditional conceptual relationships** but not universal ordering rules. In particular, memory caution “gating” access to trained support is ambiguous, and practitioner vetting need not be downstream of a personal need for trauma treatment.

**Repair direction:** inspect node records alongside the conceptual map. Display conceptual relations as such, and distinguish them from actual enforced guards and tested transitions. The companion ledger addresses every current arrow rather than replacing them with a new decorative diagram.

### F09 — Exit, troubleshooting, and support distinctions are too compressed

**High for a self-contained operational representation; completeness.**

The source supplies entry-specific reversal, an explicit interruption fallback if a recording stops, a complete waking return, a separate sleep endpoint, and ordinary closure for no-trance contact (`B0238–42`, `B0711`). The general return node cannot select or teach all of those distinctions.

The source also differentiates urgent help, prompt professional assessment, and ongoing support (`B0363–65`), and distinguishes medical danger, an unsafe environment, emotional overwhelm, body overload and later meaning-making (`B0624–51`). Generic “check danger” or “use support” summaries are not a complete rendition. The four “nothing happens / feels fake / will not answer / no child” situations likewise deserve actual alternatives (`B0301–16`), not a demand to restart the same method.

**Repair direction:** preserve these source distinctions as applicable procedures and endpoints. This is not permission to add generic warning chapters or wall off all trauma-related material. The guide’s permissive comparison case—wanted difficult feelings with present choice—must remain visible and testable.

### F10 — Passing structural checks was overstated as semantic assurance

**High for the completion claim; validation and provenance precision.**

`tests/inner-signal-hypnosis-surface.test.mjs` checks that source ref IDs resolve, guide IDs agree, the recorded master SHA string equals a fixed value, and the generated Markdown equals the renderer output. It does not test source entailment, reverse completeness, phase selection, deferral direction, individual user journeys, or reference retrieval.

The current audit has independently **recomputed the bytes/hashes**, so the issue is not falsified source identity. It is the unsupported inference from integrity/schema/map freshness to therapeutic or teaching fidelity. “Executable candidate” was too reassuring without that qualification.

Two small provenance examples illustrate the separate issue: `HYP.ANALYSIS_BALANCE` is supported most directly by `B0279 / HYP.FINISH`, which it does not cite. `HYP.POSITIVE_RESOURCE` is supported most directly by `B0274–76 / HYP.CARE`, also absent from its refs. These are supported in the whole guide, not invented content; the local mappings should be tightened. Tiers, priorities, triggers and edges are implementation interpretations, not literal author instructions merely because `authority` is set to `author-framework`.

**Repair direction:** retain the structural test and add distinct source-fidelity, completeness and behavior evidence. Treat these audit conclusions as diagnostic findings subject to owner decisions, not automatically approved policy.

## 3. Bounded discriminating probes

Twelve synthetic cases exercised a **small Python mirror of the inspected initial matcher/readiness/deferral/ranking logic**. They did not call the actual runtime, model extractor, response realizer, or deployed app. Labels such as “request to finish” explain information the candidate cannot represent; they are not claims that a production NLP extractor assigned those variables.

| Probe | Observation in the bounded selector | What it discriminates |
| --- | --- | --- |
| P01 | Unknown facts select `FULL_RETURN` before any known session. | Return ability versus session phase. |
| P02 | Stable consultation selects `CHOOSE_PURPOSE`; vetting/app never match. | Knowledge question versus starting a practice. |
| P03 | Settled hypnosis still selects purpose setup. | An ongoing task versus preparation. |
| P04 | Stable integration has no matching return node. | Knowing how to return versus choosing to return now. |
| P05 | Capacity suppresses matched `MEMORY_CAUTION`. | Epistemic safeguard versus memory-uncovering work. |
| P06 | Safety/capacity suppress matched `ALTERED_STATE_GATE`. | Stabilization versus intensification. |
| P07 | Inability to stop leaves induction eligible beside safety. | Primary priority versus complete guard coverage. |
| P08 | Low body capacity leaves inner meeting eligible. | Displayed gate versus actual effect. |
| P09/P10 | Only changing help availability makes trained support primary. | Availability versus actual need. |
| P11 | Hypnosis intent with no love-access datum does not match positive resources. | Chosen goal versus incidental feature. |
| P12 | Memory-processing intent defers weekly work even with memory-source risk absent. | A modality/intent label versus actual procedure and risk. |

The results are **counterexamples to proposed selector adequacy**, not observed clinical harms. They do not establish how a different or fully integrated runtime would respond.

## 4. What should survive repair

Retain the strong summaries: observation before interpretation; a response-led next invitation; body response not historical proof; care judged by the receiver’s response; optional parts and whole-self frames; positive practice; deliberately chosen re-entry distinct from alert calming; uncertainty about unusual experiences; practitioner conduct rather than labels; and self-hypnosis as a valid endpoint rather than compulsory graduation to a professional.

The current isolation from the production bundle is also correct. These failures have **not** been shown to alter an installed therapy graph.

## 5. Recommended next architecture and acceptance boundary

A priorities-only repair is insufficient. It cannot make absent task/phase information appear, select empty-activation consultation nodes, or supply omitted teaching content. Adding more warning nodes would compound the same mismatch.

**Recommended adaptation:** use the repository’s established separation between source/provenance, task-aware planning, generated views and owner-approved semantics. For this guide, distinguish:

1. source-derived teaching and consultation content, including procedures the app can explain without conducting;
2. an adaptive session/task representation that can enter, continue, adjust, decline, stop, return or close without a compulsory linear path;
3. cross-cutting action guards and epistemic constraints that cannot be removed merely because the person has low capacity.

The comparison alternative is to keep r1 only as a non-executable conceptual index and explicitly supply all actual teaching and session control elsewhere. That is viable for navigation, but would not fulfill an executable guidance claim on its own. Do not merge an outside-guide knowledge expansion into this fidelity repair: separate provenance allows us to tell which improvement comes from accurately representing the guide and which comes from an extension.

Before promotion, the repaired candidate needs source-supported field changes, full source-function dispositions, tests of the actual planner with positive/negative contrasts, and an honestly separate review when an independent context is available. User-selected warmth or firmness, quiet, wanted difficult feelings, ordinary no-trance contact, cue retirement, and stopping with no revelation/action must all remain legitimate outcomes. This is a recommendation, not approval of any particular replacement.

## 6. Delivery and non-effects

The companion review ledger lists every current node, source span and edge. The accompanying bounded diagnostic preserves reproducible source-identity checks and selector counterexamples. No copyrighted books, private case records or external factual corrections were added.

**Status:** audit complete; findings open; repair not implemented; independent review not performed; runtime promotion not approved.
