/**
 * Per-feature sync status display.
 *
 * Shows last sync time, sync state, and a "Sync Now" button
 * for each enabled feature.
 */
import { RefreshCw, CheckCircle, Clock } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import type { OAuthFeature } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FeatureSyncInfo {
  lastSyncAt: string | null;
  status: 'idle' | 'syncing' | 'error';
  error?: string;
}

export interface SyncStatusDisplayProps {
  enabledFeatures: OAuthFeature[];
  syncStatus: Record<string, FeatureSyncInfo | undefined>;
  onSyncNow: (feature: OAuthFeature) => void;
  isSyncing?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FEATURE_LABELS: Record<OAuthFeature, string> = {
  contacts: 'Contacts',
  email: 'Email',
  files: 'Files',
  calendar: 'Calendar',
};

function formatSyncTime(dateStr: string | null): string {
  if (!dateStr) return 'Never synced';
  const date = new Date(dateStr);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SyncStatusDisplay({
  enabledFeatures,
  syncStatus,
  onSyncNow,
}: SyncStatusDisplayProps) {
  if (enabledFeatures.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      {enabledFeatures.map((feature) => {
        const info = syncStatus[feature];
        const isSyncing = info?.status === 'syncing';
        const lastSync = info?.lastSyncAt ?? null;

        return (
          <div
            key={feature}
            className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
            data-testid={`sync-status-${feature}`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{FEATURE_LABELS[feature]}</span>
                {isSyncing ? (
                  <span
                    className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400"
                    data-testid={`sync-progress-${feature}`}
                  >
                    <RefreshCw className="size-3 animate-spin" />
                    Syncing...
                  </span>
                ) : lastSync ? (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <CheckCircle className="size-3" />
                    {formatSyncTime(lastSync)}
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="size-3" />
                    Never synced
                  </span>
                )}
              </div>
              {info?.status === 'error' && info.error && (
                <p className="mt-0.5 text-xs text-destructive">{info.error}</p>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onSyncNow(feature)}
              disabled={isSyncing}
              data-testid={`sync-btn-${feature}`}
            >
              <RefreshCw className={`size-3 ${isSyncing ? 'animate-spin' : ''}`} />
              Sync Now
            </Button>
          </div>
        );
      })}
    </div>
  );
}
