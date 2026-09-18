# InnerSignal instruction consumer map

## Purpose and authority

This map tells maintainers where instructions originate, which consumer may receive them, and what enforces that boundary. It is maintenance routing, not an always-injected checklist and not therapy, model, installation, or release authority.

Current owner and task requirements remain highest. `AGENTS.md`, `.github/codex-repository.json`, `state/CODEX-CURRENT-STATE.md`, `README.md`, `AUTOPILOT.md`, this index, current code/tests, and relevant live Universal guidance retain their established order. Installed behavior still comes only from `stable`; therapy/framework changes and promotion remain owner-gated.

## Source-to-consumer routing

| Source | Authorized consumer | Required destination | Mechanical evidence or enforcement |
| --- | --- | --- | --- |
| Current owner/task instructions and live task-relevant Universal guidance | Governed developer or reasoning supervisor | Development session or bounded execution directive | Session bootstrap, repository read order, task branch/diff, and applicable verification receipt |
| `AGENTS.md`, `.github/codex-repository.json`, `README.md`, and repository workflow documents | Maintainers, development workers, and repository supervisors | Developer control plane only | Repository discovery, exact command map, branch controls, audit, and reviewed diff |
| `docs/REASONING-SELECTION.md` | Authorized developer or reasoning supervisor selecting a method | Named repository reasoning task only | Explicit consumption by that role; the document's presence is not provider receipt or an executed effort setting |
| `AUTOPILOT.md` and `src/dev/*` role prompts/contracts | Application-owned audit, implementation, patch review, replay review, and escalation roles | Exact role call assembled by the development controller | Role-specific schemas, provider/model configuration, bounded retries, deterministic gates, replay admission, owner/promotion gates, and persisted job state |
| Guide text, owner amendments, source maps, candidate graph, and compiled graph | Context building, case formulation, intervention planning, and therapy realization | The exact pipeline stages that load those sources | Source hashes, compiler/graph tests, response contract, guide gates, and stable installation boundary |
| Formulation, critique, adjudication, and realization prompts | Their separately configured application model roles | One role-specific provider request | Strict output schemas, call-site provider configuration, parsing/validation, and recorded provider metadata |
| Exact current inbound, effective amended transcript, structured spine, complete active episode, and incoming-message-selected older evidence | Therapy writer under an explicitly authorized profile | Immutable server-prepared context bound to the turn and evidence revision, then the existing writer prompts | Server-computed inbound/effective-transcript/context digests, coverage fields, source/index watermarks, actual prompt-consumer tests, and explicit budget blocks |
| Original inbound plus independently reselected current case evidence | Fresh private candidate auditor | Separately digested audit packet under the same evidence revision | Writer-packet and audit-packet digests, exact candidate/version binding, packet-only isolation, and atomic currentness check before release |
| `src/orchestrator/response-contract.mjs` output | Private candidate assembly and downstream delivery lifecycle | Canonical `answer` plus structured `next_question`; the wrapper emits one exact candidate text | Response-contract tests and canonical candidate-text assembly; a final question already present as the exact final paragraph is not appended again |
| `inner-signal-private-continuity` activation instructions | Ordinary authorized ChatGPT advisory continuation | Current read-only case tools, or the separately scoped controlled native-turn commands when the component is available | Truthful tool/auth failure disclosure; off-path controlled coverage remains unknown; the skill cannot approve, release, externally send, or establish an independent audit |
| `native_controlled` turn input and native draft | Private runtime controller and server-backed candidate ledger | `READY_FOR_DRAFT`, then immutable exact candidate pending separate review | Native-profile tests mock every provider boundary to fail on invocation; no API fallback, approval, or delivery follows candidate submission |
| Controlled-turn MCP Apps component | Authorized ChatGPT UI and same-chat native writer | One exact input through `prepare_controlled_case_turn`; exact prepared context through `get_controlled_turn_context`; unmodified candidate through `submit_native_candidate` | Server fixes `native_controlled`, derives identities and host-correlated producer provenance, keeps mutation tools scoped, and labels the result `DRAFT_PENDING_REVIEW` |
| Exact controlled reply artifact and interaction acknowledgements | Authorized component | Draft or released bytes plus distinct displayed/copied/operator-reported-sent evidence | Server returns exact stored bytes; immutable interaction events never imply external delivery; only the existing independently audited delivery path yields `RELEASED` |
| Authorized private case state, exact candidate, and audit instructions | Fresh private candidate auditor | Sealed packet-only audit request | Required provider isolation: fresh context, no tools, no filesystem, no session persistence; strict audit schema and disclosure manifest |
| Exact failed private audit, failed candidate, and authorized case evidence | Fresh private repair provider | Sealed packet-only repair request | Candidate/audit binding, bounded repair cycles, provider isolation, strict repair schema, and repair-induced-error checks |
| Approved private candidate | Delivery controller and person receiving the response | Exact approved candidate text or authorized discriminator | Candidate identity/version checks, fresh independent audit, approval state, delivery record, and no hidden producer trace crossing the boundary |
| Hypnosis guide, entry/readiness rules, and waking-return contract | Specialist hypnosis pipeline only | Hypnosis-specific stages | Hypnosis schemas, readiness/consent gates, stop/return behavior, tests, and stable installation authority |
| Guide Packet sources, evidence, decision cases, and model-role contracts | Guide Packet verifier, compiler, independent reviewer, conditional escalation, and owner decision UI | Stage-specific verified packet fields only | Packet hashes/schema, exact model resolution, stage receipts, decision cards, owner approval, install verification, and rollback |

## Boundary invariants

- Do not paste Universal, Mission Control, repository governance, or reasoning-selection prose into therapy system prompts, private case packets, guide text, graphs, or delivered responses.
- Do not let a developer worker applying a bounded patch acquire application-supervisor, therapy-policy, owner, merge, installation, or release authority.
- Do not infer that similarly named providers share a contract. The application-owned high-effort reviewer and a developer execution session are distinct consumers with distinct inputs and gates.
- Preserve source wording, structured fields, and provider receipts separately. A document describing a method, model, or effort level does not prove that any provider received or executed it.
- Private audit and repair receive only the authorized packet. Repository-aware adapters, producer traces, prior verdicts, tools, filesystem access, and persistent sessions cannot substitute for the required isolation contract.
- Candidate-generated state remains a proposal until the exact candidate passes a sufficient independent audit and the same serialized operation rechecks evidence and authorization currentness before release.
- A component/server command or a successful read-only tool call does not prove that ordinary off-path ChatGPT messages were captured. Coverage is controlled only for exact inputs recorded by the controlled path.
- Passing replay preservation or canonical candidate assembly is only admission to the existing next gate. It is not semantic approval, owner approval, promotion, installation, or release.

## Maintenance

Update this map when a material change adds a new instruction source or consumer, changes where a source is injected, changes a role's provider/model configuration, or alters an enforcement gate. Keep detailed routing here instead of expanding the root bootstrap. Verify executable claims against current call sites and tests; documentation alone is not mechanical evidence.
