---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-somatic-cross-guide
node_id: ROUTE.ALTERED_PREPARATION
title: Give planned altered-state work a beginning, support plan, and ending
kind: decision-node
tier: 3
priority: 97
authority: author-framework
graph_tags:
  - altered-state
  - preparation
  - consent
  - closure
source_refs:
  - ALT.PREPARATION
  - AMEND.CROSS.STATE_DEPENDENT_TRANSFER
  - AMEND.CROSS.PSYCHOACTIVE_ADVERSE_TRACK_RECORD
regression_refs:
  - G048
  - G058
base_record_sha256: d415d28b026f7169f104175b84a3db7da50667b98764aa8051369fb1bbefa9f5
base_graph_sha256: c2df953667889a1a8f2a6216ef37bed8f0c6361c23ffbb90b12c7e3d7a3ae381
projection_input_sha256: e967ce23f4c59141af29c9a233d076332ce952c804b1721c55ceceda9b501278
---

# Give planned altered-state work a beginning, support plan, and ending

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "all": [
      {
        "field": "altered_phase",
        "op": "eq",
        "value": "planned"
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
      }
    ]
  },
  "avoid": [
    "Do not use ceremony planning once an acute crisis has started; return to acute triage instead.",
    "Do not make a sitter, playlist, spiritual frame, or expected insight into an authority the person cannot stop or change.",
    "Do not treat feeling stable now as proof that retesting is safe after a psychotic-type or persisting perceptual reaction, and do not convert that history into a blanket anti-drug rule."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [
      "Do not claim that a different psychoactive is automatically safe merely because the prior severe reaction involved another substance."
    ],
    "requiredNuance": [
      "Psychoactive risk is informed by both substance-specific history and person-level vulnerability; the response remains proportional rather than universally prohibitive."
    ]
  },
  "recommendations": [
    "Plan rest and timing, physical safety, environment, support, and what would require outside help before the session begins.",
    "Use intention without demanding a particular revelation, memory, emotional arc, or spiritual result; support stays low-directivity and consent-based.",
    "Plan closure, food and hydration when safe, sleep, and protected integration time rather than leaving the session psychologically open-ended.",
    "Familiarize the person soberly with any relevant inner-child, guard, Nurturer, Protector, or Guide map and practice at least one small adult function, so newly accessible material has somewhere to land without requiring belief in advance.",
    "Choose a simple way to preserve what becomes newly real or accessible and name what useful sober carryover would look like afterward; this is a container for whatever happens, not a demand for a breakthrough.",
    "Before planning another altered-state session, ask about prior voices, paranoia, major loss of reality testing, persistent perceptual disturbance, or repeated destabilizing confusion/dissociation from psychoactive substances; one psychotic-type or persisting perceptual reaction warrants professional assessment before retesting that substance and should inform consideration of other psychoactives that can disturb reality testing."
  ],
  "successSignals": [
    "The session has clear safety, consent, stopping, closure, and integration boundaries before altered-state work begins."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/sources/altered-states-map-source/ALT.PREPARATION]]

[[current/governance/amendments/AMEND.CROSS.STATE_DEPENDENT_TRANSFER]]

[[current/governance/amendments/AMEND.CROSS.PSYCHOACTIVE_ADVERSE_TRACK_RECORD]]
