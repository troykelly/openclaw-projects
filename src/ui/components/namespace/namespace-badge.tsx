/**
 * Namespace badge component (Issue #1482, #2352).
 *
 * Displays a small badge indicating which namespace an entity belongs to.
 * Hidden when the user only has one namespace grant (single-namespace optimization).
 * Also visible in multi-namespace mode (multiple namespaces selected).
 */
import type * as React from 'react';
import { Globe } from 'lucide-react';
import { Badge } from '@/ui/components/ui/badge';
import { useNamespaceSafe } from '@/ui/contexts/namespace-context';
import { cn } from '@/ui/lib/utils';
import { NAMESPACE_STRINGS } from '@/ui/constants/namespace-strings';

export interface NamespaceBadgeProps {
  namespace?: string;
  className?: string;
}

/**
 * Renders a namespace badge for an entity.
 * Returns null if the user has only one namespace (no need for disambiguation).
 * Always visible in multi-namespace mode (#2352).
 */
export function NamespaceBadge({ namespace, className }: NamespaceBadgeProps): React.JSX.Element | null {
  const ns = useNamespaceSafe();

  // Single-namespace optimization: hide badge when user has only one namespace
  if (!ns?.hasMultipleNamespaces) return null;
  if (!namespace) return null;

  return (
    <Badge
      variant="outline"
      className={cn('gap-1 text-[10px] font-normal text-muted-foreground', className)}
      data-testid="namespace-badge"
      aria-label={NAMESPACE_STRINGS.badge.ariaLabel(namespace)}
    >
      <Globe className="size-2.5" />
      {namespace}
    </Badge>
  );
}
