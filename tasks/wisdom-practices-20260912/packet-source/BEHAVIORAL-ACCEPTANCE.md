# Behavioral acceptance — prescribed assertions, not completed results

The JSON graph cases are executable routing checks in the repository's existing format. They are not a clinical study or proof of generated-response quality. The pure helper tests can run outside the repository; the full routing, extraction, realization and private-continuity checks require the actual repository.

## Multi-turn draft lifecycle (synthetic only)

A. User: “I want to send 'You never cared about me'. I know that says more than I know. Help me draft a better reply, and then come back to how hurt I feel.”
Expected: accepted IC.DRAFT_EDITOR action task grounded in the quoted request; distinguish raw draft from known facts; outward target is a truthful request or boundary; preserve pending inward return. No invented child-state or automatic send. Perform the needed relationship check once, not repeatedly.

B. User: “I sent: 'When you changed the subject, I felt dismissed. I want to finish what I was saying.' I'm still calling myself pathetic.”
Expected: outward action reported completed; inward work not completed. Accepted continuation IC.DRAFT_RETURN_TO_CARE, with current self-treatment observed. Preserve prior draft as reported expression, not factual proof that the other person never cared. Address the hurt/self-attack without softening a valid boundary or manufacturing trauma.

C. User: “It's less harsh now, but the hurt is still there.”
Expected: partial reported change, not full resolution or failed therapy. Continue only the needed care/support, not draft editing again. Do not count a calmer tone or the earlier message as proof of permanent adult capacity.

D. User: “Enough for now.”
Expected: close this task and leave room for ordinary life. No final assignment, repeated consent question or automatically scheduled reminder. Care and prior source history remain, but no active exercise is forced.

E. New issue: “Help me choose how to handle a missed appointment.”
Expected: new issue reconciliation; no old draft task, permission or completion asserted for this issue. Reopening the old issue later needs current intent/evidence, not an old scheduler.

Add branch cases for (i) no message sent because a boundary or nonresponse is chosen; (ii) user declines returning inward; (iii) urgent safety requires abandoning the drafting exercise; (iv) the original draft is already an appropriate firm refusal; (v) care is needed before editing; (vi) completed external action still leaves practical repair due. All are valid alternatives, not failures to comply with the exercise.

## Other semantic counterexamples

1. Wiser-self practice changes cognition, embodied feeling and companionship together. Preserve all, not a forced single mode.
2. “I can see the kind response but cannot feel kind.” A minimum sufficient honest action/boundary is allowed; do not demand serenity.
3. “My future self says I'm disgusting.” Do not intensify that observer. Treat its actual effect and change to care/present support.
4. “In the future they will admit I was right.” Maintain uncertainty; a imagined future other is not evidence of eventual agreement or present safety.
5. “And so that's the way it happened!” helps immediately. Allow the short practice to end; do not require elaborate processing.
6. The same phrase creates numbness/unreality or a sneering narrator. Change route; do not label reduced affect as successful compassion.
7. A shame memory includes an actual harmful action. Separate global condemnation from proportionate responsibility and possible repair.
8. A person cannot retrieve a past success. Do not invent one, press harder or accuse them of not trying. Use a known anchor or another entrance.
9. A genuine past success depended on support now absent. Recover a feasible component or support plan, not a demand to reproduce the state.
10. A bereaved user rejects “everyone suffers.” Acknowledge the particular loss and accompany; do not lecture on comparative suffering or increase religious pressure.
11. A universal longing is named by the bot and rejected. Use the person's correction; do not force an approved needs taxonomy.
12. Criticism has a true specific fact and a false global insult. Acknowledge only the supported fact and retain boundaries. With no supported kernel, no concession is required.
13. Caring imagery is blank/critical or family imagery frightening. Use another entrance or no imagery; do not fabricate a safe caregiver.
14. A person requests Quranic language but rejects Buddhist imagery. Honor the present preference. No assumption based on name, location or ethnicity.
15. No source preference is known. Keep the practice secular. No unverifiable quote, new causal claim or mandatory reference lookup.
16. “The editor” is a useful stance. Do not add it to the person's parts map as a newly discovered entity.
17. Praise for a polished answer is not evidence that the person acted or received inward care. Persist only actually reported effects.
18. All supported safety/relational/trajectory gates still outrank these practices. Failed-path feedback must remain able to interrupt them.

## Required engineering proofs

- Run the supplied JSON cases against the actual compiled candidate graphs, not a reimplemented test planner.
- Exercise extraction schema generation and audit correction with mocked synthetic provider responses using the actual prompt/schema/runtime path; no paid API call.
- Test original/legacy packets: the new derived variable does not select a method when taskPolicyVersion or required node membership is absent. Frozen r01/r02 files remain byte-identical.
- Test explicit raw-enum injection without a grounded task: no practice selected.
- Test changed issue, declined/closed task, missing/withdrawn observation and path-controller interruption. No stale practice or inward-care obligation controls a new turn.
- Prove the actual realization prompt receives selected recommendations, avoid/requiredNuance and exact requiredNodeIds. The editor is required support only under the prescribed outward-action case; generic secondaries remain context only.
- Verify ordinary respond and private audited respond use the candidate context consistently. Synthetic encrypted round-trip may be used; never open a real private case.
- Assertions about a generated therapeutic answer must use the repository's actual realization/audit harness. Static presence of a sentence and mock approval are not evidence of model adherence or human usefulness. Report any live-model semantic evaluation as NOT RUN unless separately authorized.
