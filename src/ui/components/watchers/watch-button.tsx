/**
 * Watch/unwatch button for work items
 * Issue #401: Implement watchers/followers on work items
 */
import * as React from 'react';
import { Eye, Loader2 } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { cn } from '@/ui/lib/utils';

export interface WatchButtonProps {
  isWatching: boolean;
  onToggle: () => void;
  watcherCount?: number;
  loading?: boolean;
  compact?: boolean;
  className?: string;
}

export function WatchButton({ isWatching, onToggle, watcherCount, loading = false, compact = false, className }: WatchButtonProps) {
  return (
    <Button
      variant={isWatching ? 'secondary' : 'outline'}
      size={compact ? 'icon' : 'sm'}
      onClick={onToggle}
      disabled={loading}
      className={cn('gap-1.5', className)}
    >
      {loading ? (
        <Loader2 data-testid="watch-loading" className="h-4 w-4 animate-spin" />
      ) : (
        <Eye data-testid="watch-icon" className={cn('h-4 w-4', isWatching && 'fill-current')} />
      )}

      {!compact && <span>{isWatching ? 'Watching' : 'Watch'}</span>}

      {watcherCount !== undefined && watcherCount > 0 && <span className="ml-1 text-xs bg-muted px-1.5 py-0.5 rounded">{watcherCount}</span>}
    </Button>
  );
}
