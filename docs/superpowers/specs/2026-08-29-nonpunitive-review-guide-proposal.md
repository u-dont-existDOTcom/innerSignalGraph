# Non-punitive review Guide/graph proposal — design

Date: 2026-08-29
Status: accepted task design; candidate generation only
Task branch: `task/nonpunitive-review-proposal-20260829`

## Goal

Use the newly merged Obsidian authoring workflow for its first real semantic proposal: implement owner decision `OWNER.MAP.RESOLUTION.2026-08-29.D09` as a bounded Guide/graph candidate, generate the exact behavioral diff and owner-decision packet, and stop before approval, reconciliation, merge, installation, or `stable` work.

This task intentionally excludes D10 and every other overlay. The first live proposal must remain small enough to test the workflow, regression coverage, provenance, and review surface without coupling unrelated policy decisions.

## Owner authority

The exact owner-approved statement is:

> Review is critical. Notice recognition, repair, missed and kept promises, and what should change next without turning review into a trial. No mandatory morning/evening cadence is established.

Source decision: `authoring/migration/owner-map-resolution-2026-08-29.json`, D09, status `approved-qualified`, with `futureGuideProposalRequired: true`.

Do not strengthen, soften, universalize, or reinterpret this statement. Any wording beyond the exact statement is candidate implementation detail and remains subject to the generated owner-decision cards.

## Bounded existing-work scan

This scan informs implementation shape but does not replace the owner decision or become InnerSignal source authority.

- Wakelin, Perman, and Simonds, *Clinical Psychology & Psychotherapy* (2022), PMID 33749936, DOI 10.1002/cpp.2586: meta-analysis of 19 papers/20 RCTs found a medium reduction in self-criticism from self-compassion-related interventions, but study quality was moderate and heterogeneity high.
- Vidal and Soldevilla, *British Journal of Clinical Psychology* (2023), PMID 36172899, DOI 10.1111/bjc.12394: compassion-focused therapy was associated with less self-criticism and more self-soothing; the evidence base was small and only half of included studies were controlled trials.
- Takano and Tanno, *Behaviour Research and Therapy* (2009), PMID 19181307: self-reflection was associated with lower depression while self-rumination was associated with higher depression, and rumination could cancel reflection's adaptive association. This was a small non-clinical longitudinal study, not proof of a treatment rule.
- Bucknell et al., *Stress and Health* (2024), PMID 37671436: in one randomized trial, reflective writing improved perceived resilience relative to descriptive writing, with more durable benefit from successful-coping reflection than unsuccessful-coping reflection for some participants.

Bounded inference for this proposal: reflection should include kept promises and successful repairs as well as misses; it should terminate in one concrete repair or next adjustment; and it should explicitly avoid prosecution, grading, global verdicts, fixed ritual, or repetitive brooding. The cited literature does not validate the exact InnerSignal graph placement or prove clinical efficacy of this specific micro-intervention.

## Selected implementation shape

Choose **minimal modification of existing nodes**, not a new route.

Rationale:

- D09 describes how to review existing adult/protector behavior; it does not establish a new presenting problem or routing gate.
- A new node would require an activation rule not supplied by the owner decision and could crowd the planner.
- Adding review directly to every Protector action risks checklist bloat.
- `IC.ADULT_APPRENTICE` and `IC.CREDIBILITY_REPAIR` already own learning from action, kept promises, evidence, and repair.

Therefore the candidate modifies exactly these two nodes:

- `IC.ADULT_APPRENTICE`
- `IC.CREDIBILITY_REPAIR`

Do not change `IC.PROTECTOR_ACTION` in this proposal. Its ordinary-life act is an object of later review, but action and evaluation remain distinct.

Do not add a node, edge, case variable, activation predicate, tier, priority, default question, defer rule, or block rule.

## Provenance bridge

Before creating the graph proposal, add one owner amendment to `guides/owner-amendments.json`:

```json
{
  "id": "AMEND.IC.NONPUNITIVE_REVIEW",
  "domain": "inner-child",
  "status": "owner-approved",
  "text": "Review is critical. Notice recognition, repair, missed and kept promises, and what should change next without turning review into a trial. No mandatory morning/evening cadence is established."
}
```

The amendment text must remain exactly identical to D09. Bump the amendment-file version according to the existing convention. Do not edit canonical guide HTML/text in this task.

This amendment is a mechanical provenance bridge for an already recorded owner decision. It does not itself authorize any graph placement beyond the proposal reviewed below.

After adding it on the task branch, regenerate and validate the current projection before creating the graph proposal so the proposal base includes the new authoritative source hash.

## Candidate node deltas

### `IC.ADULT_APPRENTICE`

Add `AMEND.IC.NONPUNITIVE_REVIEW` to `sourceRefs`.

Append this recommendation:

> After an ordinary-life attempt, review what was recognized, what was repaired, which promises were kept or missed, and one thing to change next.

Append this avoidance:

> Do not turn review into prosecution, grading, a trial, or a mandatory morning/evening ritual.

Append this success signal:

> The review yields one specific repair or next adjustment without escalating self-attack.

Append this required nuance:

> Review distinguishes accountability and learning from punishment or a verdict on intrinsic worth.

### `IC.CREDIBILITY_REPAIR`

Add `AMEND.IC.NONPUNITIVE_REVIEW` to `sourceRefs`.

Append this recommendation:

> When a promise was missed, name it, repair what can be repaired, and make the next promise more credible rather than demanding acquittal or issuing a global verdict.

Append this avoidance:

> Do not use review to stage an internal trial or turn one lapse into a final verdict about worth or future capacity.

Append this success signal:

> Review tracks kept promises and completed repairs as evidence alongside lapses.

Append this required nuance:

> Missed promises are evidence to address through acknowledgement, repair, and changed behavior; kept promises and successful repairs are evidence too.

The worker may make only mechanical punctuation or repository-style normalization. A substantive wording change must be surfaced as an explicit alternative in the owner-decision packet rather than silently substituted.

## Regression and realization requirements

Use the new authoring proposal workflow. Create proposal ID:

`nonpunitive-review-r1`

Create it from the two exact current node records and declare existing cases `G001` and `G012`.

Add a proposed graph case `G013` (or the next exact available ID if `main` has moved) that:

- safely matches `IC.ADULT_APPRENTICE`;
- keeps witness capacity present so neutral-witness bootstrap does not obscure the case;
- avoids unrelated self-criticism/best-friend and love-access routes where possible;
- asserts selection of `IC.ADULT_APPRENTICE`;
- asserts required-nuance patterns for accountability/learning versus punishment/trial;
- demonstrates that kept promises/repair and a concrete next adjustment remain present.

Update proposal-local replacements for `G001` and/or `G012` as needed to assert the new credibility-review nuance. Do not weaken their existing distinctions.

Add focused runtime/realization coverage proving the deterministic intervention contract carries the new nuance and that final realization cannot convert it into prosecution, a global worth verdict, or a fixed daily ritual. Preserve the existing one-main-next-move response rule.

Because activation, tier, priority, gating, and topology do not change, no new matching/non-matching activation boundary is required. All existing graph cases must remain green.

## Required workflow

1. Recover actual current `main` and read repository authority files.
2. Create an isolated worktree on this task branch.
3. Run and record baseline authoring, graph, focused test, and complete verification gates.
4. Add the exact owner amendment and version bump.
5. Run `npm run authoring:project`, `authoring:validate`, `authoring:check`, and map checks.
6. Create `nonpunitive-review-r1` with the repository CLI.
7. Edit only the generated proposal directory and proposal-local tests for graph changes.
8. Build and deterministically check the proposal.
9. Verify the generated repository-source Guide Packet with the existing verifier.
10. Inspect the full semantic diff, provenance impact, regression impact, candidate map/Canvas, and all owner-decision cards.
11. Run focused tests, `npm test`, `npm run graph:test`, and `npm run verify`.
12. Commit the proposal source, owner amendment, updated generated projection/maps, tests, and durable candidate report.
13. Open a **draft** PR against `main` containing the exact decision cards and validation receipt.
14. Export the verified candidate packet and decision artifacts as ephemeral files for owner review.
15. Stop.

## Hard boundaries

- Do not approve any generated decision card.
- Do not set packet status to approved.
- Do not reconcile the proposal.
- Do not mark the D09 overlay `reconciled` yet.
- Do not merge the draft PR.
- Do not install a Guide Packet.
- Do not touch `stable` or the installed runtime.
- Do not include D10 or another overlay.
- Do not change canonical guide prose.
- Do not add a fixed review cadence.
- Do not turn a miss into proof of worthlessness, permanent unreliability, or impossible repair.
- Do not add generic clinical claims or cite the literature as stronger evidence than it provides.

## Acceptance for candidate-generation completion

Candidate generation is complete only when:

- the exact D09 statement is preserved in the new owner amendment;
- the proposal changes only the two declared graph nodes and proposal-local regression material;
- no routing, activation, tier, priority, question, defer/block, or topology field changes;
- all source refs resolve;
- semantic diff is complete and contains no unclassified field;
- regression coverage passes with no weakened existing assertion;
- candidate Guide Packet verifies;
- generated Mermaid and Canvas distinguish the still-uncompiled overlay from the candidate graph correctly;
- all focused and complete gates pass;
- a draft PR and owner-review artifacts exist;
- no approval, reconciliation, merge, install, or `stable` change occurred.

## Owner review after worker completion

The owner review should decide the exact node-level changes—not D09 itself, which is already approved. Review each generated card for:

- whether review belongs in both nodes;
- whether each added sentence is necessary and non-repetitive;
- whether the change preserves one-main-next-move responses;
- whether it tracks success and repair without minimizing misses;
- whether it prevents brooding/trial without softening accountability.
