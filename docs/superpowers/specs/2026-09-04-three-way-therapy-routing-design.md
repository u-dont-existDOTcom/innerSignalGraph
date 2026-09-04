# Three-way therapy routing: inward, outward, or leave it alone

Date: 2026-09-04
Status: owner-approved development design
Scope: Inner Signal cross-guide therapy map

## Independent conception snapshot

### Problem

A therapy system can mistake repeated attention for useful therapeutic work. For some people, especially when rumination, symptom-monitoring, reassurance seeking, repeated self-analysis, or searching for the correct healing method has become self-maintaining, adding another inward technique can increase the very process that keeps distress salient.

At the same time, a blanket instruction to stop thinking can become avoidance. Some situations contain a concrete real-world problem that requires action; others contain genuinely avoided, disowned, unfinished, relational, somatic, memory, or part-level material that benefits from contact or processing.

### Candidate mechanism

Before adding a technique, classify the current useful movement:

1. **Go inward** — contact genuinely unresolved inner material.
2. **Act outward** — change a concrete current problem.
3. **Leave it alone** — stop repeatedly feeding a thought/symptom/healing loop that is producing no new information, decision, action, or changed contact with avoided material.

A related attentional modifier is **external embodiment**: if introspective attention reliably worsens derealization, panic, or hypermonitoring, use eyes-open external orientation and ordinary embodied activity without inferring that all somatic work is contraindicated.

### Constraints

- Safety, orientation, and ability to stop/return continue to outrank this router.
- Existing suicide, altered-state, trust/authority, and other high-specificity branches must not be flattened into the new taxonomy.
- “Leave it alone” is not thought suppression, denial, emotional numbing, or refusal to address a medical, safety, relational, or practical problem.
- Somatic therapy remains a branching family rather than a rigid ladder.
- A dramatic state shift is not evidence of readiness for deeper processing.
- No hidden trauma, recovered memory, coherent inner child, or psychological cause is inferred from symptoms alone.

## Existing-work scan

The underlying problem is substantially established rather than novel.

### Reusable work

- **Metacognitive Therapy (MCT):** the Cognitive Attentional Syndrome identifies worry, rumination, threat monitoring, and maladaptive control strategies as maintaining processes. Detached mindfulness supplies an established non-suppression model for noticing thoughts without repeatedly engaging them.
- **Rumination/process research (Watkins and related work):** abstract/evaluative repetitive thinking can impair problem-solving, while concrete, specific processing can be useful. This supports an output-based distinction between rumination and problem-solving.
- **Health-anxiety literature:** symptom checking, reassurance seeking, hypervigilance, and safety behaviors provide established examples of attempts to obtain certainty becoming maintaining behaviors.
- **Behavioral activation/exercise/external attention:** ordinary activity and attention to the environment provide established routes out of passive self-focused loops without requiring the claim that all distress is cognitive.
- **Trauma-treatment literature:** routine processing is not automatically helpful simply because something upsetting happened; treatment must be selected by mechanism, timing, target, and capacity.
- **Somatic/interoceptive literature:** inward bodily attention is not universally harmful or universally helpful. Response to interoception is a moderator; external embodied activity and introspective body scanning are distinct operations.

### Partially solved / incompatible with simple reuse

MCT and rumination-focused models do not provide Inner Signal’s required cross-guide routing between inner-child functions, somatic modalities, practical action, altered-state safety, and optional advanced release. Conversely, the existing Inner Signal graph had rich inward and somatic routing but no explicit stop rule for cases where therapy-search or repeated processing itself may be maintaining distress.

### Reuse/adaptation decision

**Decision: compose and adapt established mechanisms; do not invent a new psychotherapy.**

The reusable core is MCT-style non-engagement with repetitive thinking plus established distinctions between concrete problem-solving and abstract rumination. The repo-specific contribution is a deterministic cross-guide router that decides when to use those principles versus inner-child processing, somatic work, or practical action.

The genuinely useful remainder is therefore architectural rather than a new treatment claim: Inner Signal must be able to recommend **no additional processing** as an active routing outcome.

## Operational routing rules

### Safety override

If present safety, orientation, stopping capacity, return capacity, severe dissociation, suicidality, or another higher-priority safety branch is active, follow that branch first.

### Act outward

Activate when a concrete current problem can be changed by a decision or observable action.

If rumination surrounds a real problem:

1. isolate the actionable piece;
2. decide or act on it;
3. stop rerunning the remainder until new information arrives;
4. return to inward work later only if unresolved material remains relevant.

Use Protector functions for boundaries/safety and Guide/Leader functions for sequencing and follow-through.

### External embodiment

Activate when inward attention itself reliably worsens derealization, panic, or hypermonitoring and no higher-priority concrete action branch is active.

Prefer eyes-open ordinary embodied engagement: walking, gym, sport, swimming, cycling, chores, social contact, or similar activity. Do not repeatedly body-scan to test whether it is working.

This is a temporary attentional routing decision, not evidence that all somatic therapy is contraindicated.

### Go inward

Activate when there is transcript-supported unresolved inner material and inward attention is not currently destabilizing.

Route by function and target rather than modality prestige:

- relational/part/credibility/trust/developmental conflict → relevant Nurturer, Protector, Guide, guard, or inner-child branch;
- bodily activation/freeze → gentle somatic regulation, EFT, movement/shaking, breathing, or other titrated body work;
- stable discrete memory target → EMDR may be considered without requiring a long preparatory ladder;
- diffuse/developmental body-held material → resource or deeper Brainspotting and developmental EMDR according to capacity;
- advanced release → optional parallel branch, never proof of readiness.

### Leave it alone

Activate only when all are true:

- a repetitive attention loop is present;
- continued thinking is producing no new output;
- no concrete actionable problem is currently identified;
- no clearly unresolved inner material is currently identified;
- no higher-priority safety branch is active.

Recommended operation: notice the thought/sensation/urge without suppressing it and without answering the same question again; discontinue repeated reassurance, symptom checking, therapeutic interpretation, and healing-method searching; re-enter ordinary life.

If a real problem or genuinely avoided material appears, route out of this branch.

## Stop-rule questions

- **Does thinking produce new information, a decision, or an action?**
- **Are we discovering something, changing something, or just paying more attention to it?**

Canonical discriminating question for an ambiguous loop:

> Is this thinking giving you genuinely new information, a decision, or an action—or are we running the same computation again; and is there a concrete problem to act on or clearly avoided material to contact?

## Regression benchmarks

The implementation must demonstrate:

1. strict repetitive/no-output cases route to `ROUTE.LEAVE_ALONE`;
2. a concrete problem outranks surrounding rumination and routes to `ROUTE.ACT_OUTWARD`;
3. unresolved inner material routes to `ROUTE.GO_INWARD` and preserves existing inner-child and somatic branches;
4. inward-attention worsening routes to `ROUTE.EXTERNAL_EMBODIMENT` and excludes the inward route without globally banning somatic work;
5. ambiguous loops route to `ROUTE.THREE_WAY_GATE` and ask the stop-rule question;
6. existing tier-1 safety routing continues to outrank every new route;
7. existing discrete/developmental EMDR distinctions and advanced-release safety blocks remain intact.

## A001 benchmark reconciliation

The latency benchmark's historical baseline commit remains `f0ce1e5062c1a34c57d630cbd158491816ac5292`. That record owns performance structure only: provider stages, provider-call counts, and the former two-pass Reviewed planning count. It does not own current therapy policy.

Running the same current A001 mock pipeline once with the pre-change compiled graph and once with the authorized three-way graph produces hashes `9d347f9072e7d41903b944563663d61a021220dfbcd69806ad8d8ffacef9ef97` and `141acf5b4fa50e20c89fb30391fe28a5691ba59051c1e1cabb5380670d419ce5`, respectively. The exact normalized-result delta is confined to graph trace metadata:

- `activeEdges` adds `ROUTE.GO_INWARD may-route-to IC.MEET_GUARD` and `ROUTE.GO_INWARD may-route-to SOM.GENTLE_REGULATION`.
- `matchedEdges` adds `ROUTE.ACT_OUTWARD acts-through IC.PROTECTOR_ACTION` plus the seven `ROUTE.GO_INWARD` links to `IC.MEET_GUARD`, `SOM.GENTLE_REGULATION`, `SOM.EFT_PORTABLE`, `SOM.GENTLE_SHAKING`, `SOM.RESOURCE_BRAINSPOTTING`, `SOM.DEEP_BRAINSPOTTING`, and `SOM.EMDR_DEVELOPMENTAL`.
- `sequencingNotes` adds the two active `ROUTE.GO_INWARD` relationships above.

No normalized field was removed or otherwise changed. In particular, A001 remains Reviewed with `IC.CREDIBILITY_REPAIR` primary; the five selected jobs, empty deferred set, required nuance, discriminating question, response, and safety result are unchanged.

The executable benchmark therefore compares latency structure with the historical performance baseline and compares normalized therapy output with a separately versioned current-policy fingerprint. An intentional, owner-authorized policy change updates the latter with an explicit semantic reconciliation; it does not rewrite history or appear as a latency regression.

## What this change does not claim

- Rumination is not asserted to be the principal cause of all post-psychedelic or dissociative difficulties.
- Symptom reduction after ignoring/checking less does not prove symptoms were imaginary.
- Exercise is not a universal treatment for derealization or trauma.
- Somatic or inner-child therapy is not contraindicated merely because it is unhelpful at one stage.
- “More therapy” and “more processing” are not assumed to be inherently beneficial.

The architecture deliberately leaves open the possibility that, for a subset of cases, the imagined need to keep healing can itself become part of what needs to stop.
