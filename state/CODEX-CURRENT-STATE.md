# Inner Signal Codex current state

Updated: 2026-08-24

## Exclusive goal

Run the owner-directed A001 scaffold ablation and diagnose model capability versus planner-first/hard-realization suppression. This is diagnostic only. Stop after the experimental branch, harness, raw evidence, sanitized results, and report are published.

## Exact boundary

- Branch: `exp/a001-scaffold-ablation-20260824`
- Protected-main baseline: `a22f2e611fab778bf26b8e7215afbf85aba4ba5e`
- Protected-stable and installed-runtime baseline: `110ee5342e27d8f1bd3d11cc2be4d85926c255b1`
- Installed runtime: `0.15.2`, read-only for this task
- Active task: `tasks/ACTIVE-TASK.json`
- Rerun command: `npm run experiment:a001-scaffold`

Do not change production prompts, therapy/guide/graph policy, `main`, `stable`, the installed runtime, or release state. The branch may contain only experiment harness code, tests, documentation, and sanitized evidence.

## Evidence classifications

- Deterministic repository checks prove harness and contract behavior only.
- Live model calls prove exact requested-selector execution and retain provider metadata; they do not prove therapy outcomes.
- Blinded pairwise preference is the primary engineering quality result, not a validated clinical measure.
- The ten prior A001 trajectories are owner-authored counterfactual engineering fixtures, not observed follow-up transcripts.
- No owner approval or therapy-policy transition is created by this experiment.

## Completed

- Read all four current therapy-governance ledgers before therapy work. The protected-main baseline predates three of those files; current owner/project instructions and the ledgers read from the controlling source worktree remain authoritative.
- Consulted current universal recovery, exclusive-task, evaluation-separation, reproducibility, and plugin-activation guidance.
- Recorded protected refs, installed receipt, configured model roles, CLI versions/capabilities, and effective guide/graph state.
- Confirmed the marked r02 packet is blocked/rejected and not installed; the installed runtime falls back to the committed r5 guide and graph.
- Preserved the independent conception before experiment changes.
- Created this isolated branch/worktree from protected `origin/main`.
- Added fail-closed branch/runtime preflight, private-evidence guard, atomic input-hashed stage resumption, A–F condition runner, blind order-reversed judges, trace analysis, deterministic contract checks, and sanitized report generation.
- `npm run experiment:a001-scaffold:preflight` passes on this exact branch and baseline.
- `npm run experiment:a001-scaffold:test` passes.

## Current checkpoint

The reusable harness and private run `a372ce46fdb1bfd6f71768af991509a5ceaacfa8262aa77ba4dd65b368168431` are active. Exact Sonnet 4.6, Opus 5, and GPT-5.6 Sol probes succeeded before the outage. Producer samples A1–A3, B1–B2, C1–C3, D1–D3, and E1–E2 are complete. B3 and E3 have no accepted sample because their exact-Opus calls returned HTTP 529. F1/F2 are complete; native `developer_instructions` is live-supported, and both critiques reported high plan deference. Twenty-eight Sol pairwise presentations and two Sol trace evaluations are durable.

Anthropic's official 2026-08-24 incident reports elevated errors for Opus 5 and other models. The remaining exact-Opus producer and judge work is queued without fallback. Raw evidence is owner-only outside Git; `analysis/a001-scaffold-ablation/partial-checkpoint.json` is metadata-only and explicitly not a result.

## Remaining

1. Monitor the official Anthropic incident; do not issue more Opus calls while it is identified/active.
2. After recovery, resume with `A001_ABLATION_RESUME_RUN_IDENTITY=a372ce46fdb1bfd6f71768af991509a5ceaacfa8262aa77ba4dd65b368168431 npm run experiment:a001-scaffold`.
3. Complete B3, E3, all Opus judgments, remaining Sol comparisons, and all trace evaluations.
4. Generate the final sanitized report and deterministic contract results.
5. Analyze, verify, commit, and push final evidence.
6. Confirm production refs/runtime unchanged and stop before production changes.

## Recovery rule

After interruption, run preflight, inspect `analysis/a001-scaffold-ablation/run-status.json`, and rerun the single experiment command. Matching complete stages are reused. Never copy raw private evidence into Git and never infer a therapy-policy decision from the diagnostic result.
