/**
 * Main management panel for a connected OAuth account.
 *
 * Opens as a slide-over sheet from the connection card "Manage" button.
 * Allows editing: label, active status, permission level, enabled features.
 * Detects when scope upgrades are needed and shows re-authorization flow.
 */
import { useState, useCallback } from 'react';
import { Settings, ExternalLink } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/ui/components/ui/sheet';
import { Input } from '@/ui/components/ui/input';
import { Button } from '@/ui/components/ui/button';
import { Switch } from '@/ui/components/ui/switch';
import { Separator } from '@/ui/components/ui/separator';
import { Badge } from '@/ui/components/ui/badge';
import { apiClient } from '@/ui/lib/api-client';
import { validateReAuthUrl } from '@/ui/lib/validation';
import { FeatureToggle } from './feature-toggle';
import { PermissionLevelSelector } from './permission-level-selector';
import { SyncStatusDisplay } from './sync-status-display';
import type { FeatureSyncInfo } from './sync-status-display';
import {
  OAUTH_FEATURES,
  type OAuthConnectionSummary,
  type OAuthFeature,
  type OAuthPermissionLevel,
} from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROVIDER_NAMES: Record<string, string> = {
  google: 'Google',
  microsoft: 'Microsoft',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PatchResponse {
  connection: OAuthConnectionSummary;
  reAuthRequired?: boolean;
  reAuthUrl?: string;
  missingScopes?: string[];
}

export interface ConnectionManagePanelProps {
  connection: OAuthConnectionSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnectionUpdated: (connection: OAuthConnectionSummary) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ConnectionManagePanel({
  connection,
  open,
  onOpenChange,
  onConnectionUpdated,
}: ConnectionManagePanelProps) {
  const [label, setLabel] = useState(connection.label);
  const [is_active, setIsActive] = useState(connection.is_active);
  const [permission_level, setPermissionLevel] = useState<OAuthPermissionLevel>(connection.permission_level);
  const [enabled_features, setEnabledFeatures] = useState<OAuthFeature[]>(
    Array.isArray(connection.enabled_features) ? [...connection.enabled_features] : [],
  );
  const [sync_status, setSyncStatus] = useState<Record<string, FeatureSyncInfo | undefined>>(
    connection.sync_status as Record<string, FeatureSyncInfo | undefined>,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [reAuthUrl, setReAuthUrl] = useState<string | null>(null);
  const [reAuthError, setReAuthError] = useState(false);

  const providerName = PROVIDER_NAMES[connection.provider] ?? connection.provider;

  /** Optimistic save helper. */
  const saveUpdate = useCallback(
    async (updates: Record<string, unknown>) => {
      setIsSaving(true);
      setReAuthUrl(null);
      setReAuthError(false);
      try {
        const res = await apiClient.patch<PatchResponse>(
          `/api/oauth/connections/${connection.id}`,
          updates,
        );
        onConnectionUpdated(res.connection);
        if (res.reAuthRequired) {
          const validated = res.reAuthUrl ? validateReAuthUrl(res.reAuthUrl) : null;
          if (validated) {
            setReAuthUrl(validated);
          } else {
            setReAuthError(true);
          }
        }
        return res;
      } catch {
        // Revert optimistic state on error
        setLabel(connection.label);
        setIsActive(connection.is_active);
        setPermissionLevel(connection.permission_level);
        setEnabledFeatures(Array.isArray(connection.enabled_features) ? [...connection.enabled_features] : []);
        return null;
      } finally {
        setIsSaving(false);
      }
    },
    [connection, onConnectionUpdated],
  );

  const handleLabelBlur = useCallback(() => {
    const trimmed = label.trim();
    if (trimmed && trimmed !== connection.label) {
      saveUpdate({ label: trimmed });
    }
  }, [label, connection.label, saveUpdate]);

  const handleActiveToggle = useCallback(
    (checked: boolean) => {
      setIsActive(checked);
      saveUpdate({ is_active: checked });
    },
    [saveUpdate],
  );

  const handlePermissionChange = useCallback(
    (level: OAuthPermissionLevel) => {
      setPermissionLevel(level);
      saveUpdate({ permission_level: level });
    },
    [saveUpdate],
  );

  const handleFeatureToggle = useCallback(
    (feature: OAuthFeature, enabled: boolean) => {
      const updated = enabled
        ? [...enabled_features, feature]
        : enabled_features.filter((f) => f !== feature);
      setEnabledFeatures(updated);
      saveUpdate({ enabled_features: updated });
    },
    [enabled_features, saveUpdate],
  );

  const handleSyncNow = useCallback(
    async (feature: OAuthFeature) => {
      setSyncStatus((prev) => ({
        ...prev,
        [feature]: { last_sync_at: prev[feature]?.last_sync_at ?? null, status: 'syncing' as const },
      }));
      try {
        await apiClient.post(`/api/sync/${feature}`, { connection_id: connection.id });
        setSyncStatus((prev) => ({
          ...prev,
          [feature]: { last_sync_at: new Date().toISOString(), status: 'idle' as const },
        }));
      } catch {
        setSyncStatus((prev) => ({
          ...prev,
          [feature]: { last_sync_at: prev[feature]?.last_sync_at ?? null, status: 'error' as const, error: 'Sync failed' },
        }));
      }
    },
    [connection.id],
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Settings className="size-5" />
            Manage Connection
          </SheetTitle>
          <SheetDescription>
            Configure permissions and features for this {providerName} account.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 px-4 pb-8">
          {/* Provider info (read-only) */}
          <div className="flex items-center gap-3">
            <ProviderIcon provider={connection.provider} />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{providerName}</span>
                <Badge variant="outline" className="text-xs">
                  {is_active ? 'Active' : 'Inactive'}
                </Badge>
              </div>
              {connection.provider_account_email && (
                <p className="text-sm text-muted-foreground">{connection.provider_account_email}</p>
              )}
            </div>
          </div>

          <Separator />

          {/* Label (editable) */}
          <div className="space-y-2">
            <label htmlFor="connection-label" className="text-sm font-medium">
              Label
            </label>
            <Input
              id="connection-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onBlur={handleLabelBlur}
              placeholder="e.g. Work Gmail, Personal Microsoft"
              disabled={isSaving}
            />
          </div>

          {/* Active toggle */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium">Connection Active</div>
              <p className="text-xs text-muted-foreground">
                Disable to pause all sync and access for this connection
              </p>
            </div>
            <Switch
              checked={is_active}
              onCheckedChange={handleActiveToggle}
              disabled={isSaving}
              data-testid="active-toggle"
            />
          </div>

          <Separator />

          {/* Permission level */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Permission Level</label>
            <PermissionLevelSelector
              value={permission_level}
              onChange={handlePermissionChange}
              enabled_features={enabled_features}
              isDisabled={isSaving}
            />
          </div>

          <Separator />

          {/* Feature toggles */}
          <div className="space-y-3">
            <label className="text-sm font-medium">Features</label>
            {OAUTH_FEATURES.map((feature) => (
              <FeatureToggle
                key={feature}
                feature={feature}
                enabled={enabled_features.includes(feature)}
                currentScopes={connection.scopes}
                provider={connection.provider}
                permission_level={permission_level}
                onToggle={handleFeatureToggle}
                isDisabled={isSaving}
              />
            ))}
          </div>

          {/* Re-auth button */}
          {reAuthUrl && (
            <div data-testid="reauth-button">
              <Button asChild className="w-full">
                <a href={reAuthUrl} rel="noopener noreferrer">
                  <ExternalLink className="size-4" />
                  Save &amp; Authorize
                </a>
              </Button>
              <p className="mt-1 text-xs text-center text-muted-foreground">
                You will be redirected to {providerName} to grant additional permissions
              </p>
            </div>
          )}
          {reAuthError && (
            <div data-testid="reauth-url-error" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              Re-authorization is required but the redirect URL is invalid. Please contact support.
            </div>
          )}

          <Separator />

          {/* Sync status */}
          <div className="space-y-3" data-testid="sync-status-section">
            <label className="text-sm font-medium">Sync Status</label>
            <SyncStatusDisplay
              enabled_features={enabled_features}
              sync_status={sync_status}
              onSyncNow={handleSyncNow}
            />
            {enabled_features.length === 0 && (
              <p className="text-xs text-muted-foreground italic">
                Enable features above to see sync status
              </p>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// ProviderIcon (standalone to avoid circular import)
// ---------------------------------------------------------------------------

function ProviderIcon({ provider }: { provider: string }) {
  const colors: Record<string, string> = {
    google: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    microsoft: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  };

  return (
    <div
      className={`flex size-10 items-center justify-center rounded-full text-sm font-bold ${colors[provider] ?? 'bg-muted text-muted-foreground'}`}
    >
      {provider === 'google' ? 'G' : provider === 'microsoft' ? 'M' : provider.charAt(0).toUpperCase()}
    </div>
  );
}
