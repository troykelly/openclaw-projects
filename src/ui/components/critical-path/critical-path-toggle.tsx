/**
 * Toggle for showing/hiding critical path highlighting
 */
import * as React from 'react';
import { Switch } from '@/ui/components/ui/switch';
import { Label } from '@/ui/components/ui/label';
import { cn } from '@/ui/lib/utils';

export interface CriticalPathToggleProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  className?: string;
}

export function CriticalPathToggle({ enabled, onToggle, className }: CriticalPathToggleProps) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Switch id="critical-path-toggle" checked={enabled} onCheckedChange={onToggle} aria-label="Toggle critical path highlighting" />
      <Label htmlFor="critical-path-toggle" className="text-sm font-medium cursor-pointer">
        Critical Path
      </Label>
    </div>
  );
}
