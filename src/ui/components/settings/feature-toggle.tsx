/**
 * Individual feature toggle with scope upgrade detection.
 *
 * Shows feature name, description, and a toggle switch.
 * When enabling a feature that requires scopes the connection
 * doesn't have yet, displays a re-authorization notice.
 */
import { AlertTriangle } from 'lucide-react';
import { Switch } from '@/ui/components/ui/switch';
import type { OAuthFeature, OAuthPermissionLevel, OAuthProvider } from './types';

// ---------------------------------------------------------------------------
// Feature metadata
// ---------------------------------------------------------------------------

const FEATURE_META: Record<OAuthFeature, { label: string; description: string }> = {
  contacts: { label: 'Contacts', description: 'Access your contacts and address book' },
  email: { label: 'Email', description: 'Read and optionally send email' },
  files: { label: 'Files', description: 'Browse your files and documents' },
  calendar: { label: 'Calendar', description: 'View and optionally manage calendar events' },
};

/**
 * Scope definitions per provider/feature/permission — mirrors the backend
 * scopes module so the UI can detect scope gaps without a round-trip.
 */
const SCOPE_MAP: Record<OAuthProvider, Record<OAuthFeature, { read: string[]; read_write: string[] }>> = {
  google: {
    contacts: {
      read: ['https://www.googleapis.com/auth/contacts.readonly'],
      read_write: ['https://www.googleapis.com/auth/contacts'],
    },
    email: {
      read: ['https://www.googleapis.com/auth/gmail.readonly'],
      read_write: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'],
    },
    files: {
      read: ['https://www.googleapis.com/auth/drive.readonly'],
      read_write: ['https://www.googleapis.com/auth/drive.file'],
    },
    calendar: {
      read: ['https://www.googleapis.com/auth/calendar.readonly'],
      read_write: ['https://www.googleapis.com/auth/calendar'],
    },
  },
  microsoft: {
    contacts: {
      read: ['https://graph.microsoft.com/Contacts.Read'],
      read_write: ['https://graph.microsoft.com/Contacts.ReadWrite'],
    },
    email: {
      read: ['https://graph.microsoft.com/Mail.Read'],
      read_write: ['https://graph.microsoft.com/Mail.ReadWrite'],
    },
    files: {
      read: ['https://graph.microsoft.com/Files.Read'],
      read_write: ['https://graph.microsoft.com/Files.ReadWrite'],
    },
    calendar: {
      read: ['https://graph.microsoft.com/Calendars.Read'],
      read_write: ['https://graph.microsoft.com/Calendars.ReadWrite'],
    },
  },
};

const PROVIDER_NAMES: Record<OAuthProvider, string> = {
  google: 'Google',
  microsoft: 'Microsoft',
};

/**
 * Check whether enabling a feature would require scopes the
 * connection doesn't currently have.
 */
export function needsScopeUpgrade(
  feature: OAuthFeature,
  provider: OAuthProvider,
  permission_level: OAuthPermissionLevel,
  currentScopes: string[],
): boolean {
  const required = SCOPE_MAP[provider]?.[feature]?.[permission_level];
  if (!Array.isArray(required)) return true;
  const current = new Set(Array.isArray(currentScopes) ? currentScopes : []);
  return required.some((s) => !current.has(s));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface FeatureToggleProps {
  feature: OAuthFeature;
  enabled: boolean;
  currentScopes: string[];
  provider: OAuthProvider;
  permission_level: OAuthPermissionLevel;
  onToggle: (feature: OAuthFeature, enabled: boolean) => void;
  isDisabled?: boolean;
}

export function FeatureToggle({
  feature,
  enabled,
  currentScopes,
  provider,
  permission_level,
  onToggle,
  isDisabled,
}: FeatureToggleProps) {
  const meta = FEATURE_META[feature];
  const requiresUpgrade = !enabled && needsScopeUpgrade(feature, provider, permission_level, currentScopes);

  return (
    <div
      className="flex items-start justify-between gap-4 rounded-lg border p-3"
      data-testid={`feature-toggle-${feature}`}
    >
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{meta.label}</div>
        <p className="text-xs text-muted-foreground">{meta.description}</p>
        {requiresUpgrade && (
          <div
            className="mt-2 flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-400"
            data-testid={`scope-upgrade-notice-${feature}`}
          >
            <AlertTriangle className="size-3 shrink-0" />
            <span>Enabling this will redirect you to {PROVIDER_NAMES[provider]} to grant access</span>
          </div>
        )}
      </div>
      <Switch
        checked={enabled}
        onCheckedChange={(checked) => onToggle(feature, Boolean(checked))}
        disabled={isDisabled}
        aria-label={`Toggle ${meta.label}`}
      />
    </div>
  );
}
