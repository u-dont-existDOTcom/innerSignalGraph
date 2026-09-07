# Guide fidelity and representation-loss evaluation, version 1

Authorized 2026-09-06 as a supplement, not a rewrite of the frozen companion v1/v2 corpus. This evaluates synthetic conversations and implementation fidelity, not clinical efficacy, whole-person healing or metaphysical truth. The development cases have been seen during implementation and are not a held-out efficacy test.

## The question

Can the actual responder deliver the relevant function in the author's guide, or does extraction, graph compression, question selection, task sequencing or response enforcement lose it? A model can follow a flawed map perfectly. Graph agreement and source fidelity must therefore be graded separately.

Reuse decision: use the repository's actual extraction/planning/realization/enforcement pipeline and existing universal semantic criteria. Add a small paired source-context experiment and fail-closed evaluation runner rather than build another agent framework or memory backend.

## Three conditions, same pinned responder

1. **normal_bot**: current candidate's real tiered pipeline, including its canonical question enforcement. No injected expected route or gold answer.
2. **guide_reference**: same responder, exact author guides plus approved amendments, full synthetic conversation and minimal shared response constraints. No graph, case rubric or expected answer. This is a reference condition, NOT an oracle or presumed better therapy.
3. **source_augmented**: same normal pipeline with the same full source packet added only at response realization. This leaves the extraction/routing implementation unchanged, but each arm performs its own stochastic extraction and develops its own history. It tests the combined condition, not a strictly controlled causal effect of source delivery alone. For a divergent case, compare the saved upstream states; replay the same captured plan with and without source augmentation before attributing the difference specifically to source delivery. It may still fail under a restrictive or wrong graph contract.

All pipeline roles in this evaluation use the explicitly selected responder, not stale Claude defaults. This is the candidate single-responder harness, not evidence that a differently configured deployed multi-provider system behaves identically. Repeats and conditions have isolated histories. Each replays the prerecorded user turns in order; a later synthetic report is not evidence that the prior reply helped a human. Arm execution order rotates deterministically. The same model IDs, provider route, requested xhigh effort and output-token limit are pinned. Total computation differs because normal pipelines may use several stages; report calls and usage, not a claim of equal total inference cost.

## Scope and sources

`cases.json` contains 12 original development scenarios and 23 user turns: completed checking with unfinished grief, new danger, permission withdrawn, inward worsening, practical barriers, unrewarding completed action, intrusive care, accountability, spiritual struggle, mature devotion/surrender, app correction, overcontrol and ending work.

The guide packet is read from repository source files and explicit approved amendments. Case references resolve to full line spans or complete amendment entries, not truncated search snippets or graph recommendations. The manifest hashes sources, current source/runtime files, cases, calibration controls, settings and commit. No book text, proprietary form or textbook clinical transcript is included. The book/source register documents the intellectual contributions; it is not the scoring oracle by itself.

The current source pin is `tasks/guide-source-sync-20260907/FIDELITY-SOURCE-PIN.json`: the complete recovered owner article with adopted E01-E12, the unchanged somatic source, and approved amendments. `SOURCE-SYNC.json` in that directory records exact source identity, the authorized edits and preservation evidence. Original media destinations absent from the pasted owner message remain unavailable. A source conflict or missing relevant instruction must be reported rather than hidden by a forced score.

The source reader selects filenames from `guides/manifest.json` and rejects stale guide hashes, source-map filenames, span bounds and span hashes. Manifest and source-map bytes participate in source identity. `case-source-bindings-2026-09-07.json` adds the newly indexed article passages to grader context without rewriting `cases.json`, its user turns/required functions, or `grader-controls.json`. The run records original and effective suite hashes and the additive binding hash. Previous run directories and frozen companion v1/v2 evidence are preserved; use a new directory for this revised source.

## Real response grading

Two independently called, explicitly configured grader model identities, distinct from the responder and from each other, review each answer. They see source passages, the user/assistant history and the candidate answer, not its arm, model, graph IDs, expected node or planner's claimed success. Criteria reuse the existing universal semantic criteria plus source-function fidelity, present-task fit and useful delivery.

An acceptable answer must actually carry out a relevant helpful function, not merely mention 'Protector', 'love', 'safety' or another keyword. More words, more modalities, agreement with the founder and indiscriminate reassurance earn no credit. Multiple source-consistent responses are allowed. Needed direct help and thoughtful challenge can be compatible with care.

Grading records criterion-specific pass/revise/block/uncertain, source IDs, exact answer evidence and reasons. Source/quote checks establish provenance, NOT semantic correctness. Omitted behavior can have an empty quote with a specific explanation. Disagreement and source uncertainty require review; a blocker is not averaged away. No model self-grades its answer. Since visible content can still reveal style, identity blinding is procedural, not a guarantee that a model cannot guess.

Before any bot outputs are scored, both graders must reject four deliberately wrong original responses and accept two acceptable controls. These are calibration fixtures, not actual bot failures or successes. Calibration failure blocks scoring rather than changing the tests to get a pass. Human review remains necessary for ambiguous cases, disagreement, every serious blocker, and a sample of apparent passes.

## Locating failures

Keep per-stage prompts, source hashes, API-returned identity, extraction, task/graph trace, raw response text (never hidden reasoning), question enforcement and final answer. These allow specific diagnoses:

- source distinction missing from the actual guide: source/governance gap;
- guide distinction absent from extracted case/task: extraction loss;
- correct facts but wrong task or blocked progression: route/representation failure;
- appropriate plan but missing task detail: delivery/context loss;
- adequate input but response does not perform it: realization failure;
- raw response appropriate but altered into a worse question/output: enforcement failure.

A guide-reference win is evidence to investigate those possibilities, not automatic proof that 'graphs are bad'. Both conditions can fail for different reasons. Report case-level contrasting replies and the decisive source passages. Do not accept a polished generic paragraph that could fit all members of a contrast pair.

## Run, identity and bounded cost

First run preflight with no calls:

```sh
node tasks/guide-fidelity-20260906/run.mjs --out /private/innersignal-eval/preflight
```

The live runner accepts a private JSON settings file. It contains `responder` and exactly two `graders`. Each role needs `model` (exact API ID), `expected_response_model` (exact API-returned identity), `provider` (provider-only route), `effort`, `max_tokens`, and `api_key_env` (an environment variable NAME, never the key). Also set `max_calls` and `acknowledge_provider_retention: true`. The responder effort must be `xhigh`. There are no default model IDs and no model/provider fallbacks. The intended owner-selected responder remains GPT-5.6 Sol xhigh; verify its actual API identifier instead of guessing from the UI label.

A successful real identity probe is mandatory for every role. The response's reported model must match the pinned expectation. The API receives xhigh with required-parameter routing; the hidden internal execution effort is not independently measurable and is not claimed verified. The credential is used only in transport headers and never written in evidence.

```sh
node tasks/guide-fidelity-20260906/run.mjs --settings /private/innersignal-eval/settings.json --out /private/innersignal-eval/smoke-v1 --smoke --live
```

Smoke uses four scenarios, seven user turns, three conditions, one repeat: 21 final responses and 42 independent grades, plus 12 calibration grades, 3 identity probes and the normal/augmented pipeline's internal calls/retries. The strict total `max_calls` includes all those calls, including failed attempts. Output-token limits are per request, not a promise of dollar cost; provider usage is retained. No budget number is silently selected. If the cap is insufficient, the run stops and records incomplete rather than reporting a success rate.

After inspecting the smoke results, the same command without `--smoke` runs the full development suite (69 final responses/138 grades per repeat, plus calibration/probes/internal stages). `--repeat 2` requests two independent replays. Establish the budget before running. Re-running the identical command and output directory reuses completed calls; pending/failed calls require explicit review because the provider may already have charged. Changed inputs/configuration require a new run directory. Concurrent processes cannot share one live output directory: RUNNING.lock blocks a second writer. After a crash, inspect the call ledger and confirm no worker remains before removing the stale lock; incomplete provider requests still require explicit review. Parallel internal pipeline calls serialize their checkpoint writes.

No new npm package or external evaluation service is required. The stock evaluation-only OpenRouter adapter follows the official API contract. A different transport must preserve identity, no-fallback, source, budget and evidence invariants; it is not silently substituted.

## Release interpretation

Structural tests cannot close the live-response gate. Synthetic grades cannot establish clinical benefit. The development map remains a draft candidate until its actual responses have been reviewed. Following a source is also not sufficient reason to ship unsafe guidance. A source disagreement is recorded as such, not silently rewritten or counted as a pass. Do not merge, deploy, promote stable or claim endorsement from this evaluation.

## Existing-work scan and limits

An independent conception snapshot was preserved before the bounded scan. Reused principles: separate code/model/human graders and inspect transcripts; use task-specific positive and negative controls; blind labels and retain judge disagreement; evaluate at multiple turns rather than count keywords.

Primary technical references consulted 2026-09-06:
- Anthropic, *Demystifying evals for AI agents*: https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents
- Zheng et al., *Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena*: https://arxiv.org/abs/2306.05685
- Shi et al., *Judging the Judges: A Systematic Study of Position Bias in LLM-as-a-Judge*: https://arxiv.org/abs/2406.07791
- OpenRouter structured outputs: https://openrouter.ai/docs/guides/features/structured-outputs
- OpenRouter reasoning controls: https://openrouter.ai/docs/guides/best-practices/reasoning-tokens

None validates this therapeutic rubric or app. The source-level rubric and contrasts are original engineering adaptations.
