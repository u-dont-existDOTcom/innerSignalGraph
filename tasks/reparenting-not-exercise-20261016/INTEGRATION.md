# Reparenting is not an exercise (2026-10-17)

## Owner outcome and authority

Issue #168, part A, opened by the owner on 16 Oct 2026 (23:27 UTC): "Reparenting is not an exercise." The work of
helping a person internally experience safety while expressing authentic feelings, needs and boundaries is reparenting,
not a separate therapeutic goal that reparenting might optionally support. Inner-child meditations, imagery, dialogue or
affirmations can be methods within reparenting, not its definition, prerequisite or full measure of success. The issue
asks for the instructions behind the failure to be repaired without weakening the protective-compatibility, noncoercion,
uncertain-memory, self-harm and source-provenance limits, with synthetic tests and a check of the served route. Part B
(the journal pointer graph) is a separate branch.

## The observed failure

After reading an authorized imported journal, a ChatGPT answer to the owner as supervisor described reparenting as a
possible adjunct to the primary goal of felt safety and self-expression and focused on an imaginal meditation as an
exercise; it accepted the owner's correction. The issue calls this a consumer comprehension failure. The conversation is
not in the repository, so it can't be told from here whether that session loaded the therapy protocol; the cause below is
a contributing cause in the instructions, not a proven sole cause. A model's general prior that reparenting is a
technique also plays a part, and nothing the connector served corrected it.

## Activated sources (main `48b3421f`)

The connector path (ChatGPT, Claude) gets the server's `initialize` instructions, tool descriptions and, when it calls
`load_therapy_protocol`, the served `SKILL.md` body and seven reference files. The app's own model roles get the prompt
modules. Live check, 17 Oct (public `get_therapy_protocol_manifest`): the hosted connector serves protocol 0.2.1,
`protocol_sha256` `a2d9e75dd7128b844f1cfa31c4b3187d8bdc54a5fb6308eb0f8de6dadba66013`, and every file hash equals the
files built from `main` `48b3421f`.

| Source | Consumer | What it said | Part in the false contrast |
| --- | --- | --- | --- |
| `references/PROTOCOL-STATE-PROVENANCE.md` line 11; mirror `src/prompts/protocol-provenance.mjs` line 9 | connector; every app role (extraction directly, the rest through `src/prompts/common.mjs` lines 53 and 97-112) | "A good hypothetical caring response establishes accessible response content, not completed reparenting … Reuse the person's own words to invite the actual imaginal child/adult exercise" | the only served sentence about reparenting: it sets caring words against "completed reparenting" and names the imaginal exercise as what would establish it |
| same file line 7; module line 5 | same | the evidence ladder (method taught, hypothetical response, imaginal enactment, child reception, response pattern) | the protocol's only progress model; nothing tracked reparenting outside an exercise |
| `references/INNER-CHILD-THERAPY-MAP.md` line 124 (generated from `authoring/overlays/inner-child.overlay.json`) | connector | overlay label "Hypothetical care is not enacted reparenting" | the map's only reparenting label equates it with an enacted exercise |
| served `SKILL.md` | connector | no definition of reparenting; "exercise" only for the protective-compatibility check and the inner-speech screen | omission |
| `src/server/private-case-mcp.mjs` lines 244 and 252 | connector | load the protocol "before any inner-child, younger-self, or self-relationship therapy response" | a supervisor's review of journal material may not count as a therapy response, so the protocol may not have been loaded |
| journal tool descriptions, `src/journal-import/http.mjs` lines 67-90 | connector | quoting, dating and dream/wish/hypothetical rules | none: no therapy concept |
| `references/GUIDE-REFERRALS.md`, `references/PROTECTIVE-COMPATIBILITY.md` | connector | guide named "Inner Child Reparenting"; HOLD/BLOCKED stops child contact, "The restriction is not withdrawal of care" | none |
| `src/prompts/case-extract.mjs` line 64 | extraction | `ic_real_world_transfer` is `not_in_play` when no exercise is compared | could be read as "no reparenting" for someone who protects themselves without any exercise |
| constitution (`src/therapy/constitution.mjs` line 22), `src/prompts/common.mjs` lines 66 and 68, graph nodes (`IC.PRACTICE_TO_LIFE_TRANSFER`, `IC.PROTECTOR_ACTION`, `IC.CONTINUITY_TITRATION`, `ROUTE.ACT_OUTWARD`, `ROUTE.COMMUNITY_SUPPORT`), canonical guide r6 lines 11, 165, 195, 313, 323 and 339-347, `AMEND.IC.CONTINUITY_TITRATION` | app roles and upstream authority only | the relationship view the owner describes, and frame consent | none, but none of it reaches the connector, which gets the map's node titles only |

## What changes

1. **Owner amendment** `AMEND.IC.REPARENTING_NOT_AN_EXERCISE_20261016` (owner amendments r12), in his words with the
   repair rules from the issue. It reads `AMEND.IC.PRACTICE_TO_LIFE_TRANSFER`'s in-session capacity as one kind of
   reparenting evidence, and keeps the frame-consent rule of `AMEND.IC.COMMUNITY_REPARENTING` and
   `AMEND.IC.CONTINUITY_TITRATION`.
2. **Map:** the overlay is "Hypothetical care is not an enacted exercise"; its description says the ladder tracks one
   exercise, not reparenting, and cites the amendment. Regenerated: compiled bundle, owner-amendment source map, report,
   authoring projection (hash metadata in every note) and the byte-identical served map.
3. **Shared rules and served reference:** a new first section, REPARENTING AND EXERCISES: the definition; exercises as
   methods within it; exercise evidence (taught, attempted, response reported, impact unknown) kept apart from ongoing
   reparenting evidence (what the person reports doing for the vulnerable self in daily life, and what it changed, each
   at its own date); no inference of progress from words or of absence from missing imagery, breakthrough or relief, and
   progress described only as far as the reports go; no false choice with feeling safe expressing needs and boundaries;
   human support, specialist pain care, medical or crisis care and practical help kept distinct; frame consent restated;
   the hold, intrusive-thought and dream/imagery limits restated. The ladder is scoped to "a particular exercise"; the
   caring answer is "not an enacted exercise", and the imaginal exercise is invited "if the next step is that" exercise.
   Two audit failures: `REPARENTING_EXERCISE_CONFLATION` and `REPARENTING_FALSE_CHOICE` (leaving the label out after a
   declined frame is not a failure). The served reference's heading names reparenting.
4. **Served `SKILL.md`:** a short paragraph with the definition, including for advice to a supervisor, pointing to the rules.
5. **Extraction:** `not_in_play` transfer never means absent reparenting.
6. **Connector trigger:** the server instructions and the `load_therapy_protocol` description also name reparenting work,
   advice to a supervisor about that work and a review of case records or the person's own writing for it. The wording
   avoids the word "journal" because plain-mode instructions must not mention journal work
   (`tests/journal-work-tools.test.mjs`).
7. **Public-guide queue r9:** PGQ-037, placed in "The Three Adult Functions".

## Deliberately unchanged

- Graph nodes, edges, routing and planner: no node wording frames reparenting as an exercise, the graph cases' plans are
  unchanged (110/110), and the therapy latency benchmark's policy fingerprint is unchanged.
- `references/PROTECTIVE-COMPATIBILITY.md` and the response gate (`childContactViolations`): byte-identical; a test pins
  that adult protective language passes the gate while child-directed contact is still caught.
- Every earlier exercise-evidence rule and audit failure; the canonical guide (immutable r6); hypnosis materials; the
  plugin version (0.2.1: the served hash is the identity, as for earlier protocol changes); the journal tools (part B).

## Tests

`corpus/protocol-provenance-cases.json` gains three synthetic cases: everyday protection and boundary-setting without
imagery; an imaginal exercise with no emotional shift; a supervisor asking for felt safety and authentic expression. The
existing delivery test sends each to six consumers. `tests/reparenting-framing.test.mjs` checks the rules, each case's
rules in eight producer, reviewer and repair prompts, a mock pipeline run whose every model request carries them, the
served MCP route (`load_therapy_protocol` over HTTP, served hash equal to the built one, no served file pairing
reparenting with completion or enactment, the protective reference intact), the connector trigger (`initialize`,
`tools/list`), the hold gate, frame consent and the extraction sentence. Its ten original tests fail on the previous
rules. These show delivery, not model adherence; no live model was called.

## Verification

Node 24.18.0 (see the state file for the final counts): authoring check, validate and maps-check; graph regressions
110/110; 57 affected test files 621/621 after the rules change; every test file that runs the MCP server 248/248;
provenance gate against `48b3421f` PASS; therapy-lesson verifier; repository audit; the complete package gate (`npm run verify`) PASS at `bacf5e73`, full suite 2474/2474.

## Served route

This branch serves protocol 0.2.1 with `protocol_sha256`
`ec329fca117eeeb71907aeec5551ef67b892e16a4cc101b1eccb57fd09debb4d`: the instructions, the map and the provenance reference
change, and the other five files are byte-identical to the live ones. After a merge and the owner's `deploy`,
`get_therapy_protocol_manifest` should report that hash (or a later one if `main` changes the plugin first). Behavior
evidence the tests can't give: a fresh connector session on the three synthetic cases.

## Open for the owner

- Whether the wider connector trigger (protocol loaded before supervisor advice and case review) is wanted; it is a
  separate commit and can be dropped on its own.
- Whether to run a live check of the three synthetic cases on the real connector before or after deploy.
- The release route at deploy time, as for the earlier map changes (`docs/RELEASE-EVIDENCE.md`).
