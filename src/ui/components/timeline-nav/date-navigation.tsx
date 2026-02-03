/**
 * Date navigation controls for timeline
 * Issue #393: Implement timeline zoom enhancements and navigation
 */
import * as React from 'react';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { cn } from '@/ui/lib/utils';
import { addDays, getStepDays, type ZoomLevel } from './timeline-utils';

export interface DateNavigationProps {
  currentDate: Date;
  onDateChange: (date: Date) => void;
  onJumpToToday: () => void;
  /** Zoom level to determine step size */
  zoom?: ZoomLevel;
  className?: string;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function DateNavigation({
  currentDate,
  onDateChange,
  onJumpToToday,
  zoom = 'week',
  className,
}: DateNavigationProps) {
  const stepDays = getStepDays(zoom);

  const handlePrevious = () => {
    onDateChange(addDays(currentDate, -stepDays));
  };

  const handleNext = () => {
    onDateChange(addDays(currentDate, stepDays));
  };

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {/* Navigation arrows */}
      <div className="flex items-center">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={handlePrevious}
          aria-label="Previous period"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={handleNext}
          aria-label="Next period"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Current date display */}
      <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/30">
        <CalendarDays className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">{formatDate(currentDate)}</span>
      </div>

      {/* Today button */}
      <Button
        variant="outline"
        size="sm"
        className="h-7"
        onClick={onJumpToToday}
      >
        Today
      </Button>
    </div>
  );
}
