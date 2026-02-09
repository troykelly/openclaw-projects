/**
 * Collapsible group of similar activities
 * Issue #403: Implement activity feed filtering and personalization
 */
import * as React from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { Badge } from '@/ui/components/ui/badge';
import { cn } from '@/ui/lib/utils';
import { ActivityDetailCard } from './activity-detail-card';
import type { ActivityItem } from './types';

export interface CollapsedActivityGroupProps {
  activities: ActivityItem[];
  groupLabel: string;
  collapsed: boolean;
  onToggle: () => void;
  className?: string;
}

export function CollapsedActivityGroup({ activities, groupLabel, collapsed, onToggle, className }: CollapsedActivityGroupProps) {
  return (
    <div className={cn('rounded-lg border', className)}>
      {/* Group header - always visible */}
      <button
        type="button"
        className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
        onClick={onToggle}
        aria-label={collapsed ? 'Expand activities' : 'Collapse activities'}
      >
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{activities.length}</Badge>
          <span className="text-sm font-medium">{groupLabel}</span>
        </div>
        {collapsed ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronUp className="h-4 w-4 text-muted-foreground" />}
      </button>

      {/* Expanded activities */}
      {!collapsed && (
        <div className="border-t p-3 space-y-3">
          {activities.map((activity) => (
            <ActivityDetailCard key={activity.id} activity={activity} expanded={false} />
          ))}
        </div>
      )}
    </div>
  );
}
