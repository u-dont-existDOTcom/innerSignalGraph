---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-directed-graph
node_id: IC.MEET_GUARD
title: Hear the protective response without automatically obeying it
kind: decision-node
tier: 3
priority: 93
authority: author-framework
graph_tags:
  - protector
  - guard
  - avoidance
source_refs:
  - IC.START_WHATEVER
  - IC.GUARDS
  - IC.BOTTOM_UP_SEQUENCE
  - IC.ESCAPE_URGE
  - IC.INHERITED_PARENT
  - AMEND.CROSS.LITERATURE_TASK_PROGRESS
  - AMEND.CROSS.PROTECTIVE_ALARM_CALIBRATION
  - AMEND.IC.SHAME_APPRAISAL_REPARABILITY_20261029
  - AMEND.IC.ADULT_PROTECTOR_VS_GUARD_20261022
  - AMEND.IC.PROTECTIVE_NO_AGREEMENT_20261120
  - AMEND.IC.GENTLER_THAN_GUIDE_20261120
  - IC.LIVE_GUIDE_DECISIONS_20261120
  - AMEND.IC.GUARDS_USUALLY_A_MIX_20261120
regression_refs:
  - G001
  - G002
  - G012
  - G029
  - G030
  - G051
  - G052
  - G057
  - G059
  - G069
  - G113
  - G114
  - G115
  - G139
base_record_sha256: 4f9531bf527a4cb5c05a94f6b6b88fe87e9ccf3880bee76fd79c32541c62e099
base_graph_sha256: ce32de79718f698e5051277ebfab6d31ef36b073338d1facbe2cbd68f5ef4519
projection_input_sha256: 9871a63c8240a1413f67f7da724b7a07e7c7069f2a41c45d1fdd6df3c2921de2
---

# Hear the protective response without automatically obeying it

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "any": [
      {
        "field": "protective_response",
        "op": "eq",
        "value": "present"
      },
      {
        "field": "urge_to_escape",
        "op": "eq",
        "value": "present"
      },
      {
        "field": "dissociation",
        "op": "in",
        "value": [
          "mild",
          "high"
        ]
      }
    ]
  },
  "avoid": [
    "Do not classify the voice more confidently than the transcript supports or push past it.",
    "Do not assume an inner critic is a guard: it is one when it works as a self-critical strategy trying to prevent a feared outcome, but a critical voice may also, or instead, replay something learned from a parent or point to a real problem in a cruel way.",
    "Do not equate listening to a protective alarm with obeying it. A protective part's no to going deeper, to an altered state or to sex is neither obeyed nor overridden automatically: hear the part out and look for an agreement every part can accept. An override fits only when the person already understands the no as an old, unhelpful pattern (the owner's example: a part that told him not to talk to strangers); it is not one size fits all. InnerSignal never pushes an override, including through prediction-testing: the person decides."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [
      "IC.DEEP_CHILD_DIALOGUE"
    ],
    "deferralUnless": [
      {
        "field": "guard_engagement",
        "op": "eq",
        "value": "willing_to_allow"
      }
    ],
    "forbiddenOverclaims": [
      "Do not definitively label a cynical voice as a guard.",
      "Do not claim that anxiety or another protective alarm proves the feared conclusion is true.",
      "Do not claim that testing a protective prediction, or InnerSignal's own reading, authorizes overriding a protector's no to deeper or altered-state work, or hesitation about touch or sex; only the person can decide that a no is an old pattern to override."
    ],
    "requiredNuance": [
      "The contempt may be child, protector, adult evaluator, or blend.",
      "Protective intent and predictive accuracy are separate: an alarm can be understandable and still be mistaken, outdated, or overprotective.",
      "Consent, immediate safety and possible medical red flags outrank an experiment with the alarm; use a cheap reversible precaution first and interpret afterward.",
      "Ordinary wishes, habits and critical thoughts are not automatically a guard, a hidden trauma or a separate inner person; test function and context before assigning a role."
    ]
  },
  "recommendations": [
    "Treat cynicism, numbness, anger, scrolling, substances, planning, sleep, or dissociation as information about what the system expects.",
    "Ask what the part predicts will happen if it steps back; acknowledge before answering.",
    "Meet a critical inner voice with compassion, curiosity and understanding as well as firm limits. Where a protective purpose is plausible, do not assume it protects only the younger self: it may be guarding another vulnerable part, belonging, status, control or safety. Explore what it fears or is trying to accomplish when the person finds that useful, treating the answer as a hypothesis; it is not required before the person rejects the insult, sets a boundary or takes relief.",
    "A still-present protector may permit an agreed small step. Notice its current stance instead of requiring it to disappear, and recheck if permission is withdrawn. Presence alone does not prove continued blocking.",
    "For ordinary-life decisions, treat anxiety and other protective alarms as information about expected danger or overload rather than commands or truth detectors; hear what they are trying to protect, then compare the prediction with evidence, current capacity and later outcomes.",
    "When shame becomes shame about being ashamed, distinguish the initial experience from a secondary self-attack and investigate any useful protective aim without treating the first feeling as a malfunction.",
    "Distinguish a learned defensive guard from the chosen Adult Protector role; a guard may carry a useful warning or an obsolete coping tactic, whereas the Adult Protector is the present adult's capacity to protect and respond.",
    "Any guard, whether it stays on duty or jumps in when pain gets close, and any critical voice, an inherited script included, may be helpful, unhelpful or, usually, a mix. Don't decide which in advance. When the person wants to, find out with them by getting to know it (asking it, or just noticing when it shows up and what it's after), to see whether an understanding can be reached; this is never required before they reject an insult, set a limit or take relief. Normally there's something good to keep, though not always, and never invent one: what's kept is what the part is for (rest, relief, safety, a warning), not necessarily its way of getting it. For a critical voice, the reframing trick in the owner's guide (from a film scene with Fred Rogers): stay curious about its motives and open to any kernel of truth, without accepting insults or cruelty, then let it go with compassion. When the person, having got to know a part, finds it isn't helping (the owner's example: a totally useless old script), it can be fully reprogrammed: they choose what they'd rather hear or do at that moment and practise it in place of the old line, firmly or with humour, never with cruelty. Whether a part is that is the person's call; say what you notice only when asked, as a guess. For a part's no to going deeper, to an altered state or to touch or sex, the override rule decides, not this one. A wish to die is handled by the section on someone who may want to die, not here."
  ],
  "successSignals": [
    "The protective response can be heard without running the session or being exiled."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/sources/inner-child-guide/IC.START_WHATEVER]]

[[current/sources/inner-child-guide/IC.GUARDS]]

[[current/sources/inner-child-guide/IC.BOTTOM_UP_SEQUENCE]]

[[current/sources/inner-child-guide/IC.ESCAPE_URGE]]

[[current/sources/inner-child-guide/IC.INHERITED_PARENT]]

[[current/governance/amendments/AMEND.CROSS.LITERATURE_TASK_PROGRESS]]

[[current/governance/amendments/AMEND.CROSS.PROTECTIVE_ALARM_CALIBRATION]]

[[current/governance/amendments/AMEND.IC.SHAME_APPRAISAL_REPARABILITY_20261029]]

[[current/governance/amendments/AMEND.IC.ADULT_PROTECTOR_VS_GUARD_20261022]]

[[current/governance/amendments/AMEND.IC.PROTECTIVE_NO_AGREEMENT_20261120]]

[[current/governance/amendments/AMEND.IC.GENTLER_THAN_GUIDE_20261120]]

[[current/sources/inner-child-guide/IC.LIVE_GUIDE_DECISIONS_20261120]]

[[current/governance/amendments/AMEND.IC.GUARDS_USUALLY_A_MIX_20261120]]
