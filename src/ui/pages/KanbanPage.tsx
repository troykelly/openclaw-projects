/**
 * Kanban board page.
 *
 * Displays work items in a drag-and-drop column layout grouped by status.
 * Supports priority and kind filtering, inline title editing, and
 * optimistic status updates via drag-and-drop.
 */
import React, { useState, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useBacklog, backlogKeys } from '@/ui/hooks/queries/use-backlog';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client';
import type { BacklogItem } from '@/ui/lib/api-types';
import { ErrorState } from '@/ui/components/feedback';
import { Button } from '@/ui/components/ui/button';
import { InlineEditableText } from '@/ui/components/inline-edit';
import { List, Clock, AlertCircle, CheckCircle2, Circle } from 'lucide-react';

const statuses = ['open', 'blocked', 'closed'];
const statusConfig: Record<string, { label: string; bgColor: string }> = {
  open: { label: 'To Do', bgColor: 'from-blue-500/5 to-blue-500/0' },
  blocked: { label: 'Blocked', bgColor: 'from-amber-500/5 to-amber-500/0' },
  closed: { label: 'Done', bgColor: 'from-emerald-500/5 to-emerald-500/0' },
};
const priorityConfig: Record<string, { color: string; bg: string }> = {
  P0: { color: '#ef4444', bg: 'bg-red-500/10 text-red-400 border-red-500/20' },
  P1: { color: '#f97316', bg: 'bg-orange-500/10 text-orange-400 border-orange-500/20' },
  P2: { color: '#eab308', bg: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' },
  P3: { color: '#22c55e', bg: 'bg-green-500/10 text-green-400 border-green-500/20' },
  P4: { color: '#6b7280', bg: 'bg-gray-500/10 text-gray-400 border-gray-500/20' },
};
const kindLabels: Record<string, { label: string; color: string }> = {
  project: { label: 'P', color: 'bg-blue-500' },
  initiative: { label: 'I', color: 'bg-violet-500' },
  epic: { label: 'E', color: 'bg-emerald-500' },
  issue: { label: 'T', color: 'bg-gray-500' },
};

export function KanbanPage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const [filters, setFilters] = useState({
    priority: searchParams.getAll('priority'),
    kind: searchParams.getAll('kind'),
  });

  const { data, isLoading, error, refetch } = useBacklog({
    priority: filters.priority.length > 0 ? filters.priority : undefined,
    kind: filters.kind.length > 0 ? filters.kind : undefined,
  });

  const [items, setItems] = useState<BacklogItem[]>([]);
  const [draggedItem, setDraggedItem] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);

  // Sync fetched data to local state for optimistic updates
  React.useEffect(() => {
    if (data?.items) setItems(data.items);
  }, [data]);

  const updateFilters = useCallback(
    (newFilters: typeof filters) => {
      setFilters(newFilters);
      const params = new URLSearchParams();
      newFilters.priority.forEach((p) => params.append('priority', p));
      newFilters.kind.forEach((k) => params.append('kind', k));
      setSearchParams(params);
    },
    [setSearchParams],
  );

  const toggleFilter = (type: 'priority' | 'kind', value: string) => {
    const current = filters[type];
    const updated = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    updateFilters({ ...filters, [type]: updated });
  };

  const handleDragStart = (e: React.DragEvent, itemId: string) => {
    setDraggedItem(itemId);
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleDragOver = (e: React.DragEvent, status: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverColumn(status);
  };
  const handleDragLeave = () => setDragOverColumn(null);

  const handleDrop = async (e: React.DragEvent, newStatus: string) => {
    e.preventDefault();
    setDragOverColumn(null);
    if (!draggedItem) return;
    const item = items.find((i) => i.id === draggedItem);
    if (!item || item.status === newStatus) {
      setDraggedItem(null);
      return;
    }
    // Optimistic update
    setItems((prev) => prev.map((i) => (i.id === draggedItem ? { ...i, status: newStatus } : i)));
    try {
      await apiClient.patch(`/api/work-items/${draggedItem}/status`, { status: newStatus });
    } catch {
      setItems((prev) => prev.map((i) => (i.id === draggedItem ? { ...i, status: item.status } : i)));
    }
    setDraggedItem(null);
  };

  const handleTitleChange = async (id: string, newTitle: string) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, title: newTitle } : i)));
    try {
      await apiClient.patch(`/api/work-items/${id}`, { title: newTitle });
    } catch {
      refetch();
    }
  };

  return (
    <div data-testid="page-kanban" className="h-full flex flex-col bg-gradient-to-br from-background to-muted/20">
      <div className="px-6 pt-6 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Kanban Board</h1>
            <p className="text-sm text-muted-foreground mt-1">Drag cards to update status</p>
          </div>
          <Button variant="outline" size="sm" asChild className="border-border/50">
            <Link to="/work-items">
              <List className="mr-2 size-4" />
              List View
            </Link>
          </Button>
        </div>
        {/* Filters */}
        <div className="mt-4 flex flex-wrap gap-3 items-center">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Priority</span>
            <div className="flex gap-1">
              {['P0', 'P1', 'P2', 'P3', 'P4'].map((p) => (
                <button
                  key={p}
                  onClick={() => toggleFilter('priority', p)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
                    filters.priority.includes(p) ? priorityConfig[p].bg + ' border' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div className="h-4 w-px bg-border/50" />
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Type</span>
            <div className="flex gap-1">
              {(['project', 'initiative', 'epic', 'issue'] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => toggleFilter('kind', k)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all flex items-center gap-1.5 ${
                    filters.kind.includes(k)
                      ? 'bg-primary/10 text-primary border border-primary/20'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`}
                >
                  <span className={`size-2 rounded-sm ${kindLabels[k].color}`} />
                  {k.charAt(0).toUpperCase() + k.slice(1)}
                </button>
              ))}
            </div>
          </div>
          {(filters.priority.length > 0 || filters.kind.length > 0) && (
            <>
              <div className="h-4 w-px bg-border/50" />
              <button
                onClick={() => updateFilters({ priority: [], kind: [] })}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear all
              </button>
            </>
          )}
        </div>
      </div>

      {isLoading && (
        <div className="flex gap-4 flex-1 px-6 pb-6">
          {statuses.map((s) => (
            <div key={s} className="flex-1 rounded-xl bg-muted/30 animate-pulse min-h-[400px]" />
          ))}
        </div>
      )}
      {error && (
        <div className="px-6">
          <ErrorState
            type="generic"
            title="Failed to load board"
            description={error instanceof Error ? error.message : 'Unknown error'}
            onRetry={() => refetch()}
          />
        </div>
      )}
      {!isLoading && !error && (
        <div className="flex gap-4 flex-1 overflow-x-auto px-6 pb-6">
          {statuses.map((status) => {
            const columnItems = items.filter((i) => i.status === status);
            const config = statusConfig[status];
            const isOver = dragOverColumn === status;
            return (
              <div
                key={status}
                className={`flex-1 min-w-[300px] max-w-[380px] flex flex-col rounded-xl transition-all duration-200 ${isOver ? 'ring-2 ring-primary/50 ring-offset-2 ring-offset-background' : ''}`}
                onDragOver={(e) => handleDragOver(e, status)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, status)}
              >
                <div className={`px-4 py-3 rounded-t-xl bg-gradient-to-b ${config.bgColor} border-b border-border/30`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`size-2 rounded-full ${status === 'open' ? 'bg-blue-400' : status === 'blocked' ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                      <h3 className="font-semibold text-sm">{config.label}</h3>
                    </div>
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{columnItems.length}</span>
                  </div>
                </div>
                <div className="flex-1 p-2 space-y-2 overflow-y-auto bg-muted/20 rounded-b-xl">
                  {columnItems.map((item) => {
                    const kc = kindLabels[item.kind] || { label: '?', color: 'bg-gray-500' };
                    const pc = priorityConfig[item.priority] || priorityConfig.P4;
                    return (
                      <div
                        key={item.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, item.id)}
                        className={`group bg-surface border border-border/50 rounded-lg p-3 cursor-grab active:cursor-grabbing transition-all duration-150 hover:border-border hover:shadow-lg hover:shadow-black/5 hover:-translate-y-0.5 ${draggedItem === item.id ? 'opacity-50 scale-95' : ''}`}
                        style={{ borderLeftWidth: 3, borderLeftColor: pc.color }}
                      >
                        <div className="flex items-start gap-2">
                          <div className="flex-1 min-w-0">
                            <InlineEditableText
                              value={item.title}
                              onSave={(newTitle) => handleTitleChange(item.id, newTitle)}
                              selectOnFocus
                              className="font-medium text-sm text-foreground line-clamp-2 leading-snug"
                              validate={(v) => v.trim().length > 0}
                            />
                          </div>
                          <Link
                            to={`/work-items/${item.id}`}
                            className="shrink-0 size-5 rounded flex items-center justify-center text-[10px] font-bold text-white hover:opacity-80 transition-opacity"
                            onClick={(e) => e.stopPropagation()}
                            title="View details"
                          >
                            <div className={`size-full rounded flex items-center justify-center ${kc.color}`}>{kc.label}</div>
                          </Link>
                        </div>
                        <div className="mt-2.5 flex items-center gap-2">
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${pc.bg}`}>{item.priority}</span>
                          {item.estimate_minutes && (
                            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                              <Clock className="size-3" />
                              {item.estimate_minutes >= 60 ? `${Math.floor(item.estimate_minutes / 60)}h` : `${item.estimate_minutes}m`}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {columnItems.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                      <div className="size-10 rounded-full bg-muted/50 flex items-center justify-center mb-2">
                        {status === 'open' ? (
                          <Circle className="size-5" />
                        ) : status === 'blocked' ? (
                          <AlertCircle className="size-5" />
                        ) : (
                          <CheckCircle2 className="size-5" />
                        )}
                      </div>
                      <span className="text-sm">No items</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
