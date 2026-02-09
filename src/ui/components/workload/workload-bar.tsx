/**
 * Visual bar showing workload segments
 * Issue #392: Implement resource allocation and workload view
 */
import * as React from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui/components/ui/tooltip';
import { cn } from '@/ui/lib/utils';
import { formatHours } from './workload-utils';

export interface WorkloadSegment {
  id: string;
  title: string;
  hours: number;
  color?: string;
}

export interface WorkloadBarProps {
  assignedHours: number;
  capacityHours: number;
  segments: WorkloadSegment[];
  className?: string;
}

const DEFAULT_COLORS = [
  '#4f46e5', // indigo
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#06b6d4', // cyan
  '#ec4899', // pink
  '#14b8a6', // teal
];

export function WorkloadBar({ assignedHours, capacityHours, segments, className }: WorkloadBarProps) {
  const isOverallocated = assignedHours > capacityHours;
  const [hoveredSegment, setHoveredSegment] = React.useState<string | null>(null);

  // Calculate segment widths as percentage of capacity
  const maxWidth = Math.max(assignedHours, capacityHours);
  const capacityLinePosition = (capacityHours / maxWidth) * 100;

  return (
    <TooltipProvider>
      <div data-testid="workload-bar" data-overallocated={isOverallocated} className={cn('relative h-8 rounded-md bg-muted overflow-hidden', className)}>
        {/* Segments */}
        <div className="absolute inset-0 flex">
          {segments.map((segment, index) => {
            const widthPercent = (segment.hours / maxWidth) * 100;
            const color = segment.color || DEFAULT_COLORS[index % DEFAULT_COLORS.length];

            return (
              <Tooltip key={segment.id}>
                <TooltipTrigger asChild>
                  <div
                    data-testid="workload-segment"
                    className={cn('h-full transition-opacity cursor-pointer', hoveredSegment && hoveredSegment !== segment.id && 'opacity-50')}
                    style={{
                      width: `${widthPercent}%`,
                      backgroundColor: color,
                    }}
                    onMouseEnter={() => setHoveredSegment(segment.id)}
                    onMouseLeave={() => setHoveredSegment(null)}
                  />
                </TooltipTrigger>
                <TooltipContent>
                  <div className="text-sm">
                    <div className="font-medium">{segment.title}</div>
                    <div className="text-muted-foreground">{formatHours(segment.hours)}</div>
                  </div>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        {/* Capacity line */}
        <div
          data-testid="capacity-line"
          className={cn('absolute top-0 bottom-0 w-0.5 bg-foreground/50', isOverallocated && 'bg-destructive')}
          style={{ left: `${capacityLinePosition}%` }}
        />

        {/* Over-allocation indicator */}
        {isOverallocated && (
          <div className="absolute top-0 bottom-0 right-0 bg-destructive/20" style={{ width: `${((assignedHours - capacityHours) / maxWidth) * 100}%` }} />
        )}
      </div>
    </TooltipProvider>
  );
}
