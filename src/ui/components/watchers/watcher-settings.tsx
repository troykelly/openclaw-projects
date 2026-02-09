/**
 * Watcher settings for auto-watch preferences
 * Issue #401: Implement watchers/followers on work items
 */
import * as React from 'react';
import { Label } from '@/ui/components/ui/label';
import { Switch } from '@/ui/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select';
import { cn } from '@/ui/lib/utils';
import { NOTIFICATION_LEVELS, type AutoWatchSettings, type NotificationLevel } from './types';

export interface WatcherSettingsProps {
  settings: AutoWatchSettings;
  onChange: (settings: AutoWatchSettings) => void;
  className?: string;
}

export function WatcherSettings({ settings, onChange, className }: WatcherSettingsProps) {
  const handleToggle = (key: keyof AutoWatchSettings) => {
    onChange({
      ...settings,
      [key]: !settings[key],
    });
  };

  const handleNotificationLevelChange = (value: NotificationLevel) => {
    onChange({
      ...settings,
      defaultNotificationLevel: value,
    });
  };

  return (
    <div className={cn('space-y-6', className)}>
      {/* Auto-watch toggles */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium">Auto-watch settings</h4>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="auto-created" className="text-sm cursor-pointer">
              Items you create
            </Label>
            <Switch id="auto-created" checked={settings.autoWatchCreated} onCheckedChange={() => handleToggle('autoWatchCreated')} />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="auto-assigned" className="text-sm cursor-pointer">
              Items assigned to you
            </Label>
            <Switch id="auto-assigned" checked={settings.autoWatchAssigned} onCheckedChange={() => handleToggle('autoWatchAssigned')} />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="auto-commented" className="text-sm cursor-pointer">
              Items you comment on
            </Label>
            <Switch id="auto-commented" checked={settings.autoWatchCommented} onCheckedChange={() => handleToggle('autoWatchCommented')} />
          </div>
        </div>
      </div>

      {/* Default notification level */}
      <div className="space-y-2">
        <Label htmlFor="notification-level" className="text-sm font-medium">
          Default notification level
        </Label>
        <Select value={settings.defaultNotificationLevel} onValueChange={handleNotificationLevelChange}>
          <SelectTrigger id="notification-level">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {NOTIFICATION_LEVELS.map((level) => (
              <SelectItem key={level.value} value={level.value}>
                {level.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
