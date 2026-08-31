# Personalization boundary

Personalization is a strict, inspectable user-scope record plus a pure deterministic precedence resolver. It has no persistence and no runtime consumer.

Allowed memory types are presentation, process, and framing preferences plus user outcome cautions. Memory authority is fixed to `user-scope-only`, its override class is `soft`, and `runtimeConsumerPresent` is fixed to `false`.

The resolver applies this order:

1. hard safety and epistemic policy;
2. the user's current explicit instruction;
3. current case evidence;
4. user outcome cautions;
5. style, process, and framing preferences;
6. defaults.

A memory cannot encode a diagnosis, a global therapy rule, a causal conclusion from one reported outcome, a third-party character diagnosis, an instruction to always agree, an instruction to ignore safety or evidence, or validation of recovered-memory certainty. Preference memory must never become a sycophancy mechanism. Deciding how an outcome caution should alter intervention selection is outside this mechanical slice and requires later therapy-semantic review.
