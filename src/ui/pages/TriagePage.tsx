/**
 * Triage page — shows unparented issues that need to be organized.
 *
 * Placeholder for #2297. Will be fully implemented when Phase 2 API
 * (scope=triage) is available.
 */
import * as React from 'react';
import { useWorkItems } from '@/ui/hooks/queries/use-work-items';
import { Badge } from '@/ui/components/ui/badge';

export function TriagePage() {
  const { data, isLoading } = useWorkItems({ kind: 'issue', parent_id: 'none' });
  const items = data?.items ?? [];

  return (
    <div data-testid="triage-page" className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">Triage</h1>
        <Badge variant="secondary">{items.length} items</Badge>
      </div>
      <p className="text-muted-foreground">
        Issues without a parent project. Assign them to a project or resolve them directly.
      </p>
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <div className="size-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      )}
      {!isLoading && items.length === 0 && (
        <div className="py-12 text-center text-muted-foreground">
          <p>All caught up! No unassigned issues.</p>
        </div>
      )}
      {!isLoading && items.length > 0 && (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.id} className="flex items-center gap-3 rounded-lg border p-3">
              <span className="text-sm font-medium">{item.title}</span>
              <Badge variant="outline" className="ml-auto text-xs">{item.status}</Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
