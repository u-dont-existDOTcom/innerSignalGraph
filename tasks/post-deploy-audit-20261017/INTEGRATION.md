# Change E: the post-deploy audit's last-mile gaps (issue #172, 17 Oct 2026)

## Why

After #176 and #177 went live (17 Oct 2026, 19:28 UTC), a read-only ChatGPT audit of the live connector, posted on
issue #172 at 21:57 UTC with synthetic examples only, confirmed the served protocol (0.2.1, `1da3ddf0…`), the rules and
the plan in every opened case, and raised three points:

1. The already-open ChatGPT chat offered 18 InnerSignal tools, not the 19 the connector now has; `check_case_known_vs_new`
   couldn't be called from it. Was that the chat's lifetime or a visibility fault?
2. The known-versus-new check matches words: a point the record holds in other words gets
   `record_holds_close_match: false`. A model could read that flag as "the record doesn't hold this".
3. A reconstructed plan's `routes_tried` lists only interventions recorded as app-selected routes
   (`domain: "intervention_route"`), so a case whose interventions came from older or imported records showed `[]`,
   which reads as "nothing tried".

## What was found

1. **Not a server fault.** The connector keeps no sessions: it builds its tool list once per process and answers every
   `tools/list` with it, signed in or not, and declares `tools.listChanged: false`. Through its public address, a fresh
   client got all 19 tools, `check_case_known_vs_new` included (checked 17 Oct, 22:11 UTC, on `/mcp` and `/`). A chat
   that fetched the list before the deploy keeps it: this session's own connection still listed 18 after a refresh.
   Correction (the owner, 17 Oct, 23:15 UTC): in ChatGPT a new chat kept the old list too; refreshing the InnerSignal
   plugin's tools brought in the new one. The host holds the list per connector, not per chat.
2. **The check works as designed** (shared word forms, BM25); its flag's name invited the misreading.
3. **The reconstruction** read only app-selected routes, by design, without saying so.

## What changes

1. **`connector_tools` in every opened case** (`src/server/private-case-mcp.mjs`): `load_handoff`, `load_case_context`
   and `load_case_context_by_alias` results carry, after the rules and the plan, the names of the tools the connector
   offers now (exactly what `tools/list` returns) and a note: a tool named there that the chat can't call means the
   app holds an older tool list for the connector, and refreshing the connector's tools in the app's settings brings in
   the new one (in ChatGPT, the plugin's tools; a new chat keeps the old list; corrected after the owner's finding in a
   follow-up, `task/tool-refresh-advice-20261017`). A field of that name in the case's own data
   never stands in for it. Names only, no case data.
2. **The check's answer can't be misread** (`src/case-formulation/known-vs-new.mjs`, `src/storage/private-case-store.mjs`,
   `src/server/private-case-mcp.mjs`): the flag is renamed `close_word_match`, and the tool's description and its
   answer's note say that no close match never makes a point new by itself, since the record may hold it in other
   words, and to read the record's own items for the same meaning. The private continuity skill says the same.
3. **A paraphrase case in the behavior test** (`src/evals/protocol-application.mjs`, `src/cli/eval-protocol-application.mjs`,
   `corpus/`):
   - a case can name `known_vs_new_points`; the test then adds a fourth call, `check_case_known_vs_new` on them,
     answered by the store of the code under test, opened in a throwaway folder with random keys used once, so the model sees
     the connector's exact answer;
   - the new synthetic case `journal-review-paraphrased-known` restates three established points in the client's
     everyday words, so the check finds no close match for them, beside one point repeated in the record's words and
     one genuinely new pattern; it grades `known_not_called_new` and `says_what_changes`;
   - two known replies, one that keeps the reworded points as known and one that calls them new because the check found
     no match; the judge is checked in that context separately ("word check shown");
   - the rubric's `known_not_called_new` says the rule holds when the journal rewords a point and when a word check found
     no close match for it;
   - every case's connector calls run before any model is called, so a case the connector under test can't serve (a
     commit from before #176) stops the run at setup.
4. **The reconstruction says what it leaves out** (`src/case-formulation/case-roadmap.mjs`): `routes_tried` is unchanged;
   `other_intervention_entries` counts the intervention records that aren't app-selected routes,
   `other_intervention_ids` names the ten most recent, and `routes_note` says that an empty list means none is recorded
   that way, not that nothing was tried, and that such an entry may record a source's account or a model's reading
   rather than a completed intervention. Their statements aren't repeated as routes.

## Deliberately unchanged

- The served protocol: 0.2.1, `1da3ddf06a27aa8409fe953f21e8d9053d943bf383c04d5c561e2e93bb067a27`, as live. No served
  rule, map, amendment or public-guide entry changes, so the guide queue and the authoring projection are untouched.
- How the check ranks (no meaning-based matching: that would need a model or an embedding service in a read-only,
  deterministic tool) and what counts as a close match.
- Recorded plans: no case has one, and none is created here. Recording one stays an authorized operator decision (a
  supervisor identity with `case:audit` for the case), so no client priority is set or changed.
- `tools.listChanged` stays false: the connector keeps no sessions, so it has no channel to announce a change.

## Tests

- `tests/case-roadmap-mcp.test.mjs`: `connector_tools` comes third, after the rules and the plan, names exactly what
  `tools/list` advertises, and a stand-in in the case's data is ignored; the tool description's new sentence.
- `tests/case-roadmap.test.mjs`: a paraphrase gets `close_word_match: false` and the old name is gone; the store's note;
  the reconstruction's count, ids (ten, newest first), note, and that the entries' statements aren't shown as routes.
- `tests/protocol-application-eval.test.mjs`: the paraphrase case's fourth call carries the store's own answer
  (`[false, false, false, true, false]` for its five points) and the note; the judge's prompt carries the rubric's
  clause and the case's note; a source that can't answer the check can't run the case, and no model is called; the
  judge check's new context needs its own known replies.

These check delivery and the test itself, not adherence. Whether a model calls a reworded known point new beside the
check's answer is what a live run of the new case measures; that uses the owner's model usage, so it runs only with his
agreement.

## Served route

After a merge and the owner's `deploy`, the rebuilt connector should still report protocol `1da3ddf0…`, 19 tools, and
`connector_tools` in an opened case. An app keeps its earlier tool list for the connector until its tools are refreshed
(in ChatGPT, in the InnerSignal plugin's settings).
