# Audit-architecture evaluation integration — 2026-09-07

Status: deterministic harness and owner-frozen ChatGPT-UI smoke plan implemented on draft PR #46. On 2026-09-09 the rubric, stable target map, stage prompts, and synthetic fixture set gained an owner-authorized threat-pathway extension. This is a semantic instrument change: all earlier freezes and calibration evidence remain historical but are invalid for a future run. No new provider or subscription-ChatGPT evaluation was performed, no winning architecture was selected, and runtime adoption remains unauthorized.

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
- Superseded frozen-run submissions: 2. `AE-FVC01` passed. `AE-FVC02` chose the expected `UNSUPPORTED` direction but emitted invalid JSON because its free-text reason contained unescaped quotation marks. The raw output remains frozen and was not repaired or retried in that run.
- Replacement frozen-run submissions: 6, all through the visible ChatGPT `GPT-5.6 Sol` / `Extra High` selector. All six passed the strict machine envelope and schema. `AE-FVC01`, `AE-FVC02`, `AE-FGC03`, and `AE-FGC04` passed their semantic controls; `AE-FGC01` and `AE-FGC02` failed. Total ChatGPT submissions across all attempts: 22; provider/API/OpenRouter calls: 0.
- Real client records or transcript text: 0

Active lesson contract for this repair:

- `structured-output-failure-boundary`: preserve the stopped raw artifact and parser evidence; classify it as serialization rather than semantic failure; do not repair or retry it; mechanically block dependent scoring.
- `external-evaluation-reproducibility`: historical control outcomes remain evidence history; freeze the new contract/input hashes and repeat all six controls under the current path.
- `independent-evaluation-separation`: stable evidence IDs and non-gating rationale must not reveal architecture/model identity, producer rationale, seed truth, or other grades.
- `test-efficiency-and-verification-budget`: use measured focused tests during repair and one complete package/publication checkpoint at the final containing commit; avoid unchanged-state full reruns.
- owner correction: decision handoffs must state benefits, risks, strongest alternative, reversibility, cost, and no-decision consequence; the approved option is implemented exactly rather than re-decided locally.

Pre-implementation admission: `PASS`. Enforcement is mechanical for schema, parser, privacy, budget, and no-repair invariants; semantic independence remains owner/evaluator reviewed. The current universal guidance source is `u-dont-existDOTcom/universal-dev-architecture@e7427e730988b8ed16664385f4d43fc625737ce9`.

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
- `grader-controls.json`: versioned finding-validator and complete-response grader controls with exact/subset semantics; every proposed quote now binds an actual source passage so support is a semantic judgment rather than an existence check.
- `execution-plan.json`: owner-frozen no-API execution boundary, four-fixture smoke, two fresh Sol Extra High graders, role-separated blinded batch grading, a derived 80-submission successful-run ceiling, conservative pruning rule, selector-label evidence, `Latest` comparison, optional Pro dissent route, and owner-review/no-adoption gate.
- `grading-contract.mjs`: deterministic source segmentation, exact gating markers, strict JSON-schema admission, full raw-output preservation, raw/gating hashes, and byte-preserved post-marker rationale extraction with no repair path.
- `packets.mjs`: deterministic audit, finding-validation, and complete-response grading packets that enforce case-target and architecture/model firewalls for ChatGPT conversations. Grader and validator packets expose stable source segments and criterion-bound omission IDs; their gating JSON schemas contain no quotations or explanations.
- `score.mjs`: structural privacy checks, repeat-aware opaque scheduling, segment/target-bound grader evidence, schema-validated canonical audit-output bytes with recomputed content hashes, topology-derived findings/actions/responses, raw evidence-bearing grades, hidden-truth scoring, early-stop enforcement, content-bound B pairing, pooled/macro metrics, logical-grade versus physical-submission accounting, safety qualification, Pareto reporting, paired repair comparisons, and perpetual `winner: null`.
- `score.test.mjs`: deterministic and mutant tests for coverage, privacy, answer-key withholding, repetitions, C ordering, record swaps, exact topology, canonical-output substitution and false-clean-stop rejection, criterion-bound evidence, severity, hidden seed derivation, pre-existing error versus regression, raw disagreement, duplicate findings, no-op termination, B byte/hash identity, schedule completeness, reused-grade identity, physical batch-cost deduplication, derived calibration, execution-plan drift, packet firewalls, and comparison behavior.
- `PROTOCOL.md`: ChatGPT-UI smoke protocol, role separation, submission/cost formula, selector-label gate, small model comparison, optional Pro adjudication, claims, and non-effects.

`CHANGED-PATHS.txt` is the exact intended task delta relative to the fetched baseline. The containing commit and hosted check identities belong in Git/PR evidence because a commit cannot embed its own final hash.

## Deterministic evidence

Focused test after independent-review repairs:

`/home/joel/.nvm/versions/node/v24.18.0/bin/node --test --test-isolation=none tasks/audit-architecture-eval-20260907/score.test.mjs`

Latest combined focused result: 43/43 passing on pinned Node 24.18.0 across the scoring harness, audit supplement, and public longitudinal-policy tests. The strengthened suite also rejects API/provider activation, inferred `Latest` identity, anchored/non-blind graders, missing good-control coverage, direct Pro verdicts, automatic adoption, and audit/grader packet leakage. Earlier repairs covered control length, stage-name/setup drift, criterion-map shadowing, late no-op topology, schedule completeness, shared-call identity, grade-call cost identity, and raw audit-output provenance.

After the longitudinal supplement landed, the pre-repair combined focused harness suite passed 41/41 on pinned Node 24.18.0. Earlier preflights exposed and repaired a grader evidence-schema mismatch and a same-error-class negative-control ambiguity. Role-separated batch packets and content-bound physical-submission accounting make the complete two-pass evaluation fit the ceiling without dropping fixtures: `64` architecture stages + `4` Latest calls + `6` calibration calls + `6` batch-grade/validator calls = `80`.

The approved smaller gating contract then passed structural admission on all six replacement controls. The two finding-validator controls and two deliberately bad response controls behaved as expected. Both nominal good-response controls failed the preregistered semantic gate. `AE-FGC01` was judged temporally myopic and insufficiently explicit about the mixed trajectory and method benefit. `AE-FGC02` was judged to invent a “fake part,” speak partly to prior assistant process, omit delayed monitoring and current-risk handling, and under-preserve method benefit. Whether every finding is ultimately retained is not decided here; the calibration result is sufficient to prove that the current ACCEPT controls and acceptance contract do not agree. The deterministic validator stopped at `AE-FGC01`, architecture and `Latest` submissions remained zero, the schedule stayed sealed, and `winner` remained null. With 22 total ChatGPT submissions across all attempts, 78 remain below the owner-review ceiling.

Before the live calibration result note, the complete pinned Node 24.18.0 package gate passed 994/994. A second full run at the exact frozen instrument commit passed 993/994 and failed only the unrelated timing-sensitive GitHub diagnostic-sync case that expected three incidents but observed two; that exact isolated case immediately passed 1/1. This flake is retained as evidence, not silently waived. The task harness, publication audit, and privacy checks passed, and the post-calibration public delta is documentation only. An earlier Node 26 run was discarded because runtime-version-dependent tests failed; it is not counted as verification evidence.

Pre-refresh pinned-runtime package verification passed, including 948/948 automated tests, 29/29 graph cases, syntax and authoring checks, archive verification, mock replays, web/autopilot smoke checks, package hygiene, and autonomous-development checks. `npm run audit:repository` also passed with zero errors and its pre-existing warning that hosted GitHub App permissions require external verification.

After replaying the task onto refreshed PR parent `48204b1`, the task's 20/20 focused tests remained green, but the integrated package gate exposed one deterministic failure outside this task: 957/958 automated tests passed and `tests/therapy-latency-benchmark.test.mjs` rejected the refreshed runtime's stale `THERAPY_POLICY_FINGERPRINT`; an isolated rerun reproduced 1/2 passing. The concurrent parent changed runtime composition while this task changes only docs/state and `tasks/audit-architecture-eval-20260907/`. This task does not alter or waive that existing gate and does not expand scope to repair the concurrent runtime benchmark.

No semantic model judgment is inferred from these tests. The Git-object publication gate remains necessarily post-commit; final diff and ephemeral privacy review remain required at this checkpoint. The named refreshed-parent package failure remains visible for the concurrent runtime integration owner.

## Independent review and repair

Two read-only reviews separately challenged methodology and repository fit. Their material findings were repaired before final gating:

- blind validators now emit support only; seeded/unseeded status is derived behind the codebook after freeze;
- critics no longer receive the case-specific answer key, and prompt prose matches the formal firewall;
- exhaustive initial and final grades distinguish pre-existing defects from repair regressions and retain raw verdict/rating, stable segment-or-target evidence, separately archived non-gating rationale, and disagreement;
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

The output-contract decision is resolved: the smaller machine-only contract worked structurally on six of six outputs. The next owner decision is semantic, because evidence cannot determine whether the ACCEPT controls are intended to be comprehensive miniature answers or concise focused answers that may legitimately omit non-central dimensions.

Recommended option: revise the two ACCEPT responses so they actually demonstrate the currently preregistered standard, then freeze a new version and repeat all six controls. This preserves a strict, falsifiable gate and directly removes the omissions found here. Its cost is another containing commit and six additional ChatGPT submissions, and the revised controls may become less concise if every rubric dimension is forced into one response. The change is fully reversible and does not affect runtime behavior.

Strongest alternative: narrow the ACCEPT-control contract so a concise good response need not score at least 3 on every dimension or explicitly cover every non-central target. This better tests whether graders avoid checklist inflation and needless rewriting. Its risk is weakening calibration around genuine safety omissions unless the required subset is named before any rerun. This also requires a new frozen version and complete six-control recalibration.

A third option is a preregistered fresh-grader adjudication of the disputed findings before changing either controls or thresholds. It can distinguish a control defect from one grader's over-strictness, but adds calls and cannot be applied retroactively as an unplanned rescue of this failed run. The adjudication rule would need to be frozen in a new version first.

Until the owner selects one of those meanings of “good control,” the consequence of no decision is deliberate stasis: no architecture smoke, no `Latest` comparison, no pruning, no full corpus, and no runtime adoption. After a future calibration passes, the later owner decisions return: whether evidence warrants a full corpus, whether `Latest` changes eventual-runtime assumptions, and whether any architecture should eventually be adopted.

## Next safe action

Preserve the complete failed calibration and its raw outputs without repair. After the owner resolves the ACCEPT-control meaning above, make that choice in a new version, freeze a new containing commit and hashes, and repeat all six controls before any architecture or `Latest` call. Do not resume or reinterpret this failed run, run a full corpus, select or implement an architecture, infer the backend behind `Latest`, merge, deploy, install, or advance `stable`.
