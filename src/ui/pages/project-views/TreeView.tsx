/**
 * Tree view tab for project detail.
 *
 * Renders a hierarchical tree of work items within the project
 * (Project -> Initiative -> Epic -> Issue). Supports expand/collapse
 * of nodes and inline status badges.
 *
 * @see Issue #468
 */
import React, { useState, useCallback } from 'react';
import { Link } from 'react-router';
import { Badge } from '@/ui/components/ui/badge';
import { EmptyState, Skeleton } from '@/ui/components/feedback';
import { priorityColors } from '@/ui/lib/work-item-utils';
import type { TreeItem, TreeItemKind } from '@/ui/components/tree/types';
import {
  ChevronRight,
  ChevronDown,
  Circle,
  Clock,
  AlertCircle,
  CheckCircle2,
  XCircle,
  FolderOpen,
  Folder,
} from 'lucide-react';

interface TreeViewProps {
  items: TreeItem[];
  isLoading: boolean;
  projectId: string;
}

/** Kind display config with icons and colors. */
const kindConfig: Record<string, { color: string; bgColor: string }> = {
  project: { color: 'text-blue-500', bgColor: 'bg-blue-500/10' },
  initiative: { color: 'text-violet-500', bgColor: 'bg-violet-500/10' },
  epic: { color: 'text-emerald-500', bgColor: 'bg-emerald-500/10' },
  issue: { color: 'text-gray-500', bgColor: 'bg-gray-500/10' },
};

/** Status indicator config. */
const statusConfig: Record<string, { icon: React.ReactNode; label: string }> = {
  not_started: { icon: <Circle className="size-3 text-gray-400" />, label: 'Not Started' },
  in_progress: { icon: <Clock className="size-3 text-yellow-500" />, label: 'In Progress' },
  blocked: { icon: <AlertCircle className="size-3 text-red-500" />, label: 'Blocked' },
  done: { icon: <CheckCircle2 className="size-3 text-green-500" />, label: 'Done' },
  cancelled: { icon: <XCircle className="size-3 text-gray-400" />, label: 'Cancelled' },
};

/** Single tree node renderer. */
function TreeNode({
  item,
  expanded,
  onToggle,
  depth,
}: {
  item: TreeItem;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  depth: number;
}): React.JSX.Element {
  const isExpanded = expanded.has(item.id);
  const hasChildren = item.children && item.children.length > 0;
  const kc = kindConfig[item.kind] ?? kindConfig.issue;
  const sc = statusConfig[item.status] ?? statusConfig.not_started;

  return (
    <>
      <div
        className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-muted/50 transition-colors group"
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
      >
        {/* Expand/collapse toggle */}
        {hasChildren ? (
          <button
            onClick={() => onToggle(item.id)}
            className="shrink-0 size-5 rounded flex items-center justify-center hover:bg-muted text-muted-foreground"
            aria-label={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
          </button>
        ) : (
          <span className="shrink-0 size-5" />
        )}

        {/* Kind indicator */}
        <div className={`shrink-0 size-5 rounded flex items-center justify-center ${kc.bgColor}`}>
          {hasChildren && isExpanded ? (
            <FolderOpen className={`size-3.5 ${kc.color}`} />
          ) : hasChildren ? (
            <Folder className={`size-3.5 ${kc.color}`} />
          ) : (
            <Circle className={`size-3 ${kc.color}`} />
          )}
        </div>

        {/* Title link */}
        <Link
          to={`/work-items/${item.id}`}
          className="flex-1 min-w-0 text-sm font-medium text-foreground hover:text-primary transition-colors truncate"
        >
          {item.title}
        </Link>

        {/* Status badge */}
        <div className="flex items-center gap-1.5 shrink-0">
          {sc.icon}
          <span className="text-xs text-muted-foreground hidden sm:inline">
            {sc.label}
          </span>
        </div>

        {/* Priority badge */}
        {item.kind === 'issue' && (
          <Badge
            className={`text-[10px] px-1 py-0 ${
              priorityColors[(item as TreeItem & { priority?: string }).kind === 'issue' ? 'P2' : 'P2'] ?? 'bg-gray-500'
            }`}
            variant="secondary"
          >
            {item.kind}
          </Badge>
        )}

        {/* Child count */}
        {(item.childCount ?? 0) > 0 && (
          <span className="text-xs text-muted-foreground/60">
            ({item.childCount})
          </span>
        )}
      </div>

      {/* Recursive children */}
      {hasChildren && isExpanded && (
        <div>
          {item.children!.map((child) => (
            <TreeNode
              key={child.id}
              item={child}
              expanded={expanded}
              onToggle={onToggle}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </>
  );
}

export function TreeView({ items, isLoading, projectId }: TreeViewProps): React.JSX.Element {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    // Auto-expand first level
    const ids = new Set<string>();
    for (const item of items) {
      ids.add(item.id);
    }
    return ids;
  });

  const handleToggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  if (isLoading) {
    return (
      <div  className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-2" style={{ paddingLeft: `${(i % 3) * 20 + 8}px` }}>
            <Skeleton width={16} height={16} />
            <Skeleton width={16} height={16} />
            <Skeleton width={`${60 + Math.random() * 30}%`} height={14} />
          </div>
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div >
        <EmptyState
          variant="folder"
          title="No items in this project"
          description="Add work items to see the project hierarchy."
        />
      </div>
    );
  }

  return (
    <div  className="space-y-0.5">
      {items.map((item) => (
        <TreeNode
          key={item.id}
          item={item}
          expanded={expanded}
          onToggle={handleToggle}
          depth={0}
        />
      ))}
    </div>
  );
}
