# InnerSignal goodwill bridge — execution directive

## Owner outcome

The owner explicitly authorizes implementing the discussed goodwill / benevolent-intention bridge in InnerSignal and merging the verified result to development `main`. This does **not** authorize installation, deployment, promotion to `stable`, private-case access, paid model calls, or any send capability.

## Starting point

- Task branch already created: `task/goodwill-bridge-20260913`
- Branch started from development `main` commit `4a5be95b5ae44fee2b8ed6f4733b5db5bcf9a472`, the merged owner-approved wisdom-practice reconciliation.
- This branch currently contains only this task record. Fetch current `main` before implementation. If `main` advanced, preserve all newer work and rebase/refresh this task branch before final verification.
- Open draft PR #57 is unrelated instruction-boundary work and declares no therapy graph change. Do not modify or absorb its unmerged changes unless they have reached `main` by the time this task is finalized.

## Exact semantic decision — do not redesign

Add a ninth optional wisdom practice named `goodwill_bridge` with graph node `IC.GOODWILL_BRIDGE`.

The invariant is: **benevolent intention can be available when warm affiliative love is not, and it must not be falsely relabelled as warm love.**

Required behavior:

1. When warm love or affection is not honestly accessible toward oneself, a younger self, a difficult person, or an enemy, offer the smallest sincere benevolent wish the person can actually endorse rather than requiring the feeling.
2. The owner’s exemplar is: `May they be loving, peaceful, and free.` Equivalent user-chosen wording is valid, including wishing that someone understand and become able to live from the causes of genuine wellbeing.
3. `May they be happy` is **optional**, not doctrinally required. If it feels like rewarding harmful behavior or otherwise rings false, do not force it or argue the person into it.
4. Preserve these as related but non-identical states/resources: warm affection/love; benevolent goodwill/intention; non-hatred/non-cruelty. There is no mandatory progression and no requirement to end at `I love you`.
5. Goodwill may open some warmth. That is an optional reported effect, not the success criterion and not proof that warm love is present.
6. If goodwill itself is unavailable, non-cruelty or refusal to feed hatred may be a lower-cost floor. Do not rename that floor as love.
7. For a person who behaved harmfully, goodwill may wish for capacities that would reduce the harmful behavior—such as becoming more loving, peaceful, wise, safe, or free—without approving or rewarding the behavior.
8. **Unconditional goodwill is not unconditional access.** Goodwill must never imply forgiveness, trust, contact, reconciliation, reduced accountability, removed consequences, relaxed boundaries, exposure to danger, or a prediction about the other person.
9. Preserve proportionate anger, external reality checking, ordinary protection, refusal, distance, documentation, support, consequences, and trust calibration.
10. Use secular goodwill language by default unless the person requests or has a current evidenced preference for Buddhist/metta or another spiritual framing. Do not turn a religious source into clinical-efficacy evidence.
11. This is an owner-approved proposed practice informed by adjacent compassion/metta work; engineering tests do not establish clinical efficacy.

## Architecture — exact integration target

Extend the just-merged wisdom-practice mechanism; do not create a second task/router/store.

- Add `"goodwill_bridge": "IC.GOODWILL_BRIDGE"` to `PERSPECTIVE_NODE_BY_VALUE` in `src/guide-graph/perspective-practices.mjs`.
- Keep `perspectivePracticeForTask()` as the selector. Raw `variables.perspective_practice` must continue to be overwritten by the current observation-backed `turn_task`; raw variable spoofing must not select this practice.
- The capability gate must require all **nine** wisdom nodes. Partial/legacy graph sets remain disabled.
- Add the new graph node to `guide-graphs/candidates/inner-child.graph.json`, tier 4 / priority 88, activated only by `perspective_practice == goodwill_bridge`, with the same existing wisdom safety/capacity exclusions. Do not change existing node priorities or global routing.
- Add graph relationships from `IC.BORROW_LOVE` to `IC.GOODWILL_BRIDGE` as a lower-cost alternative and from ordinary social-protection routing to the goodwill node as a boundary-preservation relationship if the current authoring schema accepts those exact relations. These edges are explanatory topology only; they must not bypass task selection.
- Add an owner-approved source amendment `AMEND.IC.WISDOM_GOODWILL_BRIDGE` carrying the semantic decision above; preserve all existing amendments. Use current repository source/provenance conventions rather than adding a new authority store.
- Update `src/prompts/perspective-practices.mjs`: eight -> nine capability wording; add the new task-map entry; audit as blocking errors any conversion of goodwill into proof of warm love/forgiveness/trust/contact/reconciliation, forced `may they be happy`, or use of benevolent wishes to erase accountability/consequences/protection.
- Do not redefine global `love_access`, `self_directed_love`, `deep_love_access`, or `metta_access`; this is deliberately a separate task-bound practice.
- No new database, scheduler, send function, private-draft persistence, model role, private-case surface, or ontology claim.

## Minimum graph-node content

Recommendations must cover:

- do not demand warm love;
- find a sincerely endorsable benevolent wish;
- include `May you be loving, peaceful, and free` as an exemplar, not mandatory wording;
- `may you be happy` is optional;
- warm affection, goodwill, and non-hatred are distinct;
- warmth emerging is optional;
- harmful behavior remains answerable to boundaries/accountability/consequences;
- when goodwill is unavailable, non-cruelty/non-hatred can be the floor without calling it love.

Forbidden overclaims must explicitly prevent:

- goodwill => warm love;
- goodwill => forgiveness/trust/reconciliation/contact/safety/moral approval;
- inability to access goodwill => spiritual failure/pathology/responsibility for another person;
- clinical-validation claims for the exact phrases or graded bridge.

Required nuance must include the exact principle: `Unconditional goodwill is not unconditional access.`

## Required tests

Extend existing `tests/perspective-practices.test.mjs` coverage automatically through the added map member and add focused integration coverage proving:

1. accepted observation-backed task routes to `IC.GOODWILL_BRIDGE`;
2. a raw `perspective_practice=goodwill_bridge` with no grounded current task cannot select it;
3. decline/close/no observation cannot select it;
4. existing safety precedence excludes it;
5. an unresolved relational reality check still outranks it when another person is central;
6. node text preserves the warm-love / goodwill / non-hatred distinction;
7. node text preserves forgiveness, trust, contact, accountability, consequences, and boundaries as separate;
8. partial/legacy eight-node installations fail the nine-node capability gate rather than loading incomplete prompt rules.

Add a canonical graph regression using the next free `G` id; at this checkpoint `G036` is free. The accepted-task case should expect `IC.GOODWILL_BRIDGE` primary. Add an inverse safety or relational-precedence case if existing focused integration tests do not exercise that through the compiled graph.

## Mechanical count repair

The complete package verifier currently contains a mock-autopilot exact node-count assertion of `61`. One legitimate new graph node changes the canonical expected count to `62`; update only count assertions and generated inventories that fail solely because of this authorized addition. Do **not** weaken qualitative assertions or broadly relax count checks.

## Research / provenance

Research-before-reinvention was already performed in Chat before this directive. The bounded scan found adjacent support for distinguishing prosocial/compassionate motivation from liking/warmth; it does not clinically validate this exact owner-developed practice. Preserve the owner conception as the source of the exact graded bridge. Do not perform a new literature project before implementation unless a source/provenance gate exposes a concrete missing requirement.

## Execution and assurance

This is a merge-to-protected-`main` task, so use release-grade repository gates for the changed surface.

1. Bootstrap live universal-dev-architecture and live project authority first.
2. Use Node 24 and exact dependencies; preserve unrelated branches/worktrees.
3. Apply the semantic change only on this isolated task branch.
4. Use the existing graph/Obsidian authoring lifecycle. Regenerate candidate graph compilation, source maps, authoring projection/maps, and any deterministic generated artifacts with repository commands; do not hand-edit generated Canvas/Mermaid as authority.
5. Because this is an owner-authorized semantic change, bind that authorization through the repository’s existing Guide Packet / owner-decision mechanism. Do not forge approval fields. If the current owner authorization cannot legally be bound to the exact generated decision cards by the existing supported mechanism, stop at `BLOCKED_EXACT_PACKET_APPROVAL` and return the exact approval-ready packet rather than copying candidate graph bytes around reconciliation.
6. Reconcile only through the existing authoring mechanism once exact approval is valid. Never write or install `stable`.
7. Required gates before merge: focused new tests, `npm run graph:test`, `npm run therapy-lessons:verify`, `npm run authoring:validate`, `npm run authoring:check`, `npm run authoring:maps:check`, `npm run audit:repository`, `npm run audit:publication`, and one complete `npm run verify`. Do not repeat unchanged full suites unnecessarily.
8. Open a PR to current `main`; inspect the exact diff. Require protected hosted checks `deterministic-package`, `workflow-policy`, and `codeql-javascript` to pass on the exact final head. Resolve any review threads.
9. Merge to `main` only after all required gates and exact semantic approval pass. Squash/rebase according to current repo policy. Do not deploy/install/promote stable afterward.
10. Verify post-merge `main` contains the merged tree and report the merge commit, graph node/edge counts, test totals, and explicit `INSTALLED=false` / `stable unchanged`.

## Stop conditions

Return to Chat instead of improvising if any failure requires changing the semantic decision above, safety/relationship/trajectory precedence, privacy, approval architecture, or stable/install policy. Mechanical generated-file drift, exact count updates, CLI serialization, and test fixture wiring may be repaired within this directive.

## Work reasoning budget

Use **Low** reasoning for execution: Chat has already made the therapeutic and architecture decisions. Work should perform its mandatory reasoning-level preflight; raise the level only if real debugging becomes non-mechanical. Semantic authority remains with this directive and the owner, not Work.
