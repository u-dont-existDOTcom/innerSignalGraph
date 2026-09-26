# Exact code integration

Copy `payload/perspective-practices.mjs` to `src/guide-graph/perspective-practices.mjs`. Preserve the supplied bytes. No new dependency.

## Contract

In `src/guide-graph/contract.mjs`, prepend:

```js
import { PERSPECTIVE_PRACTICE_VALUES } from "./perspective-practices.mjs";
```

Insert as the first property of `CASE_VARIABLE_ENUMS`:

```js
perspective_practice: PERSPECTIVE_PRACTICE_VALUES,
```

Do not change GUIDE_GRAPH_CONTRACT, existing enum values, bundle version, installed package version, or old fixture bytes. This addition automatically flows through the existing generation/validation schemas. Preserve historical omission compatibility through the existing normalization; do not fill old frozen fixture files.

## Planner

In `src/guide-graph/planner.mjs`, prepend:

```js
import { perspectivePracticeForTask, eligibleDraftEditorSupport } from "./perspective-practices.mjs";
```

Immediately after the existing line:

```js
let task = taskPolicy && !interrupt ? validateTurnTask(turnTask) : null;
```

insert:

```js
variables.perspective_practice = perspectivePracticeForTask(task, graphs);
```

This runs before `matched` is formed. It deliberately overwrites raw input, including stale/spoofed input, and returns unknown for legacy/partial graph sets, declined/closed tasks and missing observation references. The existing caller's issue/evidence validation remains mandatory.

Replace the exact declaration:

```js
const secondary = eligible.slice(1, 5);
```

with:

```js
const draftEditorSupport = eligibleDraftEditorSupport({
  primary, eligible, task, variables, interrupt, emergency
});
const secondary = draftEditorSupport
  ? [draftEditorSupport, ...eligible.filter(n => n.id !== primary?.id && n.id !== draftEditorSupport.id)].slice(0, 4)
  : eligible.slice(1, 5);
```

Keep every existing primary selection, danger check, required review, blocked/deferred rule and path-controller branch unchanged.

Change the existing current-task-question expression from:

```js
const currentTaskQuestion = !emergency && task && task.node_id === primary?.id ? taskQuestion(task) : "";
```

to:

```js
const currentTaskQuestion = !emergency && task && (task.node_id === primary?.id || draftEditorSupport) ? taskQuestion(task) : "";
```

In the `noQuestion` expression, change ONLY:

```js
task?.question_focus === "none" && task.node_id === primary?.id && !emergency
```

to:

```js
task?.question_focus === "none" && (task.node_id === primary?.id || draftEditorSupport) && !emergency
```

Immediately after `const requiredNodeIds = primary ? [primary.id] : [];` insert:

```js
if (draftEditorSupport) requiredNodeIds.push(draftEditorSupport.id);
```

In the `taskApplies` expression, add `Boolean(draftEditorSupport)` as one additional OR condition. Keep every existing term. This makes the chosen action task's guidance available with its explicitly required editor support while outward action stays primary.

Do not change generic secondary execution, graph edge traversal, question precedence, tier ordering or the metta support exception. No practice becomes mandatory merely because its node is selected as context.

## Extraction / audit prompts and runtime capability

Use `perspectivePracticesEnabled(graphs)` from the supplied helper. Compute the boolean from the actual already-loaded graph bundle used for the current plan, not an environment toggle or presumed package version. Pass it as `perspectivePracticesEnabled` on extraction/audit prompt context in `src/case-formulation/run.mjs`. Reuse the current bundle load/cache; do not duplicate network or model calls. When graphs are historical or incomplete, this is false.

Create `src/prompts/perspective-practices.mjs` exporting the supplied extraction/audit blocks as plain strings. Append the extraction block to the system text in `src/prompts/case-extract.mjs` only when `context.perspectivePracticesEnabled === true`; append the audit block to `src/prompts/case-audit.mjs` under the same gate. Use string constants/interpolation; do not add independent reasoning agents. Avoid expanding all reference prose into the prompt.

Local syntax insertion needed to pass the context flag is mechanical integration, not permission to alter task selection, methodology or the current case audit. If the same bundle cannot be made available without a broader architecture change, report the exact blocker to Chat; do not invent a second planner.

## Existing state and continuity

Do not add a new draft state database. Existing `turn_task.issue`, `phase`, `agreement`, `marker`, `last_response`, `action` and `emotion` plus current observation provenance carry the task. Existing `reconcileIssueScope`, `validateTurnTask`, audit correction/withdrawal and private context remain authoritative.

Add tests of those existing paths with the supplied draft lifecycle cases. A current request/accepted task may move from draft editor to return-to-care after the actual reported response. Refusal, closure, changed issue and withdrawn observations must remove active authority. Retained historical evidence is not an active command. Never promote draft text into a factual assertion about someone else merely by persisting it.

## Rendering and delivery

The graph's selected recommendations/sourceRefs and existing executionContract are the runtime delivery mechanism. Exercise language stays in the graph/source records; do not duplicate it in the constitution. Ensure both the ordinary respond path and the private audited path receive the candidate graph rules through their existing packet/context loader. Test with synthetic context only.

A raw draft is private user content; no automatic external send is authorized. This task does not create a UI, a clipboard integration, an email sender, a scheduler or a new retention control.
