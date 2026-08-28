# Therapy protocol runtime crosswalk

Source commit: `af36a51e44a65067a3d7703a78a004fdb8ad7693`  
Runtime router: `creative-tail-inner-child-router-v2`  
Production pipeline: `auto-tiered-v3`

## Execution path

The production HTTP endpoint `POST /v1/therapy/respond` builds context and calls `runTieredTherapyPipeline` with automatic tier selection. The 49-case and multi-turn executors import and call those same functions directly; they do not use the legacy always-full `respond:cli` wrapper and do not start the server or Guide Packet recovery. This keeps the evaluated candidate identical to the production routing path while avoiding unrelated mutable recovery state.

```text
public query or synthetic turn
  → buildContext
  → Sonnet structured extraction
  → deterministic protocol/tier routing
  → optional GPT audit and re-routing
  → permitted guide-graph plan or protocol-only plan
  → tier-specific Opus/GPT reasoning when selected
  → Sonnet realization
```

CLI candidate roles are fixed: extraction and realization use `claude-sonnet-4-6`; audit and critique use `gpt-5.6-sol` with high reasoning; deep analysis uses `claude-opus-5` with high effort; forensic candidates and cross-critiques use the existing Opus/GPT pair; adjudication uses OpenAI. Campaign ledgers are off. Per-call evidence records stage, role, provider, exact model, CLI transport, request/response IDs, timestamps, duration, and usage metadata without storing provider prompts.

## Semantic-to-runtime map

| Source concern | Runtime enforcement | Durable evidence |
| --- | --- | --- |
| One parent with nurturing, protecting, and guiding qualities | `INNER_PARENT_ONTOLOGY`; qualities never become autonomous agents | router tests and response nuance |
| Safety/basic needs/instability/dependent danger first | Hard-safety precedence before consent and guide selection | `O1_PRACTICAL_SAFETY`; mutation-sensitive tests |
| Current reality and another person's rights outrank inner voting | Actor/problem/authority gates bypass the guide graph | `O3_CURRENT_REALITY`, `O9_HIGH_IMPACT_DECISION` |
| Operation-scoped consent | Requested optional operation is blocked without retry debt | `operation_consent`, `consent_scope`, allowed/blocked operations |
| Depth is not integration; provenance remains bounded | Sober, oriented, stoppable/returnable, integration, consent, and provenance gate | `O8_DEPTH_ACCESS` prerequisites |
| Missing skill or lost scaffold is not missing Guide | Map 15 full selector retained after ablation | capability fields and `O3_CURRENT_REALITY` |
| Ambivalence is not incapacity | Map 16 supported-choice selector plus full semantic safeguards | production hybrid; capacity/authority forbidden overclaims |
| Resource unavailable is a first-class state | Access, handoff, fallback, limitation, unmet need, and retry trigger persist | `O10_EXTERNAL_HANDOFF` and `resourceState` |
| Vulnerability-amplifying loops require an operation change | Longitudinal adverse trajectory redirects, not wording optimization | `therapy-protocol-longitudinal-v1` |
| Every graph node must have an operation class | Explicit exhaustive node map; unknown nodes throw | `GRAPH_NODE_OPERATIONS` equality test against compiled graphs |

The planner serializes disposition, primary operation, allowed/blocked operations, material unknowns, resource state, exact router/variant, normalized profile, and longitudinal state into `interventionContract.therapyProtocol`. After a reviewed extraction, audit corrections are applied and tier requirements are recomputed so newly discovered safety/authority facts cannot remain on a lower tier.

## Longitudinal state

Later turns carry only actual prior `caseFormulation`, actual prior `interventionContract`, prior processing tier, and the real user/assistant transcript. The transition layer preserves an unresolved original concern, unmet external resource and access barrier, unstable provenance, and bounded action authority. It detects a repeated unavailable referral and preserves coping-versus-need separation. Explicit evidence that immediate danger has ended is not made permanently sticky.

The 13 synthetic adversarial trajectory inputs and their graders are physically separate. These are regression stimuli, not private therapy histories or clinical outcome evidence. Evidence limitations also include model stochasticity, evaluator fallibility, subscription-service availability, and the absence of independent clinical adjudication.
