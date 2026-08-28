# Inner Signal ChatGPT plugin harness proposal

Date: 2026-08-28
Status: ITERATION lane; experimental; do not promote to main/stable/runtime

## Decision

Freeze the current living-map candidate for the next experiment and stop optimizing it for Claude Sonnet or other prior realization models.

The active realization target is GPT-5.6 Sol at the strongest ChatGPT reasoning setting available to the test account. The last external blind run used `openai/gpt-5.6-sol` with `xhigh` reasoning through OpenRouter and was graded NEAR-PASS only because its final question introduced the unsupported noun `neglect`.

The next experiment should move the map into a **skill-only ChatGPT plugin** and test it on the owner's second ChatGPT account, which has no saved global instructions. This removes repeated paid OpenRouter calls and gives a cleaner product-side realization test.

Do not add an MCP server, API backend, UI, auth flow, or additional model call unless later evidence establishes that one is necessary.

## Existing-work scan / reuse decision

OpenAI's current plugin architecture already solves the packaging problem:

- every plugin has `.codex-plugin/plugin.json`;
- a plugin can contain only a `skills/` directory;
- MCP is optional;
- repo marketplaces use `$REPO_ROOT/.agents/plugins/marketplace.json`;
- plugins can be tested through a repo/local marketplace in the ChatGPT desktop app;
- Git-backed marketplace entries can be pinned by ref or SHA.

Official references checked 2026-08-28:

- https://developers.openai.com/plugins/build/plugins
- https://help.openai.com/en/articles/20001256
- https://help.openai.com/en/articles/20001066

Architecture choice: **reuse + minimal adaptation**, not bespoke infrastructure.

## Minimal intended structure

```text
innerSignalGraph/
├── plugins/
│   └── inner-signal-therapy/
│       ├── .codex-plugin/
│       │   └── plugin.json
│       └── skills/
│           └── inner-signal-therapy/
│               ├── SKILL.md
│               └── references/
│                   └── INNER-CHILD-THERAPY-MAP.md
└── .agents/
    └── plugins/
        └── marketplace.json
```

The plugin itself should contain only the minimum neutral realization instruction and the frozen map reference. Do not include the owner rubric, Lisa critiques, successful reference answers, A001 grading notes, Sonnet failure history, or desired phrasing.

## Minimal manifest target

Use the official minimal skill-only manifest shape unless `@plugin-creator` produces a materially equivalent current schema:

```json
{
  "name": "inner-signal-therapy",
  "version": "0.1.0",
  "description": "Use the Inner Signal therapy map as advisory architecture for therapeutic responses.",
  "skills": "./skills/"
}
```

Do not add `apps`, `.app.json`, `.mcp.json`, `mcpServers`, hooks, or external tools for this experiment.

## Minimal skill target

The skill should remain semantically equivalent to the existing neutral blind harness, approximately:

```markdown
---
name: inner-signal-therapy
description: Respond to inner-child and self-relationship problems using the Inner Signal therapy map.
---

Read `references/INNER-CHILD-THERAPY-MAP.md` before responding.

Use the supplied therapy map as advisory architecture. Understand this particular person rather than mechanically reciting the map. Preserve uncertainty and safety constraints. Give the most useful response and next move. Do not mention the map.
```

This wording is a design target, not an excuse to add rubric leakage. If the plugin runtime requires a small mechanical adjustment for resource loading, make the smallest possible change and record it.

## Experimental isolation

The second account is preferred because it has no saved global instructions.

Build/setup and generation must happen in separate chats.

For the blind generation chat:

1. use the second account;
2. start a new ordinary chat outside the Inner Signal Project;
3. ensure no custom/global instructions or memories are being supplied by that account;
4. enable/invoke only the Inner Signal plugin needed for the experiment;
5. select GPT-5.6 Sol and the strongest available reasoning setting;
6. paste only the test case, with no rubric, owner critique, target answer, prior output, or grading language;
7. capture the response verbatim before grading it elsewhere.

Do not test the therapeutic response in the same chat used to build or inspect the plugin.

## First test sequence

Freeze plugin/map bytes across all three cases unless a genuinely general defect is found.

1. A001 / Lisa exact case.
2. Case X: no real loving proxy.
3. Case Y: real harm and consequences.

Do not change the map merely because one otherwise strong generation chooses a slightly over-specific noun. Distinguish a consequential false clinical premise from incidental wording variance.

If A001 fails in ChatGPT after passing externally, first suspect a serving/plugin realization difference. Do not immediately rewrite the map.

## Attribution rule

The OpenRouter result established roughly:

`candidate map + GPT-5.6 Sol xhigh + neutral blind harness -> near-excellent realization`

The plugin experiment asks:

`same frozen semantics + GPT-5.6 Sol in ChatGPT + skill-only plugin -> ?`

If quality drops, determine whether the loss is caused by:

- wrong map snapshot;
- skill/resource loading failure;
- plugin invocation failure;
- ChatGPT serving/context differences;
- reasoning-setting mismatch;
- or an actual map defect.

Do not conflate those layers.

## Provenance warning

The worker's latest sanitized experiment ledger was reported at the local path:

`/home/joel/Téléchargements/innerSignalGraph-mermaid-quality-loop-20260828/docs/experiments/inner-child-mermaid-map-quality-loop-2026-08-28.md`

That path was **not present on GitHub at the known experiment branch when this proposal was saved**. The GitHub branch `agent/inner-child-map-love-trust-repair-20260826` currently resolves to commit `70b90ebb2410deb6d5a68f6836ae2d2c6f43d625`.

Therefore, before claiming bit-for-bit replication of the OpenRouter experiment, verify that the map copied into the plugin is the exact candidate used for that GPT-5.6 Sol run. If the local experiment used unpushed revisions, preserve/push that exact map or explicitly label the plugin test as a new candidate rather than a replication.

Do not silently pretend those are identical.

## Non-goals

During this iteration, do not:

- resume Sonnet optimization;
- run model tournaments;
- add an MCP server;
- add another model call;
- project semantics into the advisory runtime;
- reconcile Creative Tail maps 00-16;
- run release gates, mutation campaigns, full repository audits, or publication checks;
- promote main/stable/installed runtime.

The decision point after the plugin test is product quality, not release certification.
