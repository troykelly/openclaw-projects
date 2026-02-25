/**
 * Webhook management section for the Settings page.
 *
 * Provides CRUD for webhooks, a delivery log, and retry of failed deliveries.
 *
 * @see Issue #1733
 */
import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, ExternalLink, Loader2, Plus, RefreshCw, Trash2, Webhook } from 'lucide-react';
import { Badge } from '@/ui/components/ui/badge';
import { Button } from '@/ui/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/components/ui/card';
import { Input } from '@/ui/components/ui/input';
import { cn } from '@/ui/lib/utils';
import { apiClient } from '@/ui/lib/api-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WebhookConfig {
  id: string;
  url: string;
  events: string[];
  is_active: boolean;
  secret?: string;
  created_at: string;
}

interface WebhookDelivery {
  id: string;
  webhook_id: string;
  event_type: string;
  status: 'success' | 'failed' | 'pending';
  response_code: number | null;
  attempted_at: string;
  error_message?: string | null;
}

interface WebhookStatus {
  total: number;
  active: number;
  pending_deliveries: number;
  failed_deliveries: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WebhookManagementSection(): React.JSX.Element {
  const [webhooks, setWebhooks] = useState<WebhookConfig[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [status, setStatus] = useState<WebhookStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);

  // New webhook form
  const [showForm, setShowForm] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [statusData, webhookData] = await Promise.all([
        apiClient.get<WebhookStatus>('/api/webhooks/status'),
        apiClient.get<{ webhooks: WebhookConfig[] }>('/api/projects/default/webhooks'),
      ]);
      setStatus(statusData);
      if (Array.isArray(webhookData.webhooks)) {
        setWebhooks(webhookData.webhooks);
      }

      // Load recent deliveries
      const deliveryData = await apiClient.get<{ events: WebhookDelivery[] }>('/api/projects/default/events');
      if (Array.isArray(deliveryData.events)) {
        setDeliveries(deliveryData.events);
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

  const handleCreate = useCallback(async () => {
    if (!newUrl.trim()) return;
    setIsCreating(true);
    try {
      const created = await apiClient.post<WebhookConfig>('/api/projects/default/webhooks', {
        url: newUrl.trim(),
        events: ['*'],
        is_active: true,
      });
      setWebhooks((prev) => [...prev, created]);
      setNewUrl('');
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create webhook');
    } finally {
      setIsCreating(false);
    }
  }, [newUrl]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await apiClient.delete(`/api/projects/default/webhooks/${id}`);
      setWebhooks((prev) => prev.filter((w) => w.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete webhook');
    }
  }, []);

  const handleToggleActive = useCallback(
    async (id: string, isActive: boolean) => {
      const previous = webhooks.find((w) => w.id === id);
      if (!previous) return;

      setWebhooks((prev) => prev.map((w) => (w.id === id ? { ...w, is_active: isActive } : w)));
      try {
        await apiClient.patch(`/api/projects/default/webhooks/${id}`, { is_active: isActive });
      } catch {
        setWebhooks((prev) => prev.map((w) => (w.id === id ? { ...w, is_active: previous.is_active } : w)));
      }
    },
    [webhooks],
  );

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

  const getStatusIcon = (deliveryStatus: string) => {
    switch (deliveryStatus) {
      case 'success':
        return <CheckCircle2 className="size-4 text-green-500" />;
      case 'failed':
        return <AlertTriangle className="size-4 text-red-500" />;
      case 'pending':
        return <Clock className="size-4 text-amber-500" />;
      default:
        return <Clock className="size-4 text-muted-foreground" />;
    }
  };

  if (isLoading) {
    return (
      <Card data-testid="webhook-management-section">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Webhook className="size-5 text-muted-foreground" />
            <CardTitle>Webhooks</CardTitle>
          </div>
          <CardDescription>Manage outbound webhook integrations</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6" data-testid="webhook-management-section">
      {/* Status overview */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Webhook className="size-5 text-muted-foreground" />
              <CardTitle>Webhooks</CardTitle>
            </div>
            <Button variant="outline" size="sm" onClick={() => setShowForm(true)} data-testid="webhook-add-btn">
              <Plus className="mr-1 size-3.5" />
              Add webhook
            </Button>
          </div>
          <CardDescription>Manage outbound webhook integrations</CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive" data-testid="webhook-error">
              {error}
            </div>
          )}

          {/* Status cards */}
          {status && (
            <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border p-3 text-center">
                <p className="text-2xl font-semibold">{status.total}</p>
                <p className="text-xs text-muted-foreground">Total</p>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <p className="text-2xl font-semibold text-green-600">{status.active}</p>
                <p className="text-xs text-muted-foreground">Active</p>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <p className="text-2xl font-semibold text-amber-600">{status.pending_deliveries}</p>
                <p className="text-xs text-muted-foreground">Pending</p>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <p className="text-2xl font-semibold text-red-600">{status.failed_deliveries}</p>
                <p className="text-xs text-muted-foreground">Failed</p>
              </div>
            </div>
          )}

          {/* Add webhook form */}
          {showForm && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border bg-muted/30 p-3" data-testid="webhook-create-form">
              <Input
                type="url"
                placeholder="https://example.com/webhook"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                className="flex-1"
                data-testid="webhook-url-input"
              />
              <Button size="sm" onClick={handleCreate} disabled={isCreating || !newUrl.trim()} data-testid="webhook-create-btn">
                {isCreating ? <Loader2 className="size-4 animate-spin" /> : 'Add'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
            </div>
          )}

          {/* Webhook list */}
          {webhooks.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No webhooks configured. Add one to get started.</p>
          ) : (
            <div className="space-y-2">
              {webhooks.map((webhook) => (
                <div key={webhook.id} className="flex items-center justify-between rounded-lg border p-3" data-testid="webhook-item">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className={cn('size-2 rounded-full shrink-0', webhook.is_active ? 'bg-green-500' : 'bg-gray-400')} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate flex items-center gap-1">
                        {webhook.url}
                        <ExternalLink className="size-3 text-muted-foreground shrink-0" />
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Events: {webhook.events.join(', ')}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={webhook.is_active ? 'default' : 'secondary'} className="text-xs cursor-pointer" onClick={() => handleToggleActive(webhook.id, !webhook.is_active)}>
                      {webhook.is_active ? 'Active' : 'Paused'}
                    </Badge>
                    <Button variant="ghost" size="sm" className="size-7 p-0" onClick={() => handleDelete(webhook.id)} aria-label="Delete webhook">
                      <Trash2 className="size-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delivery log */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Delivery Log</CardTitle>
            {(status?.failed_deliveries ?? 0) > 0 && (
              <Button variant="outline" size="sm" onClick={handleRetryFailed} disabled={isRetrying} data-testid="webhook-retry-btn">
                <RefreshCw className={cn('mr-1 size-3.5', isRetrying && 'animate-spin')} />
                Retry failed
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {deliveries.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No delivery events yet.</p>
          ) : (
            <div className="space-y-1">
              {deliveries.slice(0, 20).map((delivery) => (
                <div key={delivery.id} className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm" data-testid="delivery-item">
                  {getStatusIcon(delivery.status)}
                  <span className="text-xs font-medium min-w-[80px]">{delivery.event_type}</span>
                  {delivery.response_code && (
                    <Badge variant={delivery.response_code < 400 ? 'outline' : 'destructive'} className="text-xs">
                      {delivery.response_code}
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground ml-auto">
                    {new Date(delivery.attempted_at).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
