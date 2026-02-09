/**
 * Activity widget for dashboard
 * Issue #405: Implement custom dashboard builder
 */
import * as React from 'react';
import { Activity } from 'lucide-react';
import { cn } from '@/ui/lib/utils';

export interface ActivityItem {
  id: string;
  description: string;
  timestamp: string;
}

export interface ActivityWidgetProps {
  activities: ActivityItem[];
  onActivityClick: (activityId: string) => void;
  limit?: number;
  className?: string;
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function ActivityWidget({ activities, onActivityClick, limit = 5, className }: ActivityWidgetProps) {
  if (activities.length === 0) {
    return (
      <div className={cn('flex flex-col items-center justify-center h-full text-muted-foreground', className)}>
        <Activity className="h-8 w-8 mb-2 opacity-50" />
        <p className="text-sm">No recent activity</p>
      </div>
    );
  }

  const displayActivities = activities.slice(0, limit);

  return (
    <div className={cn('space-y-2', className)}>
      {displayActivities.map((activity) => (
        <button
          key={activity.id}
          type="button"
          onClick={() => onActivityClick(activity.id)}
          className="w-full flex items-start gap-2 p-2 rounded hover:bg-muted text-left transition-colors"
        >
          <div className="h-2 w-2 rounded-full bg-primary mt-1.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm">{activity.description}</p>
            <span className="text-xs text-muted-foreground">{formatRelativeTime(activity.timestamp)}</span>
          </div>
        </button>
      ))}
    </div>
  );
}
