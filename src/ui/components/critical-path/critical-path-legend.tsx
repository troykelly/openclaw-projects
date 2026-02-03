/**
 * Legend showing critical path visualization meanings
 */
import * as React from 'react';
import { cn } from '@/ui/lib/utils';

export interface CriticalPathLegendProps {
  className?: string;
}

export function CriticalPathLegend({ className }: CriticalPathLegendProps) {
  return (
    <div className={cn('flex items-center gap-6 text-sm', className)}>
      {/* Critical Path */}
      <div className="flex items-center gap-2">
        <div className="w-8 h-3 rounded bg-destructive border-2 border-destructive" />
        <span className="text-muted-foreground">Critical Path</span>
      </div>

      {/* Slack/Float */}
      <div className="flex items-center gap-2">
        <div className="w-8 h-3 rounded bg-muted border border-dashed border-muted-foreground" />
        <span className="text-muted-foreground">Slack/Float</span>
      </div>

      {/* Non-critical */}
      <div className="flex items-center gap-2">
        <div className="w-8 h-3 rounded bg-primary/30 border border-primary/50" />
        <span className="text-muted-foreground">Non-Critical</span>
      </div>
    </div>
  );
}
