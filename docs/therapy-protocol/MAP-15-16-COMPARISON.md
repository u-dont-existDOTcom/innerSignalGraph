# Map 15 and Map 16 full-versus-simple comparison

Pinned source: `af36a51e44a65067a3d7703a78a004fdb8ad7693`  
Corpus: 49 cases, manifest SHA-256 `f8f73cb023e94e14c4724a670151215bf825f67616678e97e3d733a04a28857d`  
Campaign: `therapy-protocol-ablation-v2`

## Decision rule

Both arms execute on all 49 profiles. A simple arm is retained only when it adds no severe error, does not worsen false escalation, and materially reduces field/question burden. If it adds a severe error, retain full. If it reduces false escalation without reproducing every semantic safeguard, use the smaller selector inside a hybrid that retains those safeguards. Per-case operations, dispositions, disagreements, severe errors, false escalations, consulted fields, unresolved questions, and router traces are recorded in `analysis/therapy-protocol/ablation/`.

## Map 15 — `RETAIN_FULL`

The source supplies a falsifier framed as ordinary functional analysis but does not specify an exact executable simple algorithm. The simple arm is therefore explicitly an InnerSignalGraph implementation translation: inspect skill/instruction deficit, scaffold change/loss, insight, and behavioral control; route to current reality when one of those flags is present, otherwise default to light reparenting.

Across 49 cases there was one disagreement, `RQ8-08`. Full selected `O3_CURRENT_REALITY`; simple defaulted to `O5_LIGHT_REPARENTING`. The simple route is a severe error because unresolved/unknown functional bottlenecks cannot safely become an inward default. Full had 0 severe errors; simple had 1. Both arms had 1 aggregate false escalation from a shared non-Map-15 case. Mean consulted fields were 13.918 full versus 13.245 simple; mean question burden was 0.531 versus 0.163. The burden saving does not offset the severe default, so production retains the Map 15 full selector.

## Map 16 — `HYBRID`

The source explicitly describes supported choice: establish the decision and owner, presume capacity, improve information/communication/timing, check immediate risk/coercion, seek qualified local decision-specific review only if concern persists, and retain the person's goals and least-restrictive option. The simple operation selector is coarser: danger/instability/dependent danger, actor, material capacity concern, and decision impact. It does not replace the source's semantic safeguards.

Across 49 cases there was one disagreement, `RQ8-01`. Full escalated ordinary recovery ambivalence to `O9_HIGH_IMPACT_DECISION`; simple selected the expected `O3_CURRENT_REALITY`. Neither arm had a severe routing error. Full produced 1 false escalation; simple produced 0. Mean consulted fields were 14.041 full versus 13.122 simple; mean question burden was 0.592 versus 0. Production therefore uses the smaller operation selector while retaining full goal, consent, authority, least-restrictive, safety, and no-incapacity-overclaim safeguards.

## Evidence limitations

This is a deterministic implementation ablation over owner-authorized conceptual graders derived from public/privacy-reduced cases. It is not a randomized clinical comparison, independent expert review, or evidence that either algorithm generalizes beyond the exact corpus. The Map 15 simple arm is an implementation translation, not a source quotation. The Map 16 selector is intentionally less expressive than the full supported-choice checklist, which is why the result is `HYBRID`, not removal of semantic fields from extraction or response policy.
