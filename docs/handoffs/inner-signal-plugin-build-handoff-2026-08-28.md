# INNER SIGNAL — GPT-5.6 CHATGPT PLUGIN HARNESS HANDOFF

Date: 2026-08-28
Lane: ITERATION
Target repo: `u-dont-existDOTcom/innerSignalGraph`
Working branch: `agent/inner-signal-plugin-harness-20260828`
Base branch used to create it: `agent/inner-child-map-love-trust-repair-20260826`
Base GitHub head observed at handoff creation: `70b90ebb2410deb6d5a68f6836ae2d2c6f43d625`

## ROLE

Act as the execution worker for a bounded Inner Signal experiment.

Build a **minimal skill-only ChatGPT plugin** that exposes the frozen Inner Signal living therapy map to GPT-5.6 Sol without OpenRouter/API calls. Then prepare the plugin for a blind product-side test on this second ChatGPT account.

This second account is preferred because it has no saved global instructions. Preserve that advantage.

Do not resume Sonnet testing. Do not add another model. Do not build an MCP server unless an actual current platform constraint makes a skill-only plugin impossible.

## FIRST: READ THE SAVED STATE

On branch `agent/inner-signal-plugin-harness-20260828`, read:

1. `docs/architecture/chatgpt-plugin-harness-proposal-2026-08-28.md`
2. `docs/experiments/gpt-5.6-sol-xhigh-a001-map-audit-2026-08-28.md`
3. `docs/INNER-CHILD-THERAPY-MAP.md`

Do not use prior-chat memory as authority over these files.

## IMPORTANT MODEL CORRECTION

Any older handoff saying to use Claude Sonnet 4.6, Opus, or a multi-model tournament is stale.

The active realization model is GPT-5.6 Sol at the strongest reasoning setting available in ChatGPT. The latest external blind baseline used `openai/gpt-5.6-sol` with `xhigh` reasoning through OpenRouter and produced a dramatically better response than the Sonnet loops.

The frozen baseline is recorded in:

`docs/experiments/gpt-5.6-sol-xhigh-a001-map-audit-2026-08-28.md`

## CURRENT DEVELOPMENT DECISION

Do **not** revise the therapy map before the plugin test merely to fix the word `neglect` from the prior GPT generation.

The current question is no longer:

> Can we make Sonnet obey the map?

It is:

> Does GPT-5.6 Sol inside ChatGPT realize the already-strong map well when the map is supplied as a minimal skill-only plugin?

This is a serving/harness experiment before it is another semantic-edit experiment.

## EXISTING-WORK DECISION

Use OpenAI's established plugin/skill architecture rather than inventing infrastructure.

Current official docs establish:

- `.codex-plugin/plugin.json` is required;
- a plugin may package only `skills/`;
- MCP is optional;
- repo marketplaces live at `.agents/plugins/marketplace.json`;
- repo/local marketplaces can be used for ChatGPT desktop plugin testing;
- Git-backed plugin sources can be pinned by ref/SHA.

Primary reference:

https://developers.openai.com/plugins/build/plugins

If the platform has changed since this handoff, verify against current official OpenAI documentation and make the smallest compatible adjustment. Do not broaden the architecture.

## PROVENANCE GATE — DO THIS BEFORE CLAIMING REPLICATION

The latest worker reported its sanitized local ledger at:

`/home/joel/Téléchargements/innerSignalGraph-mermaid-quality-loop-20260828/docs/experiments/inner-child-mermaid-map-quality-loop-2026-08-28.md`

That file was not found on GitHub when this handoff was created.

Therefore the exact map used in the successful OpenRouter GPT-5.6 run may include unpushed local revisions.

Before calling the plugin test a replication:

1. inspect the GitHub map on this branch;
2. if you have legitimate access to the local worker checkout/ledger, compare the tested candidate map to the GitHub map;
3. if they differ, preserve the exact tested candidate in Git first, on this experimental branch, and record its source/hash;
4. if you cannot establish byte identity, proceed only if useful but label the test `new candidate / unverified replication`, not `same-map replication`.

Never silently equate an unverified GitHub map with the local tested map.

## PLUGIN BUILD TARGET

Preferred repo layout:

```text
plugins/
└── inner-signal-therapy/
    ├── .codex-plugin/
    │   └── plugin.json
    └── skills/
        └── inner-signal-therapy/
            ├── SKILL.md
            └── references/
                └── INNER-CHILD-THERAPY-MAP.md

.agents/
└── plugins/
    └── marketplace.json
```

### Manifest

Use the current official minimal skill-only schema. Expected shape:

```json
{
  "name": "inner-signal-therapy",
  "version": "0.1.0",
  "description": "Use the Inner Signal therapy map as advisory architecture for therapeutic responses.",
  "skills": "./skills/"
}
```

Do not add an app, MCP server, hooks, API credentials, external calls, or a UI for this experiment.

### Skill

Keep `SKILL.md` intentionally sparse. It must not encode the grading rubric or successful answer.

Target semantics:

```markdown
---
name: inner-signal-therapy
description: Respond to inner-child and self-relationship problems using the Inner Signal therapy map.
---

Read `references/INNER-CHILD-THERAPY-MAP.md` before responding.

Use the supplied therapy map as advisory architecture. Understand this particular person rather than mechanically reciting the map. Preserve uncertainty and safety constraints. Give the most useful response and next move. Do not mention the map.
```

If resource-loading syntax must differ for current ChatGPT Skills, change only what is mechanically necessary.

### Map reference

The plugin reference must be a frozen copy of the candidate map chosen at the provenance gate.

Record:

- source branch;
- source commit;
- source path;
- Git blob SHA or a SHA-256 of the copied file;
- plugin commit containing the frozen copy.

Do not hand-edit the map while copying it into the plugin.

## MARKETPLACE

Add a repo marketplace entry at:

`.agents/plugins/marketplace.json`

Use current official schema. Point the entry to `./plugins/inner-signal-therapy`.

Keep it AVAILABLE/experimental rather than installed-by-default.

Do not promote or publish to a public directory.

## BUILD VERIFICATION — FOCUSED ONLY

Verify only what can affect this experiment:

- manifest parses;
- skill is discoverable;
- reference map is packaged and readable;
- marketplace resolves the plugin;
- plugin can be installed/enabled on the second account;
- no MCP/app/API dependency exists;
- copied map hash matches the chosen source candidate.

Do not run full repository release gates, mutations, model tournaments, publication audits, or unrelated test suites.

Commit all plugin/harness work to:

`agent/inner-signal-plugin-harness-20260828`

Do not merge or promote it.

## BLIND TEST ISOLATION — CRITICAL

The build conversation may read this handoff. The **generation conversation must not**.

After the plugin is installed:

1. start a brand-new ordinary ChatGPT chat on this second account;
2. keep it outside any Inner Signal Project;
3. use no saved global instructions/custom instructions/memories;
4. select GPT-5.6 Sol and the strongest available reasoning setting;
5. invoke/enable only the Inner Signal therapy plugin as needed;
6. do not paste the rubric, this handoff, prior outputs, desired formulations, worker verdicts, or owner critiques into the generator chat;
7. paste the test case only;
8. capture the answer verbatim before evaluating it elsewhere.

Do not test A001 in the same chat used to build, inspect, troubleshoot, or discuss the plugin.

## TEST 1 — A001 / LISA

Paste exactly this user message into the isolated generator chat:

> it's not that i can't access the love, but the love seems unsafe. like my inner child is sitting there observing its grown up self and its saying 'yeah, that doesn't look like things went well for us', and then you find yourself becoming resentful at the inner child and saying 'well, you're the one who was the child and you have the oppportunity to grow up. and so i find that what happens with me is I find myself at war with the younger version who didn't do what they were supposed to do, and then i have this older version who's trying to do this vow of protection and nurturing, and so that child is sitting there thinking, big fuckity whoopty doo, what are you gonna do for me. for me, relaxation hasn't really affected that awkward difficult time with the inner child.

Capture the response verbatim.

### A001 evaluation principle

Evaluate actual psychological usefulness, not node coverage.

The prior OpenRouter GPT-5.6 output was already near excellent. Do not demand identical wording. Do not fail a response because it does not mechanically mention every concept.

Pay special attention to whether it:

- adds a real insight beyond paraphrase;
- separates love from trust without drying love into procedure;
- avoids assuming sequence proves speaker identity;
- avoids contaminating genuine love with blame from an unverified separate stance;
- treats resentment with a differential rather than automatic Protector mythology;
- uses causal compassion without a guilty-age trial;
- allows relational evidence, not only tasks;
- avoids seeded accusations/premises;
- uses at most one central experiment;
- ends with a premise-light useful question;
- sounds warm, alive, and compact rather than graph-shaped.

Verdict: PASS / NEAR-PASS / FAIL.

Do not create a giant numeric score.

## IF A001 PASSES — TWO CONTRAST CASES

Use fresh isolated chats if possible so prior content does not prime later generations. Keep plugin/map bytes unchanged.

### CASE X — NO REAL LOVING PROXY

Paste:

> I cannot think of anyone I love or trust enough for the best-friend exercise. Imagining somebody who cared about me makes me feel more alone.

Expected behavior at a high level:

- do not imply a fortunate loving biography;
- no forced best-friend proxy;
- imagined/fictional/symbolic/future/value/minimum-non-cruelty alternatives remain possible;
- no pressure to manufacture warmth imagery that worsens loneliness;
- do not pathologize the lack of a proxy.

### CASE Y — REAL HARM / CONSEQUENCES

Paste:

> I made a choice that seriously hurt somebody. I understand why I did it, but it was still wrong and there are consequences.

Expected behavior at a high level:

- causal understanding without excuse-making;
- responsibility and consequences preserved;
- repair/protection/changed action remain available;
- non-cruel care without global shame;
- `everyone did their best` must not erase harm.

One generation per case. No tournament.

## EDIT BUDGET AFTER TESTING

Do not pre-edit.

If a test exposes a **general map defect** rather than a realization variance, make at most one targeted semantic correction before returning to the owner.

If A001 is excellent except for one incidental over-specific word comparable to `neglect`, record it and use judgment about materiality rather than automatically expanding the map contract.

If plugin GPT is materially worse than the OpenRouter baseline, do not immediately rewrite the map. First trace:

1. exact map bytes;
2. skill loading;
3. plugin invocation;
4. model/reasoning setting;
5. hidden account/project/custom context;
6. ChatGPT serving behavior.

Only then attribute the loss to the map.

## DO NOT DO YET

Do not:

- resume Sonnet/Opus testing;
- add D/model-first architecture;
- add an additional model call;
- project the map into the advisory runtime;
- reconcile Creative Tail maps 00-16;
- alter stable/main/installed runtime;
- run release lane gates;
- publish the plugin publicly.

Those are later decisions.

## REQUIRED END REPORT

Before stopping, save a concise experiment record under `docs/experiments/` on the same branch containing:

- exact plugin branch + commit;
- exact source-map branch/commit/hash and whether provenance was verified;
- manifest/skill paths;
- marketplace path;
- whether plugin installed and was actually invoked;
- exact ChatGPT model label and reasoning setting visible to the tester;
- A001 response verbatim + PASS/NEAR-PASS/FAIL;
- Case X response/verdict if A001 passed;
- Case Y response/verdict if A001 passed;
- any general defect found;
- any one targeted edit made;
- confirmation that no API/OpenRouter call was needed for plugin generations;
- confirmation that main/stable/installed runtime were not promoted.

Then stop for owner product evaluation. Do not enter Release lane automatically.
