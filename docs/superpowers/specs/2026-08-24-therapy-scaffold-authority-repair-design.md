# Therapy scaffold authority repair design

## Goal

Determine whether the smallest advisory-realization repair (C) or the more complex model-first/graph-audit architecture (D) generalizes beyond A001, then implement only the evidence-supported production candidate behind a rollback switch while leaving production state unchanged.

## Compared architectures

`current` preserves the production pipeline exactly. `advisory` preserves extraction, audit, corrected variables, deterministic planning, model roles, guide inputs, transcript, and canonical question; only final-response authority changes. `model-first` creates a non-enum-heavy semantic formulation from the raw transcript independently of categorical routing, then supplies formulation and deterministic evidence to a bounded graph audit and final Sonnet integration.

All three preserve deterministic safety blocks and epistemic prohibitions. Ordinary selected nodes are advisory, not mandatory response coverage. Claimed node realization still requires verbatim support.

## Authority classes

- `HARD`: existing present-safety, orientation/ability-to-stop/return, altered-state/high-dissociation, memory-source, diagnosis/certainty, and explicitly blocked-intervention constraints.
- `PREREQUISITE`: sequencing constraints before deeper or riskier work; these constrain behavior without requiring lengthy explanation.
- `ADVISORY`: hypotheses, selected techniques, graph wording, secondary jobs, and ordinary next moves.
- `DIAGNOSTIC_COVERAGE`: observations about mentioned concepts, selected nodes, or expected vocabulary; never a rewrite trigger by itself.

No new hard gate is created by this classification.

## Comparison controls

- A, C, and D use identical original transcript, guide excerpts, Sonnet renderer identity, canonical-question policy, and Codex transport during the primary bakeoff.
- At least three fresh samples per case and condition unless determinism is empirically established.
- Exact GPT-5.6 Sol and Claude Opus 5 judge anonymized responses, with left/right reversal.
- Primary outcome is pairwise preference. Hard failures, diagnostic dimensions, legacy contracts, latency, calls, retries, usage, and recovery are reported separately.
- A private sibling root stores raw inputs and outputs. Git stores only hashes, identifiers, provenance classes, counts, and non-sensitive summaries.

## Selection rule

C is presumptive because it is the smaller demonstrated repair. Choose D only for material incremental advantage over C across more than one case family with no material regression in hard failures, safety, unsupported inference, latency, recovery, continuity, calls, cost, or stability. Choose C when effectively tied. Choose no change when neither candidate reliably generalizes.

## Non-effects

The branch will not merge itself, update `main` or `stable`, install the candidate, alter the active Guide Packet, rewrite Mermaid maps, change hypnosis, change safety routing, or change canonical-question authority during the primary comparison. Codex transport remains unchanged; any later parity patch is separate.
