# Change D: the person's own protective steps stay with reparenting, next to a service (issue #172, owner answer 43a)

## Why

The protocol application test of #175 (the owner's answer 42c, 17 Oct 2026, 16:06 to 16:45 UTC; synthetic cases, 3
replies each) found the split again with Claude answering and Codex grading: in 1 of 12 replies on #173's rules and 2 of
12 on the earlier ones. Codex answering didn't make it on either. Each time the reply sorted its review by topic and
filed the person's own protective steps (a changed route, a colleague walking her to the car, a night at a friend's)
under a "Safety and legal (a separate service)" heading, a "practical help" track, or "alongside the inner work".

The served rule invited it: next to "arranging practical safety" as reparenting it listed "concrete help from other
people" and "safety services" among what stays separate, wording that goes back to the 16 Oct correction ("concrete
human support ... stay distinct as appropriate"). Owner question 43 asked whether to reword it and test again; the
owner answered 43a on 17 Oct at 17:02 UTC.

## What changes

1. **Owner amendment r14:** `AMEND.IC.OWN_PROTECTIVE_STEPS_WITH_REPARENTING_20261017` records the option the owner
   chose: the person's own protective steps stay part of reparenting even when they sit next to a service, asking
   someone to come along or staying with a friend included; what stays separate is the service itself and the other
   person's help, which is never an exercise. Graph bundle, source maps, report, authoring projection (562 files), map
   and its served copy regenerated (66 amendments).
2. **The served rule** in "Reparenting and exercises" (`src/prompts/protocol-provenance.mjs` and its byte-matched
   served reference): the examples of protective acts add changing a route, asking someone to come along and staying
   with a friend, and a new sentence says that what stays separate is the service, or the other person's help, itself,
   never the person's own step: when an answer sorts things by topic, such as safety and legal matters, the person's own
   protective steps stay with reparenting, not under a services heading or in a separate track.
   `REPARENTING_FALSE_CHOICE` names filing the person's own protective steps under a services heading or track.
3. **The served `SKILL.md`:** its one sentence on protection says the same.
4. **The map overlay** `OVERLAY.IC.PROTOCOL_STATE_PROVENANCE` names the clarification and its amendment (authoring
   projection only; the served map's diagram is unchanged).
5. **Public-guide queue r11:** PGQ-038, still pending, gains the point that asking a friend along or staying with
   someone is still the reader's own step, and that what stays its own thing is the help another person gives.
6. A lesson in `THERAPY-LESSONS` and a sentence in `docs/INSTRUCTION-CONSUMER-MAP.md`.

## Deliberately unchanged

- The clinical priority hierarchy: no priority is set or changed. The list of independent services keeps "concrete help
  from other people", now read as the help itself.
- Frame consent, the safety limits, every exercise-evidence rule, graph nodes, edges, routing and planner, and the plugin
  version (0.2.1: the served hash is the identity).
- The test's rubric in #175 already grades by this boundary: its cases list the person's steps as protective acts and
  the services apart.

## Tests

- `corpus/protocol-provenance-cases.json` gains `supervisor-own-steps-under-services`;
  `tests/reparenting-framing.test.mjs` checks its rules in every producer, reviewer and repair prompt, and pins the
  served `SKILL.md` sentence on the MCP route.
- Pinned counts and version updated in `tests/authoring-projection.test.mjs`, `tests/guide-graph.test.mjs` and
  `tests/gratitude-love-access.test.mjs`.

These check delivery, not adherence. Adherence is what the owner's answer 43a measures: the protocol application test
with Claude answering and Codex grading, on the two cases that split, 6 replies each, on `main`'s rules and on this
branch's (one judge check, then 24 replies with their grades on each: about 61 calls).

## Served route

This branch serves protocol 0.2.1 with `protocol_sha256` `1da3ddf06a27aa8409fe953f21e8d9053d943bf383c04d5c561e2e93bb067a27` (`main`: `021be960…`, live: `ae335dfd…`). After a merge and the
owner's `deploy`, the rebuilt connector should report that hash, or a later one if `main` changes the plugin first.
