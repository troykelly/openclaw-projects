/**
 * Global timeline page.
 *
 * Displays a Gantt-style view of all work items with scheduled dates.
 * Supports zoom levels (day/week/month/quarter) and filtering by item
 * kind. Uses TanStack Query via the useGlobalTimeline hook for data
 * fetching with automatic refetch on filter changes.
 */
import React, { useState, useMemo } from 'react';
import { Link } from 'react-router';
import { useGlobalTimeline } from '@/ui/hooks/queries/use-timeline';
import { kindFillColors } from '@/ui/lib/work-item-utils';
import { Skeleton, ErrorState, EmptyState } from '@/ui/components/feedback';
import { Button } from '@/ui/components/ui/button';
import { Card, CardContent } from '@/ui/components/ui/card';
import { ScrollArea, ScrollBar } from '@/ui/components/ui/scroll-area';

/** Supported zoom levels for the timeline view. */
type TimelineZoomLevel = 'day' | 'week' | 'month' | 'quarter';

/** Pixels-per-day and display label for each zoom level. */
const ZOOM_CONFIGS: Record<TimelineZoomLevel, { pixelsPerDay: number; label: string }> = {
  day: { pixelsPerDay: 60, label: 'Day' },
  week: { pixelsPerDay: 12, label: 'Week' },
  month: { pixelsPerDay: 3, label: 'Month' },
  quarter: { pixelsPerDay: 1, label: 'Quarter' },
};

export function GlobalTimelinePage(): React.JSX.Element {
  const [zoom, setZoom] = useState<TimelineZoomLevel>('week');
  const [kindFilter, setKindFilter] = useState<string[]>([]);

  const { data, isLoading, error, refetch } = useGlobalTimeline(
    kindFilter.length > 0 ? kindFilter : undefined,
  );

  const handleKindToggle = (kind: string) => {
    setKindFilter((prev) =>
      prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind],
    );
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

  if (isLoading) {
    return (
      <div data-testid="page-global-timeline" className="p-6">
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

  if (error) {
    return (
      <div data-testid="page-global-timeline" className="p-6">
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

  if (items.length === 0) {
    return (
      <div data-testid="page-global-timeline" className="p-6">
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

  const statusBgColors: Record<string, string> = {
    done: 'opacity-60',
    in_progress: '',
    blocked: 'opacity-80 stroke-red-500 stroke-2',
    open: 'opacity-40',
  };

  // Generate date markers
  const markerInterval = zoom === 'day' ? dayMs : zoom === 'week' ? 7 * dayMs : zoom === 'month' ? 30 * dayMs : 90 * dayMs;
  const dateMarkers: { x: number; label: string }[] = [];
  for (let d = minDate; d <= maxDate; d += markerInterval) {
    dateMarkers.push({ x: dateToX(d), label: new Date(d).toLocaleDateString() });
  }

  return (
    <div data-testid="page-global-timeline" className="p-6 h-full flex flex-col">
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
                      className={`size-2 rounded-full ${kindFillColors[item.kind] || 'bg-gray-400'}`}
                    />
                    <Link
                      to={`/work-items/${item.id}`}
                      className="text-sm truncate hover:text-primary hover:underline"
                      title={item.title}
                    >
                      {item.title}
                    </Link>
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
                          className={`${kindFillColors[item.kind] || 'fill-gray-400'} ${statusBgColors[item.status || 'open'] || ''}`}
                        />
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
