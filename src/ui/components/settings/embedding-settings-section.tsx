import * as React from 'react';
import { useCallback, useState } from 'react';
import { Cpu, CheckCircle, XCircle, AlertTriangle, Loader2, Zap, DollarSign } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/components/ui/card';
import { Switch } from '@/ui/components/ui/switch';
import { Input } from '@/ui/components/ui/input';
import { Button } from '@/ui/components/ui/button';
import { Badge } from '@/ui/components/ui/badge';
import { Skeleton } from '@/ui/components/feedback';
import { cn } from '@/ui/lib/utils';
import { useEmbeddingSettings } from './use-embedding-settings';
import type { EmbeddingProvider, AvailableProvider, EmbeddingBudget, EmbeddingUsage, EmbeddingTestResult } from './types';

interface SettingRowProps {
  label: string;
  description?: string;
  children: React.ReactNode;
  htmlFor?: string;
}

function SettingRow({ label, description, children, htmlFor }: SettingRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="flex-1">
        <label htmlFor={htmlFor} className="text-sm font-medium">
          {label}
        </label>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function formatProviderName(name: string): string {
  const names: Record<string, string> = {
    voyageai: 'Voyage AI',
    openai: 'OpenAI',
    gemini: 'Gemini',
  };
  return names[name] || name;
}

function formatKeySource(source: string | null): string {
  if (!source) return 'Not configured';
  const sources: Record<string, string> = {
    environment: 'Environment variable',
    file: 'File',
    command: 'Command',
  };
  return sources[source] || source;
}

function formatNumber(num: number): string {
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1)}K`;
  }
  return num.toString();
}

function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

function getBudgetPercentage(spent: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.min((spent / limit) * 100, 100);
}

function getBudgetStatusColor(percentage: number): string {
  if (percentage >= 100) return 'text-destructive';
  if (percentage >= 80) return 'text-yellow-600 dark:text-yellow-500';
  return 'text-green-600 dark:text-green-500';
}

interface ProviderStatusProps {
  provider: EmbeddingProvider | null;
}

function ProviderStatus({ provider }: ProviderStatusProps) {
  if (!provider) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed p-4">
        <XCircle className="size-5 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium">No provider configured</p>
          <p className="text-xs text-muted-foreground">Set an API key for VoyageAI, OpenAI, or Gemini</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-4">
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-full bg-primary/10">
          <Cpu className="size-5 text-primary" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <p className="font-medium">{formatProviderName(provider.name)}</p>
            <Badge variant="outline" className="text-xs">
              Active
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {provider.model} ({provider.dimensions}d)
          </p>
        </div>
      </div>
      <div className="text-right text-xs text-muted-foreground">
        <p>Key source</p>
        <p className="font-medium">{formatKeySource(provider.key_source)}</p>
      </div>
    </div>
  );
}

interface ProviderListProps {
  providers: AvailableProvider[];
}

function ProviderList({ providers }: ProviderListProps) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Provider Priority</p>
      <div className="flex flex-wrap gap-2">
        {providers.map((p) => (
          <Badge key={p.name} variant={p.configured ? 'default' : 'outline'} className={cn('gap-1.5', !p.configured && 'text-muted-foreground')}>
            <span className="text-xs opacity-60">#{p.priority}</span>
            {formatProviderName(p.name)}
            {p.configured ? <CheckCircle className="size-3" /> : <XCircle className="size-3 opacity-50" />}
          </Badge>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">First configured provider will be used</p>
    </div>
  );
}

interface TestResultDisplayProps {
  result: EmbeddingTestResult;
  onDismiss: () => void;
}

function TestResultDisplay({ result, onDismiss }: TestResultDisplayProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-between rounded-lg border p-3',
        result.success
          ? 'border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950'
          : 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950',
      )}
    >
      <div className="flex items-center gap-2">
        {result.success ? <CheckCircle className="size-4 text-green-600 dark:text-green-400" /> : <XCircle className="size-4 text-red-600 dark:text-red-400" />}
        <span className="text-sm">
          {result.success ? (
            <>
              Connection successful
              {result.latency_ms && <span className="ml-1 text-muted-foreground">({result.latency_ms}ms)</span>}
            </>
          ) : (
            result.error || 'Connection failed'
          )}
        </span>
      </div>
      <Button variant="ghost" size="xs" onClick={onDismiss}>
        Dismiss
      </Button>
    </div>
  );
}

interface BudgetProgressProps {
  label: string;
  spent: number;
  limit: number;
}

function BudgetProgress({ label, spent, limit }: BudgetProgressProps) {
  const percentage = getBudgetPercentage(spent, limit);
  const statusColor = getBudgetStatusColor(percentage);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn('font-medium', statusColor)}>
          {formatCurrency(spent)} / {formatCurrency(limit)}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full transition-all', percentage >= 100 ? 'bg-destructive' : percentage >= 80 ? 'bg-yellow-500' : 'bg-green-500')}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

interface UsageStatsProps {
  usage: EmbeddingUsage;
}

function UsageStats({ usage }: UsageStatsProps) {
  return (
    <div className="grid grid-cols-3 gap-4">
      <div className="space-y-1 rounded-lg border bg-muted/30 p-3 text-center">
        <p className="text-xs text-muted-foreground">Today</p>
        <p className="text-lg font-semibold">{formatNumber(usage.today.count)}</p>
        <p className="text-xs text-muted-foreground">{formatNumber(usage.today.tokens)} tokens</p>
      </div>
      <div className="space-y-1 rounded-lg border bg-muted/30 p-3 text-center">
        <p className="text-xs text-muted-foreground">This Month</p>
        <p className="text-lg font-semibold">{formatNumber(usage.month.count)}</p>
        <p className="text-xs text-muted-foreground">{formatNumber(usage.month.tokens)} tokens</p>
      </div>
      <div className="space-y-1 rounded-lg border bg-muted/30 p-3 text-center">
        <p className="text-xs text-muted-foreground">All Time</p>
        <p className="text-lg font-semibold">{formatNumber(usage.total.count)}</p>
        <p className="text-xs text-muted-foreground">{formatNumber(usage.total.tokens)} tokens</p>
      </div>
    </div>
  );
}

interface BudgetInputProps {
  label: string;
  description: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
}

function BudgetInput({ label, description, value, onChange, min = 0, max = 10000, disabled }: BudgetInputProps) {
  const [localValue, setLocalValue] = useState(value.toString());

  const handleBlur = useCallback(() => {
    const num = parseFloat(localValue);
    if (Number.isNaN(num)) {
      setLocalValue(value.toString());
      return;
    }
    const clamped = Math.max(min, Math.min(max, num));
    setLocalValue(clamped.toString());
    if (clamped !== value) {
      onChange(clamped);
    }
  }, [localValue, value, min, max, onChange]);

  // Sync local value when external value changes
  React.useEffect(() => {
    setLocalValue(value.toString());
  }, [value]);

  return (
    <SettingRow label={label} description={description}>
      <div className="flex items-center gap-1">
        <span className="text-muted-foreground">$</span>
        <Input
          type="number"
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          onBlur={handleBlur}
          min={min}
          max={max}
          step="0.01"
          disabled={disabled}
          className="w-24 text-right"
        />
      </div>
    </SettingRow>
  );
}

export function EmbeddingSettingsSection() {
  const { state, isSaving, isTesting, testResult, updateBudget, testConnection, clearTestResult } = useEmbeddingSettings();

  if (state.kind === 'loading') {
    return (
      <Card data-testid="embedding-settings-card">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Cpu className="size-5 text-muted-foreground" />
            <CardTitle>Embeddings</CardTitle>
          </div>
          <CardDescription>Loading embedding settings...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Skeleton className="h-20" />
            <Skeleton className="h-32" />
            <Skeleton className="h-24" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (state.kind === 'error') {
    return (
      <Card data-testid="embedding-settings-card">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Cpu className="size-5 text-muted-foreground" />
            <CardTitle>Embeddings</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-4">
            <AlertTriangle className="size-5 text-destructive" />
            <div>
              <p className="text-sm font-medium text-destructive">Failed to load settings</p>
              <p className="text-xs text-muted-foreground">{state.message}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const { provider, budget, usage } = state.data;
  const available_providers = Array.isArray(state.data.available_providers) ? state.data.available_providers : [];

  return (
    <>
      {/* Provider Configuration */}
      <Card data-testid="embedding-settings-card">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Cpu className="size-5 text-muted-foreground" />
            <CardTitle>Embedding Provider</CardTitle>
          </div>
          <CardDescription>Configure the AI provider for semantic search and memory embeddings</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ProviderStatus provider={provider} />

          {testResult && <TestResultDisplay result={testResult} onDismiss={clearTestResult} />}

          <div className="flex items-center justify-between">
            <ProviderList providers={available_providers} />
            <Button variant="outline" size="sm" onClick={testConnection} disabled={!provider || isTesting}>
              {isTesting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Testing...
                </>
              ) : (
                <>
                  <Zap className="size-4" />
                  Test Connection
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Budget Management */}
      <Card data-testid="embedding-budget-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <DollarSign className="size-5 text-muted-foreground" />
              <CardTitle>Budget & Usage</CardTitle>
            </div>
            {isSaving && <span className="text-sm text-muted-foreground">Saving...</span>}
          </div>
          <CardDescription>Control embedding costs and monitor usage</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Spend Progress */}
          <div className="space-y-3">
            <BudgetProgress label="Today" spent={budget.today_spend_usd} limit={budget.daily_limit_usd} />
            <BudgetProgress label="This Month" spent={budget.month_spend_usd} limit={budget.monthly_limit_usd} />
          </div>

          {/* Budget Limits */}
          <div className="space-y-1 divide-y">
            <BudgetInput
              label="Daily Limit"
              description="Maximum spend per day"
              value={budget.daily_limit_usd}
              onChange={(v) => updateBudget({ daily_limit_usd: v })}
              max={10000}
            />
            <BudgetInput
              label="Monthly Limit"
              description="Maximum spend per month"
              value={budget.monthly_limit_usd}
              onChange={(v) => updateBudget({ monthly_limit_usd: v })}
              max={100000}
            />
            <SettingRow label="Pause on Limit" description="Stop generating embeddings when budget is exceeded" htmlFor="pause-on-limit">
              <Switch
                id="pause-on-limit"
                checked={budget.pause_on_limit}
                onCheckedChange={(checked) => updateBudget({ pause_on_limit: checked })}
                aria-label="Pause on limit"
              />
            </SettingRow>
          </div>

          {/* Usage Stats */}
          <div>
            <p className="mb-3 text-sm font-medium">Embeddings Generated</p>
            <UsageStats usage={usage} />
          </div>
        </CardContent>
      </Card>
    </>
  );
}
