# DEV-R005 D005 deterministic CBOR prior-work scan

Updated: 2026-09-04

## Gate

`PRIOR-WORK CHECK: required`

D005 selects a durable serialization technology family. A concrete deterministic encoding profile, decoder contract, implementation library, field layout, or persistence design would cross a durable compatibility and security boundary. This artifact is analysis only and does not authorize S004 or any implementation.

## Independent conception snapshot

- durable envelope direction: deterministic CBOR
- input semantic object: existing S002 encrypted envelope
- output goal: stable durable bytes eventually usable by a later persistence layer
- current security requirement: malformed/adversarial durable bytes must never weaken existing S002 failure semantics
- no library/profile/layout/persistence choice has been made

## Standards scan

### Evidence and terminology

Evidence labels used below:

- `STANDARD`: a published standards body specification or registry.
- `OFFICIAL_IMPLEMENTATION_DOCUMENTATION`: documentation maintained with the implementation.
- `PACKAGE_METADATA`: the published npm manifest or registry metadata.
- `SOURCE_INSPECTION`: direct inspection of the named released package source.
- `EMPIRICAL_SYNTHETIC_PROBE`: a repeatable local probe containing no user or therapy material.
- `INFERENCE`: a bounded conclusion drawn from the preceding evidence.
- `NOT_VERIFIED`: not established by this scan.

The normative baseline is [RFC 8949](https://www.rfc-editor.org/rfc/rfc8949.html), especially Sections 4.1, 4.2, 4.2.1, 4.2.2, 4.2.3, 5, 10, and Appendix F. `STANDARD`

- Section 4.1 defines preferred serialization. Integers, lengths, and tags use the shortest argument encoding; floating-point values use the shortest representation preserving the value.
- Section 4.2.1 identifies the additional rules needed for deterministic encoding.
- Section 4.2.2 defines Core Deterministic Encoding Requirements: preferred serialization, no indefinite-length items, and map keys sorted bytewise lexicographically by their deterministic encodings.
- Section 4.2.3 defines Length-First Deterministic Encoding: shorter encoded keys sort first, then bytewise lexical order. This preserves the older RFC 7049 ordering convention and can produce different bytes from Section 4.2.2.
- Section 5 makes the application protocol responsible for defining what data is valid and how a decoder handles invalid or unexpected data. “Valid CBOR” alone is not an application schema.
- Section 10 treats decoded input as hostile even when it arrived inside a signed or encrypted structure. It calls out resource exhaustion, nesting, duplicate map keys, multiple interpretations, and evolving tag semantics.
- Appendix F supplies a well-formedness-checking model; well-formedness, deterministic form, and application validity remain separate checks.

“Deterministic CBOR” is therefore not a sufficiently exact implementation profile by itself. This scan distinguishes three families:

1. **RFC 8949 Core Deterministic** (Section 4.2.2): plain bytewise map-key ordering.
2. **RFC 8949 Length-First Deterministic** (Section 4.2.3): encoded-length-first ordering retained for compatibility with older “canonical CBOR” implementations.
3. **CTAP2 canonical CBOR**: a protocol-specific profile that explicitly differs from RFC 8949 deterministic encoding, forbids tags, limits nesting, and uses its own map ordering rules. The authoritative definition is the [FIDO Client to Authenticator Protocol, Message Encoding](https://fidoalliance.org/specs/fido-v2.2-ps-20250714/fido-client-to-authenticator-protocol-v2.2-ps-20250714.html#sctn-message-encoding). `STANDARD`

No profile is selected here. In particular, CTAP2 is not an interchangeable spelling of RFC 8949 Core Deterministic CBOR.

### Tags and shared vectors

The [IANA CBOR registries](https://www.iana.org/assignments/cbor-tags/cbor-tags.xhtml) are live registries, not a fixed allowlist embedded by RFC 8949. The tag registry was observed with a 2026-07-20 last-updated value and includes the self-described-CBOR tag 55799 among many application semantics. `STANDARD` A future envelope profile must explicitly say whether tags are forbidden or which exact tags are permitted; merely accepting a library's current tag registry would make meaning depend on implementation and registry evolution. `INFERENCE`

The current shared corpus is [cbor-wg/cbor-test-vectors](https://github.com/cbor-wg/cbor-test-vectors), observed at commit `7e84843b646676a715d4da21c719f263e4c43440` with BSD-2-Clause metadata. It includes success, failure, and round-trip material across implementations. `SOURCE_INSPECTION`, `PACKAGE_METADATA` The older `cbor/test-vectors` corpus is historical RFC 7049-era material and is insufficient by itself for a new RFC 8949 profile. `SOURCE_INSPECTION`, `INFERENCE`

Shared vectors can be reused as parser/encoder evidence, but they cannot decide the Inner Signal envelope schema, allowed CBOR types, limits, tag policy, or accepted deterministic profile. `INFERENCE`

## JavaScript and Node ecosystem scan

Snapshot date: 2026-09-04. Version, license, dependency, engine, and publication claims are from npm package metadata; repository activity is a point-in-time GitHub readback. Advisory queries used the public GitHub Advisory API filtered to each npm package, and the isolated probe installation reported zero current npm audit findings. `PACKAGE_METADATA` Absence from those queries is not proof that a package has no undisclosed or future vulnerability. `INFERENCE`

| Package | Snapshot | Maintenance and platform signal | Deterministic encode surface | Decoder/security surface | Assessment for a later spike |
| --- | --- | --- | --- | --- | --- |
| [`cbor2`](https://github.com/hildjj/cbor2) | 2.3.0; MIT; one runtime dependency (`@cto.af/wtf8`); Node `>=20` | Published 2026-03-05; repository activity observed 2026-03-21; documented as web-first and ran on Node 24.18.0. `PACKAGE_METADATA`, `OFFICIAL_IMPLEMENTATION_DOCUMENTATION`, `EMPIRICAL_SYNTHETIC_PROBE` | `encode(value, { cde: true })` emitted preferred forms and RFC 8949 bytewise key order. Binary `Uint8Array` values emitted as untagged CBOR byte strings when built-in type encoders remained enabled. `SOURCE_INSPECTION`, `EMPIRICAL_SYNTHETIC_PROBE` | CDE decode rejected indefinite items, nonminimal integers/lengths, duplicate or out-of-order keys, trailing data, malformed input, and a configured depth excess. CDE defaults alone accepted a nonshortest float; adding `rejectLongFloats: true` rejected it. Unknown tags become generic `Tag` values when global tag handlers are ignored, so the application schema must reject them if tags are forbidden. `SOURCE_INSPECTION`, `EMPIRICAL_SYNTHETIC_PROBE` | Serious candidate, but only behind an explicit options wrapper, exact schema validator, tag/type restrictions, byte and nesting limits, and adversarial regression suite. No selection. |
| [`cborg`](https://github.com/rvagg/cborg) | 6.1.2; Apache-2.0; zero runtime dependencies | Published and repository activity observed 2026-08-31; browser/Node `Uint8Array` API; ran on Node 24.18.0. `PACKAGE_METADATA`, `OFFICIAL_IMPLEMENTATION_DOCUMENTATION`, `EMPIRICAL_SYNTHETIC_PROBE` | `rfc8949EncodeOptions` emitted preferred forms and RFC 8949 bytewise key order; the default encoder instead uses legacy length-first ordering. Binary values remained untagged byte strings. `OFFICIAL_IMPLEMENTATION_DOCUMENTATION`, `EMPIRICAL_SYNTHETIC_PROBE` | With `strict`, `allowIndefinite: false`, and `rejectDuplicateMapKeys: true`, decode rejected nonminimal integers/lengths, indefinite items, duplicates, unsupported tags, trailing data, and malformed input. Documentation explicitly says strict decode cannot enforce shortest floats or map order. Both ordering variants and a nonshortest float were accepted in probes. No documented depth limit was found. A decode then RFC-8949 re-encode byte-equality gate distinguished all three probe cases, but that composition itself needs analysis and tests. `OFFICIAL_IMPLEMENTATION_DOCUMENTATION`, `SOURCE_INSPECTION`, `EMPIRICAL_SYNTHETIC_PROBE`, `INFERENCE` | Serious candidate if composed with size/depth controls and an exact deterministic byte-equality gate. No selection. |
| [`cbor-x`](https://github.com/kriszyp/cbor-x) | 1.6.6; MIT; zero required dependencies; optional native `cbor-extract` | Published 2026-08-25; repository activity observed 2026-08-25; browser and Node exports; ran on Node 24.18.0 without the optional native dependency. `PACKAGE_METADATA`, `EMPIRICAL_SYNTHETIC_PROBE` | No documented RFC 8949 deterministic/canonical encoder option was found. Semantically equal objects with reversed insertion order produced different bytes. `OFFICIAL_IMPLEMENTATION_DOCUMENTATION`, `SOURCE_INSPECTION`, `EMPIRICAL_SYNTHETIC_PROBE` | Duplicate keys used last-value-wins; indefinite and nonminimal encodings were accepted; unknown tags became `Tag`; trailing and truncated data were rejected. Source has very large collection-size ceilings and renames `__proto__`, but no bounded nesting option was established. Default binary encoding added tag 64. `SOURCE_INSPECTION`, `EMPIRICAL_SYNTHETIC_PROBE` | Useful performance comparator, not established as a safe primary deterministic envelope boundary. No selection. |
| [`cbor` / node-cbor](https://github.com/hildjj/node-cbor) | 10.0.12; MIT; one runtime dependency (`nofilter`); Node `>=20` | Published 2026-03-04; repository activity observed 2026-03-22; official documentation directs new users to `cbor2` and limits this line to catastrophic fixes. Browser use is split to `cbor-web`. `PACKAGE_METADATA`, `OFFICIAL_IMPLEMENTATION_DOCUMENTATION` | `encodeCanonical` was insertion-order independent in the probe, but the legacy “canonical” name does not by itself establish the selected RFC 8949 profile. Default binary encoding added tag 64. `EMPIRICAL_SYNTHETIC_PROBE`, `INFERENCE` | Configurable duplicate-key and depth rejection plus trailing/malformed rejection were observed. Indefinite encodings, nonminimal integers, nonshortest floats, both map orders, and unknown tags were accepted by the probed configuration. `SOURCE_INSPECTION`, `EMPIRICAL_SYNTHETIC_PROBE` | Superseded maintenance line; retain only as compatibility evidence. No new-adoption selection. |

### Cross-cutting compatibility and security observations

- **Exact field model:** The existing S002 envelope uses nested objects plus binary `Buffer` values. The later serializer must preserve byte-string identity and reject additional or missing fields before any S002 decrypt operation. The CBOR map/field layout remains `UNSELECTED`. `SOURCE_INSPECTION`, `INFERENCE`
- **Deterministic acceptance:** Stable encoding is not enough. If durable input accepts multiple byte representations of the same semantic envelope, later hashing, migration, comparison, and corruption diagnostics can diverge. A selected profile should reject nondeterministically encoded but otherwise valid CBOR, not silently normalize it. `STANDARD`, `INFERENCE`
- **Duplicates:** Duplicate keys are well-formed CBOR but invalid for a unique-field envelope. Any last-value-wins or first-value-wins decode can conceal attacker-selected values. Duplicate rejection is mandatory before semantic use. `STANDARD`, `INFERENCE`
- **Tags and extensions:** The S002 envelope needs no tag semantics in the observed object shape. A later profile should begin from an explicit deny-by-default tag/type policy; this scan does not select that policy. `SOURCE_INSPECTION`, `INFERENCE`
- **Prototype keys:** The synthetic `__proto__` map did not pollute `Object.prototype` in the probed libraries; `cbor-x` renamed the key and node-cbor produced a `Map`. This is not a substitute for an exact allowed-key schema, and a rename would be semantically lossy. `EMPIRICAL_SYNTHETIC_PROBE`, `INFERENCE`
- **Limits:** Input byte length, nesting depth, collection sizes, and decoded allocation budget must be bounded before durable bytes reach decryption. Library maximums that approach JavaScript engine limits are not an application resource policy. Exact limits remain `UNSELECTED`. `STANDARD`, `SOURCE_INSPECTION`, `INFERENCE`
- **Failure semantics:** Parser/profile/schema failure must map to a single safe storage-envelope failure without invoking S002 decrypt or exposing which inner field failed. The exact public error API remains `UNSELECTED`. `SOURCE_INSPECTION`, `INFERENCE`
- **Browser compatibility:** `cbor2`, `cborg`, and `cbor-x` advertise browser-capable paths; node-cbor directs browser users to a separate package. A real browser-bundle/CSP check was not run. `OFFICIAL_IMPLEMENTATION_DOCUMENTATION`, `NOT_VERIFIED`
- **API stability:** Released APIs were inspected at the pinned versions above. Semver-upgrade behavior and long-term maintainer support are `NOT_VERIFIED`; any later dependency must be exactly pinned and reviewed under the repository's dependency policy. `PACKAGE_METADATA`, `INFERENCE`

## Synthetic probes

All probes ran outside the tracked repository in an isolated temporary npm project with `--ignore-scripts --omit=optional`, using Node 24.18.0 on Linux. No project dependency or package file changed. Inputs were synthetic primitives and an S002-envelope-shaped object containing only fixed counter bytes; no key, secret, transcript, private content, or private-derived hash was used. `EMPIRICAL_SYNTHETIC_PROBE`

| Case | cbor2 2.3.0 | cborg 6.1.2 | cbor-x 1.6.6 | cbor 10.0.12 |
| --- | --- | --- | --- | --- |
| Same object, reversed insertion order | same bytes | same bytes with `rfc8949EncodeOptions` | different bytes | same bytes with `encodeCanonical` |
| Binary byte-string round trip | preserved, untagged | preserved, untagged | preserved, tag 64 emitted | preserved, tag 64 emitted |
| Duplicate string map key | rejected | rejected with option | accepted, last wins | rejected with option |
| Indefinite map | rejected | rejected with option | accepted | accepted |
| Nonminimal integer | rejected | rejected with `strict` | accepted | accepted |
| Nonshortest float64 value representable as float16 | accepted by CDE defaults; rejected with `rejectLongFloats` | accepted; deterministic re-encode differs | accepted | accepted |
| Trailing second item | rejected | rejected | rejected | rejected |
| Unknown tag 1000 | generic `Tag` when global handlers ignored | rejected with no tag decoder | generic `Tag` | generic `Tagged` |
| Truncated map | rejected | rejected | rejected | rejected |
| RFC 8949 core-ordered mixed numeric keys | accepted | accepted with `useMaps` | accepted without order validation | accepted without order validation |
| Legacy length-first order of same keys | rejected by CDE decode | accepted; deterministic re-encode differs | accepted | accepted |
| 64 nested arrays with configured max depth 32 | rejected | accepted; no depth option established | accepted; no depth option established | rejected with configured `max_depth` |

For cborg, decoding then encoding with `rfc8949EncodeOptions` produced byte equality for the core-ordered and shortest-float samples, and inequality for the legacy-order and nonshortest-float samples. This is evidence that a composition may close cborg's documented decode gap for the tested type subset; it is not proof for all CBOR types or a selected design. `EMPIRICAL_SYNTHETIC_PROBE`, `INFERENCE`

## Existing-work disposition

### Reuse / adapt / compose / invent / experiment

- **Reuse:** RFC 8949 requirements, IANA registries as reference data, and the current cbor-wg vectors. Reuse the existing S002 semantic envelope and its generic failure boundary unchanged.
- **Adapt:** Candidate library options must be wrapped so callers cannot bypass deterministic encoding, duplicate rejection, tag/type restrictions, or resource limits.
- **Compose:** A serializer boundary will need parser well-formedness, exact deterministic-form validation, exact application-schema validation, resource limits, and S002 failure mapping. A cborg-based experiment would additionally need deterministic re-encode byte equality and an independent nesting/size preflight; a cbor2-based experiment would need explicit float strictness and explicit tag/schema rejection.
- **Invent:** No new CBOR algorithm, wire format, or cryptography is warranted. The application-specific field schema and safe error adapter will eventually be project code, but their design is not authorized here.
- **Experiment:** If separately authorized, compare only `cbor2` and `cborg` in a disposable spike against the full current cbor-wg corpus plus project-specific adversarial cases. Keep `cbor-x` as a performance comparator and node-cbor as compatibility history.

### Candidates and incompatibilities

- `cbor2` and `cborg` are the two serious candidates for a later bounded spike. This is a candidate set, not a winner selection.
- cbor2's built-in CDE ordering/depth checks are useful, but CDE defaults do not reject nonshortest floats and ignored global tags still decode to generic tag objects.
- cborg's zero-dependency and reject-unknown-tag defaults are useful, but its strict decoder deliberately does not validate float width or map ordering and exposes no established nesting bound.
- cbor-x did not produce insertion-order-independent bytes and accepted duplicates/nonminimal forms in the tested configuration.
- node-cbor is an explicitly superseded maintenance path whose defaults accept forms that a strict durable envelope likely must reject.
- Tagged versus untagged byte strings and RFC-core versus legacy/CTAP2 key ordering are wire-incompatible. They cannot be left to library defaults.

### Unresolved choices and risks

All of the following remain `UNSELECTED`: library; package version; RFC 8949 deterministic profile; allowed CBOR data types; float policy; tag policy; map/field layout; schema/version marker; byte, collection, and depth limits; parser-to-S002 error mapping; persistence backend; filesystem location; and migration format.

Worst plausible failures include accepting two durable byte representations for one envelope, hiding a duplicate security-relevant field, interpreting an extension/tag differently after an upgrade, losing binary fidelity, consuming excessive memory/stack on hostile input, or leaking parser detail that weakens the existing S002 generic failure boundary.

Required later regressions include:

- fixed golden bytes and reversed-insertion equivalence for every allowed envelope shape;
- rejection of legacy length-first order when core order is selected, or the inverse if another profile is explicitly selected;
- rejection of duplicates, indefinite items, nonminimal arguments, nonshortest floats when applicable, trailing data, tags/extensions outside the allowlist, malformed/truncated input, unexpected types, extra/missing keys, oversized inputs/collections, and excessive nesting;
- exact `Buffer`/`Uint8Array` byte fidelity through encode/decode;
- no prototype pollution or lossy key rewriting;
- no S002 decrypt call on parser/profile/schema failure and one generic external failure result;
- current cbor-wg vector coverage plus browser-bundle/CSP and Node 24 checks;
- dependency/license/advisory recheck at the exact candidate version.

### Next decision sequence

1. Extra High reviews this scan and either accepts it or returns a bounded correction. No implementation follows from acceptance.
2. A separate engineering directive may authorize a disposable two-candidate spike that selects no persistence design.
3. Exact deterministic profile, allowed type/tag set, resource limits, envelope field layout, and failure contract must be fixed from evidence before durable compatibility is created.
4. Only a separate S004 authorization may add a dependency, serializer code, or durable persistence behavior.

`selected library: UNSELECTED`

`selected deterministic profile: UNSELECTED`

`selected field layout: UNSELECTED`

`selected persistence design: UNSELECTED`

`S004 AUTHORIZED: false`
