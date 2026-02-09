/**
 * List view tab for project detail.
 *
 * Renders a sortable table of work items with columns for
 * Title, Status, Priority, Kind, and Due Date.
 * Row clicks navigate to the work item detail page.
 *
 * @see Issue #468
 */
import React, { useState, useMemo } from 'react';
import { Link } from 'react-router';
import { Card, CardContent } from '@/ui/components/ui/card';
import { Badge } from '@/ui/components/ui/badge';
import { EmptyState, SkeletonTable } from '@/ui/components/feedback';
import { priorityColors } from '@/ui/lib/work-item-utils';
import { Circle, Clock, AlertCircle, CheckCircle2, XCircle, ArrowUp, ArrowDown, ChevronsUpDown } from 'lucide-react';

/** Props for the ListViewItem shape (subset of tree node data). */
export interface ListViewItem {
  id: string;
  title: string;
  status: string;
  priority: string;
  kind: string;
  not_before?: string | null;
  not_after?: string | null;
  children_count?: number;
}

interface ListViewProps {
  items: ListViewItem[];
  isLoading: boolean;
  projectId: string;
}

/** Status icons mapped by status key. */
const statusIcons: Record<string, React.ReactNode> = {
  open: <Circle className="size-3.5 text-blue-500" />,
  not_started: <Circle className="size-3.5 text-gray-400" />,
  in_progress: <Clock className="size-3.5 text-yellow-500" />,
  blocked: <AlertCircle className="size-3.5 text-red-500" />,
  closed: <CheckCircle2 className="size-3.5 text-green-500" />,
  done: <CheckCircle2 className="size-3.5 text-green-500" />,
  cancelled: <XCircle className="size-3.5 text-gray-400" />,
};

/** Status display labels. */
const statusLabels: Record<string, string> = {
  open: 'Open',
  not_started: 'Not Started',
  in_progress: 'In Progress',
  blocked: 'Blocked',
  closed: 'Done',
  done: 'Done',
  cancelled: 'Cancelled',
};

/** Kind display labels. */
const kindLabels: Record<string, string> = {
  project: 'Project',
  initiative: 'Initiative',
  epic: 'Epic',
  issue: 'Issue',
};

/** Kind color classes. */
const kindBadgeColors: Record<string, string> = {
  project: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
  initiative: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20',
  epic: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  issue: 'bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20',
};

type SortField = 'title' | 'status' | 'priority' | 'kind';
type SortDir = 'asc' | 'desc';

/** Priority sort order (P0 first). */
const priorityOrder: Record<string, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
  P4: 4,
};

export function ListView({ items, isLoading, projectId }: ListViewProps): React.JSX.Element {
  const [sortField, setSortField] = useState<SortField>('title');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const sortedItems = useMemo(() => {
    const sorted = [...items];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'title':
          cmp = a.title.localeCompare(b.title);
          break;
        case 'status':
          cmp = (a.status ?? '').localeCompare(b.status ?? '');
          break;
        case 'priority':
          cmp = (priorityOrder[a.priority] ?? 99) - (priorityOrder[b.priority] ?? 99);
          break;
        case 'kind':
          cmp = a.kind.localeCompare(b.kind);
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [items, sortField, sortDir]);

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <ChevronsUpDown className="size-3 text-muted-foreground/50" />;
    return sortDir === 'asc' ? <ArrowUp className="size-3 text-foreground" /> : <ArrowDown className="size-3 text-foreground" />;
  }

  if (isLoading) {
    return (
      <div>
        <SkeletonTable rows={5} columns={5} />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div>
        <EmptyState variant="folder" title="No items in this project" description="Add work items to this project to see them here." />
      </div>
    );
  }

  return (
    <div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th
                    className="px-4 py-3 text-left text-sm font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors"
                    onClick={() => handleSort('title')}
                  >
                    <div className="flex items-center gap-1.5">
                      Title
                      <SortIcon field="title" />
                    </div>
                  </th>
                  <th
                    className="px-4 py-3 text-left text-sm font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors"
                    onClick={() => handleSort('status')}
                  >
                    <div className="flex items-center gap-1.5">
                      Status
                      <SortIcon field="status" />
                    </div>
                  </th>
                  <th
                    className="px-4 py-3 text-left text-sm font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors"
                    onClick={() => handleSort('priority')}
                  >
                    <div className="flex items-center gap-1.5">
                      Priority
                      <SortIcon field="priority" />
                    </div>
                  </th>
                  <th
                    className="px-4 py-3 text-left text-sm font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors"
                    onClick={() => handleSort('kind')}
                  >
                    <div className="flex items-center gap-1.5">
                      Type
                      <SortIcon field="kind" />
                    </div>
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Due Date</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {sortedItems.map((item) => (
                  <tr key={item.id} className="hover:bg-muted/50 transition-colors cursor-pointer">
                    <td className="px-4 py-3">
                      <Link to={`/work-items/${encodeURIComponent(item.id)}`} className="font-medium text-foreground hover:text-primary transition-colors">
                        {item.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {statusIcons[item.status] ?? statusIcons.open}
                        <span className="text-sm">{statusLabels[item.status] ?? item.status}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {item.priority && <Badge className={`text-xs ${priorityColors[item.priority] ?? 'bg-gray-500'}`}>{item.priority}</Badge>}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className={`text-xs border ${kindBadgeColors[item.kind] ?? ''}`}>
                        {kindLabels[item.kind] ?? item.kind}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {item.not_after
                        ? new Date(item.not_after).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                          })
                        : '--'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
