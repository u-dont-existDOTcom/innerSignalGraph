# Prior work, alternatives and source register

## Independent conception

The initial conception is preserved in `evidence/CONCEPTION.md`. This is an adaptation/composition task, not a claim to have invented a new memory theory.

A bounded SciSpace semantic search mapped the problem to long-term interactive memory, temporal updates, evidence/belief separation, and memory utilization. Load-bearing literature claims were then checked against primary HTML papers, not accepted solely from search summaries.

## Reuse decision

| Prior work / incumbent | Disposition | Design consequence |
|---|---|---|
| Existing encrypted store, source artifacts, state, candidate lifecycle | Reuse | Extend current services and schema; no parallel memory or approval store |
| LongMemEval | Adapt | Test retrieval and subsequent reading/use separately; include temporal update and abstention cases |
| ConvoMem | Baseline | Compare full authorized history when it fits, rather than assuming sophisticated retrieval is always better |
| Mem2ActBench | Adapt | Test the next useful action without an explicit reminder of the old fact |
| Hindsight | Adapt concepts only | Distinguish original evidence, summaries and evolving hypotheses |
| OpenAI component bridge | Compose, subject to host probe | Controlled input and exact artifact rendering inside existing plugin |
| Codex hooks / Work subagents | Not a drop-in route | Their documentation does not certify ordinary native ChatGPT reviewer dispatch |
| Separate API runtime | Retain optional profile | Strong backend orchestration but separate model/billing authorization |

Do not add a vector database, embeddings provider, graph engine or extra reviewer tier until the simpler incumbent/local approach fails a decision-relevant test. No literature performance figure is imported as a forecast of this application's reliability or clinical efficacy.

## What remains project-specific

The main new integration is turn-bound context preparation across the operator's actual entry surface, exact private source evidence, native reasoning candidate submission, independently prepared review, and exact released artifacts. The design distinguishes source coverage, semantic adequacy and host delivery rather than treating one receipt as proof of all three.

Unresolved empirical remainder: supported native independent reviewer orchestration in the operator's actual host; retrieval/use quality on representative cases; production concurrency/migration behavior. These are explicit acceptance work, not concealed assumptions.

## Sources

Links were checked during this architecture investigation on 2026-09-17. Official OpenAI documentation and the repository can evolve. The worker must refresh the actual implementation interface before using it. Repository links are pinned to the inspected baseline.

### O1 — OpenAI: Add UI to your MCP server

https://developers.openai.com/plugins/build/chatgpt-ui

Component-to-tool and follow-up message bridge; not evidence of universal ordinary-chat interception or fresh reviewer dispatch.

### O2 — OpenAI: Plugin reference

https://developers.openai.com/plugins/reference

Standard UI metadata, tool visibility, structured content and component-only metadata; actual host behavior remains a live test.

### O3 — OpenAI: Managing billing for ChatGPT and the API platform

https://help.openai.com/en/articles/9039756-billing-settings-in-chatgpt-vs-platform

ChatGPT and API billing are separate; no subscription-funded backend API assumption.

### O4 — OpenAI: Hooks

https://learn.chatgpt.com/docs/hooks

Codex hook surface; not assumed available in ordinary native ChatGPT.

### O5 — OpenAI: Subagents

https://learn.chatgpt.com/docs/agent-configuration/subagents

Work/Codex subagents; not proof of the requested ordinary-native reviewer route.

### M1 — LongMemEval

https://arxiv.org/html/2410.10813v1

Separate indexing, retrieval and reading; temporal updates and abstention. No current-model or clinical accuracy claim.

### M2 — ConvoMem

https://arxiv.org/html/2511.10523v1

Include full-context as a strong small-history baseline; do not turn reported scale boundaries into universal limits.

### M3 — Mem2ActBench

https://arxiv.org/html/2601.19935v1

Evaluate active memory use in subsequent behavior, not only passive fact retrieval.

### M4 — Hindsight

https://arxiv.org/html/2512.12818v1

Adapt evidence/belief separation and recall/reflection concepts; no adoption of another store or performance guarantee.

### R1 — InnerSignal longitudinal-state module

https://github.com/u-dont-existDOTcom/innerSignalGraph/blob/bf35a23dc0146c21586108fed0f726c50db8c436/src/case-state/longitudinal-state.mjs

Incumbent source-bearing state, epistemic statuses, question state and episode data. Reuse rather than replace.

### R2 — InnerSignal context-window module

https://github.com/u-dont-existDOTcom/innerSignalGraph/blob/bf35a23dc0146c21586108fed0f726c50db8c436/src/case-state/context-window.mjs

Verified incoming message is not an argument of targetedRetrievalRequests; current selector relies on high-relevance references.

### R3 — InnerSignal runtime model/controller

https://github.com/u-dont-existDOTcom/innerSignalGraph/blob/bf35a23dc0146c21586108fed0f726c50db8c436/src/supervisor/private-therapy-model-runtime.mjs

Existing provider generation path and sealed audit/repair assembly; inspect controller and store for final integration.

### R4 — InnerSignal private continuity contract

https://github.com/u-dont-existDOTcom/innerSignalGraph/blob/bf35a23dc0146c21586108fed0f726c50db8c436/docs/PRIVATE-CASE-CONTINUITY.md

Read-only retrieval separated from backend mutation/audit/delivery; authorization and private records.

### R5 — InnerSignal private continuity skill

https://github.com/u-dont-existDOTcom/innerSignalGraph/blob/bf35a23dc0146c21586108fed0f726c50db8c436/plugins/inner-signal-therapy/skills/inner-signal-private-continuity/SKILL.md

One user-facing plugin; read-only tools do not themselves persist/approve/send; truthful unavailable boundary.

### R6 — InnerSignal instruction consumer map

https://github.com/u-dont-existDOTcom/innerSignalGraph/blob/bf35a23dc0146c21586108fed0f726c50db8c436/docs/INSTRUCTION-CONSUMER-MAP.md

Developer, therapy, audit/repair, and delivery roles receive only their applicable instructions.

## Instruction authority consulted

Live Universal bootstrap and task-specific rules: research before reinvention, task-time lesson enforcement, execution/effort routing, assurance lanes, test efficiency, requirement accretion, and artifact delivery. Project authority: AGENTS, .github classification, current state, README, AUTOPILOT, documentation index and instruction-consumer map. The live design skill was read for component-boundary requirements; detailed visual implementation remains a worker task under its current rules.

No real private record was available through the active InnerSignal connector. A tool discovery failure is recorded as a session capability limit, not a diagnosis of the hosted service. No original private historical date or medical finding is certified by this source register.
