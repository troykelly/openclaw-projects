import '../app.css';
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';

// Layout
import { AppShell } from '@/ui/components/layout/app-shell';
import type { BreadcrumbItem } from '@/ui/components/layout/breadcrumb';

// Feedback components
import {
  Skeleton,
  SkeletonCard,
  SkeletonList,
  ErrorState,
  EmptyState,
} from '@/ui/components/feedback';

// UI components
import { Button } from '@/ui/components/ui/button';
import { Badge } from '@/ui/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/ui/components/ui/card';
import { ScrollArea, ScrollBar } from '@/ui/components/ui/scroll-area';

// Icons
import {
  LayoutGrid,
  List,
  Calendar,
  Network,
  ChevronRight,
  Clock,
  AlertCircle,
  CheckCircle2,
  Circle,
  BarChart3,
} from 'lucide-react';

// Types
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

type AppBootstrap = {
  route?: { kind?: string; id?: string };
  me?: { email?: string };
  workItems?: WorkItemSummary[];
  workItem?: { id?: string; title?: string } | null;
  participants?: Array<{ participant?: string; role?: string }>;
};

// Hooks
function usePathname(): string {
  const [path, setPath] = useState(() => window.location.pathname);

  useEffect(() => {
    const onPopState = (): void => setPath(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  return path;
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

// Utility components
const priorityColors: Record<string, string> = {
  P0: 'bg-red-500 text-white',
  P1: 'bg-orange-500 text-white',
  P2: 'bg-yellow-500 text-white',
  P3: 'bg-green-500 text-white',
  P4: 'bg-gray-500 text-white',
};

const statusIcons: Record<string, React.ReactNode> = {
  open: <Circle className="size-4 text-blue-500" />,
  in_progress: <Clock className="size-4 text-yellow-500" />,
  blocked: <AlertCircle className="size-4 text-red-500" />,
  closed: <CheckCircle2 className="size-4 text-green-500" />,
  done: <CheckCircle2 className="size-4 text-green-500" />,
};

const kindColors: Record<string, string> = {
  project: 'bg-blue-500',
  initiative: 'bg-violet-500',
  epic: 'bg-emerald-500',
  issue: 'bg-gray-500',
};

// Work Items List Page
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

  if (state.kind === 'loading') {
    return (
      <div className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <Skeleton width={200} height={32} />
          <Skeleton width={150} height={36} />
        </div>
        <SkeletonList count={5} variant="row" />
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="p-6">
        <ErrorState
          type="generic"
          title="Failed to load work items"
          description={state.message}
          onRetry={() => setState({ kind: 'loading' })}
        />
      </div>
    );
  }

  if (state.items.length === 0) {
    return (
      <div className="p-6">
        <EmptyState
          variant="no-data"
          title="No work items"
          description="Create your first work item to get started"
          actionLabel="Create Work Item"
          onAction={() => {}}
        />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">Work Items</h1>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <a href="/app/kanban">
              <LayoutGrid className="mr-2 size-4" />
              Kanban Board
            </a>
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Title</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Priority</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {state.items.map((item) => (
                  <tr key={item.id} className="hover:bg-muted/50 transition-colors">
                    <td className="px-4 py-3">
                      <a
                        href={`/app/work-items/${encodeURIComponent(item.id)}`}
                        className="font-medium text-foreground hover:text-primary transition-colors"
                      >
                        {item.title}
                      </a>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {statusIcons[item.status ?? 'open'] ?? statusIcons.open}
                        <span className="text-sm capitalize">{item.status ?? 'open'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {item.priority && (
                        <Badge className={priorityColors[item.priority] ?? 'bg-gray-500'}>
                          {item.priority}
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button variant="ghost" size="sm" asChild>
                          <a href={`/app/work-items/${encodeURIComponent(item.id)}/timeline`}>
                            <Calendar className="size-4" />
                          </a>
                        </Button>
                        <Button variant="ghost" size="sm" asChild>
                          <a href={`/app/work-items/${encodeURIComponent(item.id)}/graph`}>
                            <Network className="size-4" />
                          </a>
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Work Item Detail Page
function WorkItemDetailPage(props: { id: string }): React.JSX.Element {
  const bootstrap = readBootstrap();
  const title = bootstrap?.workItem?.title;
  const participants = bootstrap?.participants ?? [];

  return (
    <div className="p-6">
      <div className="mb-4">
        <Button variant="ghost" size="sm" asChild>
          <a href="/app/work-items">
            <ChevronRight className="mr-1 size-4 rotate-180" />
            Back to Work Items
          </a>
        </Button>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>{title ? title : `Work Item ${props.id}`}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 mb-4">
            <Button variant="outline" size="sm" asChild>
              <a href={`/app/work-items/${props.id}/timeline`}>
                <Calendar className="mr-2 size-4" />
                Timeline
              </a>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={`/app/work-items/${props.id}/graph`}>
                <Network className="mr-2 size-4" />
                Dependencies
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Participants</CardTitle>
        </CardHeader>
        <CardContent>
          {participants.length === 0 ? (
            <p className="text-muted-foreground">No participants assigned</p>
          ) : (
            <ul className="space-y-2">
              {participants.map((p, idx) => (
                <li key={idx} className="flex items-center gap-2">
                  <div className="size-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <span className="text-xs font-medium text-primary">
                      {(p.participant ?? 'U')[0].toUpperCase()}
                    </span>
                  </div>
                  <span className="text-sm">{p.participant ?? 'Unknown'}</span>
                  {p.role && (
                    <Badge variant="outline" className="text-xs">
                      {p.role}
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Timeline/Gantt Page
function TimelinePage(props: { id: string }): React.JSX.Element {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'loaded'; data: TimelineResponse }
  >({ kind: 'loading' });

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
      <div className="p-6">
        <Skeleton width={150} height={24} className="mb-4" />
        <Skeleton width="100%" height={400} />
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="p-6">
        <ErrorState
          type="generic"
          title="Failed to load timeline"
          description={state.message}
          onRetry={() => setState({ kind: 'loading' })}
        />
      </div>
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

  const range = maxDate - minDate || 1;
  minDate -= range * 0.05;
  maxDate += range * 0.05;

  const chartWidth = 900;
  const rowHeight = 40;
  const labelWidth = 220;
  const chartHeight = items.length * rowHeight + 60;

  function dateToX(date: number): number {
    return labelWidth + ((date - minDate) / (maxDate - minDate)) * (chartWidth - labelWidth - 20);
  }

  const itemPositions: Record<string, { y: number }> = {};
  items.forEach((item, idx) => {
    itemPositions[item.id] = { y: idx * rowHeight + 30 };
  });

  return (
    <div className="p-6">
      <div className="mb-4">
        <Button variant="ghost" size="sm" asChild>
          <a href="/app/work-items">
            <ChevronRight className="mr-1 size-4 rotate-180" />
            Back to Work Items
          </a>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="size-5" />
            Timeline / Gantt Chart
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="w-full">
            <svg
              width={chartWidth}
              height={chartHeight}
              className="font-sans text-xs"
            >
              {/* Background */}
              <rect x={labelWidth} y={0} width={chartWidth - labelWidth} height={chartHeight} className="fill-muted/30" />

              {/* Date axis markers */}
              {[0.25, 0.5, 0.75, 1].map((pct) => {
                const x = labelWidth + pct * (chartWidth - labelWidth - 20);
                const dateVal = minDate + pct * (maxDate - minDate);
                const label = new Date(dateVal).toLocaleDateString();
                return (
                  <g key={pct}>
                    <line x1={x} y1={0} x2={x} y2={chartHeight} className="stroke-border" strokeDasharray="4,4" />
                    <text x={x} y={chartHeight - 8} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                      {label}
                    </text>
                  </g>
                );
              })}

              {/* Items */}
              {items.map((item, idx) => {
                const y = idx * rowHeight + 30;
                const indent = item.level * 16;

                const hasStart = item.not_before !== null;
                const hasEnd = item.not_after !== null;
                let barX = labelWidth + 10;
                let barWidth = 60;

                if (hasStart && hasEnd) {
                  barX = dateToX(new Date(item.not_before!).getTime());
                  barWidth = Math.max(8, dateToX(new Date(item.not_after!).getTime()) - barX);
                } else if (hasStart) {
                  barX = dateToX(new Date(item.not_before!).getTime());
                } else if (hasEnd) {
                  barX = dateToX(new Date(item.not_after!).getTime()) - 60;
                }

                const colorClass = kindColors[item.kind] || 'bg-gray-500';
                const isDone = item.status === 'done' || item.status === 'closed';

                return (
                  <g key={item.id}>
                    {/* Row background */}
                    <rect x={0} y={y - 15} width={chartWidth} height={rowHeight} className={idx % 2 === 0 ? 'fill-transparent' : 'fill-muted/20'} />

                    {/* Label */}
                    <text x={8 + indent} y={y + 5} className="fill-foreground text-xs font-medium">
                      {item.title.length > 24 ? item.title.slice(0, 22) + '...' : item.title}
                    </text>

                    {/* Bar */}
                    <rect
                      x={barX}
                      y={y - 10}
                      width={barWidth}
                      height={24}
                      rx={4}
                      className={`${colorClass} ${isDone ? 'opacity-40' : 'opacity-80'}`}
                    />

                    {/* Kind badge */}
                    <text x={barX + 6} y={y + 5} className="fill-white text-[10px] font-medium">
                      {item.kind.charAt(0).toUpperCase()}
                    </text>
                  </g>
                );
              })}

              {/* Dependencies */}
              {dependencies.map((dep) => {
                const fromPos = itemPositions[dep.from_id];
                const toPos = itemPositions[dep.to_id];
                if (!fromPos || !toPos) return null;

                const fromItem = items.find((i) => i.id === dep.from_id);
                const toItem = items.find((i) => i.id === dep.to_id);
                if (!fromItem || !toItem) return null;

                const fromY = fromPos.y;
                const toY = toPos.y;

                let fromX = labelWidth + 40;
                let toX = labelWidth + 40;

                if (toItem.not_after) {
                  toX = dateToX(new Date(toItem.not_after).getTime());
                }
                if (fromItem.not_before) {
                  fromX = dateToX(new Date(fromItem.not_before).getTime());
                }

                return (
                  <line
                    key={dep.id}
                    x1={toX + 4}
                    y1={toY}
                    x2={fromX - 4}
                    y2={fromY}
                    className="stroke-destructive"
                    strokeWidth={1.5}
                    markerEnd="url(#arrowhead)"
                  />
                );
              })}

              <defs>
                <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
                  <path d="M0,0 L8,4 L0,8 Z" className="fill-destructive" />
                </marker>
              </defs>
            </svg>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>

          {/* Legend */}
          <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            <span className="font-medium">Legend:</span>
            <span className="flex items-center gap-1">
              <span className="size-3 rounded bg-blue-500" /> Project
            </span>
            <span className="flex items-center gap-1">
              <span className="size-3 rounded bg-violet-500" /> Initiative
            </span>
            <span className="flex items-center gap-1">
              <span className="size-3 rounded bg-emerald-500" /> Epic
            </span>
            <span className="flex items-center gap-1">
              <span className="size-3 rounded bg-gray-500" /> Issue
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Dependency Graph Page
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
      <div className="p-6">
        <Skeleton width={200} height={24} className="mb-4" />
        <Skeleton width="100%" height={500} />
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="p-6">
        <ErrorState
          type="generic"
          title="Failed to load dependency graph"
          description={state.message}
          onRetry={() => setState({ kind: 'loading' })}
        />
      </div>
    );
  }

  const { nodes, edges, critical_path } = state.data;

  const nodeWidth = 180;
  const nodeHeight = 56;
  const levelGap = 120;
  const nodeGap = 24;

  const nodesByLevel = new Map<number, GraphNode[]>();
  for (const node of nodes) {
    if (!nodesByLevel.has(node.level)) {
      nodesByLevel.set(node.level, []);
    }
    nodesByLevel.get(node.level)!.push(node);
  }

  const positions = new Map<string, { x: number; y: number }>();
  let maxY = 0;

  for (const [level, levelNodes] of nodesByLevel) {
    const x = 60 + level * (nodeWidth + levelGap);
    for (let i = 0; i < levelNodes.length; i++) {
      const y = 60 + i * (nodeHeight + nodeGap);
      positions.set(levelNodes[i].id, { x, y });
      maxY = Math.max(maxY, y + nodeHeight);
    }
  }

  const criticalPathIds = new Set(critical_path.map((n) => n.id));

  const chartWidth = Math.max(900, (nodesByLevel.size + 1) * (nodeWidth + levelGap));
  const chartHeight = Math.max(500, maxY + 60);

  return (
    <div className="p-6">
      <div className="mb-4">
        <Button variant="ghost" size="sm" asChild>
          <a href="/app/work-items">
            <ChevronRight className="mr-1 size-4 rotate-180" />
            Back to Work Items
          </a>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Network className="size-5" />
            Dependency Graph
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Zoom controls */}
          <div className="mb-4 flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setZoom((z) => Math.min(3, z * 1.2))}>
              Zoom In
            </Button>
            <Button variant="outline" size="sm" onClick={() => setZoom((z) => Math.max(0.2, z * 0.8))}>
              Zoom Out
            </Button>
            <Button variant="outline" size="sm" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>
              Reset
            </Button>
            <span className="text-sm text-muted-foreground">
              Zoom: {Math.round(zoom * 100)}% | Drag to pan
            </span>
          </div>

          {/* Graph */}
          <div
            className="rounded-lg border overflow-hidden cursor-grab active:cursor-grabbing select-none"
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            <svg
              width={900}
              height={500}
              viewBox={`${-pan.x / zoom} ${-pan.y / zoom} ${900 / zoom} ${500 / zoom}`}
              className="font-sans text-xs bg-muted/20"
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
                  <line
                    key={edge.id}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    className={isCritical ? 'stroke-destructive' : 'stroke-muted-foreground'}
                    strokeWidth={isCritical ? 2.5 : 1.5}
                    markerEnd={isCritical ? 'url(#arrowhead-critical)' : 'url(#arrowhead-normal)'}
                  />
                );
              })}

              {/* Nodes */}
              {nodes.map((node) => {
                const pos = positions.get(node.id);
                if (!pos) return null;

                const isCritical = criticalPathIds.has(node.id);
                const isDone = node.status === 'done' || node.status === 'closed';
                const colorClass = kindColors[node.kind] || 'bg-gray-500';

                return (
                  <g key={node.id}>
                    <rect
                      x={pos.x}
                      y={pos.y}
                      width={nodeWidth}
                      height={nodeHeight}
                      rx={8}
                      className={`${isDone ? 'fill-muted' : colorClass} ${isDone ? 'opacity-50' : ''}`}
                      stroke={isCritical ? '#ef4444' : node.is_blocker ? '#f59e0b' : 'transparent'}
                      strokeWidth={isCritical ? 3 : node.is_blocker ? 2 : 0}
                    />
                    <text x={pos.x + 10} y={pos.y + 22} className="fill-white text-xs font-semibold">
                      {node.title.length > 20 ? node.title.slice(0, 18) + '...' : node.title}
                    </text>
                    <text x={pos.x + 10} y={pos.y + 40} className="fill-white/80 text-[10px]">
                      {node.kind} | {node.status || 'open'}
                    </text>
                    {node.is_blocker && (
                      <text x={pos.x + nodeWidth - 20} y={pos.y + 18} className="fill-yellow-300 text-sm">
                        !
                      </text>
                    )}
                    {node.estimate_minutes && (
                      <text x={pos.x + nodeWidth - 10} y={pos.y + nodeHeight - 10} className="fill-white/70 text-[9px]" textAnchor="end">
                        {node.estimate_minutes >= 60 ? `${Math.floor(node.estimate_minutes / 60)}h` : `${node.estimate_minutes}m`}
                      </text>
                    )}
                  </g>
                );
              })}

              <defs>
                <marker id="arrowhead-normal" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
                  <path d="M0,0 L8,4 L0,8 Z" className="fill-muted-foreground" />
                </marker>
                <marker id="arrowhead-critical" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
                  <path d="M0,0 L8,4 L0,8 Z" className="fill-destructive" />
                </marker>
              </defs>
            </svg>
          </div>

          {/* Critical Path */}
          {critical_path.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-medium mb-3">Critical Path</h3>
              <div className="flex flex-wrap items-center gap-2">
                {critical_path.map((item, idx) => (
                  <React.Fragment key={item.id}>
                    <Badge variant="outline" className="border-destructive text-destructive bg-destructive/10">
                      {item.title}
                      {item.estimate_minutes && (
                        <span className="ml-2 text-muted-foreground">
                          ({item.estimate_minutes >= 60 ? `${Math.floor(item.estimate_minutes / 60)}h` : `${item.estimate_minutes}m`})
                        </span>
                      )}
                    </Badge>
                    {idx < critical_path.length - 1 && <ChevronRight className="size-4 text-muted-foreground" />}
                  </React.Fragment>
                ))}
              </div>
              <p className="text-sm text-muted-foreground mt-2">
                Total: {critical_path.reduce((sum, n) => sum + (n.estimate_minutes || 0), 0)} minutes
                ({Math.round(critical_path.reduce((sum, n) => sum + (n.estimate_minutes || 0), 0) / 60 * 10) / 10} hours)
              </p>
            </div>
          )}

          {/* Legend */}
          <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            <span className="font-medium">Legend:</span>
            <span className="flex items-center gap-1">
              <span className="size-3 rounded bg-blue-500" /> Project
            </span>
            <span className="flex items-center gap-1">
              <span className="size-3 rounded bg-violet-500" /> Initiative
            </span>
            <span className="flex items-center gap-1">
              <span className="size-3 rounded bg-emerald-500" /> Epic
            </span>
            <span className="flex items-center gap-1">
              <span className="size-3 rounded bg-gray-500" /> Issue
            </span>
            <span className="flex items-center gap-1">
              <span className="text-yellow-500 font-bold">!</span> Blocker
            </span>
            <span className="flex items-center gap-1">
              <span className="h-0.5 w-4 bg-destructive" /> Critical Path
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Kanban Page
function KanbanPage(): React.JSX.Element {
  const queryParams = useQueryParams();

  const [items, setItems] = useState<BacklogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = useState({
    priority: queryParams.getAll('priority'),
    kind: queryParams.getAll('kind'),
  });

  const [draggedItem, setDraggedItem] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);

  const statuses = ['open', 'blocked', 'closed'];
  const statusConfig: Record<string, { label: string; color: string; bgColor: string }> = {
    open: { label: 'To Do', color: 'text-blue-400', bgColor: 'from-blue-500/5 to-blue-500/0' },
    blocked: { label: 'Blocked', color: 'text-amber-400', bgColor: 'from-amber-500/5 to-amber-500/0' },
    closed: { label: 'Done', color: 'text-emerald-400', bgColor: 'from-emerald-500/5 to-emerald-500/0' },
  };

  const priorityConfig: Record<string, { color: string; bg: string }> = {
    P0: { color: '#ef4444', bg: 'bg-red-500/10 text-red-400 border-red-500/20' },
    P1: { color: '#f97316', bg: 'bg-orange-500/10 text-orange-400 border-orange-500/20' },
    P2: { color: '#eab308', bg: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' },
    P3: { color: '#22c55e', bg: 'bg-green-500/10 text-green-400 border-green-500/20' },
    P4: { color: '#6b7280', bg: 'bg-gray-500/10 text-gray-400 border-gray-500/20' },
  };

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

  const handleDragOver = (e: React.DragEvent, status: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverColumn(status);
  };

  const handleDragLeave = () => {
    setDragOverColumn(null);
  };

  const handleDrop = async (e: React.DragEvent, newStatus: string) => {
    e.preventDefault();
    setDragOverColumn(null);
    if (!draggedItem) return;

    const item = items.find((i) => i.id === draggedItem);
    if (!item || item.status === newStatus) {
      setDraggedItem(null);
      return;
    }

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
    } catch {
      setItems((prev) =>
        prev.map((i) => (i.id === draggedItem ? { ...i, status: item.status } : i))
      );
      setError('Failed to update status');
    }

    setDraggedItem(null);
  };

  const kindLabels: Record<string, { label: string; color: string }> = {
    project: { label: 'P', color: 'bg-blue-500' },
    initiative: { label: 'I', color: 'bg-violet-500' },
    epic: { label: 'E', color: 'bg-emerald-500' },
    issue: { label: 'T', color: 'bg-gray-500' },
  };

  return (
    <div className="h-full flex flex-col bg-gradient-to-br from-background to-muted/20">
      {/* Header */}
      <div className="px-6 pt-6 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Kanban Board</h1>
            <p className="text-sm text-muted-foreground mt-1">Drag cards to update status</p>
          </div>
          <Button variant="outline" size="sm" asChild className="border-border/50">
            <a href="/app/work-items">
              <List className="mr-2 size-4" />
              List View
            </a>
          </Button>
        </div>

        {/* Filters */}
        <div className="mt-4 flex flex-wrap gap-3 items-center">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Priority</span>
            <div className="flex gap-1">
              {['P0', 'P1', 'P2', 'P3', 'P4'].map((p) => (
                <button
                  key={p}
                  onClick={() => toggleFilter('priority', p)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
                    filters.priority.includes(p)
                      ? priorityConfig[p].bg + ' border'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div className="h-4 w-px bg-border/50" />
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Type</span>
            <div className="flex gap-1">
              {(['project', 'initiative', 'epic', 'issue'] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => toggleFilter('kind', k)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all flex items-center gap-1.5 ${
                    filters.kind.includes(k)
                      ? 'bg-primary/10 text-primary border border-primary/20'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`}
                >
                  <span className={`size-2 rounded-sm ${kindLabels[k].color}`} />
                  {k.charAt(0).toUpperCase() + k.slice(1)}
                </button>
              ))}
            </div>
          </div>
          {(filters.priority.length > 0 || filters.kind.length > 0) && (
            <>
              <div className="h-4 w-px bg-border/50" />
              <button
                onClick={() => updateFilters({ priority: [], kind: [] })}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear all
              </button>
            </>
          )}
        </div>
      </div>

      {loading && (
        <div className="flex gap-4 flex-1 px-6 pb-6">
          {statuses.map((s) => (
            <div key={s} className="flex-1 rounded-xl bg-muted/30 animate-pulse min-h-[400px]" />
          ))}
        </div>
      )}

      {error && (
        <div className="px-6">
          <ErrorState
            type="generic"
            title="Failed to load board"
            description={error}
            onRetry={() => fetchItems()}
          />
        </div>
      )}

      {!loading && !error && (
        <div className="flex gap-4 flex-1 overflow-x-auto px-6 pb-6">
          {statuses.map((status) => {
            const columnItems = items.filter((i) => i.status === status);
            const config = statusConfig[status];
            const isOver = dragOverColumn === status;
            return (
              <div
                key={status}
                className={`flex-1 min-w-[300px] max-w-[380px] flex flex-col rounded-xl transition-all duration-200 ${
                  isOver ? 'ring-2 ring-primary/50 ring-offset-2 ring-offset-background' : ''
                }`}
                onDragOver={(e) => handleDragOver(e, status)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, status)}
              >
                {/* Column Header */}
                <div className={`px-4 py-3 rounded-t-xl bg-gradient-to-b ${config.bgColor} border-b border-border/30`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`size-2 rounded-full ${
                        status === 'open' ? 'bg-blue-400' : status === 'blocked' ? 'bg-amber-400' : 'bg-emerald-400'
                      }`} />
                      <h3 className="font-semibold text-sm">{config.label}</h3>
                    </div>
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                      {columnItems.length}
                    </span>
                  </div>
                </div>

                {/* Column Content */}
                <div className="flex-1 p-2 space-y-2 overflow-y-auto bg-muted/20 rounded-b-xl">
                  {columnItems.map((item) => {
                    const kindConfig = kindLabels[item.kind] || { label: '?', color: 'bg-gray-500' };
                    const prioConfig = priorityConfig[item.priority] || priorityConfig.P4;
                    return (
                      <div
                        key={item.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, item.id)}
                        className={`group bg-surface border border-border/50 rounded-lg p-3 cursor-grab active:cursor-grabbing transition-all duration-150 hover:border-border hover:shadow-lg hover:shadow-black/5 hover:-translate-y-0.5 ${
                          draggedItem === item.id ? 'opacity-50 scale-95' : ''
                        }`}
                        style={{ borderLeftWidth: 3, borderLeftColor: prioConfig.color }}
                      >
                        <div className="flex items-start gap-2">
                          <div className="flex-1 min-w-0">
                            <a
                              href={`/app/work-items/${item.id}`}
                              className="font-medium text-sm text-foreground hover:text-primary transition-colors line-clamp-2 leading-snug"
                            >
                              {item.title}
                            </a>
                          </div>
                          <div className={`shrink-0 size-5 rounded flex items-center justify-center text-[10px] font-bold text-white ${kindConfig.color}`}>
                            {kindConfig.label}
                          </div>
                        </div>
                        <div className="mt-2.5 flex items-center gap-2">
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${prioConfig.bg}`}>
                            {item.priority}
                          </span>
                          {item.estimate_minutes && (
                            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                              <Clock className="size-3" />
                              {item.estimate_minutes >= 60
                                ? `${Math.floor(item.estimate_minutes / 60)}h`
                                : `${item.estimate_minutes}m`}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {columnItems.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                      <div className="size-10 rounded-full bg-muted/50 flex items-center justify-center mb-2">
                        {status === 'open' ? <Circle className="size-5" /> : status === 'blocked' ? <AlertCircle className="size-5" /> : <CheckCircle2 className="size-5" />}
                      </div>
                      <span className="text-sm">No items</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Not Found Page
function NotFoundPage(props: { path: string }): React.JSX.Element {
  return (
    <div className="p-6">
      <EmptyState
        variant="no-data"
        title="Page Not Found"
        description={`The page "${props.path}" does not exist.`}
        actionLabel="Go to Work Items"
        onAction={() => { window.location.href = '/app/work-items'; }}
      />
    </div>
  );
}

// Activity Page (issue #131)
type ApiActivityItem = {
  id: string;
  type: string;
  work_item_id: string;
  work_item_title: string;
  actor_email: string | null;
  description: string;
  created_at: string;
};

type ActivityApiResponse = {
  items: ApiActivityItem[];
};

function ActivityPage(): React.JSX.Element {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'loaded'; items: ApiActivityItem[] }
  >({ kind: 'loading' });

  const [hasMore] = useState(false);

  useEffect(() => {
    let alive = true;

    async function fetchActivity(): Promise<void> {
      try {
        const res = await fetch('/api/activity?limit=50', {
          headers: { accept: 'application/json' },
        });
        if (!res.ok) throw new Error(`Failed to load activity: ${res.status}`);
        const data = (await res.json()) as ActivityApiResponse;
        if (!alive) return;
        setState({ kind: 'loaded', items: data.items });
      } catch (err) {
        if (!alive) return;
        const message = err instanceof Error ? err.message : 'Unknown error';
        setState({ kind: 'error', message });
      }
    }

    fetchActivity();
    return () => {
      alive = false;
    };
  }, []);

  // Map API activity items to the ActivityItem type expected by ActivityFeed
  const mapToActivityItems = (items: ApiActivityItem[]): Array<{
    id: string;
    actorType: 'agent' | 'human';
    actorName: string;
    action: 'created' | 'updated' | 'status_changed' | 'commented' | 'assigned' | 'completed' | 'deleted' | 'moved';
    entityType: 'project' | 'initiative' | 'epic' | 'issue' | 'contact' | 'memory';
    entityId: string;
    entityTitle: string;
    detail?: string;
    timestamp: Date;
    read?: boolean;
  }> => {
    return items.map((item) => ({
      id: item.id,
      actorType: item.actor_email?.includes('agent') ? 'agent' as const : 'human' as const,
      actorName: item.actor_email || 'System',
      action: (item.type === 'status_change' ? 'status_changed' : item.type) as 'created' | 'updated' | 'status_changed',
      entityType: 'issue' as const,
      entityId: item.work_item_id,
      entityTitle: item.work_item_title,
      detail: item.description,
      timestamp: new Date(item.created_at),
      read: false,
    }));
  };

  if (state.kind === 'loading') {
    return (
      <div className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <Skeleton width={200} height={32} />
        </div>
        <SkeletonList count={5} variant="row" />
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="p-6">
        <ErrorState
          type="generic"
          title="Failed to load activity"
          description={state.message}
          onRetry={() => setState({ kind: 'loading' })}
        />
      </div>
    );
  }

  if (state.items.length === 0) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold text-foreground mb-4">Activity Feed</h1>
        <Card>
          <CardContent className="p-8">
            <EmptyState
              variant="no-data"
              title="No activity yet"
              description="Activity will appear here when work items are created or updated."
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  const activityItems = mapToActivityItems(state.items);

  // Simple inline activity display (using the existing patterns from the page)
  return (
    <div className="p-6 h-full flex flex-col">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground">Activity Feed</h1>
        <p className="text-sm text-muted-foreground mt-1">Recent updates across all work items</p>
      </div>

      <Card className="flex-1">
        <CardContent className="p-0">
          <ScrollArea className="h-[calc(100vh-200px)]">
            <div className="divide-y">
              {activityItems.map((item) => (
                <div key={item.id} className="p-4 hover:bg-muted/50 transition-colors">
                  <div className="flex items-start gap-3">
                    <div className={`size-8 rounded-full flex items-center justify-center shrink-0 ${
                      item.actorType === 'agent' ? 'bg-violet-500/10 text-violet-500' : 'bg-primary/10 text-primary'
                    }`}>
                      <span className="text-xs font-medium">
                        {item.actorName.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-foreground">{item.actorName}</span>
                        <span className="text-xs text-muted-foreground">
                          {item.action === 'created' && 'created'}
                          {item.action === 'updated' && 'updated'}
                          {item.action === 'status_changed' && 'changed status of'}
                          {item.action === 'commented' && 'commented on'}
                          {item.action === 'assigned' && 'assigned'}
                        </span>
                      </div>
                      <a
                        href={`/app/work-items/${item.entityId}`}
                        className="text-sm font-medium text-primary hover:underline"
                      >
                        {item.entityTitle}
                      </a>
                      {item.detail && (
                        <p className="text-sm text-muted-foreground mt-1">{item.detail}</p>
                      )}
                      <p className="text-xs text-muted-foreground mt-2">
                        {item.timestamp.toLocaleDateString()} at {item.timestamp.toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                </div>
              ))}

              {hasMore && (
                <div className="p-4 text-center">
                  <Button variant="outline" size="sm">
                    Load more
                  </Button>
                </div>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

// Global Timeline Page (issue #134)
type GlobalTimelineItem = {
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

type GlobalTimelineDependency = {
  id: string;
  from_id: string;
  to_id: string;
  kind: string;
};

type GlobalTimelineResponse = {
  items: GlobalTimelineItem[];
  dependencies: GlobalTimelineDependency[];
};

type TimelineZoomLevel = 'day' | 'week' | 'month' | 'quarter';

const ZOOM_CONFIGS: Record<TimelineZoomLevel, { pixelsPerDay: number; label: string }> = {
  day: { pixelsPerDay: 60, label: 'Day' },
  week: { pixelsPerDay: 12, label: 'Week' },
  month: { pixelsPerDay: 3, label: 'Month' },
  quarter: { pixelsPerDay: 1, label: 'Quarter' },
};

function GlobalTimelinePage(): React.JSX.Element {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'loaded'; data: GlobalTimelineResponse }
  >({ kind: 'loading' });

  const [zoom, setZoom] = useState<TimelineZoomLevel>('week');
  const [kindFilter, setKindFilter] = useState<string[]>([]);

  const fetchTimeline = useCallback(async () => {
    try {
      let url = '/api/timeline';
      const params: string[] = [];
      if (kindFilter.length > 0) {
        params.push(`kind=${kindFilter.join(',')}`);
      }
      if (params.length > 0) {
        url += '?' + params.join('&');
      }

      const res = await fetch(url, {
        headers: { accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`Failed to load timeline: ${res.status}`);
      const data = (await res.json()) as GlobalTimelineResponse;
      setState({ kind: 'loaded', data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setState({ kind: 'error', message });
    }
  }, [kindFilter]);

  useEffect(() => {
    fetchTimeline();
  }, [fetchTimeline]);

  const handleKindToggle = (kind: string) => {
    setKindFilter((prev) => {
      if (prev.includes(kind)) {
        return prev.filter((k) => k !== kind);
      }
      return [...prev, kind];
    });
  };

  const handleZoomIn = () => {
    const levels: TimelineZoomLevel[] = ['quarter', 'month', 'week', 'day'];
    const idx = levels.indexOf(zoom);
    if (idx < levels.length - 1) setZoom(levels[idx + 1]);
  };

  const handleZoomOut = () => {
    const levels: TimelineZoomLevel[] = ['quarter', 'month', 'week', 'day'];
    const idx = levels.indexOf(zoom);
    if (idx > 0) setZoom(levels[idx - 1]);
  };

  if (state.kind === 'loading') {
    return (
      <div className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <Skeleton width={200} height={32} />
          <div className="flex gap-2">
            <Skeleton width={100} height={36} />
            <Skeleton width={100} height={36} />
          </div>
        </div>
        <Skeleton width="100%" height={400} />
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="p-6">
        <ErrorState
          type="generic"
          title="Failed to load timeline"
          description={state.message}
          onRetry={() => {
            setState({ kind: 'loading' });
            fetchTimeline();
          }}
        />
      </div>
    );
  }

  const { items, dependencies } = state.data;

  if (items.length === 0) {
    return (
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-foreground">Timeline</h1>
          <p className="text-sm text-muted-foreground mt-1">Gantt view of all work items</p>
        </div>
        <Card>
          <CardContent className="p-8">
            <EmptyState
              variant="no-data"
              title="No scheduled items"
              description="Add dates to your work items to see them on the timeline."
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  // Compute date range from items
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

  const zoomConfig = ZOOM_CONFIGS[zoom];
  const dayMs = 24 * 60 * 60 * 1000;
  const totalDays = Math.ceil((maxDate - minDate) / dayMs);
  const chartWidth = Math.max(800, totalDays * zoomConfig.pixelsPerDay);
  const rowHeight = 36;
  const labelWidth = 240;
  const chartHeight = Math.max(200, items.length * rowHeight + 60);

  function dateToX(date: number): number {
    return labelWidth + ((date - minDate) / (maxDate - minDate)) * (chartWidth - labelWidth - 20);
  }

  const itemPositions: Record<string, { y: number }> = {};
  items.forEach((item, idx) => {
    itemPositions[item.id] = { y: idx * rowHeight + 40 };
  });

  const kindColors: Record<string, string> = {
    project: 'fill-violet-500',
    initiative: 'fill-blue-500',
    epic: 'fill-green-500',
    issue: 'fill-amber-500',
  };

  const statusBgColors: Record<string, string> = {
    done: 'opacity-60',
    in_progress: '',
    blocked: 'opacity-80 stroke-red-500 stroke-2',
    open: 'opacity-40',
  };

  // Generate date markers
  const dateMarkers: { x: number; label: string }[] = [];
  const markerInterval = zoom === 'day' ? dayMs : zoom === 'week' ? 7 * dayMs : zoom === 'month' ? 30 * dayMs : 90 * dayMs;
  for (let d = minDate; d <= maxDate; d += markerInterval) {
    dateMarkers.push({ x: dateToX(d), label: new Date(d).toLocaleDateString() });
  }

  return (
    <div className="p-6 h-full flex flex-col">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Timeline</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {items.length} item{items.length !== 1 ? 's' : ''} with scheduled dates
          </p>
        </div>
        <div className="flex items-center gap-4">
          {/* Kind filters */}
          <div className="flex gap-1">
            {(['project', 'initiative', 'epic', 'issue'] as const).map((kind) => (
              <Button
                key={kind}
                variant={kindFilter.length === 0 || kindFilter.includes(kind) ? 'secondary' : 'outline'}
                size="sm"
                onClick={() => handleKindToggle(kind)}
                className="text-xs"
              >
                {kind.charAt(0).toUpperCase() + kind.slice(1)}
              </Button>
            ))}
          </div>
          {/* Zoom controls */}
          <div className="flex gap-1">
            <Button variant="outline" size="sm" onClick={handleZoomIn} disabled={zoom === 'day'}>
              Zoom In
            </Button>
            <Button variant="outline" size="sm" onClick={handleZoomOut} disabled={zoom === 'quarter'}>
              Zoom Out
            </Button>
            <span className="ml-2 text-sm text-muted-foreground self-center">{zoomConfig.label} view</span>
          </div>
        </div>
      </div>

      {/* Timeline Chart */}
      <Card className="flex-1 overflow-hidden">
        <CardContent className="p-0 h-full">
          <ScrollArea className="h-full">
            <div className="flex" style={{ minWidth: `${chartWidth}px` }}>
              {/* Sticky labels column */}
              <div
                className="sticky left-0 z-10 bg-background border-r"
                style={{ width: `${labelWidth}px`, minWidth: `${labelWidth}px` }}
              >
                <div className="h-10 border-b bg-muted/30 px-3 flex items-center">
                  <span className="text-sm font-medium text-muted-foreground">Work Item</span>
                </div>
                {items.map((item) => (
                  <div
                    key={item.id}
                    className="h-9 border-b px-3 flex items-center gap-2 hover:bg-muted/50 transition-colors"
                    style={{ paddingLeft: `${12 + (item.level || 0) * 16}px` }}
                  >
                    <span
                      className={`size-2 rounded-full ${kindColors[item.kind] || 'bg-gray-400'}`}
                    />
                    <a
                      href={`/app/work-items/${item.id}`}
                      className="text-sm truncate hover:text-primary hover:underline"
                      title={item.title}
                    >
                      {item.title}
                    </a>
                  </div>
                ))}
              </div>

              {/* Chart area */}
              <div className="flex-1">
                <svg width={chartWidth - labelWidth} height={chartHeight}>
                  {/* Date axis */}
                  <g className="text-[10px]">
                    {dateMarkers.map((m, i) => (
                      <g key={i}>
                        <line
                          x1={m.x - labelWidth}
                          y1={40}
                          x2={m.x - labelWidth}
                          y2={chartHeight}
                          className="stroke-border"
                          strokeDasharray="4,4"
                        />
                        <text
                          x={m.x - labelWidth}
                          y={28}
                          textAnchor="middle"
                          className="fill-muted-foreground"
                        >
                          {m.label}
                        </text>
                      </g>
                    ))}
                  </g>

                  {/* Today line */}
                  {now >= minDate && now <= maxDate && (
                    <line
                      x1={dateToX(now) - labelWidth}
                      y1={40}
                      x2={dateToX(now) - labelWidth}
                      y2={chartHeight}
                      className="stroke-red-500"
                      strokeWidth={2}
                    />
                  )}

                  {/* Item bars */}
                  {items.map((item) => {
                    const start = item.not_before ? new Date(item.not_before).getTime() : now;
                    const end = item.not_after ? new Date(item.not_after).getTime() : start + 7 * dayMs;
                    const x1 = dateToX(start) - labelWidth;
                    const x2 = dateToX(end) - labelWidth;
                    const y = itemPositions[item.id]?.y || 0;
                    const barHeight = 20;
                    const barY = y + (rowHeight - barHeight) / 2 - 4;

                    return (
                      <g key={item.id}>
                        <rect
                          x={x1}
                          y={barY}
                          width={Math.max(4, x2 - x1)}
                          height={barHeight}
                          rx={4}
                          className={`${kindColors[item.kind]} ${statusBgColors[item.status || 'open']}`}
                        />
                        {/* Progress indicator if item is in progress */}
                        {item.actual_minutes && item.estimate_minutes && item.estimate_minutes > 0 && (
                          <rect
                            x={x1}
                            y={barY + barHeight - 3}
                            width={Math.min(1, item.actual_minutes / item.estimate_minutes) * Math.max(4, x2 - x1)}
                            height={3}
                            rx={1}
                            className="fill-white/50"
                          />
                        )}
                      </g>
                    );
                  })}

                  {/* Dependency arrows */}
                  {dependencies.map((dep) => {
                    const fromItem = items.find((i) => i.id === dep.from_id);
                    const toItem = items.find((i) => i.id === dep.to_id);
                    if (!fromItem || !toItem) return null;

                    const fromEnd = fromItem.not_after ? new Date(fromItem.not_after).getTime() : now;
                    const toStart = toItem.not_before ? new Date(toItem.not_before).getTime() : now;

                    const x1 = dateToX(fromEnd) - labelWidth;
                    const y1 = (itemPositions[dep.from_id]?.y || 0) + rowHeight / 2;
                    const x2 = dateToX(toStart) - labelWidth;
                    const y2 = (itemPositions[dep.to_id]?.y || 0) + rowHeight / 2;

                    return (
                      <g key={dep.id}>
                        <path
                          d={`M ${x1} ${y1} C ${x1 + 20} ${y1}, ${x2 - 20} ${y2}, ${x2} ${y2}`}
                          fill="none"
                          className="stroke-muted-foreground"
                          strokeWidth={1.5}
                          markerEnd="url(#arrowhead)"
                        />
                      </g>
                    );
                  })}

                  {/* Arrow marker definition */}
                  <defs>
                    <marker
                      id="arrowhead"
                      markerWidth="10"
                      markerHeight="7"
                      refX="9"
                      refY="3.5"
                      orient="auto"
                    >
                      <polygon points="0 0, 10 3.5, 0 7" className="fill-muted-foreground" />
                    </marker>
                  </defs>
                </svg>
              </div>
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

// API response types for contacts
type ApiContact = {
  id: string;
  display_name: string;
  notes: string | null;
  created_at: string;
  updated_at?: string;
  endpoints: Array<{ type: string; value: string }>;
};

type ContactsApiResponse = {
  contacts: ApiContact[];
  total: number;
};

type ContactFormData = {
  displayName: string;
  notes?: string;
};

// Contacts Page (issue #133)
function ContactsPage(): React.JSX.Element {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'loaded'; contacts: ApiContact[]; total: number }
  >({ kind: 'loading' });

  const [search, setSearch] = useState('');
  const [selectedContact, setSelectedContact] = useState<ApiContact | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<ApiContact | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchContacts = useCallback(async (searchQuery?: string) => {
    try {
      const url = searchQuery
        ? `/api/contacts?search=${encodeURIComponent(searchQuery)}`
        : '/api/contacts';
      const res = await fetch(url, {
        headers: { accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`Failed to load contacts: ${res.status}`);
      const data = (await res.json()) as ContactsApiResponse;
      setState({ kind: 'loaded', contacts: data.contacts, total: data.total });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setState({ kind: 'error', message });
    }
  }, []);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchContacts(search || undefined);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, fetchContacts]);

  const handleContactClick = (contact: ApiContact) => {
    setSelectedContact(contact);
    setDetailOpen(true);
  };

  const handleCreateContact = async (data: ContactFormData) => {
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Failed to create contact: ${res.status}`);
      setFormOpen(false);
      fetchContacts(search || undefined);
    } catch (err) {
      console.error('Failed to create contact:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateContact = async (data: ContactFormData) => {
    if (!editingContact) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/contacts/${editingContact.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Failed to update contact: ${res.status}`);
      setFormOpen(false);
      setEditingContact(null);
      setDetailOpen(false);
      fetchContacts(search || undefined);
    } catch (err) {
      console.error('Failed to update contact:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteContact = async (contact: ApiContact) => {
    if (!confirm(`Delete contact "${contact.display_name}"?`)) return;
    try {
      const res = await fetch(`/api/contacts/${contact.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(`Failed to delete contact: ${res.status}`);
      setDetailOpen(false);
      setSelectedContact(null);
      fetchContacts(search || undefined);
    } catch (err) {
      console.error('Failed to delete contact:', err);
    }
  };

  const handleEdit = (contact: ApiContact) => {
    setEditingContact(contact);
    setDetailOpen(false);
    setFormOpen(true);
  };

  const handleAddNew = () => {
    setEditingContact(null);
    setFormOpen(true);
  };

  // Get initials from display name
  const getInitials = (name: string): string => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  // Get primary email from endpoints
  const getPrimaryEmail = (contact: ApiContact): string | null => {
    const emailEndpoint = contact.endpoints.find((e) => e.type === 'email');
    return emailEndpoint?.value || null;
  };

  if (state.kind === 'loading') {
    return (
      <div className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <Skeleton width={200} height={32} />
          <Skeleton width={120} height={36} />
        </div>
        <Skeleton width="100%" height={40} className="mb-4" />
        <SkeletonList count={5} variant="card" />
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="p-6">
        <ErrorState
          type="generic"
          title="Failed to load contacts"
          description={state.message}
          onRetry={() => {
            setState({ kind: 'loading' });
            fetchContacts();
          }}
        />
      </div>
    );
  }

  return (
    <div className="p-6 h-full flex flex-col">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">People</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {state.total} contact{state.total !== 1 ? 's' : ''}
          </p>
        </div>
        <Button onClick={handleAddNew}>
          Add Contact
        </Button>
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search contacts..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-md px-4 py-2 border rounded-md bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {/* Contacts List */}
      {state.contacts.length === 0 ? (
        <Card>
          <CardContent className="p-8">
            <EmptyState
              variant="no-data"
              title={search ? 'No contacts found' : 'No contacts yet'}
              description={search ? 'Try a different search term.' : 'Add your first contact to get started.'}
              action={
                !search
                  ? {
                      label: 'Add Contact',
                      onClick: handleAddNew,
                    }
                  : undefined
              }
            />
          </CardContent>
        </Card>
      ) : (
        <Card className="flex-1">
          <CardContent className="p-0">
            <ScrollArea className="h-[calc(100vh-280px)]">
              <div className="divide-y">
                {state.contacts.map((contact) => {
                  const email = getPrimaryEmail(contact);
                  return (
                    <button
                      key={contact.id}
                      onClick={() => handleContactClick(contact)}
                      className="w-full p-4 text-left hover:bg-muted/50 transition-colors flex items-center gap-3"
                    >
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">
                        {getInitials(contact.display_name)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-foreground truncate">
                          {contact.display_name}
                        </p>
                        {email && (
                          <p className="text-sm text-muted-foreground truncate">
                            {email}
                          </p>
                        )}
                      </div>
                      <Badge variant="secondary" className="shrink-0">
                        {contact.endpoints.length} endpoint{contact.endpoints.length !== 1 ? 's' : ''}
                      </Badge>
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Contact Detail Sheet */}
      {selectedContact && (
        <div
          className={`fixed inset-0 z-50 ${detailOpen ? '' : 'pointer-events-none'}`}
        >
          {/* Backdrop */}
          <div
            className={`absolute inset-0 bg-black/50 transition-opacity ${
              detailOpen ? 'opacity-100' : 'opacity-0'
            }`}
            onClick={() => setDetailOpen(false)}
          />
          {/* Sheet */}
          <div
            className={`absolute right-0 top-0 h-full w-96 max-w-full bg-background shadow-lg transform transition-transform ${
              detailOpen ? 'translate-x-0' : 'translate-x-full'
            }`}
          >
            <div className="p-6 h-full overflow-auto">
              <div className="flex items-start gap-4 mb-6">
                <div className="flex size-16 items-center justify-center rounded-full bg-primary/10 text-xl font-medium text-primary">
                  {getInitials(selectedContact.display_name)}
                </div>
                <div className="flex-1">
                  <h2 className="text-lg font-semibold">{selectedContact.display_name}</h2>
                  {getPrimaryEmail(selectedContact) && (
                    <p className="text-sm text-muted-foreground">
                      {getPrimaryEmail(selectedContact)}
                    </p>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2 mb-6">
                <Button variant="outline" size="sm" onClick={() => handleEdit(selectedContact)}>
                  Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => handleDeleteContact(selectedContact)}
                >
                  Delete
                </Button>
              </div>

              {/* Notes */}
              {selectedContact.notes && (
                <div className="mb-6">
                  <h3 className="text-sm font-medium mb-2">Notes</h3>
                  <p className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-md">
                    {selectedContact.notes}
                  </p>
                </div>
              )}

              {/* Endpoints */}
              <div>
                <h3 className="text-sm font-medium mb-2">Endpoints</h3>
                {selectedContact.endpoints.length > 0 ? (
                  <div className="space-y-2">
                    {selectedContact.endpoints.map((ep, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-sm">
                        <Badge variant="outline" className="text-xs">
                          {ep.type}
                        </Badge>
                        <span className="text-muted-foreground">{ep.value}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No endpoints</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Contact Form Modal */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setFormOpen(false)} />
          <div className="relative bg-background rounded-lg shadow-lg p-6 w-full max-w-md mx-4">
            <h2 className="text-lg font-semibold mb-4">
              {editingContact ? 'Edit Contact' : 'Add Contact'}
            </h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                const data: ContactFormData = {
                  displayName: formData.get('displayName') as string,
                  notes: formData.get('notes') as string || undefined,
                };
                if (editingContact) {
                  handleUpdateContact(data);
                } else {
                  handleCreateContact(data);
                }
              }}
            >
              <div className="space-y-4">
                <div>
                  <label htmlFor="displayName" className="block text-sm font-medium mb-1">
                    Name <span className="text-destructive">*</span>
                  </label>
                  <input
                    id="displayName"
                    name="displayName"
                    type="text"
                    required
                    defaultValue={editingContact?.display_name || ''}
                    className="w-full px-3 py-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="John Doe"
                  />
                </div>
                <div>
                  <label htmlFor="notes" className="block text-sm font-medium mb-1">
                    Notes
                  </label>
                  <textarea
                    id="notes"
                    name="notes"
                    rows={3}
                    defaultValue={editingContact?.notes || ''}
                    className="w-full px-3 py-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="Additional notes..."
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {editingContact ? 'Save Changes' : 'Add Contact'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// Route to sidebar section mapping
const routeToSection: Record<string, string> = {
  activity: 'activity',
  list: 'projects',
  kanban: 'projects',
  detail: 'projects',
  'item-timeline': 'projects',
  graph: 'projects',
  'global-timeline': 'timeline',
  contacts: 'people',
};

// Main App with AppShell
function App(): React.JSX.Element {
  const path = usePathname();
  const bootstrap = readBootstrap();

  const route = useMemo(() => {
    // New navigation routes (issue #129)
    const activity = /^\/app\/activity\/?$/;
    const globalTimeline = /^\/app\/timeline\/?$/;
    const contacts = /^\/app\/contacts\/?$/;

    // Existing routes
    const list = /^\/app\/work-items\/?$/;
    const detail = /^\/app\/work-items\/([^/]+)\/?$/;
    const itemTimeline = /^\/app\/work-items\/([^/]+)\/timeline\/?$/;
    const graph = /^\/app\/work-items\/([^/]+)\/graph\/?$/;
    const kanban = /^\/app\/kanban\/?$/;

    // Match new routes first
    if (activity.test(path)) return { kind: 'activity' as const };
    if (globalTimeline.test(path)) return { kind: 'global-timeline' as const };
    if (contacts.test(path)) return { kind: 'contacts' as const };

    // Existing route matching
    if (list.test(path)) return { kind: 'list' as const };
    if (kanban.test(path)) return { kind: 'kanban' as const };

    const t = path.match(itemTimeline);
    if (t) return { kind: 'item-timeline' as const, id: t[1] };

    const g = path.match(graph);
    if (g) return { kind: 'graph' as const, id: g[1] };

    const d = path.match(detail);
    if (d) return { kind: 'detail' as const, id: d[1] };

    return { kind: 'not-found' as const, path };
  }, [path]);

  // Derive activeSection from current route
  const activeSection = useMemo(() => {
    return routeToSection[route.kind] || 'projects';
  }, [route.kind]);

  const handleSectionChange = useCallback((section: string) => {
    // Navigate to the correct route based on section
    switch (section) {
      case 'activity':
        window.location.href = '/app/activity';
        break;
      case 'projects':
        window.location.href = '/app/work-items';
        break;
      case 'timeline':
        window.location.href = '/app/timeline';
        break;
      case 'people':
        window.location.href = '/app/contacts';
        break;
      case 'search':
        // Search opens command palette - handled by AppShell
        break;
      default:
        window.location.href = '/app/work-items';
    }
  }, []);

  const breadcrumbs: BreadcrumbItem[] = useMemo(() => {
    // Set base crumb based on route
    if (route.kind === 'activity') {
      return [{ id: 'activity', label: 'Activity' }];
    }

    if (route.kind === 'global-timeline') {
      return [{ id: 'timeline', label: 'Timeline' }];
    }

    if (route.kind === 'contacts') {
      return [{ id: 'contacts', label: 'People' }];
    }

    // Work items routes
    const crumbs: BreadcrumbItem[] = [
      { id: 'work-items', label: 'Projects', href: '/app/work-items' },
    ];

    if (route.kind === 'kanban') {
      crumbs.push({ id: 'kanban', label: 'Kanban Board' });
    } else if (route.kind === 'detail') {
      crumbs.push({ id: 'detail', label: bootstrap?.workItem?.title || route.id });
    } else if (route.kind === 'item-timeline') {
      crumbs.push(
        { id: 'detail', label: bootstrap?.workItem?.title || route.id, href: `/app/work-items/${route.id}` },
        { id: 'timeline', label: 'Timeline' }
      );
    } else if (route.kind === 'graph') {
      crumbs.push(
        { id: 'detail', label: bootstrap?.workItem?.title || route.id, href: `/app/work-items/${route.id}` },
        { id: 'graph', label: 'Dependencies' }
      );
    }

    return crumbs;
  }, [route, bootstrap]);

  const renderContent = () => {
    // New navigation pages
    if (route.kind === 'activity') return <ActivityPage />;
    if (route.kind === 'global-timeline') return <GlobalTimelinePage />;
    if (route.kind === 'contacts') return <ContactsPage />;

    // Existing pages
    if (route.kind === 'list') return <WorkItemsListPage />;
    if (route.kind === 'kanban') return <KanbanPage />;
    if (route.kind === 'item-timeline') return <TimelinePage id={route.id} />;
    if (route.kind === 'graph') return <DependencyGraphPage id={route.id} />;
    if (route.kind === 'detail') return <WorkItemDetailPage id={route.id} />;
    return <NotFoundPage path={route.path} />;
  };

  return (
    <AppShell
      activeSection={activeSection}
      onSectionChange={handleSectionChange}
      breadcrumbs={breadcrumbs}
      onHomeClick={() => { window.location.href = '/app/work-items'; }}
    >
      {renderContent()}
    </AppShell>
  );
}

// Mount the app
const el = document.getElementById('root');
if (!el) throw new Error('Missing #root element');

createRoot(el).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
