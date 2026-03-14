import * as React from 'react';
import { Plus, RefreshCw, ArrowRightLeft, Trash2 } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { formatDateTime } from '@/ui/lib/date-format';
import type { MemoryLifecycleEvent } from './types';

export interface LifecycleTimelineProps {
  events: MemoryLifecycleEvent[];
  className?: string;
}

const eventConfig: Record<MemoryLifecycleEvent['type'], { icon: React.ElementType; label: string }> = {
  created: { icon: Plus, label: 'Created' },
  updated: { icon: RefreshCw, label: 'Updated' },
  superseded: { icon: ArrowRightLeft, label: 'Superseded' },
  reaped: { icon: Trash2, label: 'Reaped' },
};

export function LifecycleTimeline({ events, className }: LifecycleTimelineProps) {
  if (events.length === 0) return null;

  const sorted = [...events].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  return (
    <div className={cn('space-y-2', className)}>
      <h4 className="text-sm font-medium">Lifecycle History</h4>
      <div className="space-y-3" role="list" aria-label="Lifecycle events">
        {sorted.map((event, i) => {
          const config = eventConfig[event.type];
          const Icon = config.icon;

          return (
            <div
              key={`${event.type}-${i}`}
              role="listitem"
              className="flex items-start gap-3 text-sm"
            >
              <div className="mt-0.5 rounded-full border p-1 text-muted-foreground">
                <Icon className="size-3" />
              </div>
              <div className="flex-1">
                <div className="font-medium">{config.label}</div>
                <div className="text-xs text-muted-foreground">
                  {formatDateTime(event.timestamp)}
                  {event.actor && (
                    <span> by <span className="font-medium">{event.actor}</span></span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
