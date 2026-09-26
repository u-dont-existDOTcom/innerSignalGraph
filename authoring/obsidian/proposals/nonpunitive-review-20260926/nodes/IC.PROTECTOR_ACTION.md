---
authoring_contract: inner-signal-authoring-node-proposal-v1
entity_type: graph-node-proposal
proposal_id: nonpunitive-review-20260926
operation: replace
graph_id: inner-child-directed-graph
node_id: IC.PROTECTOR_ACTION
title: Make the Protector visible in ordinary life
kind: decision-node
tier: 4
priority: 90
authority: author-framework
graph_tags:
  - protector
  - ordinary-life
  - credibility
source_refs:
  - IC.PROTECTOR_VISIBLE
  - IC.ADULT_APPRENTICE
  - AMEND.CROSS.LITERATURE_ACTION_REVIEW
  - AMEND.IC.WISDOM_CORE
  - AMEND.IC.NONPUNITIVE_REVIEW
base_record_sha256: 868975a7d808c198797583425c6a8f8efb40212b117ee88f50ef2d19ccfaab28
base_graph_sha256: 55369c75e95b5cc9fc32c807f7b47bef411acf3aedcbe895076fbb796d04a0c4
base_projection_input_sha256: 456d7539d0ac59e9a20a4c08179a8856ead6d3e863fb63b4915b9f98fd401e78
---

# Make the Protector visible in ordinary life

> [!warning] Editable proposal record. Building it never changes canonical graph files.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "any": [
      {
        "field": "credibility_conflict",
        "op": "eq",
        "value": "present"
      },
      {
        "field": "inner_adult_access",
        "op": "in",
        "value": [
          "low",
          "partial"
        ]
      },
      {
        "field": "protective_response",
        "op": "eq",
        "value": "present"
      }
    ]
  },
  "avoid": [
    "Do not choose an action so large that failure becomes new evidence of unreliability.",
    "Do not make review punitive, compulsive, or mandatory. Voluntary tracking or simple measurement is allowed when it genuinely supports learning rather than becoming self-surveillance."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [],
    "requiredNuance": []
  },
  "recommendations": [
    "Choose one bounded action: a meal, sleep, a boundary, a phone put down, a task handled, an unsafe exchange ended, or help requested.",
    "Report the action without requiring the younger state to trust it yet.",
    "Where communication itself is the action, a private draft and caring editor may help preserve truth and the boundary; return to inward care afterward when useful. Do not postpone a necessary protective action to complete an exercise.",
    "After attempting improved care, protection, or guidance for the inner child, notice without harsh judgment what felt right and what you could do better next time."
  ],
  "successSignals": [
    "One small promise is kept.",
    "The action or its review provides truthful information about what supports protection and follow-through, including when a reasonable plan needs changing."
  ]
}
```
<!-- inner-signal:payload:end -->

## Proposal rationale

IC.PROTECTOR_ACTION is the third owner-approved anchor of OVERLAY.IC.NONPUNITIVE_REVIEW and the ordinary-life place where most self-care attempts happen. It reuses the already owner-approved user-facing review line and the owner-revised avoid constraint verbatim; no new wording is introduced.

## Regression intent

G041 selects this node without a helper or credibility conflict and asserts the non-punitive avoid constraint reaches the plan.
