# Audit-architecture experiment protocol

Status: frozen deterministic design plus owner-authorized ChatGPT-UI smoke plan. The smoke has not run yet. Provider/API/OpenRouter calls remain prohibited and zero; subscription ChatGPT conversations are authorized only through the bounded plan in `execution-plan.json`.

## Purpose

Compare audit architectures A–D, optional anchored self-review E, and zero-call no-audit baseline N on identical synthetic inputs. Measure detection and repair without rewarding unsupported alarm, regression, over-audit, or verbosity. This is an evaluation harness, not therapy policy or clinical evidence.

## Owner-frozen execution boundary

- Codex or Mission Control opens and controls ordinary ChatGPT conversations/tabs. No API key, provider SDK, OpenRouter route, or paid per-call provider path may be used.
- Candidate generation and every A–E audit stage use the visible selector label `GPT-5.6 Sol` with visible effort `Extra High`.
- Primary semantic evaluation is the deterministic scorer plus exactly two separately opened fresh-context, architecture-blind `GPT-5.6 Sol` / `Extra High` grading passes. GPT-5.6 Pro is not a primary grader.
- The visible selector inventory was observed at `2026-09-08T10:31:09Z`: `Latest`, `GPT-5.6 Sol`, and `GPT-5.5`. This is UI evidence only. The backend behind `Latest` is unknown and must remain `null` in the records.
- Stop before 100 ChatGPT submissions and return to the owner if the frozen smoke, calibration, grading, or bounded adjudication cannot complete within that ceiling. Reduce repetitions before reducing the four-fixture coverage.
- Freeze prompts, cases, drafts, raw stage outputs, grades, scores, and audit findings in the private ignored run root before unblinding. No result selects an architecture or changes runtime behavior without owner review.

## Frozen artifacts and information firewall

- `cases.json`: fictional chronology, evidence-bound facts, and settled history;
- `drafts.json`: eight multi-error drafts and two neutrally named good controls;
- `reference-target.json`: stable-ID behavioral requirements/prohibitions and a grader-only reference;
- `rubric.json`: generic error taxonomy, severity, and behavioral dimensions;
- `architectures.json`: runtime-like A–E prompts and context boundaries, without the case-specific target/open-question key;
- `grader-controls.json`: separate finding-validator and full-response-grader controls;
- `score.mjs`: privacy/schema checks, repeat-aware blinding, contract enforcement, and deterministic scoring.

Before ChatGPT execution, freeze the candidate Git commit and SHA-256 of every artifact above plus `execution-plan.json` in a private run manifest. Changed inputs require a new version. Auditors and repairers receive only the synthetic case, settled history, draft when their condition allows it, generic taxonomy, and prior findings their topology permits. They never receive `seededErrorIds`, case-specific target requirements, the open-question key, sample answer, producer rationale, prior grader verdicts, or architecture labels.

## Roles and frozen judgments

1. **Draft source:** use each committed synthetic draft. A later end-to-end extension may generate a primary answer once, freeze exact bytes, and copy it to every arm.
2. **Audit stages:** follow `architectures.json`; every `freshContext` stage starts without prior rationale. C critics receive identical inputs and none of one another's output.
3. **Finding validator:** each fresh grading pass receives the case, draft, grader-only target, taxonomy, and one frozen finding bundle under an opaque run ID. It sees no seed labels or arm identity and emits only `SUPPORTED`, `UNSUPPORTED`, or `UNRESOLVED`, with a reason and exact draft quote or criterion-specific stable target-omission ID. Deterministic validation proves that a quote is present and overlaps a quoted finding; its semantic relevance remains a calibrated grader/adjudicator judgment. Only after this judgment freezes does the scorer privately classify a supported error as seeded or unseeded.
4. **Initial-response graders:** independently judge every error class and dimension on the original draft. This exhaustive baseline prevents a pre-existing unseeded defect from being mislabeled as repair regression.
5. **Final-response graders:** independently judge every error class and dimension on the final answer. Initial and final graders receive case, target, taxonomy, and one answer only—not arm, findings, seed truth, reference wording, rationale, or prior verdicts. Each judgment carries a nonempty reason and exact answer quote or stable target-omission ID.
6. **Adjudicator:** a third fresh `GPT-5.6 Sol` / `Extra High` context reviews material disagreements, uncertainty, truth-manifest conflict, or a substantive Pro-only dissent only after raw grades freeze. It receives neither architecture/model arm identity nor the provenance of the dissent. Raw grades remain preserved; adjudication cannot silently convert a blocker into a pass. Any truth/rubric amendment versions the fixture and requires rerun.

Use both frozen fresh graders. Fresh context using the same model is context separation, not provider or organizational independence. E is explicitly anchored self-review. The behavioral target is a reference and grading rubric, not objective proof of the uniquely best therapeutic answer.

## Calibration gate

Finding-validator and final-response-grader controls are distinct. Finding controls have exact expected support verdicts. Final `ACCEPT` controls are complete good answers and require all error classes absent plus minimum dimension ratings; `REJECT` controls require the listed errors present and specified weak dimensions below maximum bounds while still eliciting exhaustive grades. The gate is derived from raw control verdicts, reasons, evidence, dimensions, and call records—there is no caller-supplied pass flag. Every control for a role must pass. `validateCalibrationResult` blocks aggregation on a failed, partial, duplicate, or missing control set.

## Execution and blinding

1. Run deterministic preflight; record candidate head, visible selector labels, observation timestamp, private output path, submission ceiling, and no-fallback policy.
2. Select a private seed and repeat count. `buildBlindedSchedule` randomizes `{draft, condition, repeat}` and creates opaque run IDs. The grader queue exposes only `{runId, order}`; the private codebook maps each run to `{draftId, conditionId, repeatId}` plus C's execution-only critic permutation. The controller resolves the case/answer payload without exposing those fields.
3. For every C run, use its separately seeded permutation of C1/C2/C3 bundles before synthesis.
4. For every audit stage, retain its raw output as canonical JSON bytes beside the declared output-schema ID and a SHA-256 recomputed from those bytes. The scorer parses and schema-validates those bytes, then derives the scored findings, action, and final response from the topology-specific source output; independently asserted summary fields cannot substitute for stage content. For B, run B1–B3 once per draft/repeat, freeze those exact content-bound outputs plus finding validation, initial grades, and an opaque `repairPairId`, then fork that same state to patch and reconstruct. The scorer rejects absent/mismatched pairs, calls, grades, bytes, hashes, draft IDs, or repeat IDs.
5. Enforce condition actions: N=`KEEP`; A=`KEEP|RECONSTRUCT`; B patch=`KEEP|PATCH`; B reconstruct/C/D=`KEEP|RECONSTRUCT`; E=`KEEP|PATCH`. `KEEP` means byte-identical output and an empty finding set. N also requires zero calls and zero critical-path time.
6. Early stop after a clean complete audit: B and C use three critic passes, D one, and E may stop after its first clean critique. The scorer proves that stop from the parsed empty stage outputs. A remains one integrated pass. A nonempty B3 set or initial C/D/E critic set requires the topology's next reconstruction/patch pass; E must then run its second critique and may stop there only if clean. C4 or D2 may reconcile findings away and return controller-preserved `KEEP`, but cannot introduce an error class absent from every upstream critic.
7. Preserve every output/failure. Do not select best samples or erase a violation because a later iteration improves.
8. Freeze support judgments and raw initial/final grades, reconcile only review-required records, then unblind and score. Reused call IDs must bind identical call metadata and identical raw grade output.
9. The initial `SMOKE` is the exact one-repeat cross of drafts `AE-D004`, `AE-D005`, `AE-D007`, and good-response control `AE-D010` with N, A, both B repair modes, C, D, and E. It remains descriptive: it cannot select a winner, qualify runtime use, or emit a full-corpus Pareto claim. It may prune only a clearly inferior arm under every condition in `execution-plan.json`; otherwise preserve the arm for the full corpus. `FULL` comparison requires exact coverage of every frozen draft crossed with A–D, both B repair arms, N, every declared repeat, and optionally E. Any missing, duplicate, extra, or swapped cell blocks comparison.

## Separate small model comparison

Use `A_INTEGRATED` as a frozen one-pass instrument on the same four smoke fixtures. Run it once with visible `GPT-5.6 Sol` / `Extra High` and once with visible `Latest` / `Extra High`, keeping every other prompt and input byte identical. Reuse the Sol A outputs from the main smoke, randomize both model arms into opaque IDs, and grade them with the same deterministic plus two fresh Sol Extra High procedure. Preserve the raw outputs for owner comparison.

The label `Latest` is the entire identity claim unless the UI directly exposes more. If it shows no meaningful advantage, stop the model comparison. If it clearly wins or behaves materially differently, freeze and flag that result before assuming an eventual runtime model. This comparison does not identify a backend and is not an architecture-selection vote.

## Optional Pro dissent

Pro may be used only as a dissenting specialist for information gain, wrong-path persistence, missed alternative hypotheses, or subtle interaction failures. Its findings stay separate from primary scores. A material Pro-only finding goes to a new architecture-blind, provenance-blind Sol Extra High adjudication context; it is not counted merely because Pro raised it. If the visible selector does not directly offer the intended Pro label, skip this optional role.

## ChatGPT execution gate

Do not submit a ChatGPT prompt until all are recorded:

- visible responder/auditor, validator, grader, and adjudicator selector labels plus visible reasoning-effort labels and observation time;
- the exact ChatGPT conversation/tab orchestration surface and no-fallback rule;
- private ignored output location;
- one repeat and the exact four-fixture smoke subset;
- the 100-submission ceiling and a zero provider/API/OpenRouter-call assertion;
- lock/resume handling so an ambiguous possibly charged call is never silently repeated;
- successful full calibration for every grading role;
- frozen candidate commit, artifact hashes, and private seed commitment.

Provider/API calls are not authorized and must remain zero. ChatGPT subscription runs are authorized only after this gate passes.

## Cost and latency

Per draft/repeat, A–D with both B repair modes use 12 audit/repair submissions when repairs are needed: A=1; shared B specialists plus two repair calls=5; C=4; D=2. N adds no call. Clean termination can reduce B/C/D repair calls. Optional E adds at most four calls. The four-fixture architecture smoke therefore has a 64-stage-submission ceiling before grading; the model comparison adds at most four new `Latest` A submissions because the Sol A outputs are reused.

With `G` final graders, `I` initial graders, and `H` finding validators, the abstract upper-bound planning formula for A–D plus N remains:

`repeats × drafts × (12 + 6G + I + 4H) + identity probes + calibration calls`

If initial grades are reused across arms, their exact shared call IDs and raw grade bytes must agree and are counted once. The same applies to B's shared finding validation. Every audit submission also retains its schema ID, canonical output bytes, and recomputed content hash. Every audit, grader, validator, calibration, selector-observation, and adjudication submission records a unique call ID, stage ID, elapsed time, and serial/parallel wave. Record token counts as `null` when ChatGPT does not expose them; never estimate them as measured values. Aggregation deduplicates identical call IDs, rejects inconsistent reuse, reports audit and evaluation calls separately, includes calibration/identity calls in total cost, reports B paired marginal audit and total calls, and derives audit critical-path time from recorded waves whenever timings are complete. C is four audit calls but two latency waves only under actual parallel execution.

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
