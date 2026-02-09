/**
 * Personalization settings for activity feed
 * Issue #403: Implement activity feed filtering and personalization
 */
import * as React from 'react';
import { Save } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { Label } from '@/ui/components/ui/label';
import { Switch } from '@/ui/components/ui/switch';
import { Input } from '@/ui/components/ui/input';
import { cn } from '@/ui/lib/utils';
import type { ActivityPersonalizationSettings } from './types';

export interface ActivityFeedPersonalizationProps {
  settings: ActivityPersonalizationSettings;
  onChange: (settings: ActivityPersonalizationSettings) => void;
  onSaveDefaults?: (settings: ActivityPersonalizationSettings) => void;
  className?: string;
}

export function ActivityFeedPersonalization({ settings, onChange, onSaveDefaults, className }: ActivityFeedPersonalizationProps) {
  const handleToggle = (key: keyof ActivityPersonalizationSettings) => {
    onChange({
      ...settings,
      [key]: !settings[key],
    });
  };

  const handleNumberChange = (key: 'collapseThreshold' | 'refreshInterval', value: number) => {
    onChange({
      ...settings,
      [key]: value,
    });
  };

  return (
    <div className={cn('space-y-6', className)}>
      {/* Default filters section */}
      <div>
        <h4 className="text-sm font-medium mb-3">Default Filters</h4>
        <p className="text-xs text-muted-foreground">
          {Object.keys(settings.defaultFilters).length > 0 ? `${Object.keys(settings.defaultFilters).length} filter(s) configured` : 'No default filters set'}
        </p>
      </div>

      {/* Display settings */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium">Display Settings</h4>

        {/* Show my activity first */}
        <div className="flex items-center justify-between">
          <Label htmlFor="my-activity-first" className="text-sm cursor-pointer">
            Show my activity first
          </Label>
          <Switch
            id="my-activity-first"
            aria-label="Show my activity first"
            checked={settings.showMyActivityFirst}
            onCheckedChange={() => handleToggle('showMyActivityFirst')}
          />
        </div>

        {/* Collapse threshold */}
        <div className="space-y-2">
          <Label htmlFor="collapse-threshold" className="text-sm">
            Collapse threshold
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="collapse-threshold"
              type="number"
              min={2}
              max={20}
              value={settings.collapseThreshold}
              onChange={(e) => handleNumberChange('collapseThreshold', parseInt(e.target.value, 10))}
              className="w-20"
            />
            <span className="text-xs text-muted-foreground">Group similar activities when there are this many</span>
          </div>
        </div>
      </div>

      {/* Refresh settings */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium">Refresh Settings</h4>

        {/* Auto refresh */}
        <div className="flex items-center justify-between">
          <Label htmlFor="auto-refresh" className="text-sm cursor-pointer">
            Auto refresh
          </Label>
          <Switch id="auto-refresh" aria-label="Auto refresh" checked={settings.autoRefresh} onCheckedChange={() => handleToggle('autoRefresh')} />
        </div>

        {/* Refresh interval */}
        {settings.autoRefresh && (
          <div className="space-y-2">
            <Label htmlFor="refresh-interval" className="text-sm">
              Refresh interval (seconds)
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="refresh-interval"
                type="number"
                min={10}
                max={300}
                value={settings.refreshInterval}
                onChange={(e) => handleNumberChange('refreshInterval', parseInt(e.target.value, 10))}
                className="w-20"
              />
              <span className="text-xs text-muted-foreground">{settings.refreshInterval} seconds</span>
            </div>
          </div>
        )}
      </div>

      {/* Save button */}
      {onSaveDefaults && (
        <Button onClick={() => onSaveDefaults(settings)} className="w-full">
          <Save className="h-4 w-4 mr-2" />
          Save as Defaults
        </Button>
      )}
    </div>
  );
}
