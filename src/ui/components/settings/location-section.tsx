/**
 * Location settings section.
 *
 * Displays the current geolocation, lists configured providers with
 * status badges, and provides controls for auto-inject and data retention.
 * Follows the same Card/CardHeader/CardContent pattern as other settings sections.
 */

import * as React from 'react';
import { useState, useCallback } from 'react';
import {
  MapPin,
  Plus,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Radio,
  Wifi,
  WifiOff,
  Loader2,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/components/ui/card';
import { Switch } from '@/ui/components/ui/switch';
import { Input } from '@/ui/components/ui/input';
import { Button } from '@/ui/components/ui/button';
import { Badge } from '@/ui/components/ui/badge';
import { Skeleton } from '@/ui/components/feedback';
import { Label } from '@/ui/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/ui/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/ui/components/ui/dialog';
import { cn } from '@/ui/lib/utils';
import {
  useGeoProviders,
  useCurrentLocation,
  useGeoMutations,
} from './use-geolocation';
import type {
  GeoProvider,
  GeoProviderType,
  GeoProviderStatus,
  GeoLocation,
  CreateProviderPayload,
  VerifyResult,
} from './use-geolocation';
import type { SettingsUpdatePayload } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a provider type for display. */
function formatProviderType(type: GeoProviderType): string {
  const names: Record<GeoProviderType, string> = {
    home_assistant: 'Home Assistant',
    mqtt: 'MQTT',
    webhook: 'Webhook',
  };
  return names[type] ?? type;
}

/** Badge variant/colour for a provider status. */
function statusBadgeProps(status: GeoProviderStatus): {
  variant: 'default' | 'secondary' | 'outline' | 'destructive';
  className: string;
  label: string;
} {
  switch (status) {
    case 'active':
      return { variant: 'default', className: 'bg-green-600', label: 'Active' };
    case 'error':
      return { variant: 'destructive', className: '', label: 'Error' };
    case 'disconnected':
      return { variant: 'outline', className: 'border-yellow-500 text-yellow-600 dark:text-yellow-400', label: 'Disconnected' };
    case 'pending':
      return { variant: 'secondary', className: '', label: 'Pending' };
  }
}

/** Render a relative time string from an ISO date. */
function relativeTime(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;

  if (diffMs < 0) return 'just now';
  if (diffMs < 60_000) return 'just now';
  if (diffMs < 3_600_000) {
    const mins = Math.floor(diffMs / 60_000);
    return `${mins}m ago`;
  }
  if (diffMs < 86_400_000) {
    const hours = Math.floor(diffMs / 3_600_000);
    return `${hours}h ago`;
  }
  const days = Math.floor(diffMs / 86_400_000);
  return `${days}d ago`;
}

/** Status icon for a provider. */
function StatusIcon({ status }: { status: GeoProviderStatus }) {
  switch (status) {
    case 'active':
      return <Wifi className="size-4 text-green-600" />;
    case 'error':
      return <AlertTriangle className="size-4 text-destructive" />;
    case 'disconnected':
      return <WifiOff className="size-4 text-yellow-600 dark:text-yellow-400" />;
    case 'pending':
      return <Clock className="size-4 text-muted-foreground" />;
  }
}

// ---------------------------------------------------------------------------
// Current Location Card
// ---------------------------------------------------------------------------

interface CurrentLocationCardProps {
  location: GeoLocation | null;
  isLoading: boolean;
}

function CurrentLocationCard({ location, isLoading }: CurrentLocationCardProps) {
  if (isLoading) {
    return (
      <div className="rounded-lg border p-4 space-y-2" data-testid="current-location-loading">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-3 w-32" />
      </div>
    );
  }

  if (!location) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center" data-testid="current-location-empty">
        <MapPin className="mx-auto size-8 text-muted-foreground" />
        <p className="mt-2 text-sm font-medium">No location available</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Add a geolocation provider to start tracking your location.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border p-4" data-testid="current-location-card">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <MapPin className="size-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          {location.place_label && (
            <p className="text-sm font-semibold" data-testid="location-place-label">
              {location.place_label}
            </p>
          )}
          {location.address && (
            <p className="text-sm text-muted-foreground" data-testid="location-address">
              {location.address}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span data-testid="location-coords">
              {location.lat.toFixed(6)}, {location.lng.toFixed(6)}
            </span>
            {location.accuracyM != null && (
              <>
                <span className="text-border">|</span>
                <span data-testid="location-accuracy">
                  {location.accuracyM < 1000
                    ? `${Math.round(location.accuracyM)}m accuracy`
                    : `${(location.accuracyM / 1000).toFixed(1)}km accuracy`}
                </span>
              </>
            )}
            <span className="text-border">|</span>
            <span data-testid="location-freshness">{relativeTime(location.time)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Provider Card
// ---------------------------------------------------------------------------

interface ProviderCardProps {
  provider: GeoProvider;
  onDelete: (id: string) => Promise<boolean>;
  onVerify: (id: string) => Promise<VerifyResult>;
  isSubmitting: boolean;
}

function ProviderCard({ provider, onDelete, onVerify, isSubmitting }: ProviderCardProps) {
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  const handleVerify = useCallback(async () => {
    setIsVerifying(true);
    try {
      const result = await onVerify(provider.id);
      setVerifyResult(result);
    } catch {
      setVerifyResult({ success: false, message: 'Verification failed', entities: [] });
    } finally {
      setIsVerifying(false);
    }
  }, [provider.id, onVerify]);

  const badge = statusBadgeProps(provider.status);

  return (
    <div className="rounded-lg border p-4" data-testid={`provider-card-${provider.id}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <StatusIcon status={provider.status} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-sm font-semibold">{provider.label}</h4>
              <Badge variant="outline" className="text-xs">
                {formatProviderType(provider.providerType)}
              </Badge>
              <Badge variant={badge.variant} className={cn('text-xs', badge.className)}>
                {badge.label}
              </Badge>
            </div>
            {provider.statusMessage && (
              <p className="mt-0.5 text-xs text-muted-foreground">{provider.statusMessage}</p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              Last seen: {relativeTime(provider.lastSeenAt)}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleVerify}
            disabled={isSubmitting || isVerifying}
            data-testid={`verify-provider-${provider.id}`}
          >
            {isVerifying ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Radio className="size-4" />
            )}
            <span className="sr-only sm:not-sr-only sm:ml-1">Verify</span>
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-destructive hover:text-destructive"
                disabled={isSubmitting}
                data-testid={`delete-provider-${provider.id}`}
              >
                <Trash2 className="size-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove provider?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently remove the &ldquo;{provider.label}&rdquo; ({formatProviderType(provider.providerType)}) provider.
                  Location data already collected will be retained according to your retention settings.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => onDelete(provider.id)}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  data-testid={`confirm-delete-provider-${provider.id}`}
                >
                  Remove
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Verify result feedback */}
      {verifyResult && (
        <div
          className={cn(
            'mt-3 rounded-md p-3 text-sm',
            verifyResult.success
              ? 'bg-green-50 text-green-800 dark:bg-green-950/30 dark:text-green-300'
              : 'bg-destructive/10 text-destructive',
          )}
          data-testid={`verify-result-${provider.id}`}
        >
          <div className="flex items-center gap-2">
            {verifyResult.success ? (
              <CheckCircle2 className="size-4 shrink-0" />
            ) : (
              <AlertTriangle className="size-4 shrink-0" />
            )}
            <span>{verifyResult.message}</span>
          </div>
          {verifyResult.success && verifyResult.entities.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {verifyResult.entities.map((entity) => (
                <Badge key={entity.id} variant="outline" className="text-xs">
                  {entity.name}
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add Provider Dialog
// ---------------------------------------------------------------------------

interface AddProviderFormState {
  providerType: GeoProviderType;
  label: string;
  /** Home Assistant fields */
  haUrl: string;
  haAccessToken: string;
  /** MQTT fields */
  mqttHost: string;
  mqttPort: string;
  mqttFormat: string;
  mqttTopics: string;
}

const INITIAL_FORM_STATE: AddProviderFormState = {
  providerType: 'home_assistant',
  label: '',
  haUrl: '',
  haAccessToken: '',
  mqttHost: '',
  mqttPort: '1883',
  mqttFormat: 'json',
  mqttTopics: '',
};

interface AddProviderDialogProps {
  onCreate: (payload: CreateProviderPayload) => Promise<GeoProvider>;
  onCreated: () => void;
  isSubmitting: boolean;
}

function AddProviderDialog({ onCreate, onCreated, isSubmitting }: AddProviderDialogProps) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<AddProviderFormState>(INITIAL_FORM_STATE);
  const [error, setError] = useState<string | null>(null);
  const [createdWebhookToken, setCreatedWebhookToken] = useState<string | null>(null);

  const handleOpen = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      // Reset on close
      setForm(INITIAL_FORM_STATE);
      setError(null);
      setCreatedWebhookToken(null);
    }
  }, []);

  const updateField = useCallback(
    <K extends keyof AddProviderFormState>(key: K, value: AddProviderFormState[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const handleSubmit = useCallback(async () => {
    setError(null);

    if (!form.label.trim()) {
      setError('Label is required');
      return;
    }

    let config: Record<string, unknown> = {};

    if (form.providerType === 'home_assistant') {
      if (!form.haUrl.trim()) {
        setError('Home Assistant URL is required');
        return;
      }
      if (!form.haAccessToken.trim()) {
        setError('Access token is required');
        return;
      }
      config = {
        url: form.haUrl.trim(),
        access_token: form.haAccessToken.trim(),
      };
    } else if (form.providerType === 'mqtt') {
      if (!form.mqttHost.trim()) {
        setError('MQTT host is required');
        return;
      }
      config = {
        host: form.mqttHost.trim(),
        port: Number.parseInt(form.mqttPort, 10) || 1883,
        format: form.mqttFormat,
        topics: form.mqttTopics
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      };
    }
    // webhook needs no extra config — server generates token

    try {
      const provider = await onCreate({
        providerType: form.providerType,
        label: form.label.trim(),
        config,
      });

      // For webhook providers, show the credentials (token) after creation
      if (form.providerType === 'webhook' && provider.credentials) {
        setCreatedWebhookToken(provider.credentials);
      } else {
        handleOpen(false);
      }
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create provider');
    }
  }, [form, onCreate, onCreated, handleOpen]);

  /** Close the dialog after webhook token has been shown. */
  const handleWebhookDone = useCallback(() => {
    setCreatedWebhookToken(null);
    handleOpen(false);
  }, [handleOpen]);

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <Button size="sm" data-testid="add-provider-btn">
          <Plus className="size-4" />
          Add Provider
        </Button>
      </DialogTrigger>
      <DialogContent data-testid="add-provider-dialog">
        {createdWebhookToken ? (
          <>
            <DialogHeader>
              <DialogTitle>Webhook Token</DialogTitle>
              <DialogDescription>
                Copy this token now. It will not be shown again.
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-md border bg-muted p-3 font-mono text-xs break-all" data-testid="webhook-token">
              {createdWebhookToken}
            </div>
            <DialogFooter>
              <Button onClick={handleWebhookDone} data-testid="webhook-done-btn">
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Add Geolocation Provider</DialogTitle>
              <DialogDescription>
                Configure a new source for location data.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {/* Provider type */}
              <div className="space-y-2">
                <Label htmlFor="provider-type">Provider Type</Label>
                <Select
                  value={form.providerType}
                  onValueChange={(v) => updateField('providerType', v as GeoProviderType)}
                >
                  <SelectTrigger id="provider-type" data-testid="provider-type-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="home_assistant">Home Assistant</SelectItem>
                    <SelectItem value="mqtt">MQTT</SelectItem>
                    <SelectItem value="webhook">Webhook</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Label */}
              <div className="space-y-2">
                <Label htmlFor="provider-label">Label</Label>
                <Input
                  id="provider-label"
                  value={form.label}
                  onChange={(e) => updateField('label', e.target.value)}
                  placeholder="e.g. Home Lab, Phone Tracker"
                  data-testid="provider-label-input"
                />
              </div>

              {/* Home Assistant config */}
              {form.providerType === 'home_assistant' && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="ha-url">Home Assistant URL</Label>
                    <Input
                      id="ha-url"
                      value={form.haUrl}
                      onChange={(e) => updateField('haUrl', e.target.value)}
                      placeholder="https://homeassistant.local:8123"
                      data-testid="ha-url-input"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ha-token">Access Token</Label>
                    <Input
                      id="ha-token"
                      type="password"
                      value={form.haAccessToken}
                      onChange={(e) => updateField('haAccessToken', e.target.value)}
                      placeholder="Long-lived access token"
                      data-testid="ha-token-input"
                    />
                  </div>
                </>
              )}

              {/* MQTT config */}
              {form.providerType === 'mqtt' && (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2 space-y-2">
                      <Label htmlFor="mqtt-host">Host</Label>
                      <Input
                        id="mqtt-host"
                        value={form.mqttHost}
                        onChange={(e) => updateField('mqttHost', e.target.value)}
                        placeholder="mqtt.example.com"
                        data-testid="mqtt-host-input"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="mqtt-port">Port</Label>
                      <Input
                        id="mqtt-port"
                        type="number"
                        value={form.mqttPort}
                        onChange={(e) => updateField('mqttPort', e.target.value)}
                        data-testid="mqtt-port-input"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="mqtt-format">Message Format</Label>
                    <Select
                      value={form.mqttFormat}
                      onValueChange={(v) => updateField('mqttFormat', v)}
                    >
                      <SelectTrigger id="mqtt-format" data-testid="mqtt-format-select">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="json">JSON</SelectItem>
                        <SelectItem value="owntracks">OwnTracks</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="mqtt-topics">Topics (comma-separated)</Label>
                    <Input
                      id="mqtt-topics"
                      value={form.mqttTopics}
                      onChange={(e) => updateField('mqttTopics', e.target.value)}
                      placeholder="location/phone, owntracks/user/device"
                      data-testid="mqtt-topics-input"
                    />
                  </div>
                </>
              )}

              {/* Webhook info */}
              {form.providerType === 'webhook' && (
                <div className="rounded-md border border-dashed bg-muted/20 p-4 text-center text-sm text-muted-foreground">
                  A webhook URL and token will be generated after creation. You can then configure your
                  device or service to POST location updates to the webhook endpoint.
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive" data-testid="add-provider-error">
                  <AlertTriangle className="size-4 shrink-0" />
                  {error}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button
                onClick={handleSubmit}
                disabled={isSubmitting}
                data-testid="submit-provider-btn"
              >
                {isSubmitting && <Loader2 className="size-4 animate-spin" />}
                Create Provider
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main Section
// ---------------------------------------------------------------------------

export interface LocationSectionProps {
  geoAutoInject: boolean;
  geoHighResRetentionHours: number;
  geoGeneralRetentionDays: number;
  onUpdate: (updates: SettingsUpdatePayload) => Promise<boolean>;
}

/**
 * Location settings section for the settings page.
 *
 * Renders auto-inject toggle, current location display, provider list
 * with CRUD, and data retention controls.
 */
export function LocationSection({
  geoAutoInject,
  geoHighResRetentionHours,
  geoGeneralRetentionDays,
  onUpdate,
}: LocationSectionProps) {
  const { state: providersState, refetch } = useGeoProviders();
  const { state: locationState } = useCurrentLocation();
  const { createProvider, deleteProvider, verifyProvider, isSubmitting } = useGeoMutations();

  const [retentionHours, setRetentionHours] = useState(String(geoHighResRetentionHours));
  const [retention_days, setRetentionDays] = useState(String(geoGeneralRetentionDays));

  /** Handle delete with optimistic list update via refetch. */
  const handleDelete = useCallback(
    async (id: string): Promise<boolean> => {
      const success = await deleteProvider(id);
      if (success) {
        await refetch();
      }
      return success;
    },
    [deleteProvider, refetch],
  );

  /** Persist retention hours on blur. */
  const handleRetentionHoursBlur = useCallback(() => {
    const parsed = Math.max(1, Number.parseInt(retentionHours, 10) || 1);
    setRetentionHours(String(parsed));
    onUpdate({ geo_high_res_retention_hours: parsed });
  }, [retentionHours, onUpdate]);

  /** Persist retention days on blur. */
  const handleRetentionDaysBlur = useCallback(() => {
    const parsed = Math.max(1, Number.parseInt(retention_days, 10) || 1);
    setRetentionDays(String(parsed));
    onUpdate({ geo_general_retention_days: parsed });
  }, [retention_days, onUpdate]);

  return (
    <div className="space-y-6" data-testid="location-section">
      {/* Auto-inject + Current Location */}
      <Card data-testid="settings-card">
        <CardHeader>
          <div className="flex items-center gap-2">
            <MapPin className="size-5 text-muted-foreground" />
            <CardTitle>Location</CardTitle>
          </div>
          <CardDescription>
            Manage geolocation providers and control how location data is used
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Auto-inject toggle */}
          <div className="flex items-center justify-between gap-4" data-testid="auto-inject-row">
            <div className="flex-1">
              <label htmlFor="geo-auto-inject" className="text-sm font-medium">
                Auto-inject location
              </label>
              <p className="text-sm text-muted-foreground">
                Automatically inject your current location into memories and context when available
              </p>
            </div>
            <Switch
              id="geo-auto-inject"
              checked={geoAutoInject}
              onCheckedChange={(checked) => onUpdate({ geo_auto_inject: checked })}
              aria-label="Auto-inject location"
              data-testid="auto-inject-switch"
            />
          </div>

          {/* Current location */}
          <div>
            <h4 className="mb-2 text-sm font-medium">Current Location</h4>
            <CurrentLocationCard
              location={locationState.kind === 'loaded' ? locationState.location : null}
              isLoading={locationState.kind === 'loading'}
            />
            {locationState.kind === 'error' && (
              <div className="mt-2 flex items-center gap-2 text-sm text-destructive" data-testid="location-error">
                <AlertTriangle className="size-4" />
                {locationState.message}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Providers */}
      <Card data-testid="providers-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Radio className="size-5 text-muted-foreground" />
              <CardTitle>Providers</CardTitle>
            </div>
            <AddProviderDialog
              onCreate={createProvider}
              onCreated={refetch}
              isSubmitting={isSubmitting}
            />
          </div>
          <CardDescription>
            Sources that report your location. Add a provider to start tracking.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {providersState.kind === 'loading' && (
            <div className="space-y-3">
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </div>
          )}

          {providersState.kind === 'error' && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-4" data-testid="providers-error">
              <AlertTriangle className="size-5 text-destructive" />
              <div>
                <p className="text-sm font-medium text-destructive">Failed to load providers</p>
                <p className="text-xs text-muted-foreground">{providersState.message}</p>
              </div>
            </div>
          )}

          {providersState.kind === 'loaded' && providersState.providers.length === 0 && (
            <div className="rounded-lg border border-dashed p-8 text-center" data-testid="no-providers">
              <MapPin className="mx-auto size-8 text-muted-foreground" />
              <h3 className="mt-3 text-sm font-medium">No providers configured</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Add a Home Assistant, MQTT, or Webhook provider to start receiving location updates.
              </p>
            </div>
          )}

          {providersState.kind === 'loaded' && providersState.providers.length > 0 && (
            <div className="space-y-3" data-testid="providers-list">
              {providersState.providers.map((provider) => (
                <ProviderCard
                  key={provider.id}
                  provider={provider}
                  onDelete={handleDelete}
                  onVerify={verifyProvider}
                  isSubmitting={isSubmitting}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Data Retention */}
      <Card data-testid="retention-card">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Clock className="size-5 text-muted-foreground" />
            <CardTitle>Data Retention</CardTitle>
          </div>
          <CardDescription>
            Control how long location data is stored. High-resolution data includes precise coordinates; general data is aggregated.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1">
              <Label htmlFor="retention-hours" className="text-sm font-medium">
                High-resolution retention
              </Label>
              <p className="text-sm text-muted-foreground">
                Hours to keep precise coordinate data
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                id="retention-hours"
                type="number"
                min={1}
                value={retentionHours}
                onChange={(e) => setRetentionHours(e.target.value)}
                onBlur={handleRetentionHoursBlur}
                className="w-24 text-right"
                data-testid="retention-hours-input"
              />
              <span className="text-sm text-muted-foreground">hours</span>
            </div>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="flex-1">
              <Label htmlFor="retention-days" className="text-sm font-medium">
                General retention
              </Label>
              <p className="text-sm text-muted-foreground">
                Days to keep aggregated location data
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                id="retention-days"
                type="number"
                min={1}
                value={retention_days}
                onChange={(e) => setRetentionDays(e.target.value)}
                onBlur={handleRetentionDaysBlur}
                className="w-24 text-right"
                data-testid="retention-days-input"
              />
              <span className="text-sm text-muted-foreground">days</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
