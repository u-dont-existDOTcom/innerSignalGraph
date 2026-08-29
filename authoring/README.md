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
```

Proposal commands are documented in `docs/AUTHORING-ARCHITECTURE.md`. No authoring command installs a Guide Packet, calls a model, or writes to `stable`.

Canonical guide HTML/text is never round-tripped through Markdown. Source notes contain bounded read-only excerpts for navigation.
