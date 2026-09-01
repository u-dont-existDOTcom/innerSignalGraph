# Live local learning evidence

**Directive:** `ctc-innersignal-live-learning-loopback-20260901-001`, revision 1<br>
**Review request:** `rr-innersignal-pr15-live-learning-reconcile-20260901-001`<br>
**Owner outcome:** `OO-INNERSIGNAL-ASKRIGOR-LIKE-LEARNING-20260901-E2`, epoch 2<br>
**Strategy:** `live-local-loopback-learning-lifecycle-v1`<br>
**Start head:** `3900c58de688fa147628b6bb9e2b88af82abd8e5`<br>
**Typed claim:** `LIVE_LOCAL_LEARNING_SUBTASK_COMPLETE_PARENT_OPEN`, subject to the final
mechanical and post-execution Extra High gates.

## Authority receipts

The exact owner source was captured without a trailing newline at
`2026-09-01T00:28:21Z`; its UTF-8 SHA-256 is
`61d8521d5a27165b2bac0f8910c3d0fd9629e581ba1010040719b43a68773215`.
The self-contained reconciliation request has SHA-256
`6ad63aa31e33b4cdc4eeb1091347976a504cd1f84096e48d4511af22d37e9228`.
The exact Extra High directive has SHA-256
`2fe1f332fe658b109cea30df84aa50e0fc08ae1ba53ce1e06952c7751a792394`.
Extra High classified the slice `NO_PRO` because it implements bounded evidence handling and
does not choose therapy semantics.

## Executable boundary

The main app implements this same-device lifecycle:

```text
category-only correction/rejection
→ strict generalized evidence
→ exact memory-only preview
→ explicit default continuation or free refusal
→ durable private local queue and ISL-LOCAL receipt
→ maintainer triage
→ occurrence revocation and final-record deletion
```

The strict candidate admits only the fixed category mapping, optional user-authored redacted
summary, privacy acknowledgement, and product version identifiers. Unknown raw chat, answer,
transcript, identifier, therapy/case/graph state, embedding, source hash, offsets, generated
summary, or authority fields fail closed. `did-not-work` remains
`participant-reported` with `participant-report-only-no-causal-inference` and an `unclear`
outcome direction.

Preview nonces are random, single-use, memory-only, and expire within ten minutes. Durable
records are written atomically beneath the configured private local state root with directory
mode `0700` and file mode `0600` where supported. Occurrence and revocation tokens are stored
only as SHA-256 hashes; after submission, browser state retains only the receipt and raw
revocation credential needed for deletion. A retry with the same occurrence converges even
after an ambiguous response; a distinct occurrence increments the count. Final-occurrence
revocation deletes the candidate and its review metadata from this store without payment.

Maintainer commands are `status`, `list`, `show`, and `decide`. Their fixed dispositions change
only local review status and history. `prepare-therapy-policy-decision` produces
`needs-owner-therapy-decision`; it writes no therapy ledger and changes no therapy behavior.
Corrupt or unreadable store state exits nonzero rather than reporting invented zero counts.

## Privacy and isolation

- `rawChatStored=false`
- `assistantAnswerStored=false`
- `externalNetworkWriteCount=0`
- `remoteQueueWriteCount=0`
- `OpenAIApiCallCount=0`
- `OpenRouterCallCount=0`
- `learningStoreDiagnosticExported=false`
- `learningStoreGitDiagnosticOrProgressSynced=false`
- `candidateBackfillEnabled=false`
- `revocationPaywalled=false`
- `therapyRuntimeConsumerCount=0`
- `runtimeAuthority=none`
- `therapyPolicyAuthority=none`
- `externalTransmissionAuthority=none`

The paid API copy uses the exact phrase **account-identity shielding, not anonymity**. It states
that an InnerSignal-controlled provider account can avoid forwarding the user's personal
ChatGPT account as the downstream model-provider identity, while explicitly warning that
InnerSignal/payment systems, providers, network metadata, prompt content, and combinations of
ordinary facts may still identify or link the person. No provider or billing integration is
part of this slice.

## Artifact identities before diff freeze

- live candidate contract: `ce22919e9b4935b50211486600729d985c04b552934dfd8c5ce53ac51d583ec1`;
- live local store: `b284e41e8c23467938ae9df83b8817135f5b458da7eb80a954b91e6a9001533d`;
- strict evidence schema: `497303562794c1e22a664304d46d6169e75b0647fce2e5c8c12282a1d5511b3a`;
- synthetic correction fixture: `f0f264085f523e7f4daf2d6cb98c81a7e88ffdb2ba0319876eea039a58858555`;
- browser candidate/contribution contract: `c5664746ab26cf201d1cef16c4870e73af36e16791661c3df53502e1908a4c98`;
- bounded live verifier: `0c8d4fe5811b514b7bef216b985c3b487db6635150ccc33f140d438783e03bbb`.

## Verification boundary

The frozen-diff execution receipt will record the bounded live, policy, groundwork,
correction/server/web, Commons, web-smoke, repository-audit, and single final package gates;
the local commit/push; exact-head hosted workflow and CodeQL results; and unchanged `main` and
`stable` refs. This tracked evidence file does not pre-claim results that do not yet exist.

## Adequacy states

- Worker-to-contract alignment: `GREEN` before the final package and hosted gates.
- Contract-to-owner alignment: `MATCH_FOR_THIS_SUBTASK`.
- Operational alignment: `ADEQUATE_FOR_LIVE_LOCAL_LOOPBACK_ONLY`.
- Scientific adequacy: `NOT_ASSESSED_UNCHANGED`.
- Release adequacy: `NOT_AUTHORIZED`.
- Parent outcome: `OPEN`; a remotely networked cross-user queue and any therapy-policy
  incorporation require separate reconciliation and authority.
