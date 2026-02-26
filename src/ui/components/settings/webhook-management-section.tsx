/**
 * Webhook management section for the Settings page.
 *
 * Shows global webhook status overview and retry controls.
 * Project-scoped webhook CRUD is available on individual project pages.
 *
 * @see Issue #1733, #1832
 */
import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, Webhook } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/components/ui/card';
import { cn } from '@/ui/lib/utils';
import { apiClient } from '@/ui/lib/api-client';

// ---------------------------------------------------------------------------
// Types — matches GET /api/webhooks/status response shape
// ---------------------------------------------------------------------------

interface WebhookStatusResponse {
  configured: boolean;
  gateway_url: string | null;
  has_token: boolean;
  default_model: string | null;
  timeout_seconds: number;
  stats: {
    pending: number;
    failed: number;
    dispatched: number;
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WebhookManagementSection(): React.JSX.Element {
  const [status, setStatus] = useState<WebhookStatusResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const data = await apiClient.get<WebhookStatusResponse>('/api/webhooks/status');
      if (data && typeof data.configured === 'boolean') {
        setStatus(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load webhook data');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRetryFailed = useCallback(async () => {
    setIsRetrying(true);
    try {
      await apiClient.post('/api/webhooks/process', {});
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retry webhooks');
    } finally {
      setIsRetrying(false);
    }
  }, [loadData]);

  if (isLoading) {
    return (
      <Card data-testid="webhook-management-section">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Webhook className="size-5 text-muted-foreground" />
            <CardTitle>Webhooks</CardTitle>
          </div>
          <CardDescription>Webhook delivery status overview</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const failedCount = status?.stats?.failed ?? 0;

  return (
    <Card data-testid="webhook-management-section">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Webhook className="size-5 text-muted-foreground" />
            <CardTitle>Webhooks</CardTitle>
          </div>
          {failedCount > 0 && (
            <Button variant="outline" size="sm" onClick={handleRetryFailed} disabled={isRetrying} data-testid="webhook-retry-btn">
              <RefreshCw className={cn('mr-1 size-3.5', isRetrying && 'animate-spin')} />
              Retry failed
            </Button>
          )}
        </div>
        <CardDescription>Webhook delivery status overview</CardDescription>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive" data-testid="webhook-error">
            {error}
          </div>
        )}

        {status && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border p-3 text-center">
              <p className="text-2xl font-semibold">{status.configured ? 'Yes' : 'No'}</p>
              <p className="text-xs text-muted-foreground">Configured</p>
            </div>
            <div className="rounded-lg border p-3 text-center">
              <p className="text-2xl font-semibold text-green-600">{status.stats.dispatched}</p>
              <p className="text-xs text-muted-foreground">Dispatched</p>
            </div>
            <div className="rounded-lg border p-3 text-center">
              <p className="text-2xl font-semibold text-amber-600">{status.stats.pending}</p>
              <p className="text-xs text-muted-foreground">Pending</p>
            </div>
            <div className="rounded-lg border p-3 text-center">
              <p className="text-2xl font-semibold text-red-600">{status.stats.failed}</p>
              <p className="text-xs text-muted-foreground">Failed</p>
            </div>
          </div>
        )}

        {!status && !error && (
          <p className="text-sm text-muted-foreground py-4 text-center">No webhooks configured.</p>
        )}
      </CardContent>
    </Card>
  );
}
