/**
 * List of watchers for a work item
 * Issue #401: Implement watchers/followers on work items
 */
import * as React from 'react';
import { Eye, UserPlus, X } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { cn } from '@/ui/lib/utils';
import { getInitials, getNotificationLevelLabel, type Watcher } from './types';

export interface WatcherListProps {
  watchers: Watcher[];
  currentUserId: string;
  isOwner?: boolean;
  onRemove?: (watcherId: string) => void;
  onAddWatcher?: () => void;
  className?: string;
}

export function WatcherList({ watchers, currentUserId, isOwner = false, onRemove, onAddWatcher, className }: WatcherListProps) {
  if (watchers.length === 0) {
    return (
      <div className={cn('text-sm text-muted-foreground py-4 text-center', className)}>
        <Eye className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p>No watchers yet</p>
        {isOwner && onAddWatcher && (
          <Button variant="outline" size="sm" className="mt-2" onClick={onAddWatcher}>
            <UserPlus className="h-4 w-4 mr-1" />
            Add watcher
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {watchers.length} {watchers.length === 1 ? 'watcher' : 'watchers'}
        </span>
        {isOwner && onAddWatcher && (
          <Button variant="ghost" size="sm" onClick={onAddWatcher} aria-label="Add watcher">
            <UserPlus className="h-4 w-4 mr-1" />
            Add watcher
          </Button>
        )}
      </div>

      {/* Watcher list */}
      <div className="space-y-2">
        {watchers.map((watcher) => {
          const canRemove = isOwner || watcher.userId === currentUserId;

          return (
            <div key={watcher.id} className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50">
              {/* Avatar */}
              {watcher.avatar ? (
                <img src={watcher.avatar} alt={watcher.name} className="h-8 w-8 rounded-full object-cover" />
              ) : (
                <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs font-medium">{getInitials(watcher.name)}</div>
              )}

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">{watcher.name}</div>
                <div className="text-xs text-muted-foreground">{getNotificationLevelLabel(watcher.notificationLevel)}</div>
              </div>

              {/* Remove button */}
              {canRemove && onRemove && (
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onRemove(watcher.id)} aria-label="Remove watcher">
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
