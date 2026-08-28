# Inner Signal agent map

## Authority

1. Current owner and task requirements
2. `.github/codex-repository.json` for repository classification and exact commands
3. `state/CODEX-CURRENT-STATE.md` for the resumable current checkpoint
4. `README.md` for branch, release, privacy, recovery, and installation contracts
5. `AUTOPILOT.md` for autonomous development behavior
6. `docs/INDEX.md` for current specifications, plans, and evidence
7. `docs/superpowers/specs/2026-08-14-public-repository-transition-design.md` for the accepted visibility-transition contract
8. `docs/PUBLIC-REPOSITORY-TRANSITION-REPORT-2026-08-14.md` for bounded pre-public and hosted evidence when produced
9. Current code, tests, package verifier, and Git history
10. Relevant current guidance from `u-dont-existDOTcom/universal-dev-architecture`

## Validation

- Runtime: Node 24.18.0 (`.nvmrc`)
- Bootstrap: `npm ci --ignore-scripts`
- Repository audit: `npm run audit:repository`
- Local publication audit: `npm run audit:publication`
- Authenticated hosted publication audit: `npm run audit:publication:hosted`
- Targeted tests: `npm test`
- Complete package gate: `npm run verify`
- Graph gate when affected: `npm run graph:test`
- Lesson gate when affected: `npm run therapy-lessons:verify`

Provider checks are explicit opt-in and are not hermetic CI.

## Workflow

Use an isolated worktree or task branch and a pull request. Keep accepted designs/plans under `docs/superpowers/`. The GitHub repository is public and the publication transition is complete. Public visibility does not grant release or product-policy authority; hosted controls remain claims only when supported by current GitHub API/settings evidence. Run targeted and complete gates, inspect the final diff and package artifacts, update `state/CODEX-CURRENT-STATE.md`, and complete lesson closeout. Release evidence follows `docs/RELEASE-EVIDENCE.md`.

Integrity maintenance: any legitimate edit to `README.md`, `AGENTS.md`, `docs/INDEX.md`, `SECURITY.md`, or `CONTRIBUTING.md`—including Task 9 public/completed reconciliation—must update the reviewed SHA-256 bindings in `scripts/audit-repository.mjs` in the same reviewed change.

## Branch roles

- `main`: development authority
- `stable`: only installation and release authority
- `runtime-diagnostics`: generated allowlisted status records; never merge into runtime source
- task branches: proposed changes

## Safety

Never install from `main` or diagnostics. Keep private runtime data and local configuration out of Git. Promotion to `stable` requires the complete package gate and retained rollback.

## Code review rules

- Preserve `stable` as the sole installation source and retain the prior verified runtime after failed updates.
- Keep diagnostics constrained to their declared schema and paths.
- Product-policy decisions remain owner-gated; implementation review cannot silently approve them.

Treat chat as disposable working memory. A fresh worker must recover from Git.

<!-- therapy-owner-decision-protocol {"schemaVersion":2,"rules":["read-all-four-ledgers","separate-deterministic-repairs-from-owner-choice","ask-joel-directly-in-active-conversation","one-substantive-decision-unless-joel-requests-bundling","state-exact-decision-and-why-now","classify-evidence-type-and-limitations","present-viable-options-benefits-costs-worst-failure","keep-recommendation-and-detailed-reasoning-distinct","enumerate-guide-graph-prompt-safety-regression-effects","no-answer-leaves-policy-unchanged","record-explicit-answer-only-never-infer","commit-git-transition-and-tests-before-durable-guidance","never-store-private-therapy-transcript"]} -->

## Required therapy-governance context

Before any work involving therapy, hypnosis, somatic practice, a Guide Packet, a guide, a graph, a prompt contract, safety policy, evidence policy, or a therapy regression, read all four root ledgers: `THERAPY-LESSONS`, `SUGGESTED-THERAPY-LESSONS`, `THERAPY-DECISIONS`, and `APPROVED-THERAPY-LESSONS`.

The ledgers have different authority. `THERAPY-LESSONS` is append-only discovery, review, and implementation audit history; it is never approval authority. `SUGGESTED-THERAPY-LESSONS` is the current guide-impacting proposal and transition queue. `THERAPY-DECISIONS` is the append-only source of structured receipts for Joel's explicit direct-conversation approvals and declines. `APPROVED-THERAPY-LESSONS` is an approval-only implementation view, and each entry must link to exactly one approving receipt. Governance-design approval, review findings, model recommendations, technical supersessions, and existing candidate history are not therapy-policy approval.

## Direct owner-decision protocol

For every therapy, hypnosis, somatic, guide, graph, prompt, safety, or evidence-policy decision:

1. Complete safe deterministic repairs that do not require owner judgment, or clearly separate those repairs from the owner choice.
2. Ask Joel directly in the active conversation. Ask one substantive decision at a time unless Joel explicitly asks to bundle them.
3. State the exact decision and why it is needed now.
4. Classify the evidence type and describe its limitations, including whether each source is canonical, owner-authored, external, anecdotal, or independently validated.
5. Present each viable option with concrete benefits, costs, and worst plausible failure.
6. Give a recommendation with detailed reasoning, while keeping the recommendation and reasoning visibly distinct from Joel's decision.
7. Enumerate the downstream effects on guides, graph nodes, prompt contracts, policy or safety gates, and regression cases.
8. State that no answer leaves current policy unchanged.
9. Record only Joel's explicit answer in `THERAPY-DECISIONS`. Never infer approval or decline from silence, prior general enthusiasm, a model verdict, a recommendation, or a suggested default.
10. Commit the resulting ledger transition and its passing tests to Git before treating the decision as durable development guidance.

If direct conversation with Joel is unavailable, leave the suggestion pending and leave production policy unchanged.

An approval requires exactly one `THERAPY-DECISIONS` receipt with choice `approve` before an `APPROVED-THERAPY-LESSONS` projection may exist. A decline requires exactly one receipt with choice `decline` and no approval projection. A technical supersession uses validated transition metadata and a compatible `supersededBy` link; it must not fabricate an owner receipt.

## Privacy boundary

Never store private therapy transcripts or other private therapy-session material in these ledgers or elsewhere in the repository. Record only the concise policy decision, its bounded rationale when Joel supplies one, affected identifiers, and non-private verification evidence needed for the development audit trail.
