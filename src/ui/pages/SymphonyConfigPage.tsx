/**
 * Project Symphony Config page — /app/projects/:id/symphony
 *
 * Full control panel for per-project Symphony configuration:
 * - Orchestration toggle with confirmation
 * - Repository management
 * - Host assignment with health indicators
 * - Agent selection rules
 * - Budget settings
 * - Notification rules
 * - Advanced settings
 *
 * Issue #2208
 */
import React, { useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  Settings2,
  GitBranch,
  Server,
  Bot,
  DollarSign,
  Bell,
  Wrench,
  Plus,
  Trash2,
  RefreshCw,
  Power,
  PowerOff,
  ChevronRight,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/components/ui/card';
import { Button } from '@/ui/components/ui/button';
import { Badge } from '@/ui/components/ui/badge';
import { Input } from '@/ui/components/ui/input';
import { Label } from '@/ui/components/ui/label';
import { Switch } from '@/ui/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/ui/dialog';
import { Separator } from '@/ui/components/ui/separator';
import { HostStatusBadge } from '@/ui/components/symphony';
import {
  useSymphonyConfig,
  useSymphonyRepos,
  useSymphonyProjectHosts,
} from '@/ui/hooks/queries/use-symphony.ts';
import {
  useUpdateSymphonyConfig,
  useAddRepo,
  useRemoveRepo,
  useAddHost,
  useDrainHost,
  useActivateHost,
} from '@/ui/hooks/mutations/use-symphony-mutations.ts';
import { formatDateTime } from '@/ui/lib/date-format';

export function SymphonyConfigPage(): React.JSX.Element {
  const { id: projectId } = useParams<{ id: string }>();
  const safeProjectId = projectId ?? '';

  const configQuery = useSymphonyConfig(safeProjectId);
  const reposQuery = useSymphonyRepos(safeProjectId);
  const hostsQuery = useSymphonyProjectHosts(safeProjectId);

  const updateConfig = useUpdateSymphonyConfig(safeProjectId);

  const config = configQuery.data?.data;
  const repos = Array.isArray(reposQuery.data?.data) ? reposQuery.data.data : [];
  const hosts = Array.isArray(hostsQuery.data?.data) ? hostsQuery.data.data : [];

  const isLoading = configQuery.isLoading;
  const isError = configQuery.isError;

  // Orchestration toggle confirmation dialog
  const [confirmToggle, setConfirmToggle] = useState(false);

  function handleToggleOrchestration() {
    setConfirmToggle(true);
  }

  function confirmToggleOrchestration() {
    if (config) {
      updateConfig.mutate({ ...config.config, enabled: !config.enabled });
    }
    setConfirmToggle(false);
  }

  if (isLoading) {
    return (
      <div data-testid="page-symphony-config" className="flex items-center justify-center p-12">
        <div className="size-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (isError) {
    return (
      <div data-testid="page-symphony-config" className="p-6">
        <Card>
          <CardContent className="p-6 text-center text-destructive" data-testid="config-error">
            Failed to load Symphony configuration. The API may not have a config for this project yet.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div data-testid="page-symphony-config" className="h-full flex flex-col p-6 space-y-6">
      {/* Breadcrumb */}
      <nav data-testid="symphony-config-breadcrumb" className="flex items-center gap-1.5 text-sm">
        <Link to="/work-items" className="text-muted-foreground hover:text-foreground transition-colors">
          Projects
        </Link>
        <ChevronRight className="size-3 text-muted-foreground" />
        <Link to={`/projects/${safeProjectId}`} className="text-muted-foreground hover:text-foreground transition-colors">
          Project
        </Link>
        <ChevronRight className="size-3 text-muted-foreground" />
        <span className="font-medium">Symphony Config</span>
      </nav>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Settings2 className="size-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Symphony Config</h1>
            <p className="text-sm text-muted-foreground">Orchestration settings for this project</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Label htmlFor="orchestration-toggle" className="text-sm">
            Orchestration
          </Label>
          <Switch
            id="orchestration-toggle"
            checked={config?.enabled ?? false}
            onCheckedChange={handleToggleOrchestration}
            data-testid="orchestration-toggle"
          />
          <Badge variant={config?.enabled ? 'default' : 'secondary'}>
            {config?.enabled ? 'Enabled' : 'Disabled'}
          </Badge>
        </div>
      </div>

      {/* Toggle confirmation dialog */}
      <Dialog open={confirmToggle} onOpenChange={setConfirmToggle}>
        <DialogContent data-testid="toggle-confirm-dialog">
          <DialogHeader>
            <DialogTitle>
              {config?.enabled ? 'Disable' : 'Enable'} Orchestration?
            </DialogTitle>
            <DialogDescription>
              {config?.enabled
                ? 'Disabling orchestration will stop new runs from being dispatched. Active runs will continue until completion.'
                : 'Enabling orchestration will allow Symphony to automatically dispatch runs for synced issues.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmToggle(false)}>
              Cancel
            </Button>
            <Button
              onClick={confirmToggleOrchestration}
              variant={config?.enabled ? 'destructive' : 'default'}
              data-testid="confirm-toggle"
            >
              {config?.enabled ? 'Disable' : 'Enable'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tabbed sections */}
      <Tabs defaultValue="repos" className="flex-1">
        <TabsList data-testid="config-tabs">
          <TabsTrigger value="repos">
            <GitBranch className="mr-1.5 size-4" />
            Repositories
          </TabsTrigger>
          <TabsTrigger value="hosts">
            <Server className="mr-1.5 size-4" />
            Hosts
          </TabsTrigger>
          <TabsTrigger value="agents">
            <Bot className="mr-1.5 size-4" />
            Agents
          </TabsTrigger>
          <TabsTrigger value="budget">
            <DollarSign className="mr-1.5 size-4" />
            Budget
          </TabsTrigger>
          <TabsTrigger value="notifications">
            <Bell className="mr-1.5 size-4" />
            Notifications
          </TabsTrigger>
          <TabsTrigger value="advanced">
            <Wrench className="mr-1.5 size-4" />
            Advanced
          </TabsTrigger>
        </TabsList>

        {/* Repositories Tab */}
        <TabsContent value="repos" className="space-y-4">
          <ReposSection projectId={safeProjectId} repos={repos} />
        </TabsContent>

        {/* Hosts Tab */}
        <TabsContent value="hosts" className="space-y-4">
          <HostsSection projectId={safeProjectId} hosts={hosts} />
        </TabsContent>

        {/* Agents Tab */}
        <TabsContent value="agents" className="space-y-4">
          <AgentsSection config={config?.config} onSave={(c) => updateConfig.mutate(c)} saving={updateConfig.isPending} />
        </TabsContent>

        {/* Budget Tab */}
        <TabsContent value="budget" className="space-y-4">
          <BudgetSection config={config?.config} onSave={(c) => updateConfig.mutate(c)} saving={updateConfig.isPending} />
        </TabsContent>

        {/* Notifications Tab */}
        <TabsContent value="notifications" className="space-y-4">
          <NotificationsSection config={config?.config} onSave={(c) => updateConfig.mutate(c)} saving={updateConfig.isPending} />
        </TabsContent>

        {/* Advanced Tab */}
        <TabsContent value="advanced" className="space-y-4">
          <AdvancedSection config={config?.config} onSave={(c) => updateConfig.mutate(c)} saving={updateConfig.isPending} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Repositories Section
// ---------------------------------------------------------------------------

function ReposSection({ projectId, repos }: { projectId: string; repos: Array<{ id: string; org: string; repo: string; default_branch: string; sync_strategy: string; last_synced_at: string | null }> }) {
  const addRepo = useAddRepo(projectId);
  const removeRepo = useRemoveRepo(projectId);
  const [showAdd, setShowAdd] = useState(false);
  const [newOrg, setNewOrg] = useState('');
  const [newRepo, setNewRepo] = useState('');
  const [newBranch, setNewBranch] = useState('main');
  const [newStrategy, setNewStrategy] = useState('mirror');

  function handleAdd() {
    if (!newOrg.trim() || !newRepo.trim()) return;
    addRepo.mutate(
      { org: newOrg.trim(), repo: newRepo.trim(), default_branch: newBranch, sync_strategy: newStrategy },
      { onSuccess: () => { setShowAdd(false); setNewOrg(''); setNewRepo(''); } },
    );
  }

  return (
    <Card data-testid="repos-section">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">GitHub Repositories</CardTitle>
        <Button size="sm" onClick={() => setShowAdd(true)} data-testid="add-repo-button">
          <Plus className="mr-1 size-4" />
          Add Repo
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {repos.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4" data-testid="no-repos">
            No repositories configured. Add one to start syncing issues.
          </p>
        ) : (
          repos.map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded-md border p-3" data-testid="repo-item">
              <div>
                <div className="text-sm font-medium">{r.org}/{r.repo}</div>
                <div className="text-xs text-muted-foreground">
                  Branch: {r.default_branch} | Strategy: {r.sync_strategy}
                  {r.last_synced_at && ` | Last sync: ${formatDateTime(r.last_synced_at)}`}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeRepo.mutate(r.id)}
                data-testid="remove-repo"
              >
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </div>
          ))
        )}

        {/* Add repo dialog */}
        <Dialog open={showAdd} onOpenChange={setShowAdd}>
          <DialogContent data-testid="add-repo-dialog">
            <DialogHeader>
              <DialogTitle>Add Repository</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Organization</Label>
                <Input value={newOrg} onChange={(e) => setNewOrg(e.target.value)} placeholder="e.g. troykelly" />
              </div>
              <div className="space-y-1">
                <Label>Repository</Label>
                <Input value={newRepo} onChange={(e) => setNewRepo(e.target.value)} placeholder="e.g. my-project" />
              </div>
              <div className="space-y-1">
                <Label>Default Branch</Label>
                <Input value={newBranch} onChange={(e) => setNewBranch(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Sync Strategy</Label>
                <Select value={newStrategy} onValueChange={setNewStrategy}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mirror">Mirror</SelectItem>
                    <SelectItem value="selective">Selective</SelectItem>
                    <SelectItem value="manual">Manual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button onClick={handleAdd} disabled={addRepo.isPending} data-testid="confirm-add-repo">
                Add Repository
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Hosts Section
// ---------------------------------------------------------------------------

function HostsSection({ projectId, hosts }: { projectId: string; hosts: Array<{ id: string; connection_id: string; connection_name: string | null; priority: number; max_concurrent_sessions: number; health_status: string; active_runs: number }> }) {
  const drainHost = useDrainHost(projectId);
  const activateHost = useActivateHost(projectId);

  return (
    <Card data-testid="hosts-section">
      <CardHeader>
        <CardTitle className="text-base">Host Assignment</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {hosts.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4" data-testid="no-hosts">
            No hosts assigned. Enroll terminal connections and assign them here.
          </p>
        ) : (
          hosts.map((h) => (
            <div key={h.id} className="flex items-center justify-between rounded-md border p-3" data-testid="host-item">
              <div className="flex items-center gap-3">
                <HostStatusBadge status={h.health_status} />
                <div>
                  <div className="text-sm font-medium">{h.connection_name ?? h.connection_id.slice(0, 8)}</div>
                  <div className="text-xs text-muted-foreground">
                    Priority: {h.priority} | Max sessions: {h.max_concurrent_sessions} | Active: {h.active_runs}
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                {h.health_status !== 'offline' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => drainHost.mutate(h.id)}
                    data-testid="drain-host"
                  >
                    <PowerOff className="mr-1 size-3" />
                    Drain
                  </Button>
                )}
                {h.health_status === 'offline' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => activateHost.mutate(h.id)}
                    data-testid="activate-host"
                  >
                    <Power className="mr-1 size-3" />
                    Activate
                  </Button>
                )}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Agents Section
// ---------------------------------------------------------------------------

interface ConfigSectionProps {
  config?: Record<string, unknown>;
  onSave: (config: Record<string, unknown>) => void;
  saving: boolean;
}

function AgentsSection({ config, onSave, saving }: ConfigSectionProps) {
  const [implAgent, setImplAgent] = useState((config?.implementation_agent as string) ?? 'claude-code');
  const [reviewAgent, setReviewAgent] = useState((config?.review_agent as string) ?? 'codex');
  const [triageAgent, setTriageAgent] = useState((config?.triage_agent as string) ?? 'claude-code');

  function handleSave() {
    onSave({ ...config, implementation_agent: implAgent, review_agent: reviewAgent, triage_agent: triageAgent });
  }

  return (
    <Card data-testid="agents-section">
      <CardHeader>
        <CardTitle className="text-base">Agent Selection Rules</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <Label>Implementation Agent</Label>
          <Select value={implAgent} onValueChange={setImplAgent}>
            <SelectTrigger data-testid="impl-agent-select"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="claude-code">Claude Code</SelectItem>
              <SelectItem value="codex">Codex</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Review Agent</Label>
          <Select value={reviewAgent} onValueChange={setReviewAgent}>
            <SelectTrigger data-testid="review-agent-select"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="codex">Codex</SelectItem>
              <SelectItem value="claude-code">Claude Code</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Triage Agent</Label>
          <Select value={triageAgent} onValueChange={setTriageAgent}>
            <SelectTrigger data-testid="triage-agent-select"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="claude-code">Claude Code</SelectItem>
              <SelectItem value="codex">Codex</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={handleSave} disabled={saving} data-testid="save-agents">
          Save Agent Settings
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Budget Section
// ---------------------------------------------------------------------------

function BudgetSection({ config, onSave, saving }: ConfigSectionProps) {
  const [dailyBudget, setDailyBudget] = useState(String(config?.daily_budget_usd ?? 50));
  const [perRunLimit, setPerRunLimit] = useState(String(config?.per_run_token_limit ?? 100000));

  function handleSave() {
    onSave({
      ...config,
      daily_budget_usd: parseFloat(dailyBudget) || 50,
      per_run_token_limit: parseInt(perRunLimit, 10) || 100000,
    });
  }

  return (
    <Card data-testid="budget-section">
      <CardHeader>
        <CardTitle className="text-base">Budget Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="daily-budget">Daily Budget (USD)</Label>
          <Input
            id="daily-budget"
            type="number"
            step="0.01"
            min="0"
            value={dailyBudget}
            onChange={(e) => setDailyBudget(e.target.value)}
            data-testid="daily-budget-input"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="token-limit">Per-Run Token Limit</Label>
          <Input
            id="token-limit"
            type="number"
            min="1000"
            step="1000"
            value={perRunLimit}
            onChange={(e) => setPerRunLimit(e.target.value)}
            data-testid="token-limit-input"
          />
        </div>
        <Button onClick={handleSave} disabled={saving} data-testid="save-budget">
          Save Budget Settings
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Notifications Section
// ---------------------------------------------------------------------------

function NotificationsSection({ config, onSave, saving }: ConfigSectionProps) {
  const rules = Array.isArray(config?.notification_rules) ? (config.notification_rules as Array<{ event_type: string; channel: string; target?: string }>) : [];

  return (
    <Card data-testid="notifications-section">
      <CardHeader>
        <CardTitle className="text-base">Notification Rules</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {rules.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4" data-testid="no-notification-rules">
            No notification rules configured. Add rules to get alerted on Symphony events.
          </p>
        ) : (
          rules.map((rule, i) => (
            <div key={i} className="flex items-center justify-between rounded-md border p-3" data-testid="notification-rule">
              <div className="text-sm">
                <span className="font-medium">{rule.event_type}</span>
                {' → '}
                <Badge variant="outline">{rule.channel}</Badge>
                {rule.target && <span className="ml-2 text-muted-foreground">({rule.target})</span>}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Advanced Section
// ---------------------------------------------------------------------------

function AdvancedSection({ config, onSave, saving }: ConfigSectionProps) {
  const [pollingInterval, setPollingInterval] = useState(String(config?.polling_interval_seconds ?? 300));
  const [maxConcurrent, setMaxConcurrent] = useState(String(config?.max_concurrent_agents ?? 3));
  const [retryMax, setRetryMax] = useState(String(config?.retry_backoff_max_seconds ?? 3600));
  const [maxRetries, setMaxRetries] = useState(String(config?.max_retry_attempts ?? 3));
  const [cancellationPolicy, setCancellationPolicy] = useState((config?.cancellation_policy as string) ?? 'graceful');

  function handleSave() {
    onSave({
      ...config,
      polling_interval_seconds: parseInt(pollingInterval, 10) || 300,
      max_concurrent_agents: parseInt(maxConcurrent, 10) || 3,
      retry_backoff_max_seconds: parseInt(retryMax, 10) || 3600,
      max_retry_attempts: parseInt(maxRetries, 10) || 3,
      cancellation_policy: cancellationPolicy,
    });
  }

  return (
    <Card data-testid="advanced-section">
      <CardHeader>
        <CardTitle className="text-base">Advanced Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="polling-interval">Polling Interval (seconds)</Label>
            <Input
              id="polling-interval"
              type="number"
              min="60"
              value={pollingInterval}
              onChange={(e) => setPollingInterval(e.target.value)}
              data-testid="polling-interval-input"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="max-concurrent">Max Concurrent Agents</Label>
            <Input
              id="max-concurrent"
              type="number"
              min="1"
              max="20"
              value={maxConcurrent}
              onChange={(e) => setMaxConcurrent(e.target.value)}
              data-testid="max-concurrent-input"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="retry-max">Retry Backoff Max (seconds)</Label>
            <Input
              id="retry-max"
              type="number"
              min="60"
              value={retryMax}
              onChange={(e) => setRetryMax(e.target.value)}
              data-testid="retry-max-input"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="max-retries">Max Retry Attempts</Label>
            <Input
              id="max-retries"
              type="number"
              min="0"
              max="10"
              value={maxRetries}
              onChange={(e) => setMaxRetries(e.target.value)}
              data-testid="max-retries-input"
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label>Cancellation Policy</Label>
          <Select value={cancellationPolicy} onValueChange={setCancellationPolicy}>
            <SelectTrigger data-testid="cancellation-policy-select"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="graceful">Graceful</SelectItem>
              <SelectItem value="immediate">Immediate</SelectItem>
              <SelectItem value="wait_for_checkpoint">Wait for Checkpoint</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={handleSave} disabled={saving} data-testid="save-advanced">
          Save Advanced Settings
        </Button>
      </CardContent>
    </Card>
  );
}
