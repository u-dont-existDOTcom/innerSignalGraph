# A001 scaffold ablation report

Status: diagnostic experiment only. No production therapy behavior, guide, graph, prompt, installed runtime, `main`, or `stable` was changed.

## Exact environment

- Experiment source: `f381c08e6892e0cd7f2ba5a8f8fba8447354fef9`
- Protected `origin/main`: `a22f2e611fab778bf26b8e7215afbf85aba4ba5e`
- Protected `origin/stable`: `110ee5342e27d8f1bd3d11cc2be4d85926c255b1`
- Installed runtime: `0.15.2` at `110ee5342e27d8f1bd3d11cc2be4d85926c255b1`
- Models requested and live-probed: `claude-sonnet-4-6`, `claude-opus-5`, `gpt-5.6-sol`
- Effective guide/graph: `inner-child-somatic-pilot-2026-08-09-r5` / `inner-child-somatic-pilot-2026-08-09-r5`
- Marked r02 candidate state: `BLOCKED_AUTO_RECOVERY`; it was not installed and was not used as active guide content.

## Blinded pairwise preference

Primary result is pairwise preference; diagnostic scores are separate. Calls include both judges and both left/right orders.

| Contrast | Calls | Wins | Ties | Order-consistent pairs | Order disagreements |
|---|---:|---|---:|---:|---:|
| A-B | 12 | A: 7, B: 5 | 0 | 3 | 3 |
| A-C | 12 | C: 8, A: 4 | 0 | 4 | 2 |
| A-D | 12 | D: 9, A: 3 | 0 | 5 | 1 |
| B-D | 12 | D: 6, B: 6 | 0 | 4 | 2 |
| D-E | 12 | D: 8, E: 4 | 0 | 4 | 2 |
| A-E | 12 | A: 7, E: 5 | 0 | 1 | 5 |

The clearest comparison is A–D: D won 9–3, with five of six judge/replicate pairs stable under left/right reversal. A–B was 7–5 for A, so replacing Sonnet with Opus inside the unchanged hard scaffold did not improve the baseline. A–E had five of six order disagreements and is not interpretable as a stable preference.

### Preference by judge

| Contrast | Judge | Calls | Wins |
|---|---|---:|---|
| A-B | codex | 6 | A: 5, B: 1 |
| A-B | opus | 6 | A: 2, B: 4 |
| A-C | codex | 6 | C: 5, A: 1 |
| A-C | opus | 6 | A: 3, C: 3 |
| A-D | codex | 6 | D: 6 |
| A-D | opus | 6 | D: 3, A: 3 |
| B-D | codex | 6 | D: 4, B: 2 |
| B-D | opus | 6 | D: 2, B: 4 |
| D-E | codex | 6 | D: 5, E: 1 |
| D-E | opus | 6 | D: 3, E: 3 |
| A-E | codex | 6 | A: 3, E: 3 |
| A-E | opus | 6 | A: 4, E: 2 |

Judge disagreement is material: Sol preferred D over A 6–0, while Opus split A–D 3–3. The aggregate A–D result is therefore evidence for the ordering hypothesis, but not evaluator-independent unanimity.

### Hard-failure gate

| Condition | Presentations | Presentations with hard failure | Total hard failures | Wins while hard-failed |
|---|---:|---:|---:|---:|
| A | 48 | 0 | 0 | 0 |
| B | 24 | 0 | 0 | 0 |
| C | 12 | 0 | 0 | 0 |
| D | 36 | 0 | 0 | 0 |
| E | 24 | 6 | 6 | 0 |

E received six hard-failure flags and never won a presentation in which it was hard-failed. Those presentations were not allowed to hide inside an average score.

## Deterministic A001 contract

Contract compliance is a secondary gate. A PASS can coexist with a blinded preference loss.

| Sample | Overall | Response | Plan |
|---|---|---|---|
| A1 | PASS | PASS | PASS |
| A2 | PASS | PASS | PASS |
| A3 | FAIL | FAIL | PASS |
| B1 | FAIL | FAIL | PASS |
| B2 | FAIL | FAIL | PASS |
| B3 | PASS | PASS | PASS |
| C1 | FAIL | FAIL | PASS |
| C2 | FAIL | FAIL | PASS |
| C3 | FAIL | FAIL | PASS |
| D1 | FAIL | FAIL | PASS |
| D2 | FAIL | FAIL | FAIL |
| D3 | FAIL | FAIL | FAIL |
| E1 | FAIL | FAIL | FAIL |
| E2 | FAIL | FAIL | PASS |
| E3 | FAIL | FAIL | PASS |

All D samples failed the deterministic contract while D beat A 9–3. This is direct evidence that the current acceptance checks measure required coverage/contract realization rather than the primary quality preference.

## Information-flow diagnosis

- First-presence/loss summary: `{"A":{"firstPresent":"raw_extraction","firstLoss":"audited_extraction"},"B":{"firstPresent":"deterministic_plan","firstLoss":null},"C":{"firstPresent":"raw_extraction","firstLoss":"audited_extraction"},"D":{"firstPresent":"raw_extraction","firstLoss":"audited_extraction"},"E":{"firstPresent":"raw_extraction","firstLoss":"audited_extraction"}}`
- In A, C, D, and E, the target relationship was usually present in raw extraction and first weakened at audited extraction. The case-audit/formulation compression boundary is therefore the first observed bottleneck.
- D reconstructed the target in model-first formulation on all six evaluator traces and retained it fully in four of six final-answer traces; A retained it fully in only one of six final-answer traces.
- Variance interpretation: scaffold ordering explains more preference variance than hard-scaffold model substitution.
- Graph interpretation: mixed/partially helpful as evidence, but not isolated as a causal factor. The deterministic plan never fully erased the target and sometimes reconstructed it, while hard planner-first authority performed worse than model-first use. The evidence implicates authority/order more strongly than the graph's mere presence.
- Descriptive margins: scaffold A→D 6; hard-scaffold model A→B -2; D versus B 0; D→E -4.

## Codex hierarchy

- F2 native developer transport: SUPPORTED and live-validated.
- Both F1 and F2 reported high plan deference and a revise verdict. F2 produced more contract, unsupported-assignment, and missed-insight findings than F1, so structured counts do not establish an overall F2 win.
- Qualitative review found that F2 stated the conditional/retaliatory relational issue more directly, but that local gain did not overcome the mixed structured result. This single paired test does not support claiming that transport explains the critic-quality gap.
- F1/F2 critique equivalence hash match: no. The raw paired critiques remain owner-private.

## Diagnostic recommendation — not implemented

The evidence supports testing a production design in which the strongest available formulator sees the raw transcript before categorical compression, the graph runs afterward as a bounded safety/omission/sequencing auditor, and the final model may correct or reweight both the audited extraction and graph plan. The first repair target would be the case-audit compression boundary, not an Opus-for-Sonnet substitution. The renderer should not be told that hard reasoning is complete.

Do not infer that Opus should replace Sonnet: B did not beat A, E did not beat D, and E showed more proceduralization plus hard failures in this small run. Do not remove the graph based on this experiment either, because no graph-free arm was run.

## Limits

- This is a small, single-case engineering ablation with stochastic subscription CLIs. Pairwise preferences are not clinical outcomes or validated measures.
- The exact server-resolved Codex model is not separately emitted by the installed CLI; evidence therefore establishes a successful live invocation of the exact requested selector, not an independent server-side alias readback. Claude model-usage metadata is retained privately when emitted.
- The experiment tests the retrieved r5 guide plus compiled graph as used by the installed runtime. It does not test rejected r02 candidate policy.
- Existing ten follow-up fixtures are owner-authored counterfactual engineering trajectories, not observed follow-up transcripts; no observed follow-up transcript was found, so none was fabricated or relabeled as real.
- No arm removes the graph entirely. “Helpful/neutral/harmful” is therefore an inference from trace presence and authority/order contrasts, not a clean graph-versus-no-graph causal estimate.
- Position-order disagreement and judge disagreement are preserved as limitations rather than averaged away.

## Evidence

- Sanitized environment: `analysis/a001-scaffold-ablation/environment.json`
- Preference aggregate: `analysis/a001-scaffold-ablation/preference-results.json`
- Contract results: `analysis/a001-scaffold-ablation/contract-results.json`
- Trace aggregate: `analysis/a001-scaffold-ablation/trace-results.json`
- Transport result: `analysis/a001-scaffold-ablation/codex-transport-results.json`
- Private raw run root: `<owner-private-root>/runs/a372ce46fdb1bfd6` (owner-only, outside Git)
- Hash index: `analysis/a001-scaffold-ablation/evidence-index.json`

The next step, if later authorized, would be a production design decision based on these diagnostics. This experiment stops here.
