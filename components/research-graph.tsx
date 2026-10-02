"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import type { GraphData } from "@/server/types";
import "./research-graph.css";

type GraphNode = GraphData["nodes"][number];
type PositionedNode = GraphNode & { x: number; y: number; degree: number };
type View = { x: number; y: number; scale: number };
const WIDTH = 960;
const HEIGHT = 620;
const INITIAL_VIEW: View = { x: 0, y: 0, scale: 1 };

function hash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index++) {
    result = Math.imul(result ^ value.charCodeAt(index), 16777619);
  }
  return result >>> 0;
}

/** A stable, bounded layout: topic clusters, then local repulsion and edge springs. */
function positionNodes(data: GraphData): PositionedNode[] {
  const nodes = [...data.nodes]
    .slice(0, 100)
    .sort((a, b) => a.id.localeCompare(b.id));
  const groups = [
    ...new Set(nodes.map((node) => node.tags[0] || "untagged")),
  ].sort();
  const degree = new Map<string, number>();
  for (const edge of data.edges) {
    degree.set(edge.source, (degree.get(edge.source) || 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) || 0) + 1);
  }
  const positioned = nodes.map((node, index) => {
    const groupIndex = groups.indexOf(node.tags[0] || "untagged");
    const groupAngle =
      (groupIndex / Math.max(groups.length, 1)) * Math.PI * 2 - Math.PI / 2;
    const seedAngle = (hash(node.id) / 4294967295) * Math.PI * 2;
    const radius = 32 + (hash(`${node.id}:radius`) % 120);
    const spread = groups.length > 1 ? 170 : Math.min(200, nodes.length * 19);
    const angle =
      groups.length > 1
        ? groupAngle
        : (index / Math.max(nodes.length, 1)) * Math.PI * 2;
    return {
      ...node,
      degree: degree.get(node.id) || 0,
      x:
        WIDTH / 2 +
        Math.cos(angle) * spread +
        (groups.length > 1 ? Math.cos(seedAngle) * radius : 0),
      y:
        HEIGHT / 2 +
        Math.sin(angle) * spread * 0.8 +
        (groups.length > 1 ? Math.sin(seedAngle) * radius * 0.7 : 0),
    };
  });
  if (positioned.length === 1) {
    positioned[0].x = WIDTH / 2;
    positioned[0].y = HEIGHT / 2;
    return positioned;
  }
  const indexes = new Map(positioned.map((node, index) => [node.id, index]));
  for (let iteration = 0; iteration < 85; iteration++) {
    const forces = positioned.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < positioned.length; i++) {
      for (let j = i + 1; j < positioned.length; j++) {
        let dx = positioned[i].x - positioned[j].x;
        let dy = positioned[i].y - positioned[j].y;
        if (Math.abs(dx) + Math.abs(dy) < 0.01) {
          dx = 0.5;
          dy = 0.5;
        }
        const distance = Math.max(14, Math.hypot(dx, dy));
        const force = Math.min(9, 3100 / (distance * distance));
        forces[i].x += (dx / distance) * force;
        forces[i].y += (dy / distance) * force;
        forces[j].x -= (dx / distance) * force;
        forces[j].y -= (dy / distance) * force;
      }
    }
    for (const edge of data.edges) {
      const source = indexes.get(edge.source);
      const target = indexes.get(edge.target);
      if (source === undefined || target === undefined || source === target)
        continue;
      const dx = positioned[target].x - positioned[source].x;
      const dy = positioned[target].y - positioned[source].y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const strength = (distance - 145) * 0.009;
      forces[source].x += (dx / distance) * strength;
      forces[source].y += (dy / distance) * strength;
      forces[target].x -= (dx / distance) * strength;
      forces[target].y -= (dy / distance) * strength;
    }
    const cooling = 1 - iteration / 110;
    positioned.forEach((node, index) => {
      node.x = Math.max(
        90,
        Math.min(
          WIDTH - 90,
          node.x + (forces[index].x + (WIDTH / 2 - node.x) * 0.006) * cooling,
        ),
      );
      node.y = Math.max(
        75,
        Math.min(
          HEIGHT - 100,
          node.y + (forces[index].y + (HEIGHT / 2 - node.y) * 0.006) * cooling,
        ),
      );
    });
  }
  return positioned;
}

function shortTitle(title: string, length = 31) {
  return title.length <= length
    ? title
    : `${title.slice(0, length - 1).trimEnd()}…`;
}

function zoomView(
  current: View,
  factor: number,
  x = WIDTH / 2,
  y = HEIGHT / 2,
): View {
  const scale = Math.max(0.5, Math.min(3.5, current.scale * factor));
  const ratio = scale / current.scale;
  return {
    scale,
    x: x - (x - current.x) * ratio,
    y: y - (y - current.y) * ratio,
  };
}

export function ResearchGraph({
  data,
  onOpen,
}: {
  data: GraphData;
  onOpen: (id: string) => void;
}) {
  const headingId = useId();
  const descriptionId = useId();
  const patternId = useId().replace(/:/g, "");
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{
    pointer: number;
    x: number;
    y: number;
    origin: View;
  } | null>(null);
  const [view, setView] = useState<View>(INITIAL_VIEW);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const nodes = useMemo(() => positionNodes(data), [data]);
  const byId = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  );
  const edges = useMemo(
    () =>
      data.edges.filter(
        (edge) => byId.has(edge.source) && byId.has(edge.target),
      ),
    [data.edges, byId],
  );
  const selected = selectedId ? byId.get(selectedId) : undefined;
  const connections = useMemo(
    () =>
      selected
        ? edges
            .filter(
              (edge) =>
                edge.source === selected.id || edge.target === selected.id,
            )
            .map((edge) => ({
              edge,
              node: byId.get(
                edge.source === selected.id ? edge.target : edge.source,
              )!,
            }))
            .sort((a, b) => b.edge.weight - a.edge.weight)
        : [],
    [selected, edges, byId],
  );
  const neighborIds = new Set(connections.map(({ node }) => node.id));

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const matrix = svg.getScreenCTM();
      if (!matrix) return;
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
        matrix.inverse(),
      );
      setView((current) =>
        zoomView(current, Math.exp(-event.deltaY * 0.006), point.x, point.y),
      );
    };
    svg.addEventListener("wheel", handleWheel, { passive: false });
    return () => svg.removeEventListener("wheel", handleWheel);
  }, [nodes.length]);

  function startPan(event: PointerEvent<SVGSVGElement>) {
    if (
      !event.isPrimary ||
      event.button !== 0 ||
      (event.target as Element).closest("[data-paper-node]")
    )
      return;
    const matrix = event.currentTarget.getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      matrix.inverse(),
    );
    drag.current = {
      pointer: event.pointerId,
      x: point.x,
      y: point.y,
      origin: view,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsPanning(true);
  }

  function pan(event: PointerEvent<SVGSVGElement>) {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointer) return;
    const matrix = event.currentTarget.getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      matrix.inverse(),
    );
    setView({
      ...current.origin,
      x: current.origin.x + point.x - current.x,
      y: current.origin.y + point.y - current.y,
    });
  }

  function endPan(event: PointerEvent<SVGSVGElement>) {
    if (!drag.current || event.pointerId !== drag.current.pointer) return;
    drag.current = null;
    setIsPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function handleKeyboard(event: KeyboardEvent<SVGSVGElement>) {
    if (event.key === "Escape") setSelectedId(null);
    if (event.target !== event.currentTarget) return;
    const steps: Record<string, [number, number]> = {
      ArrowLeft: [35, 0],
      ArrowRight: [-35, 0],
      ArrowUp: [0, 35],
      ArrowDown: [0, -35],
    };
    if (event.key in steps) {
      event.preventDefault();
      const [x, y] = steps[event.key];
      setView((current) => ({
        ...current,
        x: current.x + x,
        y: current.y + y,
      }));
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      setView((current) => zoomView(current, 1.2));
    } else if (event.key === "-") {
      event.preventDefault();
      setView((current) => zoomView(current, 1 / 1.2));
    } else if (event.key === "0") {
      event.preventDefault();
      setView(INITIAL_VIEW);
    }
  }

  if (!nodes.length)
    return (
      <section className="graph-empty" aria-label="Research graph">
        <svg
          width="48"
          height="48"
          viewBox="0 0 48 48"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M16 9h12l8 8v22H16V9Z"
            stroke="currentColor"
            strokeWidth="1.4"
          />
          <path
            d="M28 9v9h8M11 14H8v25a4 4 0 0 0 4 4h19M22 25h8M22 31h6"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
        <h2>A wider view of your research</h2>
        <p>
          Upload papers to start your graph. Shared topics and semantic
          similarities will reveal how your research connects.
        </p>
      </section>
    );

  return (
    <section className="graph-workspace" aria-labelledby={headingId}>
      <div className="graph-heading">
        <div>
          <p className="graph-eyebrow">A connected perspective</p>
          <h2 id={headingId}>Your research, in context.</h2>
          <p id={descriptionId}>
            {nodes.length} {nodes.length === 1 ? "paper" : "papers"} ·{" "}
            {edges.length} {edges.length === 1 ? "connection" : "connections"}.
            Select a paper to explore its relationships.
          </p>
        </div>
        <div className="graph-legend" aria-label="Relationship types">
          <span>
            <i className="graph-legend-topic" />
            Shared topic
          </span>
          <span>
            <i className="graph-legend-similarity" />
            Semantic similarity
          </span>
        </div>
      </div>
      <div className="graph-mobile-picker">
        <select
          aria-label="Select a paper to inspect"
          value={selected?.id || ""}
          onChange={(event) => setSelectedId(event.target.value || null)}
        >
          <option value="">Select a paper to inspect</option>
          {nodes.map((node) => (
            <option key={node.id} value={node.id}>
              {node.title}
            </option>
          ))}
        </select>
      </div>
      <div className={`graph-body${selected ? " graph-has-selection" : ""}`}>
        <div className="graph-stage">
          <svg
            ref={svgRef}
            className={`graph-canvas${isPanning ? " graph-panning" : ""}`}
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            role="group"
            aria-label="Interactive paper relationships"
            aria-describedby={descriptionId}
            tabIndex={0}
            onPointerDown={startPan}
            onPointerMove={pan}
            onPointerUp={endPan}
            onPointerCancel={endPan}
            onLostPointerCapture={() => {
              drag.current = null;
              setIsPanning(false);
            }}
            onKeyDown={handleKeyboard}
          >
            <defs>
              <pattern
                id={patternId}
                width="26"
                height="26"
                patternUnits="userSpaceOnUse"
              >
                <circle cx="1" cy="1" r="0.8" fill="var(--line)" />
              </pattern>
            </defs>
            <rect
              width={WIDTH}
              height={HEIGHT}
              fill={`url(#${patternId})`}
              opacity="0.65"
            />
            <g
              transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}
            >
              <g aria-hidden="true">
                {edges.map((edge, index) => {
                  const source = byId.get(edge.source)!;
                  const target = byId.get(edge.target)!;
                  const active =
                    !selected ||
                    source.id === selected.id ||
                    target.id === selected.id;
                  const weight = Number.isFinite(edge.weight)
                    ? Math.max(0, Math.min(1, edge.weight))
                    : 0;
                  return (
                    <line
                      key={`${edge.source}-${edge.target}-${edge.kind}-${index}`}
                      className={`graph-edge graph-edge-${edge.kind}`}
                      x1={source.x}
                      y1={source.y}
                      x2={target.x}
                      y2={target.y}
                      strokeWidth={1 + weight * 1.25}
                      strokeDasharray={
                        edge.kind === "similarity" ? "4 5" : undefined
                      }
                      opacity={active ? 0.5 : 0.09}
                    />
                  );
                })}
              </g>
              {nodes.map((node) => {
                const isSelected = selected?.id === node.id;
                const isRelated = neighborIds.has(node.id);
                const radius = Math.min(23, 16 + Math.sqrt(node.degree) * 2);
                return (
                  <g
                    key={node.id}
                    data-paper-node="true"
                    className={`graph-node${isSelected ? " graph-node-selected" : ""}`}
                    transform={`translate(${node.x} ${node.y})`}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    aria-label={`${node.title}${node.year ? `, ${node.year}` : ""}. ${node.degree} connections. Show paper details.`}
                    onClick={() => setSelectedId(node.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedId(node.id);
                      }
                    }}
                    opacity={!selected || isSelected || isRelated ? 1 : 0.36}
                  >
                    <title>{node.title}</title>
                    <circle
                      className="graph-node-target"
                      r={Math.max(25, radius + 8)}
                    />
                    <circle className="graph-node-halo" r={radius + 7} />
                    <circle className="graph-node-disc" r={radius} />
                    <path
                      className="graph-node-document"
                      d="M-5-7h6l4 4V7H-5V-7ZM1-7v4h4M-2 1h4M-2 4h3"
                      fill="none"
                      strokeWidth="1.2"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      aria-hidden="true"
                    />
                    {(nodes.length <= 40 ||
                      view.scale > 1.35 ||
                      isSelected ||
                      isRelated) && (
                      <text
                        className="graph-node-label"
                        y={radius + 22}
                        textAnchor="middle"
                        aria-hidden="true"
                      >
                        {shortTitle(node.title)}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
          {!edges.length && (
            <p className="graph-no-edges">
              {nodes.length === 1
                ? "Add another paper to discover connections."
                : "No connections yet. Add shared tags or wait for paper processing."}
            </p>
          )}
          <div
            className="graph-controls"
            role="group"
            aria-label="Graph view controls"
          >
            <button
              type="button"
              onClick={() => setView((current) => zoomView(current, 1 / 1.2))}
              disabled={view.scale <= 0.5}
              aria-label="Zoom out"
              title="Zoom out"
            >
              −
            </button>
            <output aria-label="Zoom level">
              {Math.round(view.scale * 100)}%
            </output>
            <button
              type="button"
              onClick={() => setView((current) => zoomView(current, 1.2))}
              disabled={view.scale >= 3.5}
              aria-label="Zoom in"
              title="Zoom in"
            >
              +
            </button>
            <span className="graph-control-divider" />
            <button
              type="button"
              className="graph-reset"
              onClick={() => setView(INITIAL_VIEW)}
              aria-label="Reset graph view"
              title="Reset graph view"
            >
              Reset
            </button>
          </div>
          <span className="graph-pan-hint">
            Drag to pan · ⌘ / Ctrl + scroll to zoom
          </span>
        </div>
        {selected && (
          <aside
            className="graph-inspector"
            aria-label="Selected paper details"
            aria-live="polite"
          >
            <div className="graph-inspector-top">
              <span className="graph-eyebrow">Selected paper</span>
              <button
                type="button"
                className="graph-close"
                onClick={() => setSelectedId(null)}
                aria-label="Close paper details"
              >
                ×
              </button>
            </div>
            <h3>{selected.title}</h3>
            <p className="graph-paper-meta">
              {selected.year ? `${selected.year} · ` : ""}
              {connections.length}{" "}
              {connections.length === 1 ? "relationship" : "relationships"}
            </p>
            {selected.tags.length > 0 && (
              <div className="graph-tags">
                {selected.tags.map((tag, index) => (
                  <span key={`${tag}-${index}`}>{tag}</span>
                ))}
              </div>
            )}
            <button
              type="button"
              className="graph-open-paper"
              onClick={() => onOpen(selected.id)}
            >
              Open paper <span aria-hidden="true">↗</span>
            </button>
            <div className="graph-related-heading">Connected papers</div>
            {connections.length ? (
              <ul className="graph-related-list">
                {connections.map(({ node, edge }, index) => (
                  <li key={`${node.id}-${edge.kind}-${index}`}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(node.id)}
                    >
                      <span className="graph-related-title">{node.title}</span>
                      <span className="graph-related-reason">
                        <i
                          className={
                            edge.kind === "topic"
                              ? "graph-legend-topic"
                              : "graph-legend-similarity"
                          }
                        />
                        {edge.label ||
                          (edge.kind === "topic"
                            ? "Shared topic"
                            : "Semantic similarity")}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="graph-inspector-empty">
                No relationships found yet. Add a shared tag to connect this
                paper with others.
              </p>
            )}
          </aside>
        )}
      </div>
      <p className="graph-footnote">
        Connections show shared topics or similarity in content. They do not
        indicate that one paper cites another.
      </p>
    </section>
  );
}

export default ResearchGraph;
