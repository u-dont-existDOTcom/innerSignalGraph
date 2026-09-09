# Audit-architecture experiment protocol

Status: deterministic design extended on 2026-09-09 with the owner-authorized threat-pathway rubric and synthetic regressions. That semantic change invalidates every earlier prompt freeze and calibration for future execution. It requires a new frozen run and complete recalibration before any new smoke; freeze the new effective prompts, repeat all grader controls, and include the threat-pathway fixtures under a newly preregistered run. Provider/API/OpenRouter calls remain prohibited and zero; this implementation performs no subscription ChatGPT evaluation.

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
3. **Finding validator:** each fresh grading pass receives the case, grader-only target, taxonomy, a deterministic sentence-segment map, and a randomized set of opaque frozen `{draft, findings}` bundles. Exact duplicate bundles are included once and their grade is reused by content identity. It sees no seed labels or arm identity and emits only `SUPPORTED`, `UNSUPPORTED`, or `UNRESOLVED`, with one to three stable source-segment IDs or a criterion-specific stable target-omission ID. The gating JSON contains no quotation or explanation. Deterministic validation proves that every segment exists and that quoted-finding evidence overlaps the proposed source passage; semantic relevance remains a calibrated grader/adjudicator judgment. Only after this judgment freezes does the scorer privately classify a supported error as seeded or unseeded.
4. **Initial-response graders:** independently judge every error class and dimension on the original draft. This exhaustive baseline prevents a pre-existing unseeded defect from being mislabeled as repair regression.
5. **Final-response graders:** independently judge every error class and dimension on the final answer. Initial and final graders receive case, target, taxonomy, a deterministic sentence-segment map, and one answer only—not arm, findings, seed truth, reference wording, rationale, or prior verdicts. Each score-bearing judgment carries only its verdict or rating and one to three stable source-segment IDs or a criterion-specific target-omission ID.
6. **Adjudicator:** a third fresh `GPT-5.6 Sol` / `Extra High` context reviews material disagreements, uncertainty, truth-manifest conflict, or a substantive Pro-only dissent only after raw grades freeze. It receives neither architecture/model arm identity nor the provenance of the dissent. Raw grades remain preserved; adjudication cannot silently convert a blocker into a pass. Any truth/rubric amendment versions the fixture and requires rerun.

Use both frozen fresh graders. Each grader pass uses three separately opened, role-pure batch submissions: finding validation, initial-response grading, and final-response grading. Never mix those roles in one context. Within a role, exact duplicate input bytes are represented once, opaque item order is randomized independently for each pass, and the response schema requires every opaque item exactly once. Each projected logical grade retains a unique item call ID plus the shared physical submission ID and SHA-256 of the complete raw batch output. Fresh context using the same model is context separation, not provider or organizational independence. E is explicitly anchored self-review. The behavioral target is a reference and grading rubric, not objective proof of the uniquely best therapeutic answer.

Every grader reply uses an explicit envelope. Only JSON between `BEGIN_GATING_JSON` and `END_GATING_JSON` is parsed. That JSON contains constrained IDs, enum verdicts, and numeric ratings only. Prose is permitted only after the closing marker and is archived exactly with the full raw reply for human inspection, but it is non-gating: it cannot change admission, evidence validation, scoring, or calibration, and the scorer rejects it if it is attached to a score record. The parser performs no cleanup or repair. Missing or duplicate markers, prose before the opening marker, invalid JSON between the markers, an extra score-bearing field, or a schema-invalid ID remains `STRUCTURED_OUTPUT_SYNTAX_FAILURE` and stops the dependent path.

## Calibration gate

Finding-validator and final-response-grader controls are distinct. Finding controls have exact expected support verdicts. Final `ACCEPT` controls are complete good answers and require all error classes absent plus minimum dimension ratings; `REJECT` controls require the listed errors present and specified weak dimensions below maximum bounds while still eliciting exhaustive grades. The gate is derived from admitted verdicts, ratings, stable evidence IDs, and call records—there is no caller-supplied pass flag. Every control for a role must pass. `validateCalibrationResult` blocks aggregation on a failed, partial, duplicate, or missing control set. Historical controls do not carry forward: the new contract must pass all six controls in a new run.

## Execution and blinding

1. Run deterministic preflight; record candidate head, visible selector labels, observation timestamp, private output path, submission ceiling, and no-fallback policy.
2. Select a private seed and repeat count. `buildBlindedSchedule` randomizes `{draft, condition, repeat}` and creates opaque run IDs. The grader queue exposes only `{runId, order}`; the private codebook maps each run to `{draftId, conditionId, repeatId}` plus C's execution-only critic permutation. The controller resolves the case/answer payload without exposing those fields.
3. For every C run, use its separately seeded permutation of C1/C2/C3 bundles before synthesis.
4. For every audit stage, retain its raw output as canonical JSON bytes beside the declared output-schema ID and a SHA-256 recomputed from those bytes. The scorer parses and schema-validates those bytes, then derives the scored findings, action, and final response from the topology-specific source output; independently asserted summary fields cannot substitute for stage content. For B, run B1–B3 once per draft/repeat, freeze those exact content-bound outputs plus finding validation, initial grades, and an opaque `repairPairId`, then fork that same state to patch and reconstruct. The scorer rejects absent/mismatched pairs, calls, grades, bytes, hashes, draft IDs, or repeat IDs.
5. Enforce condition actions: N=`KEEP`; A=`KEEP|RECONSTRUCT`; B patch=`KEEP|PATCH`; B reconstruct/C/D=`KEEP|RECONSTRUCT`; E=`KEEP|PATCH`. `KEEP` means byte-identical output and an empty finding set. N also requires zero calls and zero critical-path time.
6. Early stop after a clean complete audit: B and C use three critic passes, D one, and E may stop after its first clean critique. The scorer proves that stop from the parsed empty stage outputs. A remains one integrated pass. A nonempty B3 set or initial C/D/E critic set requires the topology's next reconstruction/patch pass; E must then run its second critique and may stop there only if clean. C4 or D2 may reconcile findings away and return controller-preserved `KEEP`, but cannot introduce an error class absent from every upstream critic.
7. Preserve every output/failure. Do not select best samples or erase a violation because a later iteration improves.
8. Freeze support judgments and raw initial/final grades, reconcile only review-required records, then unblind and score. Reused logical call IDs must bind identical call metadata and identical raw grade output. Batch projections use distinct logical item IDs, while their shared physical submission ID, raw-output hash, timing, and token metadata must agree exactly.
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
- role-separated batch-grade manifests with randomized opaque item order, exact-byte deduplication maps, unique logical item IDs, and shared physical-submission/output-hash bindings;
- the exact `AE-GRADER-SEGMENT-EVIDENCE-V2` contract, deterministic segment maps, envelope parser identity, raw-output hashes, admitted gating-JSON hashes, and separately archived non-gating rationale;
- successful full calibration for every grading role;
- frozen candidate commit, artifact hashes, and private seed commitment.

Provider/API calls are not authorized and must remain zero. ChatGPT subscription runs are authorized only after this gate passes.

## Cost and latency

Per draft/repeat, A–D with both B repair modes use 12 audit/repair submissions when repairs are needed: A=1; shared B specialists plus two repair calls=5; C=4; D=2. N adds no call. Clean termination can reduce B/C/D repair calls. Optional E adds at most four calls. The four-fixture architecture smoke therefore has a 64-stage-submission ceiling before grading; the model comparison adds at most four new `Latest` A submissions because the Sol A outputs are reused.

The smoke uses one role-pure batch submission per grader pass for each of finding validation, initial grading, and final grading. With `G` final-grader passes, `I` initial-grader passes, and `H` finding-validator passes, the planned physical-submission upper bound is:

`architecture-stage ceiling + Latest comparator calls + G + I + H + calibration calls`

For the new run that is `64 + 4 + 2 + 2 + 2 + 6 = 80`, leaving 20 submissions within the run. The 16 preserved submissions from stopped and superseded attempts make the cumulative ceiling `96`, leaving four before the owner-review boundary. If a role-pure batch cannot complete in one submission, freeze the failure and stop rather than silently fragmenting the batch or consuming the reserve. Initial grades are reused across arms only when their exact input bytes agree. The same applies to B's shared finding validation and any exact duplicate final response. Every audit submission retains its schema ID, canonical output bytes, and recomputed content hash. Every physical submission records a unique submission ID, stage ID, elapsed time, and serial/parallel wave; every projected batch item also has a unique logical call ID and the complete batch-output hash. Record token counts as `null` when ChatGPT does not expose them; never estimate them as measured values. Aggregation deduplicates by physical submission ID, rejects inconsistent projection metadata, reports audit and evaluation submissions separately, includes calibration/identity submissions in total cost, reports B paired marginal audit and total submissions, and derives audit critical-path time from recorded waves whenever timings are complete. C is four audit calls but two latency waves only under actual parallel execution.

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
