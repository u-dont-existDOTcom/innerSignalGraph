---
authoring_contract: inner-signal-authoring-node-proposal-v1
entity_type: graph-node-proposal
proposal_id: somatic-altered-guide-sync-20260916
operation: replace
graph_id: inner-child-directed-graph
node_id: IC.ALTERED_STATE_GATE
title: Calibrate therapy depth during altered states instead of assuming incapacity
kind: decision-node
tier: 5
priority: 78
authority: author-framework
graph_tags:
  - altered-state
  - gate
  - epistemic
source_refs:
  - IC.ALTERED_STATES
  - IC.ESCAPE_URGE
  - AMEND.IC.EXISTENTIAL_LOVE_ROUTING
  - AMEND.IC.WELLBEING_HORIZON
  - ALT.CAPACITY
  - ALT.EPISTEMICS
  - ALT.GROUNDING
base_graph_sha256: a2adb4c3f3d7727f1943c0805f713fa4a8b150353dcc5593b118500c53267342
base_projection_input_sha256: 2c8ca643504274023e49c647fbff143a6f02fe685ef935384c3c60c33b004fbb
base_record_sha256: 1834ec961af7d1f5ff5052faf3c6344361f8f2b1d373144193182cae0a303fea
---

# Calibrate therapy depth during altered states instead of assuming incapacity

> [!warning] Editable proposal record. Building it never changes canonical graph files.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "any": [
      {
        "field": "altered_state",
        "op": "eq",
        "value": "altered"
      },
      {
        "field": "current_intent",
        "op": "eq",
        "value": "altered_state"
      }
    ]
  },
  "avoid": [
    "Do not treat entheogenic or hypnotic material as recovered fact or use altered intensity as proof of healing.",
    "Do not automatically end useful therapy or replace the user’s actual question with generic grounding merely because they disclose an altered state.",
    "Do not prescribe recreating a psychedelic, NDE-like, or other extraordinary breakthrough as the answer to hopelessness."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [],
    "requiredNuance": [
      "A past altered-state opening may establish that a deeper wellbeing horizon was experienced, but it does not prove present access, child inclusion, or integration.",
      "A current altered state and a lack of habitual inner speech are unrelated dimensions; neither establishes that the person cannot reason, use language, or engage therapy."
    ]
  },
  "recommendations": [
    "Treat current altered state as a routing variable rather than an automatic stop: assess physical safety, orientation, capacity to communicate, stopping capacity, ordinary agency, and available support.",
    "When those capacities remain coherent and stable, continue substantive inner-child or relational work at a depth the person can actually hold; when they deteriorate, shift toward room/body/human/time stabilization.",
    "Prefer already-developed or borrowed Nurturer/Protector capacity for deeper altered-state work, and reduce depth rather than escalating intensity when the experience outruns that capacity."
  ],
  "successSignals": [
    "The person can stop, orient, and integrate without escalating use."
  ]
}
```
<!-- inner-signal:payload:end -->

## Proposal rationale

Explain why the change is needed, what behavior it should alter, and the worst plausible failure. This prose is review evidence, not executable graph content.

## Regression intent

List the existing or proposed regression cases that should distinguish the old and new behavior.
