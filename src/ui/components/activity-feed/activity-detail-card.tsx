/**
 * Expandable activity detail card
 * Issue #403: Implement activity feed filtering and personalization
 */
import * as React from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { Badge } from '@/ui/components/ui/badge';
import { cn } from '@/ui/lib/utils';
import type { ActivityItem } from './types';

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return 'just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  return date.toLocaleDateString();
}

export interface ActivityDetailCardProps {
  activity: ActivityItem;
  expanded?: boolean;
  onToggle?: () => void;
  className?: string;
}

function getInitials(name: string): string {
  const parts = name.split(' ').filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function getActionLabel(action: string): string {
  return action.replace(/_/g, ' ');
}

function getEntityUrl(entityType: string, entityId: string): string {
  return `/${entityType}s/${entityId}`;
}

export function ActivityDetailCard({ activity, expanded = false, onToggle, className }: ActivityDetailCardProps) {
  const hasChanges = activity.changes && activity.changes.length > 0;
  const showToggle = onToggle && hasChanges;

  return (
    <div className={cn('rounded-lg border p-3', className)}>
      {/* Header row */}
      <div className="flex items-start gap-3">
        {/* Actor avatar */}
        {activity.actorAvatar ? (
          <img src={activity.actorAvatar} alt={activity.actorName} className="h-8 w-8 rounded-full object-cover shrink-0" />
        ) : (
          <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs font-medium shrink-0">{getInitials(activity.actorName)}</div>
        )}

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Summary line */}
          <div className="flex items-center gap-1.5 flex-wrap text-sm">
            <span className="font-medium">{activity.actorName}</span>
            <span className="text-muted-foreground">{getActionLabel(activity.action)}</span>
            <a href={getEntityUrl(activity.entityType, activity.entityId)} className="font-medium text-primary hover:underline truncate">
              {activity.entityTitle}
            </a>
          </div>

          {/* Entity type badge and timestamp */}
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="outline" className="text-xs">
              {activity.entityType}
            </Badge>
            <span data-testid="activity-timestamp" className="text-xs text-muted-foreground">
              {formatRelativeTime(activity.timestamp)}
            </span>
          </div>
        </div>

        {/* Toggle button */}
        {showToggle && (
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onToggle} aria-label={expanded ? 'Collapse details' : 'Show details'}>
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        )}
      </div>

      {/* Expanded changes */}
      {expanded && hasChanges && (
        <div className="mt-3 pt-3 border-t space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground uppercase">Changes</h4>
          {activity.changes!.map((change, index) => (
            <div key={index} className="flex items-center gap-2 text-sm bg-muted/50 rounded px-2 py-1">
              <span className="font-medium capitalize">{change.field}</span>
              <span className="text-muted-foreground">:</span>
              {change.from && (
                <>
                  <span className="text-red-600 line-through">{change.from}</span>
                  <span className="text-muted-foreground">→</span>
                </>
              )}
              <span className="text-green-600">{change.to || '(empty)'}</span>
            </div>
          ))}
        </div>
      )}

      {/* Comment if present */}
      {activity.comment && (
        <div className="mt-3 pt-3 border-t">
          <p className="text-sm text-muted-foreground">{activity.comment}</p>
        </div>
      )}
    </div>
  );
}
