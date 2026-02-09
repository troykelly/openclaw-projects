/**
 * List of items the user is watching
 * Issue #401: Implement watchers/followers on work items
 */
import * as React from 'react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { Badge } from '@/ui/components/ui/badge';
import { cn } from '@/ui/lib/utils';
import { getNotificationLevelLabel, type WatchedItem } from './types';

export interface WatchedItemsListProps {
  items: WatchedItem[];
  onItemClick: (itemId: string) => void;
  onUnwatch: (itemId: string) => void;
  filterType?: WatchedItem['type'];
  loading?: boolean;
  className?: string;
}

function getStatusVariant(status: string): 'default' | 'secondary' | 'outline' {
  switch (status.toLowerCase()) {
    case 'in_progress':
    case 'in progress':
      return 'default';
    case 'open':
    case 'todo':
      return 'secondary';
    default:
      return 'outline';
  }
}

function formatStatus(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatType(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

export function WatchedItemsList({ items, onItemClick, onUnwatch, filterType, loading = false, className }: WatchedItemsListProps) {
  const filteredItems = React.useMemo(() => {
    if (!filterType) return items;
    return items.filter((item) => item.type === filterType);
  }, [items, filterType]);

  if (loading) {
    return (
      <div data-testid="watched-items-loading" className={cn('flex justify-center py-8', className)}>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (filteredItems.length === 0) {
    return (
      <div className={cn('text-center py-8 text-muted-foreground', className)}>
        <Eye className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No watched items</p>
        <p className="text-xs mt-1">Watch items to get notified about their updates</p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-2', className)}>
      {filteredItems.map((item) => (
        <div key={item.id} className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors">
          {/* Main content - clickable */}
          <button type="button" className="flex-1 text-left min-w-0" onClick={() => onItemClick(item.id)}>
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="outline" className="text-xs">
                {formatType(item.type)}
              </Badge>
              <Badge variant={getStatusVariant(item.status)} className="text-xs">
                {formatStatus(item.status)}
              </Badge>
              {item.unreadCount > 0 && <Badge className="text-xs bg-primary">{item.unreadCount}</Badge>}
            </div>

            <h4 className="font-medium text-sm truncate">{item.title}</h4>

            <div className="text-xs text-muted-foreground mt-1">{getNotificationLevelLabel(item.notificationLevel)}</div>
          </button>

          {/* Unwatch button */}
          <Button variant="ghost" size="sm" className="shrink-0" onClick={() => onUnwatch(item.id)} aria-label="Unwatch">
            <EyeOff className="h-4 w-4" />
          </Button>
        </div>
      ))}
    </div>
  );
}
