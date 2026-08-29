# Non-punitive review Guide/graph proposal — implementation plan

Date: 2026-08-29
Task branch: `task/nonpunitive-review-proposal-20260829`
Design authority: `docs/superpowers/specs/2026-08-29-nonpunitive-review-guide-proposal.md`
Terminal state for this task: `AWAITING_OWNER_DECISIONS`

## Objective

Exercise the merged Obsidian proposal workflow on one bounded owner-approved but uncompiled item: D09 non-punitive review. Produce a verified candidate, complete semantic/provenance/regression receipts, a candidate Guide Packet, owner-decision cards, and a draft PR. Do not approve, reconcile, merge, install, or change `stable`.

## Phase 0 — Recovery and exact baseline

1. Fetch current refs and confirm this branch descends from current protected `main`.
2. Read `AGENTS.md`, `.github/codex-repository.json`, `README.md`, `AUTOPILOT.md`, `docs/INDEX.md`, `docs/AUTHORING-ARCHITECTURE.md`, the design file above, and current owner instructions.
3. Inspect open worktrees and active tasks. This branch owns only D09 candidate generation and must not absorb work from PR #11 or any other task.
4. Confirm `stable` and the installed runtime are out of scope.
5. Record exact baseline SHA-256 values for:
   - `guides/owner-amendments.json`;
   - all candidate graph members;
   - compiled graph members and bundle;
   - source maps/layout;
   - graph regression corpus;
   - generated authoring projection and maps.
6. Run the repository-required bootstrap using Node/npm versions declared by current authority.
7. Run baseline gates:

```bash
npm run authoring:validate
npm run authoring:check
npm run authoring:maps:check
npm run graph:test
npm test
npm run verify
```

Stop and classify any unrelated baseline failure before editing.

## Phase 1 — Owner-amendment provenance bridge

1. In `guides/owner-amendments.json`, add exactly:

```json
{
  "id": "AMEND.IC.NONPUNITIVE_REVIEW",
  "domain": "inner-child",
  "status": "owner-approved",
  "text": "Review is critical. Notice recognition, repair, missed and kept promises, and what should change next without turning review into a trial. No mandatory morning/evening cadence is established."
}
```

2. Bump the amendment version according to the existing monotonic convention. Do not change any existing amendment bytes except formatting required by the canonical writer.
3. Add/adjust focused tests proving:
   - D09 and the amendment text are byte-identical;
   - the amendment ID is unique;
   - the amendment is source-mapped and resolvable;
   - no canonical guide source changed.
4. Run graph compilation and relevant source-map tests.
5. Regenerate the authoring projection and maps:

```bash
npm run authoring:project
npm run authoring:validate
npm run authoring:check
npm run authoring:maps:check
```

6. Confirm the D09 overlay remains `owner-approved-uncompiled`. The provenance bridge does not reconcile or compile it.
7. Commit this phase separately if current workflow permits clean incremental commits.

## Phase 2 — Create the proposal through the new workflow

1. Create proposal ID `nonpunitive-review-r1` using only the repository CLI:

```bash
npm run authoring:proposal:new -- \
  --id nonpunitive-review-r1 \
  --node IC.ADULT_APPRENTICE \
  --node IC.CREDIBILITY_REPAIR \
  --regression G001 \
  --regression G012
```

2. Verify that `base-authority.json`, proposal hashes, graph IDs, and exact record hashes match the regenerated current projection.
3. Edit only the proposal directory for node changes and proposal-local graph cases.
4. Set the proposal manifest intent/non-goals/worst-plausible-failure from the accepted design. Keep status `draft` or the exact pre-approval status required by the current contract.

## Phase 3 — Exact node changes

Apply the design deltas exactly.

### `IC.ADULT_APPRENTICE`

- Add source ref `AMEND.IC.NONPUNITIVE_REVIEW`.
- Append recommendation:

  `After an ordinary-life attempt, review what was recognized, what was repaired, which promises were kept or missed, and one thing to change next.`

- Append avoidance:

  `Do not turn review into prosecution, grading, a trial, or a mandatory morning/evening ritual.`

- Append success signal:

  `The review yields one specific repair or next adjustment without escalating self-attack.`

- Append required nuance:

  `Review distinguishes accountability and learning from punishment or a verdict on intrinsic worth.`

### `IC.CREDIBILITY_REPAIR`

- Add source ref `AMEND.IC.NONPUNITIVE_REVIEW`.
- Append recommendation:

  `When a promise was missed, name it, repair what can be repaired, and make the next promise more credible rather than demanding acquittal or issuing a global verdict.`

- Append avoidance:

  `Do not use review to stage an internal trial or turn one lapse into a final verdict about worth or future capacity.`

- Append success signal:

  `Review tracks kept promises and completed repairs as evidence alongside lapses.`

- Append required nuance:

  `Missed promises are evidence to address through acknowledgement, repair, and changed behavior; kept promises and successful repairs are evidence too.`

### Forbidden changes

The semantic diff must show no change to:

- node IDs;
- graph membership;
- titles;
- kinds;
- tiers;
- priorities;
- activation predicates;
- default questions;
- defer/block effects;
- edges/topology;
- case variables;
- other nodes.

If the authoring workflow or validator requires a wording adjustment, preserve meaning and surface the exact difference in the decision card. Do not silently substitute it.

## Phase 4 — Regression material

1. Determine the next available graph-case ID. Prefer `G013`; do not overwrite an existing case.
2. Add one proposal-local case matching `IC.ADULT_APPRENTICE` with these characteristics:
   - `present_safety=safe`;
   - `orientation=oriented`;
   - stopping/return capacity yes;
   - sober, not highly activated, no high dissociation;
   - `inner_adult_access=partial`;
   - `support_available=present`;
   - witness capacity present;
   - avoid unrelated self-criticism, best-friend, borrowed-love, credibility, forgiveness, memory, and advanced-release routes where the contract permits;
   - expected selected/matched inclusion of `IC.ADULT_APPRENTICE`;
   - expected required-nuance pattern distinguishing accountability/learning from punishment or trial;
   - expected content pattern preserving kept promises/repair and one next adjustment.
3. Copy G001 and/or G012 into proposal-local tests only when needed to add assertions for the new credibility-review nuance. Preserve every prior assertion.
4. Add focused test coverage at the deterministic plan/response-contract layer so the new nuance:
   - reaches the intervention contract;
   - cannot become prosecution, grading, a global worth verdict, or fixed daily cadence;
   - remains subordinate to one main next move.
5. Do not add model-generated fixtures or claim live-model validation.

## Phase 5 — Candidate build and fail-closed inspection

Run:

```bash
npm run authoring:proposal:build -- --id nonpunitive-review-r1
npm run authoring:proposal:check -- --id nonpunitive-review-r1
```

Inspect every output under `authoring/.build/nonpunitive-review-r1/`:

- candidate graph members;
- compiled candidate bundle;
- semantic diff;
- owner-decision cards;
- proposal evidence hash;
- regression impact;
- provenance impact;
- candidate Mermaid;
- candidate Canvas;
- candidate Guide Packet;
- deterministic receipt.

Required properties:

- exactly two graph nodes changed;
- only sourceRefs, recommendations, avoid, successSignals, and requiredNuance changed;
- all source refs resolve;
- no unclassified change;
- all candidate and canonical regressions pass;
- required coverage reports no gap;
- packet verifier passes;
- all decision cards remain pending;
- candidate map continues to distinguish current compiled graph from the D09 overlay until reconciliation;
- repeated build/check output is byte-identical.

Stop on any discrepancy rather than repairing around the decision system.

## Phase 6 — Complete verification

Run at minimum:

```bash
npm run authoring:validate
npm run authoring:check
npm run authoring:maps:check
npm run graph:test
npm test
npm run verify
bash scripts/report-worktree.sh
git diff --check
```

Also run the repository audit and workflow-policy gates if required by current `AGENTS.md`/profile.

Compare final branch against baseline:

- canonical guide source bytes unchanged;
- candidate/compiled canonical graph bytes unchanged, because the proposal remains un-reconciled;
- owner-amendments and generated projection/maps changed as expected;
- proposal source and tests added;
- no installed/runtime state changed;
- `stable` unchanged.

## Phase 7 — Durable report and draft PR

1. Add a candidate report under the established docs/evidence convention containing:
   - exact starting and ending commits;
   - baseline/final hashes;
   - amendment identity;
   - proposal identity and base hashes;
   - complete semantic-diff summary;
   - generated decision cards and their status;
   - regression/provenance receipts;
   - packet SHA-256 and verifier result;
   - focused/complete test results;
   - non-effects;
   - remaining owner decisions;
   - rollback.
2. Update `state/CODEX-CURRENT-STATE.md` only if required by current task/recovery policy. Do not overwrite a newer active task checkpoint; instead use a task-scoped checkpoint when authority requires separation.
3. Commit all source artifacts. Do not commit ignored `.build` output unless an established evidence path requires selected deterministic receipts.
4. Push branch and open a **draft** PR against `main` titled:

`Propose non-punitive review guidance through Obsidian workflow`

5. Include exact decision cards in the PR body or attach/export them through the repository’s established safe mechanism.
6. Export the candidate packet, semantic diff, decision cards, and receipt as ephemeral downloadable artifacts for owner review.
7. Stop with terminal status `AWAITING_OWNER_DECISIONS`.

## Explicit non-actions

Do not:

- approve cards;
- change `allApproved` to true;
- create an approval hash;
- reconcile proposal records into candidate graphs;
- change overlay status to `reconciled`;
- merge the PR;
- install the packet;
- advance or write `stable`;
- alter the installed runtime;
- add D10 or another owner-map item;
- modify canonical guide prose;
- perform broad architecture cleanup.

## Worker return contract

Return:

- branch and final commit;
- draft PR number/URL;
- proposal ID;
- candidate packet SHA-256;
- exact changed node IDs and field paths;
- owner amendment ID/version;
- decision-card count and pending statuses;
- regression-impact result;
- packet verification result;
- authoring, graph, complete test, and package-verification results;
- baseline/final hash comparison;
- exported review artifact links;
- any explicit blocker.
