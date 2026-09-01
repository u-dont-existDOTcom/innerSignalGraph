---
authoring_contract: inner-signal-authoring-node-proposal-v1
entity_type: graph-node-proposal
proposal_id: love-horizon-r1
operation: add
graph_id: inner-child-directed-graph
node_id: IC.LOVE_HORIZON_EXPLORATION
title: Explore a deeper horizon of wellbeing when curiosity is genuine
kind: decision-node
tier: 2
priority: 94
authority: author-framework
graph_tags:
  - spiritual-curiosity
  - love
  - wellbeing-horizon
  - guide
source_refs:
  - AMEND.IC.EXISTENTIAL_LOVE_ROUTING
  - AMEND.IC.WELLBEING_HORIZON
  - IC.GUIDE_LATER
base_graph_sha256: 4cffe0bcadbf49cc3e27dc5274221f51ec252a0226e944b4f5541dda47c6d1d6
base_projection_input_sha256: ebc5fac6453fa4eeabca95b87100a5e351d19e91770f5db7e7a86eab3749b4cb
---

# Explore a deeper horizon of wellbeing when curiosity is genuine

> [!warning] Editable proposal record. Building it never changes canonical graph files.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "all": [
      {
        "field": "spiritual_curiosity",
        "op": "eq",
        "value": "present"
      },
      {
        "field": "deep_love_access",
        "op": "in",
        "value": [
          "none_known",
          "past_glimpse",
          "state_dependent",
          "unknown"
        ]
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
        "field": "ability_to_stop",
        "op": "eq",
        "value": "no"
      },
      {
        "field": "ability_to_return",
        "op": "eq",
        "value": "no"
      },
      {
        "field": "altered_state",
        "op": "eq",
        "value": "altered"
      }
    ]
  },
  "avoid": [
    "Do not prescribe a religion, theism, awakening, nonduality, conversion, psychedelics, NDEs, or a metaphysical conclusion.",
    "Do not imply that everyone needs profound spiritual love when the person says their present horizon is sufficient."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [
      "Do not say everyone needs profound spiritual love in order to heal or live well."
    ],
    "requiredNuance": [
      "The relevant distinction is experiential access to deeper wellbeing and love, not believer versus atheist or one religion versus another.",
      "A conceptual horizon and a directly experienced horizon are different; do not pretend reading about profound love is the same as having touched it."
    ]
  },
  "recommendations": [
    "Invite investigation rather than belief: notice people, practices, traditions, experiences, nature, art, service, prayer, meditation, or other sources whose lived fruits make a deeper kind of love or wellbeing seem worth exploring.",
    "Use metta or loving-kindness as one possible cultivation practice, especially when it feels meaningful, without presenting it as the definition or guaranteed depth of love.",
    "Follow the fruits: prefer paths and exemplars that become more loving, honest, grounded, protective, and able to face pain rather than merely more impressive or certain."
  ],
  "successSignals": [
    "Curiosity becomes a voluntary experiment with no forced doctrine, attainment target, or promise of extraordinary experience."
  ]
}
```
<!-- inner-signal:payload:end -->

## Proposal rationale

Explain why the change is needed, what behavior it should alter, and the worst plausible failure. This prose is review evidence, not executable graph content.

## Regression intent

List the existing or proposed regression cases that should distinguish the old and new behavior.
