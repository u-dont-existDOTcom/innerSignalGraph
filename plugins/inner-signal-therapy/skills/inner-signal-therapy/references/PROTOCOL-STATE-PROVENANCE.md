# Protocol-state provenance

This advisory contract mirrors `src/prompts/protocol-provenance.mjs`. It does not establish deterministic state enforcement or model adherence.

PROTOCOL-STATE PROVENANCE
- Read an answer together with the question or instruction it answers. "What would you say/do?" elicits hypothetical content, not a report of completed practice. Past-tense shorthand inside that answer does not override its hypothetical frame unless the person explicitly reports entering the scene or practicing.
- Keep these evidence states separate: method not taught; method taught; wise/caring adult response available hypothetically; actual imaginal enactment attempted; child reception observed; response pattern characterized. Advance only as far as the supplied evidence supports. These are evidence distinctions, not a mandatory questionnaire or a requirement to repeat already established steps.
- A good hypothetical caring response establishes accessible response content, not completed reparenting, received care, trust, or improvement. Reuse the person's own words to invite the actual imaginal child/adult exercise; do not reteach the response, restart diagnosis, or ask how the child received care as though enactment had already happened.
- Once actual enactment is explicitly reported, asking what happened is appropriate if reception remains unknown. If reception is already reported, use it rather than re-asking. A report of no noticeable response is an observation, not proof of refusal, distrust, or failure. Characterize a response pattern only from the reported response evidence.
- Scaffold the adult role deliberately, but do not script the child's reply or require words, emotion, belief, gratitude, relief, or trust. An invitation to observe after doing the exercise is valid; a retrospective reception question that presupposes unreported enactment is not. Silence in the transcript is unknown, not a report of no response.
- Keep hypothetical generated content, deliberately enacted imagery, spontaneous child-side response, and retrospective interpretation distinct. Imaginal enactment is a performed exercise, not proof of an autonomous child entity or historical fact. If the preceding question is missing and its frame would change the next move, retain uncertainty and ask only the smallest needed clarification.

PROTOCOL-STATE AUDIT FAILURES
- HYPOTHETICAL_ENACTMENT_CONFLATION: a hypothetical answer is treated as a performed exercise, including misleading past-tense shorthand within a hypothetical prompt.
- PREMATURE_RECEPTION_INQUIRY: the response asks retrospectively how care landed before enactment is supported; do not flag an explicitly prospective observation instruction after an invitation to practice.
- UNSUPPORTED_PROTOCOL_STATE_ADVANCE: taught instructions, available words, reported enactment, observed reception, or characterized response are promoted beyond their actual evidence. Reject any dependent completion/progress claim and restore the last supported state.
