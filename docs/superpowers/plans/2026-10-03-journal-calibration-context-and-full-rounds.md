# Journal calibration: answered context requests, hardest self-repair and full rounds

Owner outcome (unchanged): import the journal as a committed generation with nothing lost and
no journal text leaked, and fix the process so that a supervisor review is not needed.

## Evidence (content-free counts from the failed rounds)

- Round 2 failed on the first calibration unit at the fidelity stage (11 of 12 reference items
  preserved after the repairs). The re-audit and the hardest fidelity repair from the previous plan
  addressed that path; round 3 never reached it.
- Round 3 failed on the same first unit during extraction. All three standard passes returned
  `needs_context` with one requested context item. The runtime never answered the request: the
  next pass received the same packet, so the extractor asked again. The hardest tier then
  extracted the unit completely, but its own omission review found one `wrong_mode` distortion
  (33 preserved) and nothing repaired it.
- Every round so far stopped at the first failing calibration unit. Calibration covers the twelve
  native position windows plus every visual page unit, so one round tested one unit and each fix
  waited a whole round for the next failure.

## Changes

1. **Context requests are answered.** After a pass that does not settle, each `requested_context`
   item is answered once per unit and direction. `before` and `after` widen that unit's window to
   at most 32,000 bytes of neighbouring source text (a visual unit first gets the other chunks of
   its own transcription); `whole_entry` widens both sides; `visual` adds the transcriptions of the
   unit's page and its two neighbours that exist. The next repair request carries
   `context_response` with `supplied`, `unavailable` or `already_answered` for each item, and the
   omission check sees the same widened packet. The omission checker's contract now also admits
   `visual_transcriptions`, so it reviews against the transcriptions the extractor saw (the field is
   sent only when there are any, so packets without visual context keep their identity). A first supplied answer earns one extra pass so it
   never consumes a repair attempt. An answer that would push the packet over the existing 180 KB
   source bound is withdrawn and reported `unavailable`. A batch of several units that names its
   needed context is answered instead of split; one that asks for smaller windows, names nothing,
   or gets nothing new is still split as before. Calibration fidelity repairs answer context too, and
   a first supplied answer there also earns one more standard repair.
2. **The hardest tier repairs its own answer once.** When the hardest extraction (or the hardest
   fidelity repair) is left unresolved by its own omission review, binding or a context request,
   it gets one repair at the same tier with that review, the binding failure and any context
   answer. Daily-limit pauses resume; a refused or exhausted repair leaves the first answer.
3. **Calibration rounds run to the end.** A failing calibration unit is recorded as source-only
   with its reason and diagnostics, and calibration continues with the next unit. The gate closes
   after the round, or earlier once `calibration_failure_limit` units have failed (default 3, so a
   systematic fault costs at most three units); the limit also stops the rest of a split batch. `calibration_failure` keeps the first failure's
   fields and adds `failed_units`, `completed_calibration_units`, `calibration_units` and
   `failures`; `recalibrate` keeps them in the history. Regular batches still start only after
   every calibration unit passes, and the pass predicate and recall target are unchanged.
4. **Diagnostics** gain `requested_context_by_direction`, per-pass `context_answer` counts and a
   nested `repair` snapshot for hardest repairs. All are schema enums, controller statuses or
   counts, validated by the existing allowlist. The extractor instruction documents
   `context_response`, `fidelity_review` and `mechanical_failure` in `repair_request`.

## Validation

Synthetic mock-port tests cover a supplied earlier window, unavailable and repeated requests,
visual neighbours, the packet bound, a multi-unit batch answered without a split, a visual
transcription chunk, the hardest self-repair in both phases, the failure limit, an invalid limit
and failure counting across a daily-limit pause. Existing tests were updated where the intended
behaviour changed (full rounds, the extra pass and the hardest self-repair).

## Guidance

Live default-branch Universal `AGENTS.md` and `LESSON-INDEX.md` were read. The outcome-advancement
pattern applies: direct outcome progress (calibration units passed) has been flat for three rounds,
so this change targets the strategy (full rounds and answered context) as well as the observed
faults. The suggested-fix lane holds only the already-ledgered claim-integrity owner question.
