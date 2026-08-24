# A001 scaffold ablation design

## Question

Why does Inner Signal's A001 response appear materially less insightful than direct GPT-5.6 Sol or Claude Opus reasoning? The experiment separates model capability, planner-first ordering, hard realization fidelity, and Codex instruction transport without modifying production.

## Fixed baselines

- Branch from protected `origin/main` at `a22f2e611fab778bf26b8e7215afbf85aba4ba5e`.
- Current installed runtime `0.15.2` at `110ee5342e27d8f1bd3d11cc2be4d85926c255b1` is read-only.
- Primary input is `corpus/difficult-cases/A001-inner-child-credibility/case.json`.
- One context build freezes the user input, relevant guide excerpts, guide manifest, and graph bundle for all comparable arms.
- Existing follow-up evidence is inventoried. Synthetic or counterfactual trajectory fixtures are never described as observed owner transcripts.

## Conditions

### A — current control

Invoke the installed `runTieredTherapyPipeline` with current CLI configuration and automatic routing. Capture every provider call plus extraction, audit, variables, plan, adjudication, realization, response contract, and final answer.

### B — Opus under the hard scaffold

Invoke the same installed pipeline and routing, changing only the renderer/extractor model from `claude-sonnet-4-6` to `claude-opus-5`. The production extraction and realization instructions remain byte-identical.

### C — advisory realization

Reuse the paired A replicate's audited snapshot and deterministic plan. Give Sonnet the same transcript, guide excerpts, formulation, and plan, but an experiment-only realization instruction that makes the plan advisory and permits independent reformulation. No production prompt is edited.

### D/E — model-first, graph-audit-second

First ask Sonnet (D) or Opus (E) for a non-diagnostic, uncertainty-preserving formulation from raw transcript plus the frozen guide excerpts. Then give a bounded independent graph auditor that formulation plus the paired A plan and ask only for safety, prerequisite, overclaim, omission, sequencing, and technique constraints. Finally let the same primary model integrate the free formulation and graph audit. The plan may constrain but cannot define the case meaning.

### F — Codex prompt hierarchy

Critique one fixed Anthropic candidate twice with identical critic content. F1 uses the current wrapper's stdin `SYSTEM INSTRUCTIONS` convention. F2 uses Codex CLI `developer_instructions` through a strict recognized config override and sends only the task payload as user input. A separate conflicting-instruction probe must pass before F2 is recorded as supported.

## Replication and comparisons

Run three fresh output samples per A–E condition. Freeze the contrast family before judging: A–B, A–C, A–D, B–D, D–E, and A–E. Each replicate is judged independently by exact GPT-5.6 Sol and Claude Opus 5 in both left/right orders. Labels are randomized separately per replicate and architecture/model identities are absent from judge prompts.

The primary result is pairwise preference. Diagnostic dimensions remain separate and are not folded into a bespoke master score. Position-order disagreement, judge disagreement, ties, hard failures, and invalid structured outputs remain visible.

## Trace analysis

For guide excerpts, raw extraction, audited extraction, deterministic plan, reasoning/audit packet, pre-realization draft where present, and final answer, evaluators classify whether the conditional-care/retaliation relationship is absent, partial, or substantively present. The benchmark meaning is retained only in the private trace-evaluator instruction; it is not injected into producer prompts.

## Safety and privacy

This is an engineering diagnostic, not clinical validation. No result licenses a therapy-policy transition. Raw therapy material and generated prose stay outside Git in an owner-only directory. Tracked artifacts retain hashes, model/request identity, timing summaries, pass/fail results, and aggregate judgments. Credentials, account details, private chain-of-thought, and raw provider authentication are never recorded.

## Resumption contract

Each stage key is derived from source SHA, installed runtime SHA, frozen input/guide hash, model configuration, prompt version, condition, and replicate. Stage files are atomically replaced only after successful validation. Completed matching stages are reused; stale or incomplete stages are not. SIGINT/SIGTERM stop after the current subprocess boundary and leave no artifact marked complete prematurely.
