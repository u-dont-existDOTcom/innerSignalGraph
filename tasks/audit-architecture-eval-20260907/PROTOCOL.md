# Audit-architecture experiment protocol

Status: frozen deterministic design, **not run on a provider**. `modelRuns: 0`. This task does not borrow another evaluation's budget.

## Purpose

Compare audit architectures A–D, optional anchored self-review E, and zero-call no-audit baseline N on identical synthetic inputs. Measure detection and repair without rewarding unsupported alarm, regression, over-audit, or verbosity. This is an evaluation harness, not therapy policy or clinical evidence.

## Frozen artifacts and information firewall

- `cases.json`: fictional chronology, evidence-bound facts, and settled history;
- `drafts.json`: eight multi-error drafts and two neutrally named good controls;
- `reference-target.json`: stable-ID behavioral requirements/prohibitions and a grader-only reference;
- `rubric.json`: generic error taxonomy, severity, and behavioral dimensions;
- `architectures.json`: runtime-like A–E prompts and context boundaries, without the case-specific target/open-question key;
- `grader-controls.json`: separate finding-validator and full-response-grader controls;
- `score.mjs`: privacy/schema checks, repeat-aware blinding, contract enforcement, and deterministic scoring.

Before live execution, freeze the candidate Git commit and SHA-256 of every artifact above in a private run manifest. Changed inputs require a new version. Auditors and repairers receive only the synthetic case, settled history, draft when their condition allows it, generic taxonomy, and prior findings their topology permits. They never receive `seededErrorIds`, case-specific target requirements, the open-question key, sample answer, producer rationale, prior grader verdicts, or architecture labels.

## Roles and frozen judgments

1. **Draft source:** use each committed synthetic draft. A later end-to-end extension may generate a primary answer once, freeze exact bytes, and copy it to every arm.
2. **Audit stages:** follow `architectures.json`; every `freshContext` stage starts without prior rationale. C critics receive identical inputs and none of one another's output.
3. **Finding validator:** receives the case, draft, grader-only target, taxonomy, and one frozen finding bundle under an opaque run ID. It sees no seed labels or arm identity and emits only `SUPPORTED`, `UNSUPPORTED`, or `UNRESOLVED`, with a reason and exact draft quote or criterion-specific stable target-omission ID. Deterministic validation proves that a quote is present and overlaps a quoted finding; its semantic relevance remains a calibrated grader/adjudicator judgment. Only after this judgment freezes does the scorer privately classify a supported error as seeded or unseeded.
4. **Initial-response graders:** independently judge every error class and dimension on the original draft. This exhaustive baseline prevents a pre-existing unseeded defect from being mislabeled as repair regression.
5. **Final-response graders:** independently judge every error class and dimension on the final answer. Initial and final graders receive case, target, taxonomy, and one answer only—not arm, findings, seed truth, reference wording, rationale, or prior verdicts. Each judgment carries a nonempty reason and exact answer quote or stable target-omission ID.
6. **Adjudicator:** reviews disagreements, uncertainty, or truth-manifest conflict only after raw grades freeze. Raw grades remain preserved; adjudication cannot silently convert a blocker into a pass. Any truth/rubric amendment versions the fixture and requires rerun.

Use at least one fresh grader; prefer two separately called calibrated graders. Fresh context using the same model is context separation, not provider or organizational independence. E is explicitly anchored self-review.

## Calibration gate

Finding-validator and final-response-grader controls are distinct. Finding controls have exact expected support verdicts. Final `ACCEPT` controls are complete good answers and require all error classes absent plus minimum dimension ratings; `REJECT` controls require the listed errors present and specified weak dimensions below maximum bounds while still eliciting exhaustive grades. The gate is derived from raw control verdicts, reasons, evidence, dimensions, and call records—there is no caller-supplied pass flag. Every control for a role must pass. `validateCalibrationResult` blocks aggregation on a failed, partial, duplicate, or missing control set.

## Execution and blinding

1. Run deterministic preflight; record candidate head, exact identities/configuration, private output path, and no-fallback policy.
2. Select a private seed and repeat count. `buildBlindedSchedule` randomizes `{draft, condition, repeat}` and creates opaque run IDs. The grader queue exposes only `{runId, order}`; the private codebook maps each run to `{draftId, conditionId, repeatId}` plus C's execution-only critic permutation. The controller resolves the case/answer payload without exposing those fields.
3. For every C run, use its separately seeded permutation of C1/C2/C3 bundles before synthesis.
4. For every audit stage, retain its raw output as canonical JSON bytes beside the declared output-schema ID and a SHA-256 recomputed from those bytes. The scorer parses and schema-validates those bytes, then derives the scored findings, action, and final response from the topology-specific source output; independently asserted summary fields cannot substitute for stage content. For B, run B1–B3 once per draft/repeat, freeze those exact content-bound outputs plus finding validation, initial grades, and an opaque `repairPairId`, then fork that same state to patch and reconstruct. The scorer rejects absent/mismatched pairs, calls, grades, bytes, hashes, draft IDs, or repeat IDs.
5. Enforce condition actions: N=`KEEP`; A=`KEEP|RECONSTRUCT`; B patch=`KEEP|PATCH`; B reconstruct/C/D=`KEEP|RECONSTRUCT`; E=`KEEP|PATCH`. `KEEP` means byte-identical output and an empty finding set. N also requires zero calls and zero critical-path time.
6. Early stop after a clean complete audit: B and C use three critic passes, D one, and E may stop after its first clean critique. The scorer proves that stop from the parsed empty stage outputs. A remains one integrated pass. A nonempty B3 set or initial C/D/E critic set requires the topology's next reconstruction/patch pass; E must then run its second critique and may stop there only if clean. C4 or D2 may reconcile findings away and return controller-preserved `KEEP`, but cannot introduce an error class absent from every upstream critic.
7. Preserve every output/failure. Do not select best samples or erase a violation because a later iteration improves.
8. Freeze support judgments and raw initial/final grades, reconcile only review-required records, then unblind and score. Reused call IDs must bind identical call metadata and identical raw grade output.
9. `FULL` comparison requires exact coverage of every frozen draft crossed with A–D, both B repair arms, N, every declared repeat, and optionally E. Any missing, duplicate, extra, or swapped cell blocks comparison. A declared `SMOKE` may use a smaller complete crossed schedule, but remains `INCOMPLETE_DESCRIPTIVE_ONLY`: it cannot qualify an arm or emit a Pareto frontier.

## Live-model gate

Do not make provider calls until all are recorded:

- exact executable responder/auditor, validator, grader, and adjudicator model IDs;
- exact provider route, API-returned identity expectation, GPT-5.6 Sol xhigh reasoning for audit stages, output limit, and no fallback;
- provider retention acknowledgement and private output location;
- repeats and exact smoke/full subset;
- strict maximum calls, input tokens, output tokens, and paid/subscription spend;
- lock/resume handling so an ambiguous possibly charged call is never silently repeated;
- successful full calibration for every grading role;
- frozen candidate commit, artifact hashes, and private seed commitment.

No current authority supplies this budget. Provider calls therefore remain zero.

## Cost and latency

Per draft/repeat, A–D with both B repair modes use 12 audit/repair calls when repairs are needed: A=1; shared B specialists plus two repair calls=5; C=4; D=2. N adds no call. Clean termination can reduce B/C/D repair calls. Optional E adds at most four calls.

With `G` final graders, `I` initial graders, and `H` finding validators, the upper-bound planning formula for A–D plus N is:

`repeats × drafts × (12 + 6G + I + 4H) + identity probes + calibration calls`

If initial grades are reused across arms, their exact shared call IDs and raw grade bytes must agree and are counted once. The same applies to B's shared finding validation. Every audit call also retains its schema ID, canonical output bytes, and recomputed content hash. Every audit, grader, validator, calibration, and identity call records a unique call ID, stage ID, tokens, elapsed time, and serial/parallel wave. Aggregation deduplicates identical call IDs, rejects inconsistent reuse, reports audit and evaluation calls separately, includes calibration/identity calls in total cost, reports B paired marginal audit and total calls, and derives audit critical-path time from recorded waves whenever timings are complete. C is four audit calls but two latency waves only under actual parallel execution.

## Scoring and comparison

- Detection: macro per-draft weighted recall, pooled severity-weighted recall, and pooled unweighted seed recall.
- Findings: class-level support precision/false-positive rate; duplicate same-class findings are rejected; unresolved findings stay visible.
- Repair: macro and pooled weighted seed removal plus detection-to-repair conversion.
- Regression: only exhaustive initial `ABSENT →` final `PRESENT`; initial uncertainty or unseeded presence is truth review, not regression.
- Quality: raw and mean 0–4 dimensions, good-control exact no-op and clean-audit termination, word inflation, and rewrite distance.
- Safety: missed HIGH seeds, HIGH residual/uncertainty, HIGH regression, and current/historical ambiguity stay separate.
- Cost: unique calls/tokens, standalone arm cost, B paired marginal cost, and critical path.

A condition is safety-qualified only with no review-required run, no missed/residual/introduced HIGH error, and perfect good-control no-op. Among qualified conditions, the scorer reports the Pareto frontier by maximizing pooled detection, pooled repair, finding precision, good-control preservation, and mean behavioral quality while minimizing regression, calls, and inflation. B patch/reconstruct pairs additionally report dominance, tie, or trade-off per draft/repeat. No scalar winner is selected and `winner` remains `null`.

## Claims and non-effects

A live run could support only: this exact model/prompt/configuration produced these results on this exact synthetic fixture. It cannot establish diagnosis, a safe dose, treatment effect, clinical efficacy, universal audit superiority, or suitability for a real client. No score changes the therapy map, guide, runtime, provider policy, PR status, deployment, or `stable` automatically.
