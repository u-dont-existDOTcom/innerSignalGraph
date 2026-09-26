# Journal import design packet

Start with **DESIGN.md** in the download, or `docs/superpowers/specs/2026-09-19-high-retention-journal-import.md` in the repository. It contains the architecture decision, current-code constraints, user flow, data and time model, ingestion/coverage rules, proposed APIs, privacy/deletion lifecycle, implementation sequence, acceptance criteria and verified primary references.

- `contract.json`: compact machine-readable design contract. It is not a complete application JSON Schema or a running importer.
- `acceptance-cases.json`: 38 future application acceptance cases, including 22 entirely invented source examples. Shared assertion fields are in `assertion_defaults`; each example overrides those fields. None is a real journal or an observed application output.
- `validate_design.py`: standalone Python 3 design consistency checker, with no third-party dependencies or network calls.
- `VALIDATION.json`: actual local design-check result, explicitly not runtime or semantic-recall evidence.
- `PLAN.md`: scope, authority, isolation, research and completion checkpoint.

To repeat the packet checks:

```sh
python3 validate_design.py --output /tmp/journal-design-validation.json
```

In the repository, where the main design lives under the specification directory, use:

```sh
python3 tasks/journal-import-design-20260919/validate_design.py \
  --design docs/superpowers/specs/2026-09-19-high-retention-journal-import.md \
  --output /tmp/journal-design-validation.json
```

The design is based on InnerSignal development commit `038f7ee61e0ddbb760e8263dbc6de3c06a56bfcf`, not a claim about the installed service. The isolated design branch is `chat/journal-import-design-20260919-2055`.

**Not performed:** importer implementation, real journal access/import, provider inference, deployment, protected merge, stable promotion, clinical assessment, production security certification or real-corpus recall measurement. No real source/person identifiers or private-derived hashes are included. The hashes in this packet identify only public design files and invented examples.

The generic design is complete. A representative export and appropriate subject authorization are inputs to the later source-specific pilot and import, not prerequisites for using this design packet.
