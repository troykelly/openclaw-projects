import * as React from 'react';
import { useCallback, useMemo, useState } from 'react';
import { ZoomIn, ZoomOut, ChevronLeft, ChevronRight, Route, Target } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Button } from '@/ui/components/ui/button';
import { ScrollArea, ScrollBar } from '@/ui/components/ui/scroll-area';
import { TimelineHeader, getUnitWidth, getDaysBetween } from './timeline-header';
import { TimelineBar } from './timeline-bar';
import { TimelineRowLabel, TimelineRow } from './timeline-row';
import type { TimelineItem, TimelineZoom, TimelineDateRange } from './types';

const ZOOM_LEVELS: TimelineZoom[] = ['day', 'week', 'month', 'quarter'];
const LABEL_WIDTH = 240;
const ROW_HEIGHT = 32;

function getDateRange(items: TimelineItem[]): TimelineDateRange {
  if (items.length === 0) {
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - 7);
    const end = new Date(now);
    end.setDate(end.getDate() + 30);
    return { start, end };
  }

  let minDate = items[0].startDate;
  let maxDate = items[0].endDate;

  for (const item of items) {
    if (item.startDate < minDate) minDate = item.startDate;
    if (item.endDate > maxDate) maxDate = item.endDate;
  }

  // Add padding
  const start = new Date(minDate);
  start.setDate(start.getDate() - 7);
  const end = new Date(maxDate);
  end.setDate(end.getDate() + 14);

  return { start, end };
}

function flattenItems(
  items: TimelineItem[],
  expandedIds: Set<string>,
  parentMap: Map<string, TimelineItem[]>
): Array<{ item: TimelineItem; depth: number; hasChildren: boolean }> {
  const result: Array<{ item: TimelineItem; depth: number; hasChildren: boolean }> = [];

  function traverse(parentId: string | undefined, depth: number) {
    const children = parentId
      ? parentMap.get(parentId) || []
      : items.filter((i) => !i.parentId);

    for (const item of children) {
      const hasChildren = parentMap.has(item.id);
      result.push({ item, depth, hasChildren });

      if (hasChildren && expandedIds.has(item.id)) {
        traverse(item.id, depth + 1);
      }
    }
  }

  traverse(undefined, 0);
  return result;
}

function buildParentMap(items: TimelineItem[]): Map<string, TimelineItem[]> {
  const map = new Map<string, TimelineItem[]>();
  for (const item of items) {
    if (item.parentId) {
      const existing = map.get(item.parentId) || [];
      existing.push(item);
      map.set(item.parentId, existing);
    }
  }
  return map;
}

export interface GanttChartProps {
  items: TimelineItem[];
  onItemClick?: (item: TimelineItem) => void;
  onDateChange?: (item: TimelineItem, startDate: Date, endDate: Date) => void;
  initialZoom?: TimelineZoom;
  showCriticalPath?: boolean;
  showDependencies?: boolean;
  className?: string;
}

export function GanttChart({
  items,
  onItemClick,
  onDateChange,
  initialZoom = 'week',
  showCriticalPath: initialShowCriticalPath = false,
  showDependencies: initialShowDependencies = false,
  className,
}: GanttChartProps) {
  const [zoom, setZoom] = useState<TimelineZoom>(initialZoom);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [showCriticalPath, setShowCriticalPath] = useState(initialShowCriticalPath);
  const [showDependencies, setShowDependencies] = useState(initialShowDependencies);

  const dateRange = useMemo(() => getDateRange(items), [items]);
  const parentMap = useMemo(() => buildParentMap(items), [items]);
  const flatItems = useMemo(
    () => flattenItems(items, expandedIds, parentMap),
    [items, expandedIds, parentMap]
  );

  const unitWidth = getUnitWidth(zoom);
  const totalDays = getDaysBetween(dateRange.start, dateRange.end);
  const totalWidth = Math.ceil(totalDays * (unitWidth / (zoom === 'day' ? 1 : zoom === 'week' ? 7 : zoom === 'month' ? 30 : 90)));

  const today = new Date();
  const todayOffset = getDaysBetween(dateRange.start, today);
  const todayPosition = todayOffset >= 0 ? todayOffset * (unitWidth / (zoom === 'day' ? 1 : zoom === 'week' ? 7 : zoom === 'month' ? 30 : 90)) : -1;

  const handleToggle = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleZoomIn = useCallback(() => {
    const idx = ZOOM_LEVELS.indexOf(zoom);
    if (idx > 0) setZoom(ZOOM_LEVELS[idx - 1]);
  }, [zoom]);

  const handleZoomOut = useCallback(() => {
    const idx = ZOOM_LEVELS.indexOf(zoom);
    if (idx < ZOOM_LEVELS.length - 1) setZoom(ZOOM_LEVELS[idx + 1]);
  }, [zoom]);

  const getBarPosition = useCallback(
    (item: TimelineItem) => {
      const startOffset = getDaysBetween(dateRange.start, item.startDate);
      const duration = getDaysBetween(item.startDate, item.endDate);
      const pixelsPerDay = unitWidth / (zoom === 'day' ? 1 : zoom === 'week' ? 7 : zoom === 'month' ? 30 : 90);

      return {
        left: startOffset * pixelsPerDay,
        width: Math.max(duration * pixelsPerDay, 4),
      };
    },
    [dateRange, zoom, unitWidth]
  );

  const isOverdue = useCallback((item: TimelineItem) => {
    return item.status !== 'done' && item.endDate < today;
  }, []);

  return (
    <div className={cn('flex h-full flex-col', className)}>
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleZoomIn} disabled={zoom === 'day'}>
            <ZoomIn className="mr-1 size-4" />
            Zoom In
          </Button>
          <Button variant="outline" size="sm" onClick={handleZoomOut} disabled={zoom === 'quarter'}>
            <ZoomOut className="mr-1 size-4" />
            Zoom Out
          </Button>
          <span className="ml-2 text-sm text-muted-foreground">
            {zoom.charAt(0).toUpperCase() + zoom.slice(1)} view
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant={showDependencies ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => setShowDependencies(!showDependencies)}
          >
            <Route className="mr-1 size-4" />
            Dependencies
          </Button>
          <Button
            variant={showCriticalPath ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => setShowCriticalPath(!showCriticalPath)}
          >
            <Target className="mr-1 size-4" />
            Critical Path
          </Button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sticky labels column */}
        <div className="shrink-0 border-r" style={{ width: `${LABEL_WIDTH}px` }}>
          <div className="h-8 border-b bg-muted/30" /> {/* Header spacer */}
          <div className="overflow-hidden">
            {flatItems.map(({ item, depth, hasChildren }) => (
              <TimelineRowLabel
                key={item.id}
                item={item}
                depth={depth}
                isExpanded={expandedIds.has(item.id)}
                hasChildren={hasChildren}
                onToggle={handleToggle}
                onClick={onItemClick}
              />
            ))}
          </div>
        </div>

        {/* Scrollable timeline area */}
        <ScrollArea className="flex-1">
          <div style={{ width: `${totalWidth}px`, minWidth: '100%' }}>
            <TimelineHeader
              dateRange={dateRange}
              zoom={zoom}
              todayPosition={todayPosition}
            />

            {/* Rows */}
            <div>
              {flatItems.map(({ item }) => {
                const pos = getBarPosition(item);
                return (
                  <TimelineRow key={item.id} item={item} totalWidth={totalWidth}>
                    <TimelineBar
                      item={item}
                      left={pos.left}
                      width={pos.width}
                      isOverdue={isOverdue(item)}
                      isCriticalPath={showCriticalPath && item.isCriticalPath}
                      onClick={onItemClick}
                    />
                  </TimelineRow>
                );
              })}
            </div>

            {/* Dependency arrows (simplified - full implementation would use SVG paths) */}
            {showDependencies && (
              <svg
                className="pointer-events-none absolute inset-0"
                style={{ width: `${totalWidth}px`, height: `${flatItems.length * ROW_HEIGHT + 32}px` }}
              >
                {/* Dependency arrows would be rendered here */}
              </svg>
            )}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </div>

      {/* Empty state */}
      {items.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/50">
          <p className="text-muted-foreground">No items to display on timeline</p>
        </div>
      )}
    </div>
  );
}
