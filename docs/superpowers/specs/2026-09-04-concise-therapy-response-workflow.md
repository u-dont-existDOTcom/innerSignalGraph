# Concise therapy response workflow

Date: 2026-09-04

## Owner requirement

Inner Signal keeps deep case formulation internal while making ordinary dialogue concise. The response layer has two explicit views:

- `default`: one natural response, normally no more than three short answer paragraphs plus the graph-owned next question, with no route analysis or case-variable trace;
- `map-debug`: the same natural response plus a separate inspectable map containing case variables, safety precedence, fusion/witness assessment, the winning and rejected three-way routes, Protector/Nurturer/Guide selection, somatic modifiers, intervention rationale, and next-question source.

Both views run the same upstream pipeline before realization: case extraction, safety routing, fusion/witness assessment, inward/outward/leave-alone routing, adult-function selection, somatic modification, and deterministic next-question selection. Debug mode changes presentation only; it cannot change the selected route or weaken safety precedence.

## Deterministic presentation contract

Ordinary responses are capped at three answer paragraphs and roughly 180 words. The leave-alone route is capped at one answer paragraph and roughly 90 words so the act of replying does not recreate the processing loop. Safety-triggered responses may use up to five paragraphs and roughly 320 words because minimum necessary safety guidance outranks brevity.

The runtime strips explicit internal-map labels and node IDs from user-facing prose, records whether a renderer exceeded the presentation contract, and retries a non-mock renderer once if map bookkeeping leaked or no answer body survived. The canonical graph-owned question remains appended deterministically after realization.

## Acceptance

- Default browser and API requests select `responseMode=default` and do not receive a `mapDebug` payload.
- `responseMode=map-debug` exposes the completed internal formulation without changing the concise answer or route.
- The browser renders route depth and map details only for messages explicitly requested in map/debug mode.
- Safety suppresses lower-priority three-way presentation, including leave-alone.
- Existing inward, outward, external-embodiment, leave-alone, ambiguity-gate, and safety routing regressions remain unchanged.
