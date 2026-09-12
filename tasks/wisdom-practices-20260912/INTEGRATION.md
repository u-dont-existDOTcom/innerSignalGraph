# Wisdom practices integration ledger

- Task: `wisdom-practices-20260912`
- Branch: `task/wisdom-practices-20260912`
- Pull request: `#55` (open and intentionally unmerged)
- Base commit: `ad441affd378e06d6395e0ba4ec0760eaaea5d52`
- Assurance lane: iteration with targeted hard gates for therapy safety, privacy, provenance and exact approval
- Source directive: `packet-source/EXECUTION-DIRECTIVE.md`
- Candidate status: PREPARED, COMPILED and TESTED
- Approval status: APPROVAL_PENDING; the generated exact packet has 32 pending owner decision cards
- Reconciliation status: not run; blocked by exact packet approval
- Merge status: not run; the review branch must remain unmerged
- Installation/deployment/stable status: prohibited by the current task

The packet's bound repository blobs matched the fresh base. The read-only staging utility produced 36 exact candidate members outside the repository. Repository integration must preserve the existing authoring lifecycle: owner-approved source amendments and runtime capability support may be prepared on this task branch; canonical graph writes require reconciliation from a genuinely approved exact packet.

## Implemented candidate

- Proposal: `wisdom-practices-20260912`
- Generated Guide Packet: `authoring-wisdom-practices-20260912`
- Packet SHA-256: `f2d67e1990ceadb4120955c4c46c65d95aed0ad0c0270f2e6d652f778fa4ab8c`
- Candidate bundle SHA-256: `cf8f7d7e0a4ff7f84996b31a066c32b22a0954b0b781ce3bd4018759fbfdc13b`
- Candidate graph size: 3 graphs, 61 nodes, 82 edges, 100 source sections and 36 owner amendments
- Exact graph result: 8 new nodes, 12 new edges and 6 existing-node amendments, represented as 32 owner-decision cards
- Proposal regressions: 62/62 passed, including all supplied G930-G962 cases

The source authority contains the ten packet-supplied owner-approved wisdom amendments. The canonical compiled graph remains the pre-reconciliation 53-node/70-edge graph plus those source records; the eight new nodes and twelve new edges exist only in the generated candidate. Runtime integration derives the practice from a current, observation-backed `turn_task`, ignores raw variable spoofing, enables prompt instructions only when all eight nodes are actually present, preserves safety and relationship precedence, keeps outward action primary when editing is only required support, and requires realization coverage for both nodes. It adds no send, scheduling, database or private-draft persistence authority.

One mechanical proposal-adapter gap was found and repaired: the authoring packet serializer had discarded `turn_task` and required/excluded execution-node assertions. That made task-backed proposal cases route as if no task existed even though the supplied graph records were valid. The adapter now preserves those existing contract fields; no therapeutic expectation was changed.

## Verification

- Packet integrity and staging: PASS; 23 bound files, 36 staged candidate members, 7/7 staging checks, 33/33 supplied helper cases
- Focused production-path tests: PASS 8/8, including extraction → audit → candidate planner → realization
- Affected integration tests: PASS 112/112, including synthetic private continuity and legacy r01/r02 packet compatibility
- Canonical graph regressions: PASS 29/29
- Proposal regressions: PASS 62/62
- Therapy lessons: PASS 5/5 substantive lessons; 4 active runtime lessons documented
- Authoring validation/projection/map checks: PASS; projection input `2b23083b114602af50c57f715c5afb16d1c1b9959e3ca8ea9d7f87f501a49b2f`, 322 generated files
- Proposal independent rebuild/byte comparison: PASS; receipt SHA-256 `910bd4bb1ba97e11c88aff2f79450f9de78225b067af8de59748117868a27ad7`
- Repository audit: PASS with zero errors and one inherited hosted-permissions verification warning
- Publication audit: PASS; 230,481 records scanned, zero findings
- Complete package verification: the single permitted boundary run passed 1,113/1,116 tests and exposed three stale mechanical expectations: source-note count 90→100, owner-amendment count 26→36, and the two semantic benchmark hashes changed by the new contract field. Only those exact inventory assertions and current policy fingerprint/revision were updated; the focused rerun passed 22/22. The full local suite was not repeated. Final pushed-head completeness belongs to the hosted PR checks.

No provider/model call and no real private-case read or mutation occurred. Private non-effect evidence is synthetic only. Engineering tests do not establish model adherence, human usefulness or clinical efficacy.

## Exact blocker

`BLOCKED_EXACT_PACKET_APPROVAL`: `audit/owner-decisions.json` is `awaiting-owner`, `allApproved` is false, and all 32 decision cards are pending for the exact packet SHA-256 above. Passing tests cannot approve therapy semantics. Until Chat supplies a genuinely approved copy of those exact bytes, `RECONCILED`, `MERGED` and `INSTALLED` remain false.

## Recovery

Resume only in the branch and worktree named above. Rebuild and compare the proposal after any candidate change. Never infer graph reconciliation, merge or installation from passing engineering tests. After exact approval is supplied, verify the approved packet bytes and use the existing reconciliation command; do not copy candidate graphs into canonical authority by hand.
