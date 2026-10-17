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
2. **What the answering model sees**:
   - the connector's own instructions and tool list;
   - the results of `load_therapy_protocol`, `load_case_context` and `find_journal_quotes` for the case, exactly as a
     real connector process returns them, after the supervisor's message.

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
   - A rule fails if the reply breaks it anywhere, and every fail must quote the reply. A quote that isn't in the reply
     makes the judgment unusable. An unusable judgment is asked for once more, then the reply is counted as
     inconclusive.
4. **The judge is checked first**, on 13 replies whose grades are known (`corpus/protocol-application-calibration.json`).
   - They include the split the owner saw, a subtle version of it ("alongside the reparenting… in parallel"), an
     established point called new, a service called an exercise, a reply that misses what the journal changes, the frame
     imposed, an urgent danger met with the planned exercise, and safety called "a separate track" in danger.
   - Each case also has a good reply.
   - A judge that misgrades any of them stops the run as inconclusive before any answer is asked for.
5. **Several replies per case** (`--samples`, default 3). A case passes only when every reply passes every rule it
   grades, because one good answer proves little.
6. **Pattern signals** are phrasings that often go with the failures, such as "separate track", "on hold" next to
   reparenting, or a service called an exercise. They are advisory. Where they and the judge disagree, the report lists
   the reply for a person to read.
7. **Isolation.**
   - Codex starts in an empty folder, read-only, ephemeral, and ignoring the user's own configuration, so none of its
     MCP servers, InnerSignal's included, are reachable.
   - The test refuses a Codex command that can't be isolated that way.
   - A reply from an agent that took any action (a command, a file, a tool, a search) is not counted.
   - Claude runs with no tools, no MCP servers (an empty strict set), safe mode and no saved session, from the same
     empty folder. The test refuses a Claude command that lacks any of those switches.

## Running it

```bash
npm run eval:protocol-application -- --mode cli                          # Codex answers, Claude grades
npm run eval:protocol-application -- --mode cli --answerer anthropic     # Claude answers, Codex grades
npm run eval:protocol-application -- --mode cli --git-ref 87dce2de       # the connector and protocol live before #173
npm run eval:protocol-application -- --mode cli --calibration-only       # check the judge alone
```

- `--mode` is required: a live run uses the owner's model usage, so it is never the default.
- `--case ID` (repeatable) runs some cases only. `--answer-model` and `--judge-model` override the configured models
  (`OPENAI_MODEL`, `ANTHROPIC_MODEL`). `--out DIR` sets where the report goes.
- Size: an answer prompt is about 80 to 90 KB, roughly 20,000 to 25,000 input tokens, mostly the protocol. A judgment is
  about 10 KB. A default run makes 12 answers and about 25 judgments (13 of them the judge check), roughly 0.4 million
  input tokens in all. Each `--git-ref` comparison doubles the answers.
- Results:
  - A report (`protocol-application-report.json`, mode 0600) goes in a new private temporary folder: every reply, its
    judgment with quotes and reasons, its signals, the models and the protocol's identity.
  - A summary of counts and rule ids goes to the terminal and `summary.txt`.
  - Exit status: 0 every reply passed; 1 a reply failed a rule; 2 inconclusive (an unusable reply or judgment, a judge
    that misgraded a known reply, or a skipped judge check); 3 a usage or configuration error.

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
  - the judge's answer is read strictly, and a judge that passes everything is caught;
  - one failing reply fails its case;
  - an agent that reached outside the conversation, or an unusable judgment, makes the run inconclusive;
  - the command's mock run writes a private report and exits by its outcome.
