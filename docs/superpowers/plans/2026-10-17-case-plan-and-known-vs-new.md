# A lasting plan for each case, and new versus known (issue #172) — plan, 17 Oct 2026

Status: plan for review with its three changes. No real case content is read, quoted or committed; every finding
below comes from the code, the served rules and Git history.

## What the owner saw

Issue #172 (the owner, 17 Oct 2026, 12:01 UTC), after the fresh ChatGPT check of the journal graph: after an extensive
journal import, the supervisor answer called something long established a new idea, did not say what the journal changed
in the case's plan, and again set everyday protective action and practical safety against reparenting, which the
deployed rules forbid. The issue asks whether every case has a durable, prioritized therapy plan, for the cause of the
repeated framing failure to be found before more advisory wording is added, and for the smallest sufficient plan and a
reviewed implementation candidate. It is not an authorization to change any client's treatment plan.

## Cause (content-free)

The conversation is not in the repository, and the connector kept no record of which tools a chat called, so whether
that chat loaded the therapy protocol could not be seen from here (owner question 40). The owner checked the chat (17 Oct,
14:06 UTC): it called `load_therapy_protocol` and received protocol 0.2.1 (`23ee74b8…`), the correction that reparenting
is not an exercise included, and still made the split. The rules reached it and weren't applied, which puts cause 2
first and makes a test of application necessary (change C). Four contributing causes are visible in the code:

1. **The served rules lack the longitudinal rules the app's own runtime follows.** `src/prompts/common.mjs`
   (`longitudinalClinicalRules`) tells every app role to keep salience and centrality apart, preserve the established
   longitudinal target, check settled history before asking, and check the history before repeating advice. The rules a
   connector host receives (`plugins/inner-signal-therapy/skills/inner-signal-therapy/SKILL.md` and its references)
   carry only two short sentences of this ("Read the established case history…", "…or repeat earlier advice as though
   it were new"), and nothing on telling an established point from a new one in a review across sessions or a journal.
   The 2026-09-08 design (`docs/superpowers/specs/2026-09-08-longitudinal-therapy-reasoning.md`) chose prompt
   enforcement for the app roles; it never reached the connector path.
2. **The served reparenting rule invites the split.** `references/PROTOCOL-STATE-PROVENANCE.md` (mirror of
   `src/prompts/protocol-provenance.mjs`) says, after the definition, "Keep genuinely separate interventions distinct,
   such as concrete human support, specialist care for physical pain, medical or crisis care and practical help". Read
   alone, "practical help" puts everyday practical safety outside reparenting: the false contrast the owner saw. The
   owner's issue states the intended meaning: ordinary self-protective acts are reparenting when that frame is welcome,
   not a separate therapy; independent medical and safety actions stay independently available.
3. **No plan in the record.** The case state (`src/case-state/longitudinal-state.mjs`, version 1) holds evidence items,
   hypotheses, contradictions, settled answers, intervention history, one `current_episode` and parked focus questions.
   Nothing ranks goals or says who set a priority, so each fresh session rebuilds the priorities from hundreds of items,
   and nothing marks what the record has already established when a journal brings many more examples of it. The
   2026-09-08 design deferred schema fields until "evidence that prompt/audit/controller enforcement is insufficient";
   the repeated failure after the rules were corrected is that evidence.
4. **The rules don't travel with the case.** A session that loads a case (`load_case_context`, `load_handoff`) and
   searches the journal gets the record and the quotes, but the therapy rules only if it also calls
   `load_therapy_protocol`; tool results weigh more with a host model than server instructions do.

## Change A — the rules and the trace (first pull request)

- **Longitudinal synthesis, served.** A new served reference, `references/LONGITUDINAL-SYNTHESIS.md`, mirrors a new
  prompt module, `src/prompts/longitudinal-synthesis.mjs`: the four existing longitudinal rules above (the same lines the
  app roles already receive, now defined once and used by `common.mjs` too) and a KNOWN VERSUS NEW section from the
  owner's issue: before presenting anything in a review across sessions, records or journal material as new, check it
  against the established record and say whether it is already established (and where), a new example of an
  established point, a contradiction, a new actionable lever, or a change to what comes first; report what changes the
  next step or the order of priorities, not more examples of a known problem; an old theme is not new because its source
  format is new; an imported journal's tags and labels are search aids, not diagnoses or approved goals; a priority keeps
  its source (the client's choice, an authorized decision, a model's proposal); safety and consent can override the
  order. Audit failure `KNOWN_PRESENTED_AS_NEW`. The served `SKILL.md` reads it and says so in two sentences. The app
  roles that compose, review or repair a response receive the same rules and audit failure through the shared rules.
- **Reparenting wording.** The rule says that everyday protective acts and practical safety the person takes for the
  vulnerable self are part of reparenting when the frame is welcome, while independent services (concrete outside help,
  medical, crisis or specialist pain care) stay separately available, are not exercises and are not replaced by
  reparenting. `REPARENTING_FALSE_CHOICE` also names setting everyday protection or practical safety against reparenting.
- **Rules with the case.** `load_case_context`, `load_case_context_by_alias` and `load_handoff` results carry
  `therapy_rules`: the protocol's identity and the two served references above, byte-identical to the protocol's, with a
  note to load the complete protocol before advising.
- **A content-free trace.** The connector process writes one line per tool call: the tool's name (an advertised name, or
  `unknown`), whether it carried a token, whether it succeeded or its safe error code, the time it took and the response's
  size class. No arguments, case references or content. The next time a chat goes wrong, its calls can be found by their
  times, which shows whether it loaded the rules.
- Owner amendments r13 (the owner's words from #172), public-guide queue r10 (PGQ-038: protective acts are reparenting),
  integration notes in `tasks/case-plan-known-new-20261017/INTEGRATION.md`, a therapy lesson, tests.

## Change B — the plan in the record (second pull request)

Implemented as designed in `docs/superpowers/specs/2026-10-17-case-roadmap.md`, with two narrowings: the roadmap is
written only by authorized operator decisions (the runtime's extraction proposals are a later change), and
`case_plan` is computed by the connector from the opened case's own state rather than stored.

- **`case_state.roadmap`**, optional, so every existing record stays valid: goals with stable IDs and a rank; kind
  (primary aim, a goal within it, an independent support, safety or medical track); the source of each priority
  (`client`, `authorized_plan`, `provisional`), never upgraded silently; status (active, parked, blocked, completed,
  superseded); the client's agreement; evidence references; a review condition, the progress expected, known
  counterevidence, what the next step tests, the current uncertainty; a history of every change of rank or status with
  its time, turn and source; the goal the operational `current_episode` serves. A safety need or a withdrawn consent can
  override the ordinary rank while it lasts. Everyday protective care sits within the reparenting aim when that frame is
  welcome; independent medical and safety tracks stay their own entries.
- **Writes** go through the existing runtime path (`mergeRuntimeSnapshotIntoCaseState`), as `focus_discipline` does: the
  extraction may propose goals and changes, and a deterministic merge (`src/case-formulation/case-roadmap.mjs`) records
  them with their source and history. A model's proposal stays `provisional`; `client` needs the client's own stated
  priority in that turn; `authorized_plan` comes only from an authorized operator operation. No automatic change of a
  client's clinical priorities. The extraction, which will propose the goals, then gets the rule on a priority's source
  (today it records observations and composes no review, so Change A leaves its rules as they are).
- **Reads:** the record already travels in `load_case_context`; where no roadmap exists, the bundle carries a
  `roadmap_reconstruction` rebuilt from the current episode, the intervention history, parked questions and
  high-relevance items, labeled a proposed reconstruction, never stored as a decision.
- **New versus known as a tool:** a read-only, case-scoped `check_case_known_vs_new` ranks the record's established
  items and roadmap goals against each proposed point (the quote index's word reading), so a review can say what each
  point matches before calling it new.
- **Tests** from the issue's list, all synthetic: two independent cases; a long-term primary goal with a recent acute but
  subordinate event; different client priorities; a changed goal or consent; journal evidence that repeats an
  established theme against evidence that changes the next step or the order; a later turn with a different operational
  episode; protective care within reparenting without calling medical navigation an exercise; a safety interruption;
  readback after a restart; old records without a roadmap; refusal across cases.

## Change C — a test of whether the rules are applied (third pull request)

The owner's answer to question 40 and his request (17 Oct, 14:06 UTC): a regression test that checks whether an assistant
actually applies the reparenting definition when it synthesizes a complex case after loading the correct protocol; a
check that the tool was called, or that the right words are in the prompt, would not catch this failure.

- `src/evals/protocol-application.mjs` and `npm run eval:protocol-application` (`docs/PROTOCOL-APPLICATION-EVAL.md`):
  - four synthetic complex cases (`corpus/protocol-application-cases.json`): a journal review full of everyday protective
    acts and services; a supervisor inviting the split; a declined frame; an urgent danger;
  - the model gets the connector's instructions, tools and results (`load_therapy_protocol`, `load_case_context`,
    `find_journal_quotes`) from a real connector process, this checkout's or an earlier commit's (`--git-ref`), after the
    supervisor's message;
  - a judge of the other model family grades each reply against a fixed rubric written from the owner's definition, with
    a quote for every fail; it is first checked on 14 replies whose grades are known, on every rule
    (`corpus/protocol-application-calibration.json`), including the split the owner saw;
  - several replies per case, advisory pattern signals, isolated command-line agents.
- `CodexCliProvider` reports how many actions its agent took (`toolItems`), so a reply that reached outside the prompt
  isn't counted.
- `tests/protocol-application-eval.test.mjs` checks the test with fake models. The live run uses the owner's model
  usage, so it is run by hand, with his agreement.

## Owner gates

No clinical priority hierarchy is changed by either change; a model can only propose. The served-rule changes carry the
owner's own words from #172 as owner amendments. The owner's answer to question 40 (the chat loaded the rules) sets
which cause mattered most, not whether these changes are needed; change C measures whether a model applies them.
