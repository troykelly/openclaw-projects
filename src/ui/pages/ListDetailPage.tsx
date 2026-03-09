/**
 * List detail page — displays a todo-based list work item.
 *
 * Placeholder for #2298. Will be fully implemented when Phase 2 API
 * (enhanced todo endpoints) is available.
 */
import * as React from 'react';
import { useParams } from 'react-router';
import { useWorkItem } from '@/ui/hooks/queries/use-work-items';

export function ListDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useWorkItem(id ?? '');

  if (isLoading) {
    return (
      <div data-testid="list-detail-page" className="flex items-center justify-center py-12">
        <div className="size-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!data) {
    return (
      <div data-testid="list-detail-page" className="py-12 text-center text-muted-foreground">
        <p>List not found.</p>
      </div>
    );
  }

  return (
    <div data-testid="list-detail-page" className="space-y-4">
      <h1 className="text-2xl font-bold">{data.title}</h1>
      {data.description && (
        <p className="text-muted-foreground">{data.description}</p>
      )}
      <div className="rounded-lg border p-4 text-center text-muted-foreground">
        <p>Todo list view coming soon.</p>
      </div>
    </div>
  );
}
