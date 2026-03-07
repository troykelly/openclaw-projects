/**
 * RunCard — displays an active Symphony run on the dashboard.
 *
 * Shows live stage indicator, token counter, elapsed time, terminal preview
 * snapshot, and GitHub issue link. Terminal preview is lazy-loaded: only the
 * last 5 lines are shown as a static snapshot (review finding P5-1).
 *
 * Issue #2207
 */
import React, { useState } from 'react';
import { Clock, ExternalLink, Cpu, Terminal, ChevronDown, ChevronUp } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/ui/components/ui/card';
import { Badge } from '@/ui/components/ui/badge';
import { Button } from '@/ui/components/ui/button';
import type { SymphonyRun } from '@/ui/lib/api-types.ts';

/** Map run stage to a display-friendly label. */
function stageLabel(stage: string | null): string {
  if (!stage) return 'Initializing';
  const labels: Record<string, string> = {
    reading_issue: 'Reading Issue',
    planning: 'Planning',
    coding: 'Coding',
    testing: 'Testing',
    reviewing: 'Reviewing',
    merging: 'Merging',
    verifying: 'Verifying',
    provisioning: 'Provisioning',
  };
  return labels[stage] ?? stage.replace(/_/g, ' ');
}

/** Map status to badge variant. */
function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (['running', 'prompting', 'coding'].includes(status)) return 'default';
  if (['succeeded', 'merge_pending', 'post_merge_verify'].includes(status)) return 'secondary';
  if (['failed', 'stalled', 'cancelled', 'terminated', 'cleanup_failed'].includes(status)) return 'destructive';
  return 'outline';
}

/** Format elapsed time from start to now. */
function formatElapsed(startedAt: string | null): string {
  if (!startedAt) return '--';
  const elapsed = Date.now() - new Date(startedAt).getTime();
  const seconds = Math.floor(elapsed / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/** Build GitHub issue URL from run data (review finding P5-5). */
function githubIssueUrl(run: SymphonyRun): string | null {
  if (!run.github_org || !run.github_repo || !run.github_issue_number) return null;
  return `https://github.com/${encodeURIComponent(run.github_org)}/${encodeURIComponent(run.github_repo)}/issues/${run.github_issue_number}`;
}

/** Format a short issue label (e.g., "org/repo#123"). */
function issueLabel(run: SymphonyRun): string | null {
  if (!run.github_org || !run.github_repo || !run.github_issue_number) return null;
  return `${run.github_org}/${run.github_repo}#${run.github_issue_number}`;
}

export interface RunCardProps {
  run: SymphonyRun;
  /** Index in the list — only first 5 show terminal preview (P5-1). */
  index: number;
}

export function RunCard({ run, index }: RunCardProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const issueUrl = githubIssueUrl(run);
  const label = issueLabel(run);
  const showTerminalPreview = index < 5;

  // Get last 5 lines of terminal output snapshot
  const terminalLines = run.terminal_output_snapshot
    ? run.terminal_output_snapshot.split('\n').slice(-5).join('\n')
    : null;

  return (
    <Card data-testid="run-card" className="relative overflow-hidden">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            {/* Live stage indicator */}
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex size-2.5 rounded-full bg-primary" />
            </span>
            <span className="text-sm font-medium truncate" data-testid="run-stage">
              {stageLabel(run.stage)}
            </span>
          </div>
          <Badge variant={statusVariant(run.status)} data-testid="run-status">
            {run.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* Title / issue reference */}
        <div className="flex items-center gap-2 min-w-0">
          {run.work_item_title && (
            <span className="text-sm text-foreground truncate">{run.work_item_title}</span>
          )}
          {issueUrl && label && (
            <a
              href={issueUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary shrink-0"
              data-testid="github-issue-link"
            >
              {label}
              <ExternalLink className="size-3" />
            </a>
          )}
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1" data-testid="run-elapsed">
            <Clock className="size-3" />
            {formatElapsed(run.started_at)}
          </span>
          {run.token_count != null && (
            <span className="inline-flex items-center gap-1" data-testid="run-tokens">
              <Cpu className="size-3" />
              {run.token_count.toLocaleString()} tokens
            </span>
          )}
          {run.estimated_cost_usd != null && (
            <span data-testid="run-cost">${run.estimated_cost_usd.toFixed(2)}</span>
          )}
        </div>

        {/* Dispatch reasoning */}
        {run.dispatch_reasoning && (
          <p className="text-xs text-muted-foreground italic" data-testid="run-reasoning">
            {run.dispatch_reasoning}
          </p>
        )}

        {/* Mini terminal preview — lazy, static snapshot (P5-1) */}
        {showTerminalPreview && terminalLines && (
          <div className="mt-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => setExpanded(!expanded)}
              data-testid="terminal-toggle"
            >
              <Terminal className="mr-1 size-3" />
              Terminal
              {expanded ? <ChevronUp className="ml-1 size-3" /> : <ChevronDown className="ml-1 size-3" />}
            </Button>
            {expanded && (
              <pre
                className="mt-1 rounded-sm bg-muted/50 p-2 text-xs font-mono text-muted-foreground overflow-x-auto max-h-32"
                data-testid="terminal-preview"
              >
                {terminalLines}
              </pre>
            )}
          </div>
        )}

        {/* View terminal link for runs beyond first 5 */}
        {!showTerminalPreview && run.terminal_output_snapshot && (
          <span className="text-xs text-muted-foreground" data-testid="view-terminal-link">
            View terminal
          </span>
        )}
      </CardContent>
    </Card>
  );
}
