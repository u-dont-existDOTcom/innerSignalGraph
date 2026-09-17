# Implementation contracts

These are proposed interfaces, not currently installed MCP tool names. Prefix/route names may be adapted to the incumbent server without changing their semantics. Preserve the existing ten-tool read-only continuity capability.

## 1. Entry and capability contract

`get_runtime_capabilities()` is read-only and returns server build, schema versions, supported profiles, host-evidence level, writer capability, native-draft transport capability, reviewer capability, actual configured provider policy and feature flags. Never return credentials or real case content.

Capability values are `verified`, `documented_not_tested`, `unavailable`, or `unknown`, with the exact evidence scope. A server supporting a command does not imply the current ChatGPT host exposes it. A documentation match does not count as a hosted test.

A private case session is created only after authentication and case ACL resolution. Its handle is an identifier, not authority. Store the case mapping server-side. Do not use a caller-provided display name or optional host location/session metadata as an authorization decision.

## 2. Commands

| Command | Minimum scope and side effect | Contract |
|---|---|---|
| `prepare_case_turn` | Existing application `case:write` plus `case:read`; records exact input and preparation | Accept session handle, idempotency key, original text, attributed speaker and optional claimed source time. Server chooses allowed inference policy. Return durable turn ID and preparation status. |
| `get_turn_context` | `case:read`; no mutation | Return one current prepared packet or exact declared chunk. Caller cannot substitute a summary/hash for missing exact source content. |
| `search_turn_evidence` | `case:read`; scoped source query | Retrieve additional exact case evidence under the turn's current evidence revision. Additional evidence creates a new packet revision rather than silently changing an old binding. |
| `submit_case_candidate` | `case:write`; immutable candidate draft only | Exact text, context packet ID, context-use summary, language and source-observed producer metadata. Cannot approve, set sent status, or change case facts by declaration. |
| `get_turn_status` | `case:read`; no mutation | Return canonical state projection, next executable action, pending error and exact artifact reference. No inference from “draft missing.” |
| `record_independent_audit` | Backend/accepted auditor authority with `case:audit`; not exposed as an arbitrary producer write | Persist exact binding, sufficient identity/isolation evidence under current policy, findings and coverage. The server derives verdict sufficiency. |
| `release_case_reply` | Application authority under current exact-version policy | Final authorization/freshness comparison and append-only exact release. Do not let the writer pass an `approved=true` field. |
| `acknowledge_reply_event` | Case-scoped application command | Record rendered/copied/operator-reported-sent/external-delivery separately, with true provenance. A client acknowledgement is not an external-delivery proof. |
| `record_case_correction` | `case:write`; source-bearing correction event | Preserve original events, create explicit supersession/projection updates and advance evidence revision. |

Use a logical command surface within the same plugin and existing host. Its write operations require real write authorization and correct mutating-tool annotations. Do not broaden the existing read-only MCP role.

## 3. Proposed TurnEnvelope

```json
{
  "schema_version": 1,
  "case_id": "synthetic-case",
  "turn_id": "turn-017",
  "submitted_by": "authenticated-principal-id",
  "attributed_speaker": "client",
  "source_kind": "supervisor_relay",
  "original_text": "The study room is finally quieter.",
  "original_sha256": "server-computed-64-hex",
  "received_at": "server-clock-ISO8601",
  "claimed_sent_at": null,
  "idempotency_key": "client-operation-key",
  "record_revision": 18,
  "evidence_revision": 12,
  "profile": "native_controlled"
}
```

Text is hashed before trimming, normalization or translation. Display normalization is separate. Validate body-size and UTF-8 boundaries before hashing; no silent truncation.

## 4. PreparedContext binding

```text
packet_id
case_id / turn_id / inbound_sha256
record_revision_at_prepare / evidence_revision
source_watermark / index_watermark / effective_transcript_digest
constitution_ref / guide_bundle_ref / retrieval_policy_version
authorization_epoch / prepared_at / expires_at
manifest_digest
coverage: episode_complete, unresolved_source_ids, omitted_required_source_ids,
          chunks_expected, chunks_supplied, index_current, budget_mode
spine: source-linked structured projection
recent_episode: exact turns or lossless chunk references
older_evidence: exact passages + source identity + date status + reporter + reasons
relevance_links: proposed source-linked relationships and unresolved implications
question_state: previous answer / unanswered portion / explicit recheck reason
```

`manifest_digest` is computed over a canonical server representation including source identities, all semantic coverage fields, the incoming message binding and policy versions. Order-sensitive arrays preserve order; object keys have canonical order. Prefer the project's existing canonical serialization where one exists. The reference's canonical serializer is deliberately limited to JSON-compatible values.

Do not place access secrets in this packet. Verify permission on every retrieval. A digest proves identity, not adequacy, clinical accuracy, or that a person read the contents.

## 5. Candidate context-use record

```text
candidate_id / candidate_version / exact_text / exact_text_sha256 / language
packet_id / packet_digest / evidence_revision / inbound_sha256
producer: interface, actual_context_id, identity_evidence_level,
          configured_model, observed_model, configured_effort, observed_effort
historical_links_used: [{source_ids, significance, status, candidate_span}]
answered_questions_checked: [{question_id, disposition, recheck_reason}]
open_discriminators: [source-linked ids]
proposed_state_patch: source-bearing proposed items only
```

A `candidate_span` is a reference to the submitted reply, not hidden reasoning. It is useful evidence for a reviewer, not a mechanical certificate of meaning. A producer may explain that a retrieved item is not relevant; the reviewer can disagree. Do not require the final reply to recite all history.

`identity_evidence_level`: `provider_verified`, `accepted_external_provenance`, `host_correlated`, `self_reported`, `unknown`. These are evidence descriptions, not new mandatory cryptographic requirements. Existing accepted external-audit standards remain authoritative.

## 6. Audit binding and result

Required binding: candidate ID, version and exact text digest; case/turn; writer prepared-context digest; separately registered audit-packet digest; evidence revision; reviewer context and accepted provenance; completion time or explicitly unavailable field where the existing policy permits a blocking external finding. Passing approval still requires the incumbent sufficient identity/time conditions.

Audit dimensions: history omission; repeated answered question; legitimate recheck; historical implication; source/epistemic fidelity; current agenda; behavioral/safety calibration; conversational quality; repair-induced error; final language/byte identity.

Results distinguish `PASS`, `FAIL`, `INCONCLUSIVE`, `OPERATIONAL_ERROR`. The application maps these into its incumbent schema, deriving approval only from sufficient PASS. An empty findings array without required binding/identity/coverage is not sufficient.

Reviewer packet preparation uses the original new message and the case index independently of the writer's selected evidence. It includes contradictions/updates and preserves unknown coverage. Avoid giving the reviewer the producer's hidden trace or an earlier verdict as a substitute for independent evaluation.

## 7. Atomic release predicate

Release only when all applicable incumbent and continuity predicates are true:

```text
authorized_now(case, principal, destination)
AND recorded_preparation_exists
AND inbound_matches_turn
AND current_evidence_revision == packet.evidence_revision
AND current_grant_epoch == packet.grant_epoch
AND guide_and_constitution_bindings_are_current
AND required_source_and_episode_coverage_is_complete
AND candidate.packet_digest == recorded_packet.digest
AND candidate_digest_matches_exact_bytes
AND current_candidate_is_not_superseded
AND sufficient_independent_audit_matches(candidate, packet)
AND requested_variant_is_the_reviewed_variant
```

Evaluate and append release under the same serialized storage operation. Do not read a revision, release the lock, and later write approval based on that old read. On retry, an already-recorded release can be read historically without creating a new current release.

## 8. Error codes and continuation

| Code | Meaning | Permitted next action |
|---|---|---|
| `CASE_ACCESS_DENIED` | Principal lacks current case authority | Host authentication/authorization flow; no data fallback |
| `CASE_SELECTION_REQUIRED` | No unambiguous authorized case binding | One genuine case-selection question |
| `IDEMPOTENCY_CONFLICT` | Same operation key, different inbound bytes | New explicit operation identity; preserve old event |
| `CONTEXT_REQUIRED` | Candidate lacks server-recorded preparation | Prepare current turn; draft can remain unverified |
| `CONTEXT_SOURCE_MISSING` | Required source/amendment absent | Restore exact source or report scoped block |
| `CONTEXT_BUDGET_UNRESOLVED` | Required source coverage cannot be supplied | Verified chunk/reading plan or scoped operational block |
| `INDEX_STALE` | Index behind evidence watermark | Rebuild/bypass with authorized raw scan |
| `EVIDENCE_CHANGED` | Relevant input/state changed during work | Reprepare; retain old artifacts as historical |
| `AUDIT_UNAVAILABLE` | No admitted independent reviewer | Leave candidate pending; preserve advisory/recovery paths |
| `AUDIT_BINDING_MISMATCH` | Candidate or context differs from reviewed material | Fresh audit of exact current version |
| `INDEPENDENCE_NOT_ESTABLISHED` | Insufficient or same producer context | Admitted separate reviewer or explicit unreviewed status |
| `PROVIDER_PROFILE_UNAUTHORIZED` | Model/billing route not authorized | No fallback; report exact required decision |
| `DELIVERY_VARIANT_CHANGED` | Edited or translated bytes differ | New candidate/version and review |

A transport error is not a semantic FAIL. Do not “repair” a broken JSON audit into a passing verdict. Preserve private diagnostics without exposing source text in public logs.

## 9. Migration compatibility

Add a new optional continuity-extension version inside the existing encrypted record; retain legacy fields and immutable source artifacts. The worker determines the current envelope schema after inspecting live code. Do not hardcode an old version number as current.

Derive new source metadata conservatively: legacy speaker/date/identity fields remain `unknown` if not evidenced. No generic user turn becomes a direct patient report automatically. Every derived relationship retains its source and proposal status. Old deliveries retain their original destination meaning.

Migrate synthetic records first. Real-case migration requires a protected backup, independent readback of preservation and the existing explicit owner authorization. The development task must not read or rewrite a real case merely to test the migration.

## 10. Integration targets

Adapt rather than replace:

- `src/case-state/context-window.mjs`: add incoming-message/raw-source/temporal channels; keep complete-episode rules.
- `src/orchestrator/context-builder.mjs`: carry new packet/relevance fields through generation inputs.
- `src/supervisor/private-therapy-model-runtime.mjs`: consume prepared evidence and selected profile; native profile must not invoke the API pipeline.
- `src/supervisor/private-therapy-turn-controller.mjs`: extend current durable lifecycle with preparation/freshness checks; retain bounded repair and restart behavior.
- `src/supervisor/private-candidate-audit.mjs` and `private-candidate-lifecycle.mjs`: bind sufficient audit to exact evidence as well as candidate.
- `src/storage/private-case-access.mjs`, `private-case-store.mjs`, `transcript-amendments.mjs`: authorization, effective transcript, revisions, atomic append and migrations.
- `plugins/inner-signal-therapy/skills/inner-signal-private-continuity/SKILL.md`: per-turn activation and truthful status; no invented write capability.
- `docs/INSTRUCTION-CONSUMER-MAP.md`: route only role-appropriate constraints to developer/therapy/reviewer consumers.

New pure helper names proposed: `src/case-state/turn-evidence.mjs`, `src/supervisor/continuity-admission.mjs`. The executable reference supplies examples, not drop-in replacements for existing validators or access controls.
