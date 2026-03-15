/**
 * Symphony Run Detail Page.
 *
 * Displays detailed view of a single orchestration run including
 * provisioning timeline, terminal preview, event log, token/cost
 * breakdown, failure history, action buttons, and run manifest.
 *
 * @see Issue #2209 (Epic #2186)
 */
import React, { useState, useRef, useEffect } from 'react';
import { useParams, Link } from 'react-router';
import {
  Play,
  Square,
  RotateCcw,
  ExternalLink,
  GitPullRequest,
  AlertTriangle,
  CheckCircle2,
  Clock,
  XCircle,
  Loader2,
  CircleDot,
  Hash,
  Terminal as TerminalIcon,
  Search,
  ChevronDown,
  Shield,
} from 'lucide-react';
import { Badge } from '@/ui/components/ui/badge';
import { Button } from '@/ui/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/components/ui/card';
import { Progress } from '@/ui/components/ui/progress';
import { Input } from '@/ui/components/ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/ui/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/components/ui/select';
import { useSymphonyRun, useCancelSymphonyRun, useRetrySymphonyRun } from '@/ui/hooks/queries/use-symphony-runs';
import type {
  SymphonyProvisioningStep,
  SymphonyRunEvent,
  SymphonyRunDetail,
  SymphonyAttemptSummary,
} from '@/ui/lib/api-types';
import { formatTime } from '@/ui/lib/date-format';

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  running: 'default',
  provisioning: 'default',
  prompting: 'default',
  succeeded: 'secondary',
  failed: 'destructive',
  cancelled: 'outline',
  paused: 'outline',
  stalled: 'destructive',
  terminated: 'outline',
};

function statusIcon(status: string): React.ReactNode {
  switch (status) {
    case 'completed':
    case 'succeeded':
      return <CheckCircle2 className="size-4 text-green-500" />;
    case 'running':
    case 'provisioning':
    case 'prompting':
      return <Loader2 className="size-4 animate-spin text-blue-500" />;
    case 'failed':
      return <XCircle className="size-4 text-red-500" />;
    case 'rolled_back':
      return <RotateCcw className="size-4 text-yellow-500" />;
    case 'pending':
      return <CircleDot className="size-4 text-muted-foreground" />;
    case 'skipped':
      return <CircleDot className="size-4 text-muted-foreground" />;
    default:
      return <Clock className="size-4 text-muted-foreground" />;
  }
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '-';
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const remaining = s % 60;
  return `${m}m ${remaining}s`;
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  return formatTime(d, undefined, { second: '2-digit' });
}

/** Validate that a URL points to a known trusted host (GitHub). */
function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    const host = parsed.hostname.toLowerCase();
    return host === 'github.com' || host.endsWith('.github.com');
  } catch {
    return false;
  }
}

/** Safely extract error message from an unknown error. */
function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'An unexpected error occurred';
}

const STEP_LABELS: Record<string, string> = {
  disk_check: 'Disk Check',
  ssh_connect: 'SSH Connect',
  repo_check: 'Repo Check',
  env_sync: 'Env Sync',
  devcontainer_up: 'Devcontainer Up',
  container_exec: 'Container Exec',
  agent_verify: 'Agent Verify',
  worktree_setup: 'Worktree Setup',
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Provisioning Timeline — vertical stepper with 8 steps. */
function ProvisioningTimeline({ steps }: { steps: SymphonyProvisioningStep[] }): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Provisioning Timeline</CardTitle>
      </CardHeader>
      <CardContent>
        <div data-testid="provisioning-timeline" className="space-y-1">
          {steps.map((step, i) => (
            <div
              key={step.step}
              data-testid={`provisioning-step-${step.step}`}
              className="flex items-start gap-3 relative py-2"
            >
              {/* Connector line */}
              {i < steps.length - 1 && (
                <div className="absolute left-[11px] top-8 bottom-0 w-px bg-border" />
              )}
              {/* Status icon */}
              <div className="flex-shrink-0 mt-0.5">{statusIcon(step.status)}</div>
              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    {STEP_LABELS[step.step] ?? step.step}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDuration(step.duration_ms)}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground capitalize">{step.status}</span>
                {step.error && (
                  <p className="text-xs text-red-500 mt-1">{step.error}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/** Run Event Log with filtering and auto-scroll. */
function RunEventLog({ events }: { events: SymphonyRunEvent[] }): React.JSX.Element {
  const [filter, setFilter] = useState('all');
  const scrollRef = useRef<HTMLDivElement>(null);

  const filtered = filter === 'all'
    ? events
    : events.filter((e) => e.event_type === filter);

  const eventTypes = ['all', ...new Set(events.map((e) => e.event_type))];

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filtered.length]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Event Log</CardTitle>
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-[160px]" data-testid="event-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {eventTypes.map((t) => (
                <SelectItem key={t} value={t}>
                  {t === 'all' ? 'All events' : t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        <div
          data-testid="run-event-log"
          ref={scrollRef}
          className="max-h-64 overflow-y-auto space-y-1 font-mono text-xs"
        >
          {filtered.map((evt) => (
            <div
              key={evt.id}
              data-testid={`event-entry-${evt.id}`}
              className="flex items-start gap-2 py-1 border-b border-border/50 last:border-0"
            >
              <span className="text-muted-foreground whitespace-nowrap">
                {formatTimestamp(evt.created_at)}
              </span>
              <Badge variant="outline" className="text-[10px]">
                {evt.event_type}
              </Badge>
              {evt.from_state && evt.to_state && (
                <span>
                  {evt.from_state} → {evt.to_state}
                </span>
              )}
              {evt.detail && (
                <span className="text-muted-foreground truncate">{evt.detail}</span>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/** Token/Cost Breakdown section. */
function TokenCostBreakdown({ run }: { run: SymphonyRunDetail }): React.JSX.Element {
  const { token_breakdown: tb } = run;
  const totalTokens = tb.input_tokens + tb.output_tokens;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Token / Cost</CardTitle>
      </CardHeader>
      <CardContent data-testid="token-cost-breakdown">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Model</p>
            <p className="text-sm font-medium">{tb.model ?? 'Unknown'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Estimated Cost</p>
            <p className="text-sm font-medium">${tb.estimated_cost_usd.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Input Tokens</p>
            <p className="text-sm font-medium">{tb.input_tokens.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Output Tokens</p>
            <p className="text-sm font-medium">{tb.output_tokens.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total Tokens</p>
            <p className="text-sm font-medium">{totalTokens.toLocaleString()}</p>
          </div>
          {tb.project_average_cost_usd != null && (
            <div>
              <p className="text-xs text-muted-foreground">Project Avg Cost</p>
              <p className="text-sm font-medium">${tb.project_average_cost_usd.toFixed(2)}</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** Failure Aggregation — previous attempts and error categories. */
function FailureAggregation({ attempts }: { attempts: SymphonyAttemptSummary[] }): React.JSX.Element {
  const totalTokens = attempts.reduce((sum, a) => sum + a.tokens_used, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <AlertTriangle className="size-4 text-yellow-500" />
          Failure History
        </CardTitle>
      </CardHeader>
      <CardContent data-testid="failure-aggregation">
        <div className="space-y-2 mb-3">
          {attempts.map((a) => (
            <div
              key={a.run_id}
              data-testid={`failure-attempt-${a.run_id}`}
              className="flex items-start gap-3 p-2 rounded-sm bg-muted/50"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Badge variant="destructive" className="text-[10px]">
                    Attempt {a.attempt_number}
                  </Badge>
                  {a.failure_class && (
                    <Badge variant="outline" className="text-[10px]">
                      {a.failure_class}
                    </Badge>
                  )}
                </div>
                {a.error_summary && (
                  <p className="text-xs text-muted-foreground mt-1">{a.error_summary}</p>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  Tokens: {a.tokens_used.toLocaleString()}
                </p>
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {formatTimestamp(a.created_at)}
              </span>
            </div>
          ))}
        </div>
        <div className="text-xs text-muted-foreground border-t pt-2">
          Total tokens across attempts: {totalTokens.toLocaleString()}
        </div>
      </CardContent>
    </Card>
  );
}

/** Run Manifest — tool versions, prompt hash, secret versions, branch SHA. */
function RunManifest({ run }: { run: SymphonyRunDetail }): React.JSX.Element {
  const { manifest } = run;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Shield className="size-4" />
          Run Manifest
        </CardTitle>
      </CardHeader>
      <CardContent data-testid="run-manifest">
        <div className="space-y-3 text-sm">
          {/* Tool Versions */}
          <div>
            <p className="text-xs text-muted-foreground mb-1">Tool Versions</p>
            <div className="space-y-1">
              {Object.entries(manifest.tool_versions).map(([name, ver]) => (
                <div key={name} className="flex justify-between">
                  <span className="font-mono text-xs">{name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{ver}</span>
                </div>
              ))}
            </div>
          </div>
          {/* Prompt Hash */}
          {manifest.prompt_hash && (
            <div>
              <p className="text-xs text-muted-foreground">Prompt Hash</p>
              <p className="font-mono text-xs">{manifest.prompt_hash}</p>
            </div>
          )}
          {/* Secret Versions */}
          {Object.keys(manifest.secret_versions).length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Secret Versions</p>
              <div className="space-y-1">
                {Object.entries(manifest.secret_versions).map(([name, ver]) => (
                  <div key={name} className="flex justify-between">
                    <span className="font-mono text-xs">{name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{ver}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Branch SHA */}
          {manifest.branch_sha && (
            <div>
              <p className="text-xs text-muted-foreground">Branch SHA</p>
              <p className="font-mono text-xs">{manifest.branch_sha}</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** Terminal Preview — read-only scrollable output. */
function TerminalPreview(): React.JSX.Element {
  const [search, setSearch] = useState('');

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <TerminalIcon className="size-4" />
            Terminal Output
          </CardTitle>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search..."
                className="h-7 w-40 pl-7 text-xs"
                data-testid="terminal-search"
              />
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div
          data-testid="terminal-preview"
          className="bg-black rounded-sm p-3 font-mono text-xs text-green-400 h-48 overflow-y-auto"
        >
          <p className="text-muted-foreground italic">
            Terminal output is redacted in read-only mode.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Run Actions
// ---------------------------------------------------------------------------

const ACTIVE_STATES = new Set([
  'claimed', 'provisioning', 'prompting', 'running',
  'awaiting_approval', 'verifying_result', 'merge_pending',
  'post_merge_verify', 'issue_closing', 'terminating',
]);

const RETRYABLE_STATES = new Set(['paused', 'failed', 'stalled']);

function RunActions({ run }: { run: SymphonyRunDetail }): React.JSX.Element {
  const [cancelOpen, setCancelOpen] = useState(false);
  const cancelMutation = useCancelSymphonyRun();
  const retryMutation = useRetrySymphonyRun();

  const isActive = ACTIVE_STATES.has(run.status);
  const isRetryable = RETRYABLE_STATES.has(run.status);

  return (
    <div data-testid="run-actions" className="flex flex-wrap gap-2">
      {isActive && (
        <Button
          variant="destructive"
          size="sm"
          data-testid="cancel-run-button"
          onClick={() => setCancelOpen(true)}
          disabled={cancelMutation.isPending}
        >
          <Square className="mr-1 size-3" />
          Cancel
        </Button>
      )}

      {isRetryable && (
        <Button
          variant="default"
          size="sm"
          data-testid="retry-run-button"
          onClick={() => retryMutation.mutate(run.id)}
          disabled={retryMutation.isPending}
        >
          <RotateCcw className="mr-1 size-3" />
          Retry
        </Button>
      )}

      {run.pr_url && isSafeUrl(run.pr_url) && (
        <Button variant="outline" size="sm" asChild data-testid="view-pr-link">
          <a href={run.pr_url} target="_blank" rel="noopener noreferrer">
            <GitPullRequest className="mr-1 size-3" />
            PR #{run.pr_number}
          </a>
        </Button>
      )}

      {run.issue_url && isSafeUrl(run.issue_url) && (
        <Button variant="outline" size="sm" asChild data-testid="view-issue-link">
          <a href={run.issue_url} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="mr-1 size-3" />
            View Issue
          </a>
        </Button>
      )}

      {/* Cancel confirmation dialog */}
      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent data-testid="cancel-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Run?</AlertDialogTitle>
            <AlertDialogDescription>
              This will send a cancellation signal to the running agent.
              Any in-progress operations may be interrupted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Running</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                cancelMutation.mutate(run.id);
                setCancelOpen(false);
              }}
            >
              Cancel Run
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export function RunDetailPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { data: run, isLoading, error } = useSymphonyRun(id ?? '');

  if (isLoading) {
    return (
      <div data-testid="page-symphony-run-detail" className="flex items-center justify-center p-12">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !run) {
    return (
      <div data-testid="page-symphony-run-detail" className="p-6">
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            {error ? `Error loading run: ${getErrorMessage(error)}` : 'Run not found'}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div data-testid="page-symphony-run-detail" className="h-full flex flex-col p-6 space-y-6 overflow-y-auto">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <nav data-testid="run-detail-breadcrumb" className="flex items-center gap-3 mb-1">
            <Link
              to="/symphony"
              data-testid="breadcrumb-symphony-dashboard"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Symphony
            </Link>
            <ChevronDown className="size-3 -rotate-90 text-muted-foreground" />
            <Link
              to={`/projects/${run.project_id}`}
              data-testid="breadcrumb-project"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Project
            </Link>
            <ChevronDown className="size-3 -rotate-90 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Runs</span>
            <ChevronDown className="size-3 -rotate-90 text-muted-foreground" />
            <span className="text-sm font-medium">{run.id.slice(0, 8)}</span>
          </nav>
          <h1 className="text-2xl font-semibold text-foreground">
            {run.work_item_title ?? `Run ${run.id.slice(0, 8)}`}
          </h1>
          <div className="flex items-center gap-3 mt-1">
            <Badge
              data-testid="run-status-badge"
              variant={STATUS_VARIANTS[run.status] ?? 'outline'}
            >
              {run.status}
            </Badge>
            {run.stage && (
              <Badge variant="outline">{run.stage}</Badge>
            )}
            {run.host_name && (
              <span className="text-sm text-muted-foreground">on {run.host_name}</span>
            )}
            {run.tool_name && (
              <span className="text-sm text-muted-foreground">via {run.tool_name}</span>
            )}
          </div>
        </div>
        <RunActions run={run} />
      </div>

      {/* Error banner */}
      {run.error_message && (
        <div
          data-testid="run-error-message"
          className="flex items-start gap-2 p-3 rounded-sm bg-red-500/10 border border-red-500/20"
        >
          <XCircle className="size-4 text-red-500 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-red-500">{run.error_message}</p>
            {run.failure_class && (
              <p className="text-xs text-red-400 mt-1">
                Classification: {run.failure_class}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column — main content */}
        <div className="lg:col-span-2 space-y-6">
          <ProvisioningTimeline steps={run.provisioning_steps} />
          <TerminalPreview />
          <RunEventLog events={run.events} />
        </div>

        {/* Right column — sidebar */}
        <div className="space-y-6">
          <TokenCostBreakdown run={run} />
          {run.failure_history.length > 0 && (
            <FailureAggregation attempts={run.failure_history} />
          )}
          <RunManifest run={run} />
        </div>
      </div>
    </div>
  );
}
