/**
 * Permission level selector for OAuth connections.
 *
 * Displays Read-only and Read & Write options as segmented control.
 * Shows a warning when write access is selected.
 */
import { Shield, ShieldAlert } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import type { OAuthFeature, OAuthPermissionLevel } from './types';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface PermissionLevelSelectorProps {
  value: OAuthPermissionLevel;
  onChange: (level: OAuthPermissionLevel) => void;
  enabled_features?: OAuthFeature[];
  isDisabled?: boolean;
}

function formatFeatureList(features: OAuthFeature[]): string {
  if (features.length === 0) return 'your data';
  if (features.length === 1) return features[0];
  const last = features[features.length - 1];
  const rest = features.slice(0, -1);
  return `${rest.join(', ')} and ${last}`;
}

export function PermissionLevelSelector({
  value,
  onChange,
  enabled_features = [],
  isDisabled,
}: PermissionLevelSelectorProps) {
  return (
    <div data-testid="permission-level-selector">
      <div className="flex gap-2">
        <button
          type="button"
          data-testid="permission-option-read"
          data-selected={value === 'read' ? 'true' : 'false'}
          aria-disabled={isDisabled ? 'true' : undefined}
          className={cn(
            'flex flex-1 items-center justify-center gap-2 rounded-lg border-2 px-3 py-2.5 text-sm font-medium transition-all',
            value === 'read'
              ? 'border-primary bg-primary/5 text-foreground'
              : 'border-border text-muted-foreground hover:border-primary/50 hover:bg-muted/50',
            isDisabled && 'pointer-events-none opacity-50',
          )}
          onClick={() => {
            if (!isDisabled) onChange('read');
          }}
        >
          <Shield className="size-4" />
          Read Only
        </button>
        <button
          type="button"
          data-testid="permission-option-read_write"
          data-selected={value === 'read_write' ? 'true' : 'false'}
          aria-disabled={isDisabled ? 'true' : undefined}
          className={cn(
            'flex flex-1 items-center justify-center gap-2 rounded-lg border-2 px-3 py-2.5 text-sm font-medium transition-all',
            value === 'read_write'
              ? 'border-primary bg-primary/5 text-foreground'
              : 'border-border text-muted-foreground hover:border-primary/50 hover:bg-muted/50',
            isDisabled && 'pointer-events-none opacity-50',
          )}
          onClick={() => {
            if (!isDisabled) onChange('read_write');
          }}
        >
          <ShieldAlert className="size-4" />
          Read &amp; Write
        </button>
      </div>

      {value === 'read_write' && enabled_features.length > 0 && (
        <div
          className="mt-2 flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-400"
          data-testid="write-access-warning"
        >
          <ShieldAlert className="size-3 shrink-0" />
          <span>
            This will grant OpenClaw write access to your {formatFeatureList(enabled_features)}
          </span>
        </div>
      )}
    </div>
  );
}
