# Audit-architecture evaluation integration — 2026-09-07

Status: deterministic harness and owner-frozen ChatGPT-UI smoke plan implemented and locally tested on draft PR #46; calibration contract and an ambiguous negative control were repaired after preflight; architecture smoke not yet run; no winning architecture selected.

## Authority and scope

Current owner instruction authorizes a de-identified, synthetic, runnable comparison of therapy-response audit architectures on the active PR/branch and a bounded subscription-ChatGPT smoke controlled through Codex or Mission Control. It prohibits provider/API/OpenRouter spending and does not authorize runtime integration, therapy policy, guide or graph changes, merging, deployment, installation, or stable promotion.

- Repository: `u-dont-existDOTcom/innerSignalGraph`
- PR: draft #46, `companion/foundations-2026-09-05`
- Initial fetched head: `e4427d175e06ad8aa313b9cfa4a340379d3e9590`
- Refreshed PR parent before update: `48204b1dcae424434bec2859dda72e3b109d3027`
- Owner-decision refresh head: `fd70a9bb2cb3fee85e3864f16974fb6be272a728`
- Longitudinal supplement refresh head: `8e0ebffbdc1a7a775b0fddd89b1f0f1b70edb703`
- Local integration branch: `codex/audit-architecture-eval-20260908-v2`, tracking the PR source branch
- Integration receipt: the PR advanced during implementation, so the reviewed task commit was replayed linearly onto the refreshed parent. No merge commit, shared-history rewrite, or PR merge occurred.
- Rollback boundary: the refreshed PR parent remains the direct parent; the pre-refresh task commit also remains reachable locally. This additive task can be reverted normally.
- Provider calls: 0
- ChatGPT model submissions before the current control-and-batching repair: 14 calibration/preflight submissions; 11 belong to a superseded fixture version, one current-head validator result was structurally invalid, one positive validator control passed, and one negative control exposed a same-error-class ambiguity. The latter two are also superseded by the containing-commit freeze. No architecture-smoke output was generated, and every invalid/superseded result remains excluded and recorded in the ignored private run ledger.
- Real client records or transcript text: 0

The frozen execution decisions are machine-readable in `execution-plan.json`: four fixtures (`AE-D004`, `AE-D005`, `AE-D007`, `AE-D010`), one repeat, the complete N/A/B-patch/B-reconstruct/C/D/E cross, visible `GPT-5.6 Sol` with visible `Extra High` for candidate/audit work, deterministic scoring plus two fresh blinded Sol Extra High graders, optional non-primary Pro dissent with blinded Sol adjudication, a separate fixed-A comparison against the visible `Latest` label, and a 100-submission stop. The ChatGPT selector inventory was observed at `2026-09-08T10:31:09Z`; the backend behind `Latest` is deliberately recorded as unknown.

Current owner/task requirements outrank this ledger. Root `AGENTS.md`, `.github/codex-repository.json`, `state/CODEX-CURRENT-STATE.md`, `AUTOPILOT.md`, `docs/REASONING-SELECTION.md`, current code/tests, and the relevant universal lessons were read before implementation. The completed non-exclusive historical active-task record did not reserve this branch.

## Independent conception

The owner supplied the independent conception before this repository scan: preserve the causal and interaction structure of a difficult multi-turn case without private identifiers; compare holistic, sequential, parallel, and fresh-context adversarial audits; optionally measure anchored self-critique; compare patching with reconstruction; weight safety and epistemic failures; ask high-information branching questions; and penalize audit-induced conservatism on already-good answers.

No post-scan idea is retroactively attributed to that conception.

## Research-before-reinvention

Applicability: `required`. Disposition: `compose` / `adapt`.

Search formulations used inside current canonical sources: synthetic multi-turn behavioral evaluation; LLM critic independence; blind model judging; grader calibration; audit-repair versus reconstruction; conversation-history fidelity; weighted seeded-error detection; over-audit/no-op control; exact evaluator provenance.

Existing-work map:

- **Already solved:** the companion evaluation protocol supplies role separation, frozen synthetic cases, chronological replay, hidden case truth, exact configuration records, and revision after observed failures.
- **Composable:** the guide-fidelity protocol supplies fresh calibrated graders, arm/model/plan blinding, positive and negative controls, exact identity and call caps, private output, locks, failure preservation, and no fallback.
- **Composable:** the universal independent-evaluation pattern supplies the information firewall and frozen diagnosis before reconciliation.
- **Composable:** the universal external-evaluation pattern supplies exact input/boundary/model/config provenance and unchanged-control reproduction before causal attribution.
- **Project-specific remainder:** the 15-class therapy reasoning taxonomy, mixed-benefit/adverse-risk fixture, paired B patch/reconstruct fork, explicit good-draft no-op penalty, and deterministic metric calculator.
- **Incompatible as a direct substitute:** runtime keyword or schema checks cannot establish semantic therapy correctness, and the existing guide-fidelity cases do not exercise this exact audit-orchestration question.

Strongest external baseline inside the project: the guide-fidelity protocol's isolated responder plus independent calibrated graders. Simple baseline: `NO_AUDIT`, which preserves the same starting draft at zero audit cost. This task does not claim novelty or superiority.

## Implemented artifacts

- `docs/superpowers/specs/2026-09-07-audit-architecture-evaluation.md`: concise design, boundary, conditions, metrics, and acceptance.
- `cases.json`: one nine-turn fictional conversation with stable fact and turn IDs, settled history, and open discriminating questions.
- `drafts.json`: 15 deliberately flawed drafts covering the original and longitudinal failure classes plus two neutrally named good termination controls, including one shorter independently worded control.
- `reference-target.json`: stable-ID behavioral target and synthetic calibration response; the case-specific target and sample wording are withheld from auditors/repairers, and sample wording is also withheld from final graders.
- `rubric.json`: 25-class taxonomy including the 15 original classes, explicit high-severity current-risk ambiguity, low-severity style bloat, and eight owner-authorized longitudinal classes; weights `HIGH=5`, `MEDIUM=3`, `LOW=1`, with 19 behavioral dimensions.
- `architectures.json`: exact A–E and no-audit topologies, context boundaries, prompts, output schemas, pass counts, and B finding-set reuse.
- `grader-controls.json`: separate finding-validator controls and complete-response grader controls with exact/subset semantics.
- `execution-plan.json`: owner-frozen no-API execution boundary, four-fixture smoke, two fresh Sol Extra High graders, role-separated blinded batch grading, a derived 80-submission successful-run ceiling, conservative pruning rule, selector-label evidence, `Latest` comparison, optional Pro dissent route, and owner-review/no-adoption gate.
- `packets.mjs`: deterministic audit, finding-validation, and complete-response grading packets that enforce case-target and architecture/model firewalls for ChatGPT conversations. Grader and validator packets now carry strict structured-output schemas whose quote/omission evidence shape matches the deterministic scorer.
- `score.mjs`: structural privacy checks, repeat-aware opaque scheduling, schema-validated canonical audit-output bytes with recomputed content hashes, topology-derived findings/actions/responses, raw evidence-bearing grades, hidden-truth scoring, early-stop enforcement, content-bound B pairing, pooled/macro metrics, logical-grade versus physical-submission accounting, safety qualification, Pareto reporting, paired repair comparisons, and perpetual `winner: null`.
- `score.test.mjs`: deterministic and mutant tests for coverage, privacy, answer-key withholding, repetitions, C ordering, record swaps, exact topology, canonical-output substitution and false-clean-stop rejection, criterion-bound evidence, severity, hidden seed derivation, pre-existing error versus regression, raw disagreement, duplicate findings, no-op termination, B byte/hash identity, schedule completeness, reused-grade identity, physical batch-cost deduplication, derived calibration, execution-plan drift, packet firewalls, and comparison behavior.
- `PROTOCOL.md`: ChatGPT-UI smoke protocol, role separation, submission/cost formula, selector-label gate, small model comparison, optional Pro adjudication, claims, and non-effects.

`CHANGED-PATHS.txt` is the exact intended task delta relative to the fetched baseline. The containing commit and hosted check identities belong in Git/PR evidence because a commit cannot embed its own final hash.

## Deterministic evidence

Focused test after independent-review repairs:

`/home/joel/.nvm/versions/node/v24.18.0/bin/node --test --test-isolation=none tasks/audit-architecture-eval-20260907/score.test.mjs`

Latest focused result: 24/24 passing on pinned Node 24.18.0. The strengthened suite now also rejects API/provider activation, inferred `Latest` identity, anchored/non-blind graders, missing good-control coverage, direct Pro verdicts, automatic adoption, and audit/grader packet leakage. Earlier repairs covered control length, stage-name/setup drift, criterion-map shadowing, late no-op topology, schedule completeness, shared-call identity, grade-call cost identity, and raw audit-output provenance.

After the longitudinal supplement landed, the combined focused harness suite passes 41/41 on pinned Node 24.18.0. A current-head ChatGPT validator preflight returned string evidence because the packet described evidence only in prose while the scorer requires a structured `QUOTE`/`OMISSION` object. After that schema repair, the original negative validator control still allowed a different passage to support the same broad error class. Both outputs are frozen as failed calibration artifacts. The packet now includes an exact JSON schema, explicitly treats a proposed `draftQuote` as a claim to verify, and the negative control uses a clean response with an absent error class. Role-separated batch packets and content-bound physical-submission accounting make the complete two-pass evaluation fit the ceiling without dropping fixtures: `64` architecture stages + `4` Latest calls + `6` calibration calls + `6` batch-grade/validator calls = `80`, or `94` including all 14 archived preflight submissions. Calibration must restart from the containing commit; the main architecture smoke remains unopened.

On owner-decision refresh parent `fd70a9bb2cb3fee85e3864f16974fb6be272a728`, the complete pinned Node 24.18.0 package gate passes: 975/975 automated tests, 29/29 graph cases, therapy lessons, authoring validate/check/maps, immutable packet archives, mock A001/H001 replays, web/autopilot smokes, runtime fingerprint, package hygiene, and autonomous-development checks. A sandboxed run was discarded after permission-sensitive subprocess and loopback tests failed; the required host-boundary rerun is the valid green result.

Pre-refresh pinned-runtime package verification passed, including 948/948 automated tests, 29/29 graph cases, syntax and authoring checks, archive verification, mock replays, web/autopilot smoke checks, package hygiene, and autonomous-development checks. `npm run audit:repository` also passed with zero errors and its pre-existing warning that hosted GitHub App permissions require external verification.

After replaying the task onto refreshed PR parent `48204b1`, the task's 20/20 focused tests remained green, but the integrated package gate exposed one deterministic failure outside this task: 957/958 automated tests passed and `tests/therapy-latency-benchmark.test.mjs` rejected the refreshed runtime's stale `THERAPY_POLICY_FINGERPRINT`; an isolated rerun reproduced 1/2 passing. The concurrent parent changed runtime composition while this task changes only docs/state and `tasks/audit-architecture-eval-20260907/`. This task does not alter or waive that existing gate and does not expand scope to repair the concurrent runtime benchmark.

No semantic model judgment is inferred from these tests. The Git-object publication gate remains necessarily post-commit; final diff and ephemeral privacy review remain required at this checkpoint. The named refreshed-parent package failure remains visible for the concurrent runtime integration owner.

## Independent review and repair

Two read-only reviews separately challenged methodology and repository fit. Their material findings were repaired before final gating:

- blind validators now emit support only; seeded/unseeded status is derived behind the codebook after freeze;
- critics no longer receive the case-specific answer key, and prompt prose matches the formal firewall;
- exhaustive initial and final grades distinguish pre-existing defects from repair regressions and retain raw reason/evidence plus disagreement;
- condition-specific actions, byte-identical `KEEP`, no-audit invariants, and clean early termination are executable contracts;
- neutral draft IDs and opaque grader queues remove the good-control cue and reject swapped records;
- B patch/reconstruct records bind repeat, pair, identical specialist calls, canonical finding bytes/hash, finding validation, and initial grades; reusable call IDs are restricted to preregistered sharing relationships and prevent double-counted cost;
- every audit-stage output is retained as strict-schema canonical JSON, hash-recomputed and schema-validated; scored findings, action, response, and clean early-stop claims are derived from the appropriate A/B/C/D/E stage rather than trusted summary fields; C/D synthesis cannot add an upstream-absent error class, B freezes the complete B3 payload, and a repaired E draft receives its required second critique;
- duplicate same-class findings are rejected, pooled metrics supplement macro averages, and repeat/C-order randomization is executable;
- role-specific calibration is derived from raw controls; full crossed schedule coverage gates safety qualification and Pareto reporting; partial smoke remains descriptive; paired repair deltas preserve no-op/review status.
- declared output schemas are required, compiled, and applied to every stage payload; deletion and schema-drift mutants prevent the machine-readable prompt contract from silently diverging from scorer behavior.

## Privacy review boundary

All public material is rewritten synthetic prose. The fixture uses no real name, precise location, contact detail, exact personal price or income, source conversation ID, private excerpt, or private-derived hash. The structural validator rejects identifier-shaped fields, contact/URL patterns, exact currency amounts, coordinates, private-source fields, and private-derived-hash fields.

The committed tests intentionally do not contain a forbidden list built from private wording. Before commit, run an ephemeral literal search for the private identifier and source conversation ID and retain only the zero/nonzero outcome, never the private text or a derived hash.

## Exact remaining owner decisions

No owner decision remains before the frozen four-fixture smoke. The owner has resolved the execution surface, models, grading roles, repeat/fixture boundary, optional Pro route, and no-spend/no-adoption rules. The next owner decision occurs only after prompts, outputs, scores, findings, and grader/adjudication records are frozen: whether evidence warrants a full-corpus run, whether `Latest` materially changes eventual-runtime assumptions, and eventually whether any architecture should be adopted. The harness cannot decide or implement those choices.

## Next safe action

Freeze the current containing commit and artifact hashes, create the private ignored run manifest, calibrate both fresh Sol Extra High grading passes, and run the one-repeat four-fixture ChatGPT smoke under the 100-submission ceiling. Freeze and grade before unblinding. Do not run a full corpus, select or implement an architecture, infer the backend behind `Latest`, merge, deploy, install, or advance `stable`.
