# InnerSignal Obsidian workbench

> [!warning] Development projection, not runtime authority
> Current notes, Mermaid, Canvas, Bases, links, backlinks, layout, and visual grouping do not change graph behavior. Edit only records inside `proposals/`.

## Open these views

- [[bases/Nodes.base|Nodes]]
- [[bases/Edges.base|Edges]]
- [[bases/Sources.base|Sources]]
- [[bases/Regressions.base|Regressions]]
- [[bases/Proposals.base|Proposals]]
- [[bases/Overlays.base|Overlays]]
- [[current/maps/development-graph.canvas|Development graph Canvas]]

## Safe workflow

1. Run `npm run authoring:check` before authoring.
2. Create a proposal with `npm run authoring:proposal:new -- ...`.
3. Edit only the new proposal directory.
4. Build and check it. Build output remains under ignored `.build/` and includes exact before/after decisions, approval pros/cons, affected tests, provenance, a candidate map/Canvas, and a verified candidate Guide Packet.
5. Review and record decisions through the existing Guide Packet owner-decision process. Proposal status alone is never approval.
6. Reconcile only the exact approved packet and SHA-256 on a task branch. Reconciliation never installs or changes `stable`.

Never put transcripts, personal case material, prompts, model output, credentials, environment data, or local-machine information in this public workbench.
