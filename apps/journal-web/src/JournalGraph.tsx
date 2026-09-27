import { useMemo } from "react";
import type { JournalEdge, JournalNode } from "./contracts";
import { nodeLabel } from "./model";

interface JournalGraphProps {
  nodes: JournalNode[];
  edges: JournalEdge[];
  selectedId: string | null;
  onSelect(node: JournalNode): void;
}

interface Point { x: number; y: number }

function pointFor(index: number, count: number): Point {
  if (count === 1) return { x: 360, y: 190 };
  const ring = index % 2 === 0 ? 135 : 96;
  const angle = -Math.PI / 2 + (Math.PI * 2 * index) / Math.max(count, 1);
  return { x: 360 + Math.cos(angle) * ring, y: 190 + Math.sin(angle) * ring };
}

function shortLabel(node: JournalNode): string {
  const label = nodeLabel(node);
  return label.length > 34 ? `${label.slice(0, 31)}…` : label;
}

export function JournalGraph({ nodes, edges, selectedId, onSelect }: JournalGraphProps) {
  const points = useMemo(() => new Map(nodes.map((node, index) => [node.id, pointFor(index, nodes.length)])), [nodes]);

  if (!nodes.length) return <p className="empty-state">No authorized graph results match these filters.</p>;

  return (
    <div className="graph-frame" data-testid="journal-graph">
      <svg viewBox="0 0 720 380" role="group" aria-label={`${nodes.length} authorized journal nodes and ${edges.length} links`}>
        <g aria-hidden="true" className="graph-edges">
          {edges.map((edge) => {
            const from = points.get(edge.from);
            const to = points.get(edge.to);
            return from && to ? <line key={edge.id} x1={from.x} y1={from.y} x2={to.x} y2={to.y} /> : null;
          })}
        </g>
        <g className="graph-nodes">
          {nodes.map((node) => {
            const point = points.get(node.id)!;
            const selected = selectedId === node.id;
            const activate = () => onSelect(node);
            return (
              <g
                key={node.id}
                className={selected ? "graph-node selected" : "graph-node"}
                role="button"
                tabIndex={0}
                aria-pressed={selected}
                aria-label={`Open exact source for ${nodeLabel(node)}`}
                transform={`translate(${point.x} ${point.y})`}
                onClick={activate}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    activate();
                  }
                }}
              >
                <rect x="-76" y="-27" width="152" height="54" rx="10" />
                <text textAnchor="middle" y="-4" className="node-label">{shortLabel(node)}</text>
                <text textAnchor="middle" y="14" className="node-kind">{node.kind}</text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
