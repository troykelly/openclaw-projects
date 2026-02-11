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
import { FeatureToggle } from './feature-toggle';
import { PermissionLevelSelector } from './permission-level-selector';
import { SyncStatusDisplay } from './sync-status-display';
import type { FeatureSyncInfo } from './sync-status-display';
import type {
  OAuthConnectionSummary,
  OAuthFeature,
  OAuthPermissionLevel,
} from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALL_FEATURES: OAuthFeature[] = ['contacts', 'email', 'files', 'calendar'];

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
  const [isActive, setIsActive] = useState(connection.isActive);
  const [permissionLevel, setPermissionLevel] = useState<OAuthPermissionLevel>(connection.permissionLevel);
  const [enabledFeatures, setEnabledFeatures] = useState<OAuthFeature[]>([...connection.enabledFeatures]);
  const [syncStatus, setSyncStatus] = useState<Record<string, FeatureSyncInfo | undefined>>(
    connection.syncStatus as Record<string, FeatureSyncInfo | undefined>,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [reAuthUrl, setReAuthUrl] = useState<string | null>(null);

  const providerName = PROVIDER_NAMES[connection.provider] ?? connection.provider;

  /** Optimistic save helper. */
  const saveUpdate = useCallback(
    async (updates: Record<string, unknown>) => {
      setIsSaving(true);
      setReAuthUrl(null);
      try {
        const res = await apiClient.patch<PatchResponse>(
          `/api/oauth/connections/${connection.id}`,
          updates,
        );
        onConnectionUpdated(res.connection);
        if (res.reAuthRequired && res.reAuthUrl) {
          setReAuthUrl(res.reAuthUrl);
        }
        return res;
      } catch {
        // Revert optimistic state on error
        setLabel(connection.label);
        setIsActive(connection.isActive);
        setPermissionLevel(connection.permissionLevel);
        setEnabledFeatures([...connection.enabledFeatures]);
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
      saveUpdate({ isActive: checked });
    },
    [saveUpdate],
  );

  const handlePermissionChange = useCallback(
    (level: OAuthPermissionLevel) => {
      setPermissionLevel(level);
      saveUpdate({ permissionLevel: level });
    },
    [saveUpdate],
  );

  const handleFeatureToggle = useCallback(
    (feature: OAuthFeature, enabled: boolean) => {
      const updated = enabled
        ? [...enabledFeatures, feature]
        : enabledFeatures.filter((f) => f !== feature);
      setEnabledFeatures(updated);
      saveUpdate({ enabledFeatures: updated });
    },
    [enabledFeatures, saveUpdate],
  );

  const handleSyncNow = useCallback(
    async (feature: OAuthFeature) => {
      setSyncStatus((prev) => ({
        ...prev,
        [feature]: { lastSyncAt: prev[feature]?.lastSyncAt ?? null, status: 'syncing' as const },
      }));
      try {
        await apiClient.post(`/api/sync/${feature}`, { connectionId: connection.id });
        setSyncStatus((prev) => ({
          ...prev,
          [feature]: { lastSyncAt: new Date().toISOString(), status: 'idle' as const },
        }));
      } catch {
        setSyncStatus((prev) => ({
          ...prev,
          [feature]: { lastSyncAt: prev[feature]?.lastSyncAt ?? null, status: 'error' as const, error: 'Sync failed' },
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
                  {isActive ? 'Active' : 'Inactive'}
                </Badge>
              </div>
              {connection.providerAccountEmail && (
                <p className="text-sm text-muted-foreground">{connection.providerAccountEmail}</p>
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
              checked={isActive}
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
              value={permissionLevel}
              onChange={handlePermissionChange}
              enabledFeatures={enabledFeatures}
              isDisabled={isSaving}
            />
          </div>

          <Separator />

          {/* Feature toggles */}
          <div className="space-y-3">
            <label className="text-sm font-medium">Features</label>
            {ALL_FEATURES.map((feature) => (
              <FeatureToggle
                key={feature}
                feature={feature}
                enabled={enabledFeatures.includes(feature)}
                currentScopes={connection.scopes}
                provider={connection.provider}
                permissionLevel={permissionLevel}
                onToggle={handleFeatureToggle}
                isDisabled={isSaving}
              />
            ))}
          </div>

          {/* Re-auth button */}
          {reAuthUrl && (
            <div data-testid="reauth-button">
              <Button asChild className="w-full">
                <a href={reAuthUrl}>
                  <ExternalLink className="size-4" />
                  Save &amp; Authorize
                </a>
              </Button>
              <p className="mt-1 text-xs text-center text-muted-foreground">
                You will be redirected to {providerName} to grant additional permissions
              </p>
            </div>
          )}

          <Separator />

          {/* Sync status */}
          <div className="space-y-3" data-testid="sync-status-section">
            <label className="text-sm font-medium">Sync Status</label>
            <SyncStatusDisplay
              enabledFeatures={enabledFeatures}
              syncStatus={syncStatus}
              onSyncNow={handleSyncNow}
            />
            {enabledFeatures.length === 0 && (
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
