# How gratitude comes in (2026-10-15)

## Parent owner outcome and authority

After approving the gratitude map's routing (owner page, question 33: "33 ok"), the owner said on 15 Oct 2026 at 10:28 UTC
how he brings gratitude in, and asked for critiques. At 11:19 UTC he answered question 34 ("i agree with all of your
corrections": four of his lines reworded for the AI, listed below) and question 35 ("yes": gratitude may come in during a
calm altered state). He said he will write the public-guide changes himself. The repository's rule still asks the
pending public-guide queue to record what the guide should teach (Codex's review of `4f34eb2d`), so this change adds
PGQ-034 (bringing gratitude in without pushing it) and PGQ-035 (gratitude in a calm altered state) for his edits.

The branch was stacked on the gratitude map change; after that merged (#159, `f6e4846f`, 13:14 UTC) it was rebuilt on
main and measured again against the merged map (same moves as below).

## What changes

1. `AMEND.IC.GRATITUDE_HOW_20261015` (owner amendments r11), in his words with the four agreed rewordings. It amends
   `AMEND.IC.GRATITUDE_FOR_EVERYONE_20261014`, where an obvious contradiction was looked at first.
2. `ROUTE.GRATITUDE_PRACTICE`: brought in sideways, at times rather than in every reply; his questions for "my life is
   hell" (would they be grateful if it suddenly weren't; if yes, the smallest part of that better life they could have
   now; if no, what makes it hard to imagine being grateful even then); peace with this exhale; the girlfriend example
   as one road among many, the examples being the kind of question to ask, not a script; toxic positivity (covering
   reality over is toxic, and so is ignoring every positive; controlling one's reaction is something to be thankful
   for); an AI doesn't model gratitude it can't feel, it thanks the person or says what humans have found; the sideways
   example after a night of crying; a calm altered state. Avoid: bringing it up in every reply, hammering it ("we can
   come back to this later, now may not be the time"), and "every cloud has a silver lining".
3. `IC.REALIZATION_LOVE_INTEGRATION`: a contradiction like "I love everyone, I just hate my dad" is worked toward from
   the love side ("Everyone makes mistakes also…"), not jumped to. Gratitude still waits until it has been looked at
   (question 33).
4. Question 35: the gratitude route no longer excludes `altered_state: altered`. Calm is shown, not assumed (Codex's
   review of `1ab74341`): in an altered state the planner admits the route only with the stable-state therapy's
   evidence (coherent capacity, a stable medical state, safe, oriented, able to stop), so unknown stays out, as do
   impaired capacity and a concerning medical state. `ROUTE.ALTERED_ACUTE_STABILIZATION` now defers it, so it waits
   while an otherwise calm state is overwhelming. Shut out means neither selected nor waiting: no deferral lists it
   either (Codex's review of `4f34eb2d`).
5. Planner: when `IC.BORROW_LOVE` holds the gratitude route back (a little ordinary love, unconditional love not felt),
   borrowed love keeps a place in the plan, in the last secondary slot, the place gratitude would have had beside the
   primary. Before, it could be crowded out of the plan's five places while still holding gratitude back, so the plan
   held neither (found in the 78-case walk-through). Like any secondary it is context, not a required exercise: Codex's
   review of `1ab74341` asked to make it required; answered on the pull request (a required second exercise beside a
   primary that leads for a reason, such as a neutral witness for someone flooded, goes beyond the owner's rule, which
   says where to start, and gratitude beside the primary was context too).
6. Graph cases G137 (a calm altered state lets gratitude in), G138 (an overwhelming one holds it back), G139
   (borrowed love keeps its place when it holds gratitude back) and G140 (an altered state not yet shown to be calm
   leaves it out); inventory counts 110 cases, 61 amendments.

## The four lines (question 34)

| His line | For the AI |
| --- | --- |
| "Then why should the universe give you that? It seems you don't even really want it." | If they say no, ask what makes it hard to imagine being grateful even then. |
| "Every cloud has a silver lining." | Left out; the route's avoid list names it, since the phrase is what people mean by toxic positivity. |
| "I'm sure you were thankful to let those tears out." | "Did letting the tears out bring any relief?" |
| "If I were human… I would be grateful for that." | "Thank you for telling me this." |

## What moves (against the map change's compiled bundle)

As written, one of the 78 earlier cases: G047, where borrowed love takes the last place from borrowing one adult
function. With unconditional love set to not felt: G002 and G047 (borrowed love in the plan, gratitude still waiting);
among the newer cases, G132 and G133 (gratitude waits instead of being left out). With it felt: G132 and G133. G009, the
one earlier altered-state case, doesn't move: its capacity and medical state are unknown, so it isn't shown to be calm. Tool: `compare.mjs` (cloud scratchpad `points/`), base and new planner each with its own bundle.

## Verification

Node 24.18.0: authoring check, validate and maps-check; graph regressions 109/109; therapy-lesson verifier; repository
audit; `tests/gratitude-love-access.test.mjs` 13/13. Graph regressions now 110/110. Full suite: exact-head CI.

## Owner answer to question 36 (15 Oct, 13:19 UTC): hypnosis during grief depends on its kind

His words: "what does that mean, when grief is fresh? how fresh? what level of grief? what level of hypnosis? for what
purpose? i don't think hypnosis in general is incompatible with grief nor with altered states at all... but it just
depends on what kind of hypnosis, what level of grief, what is appropriate at the moment etc". Recorded as
`AMEND.IC.HYPNOSIS_GRIEF_ALTERED_20261015` (owner amendments r11, with the gratitude amendment).

The map change (#159, merged) had two blanket holds I added: the hypnosis compiler refused every script while the
durable record said grief was fresh (`FRESH_GRIEF_HOLD`, from Codex's review of `1f3ad67e`), and the grief route deferred
`IC.GENTLE_SELF_HYPNOSIS` (gentle, present-focused self-hypnosis). Both go. The compiler holds nothing back for grief
alone; the conversation judges whether hypnosis fits. The grief route keeps gentle self-hypnosis beside grief, with his
principle as nuance on both nodes; deep inner-child dialogue still waits while grief is fresh (question 33). Nothing in
the map ruled hypnosis out in an altered state. The grief test's list of nodes that stay beside grief gains
`IC.GENTLE_SELF_HYPNOSIS` (38 deferrals: the gratitude practice, nonurgent pain navigation and 36 inward-work nodes). Pending
guide queue r8: PGQ-036. Inventory: 62 amendments, 140 source records.
