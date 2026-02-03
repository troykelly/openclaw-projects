/**
 * Today indicator line for timeline
 * Issue #393: Implement timeline zoom enhancements and navigation
 */
import * as React from 'react';
import { cn } from '@/ui/lib/utils';

export interface TodayIndicatorProps {
  /** Position as percentage (0-100) */
  position: number;
  /** Whether the indicator should be visible */
  visible?: boolean;
  /** Whether to show "Today" label */
  showLabel?: boolean;
  /** Height of the indicator line */
  height?: string;
  className?: string;
}

export function TodayIndicator({
  position,
  visible = true,
  showLabel = false,
  height = '100%',
  className,
}: TodayIndicatorProps) {
  if (!visible) {
    return null;
  }

  return (
    <div
      data-testid="today-indicator"
      className={cn(
        'absolute top-0 z-10 pointer-events-none',
        className
      )}
      style={{
        left: `${position}%`,
        height,
      }}
    >
      {/* Main line */}
      <div className="w-0.5 h-full bg-primary" />

      {/* Label */}
      {showLabel && (
        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-full pb-1">
          <span className="px-1.5 py-0.5 text-xs font-medium bg-primary text-primary-foreground rounded">
            Today
          </span>
        </div>
      )}

      {/* Arrow at top */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2">
        <div className="w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[6px] border-t-primary" />
      </div>
    </div>
  );
}
