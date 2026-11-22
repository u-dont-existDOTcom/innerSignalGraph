# InnerSignal runner trial: design

Written 21 Nov 2026 for the owner's answers to question i62 (chat, 18:20:12 UTC), from the trial brief
(`/home/joel/askrigor-releases/20261121-innersignal-runner-note/trial-session-brief.md`). Branch
`claude/runner-trial-20261121`, from `origin/main`. Revised after Fable's red team of the first draft
(`/home/joel/askrigor-releases/20261121-innersignal-runner-note/fable-redteam-design-20261121.md`: seven blocking, eight
should-fix and nine minor findings) and again after its fix-check of the revision (`fable-fixcheck-design-20261121.md`
beside it: 19 fixed, 5 partly, four new blocking and six should-fix items). The answer to each is in the appendix.

## What the owner decided

His words: "it should be faster, don't look just at the old app tho, i mean we can use multiple workers perhaps in
parallel to make it faster or no? also take the lessons from askrigor about how to split up the large instructions to
speed things up and increase compliance .... 1a 2 that depends what we find works best and also what people have maybe
not everyone has both, but yeah i assume some combination of the 2 will be best. 3 you can give the crisis response
before the full answer but it shoudl say: "Provisional urgent response: " and then "Thinking more about the full
response..." as it continues 4a 5b 6a".

| Point | What it means for the build |
|---|---|
| 1a, faster | A private trial on InnerSignal's own page (`apps/web`, "Therapy dialogue", `/v1/therapy/respond`), designed fresh. Workers run at the same time wherever they don't wait on each other; each gets only the part of the rules it needs. Measured against a whole-protocol writer and one whole checker. |
| 2 | Every worker can run on Claude or GPT. The tests and what a person has (Claude, ChatGPT or both) decide the mix. |
| 3 | In a crisis, a provisional reply may go out first, headed exactly `Provisional urgent response: `; the page then shows `Thinking more about the full response...` until the full checked reply comes. |
| 4a | When no checked reply can be made, the page says InnerSignal can't answer right now, beside the always-visible line. In conversations about wanting to die or getting safe, after two failed repairs, his fixed message of 1 Nov is shown instead, switched on only after he has seen the test results. |
| 5b | The plan for next time is kept when the person asks, and also offered once at the end of a crisis plan, with the limits in section 9. |
| 6a | Each conversation and its risk record are kept encrypted on his laptop until he deletes the case. |

Two points his words leave open are settings with a default, measured both ways and put to him in the start-using-it
question: whether the provisional reply is for both crisis levels or only for someone who has acted or is about to
(section 4), and whether, in a crisis conversation, every failure shows his fixed message or only failed checks (section 7).

## 1. What the trial keeps, changes and drops

**Kept** from InnerSignal's app: the encrypted case file (`src/storage/private-case-store.mjs`; AES-256-GCM, one file per
case, mode 0600, transcript append-only); the turn controller's lifecycle (encrypted exact inbound, restart-safe invocation
events, candidate, audit, at most two repairs, delivery of exactly the approved bytes); the audit evidence rules
(`src/supervisor/private-candidate-lifecycle.mjs`: approval only with no unresolved substantive or high finding, the three
self-directed-risk codes record-only, the producer can't audit its own text); the eleven repair checks; the risk record
(`src/case-state/self-directed-risk.mjs`) with its lowering rule, the whole-case digest and the older risk turns, given to
the crisis checker; the child-contact gate, now fed by a worker of its own (section 3); the fixed fallback message and its
switch `INNER_SIGNAL_OWNER_FALLBACK` (off by default); the journal slot (`journalEvidenceProvider.freezeForTurn`), unwired
as today.

**Changed**, and listed because the first draft wrongly called them unchanged:
- `src/supervisor/private-therapy-turn-controller.mjs`, on the trial path only: built with `maximumInvocationAttempts: 1`
  (the runtime does its own retries per worker, never for a plan limit, a lapsed sign-in or a refusal); a turn deadline
  passed into the runtime; a branch for `UNANSWERED` that returns the stored closing on a replay (as a delivered turn
  replays); inside the per-case queue (`run`, `runTails`), before a new message, an unfinished turn of that case is closed;
  when the trial page loads, it names its case (`POST /v1/runner/reconcile`, since the store can't list cases), and inside
  that case's queue every unfinished turn of it is closed, except an `APPROVED` one, which is delivered (a turn still running
  in this server is waited for, never closed under it); when an audit fails
  and no repair fits in the time left, or at `DISCRIMINATING_QUESTION_REQUIRED`, the turn is closed as `UNANSWERED` instead
  of producing a discriminator; an operational failure closes it the same way.
- `src/supervisor/private-runtime-turn-lifecycle.mjs`: a terminal state `UNANSWERED`, reachable from every unfinished state
  except `APPROVED`, whose closing holds its kind (`runner_unavailable`, the fixed notice, or `owner_fallback`, his fixed
  message, only after failed checks), a reason code, the exact text and the time; a `runner_reading` record and a
  `provisional` record on the runtime turn.
- `src/storage/private-case-store.mjs`: `recordRunnerReading` (stores the readers' results once per turn, before anything is
  shown, and returns the stored one on a rerun); `recordRunnerProvisional` and `recordRunnerEmergencyLine` (once each per
  turn); `closeRuntimeTurnUnanswered`, which in one mutation appends the person's turn if it isn't in the transcript yet,
  applies the stored readings (R1's to the risk record, R3's to the compatibility record), supersedes an active draft, and
  appends the notice or the fixed message as the exchange's assistant turn; the busy check treats `UNANSWERED` as finished;
  the record check binds a closing to its exact assistant turn.
- A build without these can't open a case that holds one, so the trial keeps its own vault (section 11).

**Dropped** on the trial path (the old path keeps them): the tier choice, the extraction before writing, the graph
planner's plan and stored question, the realization step, the app's own rule text (`sharedClinicalRules`), and the
threat-pathway record (danger to others is read under the crisis section's "Someone else" and "if someone else is in danger
from them" rules instead). What dropping the extraction loses: the case state's items, hypotheses, contradictions, parked
questions (`focus_discipline`), fresh grief and support preference stop growing. Memory across conversations on the trial
path is the earlier turns given as background (section 3) and the risk and compatibility records. The comparison with plain
InnerSignal is on single conversations, where this matters least; the start-using-it question says so.

**One source of rules.** Every worker's rules are cut, when the server starts, from the served protocol exactly as
`loadTherapyProtocol({ boxGuidance: true })` returns it (`src/protocol/therapy-protocol.mjs`). Each part carries the SHA-256
of its bytes; every worker receipt names the protocol version, its SHA-256 and the parts it got. Nothing on the trial path
reads `src/prompts/common.mjs`. Run the trial from `main` (with IS7) or a `stable` checkout to try the released rules.

## 2. The rule parts

Cut by program (`src/runner-trial/rule-parts.mjs`) by headings and one text anchor; a missing heading or anchor stops
startup, so a protocol change that moves one must update the cutter in the same change.

| Part | What it holds | Size on 21 Nov |
|---|---|---|
| `crisis` | SKILL.md "When someone may want to die" (with "Someone else" and "Fasting otherwise"), "Chronic pain care navigation and prior medical harm", and the paragraph of "Reader guides and altered-state routing" that starts "When someone says they are about to take something," | 15.2 KB |
| `skill` | the whole SKILL.md body | 30.4 KB |
| `map` | `INNER-CHILD-THERAPY-MAP.md` | 16.8 KB |
| `box:<ID>` | one box of `INNER-CHILD-BOX-GUIDANCE.md`: 46 inner-child boxes and 24 cross-guide routes, picked alike | 0.4 to 10 KB, median 2.8 KB |
| `box-preamble`, `box-index` | the box file's opening paragraphs; each box's ID and title, one line each | 5.7 KB for the index |
| `ref:<NAME>` | each of the other eight reference files | 2.7 to 22.7 KB |
| `whole` | the whole served protocol | 316.8 KB, about 113,000 tokens |

**Focused** means the whole protocol minus the advice of the boxes not in play: SKILL.md, the map, every reference file
except the box file, and the picked boxes with the box file's preamble (about 120 KB plus the picks, against 317 KB). Every
focused worker gets a short runner preface: which parts it has, that a file the rules name which isn't there wasn't picked
for this moment, and that it has no tools (SKILL.md names host tools and says to read files first).

## 3. One reply: the workers

```text
person's message
  │ program: close any unfinished turn; store the inbound (encrypted); freeze the journal packet; cut this conversation
  ├─► R1 crisis reader     (crisis part; this conversation only)  ─► reading; for acted_or_about_to, the provisional
  ├─► R2 box picker        (map, box index; focused arm only)     ─► up to 6 boxes
  └─► R3 protection reader (PROTECTIVE-COMPATIBILITY; this conversation and the stored gate) ─► compatibility assessment
        │ program: store the readings (recordRunnerReading); check and show the provisional (section 4)
        │ the writer starts when R2 and R3 are done and R1 is done or has used its limit
  W writer (focused or whole) ─► draft, its level, its declared quotes
        │
  ├─► C1 crisis checker    (crisis part, the stored risk record, digest and older risk turns)
  ├─► C2 skill checker     (SKILL.md, RESPONSE-FIDELITY, FOCUS-DISCIPLINE, LONGITUDINAL-SYNTHESIS, GUIDE-REFERRALS)
  ├─► C3 box checker       (map, box index, boxes in play, PROTECTIVE-COMPATIBILITY, PROTOCOL-STATE-PROVENANCE, and the
  │                         crisis part when any reader read a crisis in this conversation)
  ├─► C4 role checker      (ROLE-BELIEF-INTEGRITY, PHENOMENOLOGY-AND-REPRESENTATION)
  └─► C5 repair comparer   (repaired versions only: the previous draft, the findings, the eleven repair checks)
        │ program checks (section 5), with C1's level; merge into one audit evidence for the exact draft
  pass ─► deliver the exact bytes
  fail ─► W repairs with the blocking findings, if the deadline leaves a whole round ─► C1..C5 and program again
  otherwise ─► section 7
```

| Worker | Gets | Returns (schema-checked) |
|---|---|---|
| R1 crisis reader | `crisis`; this conversation's exact turns, the provisional replies shown in it in their places; never the stored risk record or earlier conversations (owner decision D1; `src/case-state/context-window.mjs:104-109`) | `level` (`acted_or_about_to`, `wants_to_die`, `thoughts_no_intent`, `none`, `unclear`); `wish_or_intent` (`wish` or `intent`, for `wants_to_die`); `pain_linked`; `danger_to_others` (they may hurt someone else); `in_danger_from_someone` (someone is endangering them now); `asking_about_someone_else`; `may_be_under_18`; `home_unsafe`; a one-sentence reason; for `acted_or_about_to`, `provisional_reply` |
| R2 box picker | `map`, `box-preamble`, `box-index`; this conversation | up to 6 box IDs (unknown IDs dropped by program) |
| R3 protection reader | `ref:PROTECTIVE-COMPATIBILITY`; this conversation; the case's current gate (a stored restriction is its business: it survives until reviewed) | `compatibility_assessment` in the existing schema (`compatibilityAssessmentSchema`) or null; its evidence IDs are this conversation's turn IDs, and the trial validates it with `validateCompatibilityAssessment` against those IDs (the extraction's observation IDs no longer exist) |
| W writer | focused or whole rules; the runner preface; this conversation with its provisional replies and highlighted lines; up to 20 turns of earlier conversations labeled background; the journal packet when wired; a confirmed kept plan; this turn's provisional reply when one was shown; R1's reading, labeled as one reader's reading of the latest message; the child-contact gate and its route when it is HOLD or BLOCKED | `reply`; `answered_level`; `quotes` (each quote of the person or the journal, with its source id) |
| C1 | `crisis`; this conversation; the stored risk record's digest and older risk turns (as today's audit packet); the draft; the provisional | findings and its own `level` |
| C2, C3, C4 | their parts; this conversation and the same background as the writer; the draft; the provisional; C2 also the quoted spans the writer didn't declare (section 5); C3 also the child-contact gate with its route and the pattern hits (section 5). C3's boxes in play are the box advice the writer had: the picks and any boxes a checker said were missed, in the focused arm with picks; every box when the writer is whole or the picker gave none | findings |
| C5 | the previous draft, the repaired draft, the findings that caused the repair, the eleven checks | findings, and the eleven checks in their exact order |
| Whole checker (arm) | `whole`, everything C1 gets, the undeclared quoted spans, the child-contact gate with its route and the pattern hits, the eleven checks on a repaired version | findings, `level`, the checks |

Every model worker is a fresh call with no tools, no files and no session (section 10). Checkers return findings, never
replacement text (AskRigor's lesson: a step that rewrites loses things). A checker that fails, times out or refuses counts
as "no reading", never a pass: a draft is delivered only when every checker of its arm has read it.

**Findings.** The served rules' own codes where they name one, severity `low`, `medium`, `substantive` or `high`, a one-line
summary, the turn ids it rests on. Crisis codes: `CRISIS_FIRST_STEP_MISSING`, `CRISIS_FIRST_REPLY_SHAPE`, `CRISIS_NEVER_LIST`
(including the word "detox" in any spelling or language), `CRISIS_LEVEL_MISREAD` (the reply answers at another level than C1
reads), and the three record-only codes, among them `SELF_DIRECTED_RISK_OVERREACTION`. C3 may report `BOX_MISSED` with box
IDs; the repair writer then gets those boxes. The merge keeps the record-only rule and gives the audit one context id made
from the checkers' own ids, which differs from the writer's.

**The level, without a program choosing upward.** The provisional follows R1's reading. Program checks of a draft use C1's
level (the whole checker's in that arm). When R1 or the writer read `acted_or_about_to` and C1 doesn't, C1 is told so and
decides; a disagreement it upholds is `CRISIS_LEVEL_MISREAD`, sent to repair, never settled upward by program. "This
conversation is a crisis conversation" (links, "detox", the fixed message, the kept plan's limits) is any turn read
`acted_or_about_to` or `wants_to_die` by R1 or by C1 on any audit attempt (each attempt's level is stored, appended only, even
when another checker gave no reading; a later `none` never erases an earlier crisis reading): those rules only hold things
back, so the protective reading wins there.

**The arms** (section 13): focused or whole writer, split (C1 to C5) or whole checker, plus the cheapest arm, one whole
writer and one whole checker at a lower effort.

## 4. The provisional reply (point 3)

- **When**: by default only when R1 reads `acted_or_about_to`, where seconds matter. A setting (`provisionalLevels`) also
  allows `wants_to_die`; the start-using-it question asks the owner. Measured on 22 Nov (GPT, the 12 conversations read
  `wants_to_die`, 21 turns, against the same turns with the default): first words at p50 9.2 s instead of the full reply's
  25.1 s, but the full reply's p90 rose from 31.1 s to 46.7 s with 3 repairs instead of 0, and 3 of 6 later-turn
  provisionals repeated the four people and links the crisis section gives once (the checker flagged it after it showed).
  The default stays `acted_or_about_to`.
- **Which turn**: with `provisionalTurns` `first` (the default), a provisional reply for someone who has acted or is about to
  only until the conversation has shown an emergency number (a provisional or a delivered reply naming one, or the highlighted
  line), and one for someone who wants to die (only when `provisionalLevels` allows it) only until an earlier turn was read at
  that level; `every` gives one on each such turn, as before 22 Nov. Both go by what was actually shown, never by which levels
  were read (Codex's review of `371a8f6f2`: a numberless provisional for someone who wants to die had counted as the number
  shown). When no level is left, R1's prompt says one was already offered in this conversation, so it gives none; nothing is
  shown or recorded as a provisional, whatever R1 returns, and the skip puts no highlighted line into the conversation. Nor
  does C1's `acted_or_about_to` reading on such a later turn once the conversation has shown a number (see "If it doesn't
  pass" below); the line still shows if that turn ends without a reply. The writer and the checkers are unchanged: the full
  reply comes back to the number as the rules say, and C1 judges it. A new conversation starts again. Why, measured on 22
  Nov: in the GPT test round every later message read `acted_or_about_to` (F2, S4 and S5, after the person refused an
  ambulance or the crisis line) got a provisional again, each repeating the first step almost word for word (the three
  numbers, "I can't know what the pills will do", someone nearby), and the blind judge counted F2 as "repeating the number in
  every line", which the crisis section rules out ("don't repeat it in every line, but come back to it"); with `wants_to_die`
  on, 3 of 6 later provisionals repeated the four people and links the section gives once.
- **What it holds** (the crisis section's first step, written by R1 with only the `crisis` part): that it heard them, the
  emergency number to call now, and the next smallest thing (someone in the house, unlocking the door, keeping the packets),
  or for someone about to act, distance from the means; in their language, short, no headings, lists or bold, at most one
  question in the whole reply, and when R1 doesn't know where they are, that question is where they are (the first step
  says to ask where they are and the first reply to ask one question about now: Claude's provisionals asked both, where
  they are and whether anyone is near, and the one-question check refused them). Never what what they took could do to
  them. R1's prompt states the provisional's exact checks (section 5) in plain words; it names only the section's 112, 911
  and 999, though the check also accepts the national numbers on its list.
- **Shown** when it passes its exact checks (section 5, the provisional row), as `Provisional urgent response: ` followed by
  the text; the page then shows `Thinking more about the full response...` while the writer and checkers work. No second
  model reads it first: the owner chose that in point 3, and its exact checks are the only checks that hold.
- **If it doesn't pass**, or the turn later ends without a reply after a crisis reading (R1's, or C1's on the draft), or R1
  gives no reading in a conversation that is already a crisis conversation: the page puts the always-visible line, in his
  approved words, into the conversation as a highlighted notice: "In danger right now? Call your local emergency number: 112
  in the EU (and from mobiles in many other countries), 911 in the US and Canada, 999 in the UK." No model writes it and no
  new wording is needed. When it showed is stored in the runtime record (not the transcript), and later packets show it in
  its place, like the provisional. When C1 reads `acted_or_about_to` and nothing was shown this turn (R1 read another level
  or gave no reading), the line shows as soon as C1's reading arrives; with `provisionalTurns` `first`, only while no earlier
  turn of this conversation has shown an emergency number (a provisional or a delivered reply naming one, or the line) (22 Nov: otherwise the number came back as a highlighted
  line on every later acted message, the repetition the crisis section rules out; the line stays on the page and the full
  reply comes back to it).
- **The full reply** follows it in the same turn: the writer gets the provisional and continues the first step (the next
  smallest thing, staying with them) rather than repeating it; C1 checks the provisional and the full reply together as the
  first reply the person sees (at most one question about now across both; nothing that contradicts the provisional).
- **Later turns** see it: every later packet's conversation shows it in its place, labeled as a provisional reply.
- **Limits**: R1's limit is 30 s with no retry (set from the timed batch, with the threshold written before measuring:
  time from message to provisional at most 20 s in 9 of 10 crisis messages).

## 5. The program's exact checks

Pattern lists decide only exact things; meaning is a checker's. Digits are read in any script (Arabic-Indic, Devanagari,
fullwidth and the other common decimal digits), so the number checks work whatever the reply's language.

| Check | When | Exact rule | Effect |
|---|---|---|---|
| Emergency number present | every turn C1 reads `acted_or_about_to` until the conversation has shown an emergency number (in a provisional or a delivered reply, or the highlighted line), over the provisional and the full reply together; once one was shown, C1 judges "come back to it" (22 Nov: until then it held only on the first turn read acted, so a turn read acted whose repair was read lower could leave the conversation with no number) | at least one of 112, 911, 999, 000, 111, 119, 144 as a whole number. It proves a number is present, nothing more ("I can't call 911" passes it; C1 judges the first step). France's 15 alone doesn't pass (a reply naming only "le 15" is repaired to add 112), and 111 and 119 mean other services in some countries | blocks |
| Provisional: a number | the provisional of someone read `acted_or_about_to` (a provisional for `wants_to_die`, when `provisionalLevels` allows one, needs none: the first reply to someone who wants to die names no number unless they've acted) | at least one number from that list, as a whole number | not shown |
| Provisional: numbers known | the provisional | every run of two or more digits (any script), and every phone-shaped run (digits joined by spaces, dots, dashes or brackets), is on that list (catches an invented number however short: "Call 112 now, or the poison service at 42." isn't shown); so a two-digit time or count ("10 minutes", "24/7") or a national two-digit number (France's 15) keeps it from showing too, and the highlighted line shows instead; a single digit isn't read as a number. The three crisis links' own digits (the therapist link's path holds 189761959) are set aside before any number check, here and in the rows above and below; every other link's digits are read (22 Nov: a provisional giving the section's links was refused before this) | not shown |
| Provisional: shape | the provisional | at most 900 characters; at most one question mark (`?`, `？`, `؟`); no list line, heading or bold; no link other than the three of the crisis section | not shown |
| Owner's guide links | a crisis conversation | no link to the owner's sites (`u-dont-exist.com` and its subdomains, `ibogaqueen.substack.com`) other than the Hearthwork and therapist links the crisis section names; other sites (a poison centre, a health service) are left to C1 | blocks |
| "detox" | a crisis conversation | no word containing "detox" in Latin letters; other spellings and languages are C1's (`CRISIS_NEVER_LIST`) | blocks |
| First crisis reply shape | the first turn of this conversation that C1 reads `acted_or_about_to` or `wants_to_die`, or whose provisional was shown, whenever it comes | no list line, heading, or bold or double-underscore emphasis | blocks |
| Declared quotes | always | each declared quote is in the reply and in its source turn or journal entry, word for word after folding whitespace | blocks |
| Undeclared quoted spans | always | quoted spans (any quotation marks) the writer didn't declare are listed for C2, who judges whether any is presented as the person's words | to C2 |
| Child-contact gate | the gate (from R3 and the stored state) is HOLD or BLOCKED | the `childContactViolations` patterns (English and French) only point at places to look: a pattern can't tell an invitation from a refusal ("Do not contact your inner child." matches). Their hits go to C3 and the whole checker as `child_contact_pattern_hits`, with the gate and its route; those checkers block any reply that invites contact, in any wording or language (`CHILD_CONTACT_WHILE_RESTRICTED`, high), and are told a hit alone is not an invitation | recorded as `PROGRAM_CHILD_CONTACT_PATTERN` at medium, never blocks by itself |
| Numbers without a crisis | not a crisis conversation | any emergency number, a known crisis-line number (988, 3114, 116 123 and the like) or a phone-shaped run of six or more digits | recorded as `PROGRAM_NUMBER_WITHOUT_CRISIS`, never blocks (a wrong level must never take a number away from someone who acted) |

## 6. Storage (point 6a)

- **The case file** holds the transcript (append-only), each draft and its audit, the readers' results, the risk and
  compatibility records, the provisional replies and the closings. Encrypted, mode 0600, in the trial's own vault.
- **This conversation**: the server keeps the conversation ID per case and starts a new one after 12 hours without a
  message or when the page's "New conversation" button is used; the ID is stored as each turn's `episode_id` (existing
  field), so "this conversation" is an exact set of stored turns. A new conversation lifts the crisis section's "in this
  conversation" limits (the Never list, the links), as the served rule's words say; the start-using-it question tells the
  owner. The risk record and the gate are case-wide and survive it.
- **The risk record** is fed from R1's reading by program: `acted_or_about_to` → imminent, `wants_to_die` → intent or ideation
  as R1's `wish_or_intent` says, `thoughts_no_intent` → ideation (context `pain_episode` when `pain_linked`), `none` → absent,
  `unclear` or no reading → unknown; through the existing `updateSelfDirectedRiskState` and its lowering rule. The reading is
  stored before anything is shown and applied with the draft, or by the closing when no draft is made.
- **The digest's turn numbers**: one intervention-history item per turn, named for the reading rather than for a box no worker
  chose (`RUNNER.ACTED_OR_ABOUT_TO`, `RUNNER.WANTS_TO_DIE`, `RUNNER.CONVERSATION`), so the digest's planned-turn count and the
  record's ten-turn window work as today; the digest counts crisis turns through their risk readings
  (`src/case-state/trajectory-digest.mjs:91-97`).
- **Worker receipts**: provider, model, effort, start and end times, token use, rule parts and digests, isolation receipt;
  in the case file.
- **What goes where**: each worker's packet goes to the company that runs it. R1 and C1 carry the crisis words; with GPT and
  Claude both in use, those words go to two companies. The table in the start-using-it question names each worker's
  provider. Both run on consumer plans: whether those accounts let the companies train on conversations is an account
  setting the owner checks before any real conversation.
- **Plain files**: none with case text. Claude's provider writes only the system prompt (rules and instructions, never case
  text) to its 0700 temporary folder for one call; the sealed Codex mode reads its answer from the event stream instead of
  a `final.json` file, so its folder holds only the schema.
- **Measurement** results (times, token use, verdicts) go to a folder outside Git, from synthetic conversations only.
- **Deleting a case**: a trial-page button, after the person types DELETE (`POST /v1/case/delete`: the owner's page on this
  machine only, with the trial on), removes, inside the case's queues, the case file, the handoff envelopes its locators name
  (each opened with the case's key and confirmed to be the case's first), the folders of the journal corpora its record names,
  and the locator and alias files that name its ID (`src/storage/private-artifact-locator.mjs`,
  `src/storage/private-case-alias-locator.mjs`). Nothing it can't prove is the case's is touched. Making a handoff (from reading
  the record to its last file) and every write of a file that names the case (a draft's locator, an alias) take the same case
  queue in the store, so none can be written after a deletion returned. Then the page forgets the case too: every field of its
  state but the settings, the case id, the storage mode and the older-versions flag (so the transcript, the tracker and journal
  entries, the hypnosis sessions, the case views and the handoff go, and its backup export and recovery ZIP hold nothing of the
  case), what it shows of the case (the hypnosis session, the supervisor panel) and the text typed into its forms. An answer
  the supervisor panel was still waiting for when the case was deleted is dropped when it comes, before it is shown, kept or
  copied.

## 7. When no checked reply can be made (point 4a)

- **Every failure ends the turn**, so the case is never left busy: failed checks after the repairs the deadline allows, a
  plan limit, a lapsed sign-in, a timeout, a refusal, or the deadline. A failure of R1, R2 or R3 alone never does: the turn
  goes on without that reading (R1 missing counts as `unclear`; R2 missing means the whole box file; R3 missing keeps the
  stored gate).
- **The notice**: "InnerSignal can't answer right now." (the words of his 4a). The page shows the reason beside it in plain
  words (the plan's limit is reached; the sign-in needs renewing; it took too long; a model declined to answer), outside
  the reply. It is the turn's closing (`UNANSWERED`, kind `runner_unavailable`) whatever the reason.
- **His fixed message instead**: in a crisis conversation, after failed checks, while `INNER_SIGNAL_OWNER_FALLBACK` is on. It
  stays off until he has seen the results and said yes. It is the turn's closing (`UNANSWERED`, kind `owner_fallback`, reason
  `checks_failed`), not a discriminator, so it can follow two failed repairs or, when the deadline leaves no time for a second
  repair, fewer: that moves his rule ("after the second failed repair"), and the start-using-it question says so. "Getting
  safe" means a conversation in which any turn was read `acted_or_about_to`, `in_danger_from_someone`, `danger_to_others` or
  `home_unsafe` (the safety-orientation route's "outside safety ... first"); "wanting to die", one read `wants_to_die`. The
  question tells him these readings stand in for the four routes.
- **Operational failures** give the notice, not the fixed message, as the 1 Nov page says ("not used for operational
  failures"). Whether every failure in a crisis conversation should show his message instead is a setting
  (`fixedMessageOn`), off, and a question in the start-using-it draft.
- **In a crisis turn**, whatever ends it, the highlighted emergency line of section 4 is in the conversation.

## 8. Time and what the page shows

- **Always on the trial page**, from before the first message: "In danger right now? Call your local emergency number: 112 in
  the EU (and from mobiles in many other countries), 911 in the US and Canada, 999 in the UK."
- **While waiting**: "Writing and checking a reply…" with the seconds so far and the step (reading, writing, checking,
  repairing); in a crisis turn, after the provisional, `Thinking more about the full response...`.
- **Deadline**: one per turn (first value 300 s, set from the timed batch), passed into the runtime. Every call's limit is
  the smaller of its own (R1, R2 and R3 30 s, writer 60 s, each checker 45 s) and the time left. A repair starts when the
  time left is at least the round time, 30 s: the time within which 9 of 10 writer-and-checker rounds finished, rounded up.
  The per-call limits are caps for a stuck call, not a round's expected length. Set on 22 Nov from the measured times
  (results report, "Call limits, from the measured times"), in place of the first values (writer 120 s, each checker 90 s,
  round 100 s): across every run (129 GPT, 24 Claude and 10 mixed writer calls) no successful call took longer than 20.0 s
  for the writer, 14.4 s for a checker and 14.3 s for a reader; 9 of 10 writer-and-checker rounds finished within 22.7 s
  (GPT), 23.5 s (Claude) and 24.7 s (mixed), 26.2 s at most; once a GPT writer call hung to its 120 s cap and its retry
  answered in 11.5 s, so that reply took 152.6 s. Each cap is about two to three times the slowest call measured, so a
  stuck call costs less.
- **Delivery**: `/v1/therapy/respond` streams newline-delimited JSON when the page asks (`accept: application/x-ndjson`): a
  `status` line per step, a `provisional` line, a `notice` line, the final line. A page that asks for JSON gets one answer. The
  request is authorized for its case (the read, write and audit scopes, the check the turn itself makes first) before the stream
  listens for the case's events: a refused request gets the refusal and no line of another request's turn.
- **Restarts and reloads**: the store can't list cases, so nothing is closed when the server starts. When the trial page loads,
  it calls `POST /v1/runner/reconcile` with its case: inside the case's queue (a turn still running is waited for), every
  unfinished turn of the case is closed as `UNANSWERED` (reason `interrupted`), except an `APPROVED` one, which is delivered.
  A page that still shows its last turn names it and gets the turns that finished after it; a page that shows none (after a
  reload, since the page keeps no transcript) asks for the current conversation and gets all its turns. Either way a reply
  that finished while the page was gone is shown, each turn with its provisional reply and emergency line. A turn the page
  shows only in part (its stream failed after the person's message or the provisional reply) gets the parts it missed, in
  their place and none twice; a turn the page is still receiving is left to its stream; and the page's last-turn mark moves
  only past turns it shows whole, so a failed turn is asked for again until its reply is shown. Before a new
  message, an unfinished turn is closed the same way. A delivered turn replays without a model call; the JSON answer and the
  stream's final line carry the stored provisional reply and whether the emergency line was shown, so a replay shows them too.

## 9. The plan kept for next time (point 5b)

**Built** on 21 Nov 2026, behind its own switch `INNER_SIGNAL_RUNNER_KEPT_PLAN` (on/off, read like the trial's; off by default;
meaningful only with the trial on), off until the owner has seen the rule text
(`/home/joel/askrigor-releases/20261121-innersignal-runner-note/kept-plan-rule-draft.md`). Its rules are in
`src/runner-trial/kept-plan.mjs`: the runtime uses them to decide what goes into a packet, and the encrypted store applies the same
ones again before it keeps anything, so no caller can keep a plan they don't allow. Tests: `tests/runner-trial-kept-plan.test.mjs`.

- **Switch off**: nothing below runs. Every worker's prompt, packet and schema is byte-identical to before (a test runs a fixed
  scenario through both arms, a repair included, and compares one digest of every call with the digest taken from `aa9d03112`);
  the case record gains no field; answers, the reconcile and the page are as before. Only `/health` shows it: `runnerKeptPlan: "off"`.
  A plan kept while the switch was on is still deleted at its 30 days (at the next message or page load), with the trial on.
- **The ask**: the crisis reader also returns `asks_to_keep_plan` (the person asks to keep their plan, or says yes to the offer in
  the reply just before) and `asks_to_delete_plan`, from this conversation's words.
- **Kept** only when (a) the crisis reader reads that the person asks in this turn, or (b) the reply just before offered and the
  person says yes in this turn: read by the crisis reader and confirmed by the crisis checker (the whole checker in its arm) in its
  own field `confirms_keep_plan_yes`. Never when any stored crisis reading in the case (any turn, any conversation) says
  `may_be_under_18` or `home_unsafe`, or when the crisis reader gave no reading this turn. The writer, given `keep_plan_asked`,
  copies into `kept_plan_lines` the sentences of an earlier InnerSignal reply in this conversation that hold the plan (who they'll
  reach, the message, what they'll do in the next hours); the program keeps only the lines found word for word (whitespace folded)
  in a reply InnerSignal delivered earlier in this conversation, with the date. (a) is kept right after the writer; (b) the moment
  the checker's confirmation arrives; a repaired draft's lines are tried when the first draft's kept none. A refusal keeps nothing
  and never stops the turn.
- **Where**: the case file's `runner_kept_plans`, encrypted with the rest, one plan at a time (a newer plan deletes the older, reason
  `replaced`), append-only (no plan is removed, what was kept and when never changes; the only change is deletion). Never in the
  transcript; the turn notes `kept_plan_kept_at`. The writer's declared lines are also in its stored output, as its draft is.
- **The offer**: once per conversation, when the conversation is a crisis conversation, a reply already delivered in it reached the
  plan for the next hours (step 5 of the crisis replies: the writer's `plan_reached` for the reply it sent, or the crisis checker's
  on the audit of that reply), the crisis reader read this turn, no stored reading rules it out and no plan from this conversation
  is kept. Then the writer's packet gets `may_offer_to_keep_plan: true`, stored with the turn's readings before it writes (so it is
  given once), and the writer may end the reply with one plain sentence offering to keep the plan, declared in
  `offered_to_keep_plan`; it is checked with the rest of the reply. The offer counts as made when that reply is delivered. So it comes
  at the earliest in the turn after the plan reply.
- **What the page says**: the writer can't know what the program keeps, so it is told not to say. The answer and the stream's final
  line carry `keptPlan` (`kept`, `deleted` or null), never the lines, and the page shows outside the reply "Kept for next time: the
  lines of your plan and today's date, encrypted on this computer for 30 days." or "No kept plan remains."
- **Next time**: when a new conversation opens (the "New conversation" button, or the first message after the 12-hour gap) and an
  earlier conversation exists, kept plan or not, the page shows "Pick up where we left off?" with Yes and Start fresh above the
  message box. The answer goes with the next message as `resumeConfirmed` (only exactly true is a Yes; an unanswered question
  sends nothing) and is stored with the new conversation's first turn, for the whole conversation. Only Yes, with a plan kept in an
  earlier conversation that isn't deleted or past 30 days (checked again as each call starts, a retry included), puts `kept_plan`
  (its lines and the day it was kept) in the writer's and the crisis checker's packets (the whole checker's in its arm), with the
  runner-only rule in their prompts, exactly: "A kept plan is a reason to ask one question about the message, never a sign of risk
  now, never a reason for numbers or safety questions." No
  other worker gets either. A plan is also left out while any stored reading says `may_be_under_18` or `home_unsafe` (one step
  beyond "never offered or kept"). Start fresh changes only this: earlier turns are still given as background, as before. The page
  learns when to ask from its reconcile (`resume`: whether the case has a conversation and whether the next message opens a new
  one), which says nothing of a plan; when the gap passes while the page stays open, it isn't asked, and no plan is given.
- **Deleted** 30 days after it was kept, checked whenever the runtime loads the case (every turn) and when the page loads (its
  reconcile, whether or not the switch is on), or when the person asks: in the conversation (the crisis reader's
  `asks_to_delete_plan`; deleted before the writer starts, whose packet then says `kept_plan_deleted_on_request`) or with "Delete
  the kept plan" on the trial page, after the plain confirmation "This removes the kept plan. Its words are still in the stored
  conversation, which can't be edited; deleting them too means deleting the case."
  (`POST /v1/runner/kept-plan/delete`: the owner's page on this machine only; the same answer whether or not a plan was kept).
  Deleting removes the lines from the record and keeps when it was kept, when it was deleted and why. The transcript is append-only,
  so the replies that hold the lines stay, as do the stored drafts; deleting them means deleting the case, which deletes the plan
  with everything else.

## 10. Providers (point 2)

- **Claude**: `ClaudeCliProvider` in sealed mode (existing): `claude -p`, `--tools ""`, no session persistence,
  `--safe-mode`, `--strict-mcp-config`, an allowlisted environment, a fresh temporary folder; case text only on stdin. As
  built it is the trial's own `SealedClaudeWorker` (`src/runner-trial/sealed-claude.mjs`), with the same isolation. It bills
  the account of the sign-in folder the settings name (`claudeConfigDir`, or `INNER_SIGNAL_RUNNER_CLAUDE_CONFIG_DIR`: the
  owner's i64a gave the runner a sign-in of its own), or else the laptop's default `claude`. Claude Code adds lines about
  its environment (the working folder, the date) to the system prompt even with `--system-prompt-file` (the 22 Nov probe);
  no case text goes there.
- **GPT**: a sealed Codex mode (`src/runner-trial/sealed-codex.mjs`): an empty 0700 temporary folder as the working
  directory, `--ephemeral`, `--json`, `--sandbox read-only`, `--ask-for-approval never`, `--ignore-user-config`,
  `--ignore-rules`, the protocol-application eval's `CODEX_ISOLATION_CONFIG` (web search, apps, plugins, browser and
  computer use, the shell and more turned off), the rules and instructions in a 0600 file in that folder given as
  `model_instructions_file` (it replaces Codex's own instructions: on 21 Nov a test call obeyed such a file and read 12,356
  tokens; a command-line argument can't carry the rules, since Linux caps one at 131,072 bytes and the whole protocol is
  317 KB), the packet on stdin. It refuses to run when the installed CLI lacks any of those flags. The same test showed why
  every isolation setting matters: with apps and plugins left on, one call read 155,651 tokens of tools. A call whose event stream shows any action, or isn't whole, is
  refused; that is detected, not prevented, and the receipt says "no tools offered, any action refused". The timed batch
  starts with a probe asking a sealed worker to run a command and to search, and records that it couldn't.
- **Per worker**: a trial settings file outside Git (`INNER_SIGNAL_RUNNER_TRIAL_SETTINGS`) names each worker's provider,
  model and effort. "What people have": Claude only, ChatGPT only, or both, where writer and checkers can come from different
  families.

## 11. The switch and rollback

`INNER_SIGNAL_RUNNER_TRIAL` (on/off, read like the other on/off settings; off by default; any other value stops startup).
On: the server's controller uses the trial runtime, `/health` says `runnerTrial: "on"`, the page shows a "Runner trial"
banner, the always-visible line and the delete button. Off: everything is as on `main`. The trial needs its own vault (its
own `INNER_SIGNAL_PRIVATE_RUNTIME_CREDENTIALS` and root), because its records can't be read by a build without the trial
code; turning it off leaves that vault alone.

## 12. Privacy

No real case or journal text in Git, logs or reports: tests and measurement use the synthetic conversations only. The
owner's phone number appears nowhere (his public Signal username is in the served rules already). Case text never goes into
a system prompt or onto a command line.

## 13. Measuring it

In stages, checking first that memory allows (`tools/resource_check.py`; at most two calls at once per turn on this laptop
if memory is short) and the plan use of the account the calls bill, stopping at 85% of its week.

**Thresholds, written before measuring**: time to the provisional at most 20 s in 9 of 10 crisis messages; a full reply
within the deadline in 9 of 10 messages; "no reading" in under 1 call in 20; quality at least plain InnerSignal's in the
blind comparison, with no crisis must-not broken.

1. **Timed batch**: the isolation probe; then four i61 messages and four crisis conversations through each arm (focused or
   whole writer, split or whole checker, and the cheap arm), cold and warm (a second pass within the cache's life); per
   worker: wall time, tokens, cache reads; per turn: time to the provisional and to the reply shown, repairs, "no reading".
2. **Checker catch rate**: the 27 graded replies of the protocol-application calibration through the split checkers and the
   whole checker: blocks on known failures, passes on known good replies.
3. **Test round**: the 53 crisis conversations with their must and must-not lists and the four i61 messages, through the
   chosen arm; first draft and final for every repaired reply; repair and "no reading" rates. Eight messages can't show a
   repair rate; 57 conversations can show a rate near one in five within about ten points.
4. **Blind comparison**: the same messages answered by plain InnerSignal in Claude (the served protocol) and in ChatGPT
   (Codex with the local connector), graded by a judge from the other model family against the must and must-not lists,
   labels hidden, over-reaction counted as a fault.

**Speed, before any timing.** Nothing is measured yet. A focused turn adds R2 before the writer and four chances of a
checker's "no reading" or wrong block; a whole turn has a writer and a checker sharing one 113,000-token prefix that the
provider can cache within a turn. Generating the reply, not reading the rules, may be most of a call's time. Which arm is
faster and better is what the batch decides; the default after it is the arm the numbers favour.

**Which account.** At 18:37 UTC on 21 Nov the laptop's `claude` command was signed into an account whose weekly limit was
reached until Mon 24 Nov 14:00 UTC. The owner answered i64a: the runner got a Claude sign-in of its own
(`~/.config/claude-innersignal`), checked at 01:20 UTC on 22 Nov to be the account with room. The Claude timed batch, catch
rate and blind judging ran on it (64% to 67% of its week, 01:24 to 01:51 UTC). Claude's test round and the plain-Claude
baseline wait for the InnerSignal lane's choice of account. Results: `/home/joel/askrigor-releases/20261121-innersignal-runner-note/results-report.md`.

## 14. Not in this trial

The phone link, a shared page with AskRigor's runner, a public copy, the journal provider, any change to `stable`, the
server or the ChatGPT and Claude connectors.

## Appendix: Fable's red team and what changed

| Finding | Change |
|---|---|
| B1 provisional undefined | Section 4: default for `acted_or_about_to` only (setting for both, owner asked); what it holds; the writer always waits for R1 (or R1's limit); C1 checks provisional and full reply as one first reply |
| B2 someone who acted ends with a notice | R1, R2, R3 failures never end a turn; R1 30 s, no retry; the approved emergency line placed in the conversation whenever a crisis turn's provisional is missing or the turn fails; call limits inside the deadline; repairs only when a round fits; the notice in his 4a words with the reason outside the reply; the any-failure question to the owner |
| B3 provisional checks | Section 5: numbers must be known, length cap, one question mark, links only the three, no lists or bold; the number check is said to prove presence only |
| B4 stored record to R1; highest level | R1 gets this conversation only; draft checks use C1's level; disagreements go to C1 and repair, never upward by program |
| B5 child-contact gate dead | R3 returns the compatibility assessment in the existing schema; committed and bound as today |
| B6 controller changes | Section 1 lists the controller, lifecycle and store changes; attempts 1 with runtime retries; reading stored once before anything shows; `UNANSWERED` writes the user turn, reading and notice in one mutation; deadline inside the runtime; unfinished turns closed at start and before a new message |
| B7 split arm leaves rules unread | `routes` dropped (route boxes are picked like boxes); focused = whole minus unpicked boxes; a runner preface; C2 gets SKILL.md; C3 gets the box index and, in a crisis conversation, the crisis part |
| S1 speed | the cheap arm; end-to-end p50 and p90, repair and "no reading" rates, cold and warm; thresholds written first; memory check |
| S2 later turns | the provisional shown in every later packet |
| S3 digest numbering | one history item per turn |
| S4 program checks | digits in any script; three-digit numbers only; first crisis reply keyed to the first crisis turn; undeclared quotes to C2; owner-domain links only; phone-shaped runs for over-reaction |
| S5 kept plan | any stored reading in the case; R1 missing means don't offer; the question shown whenever an earlier conversation exists |
| S6 GPT provider | no `final.json`; refuses when a flag is missing; "detected, not prevented" and a probe; the accounts' data-use setting and the two-company point in the question |
| S7 what the extraction carried | section 1 |
| S8 R1's fields | `crisis_route` and the two-scale reading removed; the record's level and the routes derived by program; "getting safe" defined |
| Minor 1 to 9 | the anchor; box sizes; R2 picks boxes only; program checks run after C1; the delete button removes locator files; the server owns the 12-hour rule and the owner is told a new conversation lifts the limits; double underscores only; the eleven checks in order and one context id; case text never in `system` |

Fix-check of the revision (`fable-fixcheck-design-20261121.md`):

| Finding | Change |
|---|---|
| N1 a provisional with no number | "Provisional: a number" row in section 5 |
| N2 repairs could never start | a repair starts when the measured round time (first value 100 s) fits; deadline first value 300 s; per-call limits are caps |
| N3 the fixed message after fewer repairs | every ending without a reply, the fixed message included, is the turn's `UNANSWERED` closing; the question tells him it can follow fewer than two repairs |
| N4 Codex rules on the command line | `model_instructions_file` in the 0700 temporary folder, tested |
| N5 the number in every draft | the number check covers the first acted turn, provisional and full reply together; later turns are C1's |
| N6 a crisis turn without R1's reading | the highlighted line's conditions spelled out; stored in the runtime record and shown to later packets |
| N7 R3 and the validator | R3 cites this conversation's turn IDs; validated against them |
| N8 the writer and the gate | the writer gets the gate and R1's reading |
| N9 controller branches | `UNANSWERED` replay; closing inside the per-case queue; `APPROVED` delivered at startup; R3's assessment applied by the closing |
| N10 "getting safe" | includes `in_danger_from_someone`, `danger_to_others` and `home_unsafe`; the question says so |
| M1 to M5 | runner-only route names; 15, 111 and 119 said; the shape check keyed to C1 or a shown provisional; R3's call counted in plan use; the probe covers a schema-bound Codex answer |
