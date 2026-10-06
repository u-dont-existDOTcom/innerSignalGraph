# Inner-speech question timing: sample-reply rerun (2026-10-06)

The owner said the inner-speech question comes up too much. The served protocol told every model to ask it "near
the beginning of the first substantive therapy interaction", so on a first conversation replies asked it on almost
any turn, including straight after something painful. On 6 Oct 2026 the owner approved replacing that sentence with
this wording (owner questions page, question 10: A):

> Ask this once, before the first inner-dialogue or younger-self exercise, or earlier only when how the person
> thinks clearly matters for the next step. Skip it when the answer is already in the conversation or the records
> supplied to you. Never ask it in reply to something painful the person has just shared, or ahead of a safety or
> urgent issue; respond to what they said first. Then ask one brief non-diagnostic screen:

The question itself is unchanged. This is a smoke test on invented conversations, not a clinical or live result.

## Method

- **Protocol:** `main` at `75ff424` with only the sentence above changed, rendered exactly as the
  `load_therapy_protocol` tool returns it (`protocol_sha256` `efd2ef42…de1e6`, 7 files).
- **Conversations:** the twelve invented first conversations from the 4 Oct claim-integrity sample-reply test
  (`conversations.json`, copied unchanged). None has an inner-speech answer on record. Six end with something
  painful (01, 02, 03, 05, 07, 09); conversation 12 asks for a short inner-child exercise.
- **Generation:** 24 replies, two per conversation, each from a fresh Claude Sonnet agent given only the rendered
  protocol and the conversation and told it was the assistant in a chat app with the InnerSignal plugin connected.
- **Scoring:** a reply counts as asking when it contains the screen's wording (matched mechanically, then read).
  `replies.json` has every reply with that flag and its word count.

## Results

| | Old wording (4 Oct test, `main` version) | New wording |
| --- | --- | --- |
| Replies that ask the question | 16 of 24 | 2 of 24 |
| Conversations where it was asked | 9 of 12 | 1 of 12 (conversation 12) |
| Asked right after something painful | yes, in all six such conversations | never |
| Length, mean / median words | 116 / 108 | 78 / 67 |

- Both asks came in conversation 12, where the person asked for an inner-child exercise: each reply first
  acknowledged "feeling small" and then asked the question before starting, which is what the new wording asks for.
- No reply asked it in the other eleven conversations.

## Limits

The old-wording numbers come from the 4 Oct test, whose `main` (`0764ab0`) differs from today's in other ways, so
this is not a matched comparison; the drop from 16 to 2 is much larger than those other changes would plausibly
explain. One generator model (Claude Sonnet, in an agent harness rather than a chat app), two replies per
conversation, and short invented first conversations; ChatGPT and other models may behave differently. Nothing here
reaches users until the owner approves a deployment.
