/**
 * Dependency graph page.
 *
 * Displays an interactive SVG dependency graph for a single work item,
 * showing nodes grouped by hierarchy level with edges and critical path
 * highlighting. Supports zoom and pan via mouse interactions.
 * Uses TanStack Query via the useDependencyGraph hook for data fetching.
 */
import React, { useState } from 'react';
import { useParams, Link } from 'react-router';
import { useDependencyGraph } from '@/ui/hooks/queries/use-dependency-graph';
import { kindColors } from '@/ui/lib/work-item-utils';
import type { GraphNode } from '@/ui/lib/api-types';
import { Skeleton, ErrorState } from '@/ui/components/feedback';
import { Button } from '@/ui/components/ui/button';
import { Badge } from '@/ui/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/components/ui/card';
import { ChevronRight, Network } from 'lucide-react';

export function DependencyGraphPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const itemId = id ?? '';
  const { data, isLoading, error, refetch } = useDependencyGraph(itemId);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

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

  if (isLoading) {
    return (
      <div data-testid="page-dependency-graph" className="p-6">
        <Skeleton width={200} height={24} className="mb-4" />
        <Skeleton width="100%" height={500} />
      </div>
    );
  }

  if (error) {
    return (
      <div data-testid="page-dependency-graph" className="p-6">
        <ErrorState
          type="generic"
          title="Failed to load dependency graph"
          description={error instanceof Error ? error.message : 'Unknown error'}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  const nodes = data?.nodes ?? [];
  const edges = data?.edges ?? [];
  const critical_path = data?.critical_path ?? [];

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

  return (
    <div data-testid="page-dependency-graph" className="p-6">
      <div className="mb-4">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/work-items">
            <ChevronRight className="mr-1 size-4 rotate-180" />
            Back to Work Items
          </Link>
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setZoom(1);
                setPan({ x: 0, y: 0 });
              }}
            >
              Reset
            </Button>
            <span className="text-sm text-muted-foreground">Zoom: {Math.round(zoom * 100)}% | Drag to pan</span>
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
            <svg width={900} height={500} viewBox={`${-pan.x / zoom} ${-pan.y / zoom} ${900 / zoom} ${500 / zoom}`} className="font-sans text-xs bg-muted/20">
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
                Total: {critical_path.reduce((sum, n) => sum + (n.estimate_minutes || 0), 0)} minutes (
                {Math.round((critical_path.reduce((sum, n) => sum + (n.estimate_minutes || 0), 0) / 60) * 10) / 10} hours)
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
