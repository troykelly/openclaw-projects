/**
 * Board/Kanban view tab for project detail.
 *
 * Renders work items in columns grouped by status. Supports
 * visual card display with priority badges and due dates.
 * Column headers show card counts.
 *
 * @see Issue #468
 */
import React from 'react';
import { Link } from 'react-router';
import { Badge } from '@/ui/components/ui/badge';
import { EmptyState, Skeleton } from '@/ui/components/feedback';
import { priorityColors } from '@/ui/lib/work-item-utils';
import {
  Circle,
  Clock,
  AlertCircle,
  CheckCircle2,
  XCircle,
} from 'lucide-react';

/** Item shape accepted by BoardView. */
export interface BoardViewItem {
  id: string;
  title: string;
  status: string;
  priority: string;
  kind: string;
  not_after?: string | null;
}

interface BoardViewProps {
  items: BoardViewItem[];
  isLoading: boolean;
}

/** Kanban columns configuration. */
const columns = [
  { status: 'open', label: 'Not Started', color: 'bg-blue-400', bgGradient: 'from-blue-500/5 to-blue-500/0' },
  { status: 'in_progress', label: 'In Progress', color: 'bg-yellow-400', bgGradient: 'from-yellow-500/5 to-yellow-500/0' },
  { status: 'blocked', label: 'Blocked', color: 'bg-red-400', bgGradient: 'from-red-500/5 to-red-500/0' },
  { status: 'closed', label: 'Done', color: 'bg-green-400', bgGradient: 'from-green-500/5 to-green-500/0' },
  { status: 'cancelled', label: 'Cancelled', color: 'bg-gray-400', bgGradient: 'from-gray-500/5 to-gray-500/0' },
];

/** Priority color config for card borders. */
const priorityBorderColors: Record<string, string> = {
  P0: '#ef4444',
  P1: '#f97316',
  P2: '#eab308',
  P3: '#22c55e',
  P4: '#6b7280',
};

/** Kind display config. */
const kindConfig: Record<string, { label: string; color: string }> = {
  project: { label: 'P', color: 'bg-blue-500' },
  initiative: { label: 'I', color: 'bg-violet-500' },
  epic: { label: 'E', color: 'bg-emerald-500' },
  issue: { label: 'T', color: 'bg-gray-500' },
};

/** Map items to columns, handling status normalization. */
function getColumnItems(items: BoardViewItem[], columnStatus: string): BoardViewItem[] {
  return items.filter((item) => {
    const s = item.status;
    if (columnStatus === 'open') return s === 'open' || s === 'not_started';
    if (columnStatus === 'closed') return s === 'closed' || s === 'done';
    return s === columnStatus;
  });
}

export function BoardView({ items, isLoading }: BoardViewProps): React.JSX.Element {
  if (isLoading) {
    return (
      <div  className="flex gap-4 overflow-x-auto">
        {columns.map((col) => (
          <div key={col.status} className="flex-1 min-w-[260px] rounded-xl bg-muted/30 animate-pulse min-h-[300px]" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div >
        <EmptyState
          variant="folder"
          title="No items to display"
          description="Add work items to see them on the board."
        />
      </div>
    );
  }

  return (
    <div  className="flex gap-4 overflow-x-auto pb-2">
      {columns.map((col) => {
        const columnItems = getColumnItems(items, col.status);
        return (
          <div
            key={col.status}
            className="flex-1 min-w-[260px] max-w-[360px] flex flex-col rounded-xl"
          >
            {/* Column header */}
            <div className={`px-3 py-2.5 rounded-t-xl bg-gradient-to-b ${col.bgGradient} border-b border-border/30`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`size-2 rounded-full ${col.color}`} />
                  <h3 className="font-semibold text-sm">{col.label}</h3>
                </div>
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                  {columnItems.length}
                </span>
              </div>
            </div>

            {/* Column body */}
            <div className="flex-1 p-2 space-y-2 overflow-y-auto bg-muted/20 rounded-b-xl min-h-[200px]">
              {columnItems.map((item) => {
                const kc = kindConfig[item.kind] ?? { label: '?', color: 'bg-gray-500' };
                const borderColor = priorityBorderColors[item.priority] ?? '#6b7280';
                return (
                  <Link
                    key={item.id}
                    to={`/work-items/${item.id}`}
                    className="block bg-card border border-border/50 rounded-lg p-3 transition-all duration-150 hover:border-border hover:shadow-lg hover:shadow-black/5 hover:-translate-y-0.5"
                    style={{ borderLeftWidth: 3, borderLeftColor: borderColor }}
                  >
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm text-foreground line-clamp-2 leading-snug">
                          {item.title}
                        </p>
                      </div>
                      <div
                        className={`shrink-0 size-5 rounded flex items-center justify-center text-[10px] font-bold text-white ${kc.color}`}
                        title={item.kind}
                      >
                        {kc.label}
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <Badge
                        className={`text-[10px] px-1.5 py-0 ${priorityColors[item.priority] ?? 'bg-gray-500'}`}
                      >
                        {item.priority}
                      </Badge>
                      {item.not_after && (
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Clock className="size-3" />
                          {new Date(item.not_after).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </span>
                      )}
                    </div>
                  </Link>
                );
              })}
              {columnItems.length === 0 && (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                  <div className="size-8 rounded-full bg-muted/50 flex items-center justify-center mb-2">
                    {col.status === 'open' || col.status === 'not_started' ? (
                      <Circle className="size-4" />
                    ) : col.status === 'blocked' ? (
                      <AlertCircle className="size-4" />
                    ) : col.status === 'cancelled' ? (
                      <XCircle className="size-4" />
                    ) : (
                      <CheckCircle2 className="size-4" />
                    )}
                  </div>
                  <span className="text-xs">No items</span>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
