/**
 * Zoom controls for timeline
 * Issue #393: Implement timeline zoom enhancements and navigation
 */
import * as React from 'react';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { cn } from '@/ui/lib/utils';
import { formatZoomLevel, ZOOM_LEVELS, type ZoomLevel } from './timeline-utils';

export interface ZoomControlsProps {
  currentZoom: ZoomLevel;
  onZoomChange: (level: ZoomLevel) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitAll: () => void;
  /** Which zoom levels to show as buttons */
  visibleLevels?: ZoomLevel[];
  className?: string;
}

const DEFAULT_VISIBLE_LEVELS: ZoomLevel[] = ['day', 'week', 'month', 'quarter'];

export function ZoomControls({
  currentZoom,
  onZoomChange,
  onZoomIn,
  onZoomOut,
  onFitAll,
  visibleLevels = DEFAULT_VISIBLE_LEVELS,
  className,
}: ZoomControlsProps) {
  const canZoomIn = ZOOM_LEVELS.indexOf(currentZoom) > 0;
  const canZoomOut = ZOOM_LEVELS.indexOf(currentZoom) < ZOOM_LEVELS.length - 1;

  return (
    <div className={cn('flex items-center gap-1', className)}>
      {/* Zoom level buttons */}
      <div className="flex items-center rounded-md border bg-muted/30 p-0.5">
        {visibleLevels.map((level) => (
          <Button
            key={level}
            variant="ghost"
            size="sm"
            data-active={currentZoom === level}
            className={cn('h-7 px-2 text-xs', currentZoom === level && 'bg-background shadow-sm')}
            onClick={() => onZoomChange(level)}
          >
            {formatZoomLevel(level)}
          </Button>
        ))}
      </div>

      <div className="w-px h-6 bg-border mx-1" />

      {/* Zoom in/out buttons */}
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onZoomIn} disabled={!canZoomIn} aria-label="Zoom in">
        <ZoomIn className="h-4 w-4" />
      </Button>

      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onZoomOut} disabled={!canZoomOut} aria-label="Zoom out">
        <ZoomOut className="h-4 w-4" />
      </Button>

      <div className="w-px h-6 bg-border mx-1" />

      {/* Fit all button */}
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onFitAll} aria-label="Fit all">
        <Maximize2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
