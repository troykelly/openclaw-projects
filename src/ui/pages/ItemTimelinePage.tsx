/**
 * Work item timeline / Gantt chart page.
 *
 * Displays a Gantt-style SVG chart showing the timeline for a single
 * work item and its children, including dependency arrows.
 * Uses TanStack Query via the useItemTimeline hook for data fetching.
 */
import React from 'react';
import { useParams, Link } from 'react-router';
import { useItemTimeline } from '@/ui/hooks/queries/use-timeline';
import { kindColors } from '@/ui/lib/work-item-utils';
import { Skeleton, ErrorState } from '@/ui/components/feedback';
import { Button } from '@/ui/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/components/ui/card';
import { ScrollArea, ScrollBar } from '@/ui/components/ui/scroll-area';
import { ChevronRight, BarChart3 } from 'lucide-react';

export function ItemTimelinePage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const itemId = id ?? '';
  const { data, isLoading, error, refetch } = useItemTimeline(itemId);

  if (isLoading) {
    return (
      <div data-testid="page-item-timeline" className="p-6">
        <Skeleton width={150} height={24} className="mb-4" />
        <Skeleton width="100%" height={400} />
      </div>
    );
  }

  if (error) {
    return (
      <div data-testid="page-item-timeline" className="p-6">
        <ErrorState
          type="generic"
          title="Failed to load timeline"
          description={error instanceof Error ? error.message : 'Unknown error'}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  const items = data?.items ?? [];
  const dependencies = data?.dependencies ?? [];

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
    <div data-testid="page-item-timeline" className="p-6">
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
                    <rect x={0} y={y - 15} width={chartWidth} height={rowHeight} className={idx % 2 === 0 ? 'fill-transparent' : 'fill-muted/20'} />
                    <text x={8 + indent} y={y + 5} className="fill-foreground text-xs font-medium">
                      {item.title.length > 24 ? item.title.slice(0, 22) + '...' : item.title}
                    </text>
                    <rect
                      x={barX}
                      y={y - 10}
                      width={barWidth}
                      height={24}
                      rx={4}
                      className={`${colorClass} ${isDone ? 'opacity-40' : 'opacity-80'}`}
                    />
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
