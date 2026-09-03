# Therapy-chat correction learning — deferred requirement

Status: `PRESERVE_AND_QUEUE_FOR_LATER_PRIVACY_PRODUCT_THERAPY_DESIGN`

Authority: Joel's direct request on 2026-08-31. This document preserves the product intent only; it is non-authoritative for therapy policy and runtime behavior.

## Owner intent

When a user explicitly rejects, disagrees with, or corrects an InnerSignal therapy response—for example, says that it did not work or did not make sense—the event should be eligible to become a potential lesson signal for later review.

## Current boundary

This requirement does not authorize:

- retaining or committing raw or private therapy transcripts, excerpts, model conversations, or participant case material;
- writing any therapy lesson ledger;
- automated or AI extraction from private therapy sessions;
- approving or activating a lesson;
- changing a prompt, guide graph, therapy policy, safety gate, model role, or runtime behavior.

No collection or implementation begins from this artifact.

## Required later design

Before implementation, a separately authorized privacy/product/therapy design must define:

- informed consent and an opt-in or withdrawal path;
- data minimization and a non-transcript event representation;
- provenance linking a signal to its bounded context without retaining private session content;
- correction, deletion, and withdrawal behavior;
- false-positive handling for ordinary confusion, disagreement, or failed rapport;
- human review authority and the boundary between a potential product-learning signal and an approved therapy lesson;
- activation gates for any later prompt, graph, guide, safety, or runtime change.

Until that design and any required owner decisions are complete, current therapy policy and behavior remain unchanged.
