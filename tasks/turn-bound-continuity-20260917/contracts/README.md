# Proposed schema definitions

`continuity-v1.schema.json` provides reusable shape definitions for selected envelopes and bindings. Validate an instance against the relevant `$defs` entry, not the unconstrained root. These are design candidates; adapt naming to current repository contracts rather than adding duplicate authority.

Schema validity cannot grant authorization, prove that a source was retrieved, establish reviewer independence, or approve a candidate. Server-computed hashes must be recomputed from the original exact bytes. Client-supplied metadata is not an identity receipt. The isolated reference uses in-memory test records and does not implement the complete transport schema.
