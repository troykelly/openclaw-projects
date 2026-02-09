/**
 * Quick filter presets for activity feed
 * Issue #403: Implement activity feed filtering and personalization
 */
import * as React from 'react';
import { Button } from '@/ui/components/ui/button';
import { cn } from '@/ui/lib/utils';
import type { QuickFilterPreset, ActivityFilters } from './types';

export interface ActivityQuickFiltersProps {
  presets: QuickFilterPreset[];
  activePresetId: string | null;
  onSelectPreset: (presetId: string | null, filters: ActivityFilters) => void;
  className?: string;
}

export function ActivityQuickFilters({ presets, activePresetId, onSelectPreset, className }: ActivityQuickFiltersProps) {
  if (presets.length === 0) {
    return <div className={cn('text-sm text-muted-foreground', className)}>No presets available</div>;
  }

  const handleClick = (preset: QuickFilterPreset) => {
    if (activePresetId === preset.id) {
      // Deselect
      onSelectPreset(null, {});
    } else {
      onSelectPreset(preset.id, preset.filters);
    }
  };

  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {presets.map((preset) => {
        const isActive = activePresetId === preset.id;

        return (
          <Button key={preset.id} variant={isActive ? 'secondary' : 'outline'} size="sm" onClick={() => handleClick(preset)} data-active={isActive}>
            {preset.name}
          </Button>
        );
      })}
    </div>
  );
}
