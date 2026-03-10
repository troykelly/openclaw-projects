/**
 * QueueItem — displays a queued Symphony run in the "Next Up" section.
 *
 * Shows issue title, priority, repo, dispatch reasoning.
 * Used within a sortable context for drag-drop reordering.
 *
 * Issue #2207
 */
import React from 'react';
import { Link } from 'react-router';
import { GripVertical, ExternalLink } from 'lucide-react';
import { Badge } from '@/ui/components/ui/badge';
import type { SymphonyRun } from '@/ui/lib/api-types.ts';

export interface QueueItemProps {
  run: SymphonyRun;
  /** Whether drag handle should be visible. */
  showDragHandle?: boolean;
  /** Drag handle props from dnd-kit (if available). */
  dragHandleProps?: Record<string, unknown>;
}

export function QueueItem({ run, showDragHandle = true, dragHandleProps }: QueueItemProps): React.JSX.Element {
  const issueLabel = run.github_org && run.github_repo && run.github_issue_number
    ? `${run.github_org}/${run.github_repo}#${run.github_issue_number}`
    : null;
  const issueUrl = issueLabel
    ? `https://github.com/${encodeURIComponent(run.github_org!)}/${encodeURIComponent(run.github_repo!)}/issues/${run.github_issue_number}`
    : null;

  return (
    <div
      data-testid="queue-item"
      className="flex items-center gap-3 rounded-md border border-border bg-surface p-3 transition-colors hover:bg-muted/50"
    >
      {showDragHandle && (
        <span
          className="cursor-grab text-muted-foreground hover:text-foreground"
          data-testid="drag-handle"
          {...dragHandleProps}
        >
          <GripVertical className="size-4" />
        </span>
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate" data-testid="queue-item-title">
            {run.work_item_title ?? `Run ${run.id.slice(0, 8)}`}
          </span>
          <Badge variant="outline" className="shrink-0 text-xs">
            P{run.priority}
          </Badge>
        </div>

        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
          {issueUrl && issueLabel && (
            <a
              href={issueUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 hover:text-primary"
              data-testid="queue-issue-link"
            >
              {issueLabel}
              <ExternalLink className="size-3" />
            </a>
          )}
          {run.dispatch_reasoning && (
            <span className="truncate" data-testid="queue-reasoning">
              {run.dispatch_reasoning}
            </span>
          )}
        </div>
      </div>

      <Link
        to={`/symphony/runs/${run.id}`}
        className="text-xs text-muted-foreground hover:text-primary shrink-0"
        data-testid="queue-run-detail-link"
      >
        Details
      </Link>
      <Badge variant="secondary" className="shrink-0" data-testid="queue-item-status">
        {run.status}
      </Badge>
    </div>
  );
}
