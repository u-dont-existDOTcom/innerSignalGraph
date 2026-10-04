---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-directed-graph
node_id: IC.CONTINUITY_TITRATION
title: Preserve the inner relationship while reducing depth
kind: decision-node
tier: 4
priority: 99
authority: owner-approved-extension
graph_tags:
  - inner-signal-continuity
  - titration
  - reparenting
  - reactivation
source_refs:
  - AMEND.IC.CONTINUITY_TITRATION
  - IC.BEFORE_DEEP
  - IC.THREE_FUNCTIONS
  - IC.SESSION_CLOSURE
regression_refs:
  - G063
  - G066
  - G069
  - G070
  - G087
base_record_sha256: e0e1b69f725d2e11e736a8d02f06869c2ac9d5297fed86920382b49bf90411a5
base_graph_sha256: 59e9031700393f6690fe52b1dcb84bd5cf49747665172ae1d7a12a79b285a1e0
projection_input_sha256: e36e91942351df953f6c5630631ef9cd60322cea36c01d7956e3179848e5c9e9
---

# Preserve the inner relationship while reducing depth

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "all": [
      {
        "field": "ic_status",
        "op": "in",
        "value": [
          "active",
          "stepped_down"
        ]
      },
      {
        "field": "ic_titration_needed",
        "op": "eq",
        "value": "yes"
      }
    ],
    "none": [
      {
        "field": "present_safety",
        "op": "eq",
        "value": "unsafe"
      },
      {
        "field": "medical_urgency",
        "op": "eq",
        "value": "urgent"
      },
      {
        "field": "suicidal_state",
        "op": "in",
        "value": [
          "intent",
          "imminent"
        ]
      },
      {
        "field": "dissociation",
        "op": "eq",
        "value": "high"
      }
    ]
  },
  "avoid": [
    "Do not treat a person's refusal of inner-child framing as a tolerance problem, a pause, or something to reactivate.",
    "Do not trial imagery, witnessing, or symbolic contact when the capacity currently failing is inward attention, orientation, stopping, or return.",
    "Do not turn a temporary external-orientation decision into a permanent ban on reparenting when the person still wants the framework.",
    "Do not use witnessing, imagery, symbolic contact, or other child-facing contact while status remains paused_tolerance or paused_safety."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [
      "IC.DEEP_CHILD_DIALOGUE"
    ],
    "forbiddenOverclaims": [
      "Do not claim that needing less depth means the person has failed reparenting or that InnerSignal should be permanently abandoned.",
      "Do not label unrelated practical work as reparenting after the person has declined the frame."
    ],
    "requiredNuance": [
      "A refusal is not a pause: when inner-child framing is declined, stop using that framing and do not create a reactivation condition.",
      "For tolerance or safety pauses, continuity state is preserved without being surfaced during acute safety work; re-entry requires agreement and begins at or below the last tolerated level."
    ]
  },
  "recommendations": [
    "If stopping, return, or orientation is currently compromised, stop the inner exercise and orient outward first. Do not trial another inward technique until those capacities recover.",
    "If inward attention itself is worsening things, step outward first: an ordinary adult action, real human support, or a brief eyes-open acknowledgment may preserve care without demanding more inward attention.",
    "When the person still wants inner-child work but depth is too much, reduce depth rather than abandoning the relationship. A full tolerance pause is last-resort; a safety gate may require a pause regardless.",
    "Record the pause reason, last tolerated level, and an observable reactivation condition that includes the person's agreement. Do not surface continuity language during an acute safety turn.",
    "When status is paused_tolerance or paused_safety, do not run a child-facing titration ladder. Preserve the pause until the separate reactivation gate clears."
  ],
  "successSignals": [
    "The person retains choice and ordinary functioning while care/protection continues at a tolerable level or a safety/tolerance pause is clearly bounded.",
    "Any later re-entry is consensual and begins at or below the last tolerated level."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/governance/amendments/AMEND.IC.CONTINUITY_TITRATION]]

[[current/sources/inner-child-guide/IC.BEFORE_DEEP]]

[[current/sources/inner-child-guide/IC.THREE_FUNCTIONS]]

[[current/sources/inner-child-guide/IC.SESSION_CLOSURE]]
