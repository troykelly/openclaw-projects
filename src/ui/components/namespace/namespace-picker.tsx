/**
 * Namespace picker for entity creation forms (Issue #1482).
 *
 * Shows a dropdown to select which namespace to create an item in.
 * Hidden when the user only has one namespace (single-namespace optimization).
 */
import type * as React from 'react';
import { Globe } from 'lucide-react';
import { Label } from '@/ui/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select';
import { useNamespaceSafe } from '@/ui/contexts/namespace-context';

export interface NamespacePickerProps {
  value?: string;
  onValueChange?: (namespace: string) => void;
  label?: string;
  className?: string;
}

/**
 * Renders a namespace picker for create-in-namespace workflows.
 * Returns null if the user has only one namespace.
 */
export function NamespacePicker({ value, onValueChange, label = 'Namespace', className }: NamespacePickerProps): React.JSX.Element | null {
  const ns = useNamespaceSafe();

  // Single-namespace optimization: nothing to pick
  if (!ns?.hasMultipleNamespaces) return null;

  const currentValue = value ?? ns.activeNamespace;

  return (
    <div className={className} data-testid="namespace-picker">
      <Label htmlFor="namespace-picker">{label}</Label>
      <Select value={currentValue} onValueChange={onValueChange}>
        <SelectTrigger id="namespace-picker" className="mt-2 w-full" aria-label="Select namespace">
          <Globe className="size-3.5 shrink-0 text-muted-foreground" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
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
