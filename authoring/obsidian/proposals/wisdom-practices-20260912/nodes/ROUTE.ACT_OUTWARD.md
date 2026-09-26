---
authoring_contract: inner-signal-authoring-node-proposal-v1
entity_type: graph-node-proposal
proposal_id: wisdom-practices-20260912
operation: replace
graph_id: inner-child-somatic-cross-guide
node_id: ROUTE.ACT_OUTWARD
title: Act on the concrete problem
kind: decision-node
tier: 3
priority: 99
authority: owner-approved-extension
graph_tags:
  - three-way-routing
  - outward-action
  - protector
  - guide
source_refs:
  - AMEND.CROSS.THREE_WAY_THERAPY_ROUTING
  - AMEND.CROSS.LITERATURE_ACTION_REVIEW
  - AMEND.IC.WISDOM_CORE
base_record_sha256: 90524ce906f30738dd6a9a128b9c4cc2f3a8a55b0323ba439bc58cfc0145f2b6
base_graph_sha256: beb05b08a340cf9bd62efacaab7619a3dd4f6adf6bedabb4927cfe4e3a329560
base_projection_input_sha256: 2b23083b114602af50c57f715c5afb16d1c1b9959e3ca8ea9d7f87f501a49b2f
---

# Act on the concrete problem

> [!warning] Editable proposal record. Building it never changes canonical graph files.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "all": [
      {
        "field": "actionable_problem",
        "op": "eq",
        "value": "present"
      }
    ],
    "none": [
      {
        "field": "present_safety",
        "op": "eq",
        "value": "unsafe"
      },
      {
        "field": "orientation",
        "op": "eq",
        "value": "disoriented"
      },
      {
        "field": "suicidal_state",
        "op": "in",
        "value": [
          "ideation",
          "intent",
          "imminent"
        ]
      }
    ]
  },
  "avoid": [
    "Do not wait for complete emotional certainty before taking a reversible necessary action.",
    "Do not use action as a way to deny clearly unresolved inner material that continues to drive the problem.",
    "Do not treat noncompletion as lack of motivation or a protective part before examining practical barriers; do not treat task completion or immediate mood improvement as the sole evidence of benefit."
  ],
  "defaultQuestion": "What is the next observable action that could actually change this situation?",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [
      "Do not reduce every emotional problem to productivity or behavioral execution."
    ],
    "requiredNuance": [
      "A concrete problem and unresolved inner material can coexist; outward action goes first when the environment can actually be changed, while inward work may remain a parallel or later job."
    ]
  },
  "questionPolicy": {
    "purpose": "discriminate",
    "unresolvedFields": []
  },
  "recommendations": [
    "Extract one concrete problem that can be changed and choose the next observable decision or action.",
    "When useful problem-solving is surrounded by rumination, act on the actionable piece and stop rerunning the remainder until genuinely new information arrives.",
    "Use Protector functions for boundaries and safety, and Guide or Leader functions for sequencing and practical follow-through, without requiring deeper introspection merely because action is emotionally charged.",
    "When an action is agreed, make its cue, feasible size, resource needs and personally useful purpose concrete. When an attempt has already happened, review the actual sequence and consequences instead of assigning the same action again.",
    "For a chosen interpersonal response that the person wants help composing, offer the draft/editor method if useful. A brief sufficient response, firm boundary, apology, pause or nonresponse can be appropriate. Preserve the return to inward care separately from outward completion."
  ],
  "successSignals": [
    "A decision, boundary, request, repair, plan, or other observable action changes the real situation.",
    "Thinking becomes shorter and more specific because it terminates in action or a defined wait for new information."
  ]
}
```
<!-- inner-signal:payload:end -->

## Proposal rationale

Apply the exact owner-approved wisdom-practice packet record while preserving current safety, relationship, trajectory, consent, provenance and task-state boundaries. The worst plausible failure is a fitting optional practice displacing protection, reality checking, a valid boundary, or current consent.

## Regression intent

The proposal declares G930–G962, including direct entrances, refusal/close boundaries, safety precedence, raw-variable spoofing, outward editor support and relationship-first routing.
