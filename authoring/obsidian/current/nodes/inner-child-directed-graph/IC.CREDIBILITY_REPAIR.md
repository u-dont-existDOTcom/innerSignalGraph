---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-directed-graph
node_id: IC.CREDIBILITY_REPAIR
title: Repair credibility through non-defensive follow-through
kind: decision-node
tier: 3
priority: 96
authority: author-framework
graph_tags:
  - credibility
  - protector
  - repair
source_refs:
  - IC.PROTECTOR_VISIBLE
  - IC.VOW
  - IC.BOTTOM_UP_SEQUENCE
regression_refs:
  - G001
  - G012
base_record_sha256: feff1a99edf74330f480df74c64d641813452d7eddb299e6b8e3c4a32a86ff23
base_graph_sha256: 4cffe0bcadbf49cc3e27dc5274221f51ec252a0226e944b4f5541dda47c6d1d6
projection_input_sha256: ebc5fac6453fa4eeabca95b87100a5e351d19e91770f5db7e7a86eab3749b4cb
---

# Repair credibility through non-defensive follow-through

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

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
        "field": "self_directed_love",
        "op": "eq",
        "value": "unsafe"
      }
    ]
  },
  "avoid": [
    "Do not substitute a grand vow for evidence or retaliate when the younger state is unimpressed."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [
      "Do not say the child is rejecting love when it may be rejecting an unsafe or unproven source.",
      "Do not describe the problem as simply lacking a track record when the user has already supplied adverse evidence about how things went."
    ],
    "requiredNuance": [
      "Action is essential but not the sole repair; accurate responsibility and non-defensive listening also matter.",
      "Relaxation may reduce nervous-system charge, but it does not by itself repair a credibility conflict or change a contradictory track record.",
      "The sarcastic question can be both contempt and a legitimate literal request for evidence; answer it concretely rather than arguing with it.",
      "A pre-existing adverse track record is different from having no track record yet."
    ]
  },
  "recommendations": [
    "Hear the angry side's exact accusation before trying to resolve the conflict: what does it believe the younger version should have done, at what age, and with what available capacity?",
    "Treat skeptical or contemptuous questions as data and, when appropriate, literal requests for evidence.",
    "Distinguish no track record from an adverse track record. If the younger state is already pointing to how adult life turned out, credibility repair means building counterevidence against an existing negative assessment rather than acting as though evidence starts at zero.",
    "Make one ordinary protective act visible and do not demand gratitude, trust, or emotional change.",
    "Repair after internal attacks; make one protective act visible, demand no immediate trust, and keep showing up consistently."
  ],
  "successSignals": [
    "Promises and actions begin to align; an adverse track record starts accumulating credible counterevidence without demanding immediate trust."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/sources/inner-child-guide/IC.PROTECTOR_VISIBLE]]

[[current/sources/inner-child-guide/IC.VOW]]

[[current/sources/inner-child-guide/IC.BOTTOM_UP_SEQUENCE]]
