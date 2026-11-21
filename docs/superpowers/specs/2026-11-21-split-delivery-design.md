# InnerSignal in parts: every app gets all the rules (owner answer i60a, 21 Nov 2026)

## The problem

InnerSignal 0.2.5 (live 21 Nov 2026, 04:05 UTC) answered `load_therapy_protocol` with one text of 325,393 characters
(the rules, 31,146 bytes, then ten reference files, the box advice alone 201,447 bytes), plus the same again as
structured content. Checked in real chats right after the release:

- **ChatGPT** kept the first ~19,650 and the last ~19,760 characters and dropped the middle, with the notice
  "Warning: truncated output (original token count: 496108)". It quoted the owner's Signal sentence and the
  protocol's last sentence exactly and could see nothing in between: the crisis rules from step 4 on, every later
  section of the rules and every reference file, so all the box advice. With 0.2.4 (rules of about 17,000 characters)
  it had kept the rules whole.
- **Claude** (Claude Code and claude.ai with code tools) replaced the result with a size notice and saved it to a
  file, which the model read in full. A Claude chat without file tools would see only the notice.
- OpenAI documents no limit. Developer reports say ChatGPT truncates tool results to a budget, and that when a result
  has both text and structured content the model may see only the structured content
  (community.openai.com threads 1383071 and 1369519; openai/openai-apps-sdk-examples issue 144).

The owner chose i60a: send InnerSignal in pieces, the rules first, small enough for ChatGPT, then one reference file or
one box's advice at a time when it's needed; the apps get one refresh; design, a second model's review and tests, then a
release question.

## The design

**One tool, two optional inputs.** `load_therapy_protocol` keeps its name; its input schema gains `parts` (1 to 40 part
names) and `protocol_sha256` (the hash from the first answer). The tool list changes, so the ChatGPT app and the Claude
connector each need one refresh after the release; the activation script's tool-list gate must pin the new list.

**Answers are text alone and at most 28,000 bytes.** `PROTOCOL_ANSWER_MAX_BYTES` is 28,000 bytes of answer text, about
7,000 tokens: 71% of what ChatGPT showed of 0.2.5 (~39,400 characters), and far under the 25,000 tokens Claude hosts show
before moving a result to a file. No structured content: an app that shows the model only the structured part would
otherwise see the rules twice or not at all. At 31,000 bytes the groups below would drop from five to four (one call
fewer); that waits for a measurement of what the apps keep.

**Parts.** The parts are the packaged files' own bytes, cut only at headings (`textPieces`: level-2 headings, then
level-3, then paragraphs, then lines, consecutive pieces joined while they fit, never reworded):

| Part | What | Bytes |
|---|---|---|
| `rules/1`, `rules/2` | SKILL.md's body, cut at a level-2 heading | 24,456 and 6,690 |
| `references/…` | each served reference file (all fit whole today) | 2,789 to 23,226 |
| `boxes` | the box file's opening text, then every box's name and title, by group | 7,735 |
| `box/<ID>` | one box's section of the box file, heading to heading | 70 parts, up to 10,231 |

The protocol hash is unchanged in definition (it covers the files, not their packaging), so `/health`, the manifest
and handoffs keep their meaning. The manifest adds every part's name, size and hash, what the first answer holds and
the groups.

**The first answer** (no inputs): the version and hash, a loading note, the groups to load before the first reply,
then `rules/1`, which holds the rules from their first byte through the whole section on someone who may want to die
(26,469 bytes in all). The loading note says: load every group before the first reply (one call per group, possibly at
the same time); part names are the rules' own paths; load a box's advice by name before using the box; load the guide
referrals when the rules say to; ask for fewer parts if an answer looks cut; and, if `parts` isn't among the tool's
inputs, the app holds an older tool list: follow the rules in this answer and tell the user to refresh the connector.

**Before the first reply** (five groups, each answer 7,987 to 27,908 bytes, all fitting whole): the rest of the rules,
every file SKILL.md says to read before responding, the box list, and the four safety boxes. The rest of the rules and
the safety boxes are in the first group, so an app that loads groups in order has them earliest.

**The safety boxes** are tier 1 of the compiled inner-child map: `IC.SAFETY_ORIENTATION`, `IC.SUICIDAL_ADULT_SEAT`,
`IC.SUICIDAL_SELF_DEATH_INQUIRY` and `IC.PRECIOUS_HUMAN_OPPORTUNITY`. The section on someone who may want to die relies on
three of them ("Then the boxes on the adult seat, the self/death inquiry and this precious human life"), so they are
loaded with the rules instead of mid-crisis. `SAFETY_BOX_IDS` is checked against the compiled map's tier 1 by a test.

**Later calls** name parts: as many as fit, in the order asked, each measured with the longest list of what is still to
load, so an answer never exceeds the cap; the rest are named for the next call, and unknown names are reported (at most
five echoed, each cut at 60 characters). Names resolve leniently: a reference's file name without `references/`, a box
ID without `box/`, `rules` for all the rules, and the whole box file's path for the box list. A `protocol_sha256` that
isn't the current one gets the first answer again with a note that the protocol changed. A malformed request is a tool
error the model can read (its message is in the structured result too).

## Two sentences of the rules change (i60a)

- SKILL.md's read-before-responding sentence no longer lists `references/INNER-CHILD-BOX-GUIDANCE.md`: its 201,447
  bytes would take eight answers, and i60a sends a box's advice when the box is in play.
- The box sentence now reads: "The advice and cautions inside each box of the map, and the cross-guide routes, are in
  `references/INNER-CHILD-BOX-GUIDANCE.md` (one section per box): read a box's section before you use that box." When the
  box advice is switched off (`SERVE_INNER_CHILD_BOX_GUIDANCE`), `withoutBoxGuidancePointers` drops that whole sentence;
  an earlier draft with a comma after the path was mangled by that filter, and a test caught it.

The Codex plugin reads the same SKILL.md from its own files, so it too reads a box's section when it uses the box.

## What a chat costs

Before its first reply a chat now makes six calls (the first answer and five groups) and reads about 143,000 bytes,
against one call and 325,393 characters (most of it cut on ChatGPT) in 0.2.5. Claude can make the five group calls at
once; ChatGPT makes them one after another. Each later box costs one call of 1,000 to 10,000 bytes.

## Tests

- `tests/split-delivery.test.mjs`: every answer fits (the first, each group, each part alone, a request for 40 parts,
  the longest lines around the largest part); the first answer holds the rules' start and the whole crisis section; the
  parts rebuild every served file byte for byte and every hash is its text's; the before-first-reply set is exactly
  the rules, the files the read-before-responding sentence names, the box list and the safety boxes; the safety boxes
  are the compiled map's tier 1; the box list names every box once and every box the map shows; lenient names,
  unknown names, the still-to-load list; a changed hash; box advice switched off; `textPieces` keeps every byte and cuts
  only where it should, multi-byte characters whole; and over MCP the schema, the text-only answer and readable errors.
- The older tests that read the single answer load the parts the way an app would (`tests/helpers/whole-protocol.mjs`),
  and the protocol-application evaluation sends the answering model the first answer and one call per group.
- Model tests before the release: GPT through Codex with this branch's connector on the laptop (synthetic
  conversations: an ordinary inner-child question, a crisis, an inner critic), checking that it loads every group before
  replying, loads a box before using it, and keeps the crisis rules. Results:
  `/home/joel/askrigor-releases/20261121-innersignal-split-delivery/tests/`.
- After the release: the same check as on 21 Nov in a real ChatGPT chat and a real claude.ai chat, plus whether any
  answer shows a truncation notice.

## Not changed here

- The case-opening tools still carry two reference files with each opened case (`therapy_rules`, about 16,000 bytes
  with the case data); in ChatGPT a large case could be cut too. A follow-up if the owner's ChatGPT case reviews need it.
- The InnerSignal runner on the AskRigor runner's core (owner promise P50) removes the app limits altogether; this
  change is what works inside today's apps.
