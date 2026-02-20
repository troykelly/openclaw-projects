/**
 * Namespace indicator for the header bar (Issue #1482).
 *
 * Shows the current active namespace in the header. For multi-namespace users,
 * this provides a quick-switch dropdown. For single-namespace users, it shows
 * a subtle label.
 */
import type * as React from 'react';
import { Globe } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select';
import { useNamespaceSafe } from '@/ui/contexts/namespace-context';
import { cn } from '@/ui/lib/utils';

export interface NamespaceIndicatorProps {
  className?: string;
}

/**
 * Header indicator showing the active namespace.
 * Multi-namespace users get a dropdown; single-namespace users see a subtle label.
 */
export function NamespaceIndicator({ className }: NamespaceIndicatorProps): React.JSX.Element | null {
  const ns = useNamespaceSafe();

  if (!ns || ns.grants.length === 0) return null;

  // Single-namespace: subtle read-only indicator
  if (!ns.hasMultipleNamespaces) {
    return (
      <div
        className={cn('flex items-center gap-1.5 text-xs text-muted-foreground', className)}
        data-testid="namespace-indicator"
      >
        <Globe className="size-3" />
        <span>{ns.activeNamespace}</span>
      </div>
    );
  }

  // Multi-namespace: interactive dropdown
  return (
    <div className={className} data-testid="namespace-indicator">
      <Select value={ns.activeNamespace} onValueChange={ns.setActiveNamespace}>
        <SelectTrigger
          size="sm"
          className="h-8 gap-1.5 border-none bg-transparent px-2 text-xs shadow-none hover:bg-muted"
          aria-label="Switch namespace"
        >
          <Globe className="size-3 text-muted-foreground" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end">
          {ns.grants.map((g) => (
            <SelectItem key={g.namespace} value={g.namespace}>
              {g.namespace}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
