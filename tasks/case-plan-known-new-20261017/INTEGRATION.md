# A lasting plan for each case, and new versus known: Change A (2026-10-17)

## Owner outcome and authority

Issue #172, opened by the owner on 17 Oct 2026 (12:01 UTC) after his fresh ChatGPT check of the journal graph: does every
case have a durable, prioritized therapy plan that guides therapy across sessions? After an extensive journal import, the
supervisor answer described as a new idea something long established, did not say what the journal changed in the case's
plan, and again set everyday protective action and practical safety against reparenting, which the deployed rules
forbid. The issue asks for the plan in the existing encrypted case state, a known versus genuinely new check for any
longitudinal synthesis, the root cause found before more advisory wording, synthetic tests, and the smallest sufficient
plan with a reviewed implementation candidate; an owner decision only if the clinical priority hierarchy itself would
change. It is not an authorization to change any client's treatment plan. The plan, with Change B (the plan in the
record), is `docs/superpowers/plans/2026-10-17-case-plan-and-known-vs-new.md`.

## The observed failure, and what can be seen of its cause

The conversation is not in the repository and contains private material, so nothing here quotes it. Whether that chat
loaded the therapy protocol cannot be seen either: the connector kept no record of which tools a conversation called
(owner question 40). The issue lists five candidate causes; the code and the served rules on `main` `87dce2de` show:

| Candidate cause (issue) | Finding |
| --- | --- |
| missing tool or skill activation | Possible, not visible: the server's instructions ask for `load_therapy_protocol` before a review of case records or the person's writing (since #170), but a host can skip it, and the case tools returned the record without any rules. No trace existed. |
| failure to apply the loaded protocol at final synthesis | Partly explained by what the protocol said: the served rules had nothing on telling an established point from a new one in a review across sessions or a journal (the app's own roles have four longitudinal rules, `longitudinalClinicalRules`, that never reached the served path), and the reparenting rule listed "practical help" among the interventions kept separate from reparenting, the exact split the owner saw. |
| missing ranked goals | Confirmed: `case_state` (version 1) holds evidence, hypotheses, settled answers, intervention history, one `current_episode` and parked focus questions, but nothing ranks goals or records who set a priority. Change B. |
| missing journal-to-state reconciliation | Confirmed in part: nothing marks which journal material the record has already established; the known-versus-new rule asks the review to check, and Change B adds a check tool. |
| stale historical `current_episode` | Not shown: the episode is a single operational slot by design; Change B links it to the goal it serves. |

## What changes (Change A)

1. **Longitudinal synthesis, served.** `src/prompts/longitudinal-synthesis.mjs` defines the four longitudinal rules the
   app roles already followed (byte-identical lines, now defined once and used by `src/prompts/common.mjs`) and the
   owner's KNOWN VERSUS NEW rules: check a point against the established record before calling it new and say what it
   is (established and where, a new example, a contradiction, a new actionable lever, a change to what comes first);
   report what changes the next step or the order, not more examples of a known problem; an old theme is not new
   because its source format is new; an imported journal's model-made labels are search aids, not diagnoses, findings
   or approved goals; a priority keeps its source (the client's choice, an authorized decision, a model's proposal);
   safety and withdrawn consent can override the order. Audit failure `KNOWN_PRESENTED_AS_NEW`. Served as
   `references/LONGITUDINAL-SYNTHESIS.md`, read before every response; the served `SKILL.md` says so in two sentences.
   The app roles that compose, review or repair a response get the same rules and the audit failure through
   `longitudinalClinicalRules`; the extraction records observations and composes no review, and gets the rule on a
   priority's source in Change B, when it proposes goals.
2. **Reparenting wording.** The rule in "Reparenting and exercises" (`src/prompts/protocol-provenance.mjs` and its served
   mirror): a protective act the person takes for the vulnerable self in daily life, such as keeping a boundary, leaving
   or avoiding a harmful situation, resting or arranging practical safety, is reparenting when the person uses or
   welcomes that frame, not a separate therapy; independent services (concrete help from other people, specialist pain
   care, medical or crisis care) stay separately available and distinct, are not reparenting exercises, and are not
   replaced by it. `REPARENTING_FALSE_CHOICE` also names setting everyday protective action and practical safety
   against reparenting as a separate track. The served `SKILL.md` adds one sentence; the map overlay's description
   (authoring projection only; the served map's diagram is unchanged) names the clarification and its amendment.
3. **The rules travel with the case.** `load_handoff`, `load_case_context` and `load_case_context_by_alias` results carry
   `therapy_rules`: the protocol's identity (id, version, hash), the two served references above byte for byte with
   their hashes, and a note to call `load_therapy_protocol` for the complete rules before advising. Without a protocol
   the field says the rules are unavailable and not to improvise them; the case still loads. Other tools are unchanged.
4. **A content-free trace.** `createPrivateCaseMcpServer` takes an optional `callLog`; the connector process passes one
   that writes a JSON line per tool call to stderr (stdout keeps only the ready line): `event`, `at`, `tool` (an
   advertised name, else `unknown`), `ok`, `code` (a fixed identifier, else `OTHER`), `ms`, `bytes`. Never arguments,
   case references or content. A failing trace never breaks a call.
5. **Owner amendments r13:** `AMEND.IC.PROTECTIVE_ACTS_ARE_REPARENTING_20261017` and
   `AMEND.CROSS.KNOWN_VERSUS_NEW_SYNTHESIS_20261017`, the owner's words from #172. Graph bundle, source maps, authoring
   projection and map regenerated (65 amendments).
6. **Public-guide queue r10:** PGQ-038 (keeping yourself safe is part of the work, not a separate track), placed in "Make
   the Protector Visible". The known-versus-new rule is for reviews by the app and connector hosts, not reader-facing.

## Deliberately unchanged

- The case state schema and every stored record (Change B adds an optional field; nothing here reads or writes cases).
- Graph nodes, edges, routing and planner; the canonical guide (immutable r6); the protective-compatibility reference
  and child-contact gate; every earlier exercise-evidence rule; the extraction prompt; the plugin version (0.2.1: the
  served hash is the identity).
- The clinical priority hierarchy: no priority is set or changed; nothing here needs an owner decision.

## Tests

- `corpus/longitudinal-synthesis-cases.json`, four synthetic cases: a journal that repeats an established theme; one that
  adds a new actionable lever; model-made tags offered as a new primary goal; a safety need against the ordinary order.
  `tests/longitudinal-synthesis.test.mjs`: the four existing rules appear once each in the shared rules and in the served
  reference; the known-versus-new rules and audit failure reach the seven response, review and repair prompts once each,
  with each case; the served reference mirrors the module, is in the always-read list and is served byte for byte.
- `corpus/protocol-provenance-cases.json` gains a supervisor proposing to pause reparenting for practical safety as a
  separate track; `tests/reparenting-framing.test.mjs` checks its rules in eight prompts and the served instructions.
- `tests/therapy-protocol-mcp.test.mjs`: the three opening tools carry the two references byte for byte with the
  protocol's identity, in the structured result and the text; no protocol, no rules, the case still loads; the trace's
  fields, outcomes and codes (`unknown` for an unadvertised name, `OTHER` for a code that isn't an identifier), its byte
  count, and the absence of every argument, case reference and content; a failing trace and a non-function trace.
- `tests/private-case-continuity.test.mjs`: the real connector process (CLI) returns the rules with a handoff and an
  alias, and its stderr trace lists the session's calls with no case ID, handoff ID, token, alias or content.
- Pinned counts and version updated in `tests/guide-graph.test.mjs`, `tests/authoring-projection.test.mjs` and
  `tests/gratitude-love-access.test.mjs`.

These check delivery, not model adherence; no live model was called.

## Served route

This branch serves protocol 0.2.1 with `protocol_sha256`
`7f26685baad7ea2273a3a59a858b36cc31e3d9f54da0ba3fd30932539f976b6d` (live: `23ee74b8…`): the instructions, the provenance
reference, the new longitudinal reference and the map's projection line change; the protocol grows from 52,135 to 56,451
bytes in 8 files. After a merge and the owner's `deploy`, the rebuilt connector should report that hash (or a later one if
`main` changes the plugin first) and its `docker logs` should show one trace line per tool call.

## For the owner

- Each case opening carries about 12 KB more (the two references), sent twice like every tool result (as text and as
  structured content). Recommended: keep it; it is what makes the rules reach a chat that never loads the protocol.
- The trace records which tools a conversation called and when, without content. It answers question 40 for the next
  conversation that goes wrong; it can't answer it for the one in #172.
- Change B (the plan in the record) is a second pull request; it changes no client's priorities either: a model can
  only propose, and its proposals stay labeled as proposals.
