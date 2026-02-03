/**
 * Upcoming Due widget for dashboard
 * Issue #405: Implement custom dashboard builder
 */
import * as React from 'react';
import { Calendar, AlertCircle } from 'lucide-react';
import { Badge } from '@/ui/components/ui/badge';
import { cn } from '@/ui/lib/utils';

export interface DueItem {
  id: string;
  title: string;
  dueDate: string;
}

export interface UpcomingDueWidgetProps {
  items: DueItem[];
  onItemClick: (itemId: string) => void;
  groupByUrgency?: boolean;
  limit?: number;
  className?: string;
}

function isOverdue(dueDate: string): boolean {
  return new Date(dueDate) < new Date();
}

function formatDueDate(dueDate: string): string {
  const date = new Date(dueDate);
  const now = new Date();
  const diffDays = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return `${Math.abs(diffDays)} days overdue`;
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays < 7) return `In ${diffDays} days`;
  return date.toLocaleDateString();
}

export function UpcomingDueWidget({
  items,
  onItemClick,
  groupByUrgency = false,
  limit = 5,
  className,
}: UpcomingDueWidgetProps) {
  if (items.length === 0) {
    return (
      <div className={cn('flex flex-col items-center justify-center h-full text-muted-foreground', className)}>
        <Calendar className="h-8 w-8 mb-2 opacity-50" />
        <p className="text-sm">No upcoming due dates</p>
      </div>
    );
  }

  // Sort by due date
  const sortedItems = [...items].sort(
    (a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
  );

  if (groupByUrgency) {
    const overdueItems = sortedItems.filter((item) => isOverdue(item.dueDate));
    const upcomingItems = sortedItems.filter((item) => !isOverdue(item.dueDate));

    return (
      <div className={cn('space-y-4', className)}>
        {overdueItems.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 text-xs text-red-500 font-medium mb-2">
              <AlertCircle className="h-3.5 w-3.5" />
              <span>Overdue</span>
            </div>
            <div className="space-y-2">
              {overdueItems.slice(0, limit).map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  onClick={() => onItemClick(item.id)}
                />
              ))}
            </div>
          </div>
        )}

        {upcomingItems.length > 0 && (
          <div>
            <div className="text-xs text-muted-foreground font-medium mb-2">
              Upcoming
            </div>
            <div className="space-y-2">
              {upcomingItems.slice(0, limit).map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  onClick={() => onItemClick(item.id)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={cn('space-y-2', className)}>
      {sortedItems.slice(0, limit).map((item) => (
        <ItemRow
          key={item.id}
          item={item}
          onClick={() => onItemClick(item.id)}
        />
      ))}
    </div>
  );
}

function ItemRow({
  item,
  onClick,
}: {
  item: DueItem;
  onClick: () => void;
}) {
  const overdue = isOverdue(item.dueDate);

  return (
    <button
      type="button"
      data-testid={overdue ? `overdue-${item.id}` : undefined}
      onClick={onClick}
      className={cn(
        'w-full flex items-center justify-between gap-2 p-2 rounded hover:bg-muted text-left transition-colors',
        overdue && 'text-red-600'
      )}
    >
      <span className="text-sm truncate">{item.title}</span>
      <Badge variant={overdue ? 'destructive' : 'outline'} className="text-xs shrink-0">
        {formatDueDate(item.dueDate)}
      </Badge>
    </button>
  );
}
