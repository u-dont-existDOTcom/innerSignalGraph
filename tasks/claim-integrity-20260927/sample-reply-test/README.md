# Sample-reply test: claim-integrity rules (2026-10-04)

The owner approved the claim-integrity wording on 3 Oct 2026 ("1 A") and asked for sample replies to be tested
for warmth and length before anything ships. This is that test. It is a smoke test on invented conversations, not
a clinical or live result.

## Method

- **Two versions of the served protocol**, rendered exactly as the `load_therapy_protocol` tool returns them:
  without the rules (`main` at `0764ab0`, `protocol_sha256` `6d27393e…4c353`, 7 files) and with them (this branch,
  `dfb72a14…89a54`, 8 files).
- **Twelve invented conversations** (`conversations.json`), each built around one claim the rules govern:
  reflecting feelings (scope words; another person's motives), a corrected reflection, "you never mentioned" (said
  earlier; only part of the history visible), a remembered quote (the person's own words; words they reported),
  estimates (a derived rate; a count and a duration without timestamps), a contradiction across turns, and two
  ordinary turns (a small win; a request for an inner-child exercise).
- **Generation:** 48 replies, two per conversation and version. Each came from a fresh Claude Sonnet agent given
  only its protocol version and the conversation, told it was the assistant in a chat app with the InnerSignal
  plugin connected. All four agents on the habit question (conversation 10), two per version, looked the research
  up on the web despite being told to read only the two files.
- **Rating:** the rubric (`RUBRIC.md`) was fixed before generation. A separate Claude Opus agent rated all 48
  replies blind: replies shuffled within each conversation, labelled R1 to R4, with no indication of version or
  purpose. It scored warmth and responsiveness from 1 to 5, flagged over-hedging, and listed claim problems by the
  six audit check names. Word counts and hedge phrases ("I wonder", "maybe", "it sounds like" and similar) were
  counted mechanically. `replies-and-scores.json` has every reply with its version and rating.

## Results

| | Without the rules | With the rules |
| --- | --- | --- |
| Warmth, mean of 24 (1 to 5) | 3.25 | 3.21 |
| Responsiveness, mean of 24 (1 to 5) | 4.08 | 4.08 |
| Length, mean / median words | 116 / 108 | 106 / 96 |
| Hedge phrases per reply | 0.08 | 0.00 |
| Replies rated over-hedged | 0 | 0 |
| Claim problems found (blocking) | 0 (0) | 0 (0) |

- The rules made replies neither colder nor more hedged; replies with them were about 10 words shorter.
- The test can't show a benefit: neither version made a claim error on these traps with this model. Both quoted
  the person's words exactly, didn't guess who Sam was, limited "you never mentioned" to what was visible, and
  labelled estimates.
- Noticed along the way, in both versions alike: 32 of the 48 replies (16 per version) paused to ask the protocol's
  inner-speech question ("how often are actual silent words or sentences present in your mind…"), including
  straight after a sad disclosure. That comes from the existing protocol, not from these rules.

## Limits

Twelve short conversations and two replies per conversation and version are enough to catch a large shift in
warmth or length, not a small one. One generator model (Claude Sonnet, inside an agent harness rather than a chat
app) and one rater model (Claude Opus) were used; other models, ChatGPT included, may behave differently. Measuring
the benefit would need conversations where errors are likely: long histories with gaps, details from many turns
back, or a model that makes these mistakes more often.
