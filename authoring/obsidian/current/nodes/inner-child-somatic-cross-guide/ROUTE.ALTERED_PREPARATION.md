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
base_record_sha256: a5e3cee863d0d87f8aabbfb4d7fe4db8be24af9f47bf6ebc512091cd3d22c535
base_graph_sha256: 32fe4c146863ea66e757304b8b840c4eb219d5d2fdc51ce7c1b1896bb6771455
projection_input_sha256: 61a6f2bc0a4901a995b341b8e10f0a2d918b76e60ce795da05c2e83e93b98ec8
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
    "Do not treat feeling stable now as proof that retesting is safe after a psychotic-type or persisting perceptual reaction, and do not convert that history into a blanket anti-drug rule.",
    "Do not advise abrupt discontinuation of prescribed medication or anything the person is physically dependent on; stopping may require medical guidance."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [
      "Do not claim that a different psychoactive is automatically safe merely because the prior severe reaction involved another substance.",
      "Do not imply that repeated psychotic-type reactions are required before a prior episode matters for retest planning.",
      "Do not advise abrupt discontinuation of prescribed medication or a substance the person is physically dependent on.",
      "Do not imply that apparent stabilization makes retesting a substance safe after a psychotic-type or persisting perceptual reaction."
    ],
    "requiredNuance": [
      "Psychoactive risk is informed by both substance-specific history and person-level vulnerability; the response remains proportional rather than universally prohibitive.",
      "One psychotic-type reaction—voices, paranoia, major loss of reality testing, or a perceptual disturbance persisting beyond expected intoxication—is enough to gate retesting the same substance pending professional assessment; repeated episodes are not required.",
      "Severe, current, risky, or safety-uncertain psychotic-type symptoms call for prompt professional or emergency assessment rather than another altered-state experiment.",
      "The altered-state gate must not be implemented through abrupt stopping of prescribed medication or a physically dependent substance; appropriate medical guidance may be required."
    ]
  },
  "recommendations": [
    "Plan rest and timing, physical safety, environment, support, and what would require outside help before the session begins.",
    "Use intention without demanding a particular revelation, memory, emotional arc, or spiritual result; support stays low-directivity and consent-based.",
    "Plan closure, food and hydration when safe, sleep, and protected integration time rather than leaving the session psychologically open-ended.",
    "Familiarize the person soberly with any relevant inner-child, guard, Nurturer, Protector, or Guide map and practice at least one small adult function, so newly accessible material has somewhere to land without requiring belief in advance.",
    "Choose a simple way to preserve what becomes newly real or accessible and name what useful sober carryover would look like afterward; this is a container for whatever happens, not a demand for a breakthrough.",
    "Before planning another altered-state session, ask about prior voices, paranoia, major loss of reality testing, persistent perceptual disturbance, or repeated destabilizing confusion/dissociation from psychoactive substances; one psychotic-type or persisting perceptual reaction warrants professional assessment before retesting that substance and should inform consideration of other psychoactives that can disturb reality testing.",
    "If psychotic-type or perceptual symptoms are current, severe, risky, or make safety uncertain, prioritize prompt professional or emergency assessment over planning another altered-state session."
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
