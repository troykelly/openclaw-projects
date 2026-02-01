import React, { useEffect, useMemo, useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';

type WorkItemSummary = {
  id: string;
  title: string;
  status: string | null;
  priority: string | null;
  task_type: string | null;
  created_at: string;
  updated_at: string;
};

type TimelineItem = {
  id: string;
  title: string;
  kind: string;
  status: string | null;
  priority: string | null;
  parent_id: string | null;
  level: number;
  not_before: string | null;
  not_after: string | null;
  estimate_minutes: number | null;
  actual_minutes: number | null;
  created_at: string;
};

type TimelineDependency = {
  id: string;
  from_id: string;
  to_id: string;
  kind: string;
};

type TimelineResponse = {
  items: TimelineItem[];
  dependencies: TimelineDependency[];
};

type GraphNode = {
  id: string;
  title: string;
  kind: string;
  status: string | null;
  priority: string | null;
  level: number;
  estimate_minutes: number | null;
  is_blocker: boolean;
};

type GraphEdge = {
  id: string;
  source: string;
  target: string;
  kind: string;
};

type CriticalPathItem = {
  id: string;
  title: string;
  estimate_minutes: number | null;
};

type DependencyGraphResponse = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  critical_path: CriticalPathItem[];
};

type BacklogItem = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  task_type: string | null;
  kind: string;
  estimate_minutes: number | null;
  created_at: string;
};

type BacklogResponse = {
  items: BacklogItem[];
};

type WorkItemsResponse = {
  items: WorkItemSummary[];
};

function usePathname(): string {
  const [path, setPath] = useState(() => window.location.pathname);

  useEffect(() => {
    const onPopState = (): void => setPath(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  return path;
}

function WorkItemsListPage(): React.JSX.Element {
  const bootstrap = readBootstrap();

  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'loaded'; items: WorkItemSummary[] }
  >(() => {
    const items = bootstrap?.workItems;
    if (items && items.length > 0) return { kind: 'loaded', items };
    return { kind: 'loading' };
  });

  useEffect(() => {
    if (state.kind === 'loaded') return;

    let alive = true;

    async function run(): Promise<void> {
      try {
        const res = await fetch('/api/work-items', {
          headers: { accept: 'application/json' },
        });
        if (!res.ok) throw new Error(`GET /api/work-items failed: ${res.status}`);

        const data = (await res.json()) as WorkItemsResponse;
        if (!alive) return;
        setState({ kind: 'loaded', items: data.items });
      } catch (err) {
        if (!alive) return;
        const message = err instanceof Error ? err.message : 'Unknown error';
        setState({ kind: 'error', message });
      }
    }

    run();
    return () => {
      alive = false;
    };
  }, [state.kind]);

  return (
    <main style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Work items</h1>
        <a href="/app/kanban" style={{ padding: '8px 12px', background: '#3b82f6', color: 'white', borderRadius: 6, textDecoration: 'none', fontSize: 13 }}>
          View Kanban Board
        </a>
      </div>

      {state.kind === 'loading' ? <p>Loading…</p> : null}
      {state.kind === 'error' ? <p style={{ color: 'crimson' }}>Error: {state.message}</p> : null}

      {state.kind === 'loaded' ? (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '6px 4px' }}>Title</th>
              <th style={{ textAlign: 'left', padding: '6px 4px' }}>Status</th>
              <th style={{ textAlign: 'left', padding: '6px 4px' }}>Priority</th>
              <th style={{ textAlign: 'left', padding: '6px 4px' }}></th>
            </tr>
          </thead>
          <tbody>
            {state.items.map((i) => (
              <tr key={i.id}>
                <td style={{ padding: '6px 4px' }}>
                  <a href={`/app/work-items/${encodeURIComponent(i.id)}`}>{i.title}</a>
                </td>
                <td style={{ padding: '6px 4px' }}>{i.status ?? '—'}</td>
                <td style={{ padding: '6px 4px' }}>{i.priority ?? '—'}</td>
                <td style={{ padding: '6px 4px' }}>
                  <a href={`/app/work-items/${encodeURIComponent(i.id)}/timeline`} style={{ fontSize: 11, color: '#6b7280', marginRight: 8 }}>timeline</a>
                  <a href={`/app/work-items/${encodeURIComponent(i.id)}/graph`} style={{ fontSize: 11, color: '#6b7280' }}>graph</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </main>
  );
}

type AppBootstrap = {
  route?: { kind?: string; id?: string };
  me?: { email?: string };
  workItems?: WorkItemSummary[];
  workItem?: { id?: string; title?: string } | null;
  participants?: Array<{ participant?: string; role?: string }>;
};

function readBootstrap(): AppBootstrap | null {
  const el = document.getElementById('app-bootstrap');
  if (!el) return null;
  const text = el.textContent;
  if (!text) return null;

  try {
    return JSON.parse(text) as AppBootstrap;
  } catch {
    return null;
  }
}

function WorkItemDetailPage(props: { id: string }): React.JSX.Element {
  const bootstrap = readBootstrap();
  const title = bootstrap?.workItem?.title;
  const participants = bootstrap?.participants ?? [];

  return (
    <main style={{ padding: 16 }}>
      <p>
        <a href="/app/work-items">← Back</a>
      </p>
      <h1>{title ? title : `Work item ${props.id}`}</h1>

      <h2>Participants</h2>
      {participants.length === 0 ? (
        <p>None</p>
      ) : (
        <ul>
          {participants.map((p, idx) => (
            <li key={idx}>
              {p.participant ?? 'unknown'} {p.role ? `(${p.role})` : ''}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function TimelinePage(props: { id: string }): React.JSX.Element {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'loaded'; data: TimelineResponse }
  >({ kind: 'loading' });

  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    let alive = true;

    async function run(): Promise<void> {
      try {
        const res = await fetch(`/api/work-items/${props.id}/timeline`, {
          headers: { accept: 'application/json' },
        });
        if (!res.ok) throw new Error(`Failed to load timeline: ${res.status}`);
        const data = (await res.json()) as TimelineResponse;
        if (!alive) return;
        setState({ kind: 'loaded', data });
      } catch (err) {
        if (!alive) return;
        const message = err instanceof Error ? err.message : 'Unknown error';
        setState({ kind: 'error', message });
      }
    }

    run();
    return () => {
      alive = false;
    };
  }, [props.id]);

  if (state.kind === 'loading') {
    return (
      <main style={{ padding: 16 }}>
        <p><a href="/app/work-items">← Back to Work items</a></p>
        <h1>Timeline</h1>
        <p>Loading...</p>
      </main>
    );
  }

  if (state.kind === 'error') {
    return (
      <main style={{ padding: 16 }}>
        <p><a href="/app/work-items">← Back to Work items</a></p>
        <h1>Timeline</h1>
        <p style={{ color: 'crimson' }}>Error: {state.message}</p>
      </main>
    );
  }

  const { items, dependencies } = state.data;

  // Compute date range
  const dates = items
    .flatMap((i) => [i.not_before, i.not_after])
    .filter((d): d is string => d !== null)
    .map((d) => new Date(d).getTime());

  const now = Date.now();
  let minDate = dates.length > 0 ? Math.min(...dates) : now;
  let maxDate = dates.length > 0 ? Math.max(...dates) : now + 30 * 24 * 60 * 60 * 1000;

  // Add padding
  const range = maxDate - minDate || 1;
  minDate -= range * 0.05;
  maxDate += range * 0.05;

  const chartWidth = 800;
  const rowHeight = 32;
  const labelWidth = 200;
  const chartHeight = items.length * rowHeight + 40;

  function dateToX(date: number): number {
    return labelWidth + ((date - minDate) / (maxDate - minDate)) * (chartWidth - labelWidth - 20);
  }

  const kindColors: Record<string, string> = {
    project: '#3b82f6',
    initiative: '#8b5cf6',
    epic: '#10b981',
    issue: '#6b7280',
  };

  // Build position map for dependencies
  const itemPositions: Record<string, { y: number }> = {};
  items.forEach((item, idx) => {
    itemPositions[item.id] = { y: idx * rowHeight + 20 };
  });

  return (
    <main style={{ padding: 16 }}>
      <p><a href="/app/work-items">← Back to Work items</a></p>
      <h1>Timeline / Gantt</h1>

      <div style={{ overflowX: 'auto', marginTop: 16 }}>
        <svg ref={svgRef} width={chartWidth} height={chartHeight} style={{ fontFamily: 'system-ui, sans-serif', fontSize: 12 }}>
          {/* Background grid */}
          <rect x={labelWidth} y={0} width={chartWidth - labelWidth} height={chartHeight} fill="#f9fafb" />

          {/* Date axis markers */}
          {[0.25, 0.5, 0.75, 1].map((pct) => {
            const x = labelWidth + pct * (chartWidth - labelWidth - 20);
            const dateVal = minDate + pct * (maxDate - minDate);
            const label = new Date(dateVal).toLocaleDateString();
            return (
              <g key={pct}>
                <line x1={x} y1={0} x2={x} y2={chartHeight} stroke="#e5e7eb" strokeDasharray="4,4" />
                <text x={x} y={chartHeight - 5} textAnchor="middle" fill="#9ca3af" fontSize={10}>
                  {label}
                </text>
              </g>
            );
          })}

          {/* Items */}
          {items.map((item, idx) => {
            const y = idx * rowHeight + 20;
            const indent = item.level * 12;

            // Bar positioning
            const hasStart = item.not_before !== null;
            const hasEnd = item.not_after !== null;
            let barX = labelWidth + 10;
            let barWidth = 50;

            if (hasStart && hasEnd) {
              barX = dateToX(new Date(item.not_before!).getTime());
              barWidth = Math.max(8, dateToX(new Date(item.not_after!).getTime()) - barX);
            } else if (hasStart) {
              barX = dateToX(new Date(item.not_before!).getTime());
              barWidth = 50;
            } else if (hasEnd) {
              barX = dateToX(new Date(item.not_after!).getTime()) - 50;
              barWidth = 50;
            }

            const color = kindColors[item.kind] || '#6b7280';

            return (
              <g key={item.id}>
                {/* Label */}
                <text x={4 + indent} y={y + rowHeight / 2 + 4} fill="#1f2937" fontSize={11}>
                  {item.title.length > 20 ? item.title.slice(0, 18) + '…' : item.title}
                </text>

                {/* Bar */}
                <rect
                  x={barX}
                  y={y + 4}
                  width={barWidth}
                  height={rowHeight - 12}
                  rx={3}
                  fill={color}
                  opacity={item.status === 'done' || item.status === 'closed' ? 0.4 : 0.8}
                />

                {/* Kind badge */}
                <text x={barX + 4} y={y + rowHeight / 2 + 3} fill="white" fontSize={9}>
                  {item.kind.charAt(0).toUpperCase()}
                </text>
              </g>
            );
          })}

          {/* Dependencies (arrows) */}
          {dependencies.map((dep) => {
            const fromPos = itemPositions[dep.from_id];
            const toPos = itemPositions[dep.to_id];
            if (!fromPos || !toPos) return null;

            const fromItem = items.find((i) => i.id === dep.from_id);
            const toItem = items.find((i) => i.id === dep.to_id);
            if (!fromItem || !toItem) return null;

            // Calculate positions
            const fromY = fromPos.y + rowHeight / 2;
            const toY = toPos.y + rowHeight / 2;

            let fromX = labelWidth + 30;
            let toX = labelWidth + 30;

            if (toItem.not_after) {
              toX = dateToX(new Date(toItem.not_after).getTime());
            }
            if (fromItem.not_before) {
              fromX = dateToX(new Date(fromItem.not_before).getTime());
            }

            return (
              <g key={dep.id}>
                <line
                  x1={toX + 4}
                  y1={toY}
                  x2={fromX - 4}
                  y2={fromY}
                  stroke="#ef4444"
                  strokeWidth={1.5}
                  markerEnd="url(#arrowhead)"
                />
              </g>
            );
          })}

          {/* Arrow marker definition */}
          <defs>
            <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 Z" fill="#ef4444" />
            </marker>
          </defs>
        </svg>
      </div>

      <div style={{ marginTop: 16, fontSize: 12, color: '#6b7280' }}>
        <strong>Legend:</strong>{' '}
        <span style={{ display: 'inline-block', width: 12, height: 12, background: '#3b82f6', borderRadius: 2, marginRight: 4 }}></span> Project{' '}
        <span style={{ display: 'inline-block', width: 12, height: 12, background: '#8b5cf6', borderRadius: 2, marginLeft: 12, marginRight: 4 }}></span> Initiative{' '}
        <span style={{ display: 'inline-block', width: 12, height: 12, background: '#10b981', borderRadius: 2, marginLeft: 12, marginRight: 4 }}></span> Epic{' '}
        <span style={{ display: 'inline-block', width: 12, height: 12, background: '#6b7280', borderRadius: 2, marginLeft: 12, marginRight: 4 }}></span> Issue
      </div>
    </main>
  );
}

function DependencyGraphPage(props: { id: string }): React.JSX.Element {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'loaded'; data: DependencyGraphResponse }
  >({ kind: 'loading' });

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  useEffect(() => {
    let alive = true;

    async function run(): Promise<void> {
      try {
        const res = await fetch(`/api/work-items/${props.id}/dependency-graph`, {
          headers: { accept: 'application/json' },
        });
        if (!res.ok) throw new Error(`Failed to load graph: ${res.status}`);
        const data = (await res.json()) as DependencyGraphResponse;
        if (!alive) return;
        setState({ kind: 'loaded', data });
      } catch (err) {
        if (!alive) return;
        const message = err instanceof Error ? err.message : 'Unknown error';
        setState({ kind: 'error', message });
      }
    }

    run();
    return () => {
      alive = false;
    };
  }, [props.id]);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((z) => Math.max(0.2, Math.min(3, z * delta)));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  if (state.kind === 'loading') {
    return (
      <main style={{ padding: 16 }}>
        <p><a href="/app/work-items">← Back to Work items</a></p>
        <h1>Dependency Graph</h1>
        <p>Loading...</p>
      </main>
    );
  }

  if (state.kind === 'error') {
    return (
      <main style={{ padding: 16 }}>
        <p><a href="/app/work-items">← Back to Work items</a></p>
        <h1>Dependency Graph</h1>
        <p style={{ color: 'crimson' }}>Error: {state.message}</p>
      </main>
    );
  }

  const { nodes, edges, critical_path } = state.data;

  // Compute node positions using hierarchical layout
  const nodeWidth = 160;
  const nodeHeight = 50;
  const levelGap = 100;
  const nodeGap = 20;

  // Group nodes by level
  const nodesByLevel = new Map<number, GraphNode[]>();
  for (const node of nodes) {
    if (!nodesByLevel.has(node.level)) {
      nodesByLevel.set(node.level, []);
    }
    nodesByLevel.get(node.level)!.push(node);
  }

  // Compute positions
  const positions = new Map<string, { x: number; y: number }>();
  let maxY = 0;

  for (const [level, levelNodes] of nodesByLevel) {
    const x = 50 + level * (nodeWidth + levelGap);
    for (let i = 0; i < levelNodes.length; i++) {
      const y = 50 + i * (nodeHeight + nodeGap);
      positions.set(levelNodes[i].id, { x, y });
      maxY = Math.max(maxY, y + nodeHeight);
    }
  }

  const criticalPathIds = new Set(critical_path.map((n) => n.id));

  const kindColors: Record<string, string> = {
    project: '#3b82f6',
    initiative: '#8b5cf6',
    epic: '#10b981',
    issue: '#6b7280',
  };

  const chartWidth = Math.max(800, (nodesByLevel.size + 1) * (nodeWidth + levelGap));
  const chartHeight = Math.max(400, maxY + 50);

  return (
    <main style={{ padding: 16 }}>
      <p><a href="/app/work-items">← Back to Work items</a></p>
      <h1>Dependency Graph</h1>

      <div style={{ marginBottom: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
        <button onClick={() => setZoom((z) => Math.min(3, z * 1.2))} style={{ padding: '4px 8px' }}>Zoom In</button>
        <button onClick={() => setZoom((z) => Math.max(0.2, z * 0.8))} style={{ padding: '4px 8px' }}>Zoom Out</button>
        <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} style={{ padding: '4px 8px' }}>Reset</button>
        <span style={{ fontSize: 12, color: '#6b7280' }}>Zoom: {Math.round(zoom * 100)}% | Drag to pan</span>
      </div>

      <div
        style={{
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          overflow: 'hidden',
          cursor: isDragging ? 'grabbing' : 'grab',
          userSelect: 'none',
        }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <svg
          width={800}
          height={500}
          viewBox={`${-pan.x / zoom} ${-pan.y / zoom} ${800 / zoom} ${500 / zoom}`}
          style={{ fontFamily: 'system-ui, sans-serif', fontSize: 11, background: '#f9fafb' }}
        >
          {/* Edges */}
          {edges.map((edge) => {
            const sourcePos = positions.get(edge.source);
            const targetPos = positions.get(edge.target);
            if (!sourcePos || !targetPos) return null;

            const x1 = targetPos.x + nodeWidth;
            const y1 = targetPos.y + nodeHeight / 2;
            const x2 = sourcePos.x;
            const y2 = sourcePos.y + nodeHeight / 2;

            const isCritical = criticalPathIds.has(edge.source) && criticalPathIds.has(edge.target);

            return (
              <g key={edge.id}>
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={isCritical ? '#ef4444' : '#9ca3af'}
                  strokeWidth={isCritical ? 2.5 : 1.5}
                  markerEnd={isCritical ? 'url(#arrowhead-critical)' : 'url(#arrowhead)'}
                />
              </g>
            );
          })}

          {/* Nodes */}
          {nodes.map((node) => {
            const pos = positions.get(node.id);
            if (!pos) return null;

            const isCritical = criticalPathIds.has(node.id);
            const baseColor = kindColors[node.kind] || '#6b7280';
            const fillColor = node.status === 'done' || node.status === 'closed' ? '#e5e7eb' : baseColor;

            return (
              <g key={node.id}>
                <rect
                  x={pos.x}
                  y={pos.y}
                  width={nodeWidth}
                  height={nodeHeight}
                  rx={6}
                  fill={fillColor}
                  stroke={isCritical ? '#ef4444' : node.is_blocker ? '#f59e0b' : '#e5e7eb'}
                  strokeWidth={isCritical ? 3 : node.is_blocker ? 2 : 1}
                  opacity={node.status === 'done' || node.status === 'closed' ? 0.5 : 1}
                />
                <text
                  x={pos.x + 8}
                  y={pos.y + 18}
                  fill="white"
                  fontWeight="bold"
                  fontSize={10}
                >
                  {node.title.length > 18 ? node.title.slice(0, 16) + '…' : node.title}
                </text>
                <text
                  x={pos.x + 8}
                  y={pos.y + 32}
                  fill="white"
                  fontSize={9}
                  opacity={0.8}
                >
                  {node.kind} | {node.status || 'open'}
                </text>
                {node.is_blocker && (
                  <text x={pos.x + nodeWidth - 8} y={pos.y + 14} fill="#fcd34d" fontSize={10} textAnchor="end">
                    ⚠
                  </text>
                )}
                {node.estimate_minutes && (
                  <text x={pos.x + nodeWidth - 8} y={pos.y + nodeHeight - 8} fill="white" fontSize={9} textAnchor="end" opacity={0.7}>
                    {node.estimate_minutes >= 60 ? `${Math.floor(node.estimate_minutes / 60)}h` : `${node.estimate_minutes}m`}
                  </text>
                )}
              </g>
            );
          })}

          {/* Arrow markers */}
          <defs>
            <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 Z" fill="#9ca3af" />
            </marker>
            <marker id="arrowhead-critical" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 Z" fill="#ef4444" />
            </marker>
          </defs>
        </svg>
      </div>

      {critical_path.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 14, marginBottom: 8 }}>Critical Path</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {critical_path.map((item, idx) => (
              <React.Fragment key={item.id}>
                <span
                  style={{
                    background: '#fef2f2',
                    border: '1px solid #ef4444',
                    borderRadius: 4,
                    padding: '4px 8px',
                    fontSize: 12,
                  }}
                >
                  {item.title}
                  {item.estimate_minutes && (
                    <span style={{ marginLeft: 6, color: '#6b7280' }}>
                      ({item.estimate_minutes >= 60 ? `${Math.floor(item.estimate_minutes / 60)}h` : `${item.estimate_minutes}m`})
                    </span>
                  )}
                </span>
                {idx < critical_path.length - 1 && <span style={{ color: '#9ca3af' }}>→</span>}
              </React.Fragment>
            ))}
          </div>
          <p style={{ fontSize: 12, color: '#6b7280', marginTop: 8 }}>
            Total: {critical_path.reduce((sum, n) => sum + (n.estimate_minutes || 0), 0)} minutes
            ({Math.round(critical_path.reduce((sum, n) => sum + (n.estimate_minutes || 0), 0) / 60 * 10) / 10} hours)
          </p>
        </div>
      )}

      <div style={{ marginTop: 16, fontSize: 12, color: '#6b7280' }}>
        <strong>Legend:</strong>{' '}
        <span style={{ display: 'inline-block', width: 12, height: 12, background: '#3b82f6', borderRadius: 2, marginRight: 4 }}></span> Project{' '}
        <span style={{ display: 'inline-block', width: 12, height: 12, background: '#8b5cf6', borderRadius: 2, marginLeft: 12, marginRight: 4 }}></span> Initiative{' '}
        <span style={{ display: 'inline-block', width: 12, height: 12, background: '#10b981', borderRadius: 2, marginLeft: 12, marginRight: 4 }}></span> Epic{' '}
        <span style={{ display: 'inline-block', width: 12, height: 12, background: '#6b7280', borderRadius: 2, marginLeft: 12, marginRight: 4 }}></span> Issue{' '}
        <span style={{ marginLeft: 12 }}>⚠ = Blocker</span>{' '}
        <span style={{ marginLeft: 12, color: '#ef4444' }}>━ = Critical Path</span>
      </div>
    </main>
  );
}

function useQueryParams(): URLSearchParams {
  const [params, setParams] = useState(() => new URLSearchParams(window.location.search));

  useEffect(() => {
    const onPopState = (): void => setParams(new URLSearchParams(window.location.search));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  return params;
}

function KanbanPage(): React.JSX.Element {
  const queryParams = useQueryParams();

  const [items, setItems] = useState<BacklogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter state from URL
  const [filters, setFilters] = useState({
    priority: queryParams.getAll('priority'),
    kind: queryParams.getAll('kind'),
  });

  const [draggedItem, setDraggedItem] = useState<string | null>(null);

  const statuses = ['open', 'blocked', 'closed'];

  const fetchItems = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      filters.priority.forEach((p) => params.append('priority', p));
      filters.kind.forEach((k) => params.append('kind', k));

      const res = await fetch(`/api/backlog?${params.toString()}`, {
        headers: { accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`Failed to load backlog: ${res.status}`);
      const data = (await res.json()) as BacklogResponse;
      setItems(data.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, [filters.priority.join(','), filters.kind.join(',')]);

  const updateFilters = (newFilters: typeof filters) => {
    setFilters(newFilters);

    // Update URL
    const params = new URLSearchParams();
    newFilters.priority.forEach((p) => params.append('priority', p));
    newFilters.kind.forEach((k) => params.append('kind', k));

    const newUrl = params.toString() ? `${window.location.pathname}?${params.toString()}` : window.location.pathname;
    window.history.pushState({}, '', newUrl);
  };

  const toggleFilter = (type: 'priority' | 'kind', value: string) => {
    const current = filters[type];
    const updated = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    updateFilters({ ...filters, [type]: updated });
  };

  const handleDragStart = (e: React.DragEvent, itemId: string) => {
    setDraggedItem(itemId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = async (e: React.DragEvent, newStatus: string) => {
    e.preventDefault();
    if (!draggedItem) return;

    const item = items.find((i) => i.id === draggedItem);
    if (!item || item.status === newStatus) {
      setDraggedItem(null);
      return;
    }

    // Optimistic update
    setItems((prev) =>
      prev.map((i) => (i.id === draggedItem ? { ...i, status: newStatus } : i))
    );

    try {
      const res = await fetch(`/api/work-items/${draggedItem}/status`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!res.ok) {
        throw new Error('Failed to update status');
      }
    } catch (err) {
      // Revert on error
      setItems((prev) =>
        prev.map((i) => (i.id === draggedItem ? { ...i, status: item.status } : i))
      );
      setError('Failed to update status');
    }

    setDraggedItem(null);
  };

  const priorityColors: Record<string, string> = {
    P0: '#ef4444',
    P1: '#f97316',
    P2: '#eab308',
    P3: '#22c55e',
    P4: '#6b7280',
  };

  const kindLabels: Record<string, string> = {
    project: 'P',
    initiative: 'I',
    epic: 'E',
    issue: 'T',
  };

  return (
    <main style={{ padding: 16 }}>
      <p><a href="/app/work-items">← Back to Work items</a></p>
      <h1>Kanban Board</h1>

      {/* Filters */}
      <div style={{ marginBottom: 16, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <span style={{ fontSize: 12, color: '#6b7280', marginRight: 8 }}>Priority:</span>
          {['P0', 'P1', 'P2', 'P3', 'P4'].map((p) => (
            <button
              key={p}
              onClick={() => toggleFilter('priority', p)}
              style={{
                marginRight: 4,
                padding: '4px 8px',
                fontSize: 11,
                border: '1px solid #e5e7eb',
                borderRadius: 4,
                background: filters.priority.includes(p) ? priorityColors[p] : 'white',
                color: filters.priority.includes(p) ? 'white' : '#374151',
                cursor: 'pointer',
              }}
            >
              {p}
            </button>
          ))}
        </div>
        <div>
          <span style={{ fontSize: 12, color: '#6b7280', marginRight: 8 }}>Kind:</span>
          {['project', 'initiative', 'epic', 'issue'].map((k) => (
            <button
              key={k}
              onClick={() => toggleFilter('kind', k)}
              style={{
                marginRight: 4,
                padding: '4px 8px',
                fontSize: 11,
                border: '1px solid #e5e7eb',
                borderRadius: 4,
                background: filters.kind.includes(k) ? '#3b82f6' : 'white',
                color: filters.kind.includes(k) ? 'white' : '#374151',
                cursor: 'pointer',
              }}
            >
              {k}
            </button>
          ))}
        </div>
        {(filters.priority.length > 0 || filters.kind.length > 0) && (
          <button
            onClick={() => updateFilters({ priority: [], kind: [] })}
            style={{
              padding: '4px 8px',
              fontSize: 11,
              border: '1px solid #e5e7eb',
              borderRadius: 4,
              background: 'white',
              color: '#6b7280',
              cursor: 'pointer',
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {loading && <p>Loading...</p>}
      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      {/* Kanban columns */}
      <div style={{ display: 'flex', gap: 16, minHeight: 400 }}>
        {statuses.map((status) => {
          const columnItems = items.filter((i) => i.status === status);
          return (
            <div
              key={status}
              style={{
                flex: 1,
                background: '#f3f4f6',
                borderRadius: 8,
                padding: 12,
                minWidth: 200,
              }}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, status)}
            >
              <h3 style={{ margin: '0 0 12px 0', fontSize: 14, textTransform: 'capitalize' }}>
                {status}
                <span style={{ marginLeft: 8, color: '#6b7280', fontWeight: 'normal' }}>
                  ({columnItems.length})
                </span>
              </h3>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {columnItems.map((item) => (
                  <div
                    key={item.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, item.id)}
                    style={{
                      background: 'white',
                      borderRadius: 6,
                      padding: 10,
                      boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                      cursor: 'grab',
                      borderLeft: `3px solid ${priorityColors[item.priority] || '#6b7280'}`,
                      opacity: draggedItem === item.id ? 0.5 : 1,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <a
                        href={`/app/work-items/${item.id}`}
                        style={{ fontWeight: 500, fontSize: 13, color: '#111827', textDecoration: 'none' }}
                      >
                        {item.title.length > 30 ? item.title.slice(0, 28) + '…' : item.title}
                      </a>
                      <span
                        style={{
                          fontSize: 10,
                          background: '#e5e7eb',
                          borderRadius: 3,
                          padding: '2px 4px',
                          color: '#374151',
                        }}
                      >
                        {kindLabels[item.kind] || item.kind}
                      </span>
                    </div>
                    <div style={{ marginTop: 6, fontSize: 11, color: '#6b7280', display: 'flex', gap: 8 }}>
                      <span style={{ color: priorityColors[item.priority] || '#6b7280' }}>{item.priority}</span>
                      {item.estimate_minutes && (
                        <span>
                          {item.estimate_minutes >= 60
                            ? `${Math.floor(item.estimate_minutes / 60)}h`
                            : `${item.estimate_minutes}m`}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {columnItems.length === 0 && (
                <p style={{ fontSize: 12, color: '#9ca3af', textAlign: 'center', margin: '20px 0' }}>
                  No items
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 16, fontSize: 12, color: '#6b7280' }}>
        <strong>Tip:</strong> Drag and drop cards between columns to change status. Click card title to view details.
      </div>
    </main>
  );
}

function NotFoundPage(props: { path: string }): React.JSX.Element {
  return (
    <main style={{ padding: 16 }}>
      <h1>Not found</h1>
      <p>{props.path}</p>
      <p>
        <a href="/app/work-items">Go to work items</a>
      </p>
    </main>
  );
}

function App(): React.JSX.Element {
  const path = usePathname();

  const route = useMemo(() => {
    const list = /^\/app\/work-items\/?$/;
    const detail = /^\/app\/work-items\/([^/]+)\/?$/;
    const timeline = /^\/app\/work-items\/([^/]+)\/timeline\/?$/;
    const graph = /^\/app\/work-items\/([^/]+)\/graph\/?$/;
    const kanban = /^\/app\/kanban\/?$/;

    if (list.test(path)) return { kind: 'list' as const };
    if (kanban.test(path)) return { kind: 'kanban' as const };

    const t = path.match(timeline);
    if (t) return { kind: 'timeline' as const, id: t[1] };

    const g = path.match(graph);
    if (g) return { kind: 'graph' as const, id: g[1] };

    const d = path.match(detail);
    if (d) return { kind: 'detail' as const, id: d[1] };

    return { kind: 'not-found' as const, path };
  }, [path]);

  if (route.kind === 'list') return <WorkItemsListPage />;
  if (route.kind === 'kanban') return <KanbanPage />;
  if (route.kind === 'timeline') return <TimelinePage id={route.id} />;
  if (route.kind === 'graph') return <DependencyGraphPage id={route.id} />;
  if (route.kind === 'detail') return <WorkItemDetailPage id={route.id} />;
  return <NotFoundPage path={route.path} />;
}

const el = document.getElementById('root');
if (!el) throw new Error('Missing #root element');

createRoot(el).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
