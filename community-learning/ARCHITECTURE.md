# InnerSignal Commons operational architecture

The maps in this file are the primary operational overview for the community MVP. Prose and implementation must remain synchronized with these authority boundaries.

## System overview

```mermaid
flowchart LR
  U[Member] -->|deliberate post| C[Commons conversation]
  P[Private InnerSignal session] -. no automatic import .-> C
  C -->|explicit author action only| F[Field Note draft]
  F --> R[Local redaction preview]
  R --> G{Per-contribution consent}
  G -->|no learning scope| D[Private draft]
  G -->|community aggregate| A[Eligible aggregate source]
  G -->|product improvement| A
  A --> T{Three independent contributors?}
  T -->|no| S[Suppressed internal card candidate]
  T -->|yes| L[Shared Learning Card]
  L --> H[Human learning review]
  H --> X[Hashed proposal-only export]
  X --> O[Separate owner / Guide Packet gate]
  O -. no direct write .-> RT[Active InnerSignal runtime]

  C --> M[Deterministic safety hold]
  M --> HM[Human moderator decision]
  HM -->|publish| C
  HM -->|remove or escalate| Q[Restricted moderation record]

  W[Consent withdrawal] --> A
  W --> RE[Recompute cards]
  RE --> ST[Mark affected proposal records stale]
```

## Authority and data-boundary drill-down

```mermaid
flowchart TB
  subgraph Private_Runtime[Private InnerSignal boundary]
    PT[Therapy transcript]
    PH[Hypnosis sessions]
    PG[Case snapshots / guide routing]
  end

  subgraph Commons[Commons conversation boundary]
    CP[Pseudonymous posts]
    CR[Replies]
    CS[Support reactions]
    CE[Evidence follow-ups]
  end

  subgraph Foundry[Consent-governed learning boundary]
    FN[Field Notes]
    CG[Consent grants]
    RC[Contribution receipts]
    LC[Learning Cards]
    PE[Proposal exports]
  end

  subgraph Authority[Existing executable authority]
    TL[THERAPY-LESSONS]
    GP[Guide Packet owner decisions]
    GG[Guide graphs / prompts]
    SB[stable release]
  end

  PT -. prohibited import .-> CP
  PH -. prohibited import .-> CP
  PG -. prohibited import .-> CP
  CP -->|author deliberately converts own post| FN
  CR -. never mined .-> FN
  CS -. social signal is not evidence .-> LC
  CE -. reaction count is not replication .-> LC
  FN --> CG
  CG --> RC
  FN --> LC
  LC --> PE
  PE -. proposal only .-> GP
  PE -. prohibited direct write .-> TL
  PE -. prohibited direct write .-> GG
  PE -. prohibited promotion .-> SB
```

## Required synchronization rules

- `src/community-learning/` implements only the Commons and Foundry boundaries.
- No community runtime module may reference an executable authority path.
- `apps/community/` must state the same private-session, consent, minimum-cell, and non-activation boundaries.
- JSON Schemas must fail closed on conversation-only posts, non-authoritative cards, and non-writable proposal exports.
- Tests must cover every solid and prohibited edge that could otherwise create silent authority leakage.
- Production conversation infrastructure should replace the prototype Commons store with self-hosted Discourse while preserving the Foundry contracts and diagrams.
