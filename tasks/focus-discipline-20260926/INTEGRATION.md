# Focus discipline and suicidal-state decision — integration ledger

Status: OWNER-DIRECTED IMPLEMENTATION ON TASK BRANCH; merge is for the owner; installation, deployment and `stable` promotion not authorized
Date: 2026-09-26
Branch: `claude/focus-discipline-owner-decisions-20260926`
Integration base: `2a78556` (current `main`, after #80, music access, #54, #79, #86, #84)
Decisions: `OWNER-DECISIONS.json` (verbatim owner quotes)

## D1 — suicidal-state escalation stays off (record only)

The owner confirmed that the tier classifier and realization safety trigger not escalating on `suicidal_state` is deliberate: "no this was the point, it was detecting them wrong so i switched that nonsense off". Suicidal material stays with the suicidal graph nodes and, for imminent risk, the immediate-protection check. No behavior changed. The record is enforced by `tests/owner-decision-suicidal-state.test.mjs` and by comments at both code sites. No repository commit removes such an escalation; the history finding is in `OWNER-DECISIONS.json`.

## D2 — focus discipline

The owner asked for "only ask questions that move therapy forward", with exceptions, parked side questions that can become main questions, occasional mention of a side question depending on how important the current focus is, no endless pile-up, relevance over topic, and the therapist keeping things on point when the client drifts.

### How it works

- The extractor labels each open question `advances_focus`, `load_bearing` (looks off to the side but bears on the current target), or `side`, with a short note on why a side question might matter. It also reports the session focus: target, how urgent it is to stay on it (`high`, `moderate`, `light`), whether this is a natural pause, and whether the client is drifting (`tangent`) or steering away from a hard part (`avoidance`). A deliberate change of agenda is not drift.
- The auditor can reclassify a question (for example, "what is the shame protecting you from?" when every answer leaves the next step the same) or correct the session focus.
- The runtime (`src/case-formulation/focus-discipline.mjs`) keeps side questions out of the next-question slot and parks them in durable case state (`focus_discipline`). Load-bearing questions compete as main questions. Parked threads survive store reopen and are closed when answered, when the client comes back to them, or when they surface as the main question.
- Surfacing depends on the focus. Urgent focus, a client drift, safety, threat, protective-compatibility and leave-alone routes hold side questions. Under ordinary focus a parked question that is important (4+) and has waited 4 turns, or any when more than 4 are waiting, is mentioned in one sentence. At a natural pause the most important one is mentioned. With a light focus and nothing else being asked (or only the controller's generic "what is still unclear" probe), the parked question becomes the main question. A closing, declined, or no-question task only allows a mention.
- Bounds: at most 6 parked threads (least important retired first), a mentioned thread waits 3 turns before it can come up again, and after 2 mentions without uptake it is retired instead of nagging. History is capped at 40 closed threads.
- The realizer gets a `focusContract`. On drift it acknowledges the topic in one warm sentence, says it is saved, and returns to the focus without shaming or lecturing. On a mention it adds one declarative sentence after the main move.
- Root cause fixed in `src/prompts/common.mjs`: the rule that told the model to test a client's theory of a symptom (what it protects against, what function it serves) now applies only when the answer could change the next step for the current focus; otherwise the question is parked. The companion "what would feel dangerous if shame stopped" probe is gated the same way.
- The same rules ship in the plugin (`references/FOCUS-DISCIPLINE.md`, activated in `SKILL.md`) so Codex/Claude/ChatGPT hosts follow them. The MCP-served protocol now includes every always-read reference, which also fixes a gap where `ROLE-BELIEF-INTEGRITY.md` (added to the skill by #86) was not served.

### Relation to #52 and #80

Closed PR #52 added decision-changing markers, auditor target withdrawal and an adult-capacity gate across a large surface. This change keeps the core idea (a question has to earn its place) and adds what #52 lacked: parking instead of discarding, focus-dependent surfacing, bounded memory, relevance-based exceptions, and warm redirection. It does not reintroduce #52's developmental-capacity controller. #80's diagnose-before-replacing and borrowed-adult preparation are untouched.

### Compatibility

Snapshots, audits and case states without the new fields behave exactly as before (the controller disengages). Provider-generation schemas require the fields so live models must declare them. Mock fixtures and the therapy-policy fingerprints are unchanged.

## Verification

- `tests/focus-discipline.test.mjs`: controller, contracts, prompt activation, plugin/MCP delivery.
- `tests/focus-discipline-trajectories.test.mjs`: scripted trajectories through the real private runtime and encrypted storage — on-target question pursued; tangent redirected and parked; strong focus holds; natural-pause mention after a store reopen; light-focus promotion to the main question; client returning to a parked thread; load-bearing question beats a more important side question; auditor parks the protective-function probe (with an unaudited control); safety holds everything; 12-turn pile-up stays bounded and retires unaccepted offers.
- `tests/owner-decision-suicidal-state.test.mjs`: D1.
- Complete package gate and repository audit on the final head: recorded in the pull request.

Scripted providers exercise the runtime given a classification. They do not show that a live model classifies questions or focus well, and nothing here is clinical evidence.
