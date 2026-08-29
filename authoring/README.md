# InnerSignal authoring workbench

This directory is a development-only Obsidian workbench over the existing graph and guide authority. It is not a runtime input.

## Authority boundary

- `guide-graphs/candidates/*.graph.json` remains candidate graph authority.
- Existing guide/source files and owner amendments remain prose and provenance authority.
- `obsidian/current/` is generated and read-only.
- `obsidian/proposals/` contains hash-bound, non-executable proposals.
- `overlays/` contains documentation-only map concepts. An overlay never enters compilation or planning.
- `obsidian/current/maps/*.canvas`, `.base` files, links, backlinks, geometry, and Mermaid are generated or view-only artifacts.

## Commands

```bash
npm run authoring:project
npm run authoring:validate
npm run authoring:check
npm run authoring:maps:check
npm run authoring:proposal:new -- --id <id> --node <node-id> --regression <case-id>
npm run authoring:proposal:build -- --id <id>
npm run authoring:proposal:check -- --id <id>
```

Approved reconciliation additionally requires the exact approved packet path and SHA-256. It is task-branch-only, runs compilation/regression/projection/map gates, and never installs or writes to `stable`:

```bash
npm run authoring:proposal:reconcile -- --id <id> --packet-id <exact-packet-id> --packet authoring/.build/<id>/packet/approved.zip --sha256 <sha256>
```

Proposal and decision details are documented in `docs/AUTHORING-ARCHITECTURE.md`. Every substantive decision shows exact before/after values plus explicit pros and cons of approving the new value. Approval remains in the existing Guide Packet owner-decision lifecycle; Obsidian and proposal status cannot approve anything. No authoring command calls a model.

Canonical guide HTML/text is never round-tripped through Markdown. Source notes contain bounded read-only excerpts for navigation.
