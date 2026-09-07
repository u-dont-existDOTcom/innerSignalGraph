# Reasoning-selection integration — 2026-09-07

## Decision

**COMPOSE / ADAPT.** Do not invent a new formal reasoning algorithm and do not inject the whole policy into the end-user therapy runtime. Preserve the owner's reasoning-selection policy as development governance, expose it through the mandatory project read path, and let demonstrated behavioral failures—not policy duplication—justify later runtime or guide changes.

## Independent conception snapshot

The owner supplied a function-based reasoning selector with these key commitments before the existing-work scan:

- use the smallest sufficient method combination for the actual question and phase;
- distinguish analytic/formal, empirical/Bayesian, abductive/causal, systems/temporal, dialectical, phenomenological, generative/analogical, and decision/practical functions;
- scale effort with stakes, uncertainty, and reversibility;
- verify load-bearing premises and test the strongest relevant objection for consequential conclusions;
- preserve facts/inferences/hypotheses/values distinctions;
- scan existing work before substantial bespoke design;
- in InnerSignal therapy work, lead phenomenologically and keep formulations revisable;
- in graph/runtime work, lead with formal transitions, invariants, traceability, and adversarial regressions;
- keep owner authority, privacy, action gates, installed/stable authority, and release gates above the reasoning supplement.

The full owner text is preserved in `docs/REASONING-SELECTION.md`.

## Bounded existing-work scan

The underlying problem substantially overlaps established work, so reuse is required where it fits.

| Existing work | What it already supplies | Disposition |
| --- | --- | --- |
| Russell & Wefald, “Principles of metareasoning,” *Artificial Intelligence* 49 (1991), DOI `10.1016/0004-3702(91)90015-C` | selecting and justifying computational actions under bounded resources using probability/decision theory | **Reuse** as the general precedent for reasoning-about-reasoning rather than inventing a new meta-controller |
| Griffiths, Lieder & Goodman, “Rational use of cognitive resources,” *Topics in Cognitive Science* 7 (2015), DOI `10.1111/tops.12142`; Lieder & Griffiths, “Resource-rational analysis,” *Behavioral and Brain Sciences* 43 (2020), DOI `10.1017/S0140525X1900061X` | trading reasoning accuracy against time/computational cost; function and resource allocation | **Reuse/adapt** for “smallest sufficient combination” and effort scaling |
| Howard, “Information Value Theory,” *IEEE Transactions on Systems Science and Cybernetics* 2 (1966), DOI `10.1109/TSSC.1966.300074` | formal value of acquiring information before a decision | **Reuse** as a normative baseline for “seek further information only when it could change the decision,” subject to mandatory checks |
| Pearl, “An Introduction to Causal Inference,” *International Journal of Biostatistics* 6 (2010), DOI `10.2202/1557-4679.1203` | assumptions, confounding, interventions, counterfactuals, mediation | **Reuse** for the causal/abductive discrimination layer |
| Existing InnerSignal `AGENTS.md`, `AUTOPILOT.md`, owner locks, framework-hypothesis policy, source/graph fidelity machinery | authority ordering, deterministic-vs-semantic boundaries, policy provenance, source-to-behavior verification, owner gates | **Compose** with the reasoning selector rather than replace |
| Existing therapeutic source register (`docs/research/THERAPEUTIC-SOURCES.md`) and current graph/guide policies | low-leading dialogue, formulation/fidelity constraints, multiple therapeutic frameworks already selectively adapted | **Compose**; no new modality claim or runtime behavior is implied by this policy document |

## What remains project-specific

The established literature does **not** by itself solve InnerSignal's project-governance problem. The project-specific remainder is:

1. selecting reasoning methods while preserving the repository's authority hierarchy and non-waivable gates;
2. explicitly separating therapy-dialogue/guide reasoning from graph/runtime engineering reasoning;
3. distinguishing candidate development policy from installed/stable product policy;
4. requiring human usefulness and harmful-edge-case evaluation separately from schema/test success;
5. using repeated failures as evidence to revisit formulation/routing before accumulating local rules.

That remainder warrants a project supplement, not a new formal algorithm.

## Integration placement

- `docs/REASONING-SELECTION.md` — full owner-authorized reasoning supplement.
- `AUTOPILOT.md` — mandatory-read pointer and scope guard so development workers discover the supplement.
- this receipt — durable architecture/scan record so the integration rationale does not have to be reconstructed later.

The existing `tasks/NEXT-CONVERSATION-HANDOFF-2026-09-07.md` is intentionally unchanged because its live guide-fidelity next step remains authoritative and should not be displaced by a docs-only reasoning integration. `AGENTS.md` and `docs/INDEX.md` are also deliberately unchanged. They already establish the authority/read path, and changing integrity-bound root governance files would be unnecessary scope expansion.

## Baseline and benchmark

Baseline: current candidate governance already enforces authority, owner-gated therapy/framework semantics, deterministic verification, source provenance, and stable/install separation, but it does not contain a coherent function-based reasoning selector.

Benchmark for this integration:

- discovery: every ordinary development worker reaches the supplement through the existing mandatory read path;
- authority: the supplement cannot override owner locks, privacy/budget/action gates, installed/stable authority, or release controls;
- fidelity: the owner's supplied reasoning distinctions are preserved without semantic softening;
- scope: no guide text, graph semantics, runtime therapeutic response, installed policy, stable branch, deployment, or release state changes;
- future behavior: a runtime/guide change requires demonstrated evidence that the development-level reasoning policy exposes a concrete behavioral gap.

## Non-claims

This integration does not establish that the reasoning selector is clinically effective, optimal, or a novel scientific theory. It does not complete the authenticated guide-fidelity smoke and does not authorize merge, deployment, stable promotion, or product-policy installation.
