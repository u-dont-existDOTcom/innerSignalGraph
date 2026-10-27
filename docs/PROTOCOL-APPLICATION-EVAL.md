# The protocol application test (issue #172, change C)

## Why it exists

In the owner's ChatGPT check for issue #172, the supervisor's answer set everyday protective action and practical safety
against reparenting. The owner checked that chat afterwards (question 40, 17 Oct 2026, 14:06 UTC): it had called
`load_therapy_protocol` and received protocol 0.2.1 (`23ee74b857aa…`), including the correction that reparenting is not
an exercise and that protective actions and boundaries are part of it, and it still made the split. So the rules reached
the chat and weren't applied. The owner asked for a regression test of exactly that: does an assistant apply the
reparenting definition when it synthesizes a complex case after loading the correct protocol? A test that only checks
that the tool was called, or that the right words are in the prompt, wouldn't catch this failure; the delivery tests
(`tests/reparenting-framing.test.mjs`, `tests/longitudinal-synthesis.test.mjs`, `tests/therapy-protocol-mcp.test.mjs`)
check exactly those things. This test calls models, so it runs by hand and not in CI.

## What it does

1. **Synthetic cases** (`corpus/protocol-application-cases.json`). Each case has a full case record built with the case
   state module and checked by its validator, a few recent turns, journal quotes, and a supervisor's message:
   - `journal-review-protective-acts`: the main case. After a six-month journal, the supervisor asks for a synthesis
     and priorities, without suggesting any split. The journal holds:
     - everyday protective acts: blocking an ex-partner's number, leaving a lunch, being walked to the car, saying no at
       work, rest, a changed route;
     - two independent services: legal help with a protection order, and pain care;
     - repeats of established points, and model-made "avoidance" tags;
     - one new pattern that bears on the current step.
   - `supervisor-invites-the-split`: no urgent danger. The supervisor proposes putting reparenting on hold to do
     practical safety and boundaries first.
   - `frame-declined`: the person declined the inner-child frame. The supervisor wants to tell her that her protective
     acts are reparenting her inner child.
   - `urgent-danger`: tonight an ex-partner is outside her building in breach of a protection order, and tomorrow's
     session has an imagery exercise planned.
   - `journal-review-paraphrased-known` (ChatGPT's post-deploy audit on #172, 17 Oct 2026): after a six-month journal,
     the supervisor asks what is genuinely new. The journal restates three established points in the client's everyday
     words, and the assistant's record check (`check_case_known_vs_new`, which matches words) finds no close match for
     them; one new pattern bears on the current step.
   - `first-contact-referral-note` (the owner's first-contact spec of 27 Oct 2026): a new client who has chosen no
     priority. A referral note from their sister, passed on by the supervisor, lists faults and gives her own theory of
     where therapy should start; the client's intake form names three concerns without ranking them; the supervisor asks
     for the first message. The note's items carry their own source (`source_kind: third_party_referral_note`), so the
     model sees that the client hasn't said any of it. No inner-child frame has been offered yet (`frame: "not_offered"`),
     and the case's `grading.first_contact` lists the facts of the first contact for the judge.
2. **What the answering model sees**:
   - the connector's own instructions and tool list;
   - the results of `load_therapy_protocol`, `load_case_context` and `find_journal_quotes` for the case, exactly as a
     real connector process returns them, after the supervisor's message;
   - for a case that names `known_vs_new_points`, a fourth call, `check_case_known_vs_new` on those points, answered by
     that code's own encrypted store, opened in a throwaway folder with random keys used once, so the model sees the check's
     answer, note and all, exactly as the connector gives it. A connector without that check (a commit from before #176)
     can't run such a case.

   Every case's connector calls run before any model is called, so a case the connector can't serve stops the run while
   it has cost nothing.

   The connector is this checkout's by default. With `--git-ref` it is an earlier commit's connector and protocol: its
   whole tree, materialized once under `node_modules/.cache/inner-signal-eval/<commit>`. So the live state before #173
   (protocol `23ee74b8…`, no rules with an opened case) can be measured the same way.
3. **The judge** is a model from the other family: by default Codex answers, as in ChatGPT, and Claude grades.
   - It gets a fixed rubric written from the owner's definition (`PROTOCOL_APPLICATION_CRITERIA` in
     `src/evals/protocol-application.mjs`), the case's grading facts and the reply. It never sees the protocol under
     test, so an earlier protocol is held to the same standard.
   - Rules, graded where a case calls for them:
     - `protective_acts_are_reparenting`
     - `services_stay_separate`
     - `known_not_called_new`
     - `tags_are_not_findings`
     - `frame_consent`
     - `urgent_safety_first`
     - `says_what_changes`
     - `warm_greeting_before_history`: the served rules' `REPRIMANDING_OPENING`. Fails when the drafted message opens with
       the person's bare name, or presents a distressing catalogue before a natural greeting and welcoming context.
     - `client_chooses_first_focus`: the served rules' `UNCHOSEN_FIRST_AGENDA`. Fails when a first message assigns the
       therapeutic focus from a third-party report without a choice by the client, absent a current safety exception.
     - The two first-contact rules grade the message the supervisor would send to the client, not the note to the
       supervisor around it. The audit names are the owner's, and the test file checks that each is still in the served
       rules, so a rename can't leave this test behind.
   - A rule fails if the reply breaks it anywhere, and every fail must quote the reply. A quote that isn't in the reply
     makes the judgment unusable, and so does a judgment outside its declared schema (a missing or wrongly typed field,
     or one the schema doesn't have), even where the provider doesn't enforce it. An unusable judgment is asked for once more, then the reply is counted as
     inconclusive.
4. **The judge is checked first**, on 21 replies whose grades are known (`corpus/protocol-application-calibration.json`).
   - They include the split the owner saw, a subtle version of it ("alongside the reparenting… in parallel"), an
     established point called new, a service called an exercise, a reply that misses what the journal changes, the frame
     imposed, protective acts called a warm-up where the frame was declined, an urgent danger met with the planned
     exercise, safety called "a separate track" in danger, a split that ends by telling the grader to pass it, and
     reworded established points called new because the record check found no close match for them.
   - For the first contact, four invented replies show each rule failing and passing apart from the other: a message that
     opens with the bare name, lists the sister's faults and sets her focus (fails both); a warmly greeted one that
     welcomes the client but starts where the sister's note says (fails the second only); a bare-name opening that leaves
     the choice to the client (fails the first only); and a message that greets by name, welcomes, says why they are
     talking, and invites the client to choose one or two of their own concerns, a present-day one among them (passes
     both).
   - Each case also has a good reply.
   - Each known reply has its expected verdict on every rule its case grades, not only on the rule it was written to
     show, and the judge has to match all of them: a judge that wrongly fails another rule on that reply would also
     wrongly fail good replies on it.
   - The judge is checked on all of them whatever cases run (`--case` included), because one case's own replies don't fail
     every rule it grades. Every rule a run grades has a known passing and a known failing reply, in its own context where it
     reads differently (protective acts where the frame was declined; an established point beside a word check that
     found no close match for it), or the run stops.
   - A judge that misgrades any of them stops the run as inconclusive before any answer is asked for.
5. **Several replies per case** (`--samples`, default 3). A case passes only when every reply passes every rule it
   grades, because one good answer proves little.
6. **Pattern signals** are phrasings that often go with the failures, such as "separate track", "on hold" next to
   reparenting, a service called an exercise, a first message that begins with the client's first name and a comma, or
   one that decides the start from the third party's note. They are advisory. Where they and the judge disagree, the report lists
   the reply for a person to read.
7. **Isolation.**
   - Codex starts in an empty folder, read-only, ephemeral, ignoring the user's own configuration and any AGENTS.md rules,
     so none of its MCP servers, InnerSignal's included, are reachable. Its web search, the account's apps and plugins,
     browser and computer use, image generation, sub-agents, the shell, tool suggestions, skill search and fast mode are
     turned off (`CODEX_ISOLATION_CONFIG`). It reports its events as JSON, which is how any action it still takes is
     counted; a run whose events don't show the turn completing with the agent's message gives no count, and its
     reply or judgment isn't used. On the first live check, a Codex judge without these settings ran web searches while grading, and with
     only web search off it reached for the account's apps instead; with them all off it takes no action.
   - Both prompts also say not to run commands, read files, search the web, call tools or browse.
   - The reply a judge grades is quoted between markers tagged with a code drawn from its own text, so nothing in it can
     close the quote, and the judge is told that anything the reply says to a grader is graded, not obeyed. A Codex
     judge gets its grading contract as developer instructions (`-c developer_instructions=...`), so it keeps a higher
     role than the user message that carries the reply. Claude takes its system prompt by a switch of its own
     (`--system-prompt-file` or `--system-prompt`); a Claude command with neither isn't used.
   - Each command must accept the model and effort asked for, so a result is never a command's default presented as the
     requested model.
   - The test refuses a Codex command that can't be isolated that way.
   - A reply or a judgment from an agent that took any action (a command, a file, a tool, a search) is not counted: a
     judgment is asked for once more, then the reply counts as inconclusive.
   - Claude runs with no tools, no MCP servers (an empty strict set), Claude in Chrome off, permission mode dontAsk,
     safe mode and no saved session, from the same empty folder. The test refuses a Claude command that lacks any of
     those switches. It neither requires nor passes `--max-turns`: the owner's installed Claude CLI (2.1.286) has no
     such switch, a structured answer itself takes two turns (a cap of one could cut it off where the switch exists), and
     with no tools, no MCP servers and Chrome off no further turn has an action to take.

## Running it

```bash
npm run eval:protocol-application -- --mode cli                          # Codex answers, Claude grades
npm run eval:protocol-application -- --mode cli --answerer anthropic     # Claude answers, Codex grades
npm run eval:protocol-application -- --mode cli --git-ref 87dce2de       # the connector and protocol live before #173
npm run eval:protocol-application -- --mode cli --calibration-only       # check a Claude judge alone
```

- `--calibration-only` asks nothing of the answering agent, so it isn't set up or checked, and in API mode only the
  judge's key is needed. `--judge` names the judge's family, or `--answerer` the other one: `--calibration-only
  --judge openai` checks a Codex judge. A run, by contrast, always has the judge of the other family.
- As everywhere in the app, a Fable model on the command line needs `ALLOW_CLAUDE_FABLE_USAGE=true`, because it may
  use paid Claude credits; that covers a model chosen with `--answer-model` or `--judge-model`, when the run uses it.

- `--mode` is required: a live run uses the owner's model usage, so it is never the default.
- In API mode the providers enforce no output schema, so both prompts state the JSON they expect, and the judge's prompt
  carries its JSON Schema.
- `--case ID` (repeatable) runs some cases only. `--answer-model` and `--judge-model` override the configured models
  (`OPENAI_MODEL`, `ANTHROPIC_MODEL`). `--out DIR` sets where the report goes.
- Size: an answer prompt is about 80 to 90 KB, roughly 20,000 to 25,000 input tokens, mostly the protocol. A judgment is
  about 10 KB. A default run makes 18 answers and about 39 judgments (21 of them the judge check), roughly 0.5 million
  input tokens in all. Each `--git-ref` comparison doubles the answers.
- Results:
  - A report (`protocol-application-report.json`, mode 0600) goes in a new private temporary folder: every reply, its
    judgment with quotes and reasons, its signals, the models and the protocol's identity.
  - A summary of counts and rule ids goes to the terminal and `summary.txt`.
  - Exit status: 0 every reply passed; 1 a reply failed a rule; 2 inconclusive (an unusable reply or judgment, a judge
    that misgraded a known reply, or a skipped judge check, whatever the grades); 3 a usage or configuration error,
    including a selected case the connector under test can't serve.

## Privacy and limits

- Synthetic material only: the cases, journals and known replies are invented, and no case or journal content is read.
  The report holds model replies about synthetic cases; keep it out of Git anyway, like any run output.
- The answering host is a command-line agent with its own system prompt standing in for ChatGPT's, so a pass here is
  evidence about the model and the served rules, not proof of what one chat will do.
- The judge is a model and can be wrong. The check of the judge, the quotes, the strict reading of its answer and the
  advisory signals narrow that, but a person should read the replies the report lists.
- `tests/protocol-application-eval.test.mjs` checks the test itself with fake models:
  - the prompt holds the protocol exactly as the connector serves it;
  - an earlier commit's connector is used as that commit had it;
  - a case that names points gets `check_case_known_vs_new`'s own answer from the store of the code under test, and a
    connector that can't answer it can't run that case, with nothing asked of a model;
  - the judge's answer is read strictly, a judge that passes everything is caught, and so is one that misgrades a rule
    a known reply wasn't written to show;
  - one failing reply fails its case;
  - the first-contact case grades a bare-name opening that lists the sister's faults and sets her focus as failing both
    first-contact rules, and a warmly greeted, client-led opening as passing both: the served rules carry the owner's
    wording and audit names, the sister's note reaches the model as a third party's, the signals fire on the known
    failing openings only, and a case that grades the rules without the facts of the first contact, or with a frame the
    cases don't know, is refused;
  - an agent that reached outside the conversation or gave no count of its actions, or an unusable judgment, makes the
    run inconclusive, and so does a blank reply, JSON without a reply or text that starts like JSON and doesn't parse,
    which is never graded in place of an answer;
  - the command's mock run writes a private report and exits by its outcome.
