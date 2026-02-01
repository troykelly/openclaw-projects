import * as React from 'react';
import { useCallback } from 'react';
import { Sun, Moon, Monitor, Bell, Layout, Clock, Eye } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/components/ui/card';
import { Switch } from '@/ui/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/components/ui/select';
import { Skeleton } from '@/ui/components/feedback';
import { cn } from '@/ui/lib/utils';
import { useSettings } from './use-settings';
import type { Theme, DefaultView, EmailDigestFrequency } from './types';

const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Australia/Sydney',
  'Australia/Melbourne',
];

const ITEMS_PER_PAGE_OPTIONS = [10, 25, 50, 75, 100];

interface ThemeOptionProps {
  value: Theme;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  isSelected: boolean;
  onChange: (theme: Theme) => void;
}

function ThemeOption({ value, label, icon: Icon, isSelected, onChange }: ThemeOptionProps) {
  return (
    <label
      className={cn(
        'flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 p-4 transition-all',
        isSelected
          ? 'border-primary bg-primary/5'
          : 'border-border hover:border-primary/50 hover:bg-muted/50'
      )}
    >
      <input
        type="radio"
        name="theme"
        value={value}
        checked={isSelected}
        onChange={() => onChange(value)}
        className="sr-only"
        aria-label={label}
      />
      <Icon className={cn('size-6', isSelected ? 'text-primary' : 'text-muted-foreground')} />
      <span className={cn('text-sm font-medium', isSelected ? 'text-foreground' : 'text-muted-foreground')}>
        {label}
      </span>
    </label>
  );
}

interface SettingRowProps {
  label: string;
  description?: string;
  children: React.ReactNode;
  htmlFor?: string;
}

function SettingRow({ label, description, children, htmlFor }: SettingRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="flex-1">
        <label htmlFor={htmlFor} className="text-sm font-medium">
          {label}
        </label>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function SettingsPage() {
  const { state, isSaving, updateSettings } = useSettings();

  const handleThemeChange = useCallback(
    (theme: Theme) => {
      updateSettings({ theme });
      // Also update the dark mode class on the document
      const root = document.documentElement;
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const isDark = theme === 'dark' || (theme === 'system' && mediaQuery.matches);
      root.classList.toggle('dark', isDark);
      localStorage.setItem('theme', theme);
    },
    [updateSettings]
  );

  const handleDefaultViewChange = useCallback(
    (view: DefaultView) => {
      updateSettings({ default_view: view });
    },
    [updateSettings]
  );

  const handleTimezoneChange = useCallback(
    (timezone: string) => {
      updateSettings({ timezone });
    },
    [updateSettings]
  );

  const handleItemsPerPageChange = useCallback(
    (value: string) => {
      updateSettings({ items_per_page: parseInt(value, 10) });
    },
    [updateSettings]
  );

  const handleDigestFrequencyChange = useCallback(
    (frequency: EmailDigestFrequency) => {
      updateSettings({ email_digest_frequency: frequency });
    },
    [updateSettings]
  );

  if (state.kind === 'loading') {
    return (
      <div className="p-6">
        <div className="mx-auto max-w-2xl space-y-6">
          <Skeleton className="h-8 w-32" />
          <div className="space-y-4">
            <Skeleton className="h-48" />
            <Skeleton className="h-48" />
            <Skeleton className="h-48" />
          </div>
        </div>
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="flex flex-col items-center justify-center p-6">
        <div className="text-center">
          <h2 className="text-lg font-semibold text-destructive">Error</h2>
          <p className="mt-2 text-muted-foreground">{state.message}</p>
          {state.status === 401 && (
            <a href="/app/auth" className="mt-4 inline-block text-primary hover:underline">
              Sign in
            </a>
          )}
        </div>
      </div>
    );
  }

  const settings = state.data;

  return (
    <div className="p-6">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Settings</h1>
          {isSaving && <span className="text-sm text-muted-foreground">Saving...</span>}
        </div>

        {/* Appearance */}
        <Card data-testid="settings-card">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Sun className="size-5 text-muted-foreground" />
              <CardTitle>Appearance</CardTitle>
            </div>
            <CardDescription>Customize how the application looks</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <label className="mb-3 block text-sm font-medium">Theme</label>
                <div className="grid grid-cols-3 gap-3">
                  <ThemeOption
                    value="light"
                    label="Light"
                    icon={Sun}
                    isSelected={settings.theme === 'light'}
                    onChange={handleThemeChange}
                  />
                  <ThemeOption
                    value="dark"
                    label="Dark"
                    icon={Moon}
                    isSelected={settings.theme === 'dark'}
                    onChange={handleThemeChange}
                  />
                  <ThemeOption
                    value="system"
                    label="System"
                    icon={Monitor}
                    isSelected={settings.theme === 'system'}
                    onChange={handleThemeChange}
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Navigation */}
        <Card data-testid="settings-card">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Layout className="size-5 text-muted-foreground" />
              <CardTitle>Navigation</CardTitle>
            </div>
            <CardDescription>Configure your default views and layout</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 divide-y">
            <SettingRow label="Default View" description="The page to show when you open the app">
              <Select
                value={settings.default_view}
                onValueChange={(v) => handleDefaultViewChange(v as DefaultView)}
              >
                <SelectTrigger className="w-[140px]" aria-label="Default view">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="activity">Activity</SelectItem>
                  <SelectItem value="projects">Projects</SelectItem>
                  <SelectItem value="timeline">Timeline</SelectItem>
                  <SelectItem value="contacts">People</SelectItem>
                </SelectContent>
              </Select>
            </SettingRow>

            <SettingRow
              label="Sidebar Collapsed"
              description="Start with the sidebar collapsed"
              htmlFor="sidebar-collapsed"
            >
              <Switch
                id="sidebar-collapsed"
                checked={settings.sidebar_collapsed}
                onCheckedChange={(checked) => updateSettings({ sidebar_collapsed: checked })}
                aria-label="Sidebar collapsed"
              />
            </SettingRow>
          </CardContent>
        </Card>

        {/* Display */}
        <Card data-testid="settings-card">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Eye className="size-5 text-muted-foreground" />
              <CardTitle>Display</CardTitle>
            </div>
            <CardDescription>Control what items are shown</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 divide-y">
            <SettingRow
              label="Show Completed Items"
              description="Show completed items in lists"
              htmlFor="show-completed"
            >
              <Switch
                id="show-completed"
                checked={settings.show_completed_items}
                onCheckedChange={(checked) => updateSettings({ show_completed_items: checked })}
                aria-label="Show completed items"
              />
            </SettingRow>

            <SettingRow label="Items Per Page" description="Number of items to show in lists">
              <Select
                value={String(settings.items_per_page)}
                onValueChange={handleItemsPerPageChange}
              >
                <SelectTrigger className="w-[100px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ITEMS_PER_PAGE_OPTIONS.map((count) => (
                    <SelectItem key={count} value={String(count)}>
                      {count}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingRow>
          </CardContent>
        </Card>

        {/* Notifications */}
        <Card data-testid="settings-card">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Bell className="size-5 text-muted-foreground" />
              <CardTitle>Notifications</CardTitle>
            </div>
            <CardDescription>Configure how you receive notifications</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 divide-y">
            <SettingRow
              label="Email Notifications"
              description="Receive email notifications for updates"
              htmlFor="email-notifications"
            >
              <Switch
                id="email-notifications"
                checked={settings.email_notifications}
                onCheckedChange={(checked) => updateSettings({ email_notifications: checked })}
                aria-label="Email notifications"
              />
            </SettingRow>

            <SettingRow label="Email Digest" description="How often to receive digest emails">
              <Select
                value={settings.email_digest_frequency}
                onValueChange={(v) => handleDigestFrequencyChange(v as EmailDigestFrequency)}
                disabled={!settings.email_notifications}
              >
                <SelectTrigger className="w-[120px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="never">Never</SelectItem>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                </SelectContent>
              </Select>
            </SettingRow>
          </CardContent>
        </Card>

        {/* Regional */}
        <Card data-testid="settings-card">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Clock className="size-5 text-muted-foreground" />
              <CardTitle>Regional</CardTitle>
            </div>
            <CardDescription>Configure regional preferences</CardDescription>
          </CardHeader>
          <CardContent>
            <SettingRow label="Timezone" description="Your timezone for displaying dates and times">
              <Select value={settings.timezone} onValueChange={handleTimezoneChange}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMMON_TIMEZONES.map((tz) => (
                    <SelectItem key={tz} value={tz}>
                      {tz.replace(/_/g, ' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingRow>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
