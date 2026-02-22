import * as React from 'react';
import { useState, useCallback } from 'react';
import {
  Link2,
  Plus,
  Trash2,
  Pencil,
  Settings,
  Check,
  X,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/components/ui/card';
import { Switch } from '@/ui/components/ui/switch';
import { Input } from '@/ui/components/ui/input';
import { Button } from '@/ui/components/ui/button';
import { Badge } from '@/ui/components/ui/badge';
import { Skeleton } from '@/ui/components/feedback';
import { Separator } from '@/ui/components/ui/separator';
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
import { Checkbox } from '@/ui/components/ui/checkbox';
import { cn } from '@/ui/lib/utils';
import { useConnectedAccounts } from './use-connected-accounts';
import { ConnectionManagePanel } from './connection-manage-panel';
import type {
  OAuthConnectionSummary,
  OAuthFeature,
  OAuthPermissionLevel,
  OAuthProviderInfo,
} from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ALL_FEATURES: OAuthFeature[] = ['contacts', 'email', 'files', 'calendar'];

function formatProviderName(provider: string): string {
  const names: Record<string, string> = {
    google: 'Google',
    microsoft: 'Microsoft',
  };
  return names[provider] ?? provider;
}

function formatFeature(feature: string): string {
  return feature.charAt(0).toUpperCase() + feature.slice(1);
}

function formatPermission(level: OAuthPermissionLevel): string {
  return level === 'read_write' ? 'Read & Write' : 'Read Only';
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const date = new Date(dateStr);
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Provider icon using initial letter styled by provider color. */
function ProviderIcon({ provider }: { provider: string }) {
  const colors: Record<string, string> = {
    google: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    microsoft: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  };

  return (
    <div
      className={cn(
        'flex size-10 items-center justify-center rounded-full text-sm font-bold',
        colors[provider] ?? 'bg-muted text-muted-foreground',
      )}
      data-testid={`provider-icon-${provider}`}
    >
      {provider === 'google' ? 'G' : provider === 'microsoft' ? 'M' : provider.charAt(0).toUpperCase()}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit Form
// ---------------------------------------------------------------------------

interface EditFormState {
  label: string;
  permission_level: OAuthPermissionLevel;
  enabled_features: OAuthFeature[];
}

interface ConnectionEditFormProps {
  connection: OAuthConnectionSummary;
  onSave: (updates: EditFormState) => void;
  onCancel: () => void;
  isSaving: boolean;
}

function ConnectionEditForm({ connection, onSave, onCancel, isSaving }: ConnectionEditFormProps) {
  const [form, setForm] = useState<EditFormState>({
    label: connection.label,
    permission_level: connection.permission_level,
    enabled_features: Array.isArray(connection.enabled_features) ? [...connection.enabled_features] : [],
  });

  const toggleFeature = useCallback((feature: OAuthFeature) => {
    setForm((prev) => ({
      ...prev,
      enabled_features: prev.enabled_features.includes(feature)
        ? prev.enabled_features.filter((f) => f !== feature)
        : [...prev.enabled_features, feature],
    }));
  }, []);

  return (
    <div className="space-y-4 rounded-lg border bg-muted/20 p-4" data-testid="connection-edit-form">
      <div className="space-y-2">
        <label htmlFor={`edit-label-${connection.id}`} className="text-sm font-medium">
          Label
        </label>
        <Input
          id={`edit-label-${connection.id}`}
          value={form.label}
          onChange={(e) => setForm((prev) => ({ ...prev, label: e.target.value }))}
          placeholder="e.g. Work Gmail, Personal Microsoft"
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Permission Level</label>
        <Select
          value={form.permission_level}
          onValueChange={(v) => setForm((prev) => ({ ...prev, permission_level: v as OAuthPermissionLevel }))}
        >
          <SelectTrigger className="w-full" data-testid="permission-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="read">Read Only</SelectItem>
            <SelectItem value="read_write">Read &amp; Write</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Enabled Features</label>
        <div className="flex flex-wrap gap-3">
          {ALL_FEATURES.map((feature) => (
            <label key={feature} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={form.enabled_features.includes(feature)}
                onCheckedChange={() => toggleFeature(feature)}
                data-testid={`feature-checkbox-${feature}`}
              />
              {formatFeature(feature)}
            </label>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={isSaving}>
          <X className="size-4" />
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={() => onSave(form)}
          disabled={isSaving || form.label.trim() === ''}
          data-testid="save-connection-btn"
        >
          <Check className="size-4" />
          {isSaving ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connection Card
// ---------------------------------------------------------------------------

interface ConnectionCardProps {
  connection: OAuthConnectionSummary;
  onUpdate: (id: string, updates: Partial<OAuthConnectionSummary>) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  isUpdating: boolean;
}

function ConnectionCard({ connection, onUpdate, onDelete, isUpdating }: ConnectionCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isManaging, setIsManaging] = useState(false);
  const enabledFeatures = Array.isArray(connection.enabled_features) ? connection.enabled_features : [];

  const handleConnectionUpdated = useCallback(
    (updated: OAuthConnectionSummary) => {
      onUpdate(updated.id, updated);
    },
    [onUpdate],
  );

  const handleSave = useCallback(
    async (form: EditFormState) => {
      const success = await onUpdate(connection.id, {
        label: form.label.trim(),
        permission_level: form.permission_level,
        enabled_features: form.enabled_features,
      });
      if (success) {
        setIsEditing(false);
      }
    },
    [connection.id, onUpdate],
  );

  const handleToggleActive = useCallback(
    (checked: boolean) => {
      onUpdate(connection.id, { is_active: checked });
    },
    [connection.id, onUpdate],
  );

  return (
    <div className="rounded-lg border p-4" data-testid={`connection-card-${connection.id}`}>
      <div className="flex items-start justify-between gap-4">
        {/* Left: provider info */}
        <div className="flex items-start gap-3">
          <ProviderIcon provider={connection.provider} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold">{connection.label || formatProviderName(connection.provider)}</h4>
              <Badge variant="outline" className="text-xs">
                {formatProviderName(connection.provider)}
              </Badge>
              {connection.is_active ? (
                <Badge variant="default" className="text-xs bg-green-600">Active</Badge>
              ) : (
                <Badge variant="secondary" className="text-xs">Inactive</Badge>
              )}
            </div>
            {connection.provider_account_email && (
              <p className="mt-0.5 text-sm text-muted-foreground">{connection.provider_account_email}</p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{formatPermission(connection.permission_level)}</span>
              <span className="text-border">|</span>
              {enabledFeatures.length > 0 ? (
                enabledFeatures.map((f) => (
                  <Badge key={f} variant="outline" className="text-xs">
                    {formatFeature(f)}
                  </Badge>
                ))
              ) : (
                <span className="italic">No features enabled</span>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Last synced: {formatDate(connection.last_sync_at)} &middot; Connected: {formatDate(connection.created_at)}
            </p>
          </div>
        </div>

        {/* Right: actions */}
        <div className="flex shrink-0 items-center gap-2">
          <Switch
            checked={connection.is_active}
            onCheckedChange={handleToggleActive}
            disabled={isUpdating}
            aria-label={`Toggle ${connection.label || connection.provider} active`}
            data-testid={`toggle-active-${connection.id}`}
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsManaging(true)}
            disabled={isUpdating}
            data-testid={`manage-connection-${connection.id}`}
          >
            <Settings className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsEditing(!isEditing)}
            disabled={isUpdating}
            data-testid={`edit-connection-${connection.id}`}
          >
            <Pencil className="size-4" />
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-destructive hover:text-destructive"
                disabled={isUpdating}
                data-testid={`delete-connection-${connection.id}`}
              >
                <Trash2 className="size-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove connection?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently remove the {formatProviderName(connection.provider)} connection
                  {connection.provider_account_email ? ` (${connection.provider_account_email})` : ''}.
                  You will need to re-authorize to reconnect.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => onDelete(connection.id)}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  data-testid={`confirm-delete-${connection.id}`}
                >
                  Remove
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Edit form (expandable) */}
      {isEditing && (
        <>
          <Separator className="my-4" />
          <ConnectionEditForm
            connection={connection}
            onSave={handleSave}
            onCancel={() => setIsEditing(false)}
            isSaving={isUpdating}
          />
        </>
      )}

      {/* Manage panel (slide-over) */}
      <ConnectionManagePanel
        connection={connection}
        open={isManaging}
        onOpenChange={setIsManaging}
        onConnectionUpdated={handleConnectionUpdated}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add Account Dropdown
// ---------------------------------------------------------------------------

interface AddAccountButtonProps {
  providers: OAuthProviderInfo[];
}

function AddAccountButton({ providers }: AddAccountButtonProps) {
  const configuredProviders = providers.filter((p) => p.configured);

  if (configuredProviders.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <AlertTriangle className="size-4" />
        No OAuth providers configured
      </div>
    );
  }

  if (configuredProviders.length === 1) {
    return (
      <Button asChild size="sm" data-testid="add-account-btn">
        <a href={`/api/oauth/authorize/${configuredProviders[0].name}`}>
          <Plus className="size-4" />
          Add {formatProviderName(configuredProviders[0].name)} Account
        </a>
      </Button>
    );
  }

  return (
    <div className="flex gap-2">
      {configuredProviders.map((p) => (
        <Button key={p.name} asChild variant="outline" size="sm" data-testid={`add-account-${p.name}`}>
          <a href={`/api/oauth/authorize/${p.name}`}>
            <Plus className="size-4" />
            {formatProviderName(p.name)}
          </a>
        </Button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Section
// ---------------------------------------------------------------------------

export function ConnectedAccountsSection() {
  const { state, isUpdating, updateConnection, deleteConnection } = useConnectedAccounts();

  if (state.kind === 'loading') {
    return (
      <Card data-testid="connected-accounts-card">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Link2 className="size-5 text-muted-foreground" />
            <CardTitle>Connected Accounts</CardTitle>
          </div>
          <CardDescription>Loading connected accounts...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (state.kind === 'error') {
    return (
      <Card data-testid="connected-accounts-card">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Link2 className="size-5 text-muted-foreground" />
            <CardTitle>Connected Accounts</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-4">
            <AlertTriangle className="size-5 text-destructive" />
            <div>
              <p className="text-sm font-medium text-destructive">Failed to load accounts</p>
              <p className="text-xs text-muted-foreground">{state.message}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const connections = Array.isArray(state.connections) ? state.connections : [];
  const providers = Array.isArray(state.providers) ? state.providers : [];

  return (
    <Card data-testid="connected-accounts-card">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link2 className="size-5 text-muted-foreground" />
            <CardTitle>Connected Accounts</CardTitle>
          </div>
          <AddAccountButton providers={providers} />
        </div>
        <CardDescription>
          Manage your connected Google and Microsoft accounts for contacts, email, files, and calendar sync.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {connections.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center" data-testid="no-connections">
            <ExternalLink className="mx-auto size-8 text-muted-foreground" />
            <h3 className="mt-3 text-sm font-medium">No connected accounts</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Connect a Google or Microsoft account to sync contacts, email, and more.
            </p>
          </div>
        ) : (
          <div className="space-y-3" data-testid="connections-list">
            {connections.map((conn) => (
              <ConnectionCard
                key={conn.id}
                connection={conn}
                onUpdate={updateConnection}
                onDelete={deleteConnection}
                isUpdating={isUpdating}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
