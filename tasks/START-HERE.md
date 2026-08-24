# Start here — A001 scaffold ablation

This is the recovery entrypoint for the exclusive diagnostic task in `tasks/ACTIVE-TASK.json`.

## Exact workspace

- Branch: `exp/a001-scaffold-ablation-20260824`
- Protected-main baseline: `a22f2e611fab778bf26b8e7215afbf85aba4ba5e`
- Installed-runtime baseline: `110ee5342e27d8f1bd3d11cc2be4d85926c255b1`
- Worktree: `~/Téléchargements/innerSignalGraph-a001-scaffold-ablation`

Run `npm run experiment:a001-scaffold:preflight` first. It fails on another branch, a changed task contract, or a production baseline mismatch.

## Scope

Determine whether A001 quality is limited mainly by Sonnet capability, categorical planner-first compression, the hard “reasoning complete” realization contract, or Codex prompt transport. This branch may contain only the experiment harness, tests, documentation, and sanitized experiment evidence.

Do not edit production prompts to improve an arm. Do not merge, promote, install, or modify `main`, `stable`, the installed runtime, guide policy, graph policy, or therapy ledgers.

## Evidence boundary

Raw prompts, user material, model prose, intermediate snapshots, graph plans, blind mappings, and judge prose live in a mode-0700 sibling directory ending in `-private`. Git contains hashes, response identifiers, aggregate preferences, contract results, environment metadata, and the final diagnostic report. Test counts and evaluator preferences are engineering evidence, not therapy outcomes.

## Recovery

`npm run experiment:a001-scaffold` is idempotent. Each stage has an input hash and an atomic completion record. A valid completed stage is reused; an interrupted or mismatched stage reruns. Inspect `analysis/a001-scaffold-ablation/run-status.json`, then the private stage manifest named by `analysis/a001-scaffold-ablation/evidence-index.json`.

The terminal action is to publish the experimental branch and stop before any production behavior change.
