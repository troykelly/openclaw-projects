/**
 * List of baseline snapshots with selection and management
 * Issue #391: Implement baseline snapshots for progress tracking
 */
import * as React from 'react';
import { Calendar, Trash2, GitCompare } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { Checkbox } from '@/ui/components/ui/checkbox';
import { ScrollArea } from '@/ui/components/ui/scroll-area';
import { cn } from '@/ui/lib/utils';
import type { BaselineSnapshot } from './baseline-utils';

export interface BaselineListProps {
  baselines: BaselineSnapshot[];
  onSelect?: (baselineId: string) => void;
  onDelete?: (baselineId: string) => void;
  onCompare?: (baselineId1: string, baselineId2: string) => void;
  selectable?: boolean;
  className?: string;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function BaselineList({ baselines, onSelect, onDelete, onCompare, selectable = false, className }: BaselineListProps) {
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());

  const handleSelectToggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        // Only allow selecting 2 for comparison
        if (next.size >= 2) {
          // Remove the first selected item
          const [first] = next;
          next.delete(first);
        }
        next.add(id);
      }
      return next;
    });
  };

  const handleCompare = () => {
    if (selectedIds.size === 2 && onCompare) {
      const [id1, id2] = Array.from(selectedIds);
      onCompare(id1, id2);
    }
  };

  if (baselines.length === 0) {
    return (
      <div className={cn('text-center py-8', className)}>
        <Calendar className="h-12 w-12 mx-auto text-muted-foreground opacity-50" />
        <p className="mt-4 text-muted-foreground">No baselines created yet.</p>
        <p className="text-sm text-muted-foreground mt-1">Create a baseline to track progress over time.</p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      {selectable && selectedIds.size === 2 && (
        <div className="flex justify-end">
          <Button onClick={handleCompare} size="sm">
            <GitCompare className="mr-2 h-4 w-4" />
            Compare Selected
          </Button>
        </div>
      )}

      <ScrollArea className="h-[300px]">
        <div className="space-y-2 pr-4">
          {baselines.map((baseline) => (
            <div
              key={baseline.id}
              className={cn(
                'flex items-center gap-3 p-3 rounded-lg border transition-colors',
                'hover:bg-muted/50',
                selectedIds.has(baseline.id) && 'border-primary bg-primary/5',
              )}
            >
              {selectable && (
                <Checkbox
                  checked={selectedIds.has(baseline.id)}
                  onCheckedChange={() => handleSelectToggle(baseline.id)}
                  aria-label={`Select ${baseline.name}`}
                />
              )}

              <button className="flex-1 text-left" onClick={() => onSelect?.(baseline.id)}>
                <div className="font-medium">{baseline.name}</div>
                {baseline.description && <div className="text-sm text-muted-foreground mt-0.5 line-clamp-1">{baseline.description}</div>}
                <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground">
                  <Calendar className="h-3 w-3" />
                  <span>{formatDate(baseline.created_at)}</span>
                  <span className="text-muted-foreground/50">|</span>
                  <span>{baseline.items.length} items</span>
                </div>
              </button>

              {onDelete && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => onDelete(baseline.id)}
                  aria-label={`Delete ${baseline.name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
