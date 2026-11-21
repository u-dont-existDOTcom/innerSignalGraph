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
otherwise see the rules twice or not at all. The first answer can't be much smaller: the crisis section ends 23,449 bytes into the rules, so a lower cap would push it out of the first answer. A larger cap (fewer groups) waits for a measurement of what the apps keep: the release's first check is a real ChatGPT chat, with rollback one command away.

**Parts.** The parts are the packaged files' own bytes, cut only at headings (`textPieces`: level-2 headings, then
level-3, then paragraphs, then lines, consecutive pieces joined while they fit, never reworded), each at most 24,000
bytes (`PROTOCOL_PART_MAX_BYTES`):

| Part | What | Bytes |
|---|---|---|
| `rules/1`, `rules/2` | SKILL.md's body, cut at a level-2 heading right after the crisis section | 23,449 and 7,723 |
| `references/…` | each served reference file (all fit whole today) | 2,789 to 23,226 |
| `boxes` | the box file's opening and group headings as written, then every box's name and title | 7,741 |
| `box/<ID>` | one box's section of the box file, heading to heading | 70 parts, up to 10,231 |
| `group/1` to `group/5` | names for the groups to load before the first reply | (aliases) |

The protocol hash is unchanged in definition (it covers the files, not their packaging), so `/health`, the manifest
and handoffs keep their meaning. The manifest adds every part's name, size and hash, what the first answer holds and
the groups. Every part that could outgrow an answer (the rules, a reference, the box list, a box) is cut into numbered
pieces, its plain name standing for all of them.

**The first answer** (no inputs): the version and hash, a loading note, the groups by name with what each holds, then
`rules/1`: the rules from their first byte through the whole section on someone who may want to die (26,215 bytes in
all, 26,414 with a changed-protocol note). Its size is measured with the group list and that note at their longest, so it
can't exceed the cap. The loading note says:
- load every group before the first reply (one call per group, possibly at the same time), with `protocol_sha256`;
- one exception: if the person says they want to die, may act on it or has already taken something, reply at once from
  the crisis section (whole in this answer) and load the groups before the next reply;
- part names are the rules' own paths; load a box's advice by name before using the box; load the guide referrals when
  the rules say to;
- send `protocol_sha256` with every call, start again if an answer says the protocol changed, reload a part a long chat
  has dropped, and ask for fewer parts if an answer looks cut;
- if `parts` isn't among the tool's inputs, the app holds an older tool list: tell the user the connector's tools need a
  refresh, give no therapy from this part alone or from memory, and if the person may want to die follow the crisis
  section first and leave the refresh for later.

**Before the first reply** (five groups, each answer 21,730 to 27,701 bytes, all fitting whole), most urgent first:
`group/1` = the rest of the rules, the box list (with its rule to keep the safer reading where a box and the rules seem
to differ) and the four inner-child safety boxes; `group/2` = the protective-compatibility file and the four safety
routes, with one more reference; then the other always-read files.

**The safety boxes** are tier 1 of the compiled inner-child map and of the cross-guide routes: `IC.SAFETY_ORIENTATION`,
`IC.SUICIDAL_ADULT_SEAT`, `IC.SUICIDAL_SELF_DEATH_INQUIRY`, `IC.PRECIOUS_HUMAN_OPPORTUNITY`, `ROUTE.MEDICAL_RED_FLAG`,
`ROUTE.ALTERED_MEDICAL_SAFETY`, `ROUTE.REFRACTORY_PAIN_NAVIGATION` and `ROUTE.FRESH_GRIEF_FIRST`. The section on someone
who may want to die relies on three of them ("Then the boxes on the adult seat, the self/death inquiry and this precious
human life"); the routes carry the urgent-medical, pain and fresh-grief cautions. `SAFETY_BOX_IDS` is checked against both
maps' tier 1 by a test, and a box file missing any of them makes the protocol unavailable.

**Later calls** name parts: each part in the order asked that still fits (a smaller one after a part that doesn't may
still go in), measured with the longest list of what is still to load, so an answer never exceeds the cap; the rest are
named for the next call. Names resolve leniently: a group's name or number, a reference's file name with or without
`references/` or `.md`, any case, quotes and brackets around a name, `./`, `boxes/` for `box/`, a box ID alone, `rules`,
the box file's path for the box list, and `parts` sent as one string (a JSON list, or names separated by commas or
spaces). A request whose names are all unknown says "none of the names you sent is a part of this protocol" and lists the
kinds of names. A `protocol_sha256` that isn't the current one (in any case) gets the first answer again with a note that
the protocol changed. A malformed request is a tool error the model can read (its message is in the structured result
too).

## Two sentences of the rules change (i60a)

- SKILL.md's read-before-responding sentence no longer lists `references/INNER-CHILD-BOX-GUIDANCE.md`: its 201,447
  bytes would take eight answers, and i60a sends a box's advice when the box is in play.
- The box sentence now reads: "The advice and cautions inside each box of the map, and the cross-guide routes, are in
  `references/INNER-CHILD-BOX-GUIDANCE.md` (one section per box): read a box's section before you use that box." When the
  box advice is switched off (`SERVE_INNER_CHILD_BOX_GUIDANCE`), `withoutBoxGuidancePointers` drops that whole sentence;
  an earlier draft with a comma after the path was mangled by that filter, and a test caught it.

The Codex plugin reads the same SKILL.md from its own files, so it too reads a box's section when it uses the box.

## What a chat costs

Before its first reply a chat now makes six calls (the first answer and five groups) and reads about 156,000 bytes,
against one call and 325,393 characters (most of it cut on ChatGPT) in 0.2.5. Claude can make the five group calls at
once; ChatGPT makes them one after another. Each later box costs one call of 1,000 to 10,000 bytes.

## Tests

- `tests/split-delivery.test.mjs`: every answer fits (the first, each group, each part alone, a request for 40 parts,
  the longest lines around the largest part, made-up rules of other sizes with a changed-protocol note, a box list too
  long for one answer); the first answer holds the rules' start and the whole crisis section; the
  parts rebuild every served file byte for byte and every hash is its text's; the before-first-reply set is exactly
  the rules, the files the read-before-responding sentence names, the box list and the safety boxes; the safety boxes
  are the compiled map's tier 1; the box list names every box once and every box the map shows; lenient names,
  unknown names, the still-to-load list; a changed hash; box advice switched off; `textPieces` keeps every byte and cuts
  only where it should, multi-byte characters whole; and over MCP the schema, the text-only answer and readable errors.
- The older tests that read the single answer load the parts the way an app would (`tests/helpers/whole-protocol.mjs`).
  The protocol-application evaluation's answering model can't call tools, so it gets the first answer, each group by
  name and then every other part, as an app has them once it has loaded each box it uses.
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

## Reviews

**Fable's red team of `7c46bf780`** (nine findings; it also fuzzed 4,000 requests and found none over the cap):
1. A crisis reply waited behind five calls: the loading note now has the crisis exception.
2. An app with the old tool list got contradictory guidance: the note now says no therapy from the first part alone, the
   crisis section first and the refresh after; the release has the owner refresh both apps.
3. Group inputs named the safety boxes: groups are now called by name (`group/1`).
4. The box list's safer-reading rule came last: it is now in `group/1`, with the protective-compatibility file in `group/2`.
5. Wrongly sent names failed softly: names now resolve leniently, and an all-unknown request says so plainly.
6. Later turns: the note now says to send the hash on every call and to reload a dropped part.
7. The cap is unmeasured in ChatGPT: kept at 28,000 bytes (the first answer can't shrink without pushing the crisis
   section out); measured on the release's first check, rollback ready.
8. Four safety routes came only on demand: they are tier 1 of the cross-guide routes and now load before the first reply.
9. Tests that claimed more than they checked: renamed or made exact.

**Codex's review of `7c46bf780`** (seven findings):
1. (High) The old-tool-list fallback allowed incomplete therapy: fixed with Fable's 2.
2. The first answer's size left out its group list and a changed-protocol note: now measured at their longest.
3. A box list too long for one answer could never load: it is now cut into numbered pieces like any part.
4. The safety-box check counted pieces, not boxes: it now checks each box by its ID.
5. The evaluation's model couldn't load the boxes it uses: it now gets every part.
6. The box file's rebuild test wasn't exact: `boxSections` is tested exactly, and the docs say how the box file is served.
7. The safeguards page described this as live: it now says built and not live until the release.
