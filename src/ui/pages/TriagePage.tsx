/**
 * Triage page — shows unparented issues that need to be organized.
 *
 * #2297: Quick add, bulk select, status badges, move-to-project.
 */
import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client';
import { useWorkItems, workItemKeys } from '@/ui/hooks/queries/use-work-items';
import { Badge } from '@/ui/components/ui/badge';
import { Checkbox } from '@/ui/components/ui/checkbox';
import { toast } from 'sonner';

/** Format status string for display (e.g. "not_started" → "Not Started"). */
function formatStatus(status: string): string {
  return status
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function TriagePage() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useWorkItems({ scope: 'triage' });
  const items = data?.items ?? [];

  const [quickAddValue, setQuickAddValue] = React.useState('');
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  const handleQuickAdd = async () => {
    const title = quickAddValue.trim();
    if (!title) return;

    try {
      await apiClient.post('/work-items', { title, kind: 'issue' });
      setQuickAddValue('');
      queryClient.invalidateQueries({ queryKey: workItemKeys.all });
      toast.success('Issue created');
    } catch {
      toast.error('Failed to create issue');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleQuickAdd();
    }
  };

  const toggleItem = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div data-testid="triage-page" className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">Triage</h1>
        <Badge variant="secondary">{items.length} items</Badge>
      </div>
      <p className="text-muted-foreground">
        Issues without a parent project. Assign them to a project or resolve them directly.
      </p>

      {/* Quick add */}
      <input
        type="text"
        className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        placeholder="Quick add new issue..."
        value={quickAddValue}
        onChange={(e) => setQuickAddValue(e.target.value)}
        onKeyDown={handleKeyDown}
      />

      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <div className="size-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      )}
      {!isLoading && isError && (
        <div className="py-12 text-center text-destructive">
          <p>Failed to load triage items. Please try again.</p>
        </div>
      )}
      {!isLoading && !isError && items.length === 0 && (
        <div className="py-12 text-center text-muted-foreground">
          <p>All caught up! No items in triage.</p>
        </div>
      )}
      {!isLoading && !isError && items.length > 0 && (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.id} className="flex items-center gap-3 rounded-lg border p-3">
              <Checkbox
                checked={selected.has(item.id)}
                onCheckedChange={() => toggleItem(item.id)}
                aria-label={`Select ${item.title}`}
              />
              <span className="text-sm font-medium">{item.title}</span>
              <Badge variant="outline" className="ml-auto text-xs">
                {formatStatus(item.status)}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
